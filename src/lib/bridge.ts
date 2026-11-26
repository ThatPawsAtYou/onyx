import { invoke } from '@tauri-apps/api/core';
import {
  CleanupHistoryEntry,
  DevJunkScanReport,
  DirectoryEntry,
  DuplicatesReport,
  ExtensionsReport,
  LargeFilesReport,
  PurgeReport,
  SpaceLensReport,
  SystemCacheReport,
  SystemOverview,
  TrashTarget,
} from '../types/onyx';

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

async function callRustEngine<T>(
  cmd: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  if (isTauriRuntime()) {
    return await invoke<T>(cmd, payload);
  }
  const res = await fetch(`/api/onyx-rpc/${cmd}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Rust RPC ${cmd} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function fetchSystemOverview(): Promise<SystemOverview> {
  return await callRustEngine<SystemOverview>('get_system_overview');
}

export async function runDevJunkScan(
  customRoots?: string[]
): Promise<DevJunkScanReport> {
  return await callRustEngine<DevJunkScanReport>('scan_dev_junk', {
    customRoots: customRoots && customRoots.length > 0 ? customRoots : null,
  });
}

export async function runSystemCacheScan(): Promise<SystemCacheReport> {
  return await callRustEngine<SystemCacheReport>('scan_system_cache');
}

export async function runLargeFilesScan(
  rootPath?: string,
  minSizeMb = 100
): Promise<LargeFilesReport> {
  return await callRustEngine<LargeFilesReport>('scan_large_files', {
    rootPath: rootPath || null,
    minSizeMb,
  });
}

export async function runSpaceLensScan(
  targetPath?: string
): Promise<SpaceLensReport> {
  return await callRustEngine<SpaceLensReport>('scan_space_lens', {
    targetPath: targetPath || null,
  });
}

export async function runDuplicatesScan(
  rootPath?: string,
  minSizeKb = 100
): Promise<DuplicatesReport> {
  return await callRustEngine<DuplicatesReport>('scan_duplicates', {
    rootPath: rootPath || null,
    minSizeKb,
  });
}

export async function runExtensionsScan(
  rootPath?: string
): Promise<ExtensionsReport> {
  return await callRustEngine<ExtensionsReport>('scan_extensions', {
    rootPath: rootPath || null,
  });
}

export async function fetchCleanupHistory(): Promise<CleanupHistoryEntry[]> {
  return await callRustEngine<CleanupHistoryEntry[]>('get_cleanup_history');
}

export async function clearCleanupHistory(): Promise<void> {
  await callRustEngine('clear_cleanup_history');
}

export async function moveTargetsToTrash(
  targets: TrashTarget[],
  category = 'cleanup'
): Promise<PurgeReport> {
  return await callRustEngine<PurgeReport>('move_to_trash', {
    targets,
    category,
  });
}

export async function revealPathInFolder(path: string): Promise<void> {
  await callRustEngine('reveal_in_folder', { path });
}

export async function fetchSubdirectories(
  parentPath?: string
): Promise<DirectoryEntry[]> {
  return await callRustEngine<DirectoryEntry[]>('list_directories', {
    parentPath: parentPath || null,
  });
}

export async function exportAuditReport(
  filename: string,
  content: string
): Promise<string> {
  return await callRustEngine<string>('export_audit_report', {
    filename,
    content,
  });
}
