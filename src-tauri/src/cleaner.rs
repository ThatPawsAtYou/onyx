use crate::models::{PurgeReport, TrashTarget};
use crate::safety::is_safe_deletion_path;
use crate::scanner::compute_dir_stats;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

fn estimated_target_size(path: &Path) -> u64 {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.is_file() {
            return meta.len();
        }
    }
    compute_dir_stats(path).0
}

#[cfg(not(windows))]
fn send_path_to_system_trash(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn send_path_to_system_trash(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE,
        SHFILEOPSTRUCTW,
    };

    // SHFileOperationW requires a double-null-terminated UTF-16 path string
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    wide.push(0);

    let mut op = SHFILEOPSTRUCTW {
        hwnd: std::ptr::null_mut(),
        wFunc: FO_DELETE as u32,
        pFrom: wide.as_ptr(),
        pTo: std::ptr::null(),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as u16,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };

    let code = unsafe { SHFileOperationW(&mut op) };
    if code == 0 && op.fAnyOperationsAborted == 0 {
        Ok(())
    } else {
        Err(format!(
            "Recycle Bin operation failed (Win32 code {}) for {}",
            code,
            path.display()
        ))
    }
}

fn trash_or_remove_temp_child(child: &Path) -> Result<(), String> {
    match send_path_to_system_trash(child) {
        Ok(()) => Ok(()),
        Err(trash_err) => {
            let temp_root = std::env::temp_dir();
            if child.starts_with(&temp_root) {
                if child.is_dir() {
                    fs::remove_dir_all(child).map_err(|e| e.to_string())
                } else {
                    fs::remove_file(child).map_err(|e| e.to_string())
                }
            } else {
                Err(format!("{}: {}", child.display(), trash_err))
            }
        }
    }
}

pub fn move_targets_to_trash(
    targets: Vec<TrashTarget>,
    category_label: Option<String>,
) -> PurgeReport {
    let started = Instant::now();
    let mut freed_bytes = 0u64;
    let mut deleted_count = 0usize;
    let mut skipped_count = 0usize;
    let mut errors = Vec::new();
    let sample_paths: Vec<String> = targets.iter().take(4).map(|t| t.path.clone()).collect();

    for target in targets {
        let p = Path::new(&target.path);
        if let Err(reason) = is_safe_deletion_path(p) {
            skipped_count += 1;
            errors.push(reason);
            continue;
        }

        if target.contents_only && p.is_dir() {
            match fs::read_dir(p) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        let child_path = entry.path();
                        if is_safe_deletion_path(&child_path).is_err() {
                            skipped_count += 1;
                            continue;
                        }
                        let sz = estimated_target_size(&child_path);
                        match trash_or_remove_temp_child(&child_path) {
                            Ok(()) => {
                                freed_bytes = freed_bytes.saturating_add(sz);
                                deleted_count += 1;
                            }
                            Err(e) => {
                                skipped_count += 1;
                                if errors.len() < 10 {
                                    errors.push(e);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    skipped_count += 1;
                    errors.push(format!("{}: {}", p.display(), e));
                }
            }
        } else {
            let sz = estimated_target_size(p);
            match send_path_to_system_trash(p) {
                Ok(()) => {
                    freed_bytes = freed_bytes.saturating_add(sz);
                    deleted_count += 1;
                }
                Err(e) => {
                    skipped_count += 1;
                    if errors.len() < 10 {
                        errors.push(format!("{}: {}", p.display(), e));
                    }
                }
            }
        }
    }

    if deleted_count > 0 || freed_bytes > 0 {
        crate::history::record_cleanup_event(
            category_label.as_deref().unwrap_or("cleanup"),
            freed_bytes,
            deleted_count,
            sample_paths,
        );
    }

    PurgeReport {
        freed_bytes,
        deleted_count,
        skipped_count,
        errors,
        duration_ms: started.elapsed().as_millis(),
    }
}

pub fn reveal_in_file_manager(target_path: &str) -> Result<(), String> {
    let p = Path::new(target_path);
    if !p.exists() {
        return Err(format!("Path not found: {}", target_path));
    }

    #[cfg(target_os = "windows")]
    {
        let arg = if p.is_file() {
            format!("/select,{}", p.display())
        } else {
            p.display().to_string()
        };
        Command::new("explorer")
            .arg(arg)
            .spawn()
            .map_err(|e| format!("Failed to launch Explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        if p.is_file() {
            cmd.arg("-R");
        }
        cmd.arg(p)
            .spawn()
            .map_err(|e| format!("Failed to launch Finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let dir_to_open = if p.is_file() {
            p.parent().unwrap_or(p)
        } else {
            p
        };
        Command::new("xdg-open")
            .arg(dir_to_open)
            .spawn()
            .map_err(|e| format!("Failed to launch file manager: {}", e))?;
    }

    Ok(())
}
