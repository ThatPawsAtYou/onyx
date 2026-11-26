use crate::models::{
    DevJunkItem, DevJunkScanReport, DirectoryEntry, DiskTelemetry, LargeFileItem, LargeFilesReport,
    MemoryTelemetry, SystemCacheItem, SystemCacheReport, SystemOverview,
};
use crate::progress::{add_scanned_batch, is_scan_cancelled, set_scan_phase, ScanSessionGuard};
use crate::safety::{
    is_reparse_or_symlink, normalize_path_buf, normalize_path_string, resolve_clean_path,
    user_home_dir,
};
use crate::whitelist::is_path_protected;
use jwalk::WalkDirGeneric;
use rayon::prelude::*;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use sysinfo::{DiskKind, Disks, System};
use walkdir::WalkDir;

struct HostStaticInfo {
    os_name: String,
    os_version: String,
    host_name: String,
    cpu_brand: String,
}

static HOST_STATIC: OnceLock<HostStaticInfo> = OnceLock::new();
static LIVE_SYS: OnceLock<Mutex<(System, Instant)>> = OnceLock::new();

fn days_since_modified(modified: Option<SystemTime>) -> u64 {
    let Some(mtime) = modified else { return 0 };
    SystemTime::now()
        .duration_since(mtime)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

fn join_parts(base: &Path, parts: &[&str]) -> PathBuf {
    let mut p = base.to_path_buf();
    for seg in parts {
        p.push(seg);
    }
    normalize_path_buf(&p)
}

#[inline]
fn is_skipped_system_dir_name(name: &str) -> bool {
    matches!(
        name,
        "$Recycle.Bin"
            | "System Volume Information"
            | "Documents and Settings"
            | "proc"
            | "sys"
            | "dev"
            | "run"
    )
}

/// Fast, junction-safe, cancellable sequential directory stat calculator.
/// Safe inside Rayon `par_iter()` with batched atomic progress reporting.
pub fn compute_dir_stats(path: &Path) -> (u64, u64, Option<SystemTime>) {
    let root_clean = normalize_path_buf(path);
    let mut total_bytes = 0u64;
    let mut file_count = 0u64;
    let mut batch_files = 0u64;
    let mut batch_bytes = 0u64;
    let mut latest_mod: Option<SystemTime> = fs::symlink_metadata(&root_clean)
        .ok()
        .and_then(|m| m.modified().ok());

    let walker = WalkDir::new(&root_clean)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if is_scan_cancelled() {
                return false;
            }
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if is_skipped_system_dir_name(name.as_ref()) {
                return false;
            }
            if entry.file_type().is_symlink() {
                return false;
            }
            if entry.file_type().is_dir() {
                if let Ok(meta) = entry.metadata() {
                    if is_reparse_or_symlink(&meta) {
                        return false;
                    }
                }
            }
            true
        });

    for entry in walker.flatten() {
        if (file_count & 0xFF) == 0 && is_scan_cancelled() {
            break;
        }
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                let len = meta.len();
                total_bytes = total_bytes.saturating_add(len);
                file_count = file_count.saturating_add(1);
                batch_files += 1;
                batch_bytes = batch_bytes.saturating_add(len);

                if batch_files >= 256 {
                    add_scanned_batch(batch_files, batch_bytes, None);
                    batch_files = 0;
                    batch_bytes = 0;
                }

                if (file_count & 0x3F) == 1 {
                    if let Ok(m) = meta.modified() {
                        latest_mod = Some(match latest_mod {
                            Some(prev) if prev > m => prev,
                            _ => m,
                        });
                    }
                }
            }
        }
    }

    if batch_files > 0 {
        add_scanned_batch(batch_files, batch_bytes, None);
    }

    (total_bytes, file_count, latest_mod)
}

