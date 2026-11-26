use crate::models::{
    DevJunkItem, DevJunkScanReport, DirectoryEntry, DiskTelemetry, LargeFileItem, LargeFilesReport,
    MemoryTelemetry, SystemCacheItem, SystemCacheReport, SystemOverview,
};
use crate::safety::user_home_dir;
use jwalk::WalkDirGeneric;
use rayon::prelude::*;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};
use sysinfo::{DiskKind, Disks, System};
use walkdir::WalkDir;

fn days_since_modified(modified: Option<SystemTime>) -> u64 {
    let Some(mtime) = modified else { return 0 };
    SystemTime::now()
        .duration_since(mtime)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

pub fn compute_dir_stats(path: &Path) -> (u64, u64, Option<SystemTime>) {
    let mut total_bytes = 0u64;
    let mut file_count = 0u64;
    let mut latest_mod: Option<SystemTime> = fs::metadata(path).ok().and_then(|m| m.modified().ok());

    for entry in WalkDir::new(path).follow_links(false).into_iter().flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                total_bytes = total_bytes.saturating_add(meta.len());
                file_count = file_count.saturating_add(1);
                if let Ok(m) = meta.modified() {
                    latest_mod = Some(match latest_mod {
                        Some(prev) if prev > m => prev,
                        _ => m,
                    });
                }
            }
        }
    }
    (total_bytes, file_count, latest_mod)
}

