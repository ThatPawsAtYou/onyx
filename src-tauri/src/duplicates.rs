use crate::models::{DuplicateFileEntry, DuplicateGroup, DuplicatesReport};
use crate::safety::{
    is_cloud_placeholder_file, is_reparse_or_symlink, normalize_path_buf, normalize_path_string,
    resolve_clean_path, user_home_dir,
};
use jwalk::WalkDirGeneric;
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone)]
struct CandidateFile {
    path: PathBuf,
    size_bytes: u64,
    modified_secs: u64,
    modified_days_ago: u64,
}

fn modified_info(mtime: Option<SystemTime>) -> (u64, u64) {
    let Some(t) = mtime else {
        return (u64::MAX, 0);
    };
    let secs = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(u64::MAX);
    let days = SystemTime::now()
        .duration_since(t)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0);
    (secs, days)
}

/// Fast 8 KB edge fingerprint (first 4 KB + last 4 KB) to discard non-matching same-size files
fn compute_edge_signature(path: &Path, size: u64) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 4096];

    let n1 = file.read(&mut buf).ok()?;
    hasher.update(&buf[..n1]);

    if size > 4096 {
        let tail_pos = size.saturating_sub(4096);
        file.seek(SeekFrom::Start(tail_pos)).ok()?;
        let n2 = file.read(&mut buf).ok()?;
        hasher.update(&buf[..n2]);
    }

    Some(hasher.finalize().into())
}

/// Full streaming SHA-256 digest using stack-allocated 64 KB chunks
fn compute_full_sha256(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for b in digest {
        let _ = write!(&mut hex, "{:02x}", b);
    }
    Some(hex)
}