/// Work-stealing 2-level parallel directory sizer. Splits huge top-level folders
/// (like `C:\Users` or `node_modules`) across all Rayon CPU cores without `jwalk`
/// channel deadlocks.
pub fn compute_dir_stats_parallel(path: &Path) -> (u64, u64, Option<SystemTime>) {
    if is_scan_cancelled() {
        return (0, 0, None);
    }
    let root_clean = normalize_path_buf(path);
    let Ok(rd) = fs::read_dir(&root_clean) else {
        return (0, 0, None);
    };

    let mut direct_bytes = 0u64;
    let mut direct_files = 0u64;
    let mut latest_mod: Option<SystemTime> = fs::symlink_metadata(&root_clean)
        .ok()
        .and_then(|m| m.modified().ok());
    let mut subdirs: Vec<PathBuf> = Vec::new();

    for entry in rd.flatten() {
        if is_scan_cancelled() {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if is_skipped_system_dir_name(&name) {
            continue;
        }
        let p = entry.path();
        let Ok(meta) = fs::symlink_metadata(&p) else {
            continue;
        };
        if is_reparse_or_symlink(&meta) {
            continue;
        }
        if meta.is_dir() {
            subdirs.push(p);
        } else if meta.is_file() {
            direct_bytes = direct_bytes.saturating_add(meta.len());
            direct_files = direct_files.saturating_add(1);
            if let Ok(m) = meta.modified() {
                latest_mod = Some(match latest_mod {
                    Some(prev) if prev > m => prev,
                    _ => m,
                });
            }
        }
    }

    if direct_files > 0 {
        add_scanned_batch(direct_files, direct_bytes, Some(&root_clean.to_string_lossy()));
    }

    let sub_results: Vec<(u64, u64, Option<SystemTime>)> = subdirs
        .par_iter()
        .map(|sub| compute_dir_stats(sub))
        .collect();

    for (b, c, m) in sub_results {
        direct_bytes = direct_bytes.saturating_add(b);
        direct_files = direct_files.saturating_add(c);
        if let Some(mt) = m {
            latest_mod = Some(match latest_mod {
                Some(prev) if prev > mt => prev,
                _ => mt,
            });
        }
    }

    (direct_bytes, direct_files, latest_mod)
}

pub fn collect_system_overview() -> SystemOverview {
    let sys_lock = LIVE_SYS.get_or_init(|| {
        let mut s = System::new();
        s.refresh_memory();
        s.refresh_cpu_all();
        std::thread::sleep(Duration::from_millis(215));
        s.refresh_cpu_usage();
        Mutex::new((s, Instant::now()))
    });

    let (
        total_mem,
        used_mem,
        mem_pct,
        swap_total,
        swap_used,
        cpu_cores,
        cpu_usage_percent,
        first_brand,
    ) = if let Ok(mut guard) = sys_lock.lock() {
        let (ref mut sys, ref mut last_cpu_tick) = *guard;
        sys.refresh_memory();
        if last_cpu_tick.elapsed() >= Duration::from_millis(210) {
            sys.refresh_cpu_usage();
            *last_cpu_tick = Instant::now();
        }

        let t_mem = sys.total_memory();
        let a_mem = sys.available_memory().min(t_mem);
        let u_mem = if a_mem > 0 {
            t_mem.saturating_sub(a_mem)
        } else {
            sys.used_memory().min(t_mem)
        };
        let m_pct = if t_mem > 0 {
            ((u_mem as f64 / t_mem as f64) * 1000.0).round() / 10.0
        } else {
            0.0
        };

        let cores = sys.cpus().len().max(1);
        let cpu_pct = if !sys.cpus().is_empty() {
            let avg: f32 =
                sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / (sys.cpus().len() as f32);
            ((avg as f64) * 10.0).round() / 10.0
        } else {
            0.0
        };
        let brand = sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_string())
            .filter(|b| !b.is_empty())
            .unwrap_or_else(|| "Multi-Core Processor".to_string());

        (
            t_mem,
            u_mem,
            m_pct,
            sys.total_swap(),
            sys.used_swap(),
            cores,
            cpu_pct,
            brand,
        )
    } else {
        (1, 0, 0.0, 0, 0, 1, 0.0, "Multi-Core Processor".to_string())
    };

    let host_meta = HOST_STATIC.get_or_init(|| HostStaticInfo {
        os_name: System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
        os_version: System::os_version().unwrap_or_default(),
        host_name: System::host_name().unwrap_or_else(|| "onyx-workstation".to_string()),
        cpu_brand: first_brand,
    });

    let disks_raw = Disks::new_with_refreshed_list();
    let mut seen_mounts = HashSet::new();
    let mut seen_devices = HashSet::new();
    let mut disks = Vec::new();

    for (idx, d) in disks_raw.iter().enumerate() {
        let total = d.total_space();
        if total == 0 {
            continue;
        }
        let mount = normalize_path_string(d.mount_point());
        let fs_name = d.file_system().to_string_lossy().to_string();

        let is_root = mount == "/" || mount.ends_with(":\\") || mount.ends_with(":/");
        if !is_root {
            if fs_name.eq_ignore_ascii_case("tmpfs")
                || fs_name.eq_ignore_ascii_case("devtmpfs")
                || fs_name.eq_ignore_ascii_case("squashfs")
                || fs_name.eq_ignore_ascii_case("proc")
                || fs_name.eq_ignore_ascii_case("sysfs")
                || fs_name.eq_ignore_ascii_case("cgroup2")
                || fs_name.eq_ignore_ascii_case("nsfs")
                || fs_name.eq_ignore_ascii_case("efivarfs")
            {
                continue;
            }
            if mount.starts_with("/snap/")
                || mount.starts_with("/run/")
                || mount.starts_with("/proc")
                || mount.starts_with("/sys")
                || mount.starts_with("/dev")
                || mount.starts_with("/boot/efi")
            {
                continue;
            }
        }

        if !seen_mounts.insert(mount.clone()) {
            continue;
        }

        let dev_key = format!("{}:{}", d.name().to_string_lossy(), total);
        if !is_root && !seen_devices.insert(dev_key.clone()) {
            continue;
        }
        seen_devices.insert(dev_key);

        let avail = d.available_space().min(total);
        let used = total.saturating_sub(avail);
        let pct = ((used as f64 / total as f64) * 1000.0).round() / 10.0;

        let raw_name = d.name().to_string_lossy().trim().to_string();
        let display_name = if raw_name.is_empty() {
            if mount == "/" {
                "System Root".to_string()
            } else if mount.eq_ignore_ascii_case("C:\\") {
                "System Drive".to_string()
            } else if d.is_removable() {
                "Removable Volume".to_string()
            } else if mount.ends_with(":\\") {
                "Local Disk".to_string()
            } else {
                mount.clone()
            }
        } else {
            raw_name.clone()
        };

        let is_nvme = raw_name.to_ascii_lowercase().contains("nvme");
        let kind_label = match d.kind() {
            DiskKind::SSD => {
                if is_nvme {
                    "NVMe SSD".to_string()
                } else {
                    "Solid State (SSD)".to_string()
                }
            }
            DiskKind::HDD => "Hard Disk (HDD)".to_string(),
            DiskKind::Unknown(_) => {
                if is_nvme {
                    "NVMe SSD".to_string()
                } else {
                    "High-Speed Volume".to_string()
                }
            }
        };

        disks.push(DiskTelemetry {
            id: format!("disk-{}-{}", idx, mount),
            name: display_name,
            mount_point: mount,
            file_system: if fs_name.is_empty() {
                "Native FS".to_string()
            } else {
                fs_name.to_uppercase()
            },
            kind_label,
            total_bytes: total,
            available_bytes: avail,
            used_bytes: used,
            usage_percent: pct,
            is_removable: d.is_removable(),
        });
    }

    disks.sort_by(|a, b| {
        let a_pri = a.mount_point == "/" || a.mount_point.eq_ignore_ascii_case("C:\\");
        let b_pri = b.mount_point == "/" || b.mount_point.eq_ignore_ascii_case("C:\\");
        b_pri
            .cmp(&a_pri)
            .then_with(|| b.total_bytes.cmp(&a.total_bytes))
    });

    SystemOverview {
        os_name: host_meta.os_name.clone(),
        os_version: host_meta.os_version.clone(),
        host_name: host_meta.host_name.clone(),
        cpu_brand: host_meta.cpu_brand.clone(),
        cpu_cores,
        cpu_usage_percent,
        uptime_seconds: System::uptime(),
        home_dir: user_home_dir()
            .map(|p| normalize_path_string(&p))
            .unwrap_or_else(|| "/".to_string()),
        disks,
        memory: MemoryTelemetry {
            total_bytes: total_mem,
            used_bytes: used_mem,
            available_bytes: total_mem.saturating_sub(used_mem),
            usage_percent: mem_pct,
            swap_total_bytes: swap_total,
            swap_used_bytes: swap_used,
        },
    }
}

