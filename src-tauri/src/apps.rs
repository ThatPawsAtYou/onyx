use crate::models::{
    AppsAndLeftoversReport, DevJunkItem, InstalledAppItem, LeftoverItem, ShellIntegrationStatus,
};
use crate::progress::{is_scan_cancelled, ScanSessionGuard};
use crate::safety::{
    is_reparse_or_symlink, normalize_path_buf, normalize_path_string, resolve_clean_path,
    user_home_dir,
};
use crate::scanner::compute_dir_stats;
use crate::whitelist::is_path_protected;
use rayon::prelude::*;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

fn days_since_modified(modified: Option<SystemTime>) -> u64 {
    let Some(mtime) = modified else { return 0 };
    SystemTime::now()
        .duration_since(mtime)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

fn extract_brand_tokens(text: &str, out: &mut HashSet<String>) {
    let lower = text.to_lowercase();
    let cleaned: String = lower
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    let full_compact: String = lower.chars().filter(|c| c.is_alphanumeric()).collect();
    if full_compact.len() >= 3 {
        out.insert(full_compact);
    }
    for tok in cleaned.split_whitespace() {
        if tok.len() >= 3
            && !matches!(
                tok,
                "inc"
                    | "llc"
                    | "ltd"
                    | "corp"
                    | "corporation"
                    | "software"
                    | "technologies"
                    | "app"
                    | "application"
                    | "the"
                    | "for"
                    | "desktop"
                    | "client"
                    | "launcher"
                    | "setup"
                    | "x64"
                    | "x86"
            )
        {
            out.insert(tok.to_string());
        }
    }
}

fn is_system_vendor_folder(folder_name: &str) -> bool {
    let lower = folder_name.trim().to_lowercase();
    if lower.starts_with('.') && lower.len() <= 2 {
        return true;
    }
    matches!(
        lower.as_str(),
        "microsoft"
            | "windows"
            | "windowsapps"
            | "packages"
            | "connecteddevicesplatform"
            | "comms"
            | "publishers"
            | "temp"
            | "tmp"
            | "d3dscache"
            | "crashdumps"
            | "programs"
            | "application data"
            | "history"
            | "twain_32"
            | "assembly"
            | "cef"
            | "squirreltemp"
            | "onyx"
            | "onyx-disk-manager"
            | "com.onyx.diskcleaner"
            | "webview2"
            | "nvidia"
            | "nvidia corporation"
            | "amd"
            | "ati"
            | "intel"
            | "realtek"
            | "dolby"
            | "openal"
            | "vulkan"
            | "khronos"
            | "google"
            | "chromium"
            | "mozilla"
            | "bravesoftware"
            | "apple"
            | "apple computer"
            | "nuget"
            | "npm-cache"
            | "pnpm"
            | "pnpm-cache"
            | "yarn"
            | "pip"
            | "cargo"
            | "rustup"
            | "go-build"
            | "fontconfig"
            | "gtk-2.0"
            | "gtk-3.0"
            | "gtk-4.0"
            | "glib-2.0"
            | "dconf"
            | "pulse"
            | "pipewire"
            | "systemd"
            | "ibus"
            | "fcitx"
            | "mime"
            | "icons"
            | "themes"
            | "applications"
            | "keyrings"
            | "pki"
            | "gnupg"
            | "ssh"
            | "trash"
            | "gvfs-metadata"
            | "evolution"
            | "tracker"
            | "mesa_shader_cache"
            | "mesa_shader_cache_db"
            | "thumbnails"
            | "xorg"
            | "wayland"
            | "autostart"
            | "menus"
            | "user-dirs.dirs"
    )
}

#[cfg(windows)]
mod win_reg {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegEnumKeyExW, RegOpenKeyExW,
        RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ,
        KEY_WOW64_32KEY, KEY_WOW64_64KEY, KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    unsafe fn query_reg_string(hkey: HKEY, name: &str) -> Option<String> {
        let wide_name = to_wide(name);
        let mut val_type: u32 = 0;
        let mut byte_len: u32 = 0;
        let rc = RegQueryValueExW(
            hkey,
            wide_name.as_ptr(),
            null(),
            &mut val_type,
            null_mut(),
            &mut byte_len,
        );
        if rc != 0 || byte_len < 2 || (val_type != REG_SZ && val_type != 2) {
            return None;
        }
        let u16_cap = (byte_len as usize / 2) + 1;
        let mut buf: Vec<u16> = vec![0u16; u16_cap];
        let mut actual_bytes = byte_len;
        let rc2 = RegQueryValueExW(
            hkey,
            wide_name.as_ptr(),
            null(),
            &mut val_type,
            buf.as_mut_ptr() as *mut u8,
            &mut actual_bytes,
        );
        if rc2 != 0 {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        let s = String::from_utf16_lossy(&buf[..end]).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }

    unsafe fn query_reg_dword(hkey: HKEY, name: &str) -> Option<u32> {
        let wide_name = to_wide(name);
        let mut val_type: u32 = 0;
        let mut data: u32 = 0;
        let mut byte_len: u32 = 4;
        let rc = RegQueryValueExW(
            hkey,
            wide_name.as_ptr(),
            null(),
            &mut val_type,
            &mut data as *mut u32 as *mut u8,
            &mut byte_len,
        );
        if rc == 0 && val_type == REG_DWORD {
            Some(data)
        } else {
            None
        }
    }

    unsafe fn set_reg_string(hkey: HKEY, value_name: Option<&str>, value: &str) -> Result<(), String> {
        let name_wide = value_name.map(to_wide);
        let val_wide = to_wide(value);
        let rc = RegSetValueExW(
            hkey,
            name_wide.as_ref().map_or(null(), |v| v.as_ptr()),
            0,
            REG_SZ,
            val_wide.as_ptr() as *const u8,
            (val_wide.len() * 2) as u32,
        );
        if rc == 0 {
            Ok(())
        } else {
            Err(format!("RegSetValueExW failed with Win32 code {}", rc))
        }
    }

    pub fn collect_windows_installed_apps() -> Vec<InstalledAppItem> {
        let hives: [(HKEY, &str, u32, &str); 3] = [
            (
                HKEY_LOCAL_MACHINE,
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
                KEY_READ | KEY_WOW64_64KEY,
                "Win64 Registry",
            ),
            (
                HKEY_LOCAL_MACHINE,
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
                KEY_READ | KEY_WOW64_32KEY,
                "Win32 Registry",
            ),
            (
                HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
                KEY_READ,
                "User Registry",
            ),
        ];

        let mut seen_names = HashSet::new();
        let mut apps = Vec::new();

        for (root_hive, subkey_path, sam, source_label) in hives {
            if is_scan_cancelled() {
                break;
            }
            unsafe {
                let mut h_uninstall: HKEY = null_mut();
                let wide_sub = to_wide(subkey_path);
                if RegOpenKeyExW(root_hive, wide_sub.as_ptr(), 0, sam, &mut h_uninstall) != 0 {
                    continue;
                }

                let mut index: u32 = 0;
                loop {
                    let mut key_buf = [0u16; 260];
                    let mut key_len: u32 = key_buf.len() as u32;
                    let rc = RegEnumKeyExW(
                        h_uninstall,
                        index,
                        key_buf.as_mut_ptr(),
                        &mut key_len,
                        null(),
                        null_mut(),
                        null_mut(),
                        null_mut(),
                    );
                    if rc != 0 {
                        break;
                    }
                    index += 1;

                    let child_name = String::from_utf16_lossy(&key_buf[..key_len as usize]);
                    let child_wide = to_wide(&child_name);
                    let mut h_app: HKEY = null_mut();
                    if RegOpenKeyExW(h_uninstall, child_wide.as_ptr(), 0, sam, &mut h_app) != 0 {
                        continue;
                    }

                    let sys_comp = query_reg_dword(h_app, "SystemComponent").unwrap_or(0);
                    let release_type = query_reg_string(h_app, "ReleaseType").unwrap_or_default();
                    let parent_key = query_reg_string(h_app, "ParentKeyName");
                    let display_name = query_reg_string(h_app, "DisplayName");

                    if sys_comp != 1
                        && parent_key.is_none()
                        && !matches!(
                            release_type.as_str(),
                            "Security Update" | "Update Rollup" | "Hotfix"
                        )
                    {
                        if let Some(name) = display_name {
                            if !name.starts_with("KB")
                                && seen_names.insert(name.to_lowercase())
                            {
                                let version = query_reg_string(h_app, "DisplayVersion")
                                    .unwrap_or_else(|| "—".to_string());
                                let publisher = query_reg_string(h_app, "Publisher")
                                    .unwrap_or_else(|| "Unknown Publisher".to_string());
                                let install_location = query_reg_string(h_app, "InstallLocation")
                                    .map(|s| normalize_path_string(Path::new(s.trim_matches('"'))))
                                    .filter(|s| !s.is_empty());
                                let est_kb = query_reg_dword(h_app, "EstimatedSize").unwrap_or(0);
                                let size_bytes = (est_kb as u64).saturating_mul(1024);
                                let uninstall_command = query_reg_string(h_app, "UninstallString");

                                apps.push(InstalledAppItem {
                                    id: format!("app-{}-{}", source_label, child_name),
                                    name,
                                    version,
                                    publisher,
                                    install_location,
                                    size_bytes,
                                    uninstall_command,
                                    source: source_label.to_string(),
                                });
                            }
                        }
                    }

                    let _ = RegCloseKey(h_app);
                }

                let _ = RegCloseKey(h_uninstall);
            }
        }

        // Fill missing sizes in parallel for apps that have an existing InstallLocation
        apps.par_iter_mut().for_each(|app| {
            if app.size_bytes == 0 {
                if let Some(ref loc) = app.install_location {
                    let p = Path::new(loc);
                    if p.exists() && p.is_dir() && p.parent().is_some() {
                        app.size_bytes = compute_dir_stats(p).0;
                    }
                }
            }
        });

        apps.sort_by(|a, b| {
            b.size_bytes
                .cmp(&a.size_bytes)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        apps
    }

    pub fn is_context_menu_registered() -> bool {
        unsafe {
            let sub = to_wide(r"Software\Classes\Directory\shell\Onyx\command");
            let mut hkey: HKEY = null_mut();
            let rc = RegOpenKeyExW(HKEY_CURRENT_USER, sub.as_ptr(), 0, KEY_READ, &mut hkey);
            if rc == 0 {
                let _ = RegCloseKey(hkey);
                true
            } else {
                false
            }
        }
    }

    pub fn configure_context_menu(enabled: bool) -> Result<bool, String> {
        let targets = [
            r"Software\Classes\Directory\shell\Onyx",
            r"Software\Classes\Directory\Background\shell\Onyx",
        ];

        unsafe {
            if !enabled {
                for key_path in targets {
                    let wide = to_wide(key_path);
                    let _ = RegDeleteTreeW(HKEY_CURRENT_USER, wide.as_ptr());
                }
                return Ok(false);
            }

            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let clean_exe = normalize_path_string(&exe_path);
            let icon_val = format!("{},0", clean_exe);
            let cmd_val = format!("\"{}\" \"%V\"", clean_exe);

            for base_key in targets {
                let wide_base = to_wide(base_key);
                let mut h_base: HKEY = null_mut();
                let mut disp: u32 = 0;
                let rc = RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    wide_base.as_ptr(),
                    0,
                    null(),
                    REG_OPTION_NON_VOLATILE,
                    KEY_WRITE,
                    null(),
                    &mut h_base,
                    &mut disp,
                );
                if rc != 0 {
                    return Err(format!("Failed to create HKCU shell key (code {})", rc));
                }
                set_reg_string(h_base, None, "Inspect in Onyx")?;
                set_reg_string(h_base, Some("MUIVerb"), "Inspect in Onyx")?;
                set_reg_string(h_base, Some("Icon"), &icon_val)?;
                let _ = RegCloseKey(h_base);

                let cmd_key_path = format!(r"{}\command", base_key);
                let wide_cmd = to_wide(&cmd_key_path);
                let mut h_cmd: HKEY = null_mut();
                let rc2 = RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    wide_cmd.as_ptr(),
                    0,
                    null(),
                    REG_OPTION_NON_VOLATILE,
                    KEY_WRITE,
                    null(),
                    &mut h_cmd,
                    &mut disp,
                );
                if rc2 != 0 {
                    return Err(format!("Failed to create command subkey (code {})", rc2));
                }
                set_reg_string(h_cmd, None, &cmd_val)?;
                let _ = RegCloseKey(h_cmd);
            }
        }

        Ok(true)
    }
}

#[cfg(not(windows))]
fn collect_unix_installed_apps() -> Vec<InstalledAppItem> {
    let mut desktop_dirs = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
        PathBuf::from("/var/lib/flatpak/exports/share/applications"),
    ];
    if let Some(home) = user_home_dir() {
        desktop_dirs.push(home.join(".local/share/applications"));
        desktop_dirs.push(home.join(".local/share/flatpak/exports/share/applications"));
    }

    let mut seen_names = HashSet::new();
    let mut apps = Vec::new();

    for dir in desktop_dirs {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("desktop") {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&p) else { continue };
            let mut name = None;
            let mut exec_bin = None;
            let mut no_display = false;
            let mut version = None;
            let mut comment = None;
            let mut in_main = false;

            for line in raw.lines() {
                let t = line.trim();
                if t.starts_with('[') {
                    in_main = t == "[Desktop Entry]";
                    continue;
                }
                if !in_main {
                    continue;
                }
                if let Some(v) = t.strip_prefix("Name=") {
                    if name.is_none() {
                        name = Some(v.trim().to_string());
                    }
                } else if let Some(v) = t.strip_prefix("Exec=") {
                    exec_bin = v
                        .split_whitespace()
                        .next()
                        .map(|s| s.trim_matches('"').to_string());
                } else if let Some(v) = t.strip_prefix("NoDisplay=") {
                    no_display = v.trim().eq_ignore_ascii_case("true");
                } else if let Some(v) = t.strip_prefix("X-AppImage-Version=")
                    .or_else(|| t.strip_prefix("Version="))
                {
                    version = Some(v.trim().to_string());
                } else if let Some(v) = t.strip_prefix("Vendor=")
                    .or_else(|| t.strip_prefix("Categories="))
                {
                    if comment.is_none() {
                        comment = Some(
                            v.trim_matches(';')
                                .split(';')
                                .next()
                                .unwrap_or("Desktop Application")
                                .to_string(),
                        );
                    }
                }
            }

            if no_display {
                continue;
            }
            if let Some(app_name) = name.filter(|s| !s.is_empty()) {
                if !seen_names.insert(app_name.to_lowercase()) {
                    continue;
                }
                let mut bin_size = 0u64;
                let mut install_loc = None;
                if let Some(ref bin) = exec_bin {
                    let bp = if bin.starts_with('/') {
                        PathBuf::from(bin)
                    } else {
                        PathBuf::from("/usr/bin").join(bin)
                    };
                    if let Ok(meta) = fs::symlink_metadata(&bp) {
                        bin_size = meta.len();
                        install_loc = Some(normalize_path_string(&bp));
                    }
                }

                apps.push(InstalledAppItem {
                    id: format!("app-{}", p.file_name().unwrap_or_default().to_string_lossy()),
                    name: app_name,
                    version: version.unwrap_or_else(|| "System".to_string()),
                    publisher: comment.unwrap_or_else(|| "Linux Package".to_string()),
                    install_location: install_loc,
                    size_bytes: bin_size,
                    uninstall_command: None,
                    source: "Desktop Entry".to_string(),
                });
            }
        }
    }

    // Also inspect Flatpak ~/.var/app/* data directories if present
    if let Some(home) = user_home_dir() {
        let flatpak_data = home.join(".var/app");
        if let Ok(rd) = fs::read_dir(&flatpak_data) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let app_id = entry.file_name().to_string_lossy().to_string();
                    if seen_names.insert(app_id.to_lowercase()) {
                        let (sz, _, _) = compute_dir_stats(&p);
                        apps.push(InstalledAppItem {
                            id: format!("flatpak-{}", app_id),
                            name: app_id,
                            version: "Flatpak".to_string(),
                            publisher: "Flathub Sandbox".to_string(),
                            install_location: Some(normalize_path_string(&p)),
                            size_bytes: sz,
                            uninstall_command: None,
                            source: "Flatpak".to_string(),
                        });
                    }
                }
            }
        }
    }

    apps.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    apps
}

