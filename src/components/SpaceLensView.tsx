import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Camera,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  GitCompareArrows,
  HardDrive,
  Home,
  Layers,
  Loader2,
  RefreshCw,
  Shield,
  Trash2,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  ContextMenuTarget,
  DiskTelemetry,
  SpaceLensReport,
  SpaceNode,
} from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes, formatCompactCount } from '../lib/format';
import { runSpaceLensScan, saveSpaceSnapshot } from '../lib/bridge';
import { BentoCard } from './BentoCard';
import { SquircleIcon } from './SquircleIcon';

interface SpaceLensViewProps {
  initialPath: string;
  disks?: DiskTelemetry[];
  homeDir?: string;
  protectedSet: Set<string>;
  onToggleProtect: (path: string, currentlyProtected: boolean) => Promise<void>;
  onRevealPath: (path: string) => void;
  onTrashNode: (node: SpaceNode) => Promise<boolean>;
  onOpenContextMenu: (
    e: React.MouseEvent,
    item: Omit<ContextMenuTarget, 'x' | 'y'>
  ) => void;
  onSnapshotSaved: () => void;
  t: TranslationSet;
}

const TILE_PALETTES = [
  'from-indigo-500/22 via-indigo-500/8 to-zinc-950/90 border-indigo-400/30 hover:border-indigo-300/55',
  'from-emerald-500/20 via-emerald-500/7 to-zinc-950/90 border-emerald-400/30 hover:border-emerald-300/55',
  'from-amber-500/20 via-amber-500/7 to-zinc-950/90 border-amber-400/30 hover:border-amber-300/55',
  'from-cyan-500/20 via-cyan-500/7 to-zinc-950/90 border-cyan-400/30 hover:border-cyan-300/55',
  'from-rose-500/20 via-rose-500/7 to-zinc-950/90 border-rose-400/30 hover:border-rose-300/55',
  'from-violet-500/20 via-violet-500/7 to-zinc-950/90 border-violet-400/30 hover:border-violet-300/55',
  'from-white/[0.09] via-white/[0.03] to-zinc-950/90 border-white/15 hover:border-white/30',
];

