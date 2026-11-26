use crate::models::ScanProgress;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
static ACTIVE_SCANS: AtomicUsize = AtomicUsize::new(0);
static FILES_SCANNED: AtomicU64 = AtomicU64::new(0);
static BYTES_SCANNED: AtomicU64 = AtomicU64::new(0);
static PROGRESS_LABELS: OnceLock<Mutex<(String, String)>> = OnceLock::new();

fn labels_lock() -> &'static Mutex<(String, String)> {
    PROGRESS_LABELS.get_or_init(|| Mutex::new((String::new(), String::new())))
}

/// RAII guard for active background scans. Automatically resets counters when
/// the first concurrent scan begins and clears `is_running` when the last finishes.
pub struct ScanSessionGuard;

impl ScanSessionGuard {
    pub fn start(phase: &str) -> Self {
        let prev = ACTIVE_SCANS.fetch_add(1, Ordering::SeqCst);
        if prev == 0 {
            CANCEL_REQUESTED.store(false, Ordering::SeqCst);
            FILES_SCANNED.store(0, Ordering::Relaxed);
            BYTES_SCANNED.store(0, Ordering::Relaxed);
        }
        if let Ok(mut guard) = labels_lock().lock() {
            guard.0 = phase.to_string();
        }
        Self
    }
}

impl Drop for ScanSessionGuard {
    fn drop(&mut self) {
        let prev = ACTIVE_SCANS.fetch_sub(1, Ordering::SeqCst);
        if prev <= 1 {
            ACTIVE_SCANS.store(0, Ordering::SeqCst);
        }
    }
}

#[inline]
pub fn is_scan_cancelled() -> bool {
    CANCEL_REQUESTED.load(Ordering::Relaxed)
}

pub fn cancel_active_scan() {
    CANCEL_REQUESTED.store(true, Ordering::SeqCst);
}

#[inline]
pub fn add_scanned_batch(files: u64, bytes: u64, sample_path: Option<&str>) {
    if files == 0 && bytes == 0 {
        return;
    }
    let total_files = FILES_SCANNED.fetch_add(files, Ordering::Relaxed) + files;
    BYTES_SCANNED.fetch_add(bytes, Ordering::Relaxed);

    if let Some(p) = sample_path {
        if !p.is_empty() && (total_files & 0x3FF) < files.max(1) {
            if let Ok(mut guard) = labels_lock().try_lock() {
                guard.1.clear();
                guard.1.push_str(p);
            }
        }
    }
}

pub fn set_scan_phase(phase: &str, current_path: &str) {
    if let Ok(mut guard) = labels_lock().lock() {
        guard.0 = phase.to_string();
        if !current_path.is_empty() {
            guard.1 = current_path.to_string();
        }
    }
}

pub fn current_scan_progress() -> ScanProgress {
    let active = ACTIVE_SCANS.load(Ordering::Relaxed) > 0;
    let (phase, current_path) = labels_lock()
        .lock()
        .map(|g| (g.0.clone(), g.1.clone()))
        .unwrap_or_default();

    ScanProgress {
        is_running: active,
        phase,
        files_scanned: FILES_SCANNED.load(Ordering::Relaxed),
        bytes_scanned: BYTES_SCANNED.load(Ordering::Relaxed),
        current_path,
        cancelled: CANCEL_REQUESTED.load(Ordering::Relaxed),
    }
}