fn scan_game_redistributables(custom_root: Option<&str>) -> Vec<DevJunkItem> {
    let mut candidate_roots: Vec<PathBuf> = Vec::new();

    if let Some(r) = custom_root.filter(|s| !s.trim().is_empty()) {
        let p = resolve_clean_path(Path::new(r));
        if p.exists() {
            candidate_roots.push(p);
        }
    }

    #[cfg(windows)]
    {
        for drive_letter in [b'C', b'D', b'E', b'F', b'G'] {
            let d = format!("{}:\\", drive_letter as char);
            let steam_a = PathBuf::from(format!(r"{}Program Files (x86)\Steam\steamapps\common", d));
            let steam_b = PathBuf::from(format!(r"{}SteamLibrary\steamapps\common", d));
            let games_dir = PathBuf::from(format!(r"{}Games", d));
            for cand in [steam_a, steam_b, games_dir] {
                if cand.exists() && cand.is_dir() {
                    candidate_roots.push(cand);
                }
            }
        }
    }

    #[cfg(not(windows))]
    if let Some(home) = user_home_dir() {
        let steam_linux = home.join(".local/share/Steam/steamapps/common");
        if steam_linux.exists() {
            candidate_roots.push(steam_linux);
        }
    }

    let mut seen_paths = HashSet::new();
    let mut redist_dirs: Vec<(PathBuf, String)> = Vec::new();

    for root in candidate_roots {
        let Ok(rd) = fs::read_dir(&root) else { continue };
        for game_entry in rd.flatten() {
            if is_scan_cancelled() {
                break;
            }
            let game_path = game_entry.path();
            if !game_path.is_dir() {
                continue;
            }
            let game_name = game_entry.file_name().to_string_lossy().to_string();
            for sub_rel in ["_CommonRedist", "DirectXRedist", "__Installer\\vc", "__Installer\\directx"] {
                let target = normalize_path_buf(&game_path.join(sub_rel.replace('\\', std::path::MAIN_SEPARATOR_STR)));
                if target.exists() && target.is_dir() && seen_paths.insert(target.clone()) {
                    redist_dirs.push((target, game_name.clone()));
                }
            }
        }
    }

    let mut items: Vec<DevJunkItem> = redist_dirs
        .par_iter()
        .filter_map(|(dir_path, game_name)| {
            let (sz, count, mtime) = compute_dir_stats(dir_path);
            if sz < 64 * 1024 {
                return None;
            }
            let clean_str = normalize_path_string(dir_path);
            let folder_name = dir_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "_CommonRedist".to_string());
            let protected = is_path_protected(dir_path);
            Some(DevJunkItem {
                id: format!("redist-{}", clean_str),
                category: "game_redist".to_string(),
                ecosystem: "Game Redistributables (DirectX / VC++)".to_string(),
                project_name: format!("{} / {}", game_name, folder_name),
                path: clean_str,
                size_bytes: sz,
                file_count: count,
                modified_days_ago: days_since_modified(mtime),
                is_protected: protected,
            })
        })
        .collect();

    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    items
}

