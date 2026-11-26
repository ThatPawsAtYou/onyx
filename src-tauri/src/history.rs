use crate::models::CleanupHistoryEntry;
use crate::safety::onyx_app_data_dir;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn history_file_path() -> PathBuf {
    if let Some(dir) = onyx_app_data_dir() {
        let _ = fs::create_dir_all(&dir);
        return dir.join("cleanup_history.json");
    }
    std::env::temp_dir().join("onyx_cleanup_history.json")
}

pub fn load_history() -> Vec<CleanupHistoryEntry> {
    let path = history_file_path();
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn record_cleanup_event(
    category: &str,
    freed_bytes: u64,
    deleted_count: usize,
    sample_paths: Vec<String>,
) {
    if deleted_count == 0 && freed_bytes == 0 {
        return;
    }
    let mut entries = load_history();
    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    entries.insert(
        0,
        CleanupHistoryEntry {
            id: format!("hist-{}-{}", now_unix, entries.len()),
            timestamp_unix: now_unix,
            category: category.to_string(),
            freed_bytes,
            deleted_count,
            sample_paths: sample_paths.into_iter().take(4).collect(),
        },
    );

    if entries.len() > 100 {
        entries.truncate(100);
    }

    if let Ok(serialized) = serde_json::to_string_pretty(&entries) {
        let _ = fs::write(history_file_path(), serialized);
    }
}

pub fn clear_history() -> Result<(), String> {
    let path = history_file_path();
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
