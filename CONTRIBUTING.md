# Contributing to Onyx

Thank you for your interest in contributing to **Onyx**! We aim to keep both the systems-level Rust codebase and the React Bento interface fast, safe, and clean.

## Local Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/<your-username>/onyx.git
   cd onyx
   ```
2. Install frontend dependencies:
   ```bash
   npm install
   ```
3. Launch Onyx in native desktop development mode:
   ```bash
   npm run tauri:dev
   ```

## Engineering Guidelines

- **Rust Backend (`src-tauri/`):**
  - Run `cargo fmt` and `cargo clippy --manifest-path src-tauri/Cargo.toml` before submitting changes.
  - Every file deletion path **must** pass `safety::is_safe_deletion_path` and route through the OS Recycle Bin / Trash (`trash` crate on Linux/macOS, `SHFileOperationW` with `FOF_ALLOWUNDO` on Windows).
  - Execute heavy filesystem I/O inside `tauri::async_runtime::spawn_blocking` and `rayon` thread pools so the UI thread remains responsive at 60+ FPS.
- **Frontend (`src/`):**
  - Maintain strict TypeScript compilation (`npm run build` must succeed with zero errors).
  - Follow the Obsidian Bento design language (`#050505` background, `border-white/10` hairline borders, `tabular-nums` for byte/percentage readouts, and `Framer Motion` spring interactions).
  - Add any new user-facing strings to both `en` (default) and `ru` dictionaries in `src/lib/i18n.ts`.

## Pull Request Checklist

- [ ] `npm run build` succeeds with zero TypeScript or Vite warnings/errors.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --lib` passes all safety tests.
- [ ] Both English (`EN`) and Russian (`RU`) translations are updated if UI text changed.
