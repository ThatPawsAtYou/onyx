use crate::models::{DuplicateFileEntry, DuplicateGroup, DuplicatesReport};
use crate::progress::{add_scanned_batch, is_scan_cancelled, set_scan_phase, ScanSessionGuard};
use crate::safety::{
    is_cloud_placeholder_file, is_reparse_or_symlink, normalize_path_buf, normalize_path_string,
    resolve_clean_path, user_home_dir,
};
use crate::whitelist::is_path_protected;
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

/// Fast 16 KB stack-buffered edge fingerprint (first 8 KB + last 8 KB) to eliminate
/// 99%+ of same-size non-duplicate files in a single microsecond I/O pass.
fn compute_edge_signature(path: &Path, size: u64) -> Option<[u8; 32]> {
    if is_scan_cancelled() {
        return None;
    }
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());
    let mut buf = [0u8; 8192];

    let n1 = file.read(&mut buf).ok()?;
    hasher.update(&buf[..n1]);

    if size > 8192 {
        let tail_pos = size.saturating_sub(8192);
        file.seek(SeekFrom::Start(tail_pos)).ok()?;
        let n2 = file.read(&mut buf).ok()?;
        hasher.update(&buf[..n2]);
    }

    Some(hasher.finalize().into())
}

/// Full streaming SHA-256 digest using 128 KB chunks with per-chunk instant cancellation.
fn compute_full_sha256(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        if is_scan_cancelled() {
            return None;
        }
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
    let _guard = ScanSessionGuard::start("duplicates");
    let started = Instant::now();
    let min_bytes = min_size_kb.unwrap_or(100).max(16) * 1024;

    let scan_root = root_path
        .filter(|s| !s.trim().is_empty())
        .map(|s| resolve_clean_path(Path::new(&s)))
        .filter(|p| p.exists())
        .or_else(user_home_dir)
        .unwrap_or_else(|| PathBuf::from("/"));

    set_scan_phase("duplicates", &scan_root.to_string_lossy());

    let collected: Arc<Mutex<Vec<CandidateFile>>> = Arc::new(Mutex::new(Vec::new()));
    let collected_ref = Arc::clone(&collected);

    let walker = WalkDirGeneric::<((), ())>::new(&scan_root)
        .skip_hidden(false)
        .follow_links(false)
        .max_depth(10)
        .process_read_dir(move |_depth, dir_path, _state, children| {
            if is_scan_cancelled() || dir_path.join(".onyxignore").exists() {
                children.iter_mut().for_each(|e| {
                    if let Ok(ent) = e {
                        ent.read_children_path = None;
                    }
                });
                return;
            }

            let mut local_batch: Vec<CandidateFile> = Vec::new();
            let mut batch_files = 0u64;
            let mut batch_bytes = 0u64;

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
                            batch_files += 1;
                            batch_bytes = batch_bytes.saturating_add(len);

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

            if batch_files > 0 {
                add_scanned_batch(batch_files, batch_bytes, None);
            }

            if !local_batch.is_empty() {
                if let Ok(mut guard) = collected_ref.lock() {
                    guard.extend(local_batch);
                }
            }
        });

    for _ in walker {
        if is_scan_cancelled() {
            break;
        }
    }

    let all_files = collected.lock().map(|g| g.clone()).unwrap_or_default();
    let scanned_files = all_files.len();

    let mut by_size: HashMap<u64, Vec<CandidateFile>> = HashMap::new();
    for f in all_files {
        by_size.entry(f.size_bytes).or_default().push(f);
    }

    let same_size_candidates: Vec<CandidateFile> = by_size
        .into_values()
        .filter(|group| group.len() >= 2)
        .flatten()
        .collect();

    // Stage 2: Parallel 16 KB edge signature check
    let edge_hashed: Vec<((u64, [u8; 32]), CandidateFile)> = same_size_candidates
        .into_par_iter()
        .filter_map(|cand| {
            let sig = compute_edge_signature(&cand.path, cand.size_bytes)?;
            Some(((cand.size_bytes, sig), cand))
        })
        .collect();

    let mut by_edge: HashMap<(u64, [u8; 32]), Vec<CandidateFile>> = HashMap::new();
    for (key, cand) in edge_hashed {
        by_edge.entry(key).or_default().push(cand);
    }

    let edge_survivors: Vec<CandidateFile> = by_edge
        .into_values()
        .filter(|group| group.len() >= 2)
        .flatten()
        .collect();

    // Stage 3: Parallel full SHA-256 cryptographic verification
    let full_hashed: Vec<((u64, String), CandidateFile)> = edge_survivors
        .into_par_iter()
        .filter_map(|cand| {
            let sha = compute_full_sha256(&cand.path)?;
            Some(((cand.size_bytes, sha), cand))
        })
        .collect();

    let mut by_sha: HashMap<(u64, String), Vec<CandidateFile>> = HashMap::new();
    for (key, cand) in full_hashed {
        by_sha.entry(key).or_default().push(cand);
    }

    let mut groups: Vec<DuplicateGroup> = Vec::new();
    for ((size_bytes, sha_hex), mut files_vec) in by_sha {
        if files_vec.len() < 2 {
            continue;
        }
        // Sort so protected files or oldest/shortest-path original comes first (kept safe!)
        files_vec.sort_by(|a, b| {
            let a_prot = is_path_protected(&a.path);
            let b_prot = is_path_protected(&b.path);
            b_prot
                .cmp(&a_prot)
                .then_with(|| a.modified_secs.cmp(&b.modified_secs))
                .then_with(|| a.path.as_os_str().len().cmp(&b.path.as_os_str().len()))
        });

        let sample_name = files_vec[0]
            .path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "duplicate-file".to_string());
        let ext = files_vec[0]
            .path
            .extension()
            .map(|e| e.to_string_lossy().to_uppercase())
            .unwrap_or_else(|| "BIN".to_string());

        let wasted_bytes = size_bytes.saturating_mul((files_vec.len() - 1) as u64);
        let short_hash = sha_hex.chars().take(12).collect::<String>();

        let entries: Vec<DuplicateFileEntry> = files_vec
            .into_iter()
            .enumerate()
            .map(|(idx, f)| {
                let protected = is_path_protected(&f.path);
                let clean = normalize_path_string(&f.path);
                let parent_dir = f.path.parent().map(normalize_path_string).unwrap_or_default();
                DuplicateFileEntry {
                    path: clean,
                    parent_dir,
                    modified_days_ago: f.modified_days_ago,
                    is_original: idx == 0,
                    is_protected: protected,
                }
            })
            .collect();

        groups.push(DuplicateGroup {
            id: format!("dup-{}", &sha_hex[..16.min(sha_hex.len())]),
            hash_short: short_hash,
            file_name: sample_name,
            extension: ext,
            size_bytes,
            wasted_bytes,
            files: entries,
        });
    }

    groups.sort_by(|a, b| b.wasted_bytes.cmp(&a.wasted_bytes));
    let total_wasted_bytes = groups.iter().map(|g| g.wasted_bytes).sum();
    let total_duplicate_files = groups.iter().map(|g| g.files.len() - 1).sum();
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
