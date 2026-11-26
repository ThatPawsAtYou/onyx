use std::fs::Metadata;
use std::path::{Component, Path, PathBuf};

/// Converts a raw string or `Path` (including Windows verbatim `\\?\C:\...` or
/// `\\?\UNC\server\share\...` paths and mixed `/` separators) into a clean,
/// human-readable, Win32 Shell-compatible `String`.
pub fn normalize_path_str(raw: &str) -> String {
    let trimmed_ws = raw.trim();
    if trimmed_ws.is_empty() {
        return String::new();
    }

    // Detect Windows-style drive or verbatim UNC paths on any host (also unit-testable on Linux)
    let looks_windows = cfg!(windows)
        || trimmed_ws.starts_with(r"\\?\")
        || trimmed_ws.starts_with("//?/")
        || (trimmed_ws.len() >= 2
            && trimmed_ws.as_bytes()[0].is_ascii_alphabetic()
            && trimmed_ws.as_bytes()[1] == b':');

    if looks_windows {
        let mut s = trimmed_ws.replace('/', r"\");

        if let Some(rest) = s
            .strip_prefix(r"\\?\UNC\")
            .or_else(|| s.strip_prefix(r"\\?\unc\"))
        {
            s = format!(r"\\{}", rest);
        } else if let Some(rest) = s.strip_prefix(r"\\?\") {
            s = rest.to_string();
        }

        // Bare drive letter "C:" -> "C:\" so Windows treats it as drive root, not drive-relative CWD
        if s.len() == 2 && s.as_bytes()[0].is_ascii_alphabetic() && s.as_bytes()[1] == b':' {
            return format!(r"{}\", s);
        }

        // Collapse accidental double backslashes after prefix
        let (unc_prefix, body) = if let Some(after_unc) = s.strip_prefix(r"\\") {
            (r"\\", after_unc)
        } else {
            ("", s.as_str())
        };

        let mut collapsed = String::with_capacity(s.len());
        collapsed.push_str(unc_prefix);
        let mut prev_sep = false;
        for ch in body.chars() {
            if ch == '\\' {
                if !prev_sep {
                    collapsed.push('\\');
                }
                prev_sep = true;
            } else {
                collapsed.push(ch);
                prev_sep = false;
            }
        }

        // Keep trailing "\" only for drive root "C:\"
        if collapsed.len() > 3 && collapsed.ends_with('\\') && unc_prefix.is_empty() {
            collapsed.pop();
        } else if !unc_prefix.is_empty() && collapsed.len() > 2 && collapsed.ends_with('\\') {
            // Keep UNC share clean without trailing backslash
            collapsed.pop();
        }

        return collapsed;
    }

    // Unix normalization
    if trimmed_ws == "/" {
        return "/".to_string();
    }
    let mut collapsed = String::with_capacity(trimmed_ws.len());
    let mut prev_slash = false;
    for ch in trimmed_ws.chars() {
        if ch == '/' {
            if !prev_slash {
                collapsed.push('/');
            }
            prev_slash = true;
        } else {
            collapsed.push(ch);
            prev_slash = false;
        }
    }
    if collapsed.len() > 1 && collapsed.ends_with('/') {
        collapsed.pop();
    }
    collapsed
}

pub fn normalize_path_string(path: &Path) -> String {
    normalize_path_str(&path.to_string_lossy())
}

pub fn normalize_path_buf(path: &Path) -> PathBuf {
    PathBuf::from(normalize_path_string(path))
}

/// Canonicalizes `path` when possible and immediately strips Windows `\\?\`
/// verbatim prefixes so downstream UI, safety checks, Explorer, and Recycle Bin
/// always receive standard OS paths.
pub fn resolve_clean_path(path: &Path) -> PathBuf {
    let cleaned_input = normalize_path_buf(path);
    match cleaned_input.canonicalize() {
        Ok(canon) => normalize_path_buf(&canon),
        Err(_) => cleaned_input,
    }
}

/// Returns `true` if `meta` represents a symlink or a Windows NTFS reparse point
/// (directory junction, mount point, OneDrive link) that must not be recursively walked.
pub fn is_reparse_or_symlink(meta: &Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
            return true;
        }
    }
    false
}

/// Returns `true` on Windows if a file is an unhydrated cloud placeholder
/// (e.g., OneDrive Files On-Demand) where reading file bytes would trigger a
/// network download.
pub fn is_cloud_placeholder_file(meta: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
        const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
        const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
        let attrs = meta.file_attributes();
        return (attrs
            & (FILE_ATTRIBUTE_OFFLINE
                | FILE_ATTRIBUTE_RECALL_ON_OPEN
                | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS))
            != 0;
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        false
    }
}

/// Returns Onyx's internal application data directory (`%LOCALAPPDATA%\Onyx` or `~/.config/onyx`)
/// so cleanup routines never delete Onyx's own WebView2 runtime or history.
pub fn onyx_app_data_dir() -> Option<PathBuf> {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        return Some(normalize_path_buf(&PathBuf::from(local).join("Onyx")));
    }
    user_home_dir().map(|h| normalize_path_buf(&h.join(".config").join("onyx")))
}

/// Verifies that a target path is safe to send to the system Trash / Recycle Bin
/// and never points to critical operating system roots or user home root itself.
pub fn is_safe_deletion_path(path: &Path) -> Result<(), String> {
    // Reject relative parent traversal tricks before resolving
    for comp in path.components() {
        if matches!(comp, Component::ParentDir) {
            return Err("Relative parent directory traversal is forbidden.".to_string());
        }
    }

    let clean_buf = resolve_clean_path(path);
    if !clean_buf.exists() && std::fs::symlink_metadata(&clean_buf).is_err() {
        return Err(format!("Path does not exist: {}", clean_buf.display()));
    }

    if crate::whitelist::is_path_protected(&clean_buf) {
        return Err(format!(
            "Protected by Onyx Whitelist or .onyxignore: {}",
            clean_buf.display()
        ));
    }

    check_normalized_safety_rules(&clean_buf.to_string_lossy())
}

fn check_normalized_safety_rules(raw_path: &str) -> Result<(), String> {
    let clean_str = normalize_path_str(raw_path);
    let lower = clean_str.to_lowercase().replace('\\', "/");
    let trimmed = lower.trim_end_matches('/');

    // Root drives ("", "/", "c:", "d:", etc.)
    if trimmed.is_empty() || (trimmed.len() == 2 && trimmed.ends_with(':')) {
        return Err(format!("Refusing to delete drive root: {}", clean_str));
    }

    // Protected Unix, macOS & Windows system roots
    let protected_exact = [
        "/bin",
        "/boot",
        "/dev",
        "/etc",
        "/home",
        "/lib",
        "/lib64",
        "/proc",
        "/root",
        "/run",
        "/sbin",
        "/sys",
        "/usr",
        "/var",
        "/system",
        "/applications",
        "/library",
        "/users",
        "c:/windows",
        "c:/program files",
        "c:/program files (x86)",
        "c:/programdata",
        "c:/users",
        "c:/recovery",
    ];

    if protected_exact.contains(&trimmed) {
        return Err(format!(
            "Protected operating system directory: {}",
            clean_str
        ));
    }

    let protected_prefixes = [
        "/bin/",
        "/boot/",
        "/dev/",
        "/etc/",
        "/lib/",
        "/lib64/",
        "/proc/",
        "/sbin/",
        "/sys/",
        "/usr/",
        "c:/windows/",
        "c:/program files/",
        "c:/program files (x86)/",
    ];

    for prefix in protected_prefixes {
        if trimmed.starts_with(prefix) {
            return Err(format!("Protected operating system path: {}", clean_str));
        }
    }

    // Never allow deleting Onyx's own active runtime / WebView2 directory
    if let Some(app_dir) = onyx_app_data_dir() {
        let app_norm = app_dir.to_string_lossy().to_lowercase().replace('\\', "/");
        let app_trimmed = app_norm.trim_end_matches('/');
        if !app_trimmed.is_empty()
            && (trimmed == app_trimmed || trimmed.starts_with(&format!("{}/", app_trimmed)))
        {
            return Err("Protected Onyx runtime directory.".to_string());
        }
    }

    // Never allow deleting the user's entire home folder directly
    if let Some(home) = user_home_dir() {
        let home_norm = resolve_clean_path(&home)
            .to_string_lossy()
            .to_lowercase()
            .replace('\\', "/");
        if trimmed == home_norm.trim_end_matches('/') {
            return Err("Refusing to delete the user home directory.".to_string());
        }
    }

    Ok(())
}

pub fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|os| normalize_path_buf(&PathBuf::from(os)))
}

