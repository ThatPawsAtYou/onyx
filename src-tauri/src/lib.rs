pub mod apps;
pub mod cleaner;
pub mod duplicates;
pub mod history;
pub mod models;
pub mod progress;
pub mod safety;
pub mod scanner;
pub mod snapshots;
pub mod spacelens;
pub mod whitelist;

use models::{
    AppsAndLeftoversReport, CleanupHistoryEntry, DevJunkScanReport, DirectoryEntry,
    DuplicatesReport, ExtensionsReport, LargeFilesReport, ProtectedPathEntry, PurgeReport,
    ScanProgress, ShellIntegrationStatus, SpaceLensReport, StorageSnapshotMeta, SystemCacheReport,
    SystemOverview, TrashTarget,
};

#[tauri::command]
async fn get_system_overview() -> Result<SystemOverview, String> {
    tauri::async_runtime::spawn_blocking(scanner::collect_system_overview)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_dev_junk(custom_roots: Option<Vec<String>>) -> Result<DevJunkScanReport, String> {
    tauri::async_runtime::spawn_blocking(move || scanner::scan_dev_junk(custom_roots))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_system_cache() -> Result<SystemCacheReport, String> {
    tauri::async_runtime::spawn_blocking(scanner::scan_system_cache)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_large_files(
    root_path: Option<String>,
    min_size_mb: Option<u64>,
) -> Result<LargeFilesReport, String> {
    tauri::async_runtime::spawn_blocking(move || scanner::scan_large_files(root_path, min_size_mb))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_space_lens(target_path: Option<String>) -> Result<SpaceLensReport, String> {
    tauri::async_runtime::spawn_blocking(move || spacelens::scan_space_lens(target_path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_duplicates(
    root_path: Option<String>,
    min_size_kb: Option<u64>,
) -> Result<DuplicatesReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        duplicates::scan_duplicate_files(root_path, min_size_kb)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_extensions(root_path: Option<String>) -> Result<ExtensionsReport, String> {
    tauri::async_runtime::spawn_blocking(move || spacelens::scan_extension_stats(root_path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_apps_and_leftovers(
    custom_root: Option<String>,
) -> Result<AppsAndLeftoversReport, String> {
    tauri::async_runtime::spawn_blocking(move || apps::scan_apps_and_leftovers(custom_root))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_scan_progress() -> ScanProgress {
    progress::current_scan_progress()
}

#[tauri::command]
fn cancel_active_scan() {
    progress::cancel_active_scan();
}

#[tauri::command]
fn list_protected_paths() -> Vec<ProtectedPathEntry> {
    whitelist::list_protected_paths()
}

#[tauri::command]
fn add_protected_path(path: String, label: Option<String>) -> Result<Vec<ProtectedPathEntry>, String> {
    whitelist::add_protected_path(&path, label)
}

#[tauri::command]
fn remove_protected_path(path: String) -> Result<Vec<ProtectedPathEntry>, String> {
    whitelist::remove_protected_path(&path)
}

#[tauri::command]
async fn save_space_snapshot(target_path: String) -> Result<StorageSnapshotMeta, String> {
    tauri::async_runtime::spawn_blocking(move || spacelens::capture_space_baseline(target_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_space_snapshots() -> Vec<StorageSnapshotMeta> {
    snapshots::list_snapshots_meta()
}

#[tauri::command]
fn delete_space_snapshot(target_path: String) -> Result<(), String> {
    snapshots::delete_snapshot_for_path(&target_path)
}

#[tauri::command]
fn get_shell_integration_status() -> ShellIntegrationStatus {
    apps::get_shell_integration_status()
}

#[tauri::command]
fn set_explorer_context_menu(enabled: bool) -> Result<ShellIntegrationStatus, String> {
    apps::set_explorer_context_menu(enabled)
}

#[tauri::command]
fn launch_app_uninstaller(uninstall_command: String) -> Result<(), String> {
    apps::launch_app_uninstaller(&uninstall_command)
}

#[tauri::command]
fn get_cleanup_history() -> Vec<CleanupHistoryEntry> {
    history::load_history()
}

#[tauri::command]
fn clear_cleanup_history() -> Result<(), String> {
    history::clear_history()
}

#[tauri::command]
async fn move_to_trash(
    targets: Vec<TrashTarget>,
    category: Option<String>,
) -> Result<PurgeReport, String> {
    tauri::async_runtime::spawn_blocking(move || cleaner::move_targets_to_trash(targets, category))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    cleaner::reveal_in_file_manager(&path)
}

#[tauri::command]
async fn list_directories(parent_path: Option<String>) -> Result<Vec<DirectoryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || scanner::list_subdirectories(parent_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_audit_report(filename: String, content: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cleaner::export_report_to_downloads(&filename, &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_system_overview,
            scan_dev_junk,
            scan_system_cache,
            scan_large_files,
            scan_space_lens,
            scan_duplicates,
            scan_extensions,
            scan_apps_and_leftovers,
            get_scan_progress,
            cancel_active_scan,
            list_protected_paths,
            add_protected_path,
            remove_protected_path,
            save_space_snapshot,
            list_space_snapshots,
            delete_space_snapshot,
            get_shell_integration_status,
            set_explorer_context_menu,
            launch_app_uninstaller,
            get_cleanup_history,
            clear_cleanup_history,
            move_to_trash,
            reveal_in_folder,
            list_directories,
            export_audit_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running Onyx Tauri application");
}
