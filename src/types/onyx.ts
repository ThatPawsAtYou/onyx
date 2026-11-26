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
  | 'web_cache';

export interface DevJunkItem {
  id: string;
  category: DevJunkCategory | string;
  ecosystem: string;
  projectName: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
  modifiedDaysAgo: number;
}

export interface DevJunkScanReport {
  items: DevJunkItem[];
  totalBytes: number;
  scannedRoots: string[];
  durationMs: number;
}

export interface SystemCacheItem {
  id: string;
  category: 'os_temp' | 'browser_cache' | 'pkg_cache' | 'system_logs' | string;
  title: string;
  subtitle: string;
  path: string;
  cleanContentsOnly: boolean;
  sizeBytes: number;
  fileCount: number;
  safeToPurge: boolean;
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
}

export interface SpaceLensReport {
  currentPath: string;
  parentPath: string | null;
  breadcrumbs: DirectoryEntry[];
  nodes: SpaceNode[];
  totalBytes: number;
  durationMs: number;
}

export interface DuplicateFileEntry {
  path: string;
  parentDir: string;
  modifiedDaysAgo: number;
  isOriginal: boolean;
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

export type ActiveView = 'dashboard' | 'spacelens' | 'duplicates' | 'analytics';
export type Lang = 'ru' | 'en';
