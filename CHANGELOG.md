# Changelog

All notable changes to **Onyx** will be documented in this file.

## [1.1.0] — 2026-11-26

### Added
- **Storage Snapshots & Diff Mode ("Where Did My Space Go?"):** Space Lens now captures compact directory snapshots (`space_snapshots.json`) and computes exact per-folder byte growth (`+Δ` in rose) and shrinkage (`-Δ` in emerald) since your last baseline, with **`Changed Only`** filtering and one-click **`Update Snapshot`** controls.
- **Game, GPU Shader & Messenger Cache Cleaner:** Expanded `scan_system_cache` and `scan_dev_junk` with safe, session-preserving targets for **DirectX (`D3DSCache`)**, **NVIDIA (`DXCache` / `GLCache`)**, **AMD (`DxCache`)**, **Mesa Shader Cache**, **Steam (`depotcache` / `shadercache`)**, **Epic Games**, **Battle.net**, **EA**, **Riot**, **Telegram Desktop** media cache, **Discord**, **Slack**, **Spotify**, **VS Code**, **Figma**, **Adobe Media Cache**, and duplicate **`_CommonRedist`** game redistributables, organized under quick category tabs (*All*, *GPU & Gaming*, *Apps & Chat*, *Browsers & OS*).
- **Installed Apps & Orphaned Leftover Hunter (`Apps & Leftovers`):** New primary workspace view enumerating installed software (`HKCU`/`HKLM` Windows Uninstall Registry on Windows; `.desktop`, Flatpak, and Snap apps on Linux) alongside an intelligent **Orphaned Leftover Hunter** that flags stale `AppData` / `~/.config` remnants from uninstalled apps with confidence scoring and Recycle Bin cleanup.
- **Protected Paths Whitelist & `.onyxignore`:** Added persistent user path protection (`protected_paths.json` via Settings, per-row Shield buttons, or Right-Click menu) plus automatic `.onyxignore` marker file detection — strictly enforced across both UI auto-selection and `cleaner::move_targets_to_trash`.
- **Windows Explorer `"Inspect in Onyx"`, Drag & Drop, Right-Click Menu & Live Stop:**
  - Per-user (`HKCU\Software\Classes\Directory\shell\OnyxInspect`) Windows Explorer folder context menu toggle requiring zero Administrator/UAC elevation, plus startup CLI target routing into Space Lens.
  - Native & HTML5 folder **Drag & Drop** overlay for instant Space Lens inspection.
  - Custom Obsidian **Right-Click Context Menu** across Space Lens, Dev Junk, Large Files, Duplicates, and Apps & Leftovers.
  - **Live Cancellable Scan Progress Bar** backed by lock-free `AtomicU64` / `AtomicBool` counters (`progress.rs`) with instant **`Stop`** cancellation.
- **WSL2 & Docker Virtual Disk (`.vhdx`) Detector:** Automatically flags bloated `.vhdx`, `.vhd`, `.vmdk`, `.vdi`, and `.qcow2` virtual disks in Large Files, hides destructive Trash buttons on virtual disks, and provides a one-click **`Copy Shrink Cmd`** button (`wsl --shutdown ; Optimize-VHD -Path "..." -Mode Full`).

### Performance Optimizations
- **Deadlock-Free Rayon Work-Stealing Space Lens:** Replaced nested `jwalk` inside `par_iter` with a 2-level `rayon::par_iter()` fan-out over sequential `WalkDir` workers (`spacelens.rs`), eliminating thread-pool starvation on massive trees like `C:\Users` while scaling cleanly across all CPU cores.
- **Zero-Allocation Hot-Path File Inspection:** Rewrote `scan_extension_stats` and `scan_large_files` to inspect `&OsStr` byte slices with stack ASCII lowercase buffers instead of allocating 2–3 heap `String`s per file, cutting millions of heap allocations on large volumes.
- **128 KB SHA-256 Hashing Buffers & Targeted Crate Optimization:** Doubled duplicate hashing stack read buffers to `128 KB` and enabled `[profile.release.package.{sha2,jwalk,walkdir,rayon}] opt-level = 3` while keeping `opt-level = "s"` binary compactness.
- **Zero-Layout-Thrash Bento Cards & Code-Split Bundle:** Memoized `BentoCard` with cached hover `DOMRect` coordinates (eliminating `getBoundingClientRect()` forced reflows on every `mousemove`), added `useDeferredValue` search filtering, and split Vite vendor chunks (`index-*.js` reduced to ~41 KB gzipped).

---

## [1.0.1] — 2026-11-25

