import { invoke } from '@tauri-apps/api/core';
import {
  AppsAndLeftoversReport,
  CleanupHistoryEntry,
  DevJunkScanReport,
  DirectoryEntry,
  DuplicatesReport,
  ExtensionsReport,
  LargeFilesReport,
  ProtectedPathEntry,
  PurgeReport,
  ScanProgress,
  ShellIntegrationStatus,
  SpaceLensReport,
  StorageSnapshotMeta,
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

export async function runAppsAndLeftoversScan(
  customRoot?: string
): Promise<AppsAndLeftoversReport> {
  return await callRustEngine<AppsAndLeftoversReport>(
    'scan_apps_and_leftovers',
    {
      customRoot: customRoot || null,
    }
  );
}

export async function fetchScanProgress(): Promise<ScanProgress> {
  return await callRustEngine<ScanProgress>('get_scan_progress');
}

export async function cancelActiveScan(): Promise<void> {
  await callRustEngine('cancel_active_scan');
}

export async function fetchProtectedPaths(): Promise<ProtectedPathEntry[]> {
  return await callRustEngine<ProtectedPathEntry[]>('list_protected_paths');
}

export async function addProtectedPath(
  path: string,
  label?: string
): Promise<ProtectedPathEntry[]> {
  return await callRustEngine<ProtectedPathEntry[]>('add_protected_path', {
    path,
    label: label || null,
  });
}

export async function removeProtectedPath(
  path: string
): Promise<ProtectedPathEntry[]> {
  return await callRustEngine<ProtectedPathEntry[]>('remove_protected_path', {
    path,
  });
}

export async function saveSpaceSnapshot(
  targetPath: string
): Promise<StorageSnapshotMeta> {
  return await callRustEngine<StorageSnapshotMeta>('save_space_snapshot', {
    targetPath,
  });
}

export async function fetchSpaceSnapshots(): Promise<StorageSnapshotMeta[]> {
  return await callRustEngine<StorageSnapshotMeta[]>('list_space_snapshots');
}

export async function deleteSpaceSnapshot(targetPath: string): Promise<void> {
  await callRustEngine('delete_space_snapshot', { targetPath });
}

export async function fetchShellIntegrationStatus(): Promise<ShellIntegrationStatus> {
  return await callRustEngine<ShellIntegrationStatus>(
    'get_shell_integration_status'
  );
}

export async function toggleExplorerContextMenu(
  enabled: boolean
): Promise<ShellIntegrationStatus> {
  return await callRustEngine<ShellIntegrationStatus>(
    'set_explorer_context_menu',
    { enabled }
  );
}

export async function consumeStartupTargetPath(): Promise<string | null> {
  try {
    if (window.sessionStorage.getItem('onyx-startup-consumed') === '1') {
      return null;
    }
    const status = await fetchShellIntegrationStatus();
    if (status.startupPath) {
      window.sessionStorage.setItem('onyx-startup-consumed', '1');
      return status.startupPath;
    }
  } catch {
    // Ignore
  }
  return null;
}

export async function launchAppUninstaller(
  uninstallCommand: string
): Promise<void> {
  await callRustEngine('launch_app_uninstaller', { uninstallCommand });
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