pub fn scan_apps_and_leftovers(custom_root: Option<String>) -> AppsAndLeftoversReport {
    let _guard = ScanSessionGuard::start("apps_leftovers");
    let started = Instant::now();

    #[cfg(windows)]
    let apps = win_reg::collect_windows_installed_apps();
    #[cfg(not(windows))]
    let apps = collect_unix_installed_apps();

    // Build installed brand/app token set so active applications are never flagged as leftovers
    let mut installed_tokens = HashSet::new();
    for app in &apps {
        extract_brand_tokens(&app.name, &mut installed_tokens);
        extract_brand_tokens(&app.publisher, &mut installed_tokens);
        if let Some(ref loc) = app.install_location {
            if let Some(fname) = Path::new(loc).file_name() {
                extract_brand_tokens(&fname.to_string_lossy(), &mut installed_tokens);
            }
        }
    }

    // Collect AppData / XDG directories to inspect for orphaned leftovers
    let mut search_roots: Vec<(PathBuf, &'static str)> = Vec::new();
    if let Some(home) = user_home_dir() {
        #[cfg(windows)]
        {
            let roaming = std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("AppData").join("Roaming"));
            let local = std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("AppData").join("Local"));
            if roaming.exists() {
                search_roots.push((normalize_path_buf(&roaming), "AppData\\Roaming"));
            }
            if local.exists() {
                search_roots.push((normalize_path_buf(&local), "AppData\\Local"));
            }
        }
        #[cfg(not(windows))]
        {
            let cfg = home.join(".config");
            let cache = home.join(".cache");
            let share = home.join(".local/share");
            if cfg.exists() {
                search_roots.push((normalize_path_buf(&cfg), "~/.config"));
            }
            if cache.exists() {
                search_roots.push((normalize_path_buf(&cache), "~/.cache"));
            }
            if share.exists() {
                search_roots.push((normalize_path_buf(&share), "~/.local/share"));
            }
        }
    }

    let mut candidate_dirs: Vec<(PathBuf, &'static str, String)> = Vec::new();
    let mut seen_candidates = HashSet::new();

    for (root, label) in search_roots {
        let Ok(rd) = fs::read_dir(&root) else { continue };
        for entry in rd.flatten() {
            let p = normalize_path_buf(&entry.path());
            let Ok(meta) = fs::symlink_metadata(&p) else { continue };
            if !meta.is_dir() || is_reparse_or_symlink(&meta) {
                continue;
            }
            let folder_name = entry.file_name().to_string_lossy().to_string();
            if is_system_vendor_folder(&folder_name) {
                continue;
            }

            let mut dir_tokens = HashSet::new();
            extract_brand_tokens(&folder_name, &mut dir_tokens);
            let matches_installed = dir_tokens.iter().any(|tok| installed_tokens.contains(tok));
            if matches_installed {
                continue;
            }

            if seen_candidates.insert(p.clone()) {
                candidate_dirs.push((p, label, folder_name));
            }
        }
    }

    let mut leftovers: Vec<LeftoverItem> = candidate_dirs
        .par_iter()
        .filter_map(|(dir_path, loc_label, folder_name)| {
            if is_scan_cancelled() {
                return None;
            }
            let (sz, count, mtime) = compute_dir_stats(dir_path);
            if sz < 128 * 1024 {
                return None;
            }
            let days = days_since_modified(mtime);
            let is_cache_loc = loc_label.contains("cache") || folder_name.to_lowercase().contains("cache");
            // Require inactivity >= 14 days for AppData/config folders, or >= 3 days for orphaned cache folders
            let min_days = if is_cache_loc { 3 } else { 14 };
            if days < min_days {
                return None;
            }

            let clean_str = normalize_path_string(dir_path);
            let protected = is_path_protected(dir_path);
            let (reason, confidence) = if days >= 60 {
                ("No matching installed app · Inactive > 60d", "high")
            } else if is_cache_loc {
                ("Orphaned application cache directory", "high")
            } else {
                ("Unmatched application data folder", "medium")
            };

            Some(LeftoverItem {
                id: format!("leftover-{}", clean_str),
                name: folder_name.clone(),
                path: clean_str,
                location_label: (*loc_label).to_string(),
                reason: reason.to_string(),
                confidence: confidence.to_string(),
                size_bytes: sz,
                file_count: count,
                modified_days_ago: days,
                is_protected: protected,
            })
        })
        .collect();

    leftovers.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let total_leftover_bytes = leftovers.iter().map(|x| x.size_bytes).sum();

    let redist_items = scan_game_redistributables(custom_root.as_deref());
    let total_redist_bytes = redist_items.iter().map(|x| x.size_bytes).sum();

    AppsAndLeftoversReport {
        apps,
        leftovers,
        redist_items,
        total_leftover_bytes,
        total_redist_bytes,
        duration_ms: started.elapsed().as_millis(),
    }
}

