use crate::models::{
    DirectoryEntry, ExtensionStat, ExtensionsReport, SpaceLensReport, SpaceNode,
    StorageSnapshotMeta,
};
use crate::progress::{add_scanned_batch, is_scan_cancelled, set_scan_phase, ScanSessionGuard};
use crate::safety::{
    is_reparse_or_symlink, normalize_path_buf, normalize_path_string, resolve_clean_path,
    user_home_dir,
};
use crate::scanner::compute_dir_stats_parallel;
use crate::snapshots::{
    apply_diff_against_baseline, get_snapshot_for_path, upsert_snapshot_from_nodes,
};
use crate::whitelist::is_path_protected;
use jwalk::WalkDirGeneric;
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};

fn days_since(mtime: Option<SystemTime>) -> u64 {
    let Some(t) = mtime else { return 0 };
    SystemTime::now()
        .duration_since(t)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

fn build_breadcrumbs(target: &Path) -> Vec<DirectoryEntry> {
    let mut crumbs = Vec::new();
    let mut cur = Some(target);
    let mut last_path_str = String::new();

    while let Some(p) = cur {
        let p_str = normalize_path_string(p);
        if p_str.is_empty() || p_str == last_path_str {
            break;
        }
        last_path_str = p_str.clone();

        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| p_str.clone());

        crumbs.push(DirectoryEntry {
            name: if name.is_empty() {
                "/".to_string()
            } else {
                name
            },
            path: p_str,
        });
        cur = p.parent();
    }
    crumbs.reverse();
    crumbs
}

pub fn scan_space_lens(target_path: Option<String>) -> SpaceLensReport {
    let _guard = ScanSessionGuard::start("space_lens");
    let started = Instant::now();
    let root = target_path
        .filter(|s| !s.trim().is_empty())
        .map(|s| resolve_clean_path(Path::new(&s)))
        .filter(|p| p.exists() && p.is_dir())
        .or_else(user_home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));

    let clean_root = resolve_clean_path(&root);
    let current_str = normalize_path_string(&clean_root);
    set_scan_phase("space_lens", &current_str);

    let parent_path = clean_root
        .parent()
        .map(normalize_path_string)
        .filter(|p| !p.is_empty() && p != &current_str);

    let breadcrumbs = build_breadcrumbs(&clean_root);

    let mut children: Vec<PathBuf> = Vec::new();
    if let Ok(rd) = fs::read_dir(&clean_root) {
        for entry in rd.flatten() {
            let p = normalize_path_buf(&entry.path());
            let os_name = entry.file_name();
            let name = os_name.to_string_lossy();
            if clean_root == Path::new("/")
                && matches!(
                    name.as_ref(),
                    "proc" | "sys" | "dev" | "run" | "snap" | "lost+found"
                )
            {
                continue;
            }
            if matches!(
                name.as_ref(),
                "$Recycle.Bin"
                    | "System Volume Information"
                    | "Documents and Settings"
                    | "Recovery"
            ) {
                continue;
            }
            children.push(p);
        }
    }

    let mut nodes: Vec<SpaceNode> = children
        .par_iter()
        .filter_map(|child| {
            if is_scan_cancelled() {
                return None;
            }
            let meta = fs::symlink_metadata(child).ok()?;
            if is_reparse_or_symlink(&meta) {
                return None;
            }
            let name = child
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let clean_child_str = normalize_path_string(child);
            let protected = is_path_protected(child);

            if meta.is_dir() {
                let (sz, count, mtime) = compute_dir_stats_parallel(child);
                if sz == 0 {
                    return None;
                }
                Some(SpaceNode {
                    id: format!("node-{}", clean_child_str),
                    name,
                    path: clean_child_str,
                    is_dir: true,
                    size_bytes: sz,
                    share_percent: 0.0,
                    file_count: count,
                    modified_days_ago: days_since(mtime),
                    delta_bytes: None,
                    is_protected: protected,
                })
            } else if meta.is_file() {
                let sz = meta.len();
                if sz == 0 {
                    return None;
                }
                add_scanned_batch(1, sz, None);
                Some(SpaceNode {
                    id: format!("node-{}", clean_child_str),
                    name,
                    path: clean_child_str,
                    is_dir: false,
                    size_bytes: sz,
                    share_percent: 0.0,
                    file_count: 1,
                    modified_days_ago: days_since(meta.modified().ok()),
                    delta_bytes: None,
                    is_protected: protected,
                })
            } else {
                None
            }
        })
        .collect();

    nodes.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let total_bytes: u64 = nodes.iter().map(|n| n.size_bytes).sum();

    for node in &mut nodes {
        if total_bytes > 0 {
            node.share_percent =
                ((node.size_bytes as f64 / total_bytes as f64) * 1000.0).round() / 10.0;
        }
    }

    // Storage Diff ("Where Did My Space Go?"): compare against saved baseline if available,
    // or automatically create an initial baseline snapshot on the very first completed scan!
    let (has_baseline, snapshot_timestamp, total_delta_bytes) =
        if let Some(baseline) = get_snapshot_for_path(&current_str) {
            let total_delta = apply_diff_against_baseline(&baseline, total_bytes, &mut nodes);
            (true, Some(baseline.timestamp_unix), Some(total_delta))
        } else if !is_scan_cancelled() && !nodes.is_empty() {
            let meta = upsert_snapshot_from_nodes(&current_str, total_bytes, &nodes);
            (false, Some(meta.timestamp_unix), Some(0))
        } else {
            (false, None, None)
        };

    if nodes.len() > 30 {
        nodes.truncate(30);
    }

    SpaceLensReport {
        current_path: current_str,
        parent_path,
        breadcrumbs,
        nodes,
        total_bytes,
        duration_ms: started.elapsed().as_millis(),
        has_baseline,
        snapshot_timestamp,
        total_delta_bytes,
    }
}