pub fn collect_system_overview() -> SystemOverview {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    std::thread::sleep(std::time::Duration::from_millis(60));
    sys.refresh_cpu_usage();

    let disks_raw = Disks::new_with_refreshed_list();
    let mut seen_mounts = HashSet::new();
    let mut seen_devices = HashSet::new();
    let mut disks = Vec::new();

    for (idx, d) in disks_raw.iter().enumerate() {
        let total = d.total_space();
        if total == 0 {
            continue;
        }
        let mount = d.mount_point().to_string_lossy().to_string();
        let fs_name = d.file_system().to_string_lossy().to_string();
        let fs_lower = fs_name.to_lowercase();

        // Keep "/" always; skip ephemeral pseudo/loop mounts on Linux
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
        if !is_root && !seen_devices.insert(dev_key) {
            continue;
        }
        seen_devices.insert(format!("{}:{}", d.name().to_string_lossy(), total));

        let avail = d.available_space().min(total);
        let used = total.saturating_sub(avail);
        let pct = if total > 0 {
            ((used as f64 / total as f64) * 1000.0).round() / 10.0
        } else {
            0.0
        };

        let raw_name = d.name().to_string_lossy().trim().to_string();
        let display_name = if raw_name.is_empty() {
            if mount == "/" {
                "System Root".to_string()
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

    // Sort primary root / C:\ first
    disks.sort_by(|a, b| {
        let a_pri = a.mount_point == "/" || a.mount_point.to_uppercase().starts_with("C:");
        let b_pri = b.mount_point == "/" || b.mount_point.to_uppercase().starts_with("C:");
        b_pri.cmp(&a_pri).then_with(|| b.total_bytes.cmp(&a.total_bytes))
    });

    let total_mem = sys.total_memory();
    let avail_mem = sys.available_memory().min(total_mem);
    let used_mem = if avail_mem > 0 {
        total_mem.saturating_sub(avail_mem)
    } else {
        sys.used_memory().min(total_mem)
    };
    let mem_pct = if total_mem > 0 {
        ((used_mem as f64 / total_mem as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Multi-Core Processor".to_string());

    let cpu_usage_percent = if !sys.cpus().is_empty() {
        let avg: f32 =
            sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / (sys.cpus().len() as f32);
        ((avg as f64) * 10.0).round() / 10.0
    } else {
        0.0
    };

    SystemOverview {
        os_name: System::name().unwrap_or_else(|| std::env::consts::OS.to_string()),
        os_version: System::os_version().unwrap_or_else(|| "Latest".to_string()),
        host_name: System::host_name().unwrap_or_else(|| "onyx-workstation".to_string()),
        cpu_brand,
        cpu_cores: sys.cpus().len().max(1),
        cpu_usage_percent,
        uptime_seconds: System::uptime(),
        home_dir: user_home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string()),
        disks,
        memory: MemoryTelemetry {
            total_bytes: total_mem,
            used_bytes: used_mem,
            available_bytes: total_mem.saturating_sub(used_mem),
            usage_percent: mem_pct,
            swap_total_bytes: sys.total_swap(),
            swap_used_bytes: sys.used_swap(),
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
                if parent.join("build.gradle").exists() || parent.join("build.gradle.kts").exists() {
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
            .map(PathBuf::from)
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
                children.iter_mut().for_each(|entry_res| {
                    if let Ok(entry) = entry_res {
                        if entry.file_type.is_dir() {
                            let name = entry.file_name.to_string_lossy().to_string();
                            // Skip non-project OS & VCS folders
                            if matches!(
                                name.as_str(),
                                ".git"
                                    | ".hg"
                                    | ".svn"
                                    | "AppData"
                                    | "Application Data"
                                    | "Library"
                                    | ".Trash"
                                    | "Trash"
                                    | "$Recycle.Bin"
                                    | "System Volume Information"
                                    | "Windows"
                                    | "Program Files"
                                    | "Program Files (x86)"
                                    | ".cargo"
                                    | ".rustup"
                                    | ".local"
                                    | ".npm"
                                    | ".cache"
                            ) {
                                entry.read_children_path = None;
                                return;
                            }

                            let candidate_path = entry.path();
                            if let Some((cat, eco)) = classify_dev_dir(&candidate_path, &name) {
                                // Prune recursion into heavy artifact folder!
                                entry.read_children_path = None;
                                if let Ok(mut guard) = found_ref.lock() {
                                    guard.push(RawDevMatch {
                                        path: candidate_path,
                                        category: cat,
                                        ecosystem: eco,
                                    });
                                }
                            }
                        }
                    }
                });
            });

        for _ in walker {}
    }

    // Also inspect Docker buildx / desktop cache directories if present
    if let Some(home) = user_home_dir() {
        let docker_candidates = [
            home.join(".docker/buildx"),
            home.join("AppData/Local/Docker/wsl/data"),
            home.join(".local/share/docker"),
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

    let raw_matches = discovered
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default();

    // Deduplicate paths
    let mut unique_seen = HashSet::new();
    let deduped: Vec<RawDevMatch> = raw_matches
        .into_iter()
        .filter(|m| unique_seen.insert(m.path.clone()))
        .collect();

    // Compute directory sizes concurrently across Rayon worker pool
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

            Some(DevJunkItem {
                id: format!("dev-{}", m.path.to_string_lossy()),
                category: m.category.to_string(),
                ecosystem: m.ecosystem.to_string(),
                project_name: format!("{} / {}", project_name, folder_name),
                path: m.path.to_string_lossy().to_string(),
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
        scanned_roots: roots
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
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
    let started = Instant::now();
    let mut specs: Vec<CacheSpec> = Vec::new();

    // 1. OS Temp directory
    let temp_dir = std::env::temp_dir();
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
        // Cross-platform Browser Caches
        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Local"));

        let browser_dirs = [
            (
                "Chrome Browser Cache",
                "Cached web assets, media & V8 bytecode",
                local_app_data.join("Google/Chrome/User Data/Default/Cache"),
            ),
            (
                "Microsoft Edge Cache",
                "Chromium web cache & service worker storage",
                local_app_data.join("Microsoft/Edge/User Data/Default/Cache"),
            ),
            (
                "Brave Browser Cache",
                "Cached scripts, images & media chunks",
                local_app_data.join("BraveSoftware/Brave-Browser/User Data/Default/Cache"),
            ),
            (
                "Chrome Browser Cache",
                "Cached web assets & media (~/.cache)",
                home.join(".cache/google-chrome"),
            ),
            (
                "Chromium Cache",
                "Cached web assets & shader cache",
                home.join(".cache/chromium"),
            ),
            (
                "Firefox Web Cache",
                "Mozilla disk cache & offline storage",
                home.join(".cache/mozilla/firefox"),
            ),
            (
                "Safari & WebKit Cache",
                "macOS WebKit network & render caches",
                home.join("Library/Caches/Google/Chrome"),
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

        // Package Manager & Toolchain Caches (safe reproducible download caches)
        let pkg_dirs = [
            (
                "npm Package Cache",
                "Cached tarballs & HTTP registry metadata",
                home.join(".npm/_cacache"),
            ),
            (
                "npm Package Cache",
                "Windows npm tarball & metadata cache",
                local_app_data.join("npm-cache"),
            ),
            (
                "Python pip Cache",
                "Downloaded wheel archives & HTTP cache",
                home.join(".cache/pip"),
            ),
            (
                "Python pip Cache",
                "Windows pip wheel & HTTP cache",
                local_app_data.join("pip/Cache"),
            ),
            (
                "Cargo Crate Archives",
                "Downloaded .crate tarballs in registry cache",
                home.join(".cargo/registry/cache"),
            ),
            (
                "pnpm / Yarn Store Cache",
                "Cached JS package tarballs",
                home.join(".cache/yarn"),
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

        // System Logs, Thumbnails & Crash Dumps
        let log_dirs = [
            (
                "Application Crash Dumps",
                "Windows user-mode minidumps & crash reports",
                local_app_data.join("CrashDumps"),
            ),
            (
                "Thumbnail & Icon Cache",
                "Cached image & document preview thumbnails",
                home.join(".cache/thumbnails"),
            ),
            (
                "macOS User Logs",
                "Diagnostic & application log archives",
                home.join("Library/Logs"),
            ),
            (
                "Desktop Session Logs",
                "Xorg / Wayland user session logs",
                home.join(".local/share/xorg"),
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

    // Deduplicate specs by canonical path
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
            Some(SystemCacheItem {
                id: format!("cache-{}", spec.path.to_string_lossy()),
                category: spec.category.to_string(),
                title: spec.title.to_string(),
                subtitle: spec.subtitle.to_string(),
                path: spec.path.to_string_lossy().to_string(),
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
    let threshold_mb = min_size_mb.unwrap_or(1024);
    let threshold_bytes = threshold_mb.saturating_mul(1024 * 1024);

    let scan_root = root_path
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .or_else(user_home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));

    let found: Arc<Mutex<Vec<LargeFileItem>>> = Arc::new(Mutex::new(Vec::new()));
    let found_ref = Arc::clone(&found);

    let walker = WalkDirGeneric::<((), ())>::new(&scan_root)
        .skip_hidden(false)
        .follow_links(false)
        .process_read_dir(move |_depth, _dir_path, _state, children| {
            children.iter_mut().for_each(|entry_res| {
                if let Ok(entry) = entry_res {
                    let name = entry.file_name.to_string_lossy().to_string();
                    if entry.file_type.is_dir() {
                        if matches!(
                            name.as_str(),
                            "proc"
                                | "sys"
                                | "dev"
                                | "run"
                                | "$Recycle.Bin"
                                | "System Volume Information"
                                | "WinSxS"
                                | ".Trash"
                        ) {
                            entry.read_children_path = None;
                        }
                        return;
                    }

                    if entry.file_type.is_file() {
                        if let Ok(meta) = entry.metadata() {
                            let len = meta.len();
                            if len >= threshold_bytes {
                                let p = entry.path();
                                let ext = p
                                    .extension()
                                    .map(|e| e.to_string_lossy().to_lowercase())
                                    .unwrap_or_default();
                                let category = classify_large_file(&ext).to_string();
                                let parent_dir = p
                                    .parent()
                                    .map(|d| d.to_string_lossy().to_string())
                                    .unwrap_or_default();
                                let modified_days_ago = days_since_modified(meta.modified().ok());

                                if let Ok(mut guard) = found_ref.lock() {
                                    guard.push(LargeFileItem {
                                        id: format!("file-{}", p.to_string_lossy()),
                                        name,
                                        path: p.to_string_lossy().to_string(),
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
                }
            });
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
        scanned_root: scan_root.to_string_lossy().to_string(),
        duration_ms: started.elapsed().as_millis(),
    }
}

pub fn list_subdirectories(parent_path: Option<String>) -> Result<Vec<DirectoryEntry>, String> {
    let dir = parent_path
        .map(PathBuf::from)
        .filter(|p| p.exists() && p.is_dir())
        .or_else(user_home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));

    let mut entries = Vec::new();
    let rd = fs::read_dir(&dir).map_err(|e| format!("Unable to read {}: {}", dir.display(), e))?;
    for entry in rd.flatten() {
        if let Ok(ft) = entry.file_type() {
            if ft.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('$') {
                    entries.push(DirectoryEntry {
                        name,
                        path: entry.path().to_string_lossy().to_string(),
                    });
                }
            }
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}