### Fixed
- **Windows Recycle Bin `Win32 code 124` (`DE_INVALIDFILES`) Fix:** Normalized extended-length Windows verbatim paths (`\\?\C:\...`, `\\?\UNC\server\share`), `/` separators, and trailing directory backslashes before invoking Windows Shell APIs, resolving Recycle Bin errors when deleting directories and files across `C:\`, `D:\`, or custom drives.
- **Dual-Engine Windows Recycle Bin (`IFileOperation` + `SHFileOperationW`):** Upgraded Windows deletion to initialize STA COM per worker thread (`CoInitializeEx`), clear `FILE_ATTRIBUTE_READONLY` attributes that block Shell recycling, execute modern Vista+/Win11 `IFileOperation` (`FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE`), and fall back automatically to double-null-terminated `SHFileOperationW` (including `GetShortPathNameW` 8.3 fallback for paths exceeding `MAX_PATH`).
- **Windows Explorer "Reveal in Folder" Reliability:** Replaced `explorer.exe /select,"path"` command-line parsing quirks (which failed on `\\?\` prefixes or paths containing commas) with native Win32 Shell `SHOpenFolderAndSelectItems` + `ILCreateFromPathW`.
- **Native Audit Report Export in WebView2:** Added a native `export_audit_report` backend command that writes `.md` and `.json` storage reports directly to the user's `Downloads` folder (avoiding silent `blob:` download blocks in embedded WebView2 hosts) and shows the saved path.
- **Safety Path Guard Canonicalization:** Hardened `safety::is_safe_deletion_path` to compare normalized paths cleanly on Windows (`\\?\C:\Windows` vs `C:\Windows`) and protect critical directories such as `C:\ProgramData`, `C:\Recovery`, `$Recycle.Bin`, and `System Volume Information`.
- **Error Toast Styling:** Fixed error notification banner icon and layout so Recycle Bin or permission warnings render a rose `AlertTriangle` indicator with full message readability.

### Improved & Optimized
- **Instant Cleanup & Progressive Non-Blocking Scans:** `move_to_trash` now uses pre-scanned `expectedBytes` instead of re-walking multi-gigabyte `node_modules` / `target` trees prior to deletion, and overview cards render progressively as each parallel scanner finishes.
- **NTFS Junction & OneDrive Cloud-Placeholder Protection:** Skips NTFS reparse points (`FILE_ATTRIBUTE_REPARSE_POINT`) to prevent double-counting cycles and ignores unpinned OneDrive/iCloud cloud-only stubs (`FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`) during SHA-256 duplicate hashing so cloud files are neverhydrated unintentionally.
- **Accurate Live CPU Load Telemetry & Bounded Memory Heaps:** Persisted a stateful `sysinfo::System` instance for real CPU delta percentages and switched Large Files & Extension scanners to bounded `BinaryHeap` top-K collectors.
- **Multi-Drive Folder Picker & UI Polish:** Added instant drive pills (`C:\`, `D:\`, mounted volumes), `Up` button, and keyboard `Enter` navigation to the Scan Root modal, wired *Purge System Cache* in the Command Palette, and streamlined the application footer and header badges.

---

## [1.0.0] — 2026-11-25

### Added
- **Native Desktop Architecture:** Tauri v2 + multi-threaded Rust backend (`sysinfo`, `jwalk`, `rayon`, `sha2`, `trash` / Win32 Shell) paired with a native Win32 + WebView2 GUI window on Windows (`onyx.exe`) and WebKitGTK on Linux (`Onyx_1.0.0_amd64.deb`).
- **Obsidian Bento UI:** Dark-mode design system (`#050505`, `border-white/10`), cursor-tracked spotlight cards, `Framer Motion` spring physics, and offline-bundled `Geist Sans`, `Geist Mono`, and `Inter` fonts.
- **Storage Gauge Card:** Orbital disk usage indicator, physical partition switcher, multi-segment category bar, and live RAM, CPU load, and OS uptime telemetry.
- **Dev Junk Cleaner:** Parallel scanner for `node_modules`, Rust `target`, Python `.venv`/`__pycache__`, `Docker`, `.gradle`, `Pods`, `.next`, and `.turbo` with a smart project age filter (*Any age*, *Older > 7d*, *Older > 30d*).
- **System Cache Cleaner:** Safe detection and one-click animated **Purge** for OS `Temp` folders, browser caches, package manager tarballs, and crash logs.
- **Large Files Inspector:** High-volume file scanner (`> 1 GB`, `> 500 MB`, `> 100 MB`, `> 10 MB`) with category tabs and instant filename/path search.
- **Space Lens:** Interactive proportional folder treemap with subdirectory drill-down and breadcrumb navigation.
- **Smart Duplicate Finder (`SHA-256`):** Three-stage parallel duplicate detection (byte size → 8 KB edge hash → full SHA-256) with one-click *Smart Auto-Select Copies*.
- **Analytics & Cleanup Audit Log:** File extension storage breakdown, persistent local cleanup history (`cleanup_history.json`), and one-click Markdown (`.md`) / JSON (`.json`) storage audit export.
- **Command Palette (`Ctrl+K` / `⌘K`):** Keyboard-driven quick launcher across views, actions, and discovered disk items.
- **Bilingual Localization:** English (`EN`) enabled by default with instant in-app switching to Russian (`RU`).