/// Captures a fresh baseline snapshot for `target_path` by running Space Lens sizing
/// and persisting the current child sizes as the new diff reference point.
pub fn capture_space_baseline(target_path: String) -> Result<StorageSnapshotMeta, String> {
    let report = scan_space_lens(Some(target_path));
    Ok(upsert_snapshot_from_nodes(
        &report.current_path,
        report.total_bytes,
        &report.nodes,
    ))
}

fn categorize_ext(ext: &str) -> &'static str {
    match ext {
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "c" | "cpp" | "h" | "java" | "kt"
        | "json" | "toml" | "yaml" | "yml" | "css" | "html" | "md" => "code",
        "mp4" | "mkv" | "mov" | "webm" | "avi" | "mp3" | "wav" | "flac" | "png" | "jpg"
        | "jpeg" | "webp" | "svg" | "gif" => "media",
        "zip" | "tar" | "gz" | "tgz" | "xz" | "zst" | "7z" | "rar" | "crate" | "whl" | "pack" => {
            "archive"
        }
        "exe" | "dll" | "so" | "dylib" | "rlib" | "rmeta" | "o" | "a" | "deb" | "msi" | "iso"
        | "vhdx" | "vhd" | "vmdk" | "qcow2" | "gguf" => "binary",
        _ => "data",
    }
}

/// Zero-allocation stack ASCII extension extractor: avoids creating 2-3 `String`s per file!
#[inline]
fn extract_ascii_ext_stack<'a>(file_name: &str, stack_buf: &'a mut [u8; 16]) -> &'a str {
    let Some(dot_pos) = file_name.rfind('.') else {
        return "no-ext";
    };
    if dot_pos == 0 {
        return "no-ext";
    }
    let raw_ext = &file_name[dot_pos + 1..];
    if raw_ext.is_empty() || raw_ext.len() > 12 || !raw_ext.is_ascii() {
        return "no-ext";
    }
    for (i, b) in raw_ext.bytes().enumerate() {
        stack_buf[i] = b.to_ascii_lowercase();
    }
    std::str::from_utf8(&stack_buf[..raw_ext.len()]).unwrap_or("no-ext")
}

pub fn scan_extension_stats(root_path: Option<String>) -> ExtensionsReport {
    let _guard = ScanSessionGuard::start("extensions");
    let started = Instant::now();
    let scan_root = root_path
        .filter(|s| !s.trim().is_empty())
        .map(|s| resolve_clean_path(Path::new(&s)))
        .filter(|p| p.exists())
        .or_else(user_home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));

    set_scan_phase("extensions", &scan_root.to_string_lossy());

    let acc: Arc<Mutex<HashMap<String, (u64, u64)>>> = Arc::new(Mutex::new(HashMap::new()));
    let acc_ref = Arc::clone(&acc);

    let walker = WalkDirGeneric::<((), ())>::new(&scan_root)
        .skip_hidden(false)
        .follow_links(false)
        .max_depth(9)
        .process_read_dir(move |_depth, _dir_path, _state, children| {
            if is_scan_cancelled() {
                children.iter_mut().for_each(|e| {
                    if let Ok(ent) = e {
                        ent.read_children_path = None;
                    }
                });
                return;
            }

            let mut local: HashMap<String, (u64, u64)> = HashMap::with_capacity(32);
            let mut batch_files = 0u64;
            let mut batch_bytes = 0u64;
            let mut ext_buf = [0u8; 16];

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
                                | "WinSxS"
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
                            if len > 0 {
                                batch_files += 1;
                                batch_bytes = batch_bytes.saturating_add(len);

                                let ext_key = extract_ascii_ext_stack(name, &mut ext_buf);
                                if let Some(slot) = local.get_mut(ext_key) {
                                    slot.0 = slot.0.saturating_add(len);
                                    slot.1 = slot.1.saturating_add(1);
                                } else {
                                    local.insert(ext_key.to_string(), (len, 1));
                                }
                            }
                        }
                    }
                }
            });

            if batch_files > 0 {
                add_scanned_batch(batch_files, batch_bytes, None);
            }

            if !local.is_empty() {
                if let Ok(mut guard) = acc_ref.lock() {
                    for (k, (sz, cnt)) in local {
                        let slot = guard.entry(k).or_insert((0, 0));
                        slot.0 = slot.0.saturating_add(sz);
                        slot.1 = slot.1.saturating_add(cnt);
                    }
                }
            }
        });

    for _ in walker {
        if is_scan_cancelled() {
            break;
        }
    }

    let map = acc.lock().map(|g| g.clone()).unwrap_or_default();
    let total_bytes: u64 = map.values().map(|v| v.0).sum();
    let total_files: u64 = map.values().map(|v| v.1).sum();

    let mut items: Vec<ExtensionStat> = map
        .into_iter()
        .map(|(ext, (bytes, count))| {
            let pct = if total_bytes > 0 {
                ((bytes as f64 / total_bytes as f64) * 1000.0).round() / 10.0
            } else {
                0.0
            };
            ExtensionStat {
                category: categorize_ext(&ext).to_string(),
                extension: if ext == "no-ext" {
                    "NO EXT".to_string()
                } else {
                    format!(".{}", ext)
                },
                total_bytes: bytes,
                file_count: count,
                share_percent: pct,
            }
        })
        .collect();

    items.sort_by(|a, b| b.total_bytes.cmp(&a.total_bytes));
    if items.len() > 16 {
        items.truncate(16);
    }

    ExtensionsReport {
        items,
        total_bytes,
        total_files,
        scanned_root: normalize_path_string(&scan_root),
        duration_ms: started.elapsed().as_millis(),
    }
}