function formatSignedDelta(delta: number | null | undefined): string | null {
  if (delta === null || delta === undefined || Math.abs(delta) < 1024) {
    return null;
  }
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${formatBytes(Math.abs(delta), 1)}`;
}

export const SpaceLensView: React.FC<SpaceLensViewProps> = ({
  initialPath,
  disks = [],
  homeDir = '',
  protectedSet,
  onToggleProtect,
  onRevealPath,
  onTrashNode,
  onOpenContextMenu,
  onSnapshotSaved,
  t,
}) => {
  const [data, setData] = useState<SpaceLensReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [savingSnap, setSavingSnap] = useState<boolean>(false);
  const [diffOnly, setDiffOnly] = useState<boolean>(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadFolder = useCallback(async (targetPath?: string) => {
    setIsLoading(true);
    try {
      const resp = await runSpaceLensScan(targetPath || undefined);
      setData(resp);
      setSelectedNodeId(resp.nodes[0]?.id ?? null);
    } catch {
      // Keep existing view if directory becomes inaccessible
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFolder(initialPath || undefined);
  }, [initialPath, loadFolder]);

  const handleSaveBaseline = async () => {
    if (!data?.currentPath) return;
    setSavingSnap(true);
    try {
      await saveSpaceSnapshot(data.currentPath);
      onSnapshotSaved();
      await loadFolder(data.currentPath);
    } finally {
      setSavingSnap(false);
    }
  };

  const handleDrillDown = (node: SpaceNode) => {
    if (node.isDir) {
      loadFolder(node.path);
    } else {
      setSelectedNodeId(node.id);
    }
  };

  const handleTrash = async (node: SpaceNode) => {
    if (node.isProtected || protectedSet.has(node.path.toLowerCase())) return;
    setDeletingId(node.id);
    try {
      const deleted = await onTrashNode(node);
      if (deleted) {
        await loadFolder(data?.currentPath);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const visibleNodes = useMemo(() => {
    const raw = data?.nodes ?? [];
    if (!diffOnly) return raw;
    return raw.filter(
      (n) => n.deltaBytes !== null && n.deltaBytes !== undefined && Math.abs(n.deltaBytes) >= 1024
    );
  }, [data, diffOnly]);

  const breadcrumbs = data?.breadcrumbs ?? [];
  const topTiles = visibleNodes.slice(0, 9);
  const totalDeltaLabel = formatSignedDelta(data?.totalDeltaBytes);

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Left 7 Cols: Visual Proportional Space Lens Treemap */}
      <BentoCard className="col-span-12 lg:col-span-7 p-6" delay={0.02}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <SquircleIcon icon={Layers} tone="cyan" size="md" />
            <div>
              <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">
                {t.spaceLensTitle}
              </h2>
              <p className="text-xs text-zinc-400">{t.spaceLensSubtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {data && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-zinc-400">
                <Zap size={11} className="text-cyan-300" />
                {data.durationMs} ms
              </span>
            )}

            <button
              type="button"
              onClick={() => setDiffOnly((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                diffOnly
                  ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                  : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/25 hover:text-white'
              )}
            >
              <GitCompareArrows size={11} />
              <span>{t.diffOnlyToggle}</span>
            </button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              disabled={savingSnap || !data}
              onClick={handleSaveBaseline}
              className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              <Camera size={11} />
              <span>{t.saveBaselineBtn}</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => loadFolder(data?.currentPath)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300 hover:border-white/25 hover:text-white"
            >
              <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
            </motion.button>
          </div>
        </div>

        {/* Storage Diff Status Strip */}
        {data && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-white/[0.08] bg-[#050507]/85 px-3 py-1.5 text-[11px]">
            <div className="flex items-center gap-2 text-zinc-400">
              <GitCompareArrows size={12} className="text-cyan-400" />
              <span>{t.baselineSavedBadge}</span>
              {data.snapshotTimestamp && (
                <span className="font-mono text-[10px] text-zinc-500">
                  ({new Date(data.snapshotTimestamp * 1000).toLocaleDateString()})
                </span>
              )}
            </div>
            {totalDeltaLabel ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
                  (data.totalDeltaBytes ?? 0) > 0
                    ? 'border-rose-400/35 bg-rose-500/15 text-rose-200'
                    : 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200'
                )}
              >
                {(data.totalDeltaBytes ?? 0) > 0 ? (
                  <TrendingUp size={10} />
                ) : (
                  <TrendingDown size={10} />
                )}
                {totalDeltaLabel} {t.diffSinceBaseline}
              </span>
            ) : (
              <span className="font-mono text-[10px] text-zinc-500">
                ±0 B {t.diffSinceBaseline}
              </span>
            )}
          </div>
        )}

        {/* Quick Drive & Home Switcher Pills */}
        {(disks.length > 0 || homeDir) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {homeDir && (
              <button
                type="button"
                onClick={() => loadFolder(homeDir)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  data?.currentPath === homeDir
                    ? 'border-white/25 bg-white/10 text-white'
                    : 'border-white/10 bg-[#050507] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                )}
              >
                <Home size={11} />
                <span>{t.resetDefaultRoot}</span>
              </button>
            )}
            {disks.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => loadFolder(d.mountPoint)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium transition-colors',
                  data?.currentPath === d.mountPoint
                    ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-200'
                    : 'border-white/10 bg-[#050507] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                )}
              >
                <HardDrive size={11} />
                <span>{d.mountPoint}</span>
              </button>
            ))}
          </div>
        )}

        {/* Interactive Breadcrumb Bar */}
        <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto rounded-[13px] border border-white/[0.08] bg-[#050507] px-2.5 py-1.5">
          {data?.parentPath && (
            <button
              type="button"
              onClick={() => loadFolder(data.parentPath!)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-zinc-200 hover:border-white/25 hover:bg-white/[0.08]"
            >
              <ArrowUp size={12} />
              {t.upFolder}
            </button>
          )}
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.path}>
                  {idx > 0 && (
                    <ChevronRight size={12} className="shrink-0 text-zinc-600" />
                  )}
                  <button
                    type="button"
                    onClick={() => loadFolder(crumb.path)}
                    className={cn(
                      'whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-[11px] transition-colors',
                      isLast
                        ? 'bg-white/10 font-semibold text-white'
                        : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'
                    )}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Visual Bento Treemap Mosaic */}
        <div className="mt-3.5 min-h-[325px]">
          {isLoading ? (
            <div className="flex h-[325px] flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#050507]">
              <Loader2 size={24} className="animate-spin text-zinc-300" />
              <span className="mt-2.5 text-xs text-zinc-400">{t.scanning}</span>
            </div>
          ) : topTiles.length === 0 ? (
            <div className="flex h-[325px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-6 text-center">
              <Folder size={26} className="text-zinc-500" />
              <p className="mt-2 text-sm text-zinc-300">{t.spaceEmpty}</p>
            </div>
          ) : (
            <div className="grid grid-cols-12 auto-rows-[104px] gap-2.5">
              {topTiles.map((tile, idx) => {
                const spanClass =
                  idx === 0
                    ? 'col-span-12 sm:col-span-7 row-span-2'
                    : idx === 1
                      ? 'col-span-12 sm:col-span-5 row-span-2'
                      : idx < 5
                        ? 'col-span-6 sm:col-span-4 row-span-1'
                        : 'col-span-6 sm:col-span-3 row-span-1';

                const palette = TILE_PALETTES[idx % TILE_PALETTES.length];
                const isSelected = selectedNodeId === tile.id;
                const deltaStr = formatSignedDelta(tile.deltaBytes);
                const isProt =
                  Boolean(tile.isProtected) ||
                  protectedSet.has(tile.path.toLowerCase());

                return (
                  <motion.button
                    key={tile.id}
                    type="button"
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      type: 'spring',
                      stiffness: 380,
                      damping: 30,
                      delay: idx * 0.015,
                    }}
                    whileHover={{ scale: 0.992 }}
                    whileTap={{ scale: 0.975 }}
                    onClick={() => handleDrillDown(tile)}
                    onMouseEnter={() => setSelectedNodeId(tile.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onOpenContextMenu(e, {
                        name: tile.name,
                        path: tile.path,
                        isDir: tile.isDir,
                        sizeBytes: tile.sizeBytes,
                        isProtected: isProt,
                      });
                    }}
                    className={cn(
                      'group relative flex flex-col justify-between overflow-hidden rounded-[16px] border bg-gradient-to-br p-3.5 text-left transition-all',
                      spanClass,
                      palette,
                      isSelected && 'ring-1 ring-white/40'
                    )}
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {tile.isDir ? (
                          <Folder size={15} className="shrink-0 text-white/85" />
                        ) : (
                          <FileText size={15} className="shrink-0 text-zinc-300" />
                        )}
                        <span className="truncate text-xs font-semibold text-white">
                          {tile.name}
                        </span>
                        {isProt && (
                          <Shield size={11} className="shrink-0 text-emerald-300" />
                        )}
                      </div>
                      <span className="shrink-0 rounded-full bg-black/45 px-2 py-0.5 font-mono text-[10px] text-zinc-200">
                        {tile.sharePercent.toFixed(1)}%
                      </span>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm sm:text-base font-semibold text-white tabular-nums">
                          {formatBytes(tile.sizeBytes, 2)}
                        </span>
                        {deltaStr && (
                          <span
                            className={cn(
                              'rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                              (tile.deltaBytes ?? 0) > 0
                                ? 'bg-rose-500/25 text-rose-200'
                                : 'bg-emerald-500/25 text-emerald-200'
                            )}
                          >
                            {deltaStr}
                          </span>
                        )}
                      </div>
                      {idx < 2 && (
                        <div className="mt-0.5 text-[11px] text-zinc-300/80">
                          {formatCompactCount(tile.fileCount)} {t.filesUnit}
                          {tile.isDir ? ` · ${t.drillDownHint}` : ''}
                        </div>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      </BentoCard>

      {/* Right 5 Cols: Ranked Directory Contents + Diff Badges + Actions */}
      <BentoCard className="col-span-12 lg:col-span-5 p-6" delay={0.06}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-zinc-400">
              {t.totalCapacity} · {t.treemapShare}
            </div>
            <div className="mt-0.5 font-mono text-2xl font-semibold text-white tabular-nums">
              {formatBytes(data?.totalBytes || 0, 2)}
            </div>
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-zinc-400">
            {visibleNodes.length} {t.itemsCountSuffix}
          </span>
        </div>

        <div className="mt-4 flex-1 min-h-[340px] max-h-[430px] overflow-y-auto pr-1 space-y-1.5">
          <AnimatePresence mode="popLayout" initial={false}>
            {visibleNodes.map((node) => {
              const active = selectedNodeId === node.id;
              const isRemoving = deletingId === node.id;
              const deltaStr = formatSignedDelta(node.deltaBytes);
              const isProt =
                Boolean(node.isProtected) ||
                protectedSet.has(node.path.toLowerCase());

              return (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 14 }}
                  onMouseEnter={() => setSelectedNodeId(node.id)}
                  onClick={() => handleDrillDown(node)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onOpenContextMenu(e, {
                      name: node.name,
                      path: node.path,
                      isDir: node.isDir,
                      sizeBytes: node.sizeBytes,
                      isProtected: isProt,
                    });
                  }}
                  className={cn(
                    'group/item relative cursor-pointer overflow-hidden rounded-[13px] border px-3 py-2.5 transition-colors',
                    active
                      ? 'border-white/20 bg-white/[0.05]'
                      : 'border-white/[0.07] bg-white/[0.015] hover:border-white/15'
                  )}
                >
                  <div
                    aria-hidden="true"
                    style={{ width: `${Math.max(4, node.sharePercent)}%` }}
                    className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-400/[0.08] to-transparent"
                  />

                  <div className="relative z-10 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {node.isDir ? (
                        <Folder size={15} className="shrink-0 text-cyan-300" />
                      ) : (
                        <FileText size={15} className="shrink-0 text-zinc-400" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-zinc-100">
                            {node.name}
                          </span>
                          {isProt && (
                            <Shield
                              size={11}
                              className="shrink-0 text-emerald-400"
                            />
                          )}
                          {deltaStr && (
                            <span
                              className={cn(
                                'shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold',
                                (node.deltaBytes ?? 0) > 0
                                  ? 'bg-rose-500/15 text-rose-300'
                                  : 'bg-emerald-500/15 text-emerald-300'
                              )}
                            >
                              {deltaStr}
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-zinc-500">
                          {node.sharePercent.toFixed(1)}% ·{' '}
                          {formatCompactCount(node.fileCount)} {t.filesUnit}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleProtect(node.path, isProt);
                        }}
                        className={cn(
                          'rounded-lg p-1.5 transition-all',
                          isProt
                            ? 'text-emerald-300 opacity-100'
                            : 'text-zinc-500 opacity-0 hover:bg-white/10 hover:text-emerald-300 group-hover/item:opacity-100'
                        )}
                        title={isProt ? t.ctxUnprotectPath : t.ctxProtectPath}
                      >
                        <Shield size={13} />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRevealPath(node.path);
                        }}
                        className="rounded-lg p-1.5 text-zinc-500 opacity-0 transition-all hover:bg-white/10 hover:text-zinc-200 group-hover/item:opacity-100"
                        title={t.revealFolder}
                      >
                        <FolderOpen size={13} />
                      </button>

                      {!isProt && (
                        <button
                          type="button"
                          disabled={isRemoving}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTrash(node);
                          }}
                          className="rounded-lg p-1.5 text-zinc-500 opacity-0 transition-all hover:bg-rose-500/15 hover:text-rose-300 group-hover/item:opacity-100"
                          title={t.moveToTrash}
                        >
                          {isRemoving ? (
                            <Loader2
                              size={13}
                              className="animate-spin text-rose-300"
                            />
                          ) : (
                            <Trash2 size={13} />
                          )}
                        </button>
                      )}

                      <span className="min-w-[68px] text-right font-mono text-xs font-semibold text-white tabular-nums">
                        {formatBytes(node.sizeBytes, 1)}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </BentoCard>
    </div>
  );
};