pub fn detect_startup_target_path() -> Option<String> {
    for arg in std::env::args().skip(1) {
        let trimmed = arg.trim().trim_matches('"');
        if trimmed.is_empty() || trimmed.starts_with('-') {
            continue;
        }
        let p = resolve_clean_path(Path::new(trimmed));
        if p.exists() {
            if p.is_dir() {
                return Some(normalize_path_string(&p));
            } else if let Some(parent) = p.parent() {
                return Some(normalize_path_string(parent));
            }
        }
    }
    None
}

pub fn get_shell_integration_status() -> ShellIntegrationStatus {
    #[cfg(windows)]
    let enabled = win_reg::is_context_menu_registered();
    #[cfg(not(windows))]
    let enabled = false;

    ShellIntegrationStatus {
        supported: cfg!(windows),
        context_menu_enabled: enabled,
        startup_path: detect_startup_target_path(),
    }
}

pub fn set_explorer_context_menu(enabled: bool) -> Result<ShellIntegrationStatus, String> {
    #[cfg(windows)]
    {
        let state = win_reg::configure_context_menu(enabled)?;
        Ok(ShellIntegrationStatus {
            supported: true,
            context_menu_enabled: state,
            startup_path: detect_startup_target_path(),
        })
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("Windows Explorer integration is only supported on Windows 10/11.".to_string())
    }
}