#[derive(Clone)]
struct RawDevMatch {
    path: PathBuf,
    category: &'static str,
    ecosystem: &'static str,
}

fn classify_dev_dir(path: &Path, file_name: &str) -> Option<(&'static str, &'static str)> {
    match file_name {
        "node_modules" => Some(("node_modules", "Node.js / npm / pnpm")),
        "target" => {
            if let Some(parent) = path.parent() {
                if parent.join("Cargo.toml").exists() {
                    return Some(("rust_target", "Rust / Cargo"));
                }
            }
            None
        }
        ".venv" | "venv" | "__pycache__" | ".pytest_cache" | ".mypy_cache" | ".ruff_cache" => {
            Some(("python_venv", "Python Virtualenv & Cache"))
        }
        ".gradle" => Some(("gradle_pods", "Gradle Build Cache")),
        "build" => {
            if let Some(parent) = path.parent() {
                if parent.join("build.gradle").exists() || parent.join("build.gradle.kts").exists()
                {
                    return Some(("gradle_pods", "Gradle Build Output"));
                }
            }
            None
        }
        "Pods" => {
            if let Some(parent) = path.parent() {
                if parent.join("Podfile").exists() {
                    return Some(("gradle_pods", "CocoaPods Dependencies"));
                }
            }
            None
        }
        "DerivedData" => Some(("gradle_pods", "Xcode DerivedData")),
        ".next" | ".nuxt" | ".turbo" | ".parcel-cache" | ".svelte-kit" => {
            Some(("web_cache", "Frontend Bundler Cache"))
        }
        "_CommonRedist" | "DirectXRedist" => {
            Some(("game_redist", "Game Redistributables (DirectX / VC++)"))
        }
        _ => None,
    }
}

pub fn scan_dev_junk(custom_roots: Option<Vec<String>>) -> DevJunkScanReport {
    let _guard = ScanSessionGuard::start("dev_junk");
    let started = Instant::now();

    let roots: Vec<PathBuf> = match custom_roots {
        Some(list) if !list.is_empty() => list
            .into_iter()
            .map(|s| resolve_clean_path(Path::new(&s)))
            .filter(|p| p.exists())
            .collect(),
        _ => {
            let mut r = Vec::new();
            if let Some(home) = user_home_dir() {
                if home.exists() {
                    r.push(home);
                }
            }
            r
        }
    };

    let discovered: Arc<Mutex<Vec<RawDevMatch>>> = Arc::new(Mutex::new(Vec::new()));

    for root in &roots {
        if is_scan_cancelled() {
            break;
        }
        set_scan_phase("dev_junk", &root.to_string_lossy());
        let found_ref = Arc::clone(&discovered);

        let walker = WalkDirGeneric::<((), ())>::new(root)
            .skip_hidden(false)
            .follow_links(false)
            .max_depth(9)
            .process_read_dir(move |_depth, dir_path, _state, children| {
                if is_scan_cancelled() {
                    children.iter_mut().for_each(|e| {
                        if let Ok(ent) = e {
                            ent.read_children_path = None;
                        }
                    });
                    return;
                }

                // Respect .onyxignore in parent workspace immediately
                if dir_path.join(".onyxignore").exists() {
                    children.iter_mut().for_each(|e| {
                        if let Ok(ent) = e {
                            ent.read_children_path = None;
                        }
                    });
                    return;
                }

                let mut local_found = Vec::new();
                children.iter_mut().for_each(|entry_res| {
                    if let Ok(entry) = entry_res {
                        if !entry.file_type.is_dir() {
                            return;
                        }
                        if entry.file_type.is_symlink() {
                            entry.read_children_path = None;
                            return;
                        }

                        // Zero-allocation name check BEFORE calling entry.metadata()
                        let name_cow = entry.file_name.to_string_lossy();
                        let name = name_cow.as_ref();
                        if matches!(
                            name,
                            ".git"
                                | ".hg"
                                | ".svn"
                                | "AppData"
                                | "Application Data"
                                | "Documents and Settings"
                                | "Library"
                                | ".Trash"
                                | "Trash"
                                | "$Recycle.Bin"
                                | "System Volume Information"
                                | "Windows"
                                | "Program Files"
                                | "Program Files (x86)"
                                | "ProgramData"
                                | "OneDrive"
                                | ".cargo"
                                | ".rustup"
                                | ".local"
                                | ".npm"
                                | ".cache"
                        ) {
                            entry.read_children_path = None;
                            return;
                        }

                        if let Ok(meta) = entry.metadata() {
                            if is_reparse_or_symlink(&meta) {
                                entry.read_children_path = None;
                                return;
                            }
                        }

                        let candidate_path = normalize_path_buf(&entry.path());
                        if let Some((cat, eco)) = classify_dev_dir(&candidate_path, name) {
                            entry.read_children_path = None;
                            local_found.push(RawDevMatch {
                                path: candidate_path,
                                category: cat,
                                ecosystem: eco,
                            });
                        }
                    }
                });

                if !local_found.is_empty() {
                    if let Ok(mut guard) = found_ref.lock() {
                        guard.extend(local_found);
                    }
                }
            });

        for _ in walker {
            if is_scan_cancelled() {
                break;
            }
        }
    }

    if let Some(home) = user_home_dir() {
        let docker_candidates = [
            join_parts(&home, &[".docker", "buildx"]),
            join_parts(&home, &[".local", "share", "docker", "buildkit"]),
        ];
        if let Ok(mut guard) = discovered.lock() {
            for dc in docker_candidates {
                if dc.exists() && dc.is_dir() {
                    guard.push(RawDevMatch {
                        path: dc,
                        category: "docker_cache",
                        ecosystem: "Docker Buildx Cache",
                    });
                }
            }
        }
    }

    let raw_matches = discovered.lock().map(|g| g.clone()).unwrap_or_default();

    let mut unique_seen = HashSet::new();
    let deduped: Vec<RawDevMatch> = raw_matches
        .into_iter()
        .filter(|m| unique_seen.insert(m.path.clone()))
        .collect();

    let mut items: Vec<DevJunkItem> = deduped
        .par_iter()
        .filter_map(|m| {
            if is_scan_cancelled() {
                return None;
            }
            let (size_bytes, file_count, mtime) = compute_dir_stats_parallel(&m.path);
            if size_bytes < 32 * 1024 {
                return None;
            }
            let project_name = m
                .path
                .parent()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Workspace".to_string());
            let folder_name = m
                .path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let clean_str = normalize_path_string(&m.path);
            let protected = is_path_protected(&m.path);

            Some(DevJunkItem {
                id: format!("dev-{}", clean_str),
                category: m.category.to_string(),
                ecosystem: m.ecosystem.to_string(),
                project_name: format!("{} / {}", project_name, folder_name),
                path: clean_str,
                size_bytes,
                file_count,
                modified_days_ago: days_since_modified(mtime),
                is_protected: protected,
            })
        })
        .collect();

    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let total_bytes = items
        .iter()
        .filter(|i| !i.is_protected)
        .map(|i| i.size_bytes)
        .sum();

    DevJunkScanReport {
        items,
        total_bytes,
        scanned_roots: roots
            .into_iter()
            .map(|p| normalize_path_string(&p))
            .collect(),
        duration_ms: started.elapsed().as_millis(),
    }
}

