import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Box,
  Check,
  Clock,
  Code2,
  Container,
  FolderOpen,
  Gamepad2,
  Layers,
  Loader2,
  Package,
  Shield,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import { ContextMenuTarget, DevJunkItem } from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes, formatCompactCount } from '../lib/format';
import { BentoCard } from './BentoCard';
import { SquircleIcon, SquircleTone } from './SquircleIcon';

interface DevJunkCardProps {
  items: DevJunkItem[];
  durationMs: number;
  isScanning: boolean;
  isCleaning: boolean;
  protectedSet: Set<string>;
  onToggleProtect: (path: string, currentlyProtected: boolean) => Promise<void>;
  onCleanItems: (selected: DevJunkItem[]) => Promise<void>;
  onRevealPath: (path: string) => void;
  onOpenContextMenu: (
    e: React.MouseEvent,
    item: Omit<ContextMenuTarget, 'x' | 'y'>
  ) => void;
  t: TranslationSet;
}

const categoryMeta: Record<
  string,
  { label: string; icon: typeof Package; tone: SquircleTone }
> = {
  node_modules: { label: 'node_modules', icon: Package, tone: 'emerald' },
  rust_target: { label: 'target (Rust)', icon: Box, tone: 'amber' },
  python_venv: { label: '.venv / Python', icon: Terminal, tone: 'indigo' },
  docker_cache: { label: 'Docker', icon: Container, tone: 'cyan' },
  gradle_pods: { label: 'Gradle / Pods', icon: Layers, tone: 'rose' },
  web_cache: { label: '.next / Turbo', icon: Code2, tone: 'obsidian' },
  game_redist: { label: 'Game Redist', icon: Gamepad2, tone: 'amber' },
};

