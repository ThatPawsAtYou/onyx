import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Command,
  Copy,
  Cpu,
  Download,
  FolderSearch,
  Globe,
  Layers,
  LayoutGrid,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import {
  ActiveView,
  DevJunkItem,
  DevJunkScanReport,
  DiskTelemetry,
  Lang,
  LargeFileItem,
  LargeFilesReport,
  SpaceNode,
  SystemCacheItem,
  SystemCacheReport,
  SystemOverview,
} from './types/onyx';
import { translations } from './lib/i18n';
import {
  exportAuditReport,
  fetchSystemOverview,
  moveTargetsToTrash,
  revealPathInFolder,
  runDevJunkScan,
  runLargeFilesScan,
  runSystemCacheScan,
} from './lib/bridge';
import { cn, formatBytes } from './lib/format';
import { StorageGaugeCard } from './components/StorageGaugeCard';
import { DevJunkCard } from './components/DevJunkCard';
import { SystemCacheCard } from './components/SystemCacheCard';
import { LargeFilesCard } from './components/LargeFilesCard';
import { SpaceLensView } from './components/SpaceLensView';
import { DuplicatesView } from './components/DuplicatesView';
import { AnalyticsAndHistoryView } from './components/AnalyticsAndHistoryView';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { OnyxBrandIcon } from './components/OnyxBrandIcon';
import {
  FolderPickerModal,
  SettingsModal,
} from './components/SettingsAndFolderModal';

const APP_VERSION = '1.0.1';

interface ToastBanner {
  id: number;
  message: string;
  tone: 'emerald' | 'indigo' | 'rose';
}