struct CacheSpec {
    category: &'static str,
    title: &'static str,
    subtitle: &'static str,
    path: PathBuf,
    clean_contents_only: bool,
}

pub fn scan_system_cache() -> SystemCacheReport {
    let _guard = ScanSessionGuard::start("system_cache");
    let started = Instant::now();
    let mut specs: Vec<CacheSpec> = Vec::new();

    // 1. OS Temp directory
    let temp_dir = normalize_path_buf(&std::env::temp_dir());
    if temp_dir.exists() {
        specs.push(CacheSpec {
            category: "os_temp",
            title: "OS Temporary Files",
            subtitle: "System & application transient scratch files",
            path: temp_dir,
            clean_contents_only: true,
        });
    }

    if let Some(home) = user_home_dir() {
        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .map(|p| normalize_path_buf(&PathBuf::from(p)))
            .unwrap_or_else(|| join_parts(&home, &["AppData", "Local"]));
        let roaming_app_data = std::env::var_os("APPDATA")
            .map(|p| normalize_path_buf(&PathBuf::from(p)))
            .unwrap_or_else(|| join_parts(&home, &["AppData", "Roaming"]));

        // 2. GPU & Shader Caches (DirectX, NVIDIA, AMD, Mesa)
        let gpu_dirs = [
            (
                "DirectX Shader Cache",
                "Compiled Direct3D 11/12 GPU shader bytecode",
                join_parts(&local_app_data, &["D3DSCache"]),
            ),
            (
                "NVIDIA DXCache",
                "Compiled NVIDIA DirectX shader pipeline cache",
                join_parts(&local_app_data, &["NVIDIA", "DXCache"]),
            ),
            (
                "NVIDIA GLCache",
                "Compiled NVIDIA OpenGL & Vulkan shader cache",
                join_parts(&local_app_data, &["NVIDIA", "GLCache"]),
            ),
            (
                "NVIDIA ComputeCache",
                "CUDA / OptiX compiled compute kernels",
                join_parts(&roaming_app_data, &["NVIDIA", "ComputeCache"]),
            ),
            (
                "AMD DirectX Shader Cache",
                "Radeon Adrenalin DirectX shader cache",
                join_parts(&local_app_data, &["AMD", "DxCache"]),
            ),
            (
                "AMD Vulkan Shader Cache",
                "Radeon Vulkan pipeline shader cache",
                join_parts(&local_app_data, &["AMD", "VkCache"]),
            ),
            (
                "Mesa GPU Shader Cache",
                "Linux OpenGL / Vulkan RADV/Iris shader cache",
                join_parts(&home, &[".cache", "mesa_shader_cache"]),
            ),
            (
                "Mesa Shader DB Cache",
                "Single-file Mesa shader pipeline cache",
                join_parts(&home, &[".cache", "mesa_shader_cache_db"]),
            ),
        ];

        for (title, sub, p) in gpu_dirs {
            if p.exists() {
                specs.push(CacheSpec {
                    category: "gpu_shader",
                    title,
                    subtitle: sub,
                    path: p,
                    clean_contents_only: true,
                });
            }
        }

        // 3. Game Launcher Caches (Steam, Epic Games, Battle.net, Riot)
        let game_dirs = [
            (
                "Steam HTTP Web Cache",
                "Steam store & community embedded browser cache",
                join_parts(&local_app_data, &["Steam", "htmlcache", "Cache"]),
            ),
            (
                "Steam Depot Download Cache",
                "Temporary staged game update chunks",
                PathBuf::from(r"C:\Program Files (x86)\Steam\depotcache"),
            ),
            (
                "Steam App HTTP Cache",
                "Cached Steam client CDN metadata",
                PathBuf::from(r"C:\Program Files (x86)\Steam\appcache\httpcache"),
            ),
            (
                "Steam Linux Shader Cache",
                "Pre-cached Vulkan/Proton fossilize shaders",
                join_parts(&home, &[".local", "share", "Steam", "steamapps", "shadercache"]),
            ),
            (
                "Epic Games Launcher WebCache",
                "Epic store Chromium web & image cache",
                join_parts(
                    &local_app_data,
                    &["EpicGamesLauncher", "Saved", "webcache_4430"],
                ),
            ),
            (
                "Epic Games Launcher Cache",
                "Epic launcher web assets scratchpad",
                join_parts(&local_app_data, &["EpicGamesLauncher", "Saved", "webcache"]),
            ),
            (
                "Battle.net Client Cache",
                "Blizzard Battle.net launcher asset cache",
                PathBuf::from(r"C:\ProgramData\Blizzard Entertainment\Battle.net\Cache"),
            ),
            (
                "Riot Client Logs",
                "Riot Games launcher diagnostic logs",
                join_parts(&local_app_data, &["Riot Games", "Riot Client", "Logs"]),
            ),
        ];

        for (title, sub, p) in game_dirs {
            if p.exists() {
                specs.push(CacheSpec {
                    category: "game_cache",
                    title,
                    subtitle: sub,
                    path: p,
                    clean_contents_only: true,
                });
            }
        }

        // 4. Messenger, Media & Workspace App Caches (strictly cache-only, sessions untouched!)
        let app_cache_dirs = [
            (
                "Telegram Desktop Media Cache",
                "Cached photos/videos (chats & login stay intact)",
                join_parts(
                    &roaming_app_data,
                    &["Telegram Desktop", "tdata", "user_data", "cache"],
                ),
            ),
            (
                "Telegram Desktop Stream Cache",
                "Cached streamed media chunks (login stays intact)",
                join_parts(
                    &roaming_app_data,
                    &["Telegram Desktop", "tdata", "user_data", "media_cache"],
                ),
            ),
            (
                "Telegram Linux Media Cache",
                "Cached media files (~/.local/share/TelegramDesktop)",
                join_parts(
                    &home,
                    &[
                        ".local",
                        "share",
                        "TelegramDesktop",
                        "tdata",
                        "user_data",
                        "cache",
                    ],
                ),
            ),
            (
                "Discord Media & HTTP Cache",
                "Cached server images, emojis & embedded video",
                join_parts(&roaming_app_data, &["discord", "Cache", "Cache_Data"]),
            ),
            (
                "Discord Legacy Cache",
                "Cached Discord client assets",
                join_parts(&roaming_app_data, &["discord", "Cache"]),
            ),
            (
                "Discord GPU & Code Cache",
                "Compiled Discord V8 bytecode cache",
                join_parts(&roaming_app_data, &["discord", "Code Cache"]),
            ),
            (
                "Discord Linux Cache",
                "Cached Discord assets (~/.config/discord/Cache)",
                join_parts(&home, &[".config", "discord", "Cache"]),
            ),
            (
                "Spotify Audio Storage Cache",
                "Cached offline-streamed encrypted audio chunks",
                join_parts(&local_app_data, &["Spotify", "Storage"]),
            ),
            (
                "Spotify Linux Audio Cache",
                "Cached audio chunks (~/.cache/spotify/Data)",
                join_parts(&home, &[".cache", "spotify", "Data"]),
            ),
            (
                "Slack Workspace Cache",
                "Cached Slack workspace attachments & assets",
                join_parts(&roaming_app_data, &["Slack", "Cache"]),
            ),
            (
                "VS Code Cached Data",
                "Old VS Code V8 bytecode & extension VSIX archives",
                join_parts(&roaming_app_data, &["Code", "CachedData"]),
            ),
            (
                "VS Code Extension Archives",
                "Downloaded VSIX installer packages",
                join_parts(&roaming_app_data, &["Code", "CachedExtensionVSIXs"]),
            ),
            (
                "Adobe Common Media Cache",
                "Premiere Pro / After Effects peak & conformed media cache",
                join_parts(&roaming_app_data, &["Adobe", "Common", "Media Cache Files"]),
            ),
        ];

        for (title, sub, p) in app_cache_dirs {
            if p.exists() {
                specs.push(CacheSpec {
                    category: "app_cache",
                    title,
                    subtitle: sub,
                    path: p,
                    clean_contents_only: true,
                });
            }
        }

        // 5. Web Browser Caches
        let browser_dirs = [
            (
                "Chrome Browser Cache",
                "Cached web assets, media & V8 bytecode",
                join_parts(
                    &local_app_data,
                    &["Google", "Chrome", "User Data", "Default", "Cache"],
                ),
            ),
            (
                "Chrome Code Cache",
                "Compiled JS & WebAssembly bytecode cache",
                join_parts(
                    &local_app_data,
                    &["Google", "Chrome", "User Data", "Default", "Code Cache"],
                ),
            ),
            (
                "Microsoft Edge Cache",
                "Chromium web cache & service worker storage",
                join_parts(
                    &local_app_data,
                    &["Microsoft", "Edge", "User Data", "Default", "Cache"],
                ),
            ),
            (
                "Brave Browser Cache",
                "Cached scripts, images & media chunks",
                join_parts(
                    &local_app_data,
                    &[
                        "BraveSoftware",
                        "Brave-Browser",
                        "User Data",
                        "Default",
                        "Cache",
                    ],
                ),
            ),
            (
                "Opera GX / Opera Cache",
                "Opera browser HTTP & media cache",
                join_parts(
                    &local_app_data,
                    &["Opera Software", "Opera GX Stable", "Cache"],
                ),
            ),
            (
                "Yandex Browser Cache",
                "Cached web assets & media streams",
                join_parts(
                    &local_app_data,
                    &["Yandex", "YandexBrowser", "User Data", "Default", "Cache"],
                ),
            ),
            (
                "Chrome Browser Cache",
                "Cached web assets & media (~/.cache)",
                join_parts(&home, &[".cache", "google-chrome"]),
            ),
            (
                "Chromium Cache",
                "Cached web assets & shader cache",
                join_parts(&home, &[".cache", "chromium"]),
            ),
            (
                "Firefox Web Cache",
                "Mozilla disk cache & offline storage",
                join_parts(&home, &[".cache", "mozilla", "firefox"]),
            ),
            (
                "Safari & WebKit Cache",
                "macOS WebKit network & render caches",
                join_parts(&home, &["Library", "Caches", "Google", "Chrome"]),
            ),
        ];

        for (title, sub, p) in browser_dirs {
            if p.exists() {
                specs.push(CacheSpec {
                    category: "browser_cache",
                    title,
                    subtitle: sub,
                    path: p,
                    clean_contents_only: true,
                });
            }
        }

        let win_ff_profiles = join_parts(&local_app_data, &["Mozilla", "Firefox", "Profiles"]);
        if let Ok(rd) = fs::read_dir(&win_ff_profiles) {
            for entry in rd.flatten() {
                let c2 = join_parts(&entry.path(), &["cache2"]);
                if c2.exists() && c2.is_dir() {
                    specs.push(CacheSpec {
                        category: "browser_cache",
                        title: "Firefox Profile Cache",
                        subtitle: "Mozilla HTTP & media cache2 directory",
                        path: c2,
                        clean_contents_only: true,
                    });
                }
            }
        }

        // 6. Developer Package Caches
        let pkg_dirs = [
            (
                "npm Package Cache",
                "Cached tarballs & HTTP registry metadata",
                join_parts(&home, &[".npm", "_cacache"]),
            ),
            (
                "npm Package Cache",
                "Windows npm tarball & metadata cache",
                join_parts(&local_app_data, &["npm-cache"]),
            ),
            (
                "pnpm Store Cache",
                "Cached pnpm metadata & dlx packages",
                join_parts(&local_app_data, &["pnpm-cache"]),
            ),
            (
                "Yarn Package Cache",
                "Cached JS package tarballs",
                join_parts(&local_app_data, &["Yarn", "Cache"]),
            ),
            (
                "Python pip Cache",
                "Downloaded wheel archives & HTTP cache",
                join_parts(&home, &[".cache", "pip"]),
            ),
            (
                "Python pip Cache",
                "Windows pip wheel & HTTP cache",
                join_parts(&local_app_data, &["pip", "Cache"]),
            ),
            (
                "NuGet HTTP Cache",
                ".NET NuGet downloaded package cache",
                join_parts(&local_app_data, &["NuGet", "v3-cache"]),
            ),
            (
                "Cargo Crate Archives",
                "Downloaded .crate tarballs in registry cache",
                join_parts(&home, &[".cargo", "registry", "cache"]),
            ),
            (
                "Go Compiler Build Cache",
                "Cached Go build artifacts",
                join_parts(&local_app_data, &["go-build"]),
            ),
            (
                "Yarn Cache",
                "Cached JS package tarballs",
                join_parts(&home, &[".cache", "yarn"]),
            ),
        ];

        for (title, sub, p) in pkg_dirs {
            if p.exists() {
                specs.push(CacheSpec {
                    category: "pkg_cache",
                    title,
                    subtitle: sub,
                    path: p,
                    clean_contents_only: true,
                });
            }
        }

        // 7. System & Crash Logs
        let log_dirs = [
            (
                "Application Crash Dumps",
                "Windows user-mode minidumps & crash reports",
                join_parts(&local_app_data, &["CrashDumps"]),
            ),
            (
                "Thumbnail & Icon Cache",
                "Cached image & document preview thumbnails",
                join_parts(&home, &[".cache", "thumbnails"]),
            ),
            (
                "macOS User Logs",
                "Diagnostic & application log archives",
                join_parts(&home, &["Library", "Logs"]),
            ),
            (
                "Desktop Session Logs",
                "Xorg / Wayland user session logs",
                join_parts(&home, &[".local", "share", "xorg"]),
            ),
        ];

        for (title, sub, p) in log_dirs {
            if p.exists() {
                specs.push(CacheSpec {
                    category: "system_logs",
                    title,
                    subtitle: sub,
                    path: p,
                    clean_contents_only: true,
                });
            }
        }
    }

    let mut seen = HashSet::new();
    let unique_specs: Vec<CacheSpec> = specs
        .into_iter()
        .filter(|s| seen.insert(s.path.clone()))
        .collect();

    let mut items: Vec<SystemCacheItem> = unique_specs
        .par_iter()
        .filter_map(|spec| {
            if is_scan_cancelled() {
                return None;
            }
            let (size_bytes, file_count, _) = compute_dir_stats(&spec.path);
            if size_bytes == 0 && file_count == 0 {
                return None;
            }
            let clean_str = normalize_path_string(&spec.path);
            let protected = is_path_protected(&spec.path);
            Some(SystemCacheItem {
                id: format!("cache-{}", clean_str),
                category: spec.category.to_string(),
                title: spec.title.to_string(),
                subtitle: spec.subtitle.to_string(),
                path: clean_str,
                clean_contents_only: spec.clean_contents_only,
                size_bytes,
                file_count,
                safe_to_purge: !protected,
                is_protected: protected,
            })
        })
        .collect();

    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let total_bytes = items
        .iter()
        .filter(|i| !i.is_protected)
        .map(|i| i.size_bytes)
        .sum();

    SystemCacheReport {
        items,
        total_bytes,
        duration_ms: started.elapsed().as_millis(),
    }
}

