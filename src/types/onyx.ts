export interface DiskTelemetry {
  id: string;
  name: string;
  mountPoint: string;
  fileSystem: string;
  kindLabel: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usagePercent: number;
  isRemovable: boolean;
}

export interface MemoryTelemetry {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface SystemOverview {
  osName: string;
  osVersion: string;
  hostName: string;
  cpuBrand: string;
  cpuCores: number;
  cpuUsagePercent: number;
  uptimeSeconds: number;
  homeDir: string;
  disks: DiskTelemetry[];
  memory: MemoryTelemetry;
}

export type DevJunkCategory =
  | 'node_modules'
  | 'rust_target'
  | 'python_venv'
  | 'docker_cache'
  | 'gradle_pods'
  | 'web_cache'
  | 'game_redist';

export interface DevJunkItem {
  id: string;
  category: DevJunkCategory | string;
  ecosystem: string;
  projectName: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
  modifiedDaysAgo: number;
  isProtected?: boolean;
}

export interface DevJunkScanReport {
  items: DevJunkItem[];
  totalBytes: number;
  scannedRoots: string[];
  durationMs: number;
}

export interface SystemCacheItem {
  id: string;
  category:
    | 'os_temp'
    | 'gpu_shader'
    | 'game_cache'
    | 'app_cache'
    | 'browser_cache'
    | 'pkg_cache'
    | 'system_logs'
    | string;
  title: string;
  subtitle: string;
  path: string;
  cleanContentsOnly: boolean;
  sizeBytes: number;
  fileCount: number;
  safeToPurge: boolean;
  isProtected?: boolean;
}

export interface SystemCacheReport {
  items: SystemCacheItem[];
  totalBytes: number;
  durationMs: number;
}

export type LargeFileCategory = 'video' | 'archive' | 'installer' | 'disk_data';

export interface LargeFileItem {
  id: string;
  name: string;
  path: string;
  parentDir: string;
  extension: string;
  category: LargeFileCategory | string;
  sizeBytes: number;
  modifiedDaysAgo: number;
  isVirtualDisk?: boolean;
  compactHint?: string | null;
  isProtected?: boolean;
}

export interface LargeFilesReport {
  items: LargeFileItem[];
  totalBytes: number;
  thresholdBytes: number;
  scannedRoot: string;
  durationMs: number;
}

export interface SpaceNode {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  sizeBytes: number;
  sharePercent: number;
  fileCount: number;
  modifiedDaysAgo: number;
  deltaBytes?: number | null;
  isProtected?: boolean;
}

export interface SpaceLensReport {
  currentPath: string;
  parentPath: string | null;
  breadcrumbs: DirectoryEntry[];
  nodes: SpaceNode[];
  totalBytes: number;
  durationMs: number;
  hasBaseline?: boolean;
  snapshotTimestamp?: number | null;
  totalDeltaBytes?: number | null;
}

export interface DuplicateFileEntry {
  path: string;
  parentDir: string;
  modifiedDaysAgo: number;
  isOriginal: boolean;
  isProtected?: boolean;
}

export interface DuplicateGroup {
  id: string;
  hashShort: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  wastedBytes: number;
  files: DuplicateFileEntry[];
}

export interface DuplicatesReport {
  groups: DuplicateGroup[];
  totalWastedBytes: number;
  totalDuplicateFiles: number;
  scannedFiles: number;
  scannedRoot: string;
  durationMs: number;
}

export interface ExtensionStat {
  extension: string;
  category: string;
  totalBytes: number;
  fileCount: number;
  sharePercent: number;
}

export interface ExtensionsReport {
  items: ExtensionStat[];
  totalBytes: number;
  totalFiles: number;
  scannedRoot: string;
  durationMs: number;
}

export interface CleanupHistoryEntry {
  id: string;
  timestampUnix: number;
  category: string;
  freedBytes: number;
  deletedCount: number;
  samplePaths: string[];
}

export interface TrashTarget {
  path: string;
  contentsOnly?: boolean;
  expectedBytes?: number;
}

export interface PurgeReport {
  freedBytes: number;
  deletedCount: number;
  skippedCount: number;
  errors: string[];
  durationMs: number;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface ScanProgress {
  isRunning: boolean;
  phase: string;
  filesScanned: number;
  bytesScanned: number;
  currentPath: string;
  cancelled: boolean;
}

export interface StorageSnapshotMeta {
  id: string;
  targetPath: string;
  timestampUnix: number;
  totalBytes: number;
  childCount: number;
}

export interface ProtectedPathEntry {
  path: string;
  label: string;
  addedUnix: number;
}

export interface InstalledAppItem {
  id: string;
  name: string;
  version: string;
  publisher: string;
  installLocation?: string | null;
  sizeBytes: number;
  uninstallCommand?: string | null;
  source: string;
}

export interface LeftoverItem {
  id: string;
  name: string;
  path: string;
  locationLabel: string;
  reason: string;
  confidence: string;
  sizeBytes: number;
  fileCount: number;
  modifiedDaysAgo: number;
  isProtected: boolean;
}

export interface AppsAndLeftoversReport {
  apps: InstalledAppItem[];
  leftovers: LeftoverItem[];
  redistItems: DevJunkItem[];
  totalLeftoverBytes: number;
  totalRedistBytes: number;
  durationMs: number;
}

export interface ShellIntegrationStatus {
  supported: boolean;
  contextMenuEnabled: boolean;
  startupPath?: string | null;
}

export interface ContextMenuTarget {
  x: number;
  y: number;
  name: string;
  path: string;
  isDir: boolean;
  sizeBytes?: number;
  isProtected?: boolean;
}

export type ActiveView =
  | 'dashboard'
  | 'spacelens'
  | 'duplicates'
  | 'apps'
  | 'analytics';
export type Lang = 'ru' | 'en';