/// Safely launches a registered application uninstaller on Windows without shell injection.
pub fn launch_app_uninstaller(uninstall_cmd: &str) -> Result<(), String> {
    let raw = uninstall_cmd.trim();
    if raw.is_empty() {
        return Err("No uninstaller command registered for this application.".to_string());
    }

    #[cfg(windows)]
    {
        let (exe, rest_args) = if let Some(stripped) = raw.strip_prefix('"') {
            if let Some(end_q) = stripped.find('"') {
                (&stripped[..end_q], stripped[end_q + 1..].trim())
            } else {
                (stripped, "")
            }
        } else if let Some(exe_end) = raw.to_lowercase().find(".exe") {
            let split_idx = exe_end + 4;
            (&raw[..split_idx], raw[split_idx..].trim())
        } else {
            let mut parts = raw.splitn(2, char::is_whitespace);
            (parts.next().unwrap_or(raw), parts.next().unwrap_or("").trim())
        };

        let mut cmd = std::process::Command::new(exe);
        if !rest_args.is_empty() {
            for token in rest_args.split_whitespace() {
                cmd.arg(token);
            }
        }
        cmd.spawn()
            .map_err(|e| format!("Failed to start uninstaller ({}): {}", exe, e))?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err("Native registry uninstaller execution is only supported on Windows.".to_string())
    }
}