fn classify_large_file(ext_lower: &str) -> &'static str {
    match ext_lower {
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "m4v" | "flv" | "wmv" | "ts" | "m2ts"
        | "prores" => "video",
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "zst" | "lz4" => "archive",
        "exe" | "msi" | "iso" | "dmg" | "pkg" | "deb" | "rpm" | "appimage" | "img" => "installer",
        _ => "disk_data",
    }
}

fn build_virtual_disk_hint(ext_lower: &str, clean_path: &str) -> (bool, Option<String>) {
    match ext_lower {
        "vhdx" | "vhd" => (
            true,
            Some(format!(
                "wsl --shutdown ; Optimize-VHD -Path \"{}\" -Mode Full",
                clean_path
            )),
        ),
        "qcow2" => (
            true,
            Some(format!(
                "qemu-img convert -O qcow2 -c \"{}\" \"{}.compact\"",
                clean_path, clean_path
            )),
        ),
        "vdi" => (
            true,
            Some(format!("VBoxManage modifymedium disk \"{}\" --compact", clean_path)),
        ),
        "vmdk" => (
            true,
            Some(format!("vmware-vdiskmanager -k \"{}\"", clean_path)),
        ),
        _ => (false, None),
    }
}

/// Wrapper for min-heap top-K collection of largest files (`BinaryHeap` keeps smallest at top via reversed Ord).
#[derive(Clone)]
struct MinSizedFile(LargeFileItem);