export const App: React.FC = () => {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem('onyx_lang') === 'ru' ? 'ru' : 'en';
    } catch {
      return 'en';
    }
  });
  const t = translations[lang];

  const handleChangeLang = useCallback((nextLang: Lang) => {
    setLang(nextLang);
    try {
      localStorage.setItem('onyx_lang', nextLang);
    } catch {
      // ignore storage errors
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = nextLang;
    }
  }, []);

  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [customRoot, setCustomRoot] = useState<string>('');
  const [spaceLensStartPath, setSpaceLensStartPath] = useState<string>('');
  const [minLargeSizeMb, setMinLargeSizeMb] = useState<number>(100);

  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [selectedDiskId, setSelectedDiskId] = useState<string>('');
  const [devReport, setDevReport] = useState<DevJunkScanReport | null>(null);
  const [cacheReport, setCacheReport] = useState<SystemCacheReport | null>(null);
  const [largeReport, setLargeReport] = useState<LargeFilesReport | null>(null);

  const [isScanningDev, setIsScanningDev] = useState<boolean>(true);
  const [isScanningCache, setIsScanningCache] = useState<boolean>(true);
  const [isScanningLarge, setIsScanningLarge] = useState<boolean>(true);
  const [isCleaningDev, setIsCleaningDev] = useState<boolean>(false);
  const [isPurgingCache, setIsPurgingCache] = useState<boolean>(false);
  const [sessionFreedBytes, setSessionFreedBytes] = useState<number>(0);
  const [sessionCacheFreedBytes, setSessionCacheFreedBytes] =
    useState<number>(0);
  const [engineError, setEngineError] = useState<string | null>(null);

  const [folderModalOpen, setFolderModalOpen] = useState<boolean>(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState<boolean>(false);
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastBanner | null>(null);

  const minLargeRef = useRef<number>(minLargeSizeMb);
  minLargeRef.current = minLargeSizeMb;

  const isScanning = isScanningDev || isScanningCache || isScanningLarge;

  const notify = useCallback(
    (message: string, tone: ToastBanner['tone'] = 'emerald') => {
      const id = Date.now();
      setToast({ id, message, tone });
      setTimeout(() => {
        setToast((curr) => (curr?.id === id ? null : curr));
      }, 4600);
    },
    []
  );

  // Global Ctrl+K / Cmd+K shortcut for Command Palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const refreshOverviewOnly = useCallback(async () => {
    try {
      const sys = await fetchSystemOverview();
      setOverview(sys);
      setSelectedDiskId((prev) =>
        sys.disks.some((d) => d.id === prev) ? prev : sys.disks[0]?.id ?? ''
      );
      setEngineError(null);
      return sys;
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  // Progressive non-blocking scan so Drives/CPU/RAM appear immediately while disk scanners stream in
  const runFullScan = useCallback(
    async (rootPath: string, thresholdMb: number) => {
      setEngineError(null);
      setIsScanningDev(true);
      setIsScanningCache(true);
      setIsScanningLarge(true);

      const sysTask = refreshOverviewOnly();

      const cacheTask = runSystemCacheScan()
        .then((cache) => setCacheReport(cache))
        .catch((err) =>
          setEngineError(err instanceof Error ? err.message : String(err))
        )
        .finally(() => setIsScanningCache(false));

      const devTask = runDevJunkScan(rootPath ? [rootPath] : undefined)
        .then((dev) => setDevReport(dev))
        .catch((err) =>
          setEngineError(err instanceof Error ? err.message : String(err))
        )
        .finally(() => setIsScanningDev(false));

      const largeTask = runLargeFilesScan(rootPath || undefined, thresholdMb)
        .then((large) => setLargeReport(large))
        .catch((err) =>
          setEngineError(err instanceof Error ? err.message : String(err))
        )
        .finally(() => setIsScanningLarge(false));

      await Promise.allSettled([sysTask, cacheTask, devTask, largeTask]);
    },
    [refreshOverviewOnly]
  );

  // Initial & customRoot-triggered full scan
  useEffect(() => {
    runFullScan(customRoot, minLargeRef.current);
  }, [customRoot, runFullScan]);

  // Changing Large Files threshold ONLY rescans Large Files (instant, no wasted Dev/Cache scan)
  const handleChangeLargeThreshold = useCallback(
    async (nextMb: number) => {
      setMinLargeSizeMb(nextMb);
      setIsScanningLarge(true);
      try {
        const large = await runLargeFilesScan(customRoot || undefined, nextMb);
        setLargeReport(large);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), 'rose');
      } finally {
        setIsScanningLarge(false);
      }
    },
    [customRoot, notify]
  );

  // Lightweight live hardware telemetry refresh (CPU/RAM/Disks) every 6 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      fetchSystemOverview()
        .then((sys) => setOverview(sys))
        .catch(() => {});
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const handleSelectDisk = (disk: DiskTelemetry) => {
    setSelectedDiskId(disk.id);
  };

  const handleOpenInSpaceLens = (mountPoint: string) => {
    setSpaceLensStartPath(mountPoint);
    setActiveView('spacelens');
  };

  const handleCleanDevItems = async (selected: DevJunkItem[]) => {
    if (selected.length === 0) return;
    setIsCleaningDev(true);
    try {
      const targets = selected.map((s) => ({
        path: s.path,
        contentsOnly: false,
      }));
      const res = await moveTargetsToTrash(targets, 'dev_junk');

      if (res.deletedCount > 0) {
        setSessionFreedBytes((prev) => prev + res.freedBytes);
        notify(
          `${t.toastCleaned}: ${formatBytes(res.freedBytes, 2)} (${
            res.deletedCount
          })`,
          'emerald'
        );
        const [ , freshDev] = await Promise.all([
          refreshOverviewOnly(),
          runDevJunkScan(customRoot ? [customRoot] : undefined),
        ]);
        setDevReport(freshDev);
      } else if (res.errors.length > 0) {
        notify(res.errors[0], 'rose');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'rose');
    } finally {
      setIsCleaningDev(false);
    }
  };

  const handlePurgeCaches = async (selected: SystemCacheItem[]) => {
    if (selected.length === 0) return;
    setIsPurgingCache(true);
    try {
      const targets = selected.map((s) => ({
        path: s.path,
        contentsOnly: s.cleanContentsOnly,
      }));
      const res = await moveTargetsToTrash(targets, 'system_cache');
      if (res.deletedCount > 0 || res.freedBytes > 0) {
        setSessionFreedBytes((prev) => prev + res.freedBytes);
        setSessionCacheFreedBytes((prev) => prev + res.freedBytes);
        notify(
          `${t.toastCleaned}: ${formatBytes(res.freedBytes, 2)}`,
          'emerald'
        );
        const [, freshCache] = await Promise.all([
          refreshOverviewOnly(),
          runSystemCacheScan(),
        ]);
        setCacheReport(freshCache);
      } else if (res.errors.length > 0) {
        notify(res.errors[0], 'rose');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'rose');
    } finally {
      setIsPurgingCache(false);
    }
  };

  const handleTrashLargeFile = async (file: LargeFileItem) => {
    try {
      const res = await moveTargetsToTrash(
        [{ path: file.path, contentsOnly: false }],
        'large_files'
      );
      if (res.deletedCount > 0) {
        setSessionFreedBytes((prev) => prev + res.freedBytes);
        // Optimistic zero-latency UI update + drive free space refresh
        setLargeReport((prev) => {
          if (!prev) return prev;
          const remaining = prev.items.filter((i) => i.id !== file.id);
          return {
            ...prev,
            items: remaining,
            totalBytes: remaining.reduce((acc, f) => acc + f.sizeBytes, 0),
          };
        });
        notify(
          `${t.toastCleaned}: ${formatBytes(res.freedBytes, 2)} (${file.name})`,
          'emerald'
        );
        await refreshOverviewOnly();
      } else if (res.errors.length > 0) {
        notify(res.errors[0], 'rose');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'rose');
    }
  };

  const handleTrashSpaceLensNode = async (node: SpaceNode): Promise<boolean> => {
    try {
      const res = await moveTargetsToTrash(
        [{ path: node.path, contentsOnly: false }],
        'space_lens'
      );
      if (res.deletedCount > 0) {
        setSessionFreedBytes((prev) => prev + res.freedBytes);
        notify(
          `${t.toastCleaned}: ${formatBytes(res.freedBytes, 2)} (${node.name})`,
          'emerald'
        );
        refreshOverviewOnly();
        return true;
      } else if (res.errors.length > 0) {
        notify(res.errors[0], 'rose');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'rose');
    }
    return false;
  };

  const handleTrashDuplicates = async (paths: string[]) => {
    try {
      const targets = paths.map((p) => ({ path: p, contentsOnly: false }));
      const res = await moveTargetsToTrash(targets, 'duplicates');
      if (res.deletedCount > 0) {
        setSessionFreedBytes((prev) => prev + res.freedBytes);
        notify(
          `${t.toastCleaned}: ${formatBytes(res.freedBytes, 2)} (${
            res.deletedCount
          })`,
          'emerald'
        );
        refreshOverviewOnly();
      } else if (res.errors.length > 0) {
        notify(res.errors[0], 'rose');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'rose');
    }
  };

  const handleRevealPath = async (path: string) => {
    try {
      await revealPathInFolder(path);
      notify(`${t.revealFolder}: ${path}`, 'indigo');
    } catch (err) {
      notify(err instanceof Error ? err.message : path, 'rose');
    }
  };

  const saveReportFile = async (
    filename: string,
    content: string,
    mime: string
  ) => {
    try {
      const savedPath = await exportAuditReport(filename, content);
      notify(`${t.toastExported}: ${savedPath}`, 'indigo');
    } catch {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify(`${t.toastExported} (${filename})`, 'indigo');
    }
  };

  const handleExportMarkdownReport = () => {
    if (!overview) return;
    const nowIso = new Date().toISOString();
    const lines: string[] = [
      `# Onyx v${APP_VERSION} — System Storage Audit Report`,
      ``,
      `- **Generated**: ${nowIso}`,
      `- **Host**: \`${overview.hostName}\` (${overview.osName})`,
      `- **CPU**: ${overview.cpuBrand} (${overview.cpuCores} Threads, ${overview.cpuUsagePercent.toFixed(1)}% Load)`,
      `- **Memory**: ${formatBytes(overview.memory.usedBytes, 2)} / ${formatBytes(overview.memory.totalBytes, 2)} (${overview.memory.usagePercent}%)`,
      ``,
      `## Physical & Mounted Volumes`,
      `| Mount | Volume | FS | Type | Used | Free | Total | Usage |`,
      `|---|---|---|---|---|---|---|---|`,
      ...overview.disks.map(
        (d) =>
          `| \`${d.mountPoint}\` | ${d.name} | ${d.fileSystem} | ${d.kindLabel} | ${formatBytes(d.usedBytes, 2)} | ${formatBytes(d.availableBytes, 2)} | ${formatBytes(d.totalBytes, 2)} | ${d.usagePercent}% |`
      ),
      ``,
      `## Developer Build Artifacts (${formatBytes(devReport?.totalBytes || 0, 2)})`,
      ...(devReport?.items.slice(0, 25).map(
        (i) =>
          `- **${i.projectName}** (${i.ecosystem}) — \`${formatBytes(i.sizeBytes, 2)}\` — \`${i.path}\``
      ) || ['- None detected']),
      ``,
      `## System & Package Caches (${formatBytes(cacheReport?.totalBytes || 0, 2)})`,
      ...(cacheReport?.items.map(
        (b) =>
          `- **${b.title}** — \`${formatBytes(b.sizeBytes, 2)}\` (\`${b.path}\`)`
      ) || ['- None detected']),
      ``,
      `## Top Large Files (${formatBytes(largeReport?.totalBytes || 0, 2)})`,
      ...(largeReport?.items.slice(0, 25).map(
        (f) =>
          `- **${f.name}** — \`${formatBytes(f.sizeBytes, 2)}\` — \`${f.path}\``
      ) || ['- None detected']),
      ``,
    ];
    saveReportFile(
      `onyx-storage-audit-${overview.hostName}.md`,
      lines.join('\n'),
      'text/markdown;charset=utf-8'
    );
  };

  const handleExportJsonReport = () => {
    if (!overview) return;
    const payload = {
      generatedAt: new Date().toISOString(),
      version: APP_VERSION,
      overview,
      devJunk: devReport,
      caches: cacheReport,
      largeFiles: largeReport,
    };
    saveReportFile(
      `onyx-storage-audit-${overview.hostName}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const activeScanRoot = customRoot || overview?.homeDir || '/';
  const isMacPlatform =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/i.test(navigator.platform || '');

  const navItems: { id: ActiveView; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'dashboard', label: t.navDashboard, icon: LayoutGrid },
    { id: 'spacelens', label: t.navSpaceLens, icon: Layers },
    { id: 'duplicates', label: t.navDuplicates, icon: Copy },
    { id: 'analytics', label: t.navAnalytics, icon: BarChart3 },
  ];

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#050505] text-zinc-100 selection:bg-white selection:text-zinc-950">
      {/* Subtle Top Radial Obsidian Spotlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[440px] bg-[radial-gradient(ellipse_68%_45%_at_50%_-10%,rgba(120,130,255,0.10),transparent_72%)]"
      />

      {/* Floating Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className={cn(
              'fixed right-6 top-5 z-50 flex items-center gap-2.5 rounded-full border px-4 py-2 text-xs font-medium shadow-2xl backdrop-blur-xl',
              toast.tone === 'emerald' &&
                'border-emerald-400/30 bg-zinc-950/90 text-emerald-200',
              toast.tone === 'indigo' &&
                'border-indigo-400/30 bg-zinc-950/90 text-indigo-200',
              toast.tone === 'rose' &&
                'border-rose-400/30 bg-zinc-950/90 text-rose-200'
            )}
          >
            {toast.tone === 'rose' ? (
              <AlertTriangle size={14} className="shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 size={14} className="shrink-0" />
            )}
            <span className="max-w-xl truncate">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Container */}
      <div className="relative z-10 mx-auto max-w-[1380px] px-4 py-5 sm:px-7 sm:py-6">
        {/* Top Desktop App Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-4">
          {/* Brand Identity */}
          <div className="flex items-center gap-3.5">
            <OnyxBrandIcon className="h-10 w-10 shrink-0 drop-shadow-[0_8px_24px_rgba(0,0,0,0.75)]" />

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[18px] font-semibold tracking-[-0.03em] text-white">
                  Onyx
                </h1>
                <span className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] font-medium text-zinc-300">
                  v{APP_VERSION}
                </span>
              </div>
              <p className="text-xs text-zinc-400">{t.appSubtitle}</p>
            </div>
          </div>

          {/* Right Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Session Freed Indicator */}
            {sessionFreedBytes > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 font-mono text-xs font-semibold text-emerald-300"
              >
                <span>
                  {t.reclaimedSession}: +{formatBytes(sessionFreedBytes, 2)}
                </span>
              </motion.div>
            )}

            {/* Command Palette Button (Ctrl+K / Cmd+K) */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#0A0A0D] px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/25 hover:text-white"
            >
              <Command size={12} className="text-zinc-400" />
              <span className="hidden sm:inline">{t.cmdPaletteHint}</span>
              <kbd className="rounded border border-white/15 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                {isMacPlatform ? '⌘K' : 'Ctrl K'}
              </kbd>
            </motion.button>

            {/* Target Folder Selector */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => setFolderModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#0A0A0D] px-3.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              <FolderSearch size={13} className="text-zinc-400" />
              <span className="hidden sm:inline text-zinc-500">
                {t.chooseFolder}:
              </span>
              <span className="max-w-[140px] truncate font-mono text-[11px] text-zinc-200">
                {activeScanRoot}
              </span>
            </motion.button>

            {/* Export Report Quick Action */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={handleExportMarkdownReport}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0A0A0D] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              title={t.exportMdBtn}
            >
              <Download size={13} className="text-zinc-400" />
              <span>{t.exportMdBtn}</span>
            </motion.button>

            {/* Language Switcher (EN / RU) */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => handleChangeLang(lang === 'en' ? 'ru' : 'en')}
              title={
                lang === 'en'
                  ? 'Switch language to Russian (Русский)'
                  : 'Переключить язык на английский (English)'
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0A0A0D] px-3 py-1.5 font-mono text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              <Globe size={13} className="text-zinc-400" />
              <span
                className={
                  lang === 'en' ? 'text-white font-semibold' : 'text-zinc-500'
                }
              >
                EN
              </span>
              <span className="text-zinc-600">/</span>
              <span
                className={
                  lang === 'ru' ? 'text-white font-semibold' : 'text-zinc-500'
                }
              >
                RU
              </span>
            </motion.button>

            {/* Settings Modal Trigger */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setSettingsModalOpen(true)}
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-[#0A0A0D] p-2 text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
              aria-label={t.settings}
            >
              <SlidersHorizontal size={14} />
            </motion.button>

            {/* Primary Rescan CTA */}
            <motion.button
              type="button"
              disabled={isScanning}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => runFullScan(customRoot, minLargeSizeMb)}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-[#050505] shadow-[0_0_24px_rgba(255,255,255,0.16)] transition-colors hover:bg-zinc-200 disabled:opacity-60"
            >
              <RefreshCw
                size={13}
                className={cn(isScanning && 'animate-spin')}
              />
              <span>{isScanning ? t.scanning : t.scanAll}</span>
            </motion.button>
          </div>
        </header>

        {/* Sub-Header View Switcher Bar */}
        <nav className="mb-5 flex items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-1.5 overflow-x-auto rounded-full border border-white/[0.09] bg-[#09090C] p-1">
            {navItems.map((nav) => {
              const Icon = nav.icon;
              const selected = activeView === nav.id;
              return (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => setActiveView(nav.id)}
                  className={cn(
                    'relative inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-medium transition-colors',
                    selected ? 'text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  {selected && (
                    <motion.div
                      layoutId="onyxPrimaryNavPill"
                      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                      className="absolute inset-0 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                    />
                  )}
                  <Icon size={13} className="relative z-10" />
                  <span className="relative z-10 font-semibold">{nav.label}</span>
                </button>
              );
            })}
          </div>

          {overview && (
            <div className="hidden xl:flex items-center gap-3 font-mono text-[11px] text-zinc-500">
              <span>{overview.hostName}</span>
              <span>·</span>
              <span>
                {overview.osName} {overview.osVersion}
              </span>
            </div>
          )}
        </nav>

        {/* Engine Connection Error Banner */}
        {engineError && (
          <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-5 py-3.5 text-xs text-rose-200">
            <div className="flex items-center gap-3">
              <AlertTriangle size={18} className="shrink-0 text-rose-400" />
              <div>
                <div className="font-semibold text-white">
                  System Engine Error
                </div>
                <div className="mt-0.5 text-rose-200/80">{engineError}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => runFullScan(customRoot, minLargeSizeMb)}
              className="shrink-0 rounded-full bg-white px-3.5 py-1.5 font-semibold text-zinc-950 hover:bg-zinc-200"
            >
              {t.scanAll}
            </button>
          </div>
        )}

        {/* Active View Workspace */}
        {activeView === 'dashboard' && (
          <main className="grid grid-cols-12 gap-4">
            <StorageGaugeCard
              disks={overview?.disks ?? []}
              selectedDiskId={selectedDiskId}
              onSelectDisk={handleSelectDisk}
              onOpenInSpaceLens={handleOpenInSpaceLens}
              memory={
                overview?.memory ?? {
                  totalBytes: 1,
                  usedBytes: 0,
                  availableBytes: 1,
                  usagePercent: 0,
                  swapTotalBytes: 0,
                  swapUsedBytes: 0,
                }
              }
              cpuUsagePercent={overview?.cpuUsagePercent ?? 0}
              uptimeSeconds={overview?.uptimeSeconds ?? 0}
              devJunkBytes={devReport?.totalBytes ?? 0}
              cacheBytes={cacheReport?.totalBytes ?? 0}
              largeFilesBytes={largeReport?.totalBytes ?? 0}
              lang={lang}
              t={t}
            />

            <DevJunkCard
              items={devReport?.items ?? []}
              durationMs={devReport?.durationMs ?? 0}
              isScanning={isScanningDev}
              isCleaning={isCleaningDev}
              onCleanItems={handleCleanDevItems}
              onRevealPath={handleRevealPath}
              t={t}
            />

            <SystemCacheCard
              items={cacheReport?.items ?? []}
              isPurging={isPurgingCache}
              sessionCacheFreedBytes={sessionCacheFreedBytes}
              onPurgeItems={handlePurgeCaches}
              onRescanCache={async () => {
                setIsScanningCache(true);
                try {
                  const c = await runSystemCacheScan();
                  setCacheReport(c);
                } finally {
                  setIsScanningCache(false);
                }
              }}
              t={t}
            />

            <LargeFilesCard
              items={largeReport?.items ?? []}
              minSizeMb={minLargeSizeMb}
              isScanning={isScanningLarge}
              onChangeThresholdMb={handleChangeLargeThreshold}
              onTrashFile={handleTrashLargeFile}
              onRevealPath={handleRevealPath}
              t={t}
            />
          </main>
        )}

        {activeView === 'spacelens' && (
          <SpaceLensView
            initialPath={
              spaceLensStartPath || customRoot || overview?.homeDir || ''
            }
            disks={overview?.disks ?? []}
            homeDir={overview?.homeDir ?? ''}
            onRevealPath={handleRevealPath}
            onTrashNode={handleTrashSpaceLensNode}
            t={t}
          />
        )}

        {activeView === 'duplicates' && (
          <DuplicatesView
            customRoot={customRoot}
            onRevealPath={handleRevealPath}
            onCleanPaths={handleTrashDuplicates}
            t={t}
          />
        )}

        {activeView === 'analytics' && (
          <AnalyticsAndHistoryView
            customRoot={customRoot}
            onExportMarkdown={handleExportMarkdownReport}
            onExportJson={handleExportJsonReport}
            lang={lang}
            t={t}
          />
        )}

        {/* Minimal Hardware & Safety Status Bar */}
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-[#09090B]/70 px-4 py-2.5 text-[11px] text-zinc-500">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-zinc-300">
              <ShieldCheck size={13} className="text-emerald-400" />
              {t.safeRecycleBadge}
            </span>
          </div>

          {overview && (
            <div className="flex flex-wrap items-center gap-3 font-mono">
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <Cpu size={12} />
                {overview.cpuCores} Threads ·{' '}
                {overview.cpuUsagePercent.toFixed(1)}%
              </span>
              <span>·</span>
              <span className="text-zinc-400">{overview.osName}</span>
            </div>
          )}
        </footer>
      </div>

      {/* Modals */}
      <CommandPaletteModal
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={(view) => setActiveView(view)}
        onRescan={() => runFullScan(customRoot, minLargeSizeMb)}
        onPurgeCache={
          cacheReport && cacheReport.items.length > 0
            ? () => handlePurgeCaches(cacheReport.items)
            : undefined
        }
        onOpenFolderPicker={() => setFolderModalOpen(true)}
        onExportReport={handleExportMarkdownReport}
        onRevealPath={handleRevealPath}
        devItems={devReport?.items ?? []}
        largeFiles={largeReport?.items ?? []}
        t={t}
      />

      <FolderPickerModal
        open={folderModalOpen}
        onOpenChange={setFolderModalOpen}
        currentRoot={customRoot}
        defaultHomeDir={overview?.homeDir ?? '/home/user'}
        disks={overview?.disks ?? []}
        onApplyRoot={(root) => setCustomRoot(root)}
        t={t}
      />

      <SettingsModal
        open={settingsModalOpen}
        onOpenChange={setSettingsModalOpen}
        lang={lang}
        onChangeLang={handleChangeLang}
        cpuBrand={overview?.cpuBrand ?? 'x86_64'}
        cpuCores={overview?.cpuCores ?? 4}
        osName={overview?.osName ?? 'Desktop OS'}
        t={t}
      />
    </div>
  );
};

export default App;
