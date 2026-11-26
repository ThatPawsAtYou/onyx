use std::path::{Component, Path};

/// Verifies that a target path is safe to send to the system Trash / Recycle Bin
/// and never points to critical operating system roots or user home root itself.
pub fn is_safe_deletion_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    // Reject relative traversal tricks
    for comp in path.components() {
        if matches!(comp, Component::ParentDir) {
            return Err("Relative parent directory traversal is forbidden.".to_string());
        }
    }

    let normalized = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    let s = normalized.to_string_lossy();
    let lower = s.to_lowercase().replace('\\', "/");
    let trimmed = lower.trim_end_matches('/');

    // Root drives ("", "c:", "d:", etc.)
    if trimmed.is_empty() || (trimmed.len() == 2 && trimmed.ends_with(':')) {
        return Err(format!("Refusing to delete drive root: {}", s));
    }

    // Protected Unix & macOS system paths
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
    ];

    if protected_exact.contains(&trimmed) {
        return Err(format!("Protected operating system directory: {}", s));
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
        "c:/windows/system32",
        "c:/windows/syswow64",
        "c:/windows/winsxs",
        "c:/program files/",
        "c:/program files (x86)/",
    ];

    for prefix in protected_prefixes {
        if trimmed.starts_with(prefix) {
            return Err(format!("Protected operating system path: {}", s));
        }
    }

    // Never allow deleting the user's entire home folder directly
    if let Some(home) = user_home_dir() {
        let home_norm = home
            .canonicalize()
            .unwrap_or(home)
            .to_string_lossy()
            .to_lowercase()
            .replace('\\', "/");
        if trimmed == home_norm.trim_end_matches('/') {
            return Err("Refusing to delete the user home directory.".to_string());
        }
    }

    Ok(())
}

pub fn user_home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
}