impl PartialEq for MinSizedFile {
    fn eq(&self, other: &Self) -> bool {
        self.0.size_bytes == other.0.size_bytes && self.0.path == other.0.path
    }
}
impl Eq for MinSizedFile {}
impl PartialOrd for MinSizedFile {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for MinSizedFile {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .0
            .size_bytes
            .cmp(&self.0.size_bytes)
            .then_with(|| self.0.path.cmp(&other.0.path))
    }
}

const TOP_LARGE_FILES_CAP: usize = 160;

fn push_top_k(heap: &mut BinaryHeap<MinSizedFile>, item: LargeFileItem) {
    if heap.len() < TOP_LARGE_FILES_CAP {
        heap.push(MinSizedFile(item));
    } else if let Some(smallest) = heap.peek() {
        if item.size_bytes > smallest.0.size_bytes {
            heap.pop();
            heap.push(MinSizedFile(item));
        }
    }
}

/// Probes known WSL2 & Docker Desktop `.vhdx` locations on Windows even inside `%LOCALAPPDATA%`.
fn probe_wsl_and_docker_vhdx(threshold_bytes: u64) -> Vec<LargeFileItem> {
    let mut out = Vec::new();
    let Some(home) = user_home_dir() else {
        return out;
    };
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(|p| normalize_path_buf(&PathBuf::from(p)))
        .unwrap_or_else(|| join_parts(&home, &["AppData", "Local"]));

    let mut direct_files = vec![
        join_parts(&local_app_data, &["Docker", "wsl", "data", "ext4.vhdx"]),
        join_parts(&local_app_data, &["Docker", "wsl", "disk", "docker_data.vhdx"]),
        join_parts(&local_app_data, &["Docker", "wsl", "main", "ext4.vhdx"]),
    ];

    // Check %LOCALAPPDATA%\Packages\*\LocalState\ext4.vhdx and %LOCALAPPDATA%\wsl\*\ext4.vhdx
    for parent in [
        join_parts(&local_app_data, &["Packages"]),
        join_parts(&local_app_data, &["wsl"]),
    ] {
        if let Ok(rd) = fs::read_dir(&parent) {
            for entry in rd.flatten() {
                let p1 = entry.path().join("LocalState").join("ext4.vhdx");
                let p2 = entry.path().join("ext4.vhdx");
                direct_files.push(p1);
                direct_files.push(p2);
            }
        }
    }

    let mut seen = HashSet::new();
    for vf in direct_files {
        let Ok(meta) = fs::symlink_metadata(&vf) else {
            continue;
        };
        if !meta.is_file() || meta.len() < threshold_bytes {
            continue;
        }
        let clean = normalize_path_string(&vf);
        if !seen.insert(clean.clone()) {
            continue;
        }
        let name = vf
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "ext4.vhdx".to_string());
        let parent_dir = vf.parent().map(normalize_path_string).unwrap_or_default();
        let (is_vd, hint) = build_virtual_disk_hint("vhdx", &clean);
        out.push(LargeFileItem {
            id: format!("file-{}", clean),
            name,
            path: clean,
            parent_dir,
            extension: "VHDX".to_string(),
            category: "disk_data".to_string(),
            size_bytes: meta.len(),
            modified_days_ago: days_since_modified(meta.modified().ok()),
            is_virtual_disk: is_vd,
            compact_hint: hint,
            is_protected: is_path_protected(&vf),
        });
    }
    out
}

