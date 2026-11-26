use crate::models::{PurgeReport, TrashTarget};
use crate::safety::{
    is_safe_deletion_path, normalize_path_string, resolve_clean_path, user_downloads_dir,
};
use crate::scanner::compute_dir_stats;
use rayon::prelude::*;
use std::fs;
use std::path::Path;
#[cfg(not(windows))]
use std::process::Command;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Instant;

fn estimated_target_size(path: &Path) -> u64 {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.is_file() || meta.file_type().is_symlink() {
            return meta.len();
        }
    }
    compute_dir_stats(path).0
}

#[cfg(not(windows))]
fn send_path_to_system_trash(path: &Path) -> Result<(), String> {
    let clean = resolve_clean_path(path);
    trash::delete(&clean).map_err(|e| e.to_string())
}

#[cfg(windows)]
mod win_shell {
    use core::ffi::c_void;
    use std::fs;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use windows_sys::core::GUID;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileAttributesW, GetShortPathNameW, SetFileAttributesW, FILE_ATTRIBUTE_READONLY,
        INVALID_FILE_ATTRIBUTES,
    };
    use windows_sys::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows_sys::Win32::UI::Shell::{
        ILCreateFromPathW, ILFree, SHCreateItemFromParsingName, SHFileOperationW,
        SHOpenFolderAndSelectItems, FOFX_ADDUNDORECORD, FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO,
        FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE, SHFILEOPSTRUCTW,
    };

    // CLSID_FileOperation: {3ad05575-8857-4850-9277-11b85bdb8e09}
    const CLSID_FILE_OPERATION: GUID = GUID {
        data1: 0x3ad0_5575,
        data2: 0x8857,
        data3: 0x4850,
        data4: [0x92, 0x77, 0x11, 0xb8, 0x5b, 0xdb, 0x8e, 0x09],
    };

    // IID_IFileOperation: {947aab5f-0a5c-4c13-b4d6-4bf7836fc9f8}
    const IID_IFILE_OPERATION: GUID = GUID {
        data1: 0x947a_ab5f,
        data2: 0x0a5c,
        data3: 0x4c13,
        data4: [0xb4, 0xd6, 0x4b, 0xf7, 0x83, 0x6f, 0xc9, 0xf8],
    };

    // IID_IShellItem: {43826d1e-e718-42ee-bc55-a1e261c37bfe}
    const IID_ISHELL_ITEM: GUID = GUID {
        data1: 0x4382_6d1e,
        data2: 0xe718,
        data3: 0x42ee,
        data4: [0xbc, 0x55, 0xa1, 0xe2, 0x61, 0xc3, 0x7b, 0xfe],
    };

    #[repr(C)]
    struct IUnknownVtbl {
        query_interface:
            unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32,
        add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
        release: unsafe extern "system" fn(*mut c_void) -> u32,
    }

    #[repr(C)]
    struct IFileOperationVtbl {
        base: IUnknownVtbl,
        advise: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut u32) -> i32,
        unadvise: unsafe extern "system" fn(*mut c_void, u32) -> i32,
        set_operation_flags: unsafe extern "system" fn(*mut c_void, u32) -> i32,
        set_progress_message: unsafe extern "system" fn(*mut c_void, *const u16) -> i32,
        set_progress_dialog: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
        set_properties: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
        set_owner_window: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
        apply_properties_to_item: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
        apply_properties_to_items: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
        rename_item:
            unsafe extern "system" fn(*mut c_void, *mut c_void, *const u16, *mut c_void) -> i32,
        rename_items: unsafe extern "system" fn(*mut c_void, *mut c_void, *const u16) -> i32,
        move_item: unsafe extern "system" fn(
            *mut c_void,
            *mut c_void,
            *mut c_void,
            *const u16,
            *mut c_void,
        ) -> i32,
        move_items: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut c_void) -> i32,
        copy_item: unsafe extern "system" fn(
            *mut c_void,
            *mut c_void,
            *mut c_void,
            *const u16,
            *mut c_void,
        ) -> i32,
        copy_items: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut c_void) -> i32,
        delete_item: unsafe extern "system" fn(*mut c_void, *mut c_void, *mut c_void) -> i32,
        delete_items: unsafe extern "system" fn(*mut c_void, *mut c_void) -> i32,
        new_item: unsafe extern "system" fn(
            *mut c_void,
            *mut c_void,
            u32,
            *const u16,
            *const u16,
            *mut c_void,
        ) -> i32,
        perform_operations: unsafe extern "system" fn(*mut c_void) -> i32,
        get_any_operations_aborted: unsafe extern "system" fn(*mut c_void, *mut i32) -> i32,
    }

    #[repr(C)]
    struct ComObject<V> {
        vtbl: *const V,
    }

    pub struct ComGuard {
        should_uninit: bool,
    }

    impl ComGuard {
        pub fn init() -> Self {
            let hr = unsafe { CoInitializeEx(null(), COINIT_APARTMENTTHREADED as u32) };
            // S_OK (0) or S_FALSE (1) means we must pair with CoUninitialize
            Self {
                should_uninit: hr == 0 || hr == 1,
            }
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.should_uninit {
                unsafe { CoUninitialize() };
            }
        }
    }

    pub fn wide_null(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    pub fn clear_readonly_flag(clean_win_path: &str) {
        let w = wide_null(clean_win_path);
        unsafe {
            let attrs = GetFileAttributesW(w.as_ptr());
            if attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_READONLY) != 0 {
                let _ = SetFileAttributesW(w.as_ptr(), attrs & !FILE_ATTRIBUTE_READONLY);
            }
        }
    }

    unsafe fn release_com(ptr: *mut c_void) {
        if !ptr.is_null() {
            let obj = ptr as *mut ComObject<IUnknownVtbl>;
            ((*(*obj).vtbl).release)(ptr);
        }
    }

    /// Modern Windows 10/11 Recycle Bin deletion via `IFileOperation` (supports >260 char paths).
    unsafe fn try_ifileoperation_recycle(clean_win_path: &str) -> Result<(), i32> {
        let mut pfo_raw: *mut c_void = null_mut();
        let hr_co = CoCreateInstance(
            &CLSID_FILE_OPERATION,
            null_mut(),
            CLSCTX_ALL,
            &IID_IFILE_OPERATION,
            &mut pfo_raw,
        );
        if hr_co < 0 || pfo_raw.is_null() {
            return Err(hr_co);
        }

        let pfo = pfo_raw as *mut ComObject<IFileOperationVtbl>;
        let flags = FOF_ALLOWUNDO
            | FOF_NOCONFIRMATION
            | FOF_NOERRORUI
            | FOF_SILENT
            | FOFX_ADDUNDORECORD
            | FOFX_RECYCLEONDELETE;

        let hr_flags = ((*(*pfo).vtbl).set_operation_flags)(pfo_raw, flags);
        if hr_flags < 0 {
            release_com(pfo_raw);
            return Err(hr_flags);
        }

        let wpath = wide_null(clean_win_path);
        let mut psi_raw: *mut c_void = null_mut();
        let hr_item =
            SHCreateItemFromParsingName(wpath.as_ptr(), null_mut(), &IID_ISHELL_ITEM, &mut psi_raw);
        if hr_item < 0 || psi_raw.is_null() {
            release_com(pfo_raw);
            return Err(hr_item);
        }

        let hr_del = ((*(*pfo).vtbl).delete_item)(pfo_raw, psi_raw, null_mut());
        release_com(psi_raw);
        if hr_del < 0 {
            release_com(pfo_raw);
            return Err(hr_del);
        }

        let hr_perf = ((*(*pfo).vtbl).perform_operations)(pfo_raw);
        let mut aborted: i32 = 0;
        let _ = ((*(*pfo).vtbl).get_any_operations_aborted)(pfo_raw, &mut aborted);
        release_com(pfo_raw);

        if hr_perf < 0 {
            return Err(hr_perf);
        }
        if aborted != 0 {
            return Err(-1);
        }
        Ok(())
    }

    /// Fallback Recycle Bin deletion via `SHFileOperationW` (with 8.3 short-path support for deep paths).
    unsafe fn try_shfileoperation_recycle(clean_win_path: &str) -> Result<(), i32> {
        let mut wide = wide_null(clean_win_path);

        // If path approaches MAX_PATH, try resolving 8.3 short path so SHFileOperationW succeeds
        if wide.len() >= 248 {
            let mut short_buf = vec![0u16; 1024];
            let len = GetShortPathNameW(
                wide.as_ptr(),
                short_buf.as_mut_ptr(),
                short_buf.len() as u32,
            );
            if len > 0 && (len as usize) < short_buf.len() {
                short_buf.truncate((len as usize) + 1);
                short_buf[len as usize] = 0;
                wide = short_buf;
            }
        }

        // SHFileOperationW requires double-null termination
        wide.push(0);

        let mut op = SHFILEOPSTRUCTW {
            hwnd: null_mut(),
            wFunc: FO_DELETE,
            pFrom: wide.as_ptr(),
            pTo: null(),
            fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as u16,
            fAnyOperationsAborted: 0,
            hNameMappings: null_mut(),
            lpszProgressTitle: null(),
        };

        let code = SHFileOperationW(&mut op);
        if code == 0 && op.fAnyOperationsAborted == 0 {
            Ok(())
        } else {
            Err(if code != 0 { code } else { -1 })
        }
    }

    fn humanize_win_recycle_error(code: i32) -> &'static str {
        match code as u32 {
            32 | 0x8007_0020 | 0x8027_0020 => {
                "Item is currently in use by another running application"
            }
            5 | 0x78 | 0x8007_0005 | 0x8027_0005 | 0x8027_0001 => {
                "Access denied (close open programs or run Onyx as Administrator)"
            }
            2 | 3 | 0x8007_0002 | 0x8007_0003 => "Item was already removed or moved",
            0x8027_0025 | 0x8027_0026 | 0x8027_0027 => {
                "Recycle Bin is unavailable or full on this drive"
            }
            _ => "Unable to move item to Recycle Bin (file may be locked by a running process)",
        }
    }

    pub fn recycle_path(clean_path: &Path) -> Result<(), String> {
        let _com = ComGuard::init();
        let clean_str = clean_path.to_string_lossy().to_string();

        clear_readonly_flag(&clean_str);

        let primary = unsafe { try_ifileoperation_recycle(&clean_str) };
        if primary.is_ok() && fs::symlink_metadata(clean_path).is_err() {
            return Ok(());
        }

        let fallback = unsafe { try_shfileoperation_recycle(&clean_str) };
        if fallback.is_ok() && fs::symlink_metadata(clean_path).is_err() {
            return Ok(());
        }

        // If item already vanished concurrently, treat as success
        if fs::symlink_metadata(clean_path).is_err() {
            return Ok(());
        }

        let err_code = fallback.err().or(primary.err()).unwrap_or(-1);
        Err(humanize_win_recycle_error(err_code).to_string())
    }

    pub fn reveal_in_explorer(clean_path: &Path) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let _com = ComGuard::init();
        let clean_str = clean_path.to_string_lossy().to_string();

        // For non-root files and folders, highlight exact item via SHOpenFolderAndSelectItems
        let is_drive_root = clean_str.len() <= 3 && clean_str.ends_with('\\');
        if !is_drive_root {
            let wide = wide_null(&clean_str);
            unsafe {
                let pidl = ILCreateFromPathW(wide.as_ptr());
                if !pidl.is_null() {
                    let hr = SHOpenFolderAndSelectItems(pidl, 0, null(), 0);
                    ILFree(pidl);
                    if hr >= 0 {
                        return Ok(());
                    }
                }
            }
        }

        // Fallback for drive roots ("C:\") or unusual shell namespaces
        let raw_cmd = if clean_path.is_file() {
            format!("/select,\"{}\"", clean_str)
        } else {
            format!("\"{}\"", clean_str)
        };

        std::process::Command::new("explorer.exe")
            .raw_arg(raw_cmd)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to open Windows Explorer: {}", e))?;

        Ok(())
    }
}

