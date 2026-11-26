# Security Policy

Because **Onyx** inspects and cleans filesystem directories, user data safety is our highest architectural priority.

## Built-In Safety Invariants

1. **System Path Guardrails (`src-tauri/src/safety.rs`):**
   - Deletion of drive roots (`C:\`, `D:\`, `/`) and top-level user home directories is strictly blocked.
   - Critical operating system directories on Windows (`C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `C:\ProgramData`) and Unix/Linux/macOS (`/bin`, `/boot`, `/dev`, `/etc`, `/lib`, `/proc`, `/sbin`, `/sys`, `/usr`, `/System`, `/Applications`) are hardware/software-protected against modification.
   - Any path containing parent traversal segments (`..`) is rejected immediately.
2. **OS Recycle Bin / Trash Routing:**
   - Windows builds invoke `SHFileOperationW` with `FOF_ALLOWUNDO` to send items to the Windows Recycle Bin.
   - Linux and macOS builds use the `trash` crate (Freedesktop Trash / macOS Trash).
3. **Zero Network Telemetry:**
   - Onyx runs 100% offline/locally and never transmits file names, directory paths, or hardware identifiers over the network.

## Reporting a Vulnerability

If you discover a potential path-validation bypass or unsafe cache rule, please open a private **GitHub Security Advisory** under the repository's **Security** tab before disclosing details publicly.