pub fn scan_duplicate_files(
    root_path: Option<String>,
    min_size_kb: Option<u64>,
) -> DuplicatesReport {
    let started = Instant::now();
    let min_bytes = min_size_kb.unwrap_or(100).max(16) * 1024;

    let scan_root = root_path
        .filter(|s| !s.trim().is_empty())
        .map(|s| resolve_clean_path(Path::new(&s)))
        .filter(|p| p.exists())
        .or_else(user_home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));

    let collected: Arc<Mutex<Vec<CandidateFile>>> = Arc::new(Mutex::new(Vec::new()));
    let collected_ref = Arc::clone(&collected);

    // Stage 1: Multi-threaded directory walk skipping app internals, caches & cloud placeholders
    let walker = WalkDirGeneric::<((), ())>::new(&scan_root)
        .skip_hidden(false)
        .follow_links(false)
        .max_depth(10)
        .process_read_dir(move |_depth, _dir_path, _state, children| {
            let mut local_batch: Vec<CandidateFile> = Vec::new();

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
                            ".git"
                                | "node_modules"
                                | "target"
                                | ".venv"
                                | "venv"
                                | ".cargo"
                                | ".rustup"
                                | ".npm"
                                | ".cache"
                                | ".local"
                                | "AppData"
                                | "Application Data"
                                | "Documents and Settings"
                                | "Library"
                                | "WebView2Data"
                                | "proc"
                                | "sys"
                                | "dev"
                                | "run"
                                | "usr"
                                | "lib"
                                | "Windows"
                                | "WinSxS"
                                | "Program Files"
                                | "Program Files (x86)"
                                | "ProgramData"
                                | "$Recycle.Bin"
                                | "System Volume Information"
                                | ".Trash"
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
                            if is_cloud_placeholder_file(&meta) {
                                return;
                            }
                            let len = meta.len();
                            if len >= min_bytes {
                                let (modified_secs, modified_days_ago) =
                                    modified_info(meta.modified().ok());
                                local_batch.push(CandidateFile {
                                    path: normalize_path_buf(&entry.path()),
                                    size_bytes: len,
                                    modified_secs,
                                    modified_days_ago,
                                });
                            }
                        }
                    }
                }
            });

            if !local_batch.is_empty() {
                if let Ok(mut guard) = collected_ref.lock() {
                    guard.extend(local_batch);
                }
            }
        });

    for _ in walker {}

    let all_files = collected.lock().map(|g| g.clone()).unwrap_or_default();
    let scanned_files = all_files.len();

    // Group by exact byte size
    let mut by_size: HashMap<u64, Vec<CandidateFile>> = HashMap::new();
    for f in all_files {
        by_size.entry(f.size_bytes).or_default().push(f);
    }

    let same_size_candidates: Vec<CandidateFile> = by_size
        .into_values()
        .filter(|group| group.len() >= 2)
        .flatten()
        .collect();

    // Stage 2: Parallel 8 KB edge signature check
    let edge_hashed: Vec<((u64, [u8; 32]), CandidateFile)> = same_size_candidates
        .into_par_iter()
        .filter_map(|f| {
            let sig = compute_edge_signature(&f.path, f.size_bytes)?;
            Some(((f.size_bytes, sig), f))
        })
        .collect();

    let mut by_edge: HashMap<(u64, [u8; 32]), Vec<CandidateFile>> = HashMap::new();
    for (key, f) in edge_hashed {
        by_edge.entry(key).or_default().push(f);
    }

    let full_hash_candidates: Vec<CandidateFile> = by_edge
        .into_values()
        .filter(|group| group.len() >= 2)
        .flatten()
        .collect();

    // Stage 3: Parallel full SHA-256 verification
    let fully_hashed: Vec<((u64, String), CandidateFile)> = full_hash_candidates
        .into_par_iter()
        .filter_map(|f| {
            let digest = compute_full_sha256(&f.path)?;
            Some(((f.size_bytes, digest), f))
        })
        .collect();

    let mut by_hash: HashMap<(u64, String), Vec<CandidateFile>> = HashMap::new();
    for (key, f) in fully_hashed {
        by_hash.entry(key).or_default().push(f);
    }

    let mut groups: Vec<DuplicateGroup> = by_hash
        .into_iter()
        .filter(|(_, list)| list.len() >= 2)
        .map(|((size_bytes, hash), mut list)| {
            list.sort_by(|a, b| {
                a.modified_secs
                    .cmp(&b.modified_secs)
                    .then_with(|| a.path.as_os_str().len().cmp(&b.path.as_os_str().len()))
            });

            let first_name = list[0]
                .path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Duplicate".to_string());
            let ext = list[0]
                .path
                .extension()
                .map(|e| e.to_string_lossy().to_uppercase())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "BIN".to_string());

            let wasted_bytes = size_bytes.saturating_mul((list.len() - 1) as u64);
            let hash_short = hash.chars().take(12).collect::<String>();

            let files = list
                .into_iter()
                .enumerate()
                .map(|(idx, item)| DuplicateFileEntry {
                    parent_dir: item
                        .path
                        .parent()
                        .map(normalize_path_string)
                        .unwrap_or_default(),
                    path: normalize_path_string(&item.path),
                    modified_days_ago: item.modified_days_ago,
                    is_original: idx == 0,
                })
                .collect();

            DuplicateGroup {
                id: format!("dup-{}-{}", size_bytes, hash_short),
                hash_short,
                file_name: first_name,
                extension: ext,
                size_bytes,
                wasted_bytes,
                files,
            }
        })
        .collect();

    groups.sort_by(|a, b| b.wasted_bytes.cmp(&a.wasted_bytes));
    let total_wasted_bytes = groups.iter().map(|g| g.wasted_bytes).sum();
    let total_duplicate_files: usize = groups.iter().map(|g| g.files.len() - 1).sum();

    if groups.len() > 100 {
        groups.truncate(100);
    }

    DuplicatesReport {
        groups,
        total_wasted_bytes,
        total_duplicate_files,
        scanned_files,
        scanned_root: normalize_path_string(&scan_root),
        duration_ms: started.elapsed().as_millis(),
    }
}
