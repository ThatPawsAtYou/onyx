use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskTelemetry {
    pub id: String,
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub kind_label: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f64,
    pub is_removable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTelemetry {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage_percent: f64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemOverview {
    pub os_name: String,
    pub os_version: String,
    pub host_name: String,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub cpu_usage_percent: f64,
    pub uptime_seconds: u64,
    pub home_dir: String,
    pub disks: Vec<DiskTelemetry>,
    pub memory: MemoryTelemetry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevJunkItem {
    pub id: String,
    pub category: String,
    pub ecosystem: String,
    pub project_name: String,
    pub path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub modified_days_ago: u64,
    pub is_protected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevJunkScanReport {
    pub items: Vec<DevJunkItem>,
    pub total_bytes: u64,
    pub scanned_roots: Vec<String>,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCacheItem {
    pub id: String,
    pub category: String,
    pub title: String,
    pub subtitle: String,
    pub path: String,
    pub clean_contents_only: bool,
    pub size_bytes: u64,
    pub file_count: u64,
    pub safe_to_purge: bool,
    pub is_protected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCacheReport {
    pub items: Vec<SystemCacheItem>,
    pub total_bytes: u64,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFileItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub parent_dir: String,
    pub extension: String,
    pub category: String,
    pub size_bytes: u64,
    pub modified_days_ago: u64,
    pub is_virtual_disk: bool,
    pub compact_hint: Option<String>,
    pub is_protected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFilesReport {
    pub items: Vec<LargeFileItem>,
    pub total_bytes: u64,
    pub threshold_bytes: u64,
    pub scanned_root: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub share_percent: f64,
    pub file_count: u64,
    pub modified_days_ago: u64,
    pub delta_bytes: Option<i64>,
    pub is_protected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceLensReport {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub breadcrumbs: Vec<DirectoryEntry>,
    pub nodes: Vec<SpaceNode>,
    pub total_bytes: u64,
    pub duration_ms: u128,
    pub has_baseline: bool,
    pub snapshot_timestamp: Option<u64>,
    pub total_delta_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateFileEntry {
    pub path: String,
    pub parent_dir: String,
    pub modified_days_ago: u64,
    pub is_original: bool,
    pub is_protected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub id: String,
    pub hash_short: String,
    pub file_name: String,
    pub extension: String,
    pub size_bytes: u64,
    pub wasted_bytes: u64,
    pub files: Vec<DuplicateFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatesReport {
    pub groups: Vec<DuplicateGroup>,
    pub total_wasted_bytes: u64,
    pub total_duplicate_files: usize,
    pub scanned_files: usize,
    pub scanned_root: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStat {
    pub extension: String,
    pub category: String,
    pub total_bytes: u64,
    pub file_count: u64,
    pub share_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionsReport {
    pub items: Vec<ExtensionStat>,
    pub total_bytes: u64,
    pub total_files: u64,
    pub scanned_root: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupHistoryEntry {
    pub id: String,
    pub timestamp_unix: u64,
    pub category: String,
    pub freed_bytes: u64,
    pub deleted_count: usize,
    pub sample_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashTarget {
    pub path: String,
    #[serde(default, alias = "cleanContentsOnly")]
    pub contents_only: bool,
    #[serde(default)]
    pub expected_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeReport {
    pub freed_bytes: u64,
    pub deleted_count: usize,
    pub skipped_count: usize,
    pub errors: Vec<String>,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub is_running: bool,
    pub phase: String,
    pub files_scanned: u64,
    pub bytes_scanned: u64,
    pub current_path: String,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSnapshotMeta {
    pub id: String,
    pub target_path: String,
    pub timestamp_unix: u64,
    pub total_bytes: u64,
    pub child_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedPathEntry {
    pub path: String,
    pub label: String,
    pub added_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAppItem {
    pub id: String,
    pub name: String,
    pub version: String,
    pub publisher: String,
    pub install_location: Option<String>,
    pub size_bytes: u64,
    pub uninstall_command: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub location_label: String,
    pub reason: String,
    pub confidence: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub modified_days_ago: u64,
    pub is_protected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppsAndLeftoversReport {
    pub apps: Vec<InstalledAppItem>,
    pub leftovers: Vec<LeftoverItem>,
    pub redist_items: Vec<DevJunkItem>,
    pub total_leftover_bytes: u64,
    pub total_redist_bytes: u64,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationStatus {
    pub supported: bool,
    pub context_menu_enabled: bool,
    pub startup_path: Option<String>,
}
