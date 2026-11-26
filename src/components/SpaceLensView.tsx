import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Layers,
  Loader2,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react';
import { SpaceLensReport, SpaceNode } from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes, formatCompactCount } from '../lib/format';
import { runSpaceLensScan } from '../lib/bridge';
import { BentoCard } from './BentoCard';
import { SquircleIcon } from './SquircleIcon';

interface SpaceLensViewProps {
  initialPath: string;
  onRevealPath: (path: string) => void;
  onTrashNode: (node: SpaceNode) => Promise<void>;
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

export const SpaceLensView: React.FC<SpaceLensViewProps> = ({
  initialPath,
  onRevealPath,
  onTrashNode,
  t,
}) => {
  const [data, setData] = useState<SpaceLensReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadFolder = useCallback(async (targetPath?: string) => {
    setIsLoading(true);
    try {
      const resp = await runSpaceLensScan(targetPath || undefined);
      setData(resp);
      setSelectedNodeId(resp.nodes[0]?.id ?? null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFolder(initialPath || undefined);
  }, [initialPath, loadFolder]);

  const handleDrillDown = (node: SpaceNode) => {
    if (node.isDir) {
      loadFolder(node.path);
    } else {
      setSelectedNodeId(node.id);
    }
  };

  const handleTrash = async (node: SpaceNode) => {
    setDeletingId(node.id);
    try {
      await onTrashNode(node);
      await loadFolder(data?.currentPath);
    } finally {
      setDeletingId(null);
    }
  };

  const breadcrumbs = data?.breadcrumbs ?? [];
  const topTiles = (data?.nodes || []).slice(0, 9);

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

          <div className="flex items-center gap-2">
            {data && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-zinc-400">
                <Zap size={11} className="text-cyan-300" />
                {data.durationMs} ms
              </span>
            )}
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => loadFolder(data?.currentPath)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-300 hover:border-white/25 hover:text-white"
            >
              <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
            </motion.button>
          </div>
        </div>

        {/* Interactive Breadcrumb Bar */}
        <div className="mt-4 flex items-center gap-1.5 overflow-x-auto rounded-[13px] border border-white/[0.08] bg-[#050507] px-2.5 py-1.5">
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
        <div className="mt-4 min-h-[340px]">
          {isLoading ? (
            <div className="flex h-[340px] flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-[#050507]">
              <Loader2 size={24} className="animate-spin text-zinc-300" />
              <span className="mt-2.5 text-xs text-zinc-400">{t.scanning}</span>
            </div>
          ) : topTiles.length === 0 ? (
            <div className="flex h-[340px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-6 text-center">
              <Folder size={26} className="text-zinc-500" />
              <p className="mt-2 text-sm text-zinc-300">{t.spaceEmpty}</p>
            </div>
          ) : (
            <div className="grid grid-cols-12 auto-rows-[108px] gap-2.5">
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

                return (
                  <motion.button
                    key={tile.id}
                    type="button"
                    layout
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      type: 'spring',
                      stiffness: 360,
                      damping: 30,
                      delay: idx * 0.02,
                    }}
                    whileHover={{ scale: 0.992 }}
                    whileTap={{ scale: 0.975 }}
                    onClick={() => handleDrillDown(tile)}
                    onMouseEnter={() => setSelectedNodeId(tile.id)}
                    className={cn(
                      'group relative flex flex-col justify-between overflow-hidden rounded-[16px] border bg-gradient-to-br p-3.5 text-left transition-all',
                      spanClass,
                      palette,
                      isSelected && 'ring-1 ring-white/40'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 w-full">
                      <div className="flex min-w-0 items-center gap-2">
                        {tile.isDir ? (
                          <Folder size={15} className="shrink-0 text-white/85" />
                        ) : (
                          <FileText size={15} className="shrink-0 text-zinc-300" />
                        )}
                        <span className="truncate text-xs font-semibold text-white">
                          {tile.name}
                        </span>
                      </div>
                      <span className="shrink-0 rounded-full bg-black/45 px-2 py-0.5 font-mono text-[10px] text-zinc-200">
                        {tile.sharePercent.toFixed(1)}%
                      </span>
                    </div>

                    <div>
                      <div className="font-mono text-sm sm:text-base font-semibold text-white tabular-nums">
                        {formatBytes(tile.sizeBytes, 2)}
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

      {/* Right 5 Cols: Ranked Directory Contents + Actions */}
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
            {data?.nodes.length || 0} items
          </span>
        </div>

        <div className="mt-4 flex-1 min-h-[340px] max-h-[410px] overflow-y-auto pr-1 space-y-1.5">
          <AnimatePresence mode="popLayout" initial={false}>
            {(data?.nodes || []).map((node) => {
              const active = selectedNodeId === node.id;
              const isRemoving = deletingId === node.id;
              return (
                <motion.div
                  layout
                  key={node.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  onMouseEnter={() => setSelectedNodeId(node.id)}
                  onClick={() => handleDrillDown(node)}
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
                        <div className="truncate text-[13px] font-medium text-zinc-100">
                          {node.name}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-500">
                          {node.sharePercent.toFixed(1)}% ·{' '}
                          {formatCompactCount(node.fileCount)} {t.filesUnit}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
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
                        <Trash2 size={13} />
                      </button>

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
