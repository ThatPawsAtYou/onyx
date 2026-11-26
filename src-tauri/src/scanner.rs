use crate::models::{
    DevJunkItem, DevJunkScanReport, DirectoryEntry, DiskTelemetry, LargeFileItem, LargeFilesReport,
    MemoryTelemetry, SystemCacheItem, SystemCacheReport, SystemOverview,
};
use crate::safety::{
    is_reparse_or_symlink, normalize_path_buf, normalize_path_string, resolve_clean_path,
    user_home_dir,
};
use jwalk::WalkDirGeneric;
use rayon::prelude::*;
use std::collections::HashSet;
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

/// Fast, lock-free, junction-safe directory size & file count calculator.
/// Safe to invoke inside Rayon `par_iter` without nested pool deadlocks.
pub fn compute_dir_stats(path: &Path) -> (u64, u64, Option<SystemTime>) {
    let root_clean = normalize_path_buf(path);
    let mut total_bytes = 0u64;
    let mut file_count = 0u64;
    let mut latest_mod: Option<SystemTime> =
        fs::symlink_metadata(&root_clean).ok().and_then(|m| m.modified().ok());

    let walker = WalkDir::new(&root_clean)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if matches!(
                name.as_ref(),
                "$Recycle.Bin"
                    | "System Volume Information"
                    | "Documents and Settings"
                    | "proc"
                    | "sys"
                    | "dev"
                    | "run"
            ) {
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
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                total_bytes = total_bytes.saturating_add(meta.len());
                file_count = file_count.saturating_add(1);
                // Sample directory/file modification times lightweightly
                if (file_count & 0x1F) == 1 {
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

    (total_bytes, file_count, latest_mod)
}

pub fn collect_system_overview() -> SystemOverview {
    let sys_lock = LIVE_SYS.get_or_init(|| {
        let mut s = System::new();
        s.refresh_memory();
        s.refresh_cpu_all();
        // Wait > sysinfo::MINIMUM_CPU_UPDATE_INTERVAL (200ms) once on cold start
        std::thread::sleep(Duration::from_millis(215));
        s.refresh_cpu_usage();
        Mutex::new((s, Instant::now()))
    });

    let (total_mem, used_mem, mem_pct, swap_total, swap_used, cpu_cores, cpu_usage_percent, first_brand) =
        if let Ok(mut guard) = sys_lock.lock() {
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
        let fs_lower = fs_name.to_lowercase();

        let is_root = mount == "/" || mount.ends_with(":\\") || mount.ends_with(":/");
        if !is_root {
            if matches!(
                fs_lower.as_str(),
                "tmpfs" | "devtmpfs" | "squashfs" | "proc" | "sysfs" | "cgroup2" | "nsfs" | "efivarfs"
            ) {
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

        let kind_label = match d.kind() {
            DiskKind::SSD => {
                if raw_name.to_lowercase().contains("nvme") {
                    "NVMe SSD".to_string()
                } else {
                    "Solid State (SSD)".to_string()
                }
            }
            DiskKind::HDD => "Hard Disk (HDD)".to_string(),
            DiskKind::Unknown(_) => {
                if raw_name.to_lowercase().contains("nvme") {
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
        let a_pri = a.mount_point == "/" || a.mount_point.to_uppercase().starts_with("C:");
        let b_pri = b.mount_point == "/" || b.mount_point.to_uppercase().starts_with("C:");
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
                if parent.join("build.gradle").exists()
                    || parent.join("build.gradle.kts").exists()
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
        _ => None,
    }
}

pub fn scan_dev_junk(custom_roots: Option<Vec<String>>) -> DevJunkScanReport {
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
        let found_ref = Arc::clone(&discovered);
        let walker = WalkDirGeneric::<((), ())>::new(root)
            .skip_hidden(false)
            .follow_links(false)
            .max_depth(9)
            .process_read_dir(move |_depth, _dir_path, _state, children| {
                let mut local_found = Vec::new();
                children.iter_mut().for_each(|entry_res| {
                    if let Ok(entry) = entry_res {
                        if entry.file_type.is_dir() {
                            if entry.file_type.is_symlink() {
                                entry.read_children_path = None;
                                return;
                            }
                            if let Ok(meta) = entry.metadata() {
                                if is_reparse_or_symlink(&meta) {
                                    entry.read_children_path = None;
                                    return;
                                }
                            }

                            let name = entry.file_name.to_string_lossy().to_string();
                            if matches!(
                                name.as_str(),
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

                            let candidate_path = normalize_path_buf(&entry.path());
                            if let Some((cat, eco)) = classify_dev_dir(&candidate_path, &name) {
                                entry.read_children_path = None;
                                local_found.push(RawDevMatch {
                                    path: candidate_path,
                                    category: cat,
                                    ecosystem: eco,
                                });
                            }
                        }
                    }
                });

                if !local_found.is_empty() {
                    if let Ok(mut guard) = found_ref.lock() {
                        guard.extend(local_found);
                    }
                }
            });

        for _ in walker {}
    }

    if let Some(home) = user_home_dir() {
        let docker_candidates = [
            join_parts(&home, &[".docker", "buildx"]),
            join_parts(&home, &["AppData", "Local", "Docker", "wsl", "data"]),
            join_parts(&home, &[".local", "share", "docker"]),
        ];
        if let Ok(mut guard) = discovered.lock() {
            for dc in docker_candidates {
                if dc.exists() && dc.is_dir() {
                    guard.push(RawDevMatch {
                        path: dc,
                        category: "docker_cache",
                        ecosystem: "Docker Engine & Buildx",
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
            let (size_bytes, file_count, mtime) = compute_dir_stats(&m.path);
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

            Some(DevJunkItem {
                id: format!("dev-{}", clean_str),
                category: m.category.to_string(),
                ecosystem: m.ecosystem.to_string(),
                project_name: format!("{} / {}", project_name, folder_name),
                path: clean_str,
                size_bytes,
                file_count,
                modified_days_ago: days_since_modified(mtime),
            })
        })
        .collect();

    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let total_bytes = items.iter().map(|i| i.size_bytes).sum();

    DevJunkScanReport {
        items,
        total_bytes,
        scanned_roots: roots.into_iter().map(|p| normalize_path_string(&p)).collect(),
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

        // Windows Firefox per-profile cache2 directories
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

        let log_dirs = [
            (
                "Application Crash Dumps",
                "Windows user-mode minidumps & crash reports",
                join_parts(&local_app_data, &["CrashDumps"]),
            ),
            (
                "DirectX Shader Cache",
                "Compiled Direct3D shader bytecode cache",
                join_parts(&local_app_data, &["D3DSCache"]),
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
            let (size_bytes, file_count, _) = compute_dir_stats(&spec.path);
            if size_bytes == 0 && file_count == 0 {
                return None;
            }
            let clean_str = normalize_path_string(&spec.path);
            Some(SystemCacheItem {
                id: format!("cache-{}", clean_str),
                category: spec.category.to_string(),
                title: spec.title.to_string(),
                subtitle: spec.subtitle.to_string(),
                path: clean_str,
                clean_contents_only: spec.clean_contents_only,
                size_bytes,
                file_count,
                safe_to_purge: true,
            })
        })
        .collect();

    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let total_bytes = items.iter().map(|i| i.size_bytes).sum();

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

pub fn scan_large_files(root_path: Option<String>, min_size_mb: Option<u64>) -> LargeFilesReport {
    let started = Instant::now();
    let threshold_mb = min_size_mb.unwrap_or(100);
    let threshold_bytes = threshold_mb.saturating_mul(1024 * 1024);

    let scan_root = root_path
        .filter(|s| !s.trim().is_empty())
        .map(|s| resolve_clean_path(Path::new(&s)))
        .filter(|p| p.exists())
        .or_else(user_home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));

    let found: Arc<Mutex<Vec<LargeFileItem>>> = Arc::new(Mutex::new(Vec::new()));
    let found_ref = Arc::clone(&found);

    let walker = WalkDirGeneric::<((), ())>::new(&scan_root)
        .skip_hidden(false)
        .follow_links(false)
        .process_read_dir(move |_depth, _dir_path, _state, children| {
            let mut local_batch: Vec<LargeFileItem> = Vec::new();

            children.iter_mut().for_each(|entry_res| {
                if let Ok(entry) = entry_res {
                    let name = entry.file_name.to_string_lossy().to_string();
                    if entry.file_type.is_dir() {
                        if entry.file_type.is_symlink() {
                            entry.read_children_path = None;
                            return;
                        }
                        if matches!(
                            name.as_str(),
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
                            if len >= threshold_bytes {
                                let p = normalize_path_buf(&entry.path());
                                let clean_str = normalize_path_string(&p);
                                let ext = p
                                    .extension()
                                    .map(|e| e.to_string_lossy().to_lowercase())
                                    .unwrap_or_default();
                                let category = classify_large_file(&ext).to_string();
                                let parent_dir = p
                                    .parent()
                                    .map(normalize_path_string)
                                    .unwrap_or_default();
                                let modified_days_ago = days_since_modified(meta.modified().ok());

                                local_batch.push(LargeFileItem {
                                    id: format!("file-{}", clean_str),
                                    name,
                                    path: clean_str,
                                    parent_dir,
                                    extension: if ext.is_empty() {
                                        "BIN".to_string()
                                    } else {
                                        ext.to_uppercase()
                                    },
                                    category,
                                    size_bytes: len,
                                    modified_days_ago,
                                });
                            }
                        }
                    }
                }
            });

            if !local_batch.is_empty() {
                if let Ok(mut guard) = found_ref.lock() {
                    guard.extend(local_batch);
                }
            }
        });

    for _ in walker {}

    let mut items = found.lock().map(|g| g.clone()).unwrap_or_default();
    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let total_bytes = items.iter().map(|i| i.size_bytes).sum();
    if items.len() > 150 {
        items.truncate(150);
    }

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
