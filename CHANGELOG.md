# Changelog

All notable changes to **Onyx** will be documented in this file.

## [1.0.0] — 2026-11-25

### Added
- **Native Desktop Architecture:** Tauri v2 + multi-threaded Rust backend (`sysinfo`, `jwalk`, `rayon`, `sha2`, `trash` / Win32 `SHFileOperationW`) paired with a native Win32 + WebView2 GUI window on Windows (`onyx.exe`) and WebKitGTK on Linux (`Onyx_1.0.0_amd64.deb`).
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
