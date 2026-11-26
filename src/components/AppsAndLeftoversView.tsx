import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { motion } from 'framer-motion';
import {
  AppWindow,
  Check,
  FolderOpen,
  Gamepad2,
  Ghost,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  AppsAndLeftoversReport,
  ContextMenuTarget,
  TrashTarget,
} from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes } from '../lib/format';
import {
  launchAppUninstaller,
  runAppsAndLeftoversScan,
} from '../lib/bridge';
import { BentoCard } from './BentoCard';
import { SquircleIcon } from './SquircleIcon';

interface AppsAndLeftoversViewProps {
  customRoot: string;
  protectedSet: Set<string>;
  onToggleProtect: (path: string, currentlyProtected: boolean) => Promise<void>;
  onInspectSpaceLens: (path: string) => void;
  onRevealPath: (path: string) => void;
  onCleanTargets: (targets: TrashTarget[], category: string) => Promise<void>;
  onOpenContextMenu: (e: React.MouseEvent, item: Omit<ContextMenuTarget, 'x' | 'y'>) => void;
  onNotifyError: (msg: string) => void;
  t: TranslationSet;
}

export const AppsAndLeftoversView: React.FC<AppsAndLeftoversViewProps> = ({
  customRoot,
  protectedSet,
  onToggleProtect,
  onInspectSpaceLens,
  onRevealPath,
  onCleanTargets,
  onOpenContextMenu,
  onNotifyError,
  t,
}) => {
  const [subTab, setSubTab] = useState<'leftovers' | 'apps'>('leftovers');
  const [report, setReport] = useState<AppsAndLeftoversReport | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [isCleaning, setIsCleaning] = useState<boolean>(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [appSearch, setAppSearch] = useState<string>('');
  const deferredAppSearch = useDeferredValue(appSearch);

  const loadReport = useCallback(async () => {
    setIsScanning(true);
    try {
      const res = await runAppsAndLeftoversScan(customRoot || undefined);
      setReport(res);
      const defaults = new Set<string>();
      for (const l of res.leftovers) {
        if (!l.isProtected && l.confidence === 'high') {
          defaults.add(l.path);
        }
      }
      for (const r of res.redistItems) {
        if (!r.isProtected) {
          defaults.add(r.path);
        }
      }
      setSelectedPaths(defaults);
    } catch (err) {
      onNotifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  }, [customRoot, onNotifyError]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const toggleSelect = (path: string, isProt: boolean) => {
    if (isProt) return;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const combinedCleanable = useMemo(() => {
    if (!report) return [];
    const out: Array<{
      id: string;
      kind: 'leftover' | 'redist';
      title: string;
      subtitle: string;
      badge: string;
      confidence: string;
      path: string;
      sizeBytes: number;
      modifiedDaysAgo: number;
      isProtected: boolean;
    }> = [];

    for (const r of report.redistItems) {
      const prot = Boolean(r.isProtected) || protectedSet.has(r.path.toLowerCase());
      out.push({
        id: r.id,
        kind: 'redist',
        title: r.projectName,
        subtitle: r.ecosystem,
        badge: t.redistBadge,
        confidence: 'high',
        path: r.path,
        sizeBytes: r.sizeBytes,
        modifiedDaysAgo: r.modifiedDaysAgo,
        isProtected: prot,
      });
    }

    for (const l of report.leftovers) {
      const prot = l.isProtected || protectedSet.has(l.path.toLowerCase());
      out.push({
        id: l.id,
        kind: 'leftover',
        title: l.name,
        subtitle: `${l.locationLabel} · ${l.reason}`,
        badge:
          l.confidence === 'high' ? t.highConfidence : t.mediumConfidence,
        confidence: l.confidence,
        path: l.path,
        sizeBytes: l.sizeBytes,
        modifiedDaysAgo: l.modifiedDaysAgo,
        isProtected: prot,
      });
    }

    return out.sort((a, b) => b.sizeBytes - a.sizeBytes);
  }, [report, protectedSet, t]);

  const selectedBytes = useMemo(() => {
    let sum = 0;
    for (const item of combinedCleanable) {
      if (!item.isProtected && selectedPaths.has(item.path)) {
        sum += item.sizeBytes;
      }
    }
    return sum;
  }, [combinedCleanable, selectedPaths]);

  const filteredApps = useMemo(() => {
    if (!report) return [];
    const q = deferredAppSearch.trim().toLowerCase();
    if (!q) return report.apps;
    return report.apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.publisher.toLowerCase().includes(q)
    );
  }, [report, deferredAppSearch]);

  const handleCleanSelected = async () => {
    const targets: TrashTarget[] = combinedCleanable
      .filter((x) => !x.isProtected && selectedPaths.has(x.path))
      .map((x) => ({
        path: x.path,
        expectedBytes: x.sizeBytes,
      }));
    if (targets.length === 0) return;

    setIsCleaning(true);
    try {
      await onCleanTargets(targets, 'leftovers');
      await loadReport();
    } finally {
      setIsCleaning(false);
    }
  };

  const handleUninstall = async (cmd: string) => {
    try {
      await launchAppUninstaller(cmd);
    } catch (err) {
      onNotifyError(err instanceof Error ? err.message : String(err));
    }
  };

  const totalReclaimable =
    (report?.totalLeftoverBytes ?? 0) + (report?.totalRedistBytes ?? 0);

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Top Summary Bento Strip */}
      <BentoCard className="col-span-12 p-6" delay={0.02}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <SquircleIcon icon={Ghost} tone="indigo" size="lg" />
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-white">
                {t.appsTitle}
              </h2>
              <p className="text-xs text-zinc-400">{t.appsSubtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sub-Tab Switcher */}
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[#050507] p-1">
              <button
                type="button"
                onClick={() => setSubTab('leftovers')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  subTab === 'leftovers'
                    ? 'bg-white text-black'
                    : 'text-zinc-400 hover:text-white'
                )}
              >
                <Ghost size={12} />
                <span>{t.tabLeftovers}</span>
                <span className="font-mono text-[10px] opacity-75">
                  ({combinedCleanable.length})
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('apps')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  subTab === 'apps'
                    ? 'bg-white text-black'
                    : 'text-zinc-400 hover:text-white'
                )}
              >
                <AppWindow size={12} />
                <span>{t.tabInstalledApps}</span>
                <span className="font-mono text-[10px] opacity-75">
                  ({report?.apps.length ?? 0})
                </span>
              </button>
            </div>

            {report && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-zinc-400">
                <Zap size={11} className="text-amber-300" />
                {report.durationMs} ms
              </span>
            )}

            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={loadReport}
              className="rounded-full border border-white/10 bg-white/[0.03] p-2 text-zinc-400 hover:border-white/25 hover:text-white"
            >
              <RefreshCw size={13} className={cn(isScanning && 'animate-spin')} />
            </motion.button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-[15px] border border-white/[0.08] bg-[#050507]/85 p-3.5">
            <span className="text-[11px] text-zinc-500">{t.leftoversFoundLabel}</span>
            <p className="mt-1 font-mono text-[22px] font-semibold text-white tabular-nums">
              {formatBytes(totalReclaimable, 2)}
            </p>
          </div>
          <div className="rounded-[15px] border border-white/[0.08] bg-[#050507]/85 p-3.5">
            <span className="text-[11px] text-zinc-500">{t.installedCountLabel}</span>
            <p className="mt-1 font-mono text-[22px] font-semibold text-indigo-300 tabular-nums">
              {report?.apps.length ?? 0}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-[15px] border border-white/10 bg-[#050507]/85 p-3.5">
            <div>
              <span className="text-[11px] text-zinc-500">{t.selectedLabel}</span>
              <p className="mt-1 font-mono text-[20px] font-semibold text-emerald-400 tabular-nums">
                {formatBytes(selectedBytes, 2)}
              </p>
            </div>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={isCleaning || selectedBytes === 0}
              onClick={handleCleanSelected}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold transition-all',
                selectedBytes > 0 && !isCleaning
                  ? 'bg-white text-black hover:bg-zinc-200'
                  : 'cursor-not-allowed border border-white/10 bg-zinc-900 text-zinc-500'
              )}
            >
              {isCleaning ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Trash2 size={13} />
              )}
              <span>{t.cleanLeftoversBtn}</span>
            </motion.button>
          </div>
        </div>
      </BentoCard>

      {/* Main Content Card */}
      <BentoCard className="col-span-12 p-6" delay={0.05}>
        {isScanning ? (
          <div className="flex h-64 items-center justify-center gap-2 text-xs text-zinc-400">
            <Loader2 size={16} className="animate-spin text-indigo-400" />
            <span>{t.scanning}</span>
          </div>
        ) : subTab === 'leftovers' ? (
          combinedCleanable.length === 0 ? (
            <div className="flex h-60 flex-col items-center justify-center text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
                <Sparkles size={19} />
              </div>
              <p className="mt-3 text-sm font-medium text-zinc-200">
                {t.leftoverEmptyTitle}
              </p>
              <p className="mt-1 max-w-md text-xs text-zinc-500">
                {t.leftoverEmptyDesc}
              </p>
            </div>
          ) : (
            <div className="max-h-[470px] space-y-2 overflow-y-auto pr-1">
              {combinedCleanable.map((item) => {
                const checked = !item.isProtected && selectedPaths.has(item.path);
                return (
                  <div
                    key={item.id}
                    onClick={() => toggleSelect(item.path, item.isProtected)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onOpenContextMenu(e, {
                        name: item.title,
                        path: item.path,
                        isDir: true,
                        sizeBytes: item.sizeBytes,
                        isProtected: item.isProtected,
                      });
                    }}
                    className={cn(
                      'group/row flex cursor-pointer items-center justify-between gap-3 rounded-[14px] border p-3.5 transition-all',
                      item.isProtected
                        ? 'border-emerald-500/20 bg-emerald-500/[0.03] opacity-75'
                        : checked
                          ? 'border-white/[0.15] bg-white/[0.03]'
                          : 'border-white/[0.06] bg-[#050507]/60 opacity-70 hover:opacity-100'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                          item.isProtected
                            ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                            : checked
                              ? 'border-white bg-white text-black'
                              : 'border-zinc-700 bg-transparent'
                        )}
                      >
                        {item.isProtected ? (
                          <Shield size={10} />
                        ) : (
                          checked && <Check size={11} strokeWidth={3} />
                        )}
                      </div>

                      <SquircleIcon
                        icon={item.kind === 'redist' ? Gamepad2 : Ghost}
                        tone={item.kind === 'redist' ? 'amber' : 'indigo'}
                        size="sm"
                      />

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-zinc-100">
                            {item.title}
                          </span>
                          <span
                            className={cn(
                              'rounded-md border px-1.5 py-0.5 text-[10px]',
                              item.confidence === 'high'
                                ? 'border-amber-400/25 bg-amber-500/10 text-amber-200'
                                : 'border-white/10 bg-white/[0.04] text-zinc-400'
                            )}
                          >
                            {item.badge}
                          </span>
                          {item.isProtected && (
                            <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                              {t.protectedBadge}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                          <span className="max-w-[340px] truncate font-mono">
                            {item.path}
                          </span>
                          <span>·</span>
                          <span>{item.subtitle}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-white tabular-nums">
                        {formatBytes(item.sizeBytes)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleProtect(item.path, item.isProtected);
                        }}
                        title={
                          item.isProtected ? t.ctxUnprotectPath : t.ctxProtectPath
                        }
                        className={cn(
                          'rounded-lg border p-1.5 transition-all',
                          item.isProtected
                            ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-300'
                            : 'border-white/10 bg-zinc-900/90 text-zinc-400 opacity-0 group-hover/row:opacity-100 hover:border-emerald-400/35 hover:text-emerald-300'
                        )}
                      >
                        <Shield size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRevealPath(item.path);
                        }}
                        className="rounded-lg border border-white/10 bg-zinc-900/90 p-1.5 text-zinc-400 opacity-0 transition-all group-hover/row:opacity-100 hover:border-white/25 hover:text-white"
                      >
                        <FolderOpen size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* Installed Applications Inventory */
          <div>
            <div className="relative mb-3">
              <Search
                size={13}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                type="text"
                value={appSearch}
                onChange={(e) => setAppSearch(e.target.value)}
                placeholder={t.searchAppsPlaceholder}
                className="w-full rounded-[13px] border border-white/10 bg-[#050507] py-2 pl-9 pr-3.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-white/25 focus:outline-none"
              />
            </div>

            <div className="max-h-[430px] space-y-1.5 overflow-y-auto pr-1">
              {filteredApps.map((app) => (
                <div
                  key={app.id}
                  className="group/app flex items-center justify-between gap-3 rounded-[13px] border border-white/[0.07] bg-[#050507]/75 px-3.5 py-2.5 transition-colors hover:border-white/15"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <SquircleIcon icon={Package} tone="obsidian" size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-zinc-100">
                          {app.name}
                        </span>
                        <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {app.version}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {app.publisher}
                        {app.installLocation ? ` · ${app.installLocation}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {app.sizeBytes > 0 && (
                      <span className="font-mono text-xs font-semibold text-zinc-200 tabular-nums">
                        {formatBytes(app.sizeBytes, 1)}
                      </span>
                    )}
                    {app.installLocation && (
                      <>
                        <button
                          type="button"
                          onClick={() => onInspectSpaceLens(app.installLocation!)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-300 hover:border-cyan-400/35 hover:text-cyan-200"
                        >
                          <Layers size={11} />
                          <span>{t.inspectFolderBtn}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRevealPath(app.installLocation!)}
                          className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-zinc-400 hover:border-white/25 hover:text-white"
                        >
                          <FolderOpen size={12} />
                        </button>
                      </>
                    )}
                    {app.uninstallCommand && (
                      <button
                        type="button"
                        onClick={() => handleUninstall(app.uninstallCommand!)}
                        className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-200 hover:bg-rose-500/20"
                      >
                        {t.uninstallBtn}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </BentoCard>
    </div>
  );
};