pub fn scan_large_files(root_path: Option<String>, min_size_mb: Option<u64>) -> LargeFilesReport {
    let _guard = ScanSessionGuard::start("large_files");
    let started = Instant::now();
    let threshold_mb = min_size_mb.unwrap_or(100);
    let threshold_bytes = threshold_mb.saturating_mul(1024 * 1024);

    let scan_root = root_path
        .filter(|s| !s.trim().is_empty())
        .map(|s| resolve_clean_path(Path::new(&s)))
        .filter(|p| p.exists())
        .or_else(user_home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));

    set_scan_phase("large_files", &scan_root.to_string_lossy());

    // Bounded top-K heap + running total byte accumulator (O(K) memory regardless of disk size!)
    let state: Arc<Mutex<(BinaryHeap<MinSizedFile>, u64)>> =
        Arc::new(Mutex::new((BinaryHeap::with_capacity(TOP_LARGE_FILES_CAP + 1), 0)));
    let state_ref = Arc::clone(&state);

    let walker = WalkDirGeneric::<((), ())>::new(&scan_root)
        .skip_hidden(false)
        .follow_links(false)
        .process_read_dir(move |_depth, _dir_path, _state, children| {
            if is_scan_cancelled() {
                children.iter_mut().for_each(|e| {
                    if let Ok(ent) = e {
                        ent.read_children_path = None;
                    }
                });
                return;
            }

            let mut local_batch: Vec<LargeFileItem> = Vec::new();
            let mut local_scanned_files = 0u64;
            let mut local_scanned_bytes = 0u64;

            children.iter_mut().for_each(|entry_res| {
                if let Ok(entry) = entry_res {
                    let name_cow = entry.file_name.to_string_lossy();
                    let name = name_cow.as_ref();

                    if entry.file_type.is_dir() {
                        if entry.file_type.is_symlink() {
                            entry.read_children_path = None;
                            return;
                        }
                        if matches!(
                            name,
                            "proc"
                                | "sys"
                                | "dev"
                                | "run"
                                | "$Recycle.Bin"
                                | "System Volume Information"
                                | "Documents and Settings"
                                | "Windows"
                                | "WinSxS"
                                | ".Trash"
                                | ".git"
                                | "node_modules"
                                | "target"
                                | ".cargo"
                                | ".rustup"
                                | ".npm"
                                | ".cache"
                                | "WebView2Data"
                        ) {
                            entry.read_children_path = None;
                            return;
                        }
                        if let Ok(meta) = entry.metadata() {
                            if is_reparse_or_symlink(&meta) {
                                entry.read_children_path = None;
                            }
                        }
                        return;
                    }

                    if entry.file_type.is_file() {
                        if let Ok(meta) = entry.metadata() {
                            let len = meta.len();
                            local_scanned_files += 1;
                            local_scanned_bytes = local_scanned_bytes.saturating_add(len);

                            if len >= threshold_bytes {
                                let p = normalize_path_buf(&entry.path());
                                let clean_str = normalize_path_string(&p);
                                let ext = p
                                    .extension()
                                    .map(|e| e.to_string_lossy().to_ascii_lowercase())
                                    .unwrap_or_default();
                                let category = classify_large_file(&ext).to_string();
                                let (is_virtual_disk, compact_hint) =
                                    build_virtual_disk_hint(&ext, &clean_str);
                                let parent_dir =
                                    p.parent().map(normalize_path_string).unwrap_or_default();
                                let modified_days_ago = days_since_modified(meta.modified().ok());
                                let protected = is_path_protected(&p);

                                local_batch.push(LargeFileItem {
                                    id: format!("file-{}", clean_str),
                                    name: name.to_string(),
                                    path: clean_str,
                                    parent_dir,
                                    extension: if ext.is_empty() {
                                        "BIN".to_string()
                                    } else {
                                        ext.to_ascii_uppercase()
                                    },
                                    category,
                                    size_bytes: len,
                                    modified_days_ago,
                                    is_virtual_disk,
                                    compact_hint,
                                    is_protected: protected,
                                });
                            }
                        }
                    }
                }
            });

            if local_scanned_files > 0 {
                add_scanned_batch(local_scanned_files, local_scanned_bytes, None);
            }

            if !local_batch.is_empty() {
                if let Ok(mut guard) = state_ref.lock() {
                    for item in local_batch {
                        guard.1 = guard.1.saturating_add(item.size_bytes);
                        push_top_k(&mut guard.0, item);
                    }
                }
            }
        });

    for _ in walker {
        if is_scan_cancelled() {
            break;
        }
    }

    let (mut heap, mut total_bytes) = state
        .lock()
        .map(|mut g| (std::mem::take(&mut g.0), g.1))
        .unwrap_or_default();

    // Merge WSL2 / Docker virtual disks if not already present
    let mut existing_paths: HashSet<String> =
        heap.iter().map(|w| w.0.path.clone()).collect();
    for vd in probe_wsl_and_docker_vhdx(threshold_bytes) {
        if existing_paths.insert(vd.path.clone()) {
            total_bytes = total_bytes.saturating_add(vd.size_bytes);
            push_top_k(&mut heap, vd);
        }
    }

    let mut items: Vec<LargeFileItem> = heap.into_iter().map(|w| w.0).collect();
    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    LargeFilesReport {
        items,
        total_bytes,
        threshold_bytes,
        scanned_root: normalize_path_string(&scan_root),
        duration_ms: started.elapsed().as_millis(),
    }
}

pub fn list_subdirectories(parent_path: Option<String>) -> Result<Vec<DirectoryEntry>, String> {
    let dir = parent_path
        .filter(|s| !s.trim().is_empty())
        .map(|s| resolve_clean_path(Path::new(&s)))
        .filter(|p| p.exists() && p.is_dir())
        .or_else(user_home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));

    let mut entries = Vec::new();
    let rd = fs::read_dir(&dir).map_err(|e| format!("Unable to read {}: {}", dir.display(), e))?;
    for entry in rd.flatten() {
        if let Ok(ft) = entry.file_type() {
            if ft.is_dir() && !ft.is_symlink() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('$')
                    && !matches!(
                        name.as_str(),
                        "System Volume Information" | "Documents and Settings"
                    )
                {
                    entries.push(DirectoryEntry {
                        name,
                        path: normalize_path_string(&entry.path()),
                    });
                }
            }
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}
