pub mod cleaner;
pub mod duplicates;
pub mod history;
pub mod models;
pub mod safety;
pub mod scanner;
pub mod spacelens;

use models::{
    CleanupHistoryEntry, DevJunkScanReport, DirectoryEntry, DuplicatesReport, ExtensionsReport,
    LargeFilesReport, PurgeReport, SpaceLensReport, SystemCacheReport, SystemOverview, TrashTarget,
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