#[cfg(windows)]
fn send_path_to_system_trash(path: &Path) -> Result<(), String> {
    let clean = resolve_clean_path(path);
    win_shell::recycle_path(&clean)
}

/// Fast removal for ephemeral cache contents (`%TEMP%`, browser HTTP cache, npm/pip cache).
/// Clears readonly flags if needed and skips active lockfiles held by running browsers/OS.
fn remove_ephemeral_cache_child(child: &Path) -> Result<(), String> {
    let clean = resolve_clean_path(child);

    #[cfg(windows)]
    win_shell::clear_readonly_flag(&clean.to_string_lossy());

    let meta = fs::symlink_metadata(&clean).map_err(|e| e.to_string())?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        match fs::remove_dir_all(&clean) {
            Ok(()) => Ok(()),
            Err(_) => send_path_to_system_trash(&clean),
        }
    } else {
        match fs::remove_file(&clean) {
            Ok(()) => Ok(()),
            Err(_) => send_path_to_system_trash(&clean),
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
    let sample_paths: Vec<String> = targets
        .iter()
        .take(4)
        .map(|t| normalize_path_string(Path::new(&t.path)))
        .collect();

    for target in targets {
        let clean_target = resolve_clean_path(Path::new(&target.path));
        if let Err(reason) = is_safe_deletion_path(&clean_target) {
            skipped_count += 1;
            errors.push(reason);
            continue;
        }

        if target.contents_only && clean_target.is_dir() {
            match fs::read_dir(&clean_target) {
                Ok(entries) => {
                    let children: Vec<_> = entries.flatten().map(|e| e.path()).collect();
                    let bucket_freed = AtomicU64::new(0);
                    let bucket_deleted = AtomicUsize::new(0);
                    let bucket_skipped = AtomicUsize::new(0);

                    children.par_iter().for_each(|child_path| {
                        if is_safe_deletion_path(child_path).is_err() {
                            bucket_skipped.fetch_add(1, Ordering::Relaxed);
                            return;
                        }
                        let sz = estimated_target_size(child_path);
                        match remove_ephemeral_cache_child(child_path) {
                            Ok(()) => {
                                bucket_freed.fetch_add(sz, Ordering::Relaxed);
                                bucket_deleted.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(_) => {
                                // Locked cache files (e.g. open browser/OS session) are normal; skip quietly
                                bucket_skipped.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    });

                    freed_bytes =
                        freed_bytes.saturating_add(bucket_freed.load(Ordering::Relaxed));
                    deleted_count += bucket_deleted.load(Ordering::Relaxed);
                    skipped_count += bucket_skipped.load(Ordering::Relaxed);
                }
                Err(e) => {
                    skipped_count += 1;
                    errors.push(format!("{}: {}", clean_target.display(), e));
                }
            }
        } else {
            let sz = target
                .expected_bytes
                .filter(|&b| b > 0)
                .unwrap_or_else(|| estimated_target_size(&clean_target));
            match send_path_to_system_trash(&clean_target) {
                Ok(()) => {
                    freed_bytes = freed_bytes.saturating_add(sz);
                    deleted_count += 1;
                }
                Err(reason) => {
                    skipped_count += 1;
                    if errors.len() < 10 {
                        errors.push(format!("{}: {}", clean_target.display(), reason));
                    }
                }
            }
        }
    }

    // If only locked cache files remained in %TEMP% / browser cache, provide a clear explanation
    if deleted_count == 0 && skipped_count > 0 && errors.is_empty() {
        errors.push(
            "Remaining cache files are actively in use by running applications.".to_string(),
        );
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
    let clean_path = resolve_clean_path(Path::new(target_path));
    if !clean_path.exists() {
        return Err(format!("Path not found: {}", clean_path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        return win_shell::reveal_in_explorer(&clean_path);
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        if clean_path.is_file() {
            cmd.arg("-R");
        }
        cmd.arg(&clean_path)
            .spawn()
            .map_err(|e| format!("Failed to launch Finder: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let dir_to_open = if clean_path.is_file() {
            clean_path.parent().unwrap_or(&clean_path)
        } else {
            &clean_path
        };
        Command::new("xdg-open")
            .arg(dir_to_open)
            .spawn()
            .map_err(|e| format!("Failed to launch file manager: {}", e))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}

/// Saves a generated Markdown or JSON audit report directly to the user's Downloads folder.
pub fn export_report_to_downloads(filename: &str, content: &str) -> Result<String, String> {
    let safe_name: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();

    let final_name = if safe_name.is_empty() {
        "onyx-storage-audit.md".to_string()
    } else {
        safe_name
    };

    let dir = user_downloads_dir();
    let _ = fs::create_dir_all(&dir);
    let out_path = dir.join(&final_name);

    fs::write(&out_path, content.as_bytes())
        .map_err(|e| format!("Failed to save report to {}: {}", out_path.display(), e))?;

    Ok(normalize_path_string(&out_path))
}