export const DevJunkCard: React.FC<DevJunkCardProps> = ({
  items,
  durationMs,
  isScanning,
  isCleaning,
  protectedSet,
  onToggleProtect,
  onCleanItems,
  onRevealPath,
  onOpenContextMenu,
  t,
}) => {
  const [activeCat, setActiveCat] = useState<string>('all');
  const [minDaysOld, setMinDaysOld] = useState<number>(0);
  const [unselectedIds, setUnselectedIds] = useState<Set<string>>(new Set());

  const isItemProtected = (item: DevJunkItem) =>
    Boolean(item.isProtected) || protectedSet.has(item.path.toLowerCase());

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeCat !== 'all' && item.category !== activeCat) return false;
      if (minDaysOld > 0 && item.modifiedDaysAgo < minDaysOld) return false;
      return true;
    });
  }, [items, activeCat, minDaysOld]);

  const cleanableItems = useMemo(
    () => filteredItems.filter((item) => !isItemProtected(item)),
    [filteredItems, protectedSet]
  );

  const selectedItems = useMemo(
    () => cleanableItems.filter((item) => !unselectedIds.has(item.id)),
    [cleanableItems, unselectedIds]
  );

  const selectedBytes = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.sizeBytes, 0),
    [selectedItems]
  );

  const categoriesPresent = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.category] = (counts[item.category] || 0) + item.sizeBytes;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const toggleItem = (item: DevJunkItem) => {
    if (isItemProtected(item)) return;
    setUnselectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (selectedItems.length === cleanableItems.length) {
      setUnselectedIds((prev) => {
        const next = new Set(prev);
        cleanableItems.forEach((i) => next.add(i.id));
        return next;
      });
    } else {
      setUnselectedIds((prev) => {
        const next = new Set(prev);
        cleanableItems.forEach((i) => next.delete(i.id));
        return next;
      });
    }
  };

  const ageFilters = [
    { days: 0, label: t.ageAll },
    { days: 7, label: t.age7d },
    { days: 30, label: t.age30d },
  ];

  return (
    <BentoCard className="col-span-12 lg:col-span-7 p-6" delay={0.06}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <SquircleIcon icon={Terminal} tone="indigo" size="md" />
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">
              {t.devTitle}
            </h2>
            <p className="text-xs text-zinc-400">{t.devSubtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-[#050507] p-0.5">
            {ageFilters.map((af) => {
              const active = minDaysOld === af.days;
              return (
                <button
                  key={af.days}
                  type="button"
                  onClick={() => setMinDaysOld(af.days)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                    active
                      ? 'bg-zinc-800 text-white border border-white/15'
                      : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  {af.days > 0 && <Clock size={10} />}
                  {af.label}
                </button>
              );
            })}
          </div>

          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-zinc-400">
            <Zap size={11} className="text-amber-300" />
            {durationMs} ms
          </span>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => setActiveCat('all')}
            className={cn(
              'whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors',
              activeCat === 'all'
                ? 'bg-white text-zinc-950'
                : 'border border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
            )}
          >
            {t.allEcosystems} ({items.length})
          </motion.button>

          {categoriesPresent.map(([catKey, catBytes]) => {
            const meta = categoryMeta[catKey] || {
              label: catKey,
              icon: Package,
              tone: 'obsidian' as SquircleTone,
            };
            const active = activeCat === catKey;
            return (
              <motion.button
                key={catKey}
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={() => setActiveCat(catKey)}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-white text-zinc-950'
                    : 'border border-white/10 bg-white/[0.02] text-zinc-300 hover:border-white/20 hover:text-white'
                )}
              >
                <span>{meta.label}</span>
                <span
                  className={cn(
                    'ml-1 font-mono text-[11px]',
                    active ? 'text-zinc-700' : 'text-zinc-500'
                  )}
                >
                  {formatBytes(catBytes, 1)}
                </span>
              </motion.button>
            );
          })}
        </div>

        {cleanableItems.length > 0 && (
          <button
            type="button"
            onClick={toggleAllVisible}
            className="shrink-0 text-[11px] font-medium text-zinc-400 transition-colors hover:text-white"
          >
            {selectedItems.length === cleanableItems.length
              ? t.deselectAll
              : t.selectAll}
          </button>
        )}
      </div>

      {/* Artifact Rows */}
      <div className="mt-3 flex-1 min-h-[230px] max-h-[272px] overflow-y-auto pr-1 space-y-1.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {filteredItems.length === 0 ? (
            <motion.div
              key="empty-dev"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-6 text-center"
            >
              <SquircleIcon icon={Sparkles} tone="emerald" size="lg" />
              <p className="mt-3 text-sm font-medium text-zinc-200">
                {t.devEmptyTitle}
              </p>
              <p className="mt-1 max-w-sm text-xs text-zinc-500">
                {t.devEmptyDesc}
              </p>
            </motion.div>
          ) : (
            filteredItems.map((item) => {
              const isProt = isItemProtected(item);
              const isSelected = !isProt && !unselectedIds.has(item.id);
              const meta = categoryMeta[item.category] || {
                label: item.category,
                icon: Package,
                tone: 'obsidian' as SquircleTone,
              };

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -16, scale: 0.97 }}
                  whileTap={{ scale: 0.992 }}
                  onClick={() => toggleItem(item)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onOpenContextMenu(e, {
                      name: item.projectName,
                      path: item.path,
                      isDir: true,
                      sizeBytes: item.sizeBytes,
                      isProtected: isProt,
                    });
                  }}
                  className={cn(
                    'group/row flex cursor-pointer items-center justify-between gap-3 rounded-[14px] border px-3.5 py-2.5 transition-colors',
                    isProt
                      ? 'border-emerald-500/20 bg-emerald-500/[0.03] opacity-75'
                      : isSelected
                        ? 'border-white/[0.11] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.045]'
                        : 'border-white/[0.05] bg-transparent opacity-55 hover:opacity-85'
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                        isProt
                          ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                          : isSelected
                            ? 'border-white bg-white text-zinc-950'
                            : 'border-white/25 bg-zinc-950'
                      )}
                    >
                      {isProt ? (
                        <Shield size={10} />
                      ) : (
                        isSelected && <Check size={11} strokeWidth={3} />
                      )}
                    </div>

                    <SquircleIcon icon={meta.icon} tone={meta.tone} size="sm" />

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-zinc-100">
                          {item.projectName}
                        </span>
                        <span className="hidden sm:inline-block rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {item.ecosystem}
                        </span>
                        {isProt && (
                          <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                            {t.protectedBadge}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                        <span className="truncate max-w-[250px] font-mono">
                          {item.path}
                        </span>
                        <span>·</span>
                        <span className="shrink-0">
                          {formatCompactCount(item.fileCount)} {t.filesUnit}
                        </span>
                        <span>·</span>
                        <span className="shrink-0">
                          {item.modifiedDaysAgo === 0
                            ? t.today
                            : `${item.modifiedDaysAgo} ${t.daysAgo}`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleProtect(item.path, isProt);
                      }}
                      className={cn(
                        'rounded-lg p-1.5 transition-all',
                        isProt
                          ? 'text-emerald-300 opacity-100'
                          : 'text-zinc-500 opacity-0 hover:bg-white/10 hover:text-emerald-300 group-hover/row:opacity-100'
                      )}
                      title={isProt ? t.ctxUnprotectPath : t.ctxProtectPath}
                    >
                      <Shield size={13} />
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRevealPath(item.path);
                      }}
                      className="rounded-lg p-1.5 text-zinc-500 opacity-0 transition-all hover:bg-white/10 hover:text-zinc-200 group-hover/row:opacity-100"
                      title={t.revealFolder}
                    >
                      <FolderOpen size={14} />
                    </button>

                    <span className="min-w-[68px] text-right font-mono text-[13px] font-semibold text-white tabular-nums">
                      {formatBytes(item.sizeBytes, 2)}
                    </span>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Footer CTA Bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
        <div className="text-xs text-zinc-400">
          <span>{t.selectedLabel}: </span>
          <span className="font-mono font-semibold text-white">
            {selectedItems.length}
          </span>
          <span className="mx-1.5 text-zinc-600">·</span>
          <span className="font-mono font-semibold text-indigo-300 tabular-nums">
            {formatBytes(selectedBytes, 2)}
          </span>
        </div>

        <motion.button
          type="button"
          disabled={selectedItems.length === 0 || isCleaning || isScanning}
          whileHover={selectedItems.length > 0 ? { scale: 1.015 } : undefined}
          whileTap={selectedItems.length > 0 ? { scale: 0.98 } : undefined}
          transition={{ type: 'spring', stiffness: 450, damping: 28 }}
          onClick={() => onCleanItems(selectedItems)}
          className={cn(
            'group/btn inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all',
            selectedItems.length > 0 && !isCleaning
              ? 'bg-white text-[#050505] shadow-[0_0_25px_rgba(255,255,255,0.18)] hover:bg-zinc-200'
              : 'cursor-not-allowed border border-white/10 bg-white/[0.04] text-zinc-500'
          )}
        >
          {isCleaning ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>{t.cleaning}</span>
            </>
          ) : (
            <>
              <span>
                {t.cleanSelected}{' '}
                {selectedBytes > 0 ? `· ${formatBytes(selectedBytes, 1)}` : ''}
              </span>
              <ArrowRight
                size={14}
                className="transition-transform duration-200 group-hover/btn:translate-x-0.5"
              />
            </>
          )}
        </motion.button>
      </div>
    </BentoCard>
  );
};