pub fn user_downloads_dir() -> PathBuf {
    if let Some(home) = user_home_dir() {
        let dl = home.join("Downloads");
        if dl.exists() && dl.is_dir() {
            return dl;
        }
        return home;
    }
    std::env::temp_dir()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn strips_windows_verbatim_and_mixed_slashes() {
        assert_eq!(normalize_path_str(r"\\?\C:\games\orion"), r"C:\games\orion");
        assert_eq!(normalize_path_str(r"\\?\C:\games\orion\"), r"C:\games\orion");
        assert_eq!(normalize_path_str(r"\\?\C:\"), r"C:\");
        assert_eq!(normalize_path_str("C:"), r"C:\");
        assert_eq!(
            normalize_path_str(r"C:\Users\User\AppData/Local/Google/Chrome/Cache"),
            r"C:\Users\User\AppData\Local\Google\Chrome\Cache"
        );
        assert_eq!(
            normalize_path_str(r"\\?\UNC\nas\share\folder\"),
            r"\\nas\share\folder"
        );
    }

    #[test]
    fn blocks_windows_verbatim_roots_and_system_dirs() {
        assert!(check_normalized_safety_rules(r"\\?\C:\").is_err());
        assert!(check_normalized_safety_rules(r"C:\").is_err());
        assert!(check_normalized_safety_rules(r"\\?\C:\Windows").is_err());
        assert!(check_normalized_safety_rules(r"\\?\C:\Windows\System32\drivers").is_err());
        assert!(check_normalized_safety_rules(r"\\?\C:\Program Files\Common Files").is_err());
        assert!(check_normalized_safety_rules(r"\\?\C:\games\orion").is_ok());
    }

    #[test]
    fn blocks_root_and_system_directories() {
        assert!(is_safe_deletion_path(Path::new("/")).is_err());
        if Path::new("/usr").exists() {
            assert!(is_safe_deletion_path(Path::new("/usr")).is_err());
        }
        if Path::new("/etc").exists() {
            assert!(is_safe_deletion_path(Path::new("/etc")).is_err());
        }
    }

    #[test]
    fn allows_ephemeral_project_artifact_folder() {
        let tmp = std::env::temp_dir().join("onyx_unit_test_node_modules");
        let _ = fs::create_dir_all(&tmp);
        assert!(is_safe_deletion_path(&tmp).is_ok());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn blocks_onyxignore_protected_project_folder() {
        let proj = std::env::temp_dir().join("onyx_unit_test_ignored_proj");
        let nm = proj.join("node_modules");
        let _ = fs::create_dir_all(&nm);
        let _ = fs::write(proj.join(".onyxignore"), "");
        assert!(is_safe_deletion_path(&nm).is_err());
        let _ = fs::remove_dir_all(&proj);
    }
}
