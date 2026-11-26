use crate::models::ProtectedPathEntry;
use crate::safety::{normalize_path_str, onyx_app_data_dir, resolve_clean_path};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static WHITELIST_CACHE: OnceLock<Mutex<Vec<ProtectedPathEntry>>> = OnceLock::new();

fn whitelist_file_path() -> PathBuf {
    if let Some(dir) = onyx_app_data_dir() {
        let _ = fs::create_dir_all(&dir);
        return dir.join("protected_paths.json");
    }
    std::env::temp_dir().join("onyx_protected_paths.json")
}

fn load_from_disk() -> Vec<ProtectedPathEntry> {
    let p = whitelist_file_path();
    let Ok(raw) = fs::read_to_string(p) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_to_disk(entries: &[ProtectedPathEntry]) {
    if let Ok(json) = serde_json::to_string_pretty(entries) {
        let _ = fs::write(whitelist_file_path(), json);
    }
}

fn cache_lock() -> &'static Mutex<Vec<ProtectedPathEntry>> {
    WHITELIST_CACHE.get_or_init(|| Mutex::new(load_from_disk()))
}

#[inline]
fn canonical_compare_key(raw: &str) -> String {
    let norm = normalize_path_str(raw);
    if cfg!(windows) || norm.contains('\\') || (norm.len() >= 2 && norm.as_bytes()[1] == b':') {
        norm.replace('\\', "/").to_lowercase()
    } else {
        norm
    }
}

pub fn list_protected_paths() -> Vec<ProtectedPathEntry> {
    cache_lock().lock().map(|g| g.clone()).unwrap_or_default()
}

pub fn add_protected_path(raw_path: &str, custom_label: Option<String>) -> Result<Vec<ProtectedPathEntry>, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    let clean = normalize_path_str(&resolve_clean_path(Path::new(trimmed)).to_string_lossy());
    if clean.is_empty() {
        return Err("Invalid path".to_string());
    }
    let key = canonical_compare_key(&clean);

    let label = custom_label
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            Path::new(&clean)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| clean.clone());

    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut guard = cache_lock().lock().map_err(|_| "Whitelist lock poisoned".to_string())?;
    if !guard.iter().any(|e| canonical_compare_key(&e.path) == key) {
        guard.insert(
            0,
            ProtectedPathEntry {
                path: clean,
                label,
                added_unix: now_unix,
            },
        );
        save_to_disk(&guard);
    }
    Ok(guard.clone())
}

pub fn remove_protected_path(raw_path: &str) -> Result<Vec<ProtectedPathEntry>, String> {
    let key_raw = canonical_compare_key(raw_path);
    let key_resolved = canonical_compare_key(
        &resolve_clean_path(Path::new(raw_path)).to_string_lossy(),
    );

    let mut guard = cache_lock().lock().map_err(|_| "Whitelist lock poisoned".to_string())?;
    let prev_len = guard.len();
    guard.retain(|e| {
        let ek = canonical_compare_key(&e.path);
        ek != key_raw && ek != key_resolved
    });
    if guard.len() != prev_len {
        save_to_disk(&guard);
    }
    Ok(guard.clone())
}

/// Checks if `path` has a `.onyxignore` marker file inside itself or its immediate parent
/// (for example, `my-app/.onyxignore` protects `my-app/node_modules` and `my-app/target`).
pub fn has_onyxignore_marker(path: &Path) -> bool {
    if path.join(".onyxignore").exists() {
        return true;
    }
    if let Some(parent) = path.parent() {
        // Only check project parent if it's not a root or user home directory
        if parent.parent().is_some() && parent.join(".onyxignore").exists() {
            return true;
        }
    }
    false
}

/// Fast in-memory check whether `path` (or one of its parent directories) is protected
/// by the user's Whitelist OR by a `.onyxignore` marker file.
pub fn is_path_protected(path: &Path) -> bool {
    let raw_str = normalize_path_str(&path.to_string_lossy());
    if is_path_str_in_whitelist(&raw_str) {
        return true;
    }
    has_onyxignore_marker(path)
}

pub fn is_path_str_in_whitelist(raw_path: &str) -> bool {
    let target_key = canonical_compare_key(raw_path);
    if target_key.is_empty() {
        return false;
    }
    let Ok(guard) = cache_lock().lock() else {
        return false;
    };
    if guard.is_empty() {
        return false;
    }
    for entry in guard.iter() {
        let prot_key = canonical_compare_key(&entry.path);
        if prot_key.is_empty() {
            continue;
        }
        if target_key == prot_key {
            return true;
        }
        // Protected directory also shields everything inside it, AND a protected child
        // prevents deleting its ancestor folder blindly!
        let prot_prefix = format!("{}/", prot_key.trim_end_matches('/'));
        let target_prefix = format!("{}/", target_key.trim_end_matches('/'));
        if target_key.starts_with(&prot_prefix) || prot_key.starts_with(&target_prefix) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonical_compare_key_windows_and_unix() {
        assert_eq!(
            canonical_compare_key(r"\\?\D:\Projects\Hyperion\"),
            "d:/projects/hyperion"
        );
        assert_eq!(
            canonical_compare_key("/home/user/work//"),
            "/home/user/work"
        );
    }
}
