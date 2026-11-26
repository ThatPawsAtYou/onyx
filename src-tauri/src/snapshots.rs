use crate::models::{SpaceNode, StorageSnapshotMeta};
use crate::safety::{normalize_path_str, onyx_app_data_dir, resolve_clean_path};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDirectorySnapshot {
    pub id: String,
    pub target_path: String,
    pub timestamp_unix: u64,
    pub total_bytes: u64,
    pub children: HashMap<String, u64>,
}

fn snapshots_file_path() -> PathBuf {
    if let Some(dir) = onyx_app_data_dir() {
        let _ = fs::create_dir_all(&dir);
        return dir.join("storage_snapshots.json");
    }
    std::env::temp_dir().join("onyx_storage_snapshots.json")
}

fn normalize_key(path: &str) -> String {
    let s = normalize_path_str(path);
    if cfg!(windows) || s.contains('\\') || (s.len() >= 2 && s.as_bytes()[1] == b':') {
        s.replace('\\', "/").to_lowercase()
    } else {
        s
    }
}

fn load_all_snapshots() -> Vec<StoredDirectorySnapshot> {
    let p = snapshots_file_path();
    let Ok(raw) = fs::read_to_string(p) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_all_snapshots(list: &[StoredDirectorySnapshot]) {
    if let Ok(json) = serde_json::to_string_pretty(list) {
        let _ = fs::write(snapshots_file_path(), json);
    }
}

pub fn get_snapshot_for_path(target_path: &str) -> Option<StoredDirectorySnapshot> {
    let key = normalize_key(target_path);
    load_all_snapshots()
        .into_iter()
        .find(|s| normalize_key(&s.target_path) == key)
}

pub fn list_snapshots_meta() -> Vec<StorageSnapshotMeta> {
    load_all_snapshots()
        .into_iter()
        .map(|s| StorageSnapshotMeta {
            id: s.id,
            target_path: s.target_path,
            timestamp_unix: s.timestamp_unix,
            total_bytes: s.total_bytes,
            child_count: s.children.len(),
        })
        .collect()
}

pub fn upsert_snapshot_from_nodes(
    target_path: &str,
    total_bytes: u64,
    nodes: &[SpaceNode],
) -> StorageSnapshotMeta {
    let clean_target = normalize_path_str(&resolve_clean_path(Path::new(target_path)).to_string_lossy());
    let target_key = normalize_key(&clean_target);
    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut children_map = HashMap::with_capacity(nodes.len());
    for node in nodes {
        children_map.insert(node.name.clone(), node.size_bytes);
    }

    let snap = StoredDirectorySnapshot {
        id: format!("snap-{}", now_unix),
        target_path: clean_target.clone(),
        timestamp_unix: now_unix,
        total_bytes,
        children: children_map,
    };

    let meta = StorageSnapshotMeta {
        id: snap.id.clone(),
        target_path: clean_target,
        timestamp_unix: now_unix,
        total_bytes,
        child_count: snap.children.len(),
    };

    let mut all = load_all_snapshots();
    all.retain(|s| normalize_key(&s.target_path) != target_key);
    all.insert(0, snap);
    if all.len() > 30 {
        all.truncate(30);
    }
    save_all_snapshots(&all);

    meta
}

pub fn delete_snapshot_for_path(target_path: &str) -> Result<(), String> {
    let key = normalize_key(target_path);
    let mut all = load_all_snapshots();
    all.retain(|s| normalize_key(&s.target_path) != key);
    save_all_snapshots(&all);
    Ok(())
}

/// Computes per-node `delta_bytes` against a stored baseline snapshot.
pub fn apply_diff_against_baseline(
    baseline: &StoredDirectorySnapshot,
    total_bytes: u64,
    nodes: &mut [SpaceNode],
) -> i64 {
    for node in nodes.iter_mut() {
        let prev = baseline.children.get(&node.name).copied().unwrap_or(0);
        let diff = (node.size_bytes as i128) - (prev as i128);
        node.delta_bytes = Some(diff.clamp(i64::MIN as i128, i64::MAX as i128) as i64);
    }
    let total_diff = (total_bytes as i128) - (baseline.total_bytes as i128);
    total_diff.clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_calculation() {
        let mut children = HashMap::new();
        children.insert("Games".to_string(), 10_000);
        children.insert("Logs".to_string(), 5_000);
        let snap = StoredDirectorySnapshot {
            id: "snap-1".to_string(),
            target_path: "C:\\".to_string(),
            timestamp_unix: 100,
            total_bytes: 15_000,
            children,
        };

        let mut nodes = vec![
            SpaceNode {
                id: "1".to_string(),
                name: "Games".to_string(),
                path: "C:\\Games".to_string(),
                is_dir: true,
                size_bytes: 18_500,
                share_percent: 0.0,
                file_count: 10,
                modified_days_ago: 0,
                delta_bytes: None,
                is_protected: false,
            },
            SpaceNode {
                id: "2".to_string(),
                name: "Logs".to_string(),
                path: "C:\\Logs".to_string(),
                is_dir: true,
                size_bytes: 2_000,
                share_percent: 0.0,
                file_count: 2,
                modified_days_ago: 0,
                delta_bytes: None,
                is_protected: false,
            },
        ];

        let total_delta = apply_diff_against_baseline(&snap, 20_500, &mut nodes);
        assert_eq!(total_delta, 5_500);
        assert_eq!(nodes[0].delta_bytes, Some(8_500));
        assert_eq!(nodes[1].delta_bytes, Some(-3_000));
    }
}
