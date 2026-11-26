import React, { useEffect, useMemo, useState } from 'react';
import { animate, AnimatePresence, motion } from 'framer-motion';
import * as Switch from '@radix-ui/react-switch';
import {
  Archive,
  CheckCircle2,
  Cpu,
  FileWarning,
  Flame,
  Gamepad2,
  Globe,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { SystemCacheItem } from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes, formatCompactCount } from '../lib/format';
import { BentoCard } from './BentoCard';
import { SquircleIcon, SquircleTone } from './SquircleIcon';

interface SystemCacheCardProps {
  items: SystemCacheItem[];
  isPurging: boolean;
  sessionCacheFreedBytes: number;
  onPurgeItems: (selected: SystemCacheItem[]) => Promise<void>;
  onRescanCache: () => void;
  t: TranslationSet;
}

const cacheCategoryVisuals: Record<
  string,
  { icon: typeof Flame; tone: SquircleTone }
> = {
  os_temp: { icon: Flame, tone: 'amber' },
  gpu_shader: { icon: Cpu, tone: 'emerald' },
  game_cache: { icon: Gamepad2, tone: 'indigo' },
  app_cache: { icon: MessageSquare, tone: 'cyan' },
  browser_cache: { icon: Globe, tone: 'cyan' },
  pkg_cache: { icon: Archive, tone: 'indigo' },
  system_logs: { icon: FileWarning, tone: 'rose' },
};

export const SystemCacheCard: React.FC<SystemCacheCardProps> = ({
  items,
  isPurging,
  sessionCacheFreedBytes,
  onPurgeItems,
  onRescanCache,
  t,
}) => {
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set());
  const [groupFilter, setGroupFilter] = useState<
    'all' | 'gpu_game' | 'apps' | 'browser_os'
  >('all');
  const [displayedFreedGb, setDisplayedFreedGb] = useState<number>(0);

  useEffect(() => {
    const targetGb = sessionCacheFreedBytes / (1024 * 1024 * 1024);
    const controls = animate(displayedFreedGb, targetGb, {
      duration: 0.85,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplayedFreedGb(latest),
    });
    return () => controls.stop();
  }, [sessionCacheFreedBytes]);

  const filteredItems = useMemo(() => {
    if (groupFilter === 'all') return items;
    if (groupFilter === 'gpu_game') {
      return items.filter(
        (i) => i.category === 'gpu_shader' || i.category === 'game_cache'
      );
    }
    if (groupFilter === 'apps') {
      return items.filter((i) => i.category === 'app_cache');
    }
    return items.filter((i) =>
      ['os_temp', 'browser_cache', 'pkg_cache', 'system_logs'].includes(
        i.category
      )
    );
  }, [items, groupFilter]);

  const activeItems = useMemo(
    () => items.filter((item) => !item.isProtected && !disabledIds.has(item.id)),
    [items, disabledIds]
  );

  const selectedPurgeBytes = useMemo(
    () => activeItems.reduce((acc, item) => acc + item.sizeBytes, 0),
    [activeItems]
  );

  const toggleSwitch = (id: string, checked: boolean) => {
    setDisabledIds((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPoolBytes = Math.max(
    1,
    sessionCacheFreedBytes + items.reduce((acc, x) => acc + x.sizeBytes, 0)
  );
  const reclaimedRatioPct = Math.min(
    100,
    (sessionCacheFreedBytes / totalPoolBytes) * 100
  );

  const filterPills: Array<{
    id: 'all' | 'gpu_game' | 'apps' | 'browser_os';
    label: string;
  }> = [
    { id: 'all', label: t.cacheFilterAll },
    { id: 'gpu_game', label: t.cacheFilterGpu },
    { id: 'apps', label: t.cacheFilterApps },
    { id: 'browser_os', label: t.cacheFilterBrowser },
  ];

  return (
    <BentoCard className="col-span-12 lg:col-span-5 p-6" delay={0.1}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <SquircleIcon icon={Flame} tone="amber" size="md" />
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">
              {t.cacheTitle}
            </h2>
            <p className="text-xs text-zinc-400">{t.cacheSubtitle}</p>
          </div>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          onClick={onRescanCache}
          className="rounded-lg border border-white/10 bg-white/[0.02] p-1.5 text-zinc-400 transition-colors hover:border-white/20 hover:text-white"
          title={t.rescanCache}
        >
          <RefreshCw size={13} />
        </motion.button>
      </div>

      {/* Freed Gigabytes Visualizer Module */}
      <div className="mt-3.5 relative overflow-hidden rounded-[16px] border border-white/10 bg-gradient-to-br from-zinc-900/90 via-[#08080B] to-[#050507] p-4">
        <AnimatePresence>
          {isPurging && (
            <motion.div
              initial={{ opacity: 0, x: '-100%' }}
              animate={{ opacity: 1, x: '100%' }}
              exit={{ opacity: 0 }}
              transition={{ repeat: Infinity, duration: 1.15, ease: 'linear' }}
              className="pointer-events-none absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-amber-400/10 to-transparent"
            />
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
              {sessionCacheFreedBytes > 0 ? (
                <>
                  <CheckCircle2 size={12} className="text-emerald-400" />
                  <span className="text-emerald-300">{t.freedVisualLabel}</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={12} className="text-zinc-400" />
                  <span>{t.readyToPurge}</span>
                </>
              )}
            </div>

            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[25px] font-semibold tracking-[-0.04em] text-white tabular-nums">
                {sessionCacheFreedBytes > 0
                  ? `${displayedFreedGb.toFixed(2)} GB`
                  : formatBytes(selectedPurgeBytes, 2)}
              </span>
              {sessionCacheFreedBytes > 0 && selectedPurgeBytes > 0 && (
                <span className="font-mono text-xs text-zinc-500">
                  (+{formatBytes(selectedPurgeBytes, 1)})
                </span>
              )}
            </div>
          </div>

          <motion.button
            type="button"
            disabled={activeItems.length === 0 || isPurging}
            whileHover={activeItems.length > 0 ? { scale: 1.02 } : undefined}
            whileTap={activeItems.length > 0 ? { scale: 0.96 } : undefined}
            transition={{ type: 'spring', stiffness: 460, damping: 26 }}
            onClick={() => onPurgeItems(activeItems)}
            className={cn(
              'relative inline-flex h-11 items-center gap-2 overflow-hidden rounded-full px-5 text-xs font-semibold tracking-wide transition-all',
              activeItems.length > 0 && !isPurging
                ? 'bg-gradient-to-b from-white to-zinc-200 text-[#050505] shadow-[0_0_28px_rgba(255,255,255,0.22)]'
                : isPurging
                  ? 'border border-amber-400/40 bg-amber-500/15 text-amber-200'
                  : 'cursor-not-allowed border border-white/10 bg-white/[0.04] text-zinc-500'
            )}
          >
            {isPurging ? (
              <>
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
                  className="inline-flex"
                >
                  <RefreshCw size={14} />
                </motion.span>
                <span>{t.purgingBtn}</span>
              </>
            ) : activeItems.length === 0 && sessionCacheFreedBytes > 0 ? (
              <>
                <Sparkles size={14} className="text-emerald-400" />
                <span className="text-emerald-300">{t.purgedDone}</span>
              </>
            ) : (
              <>
                <Trash2 size={14} />
                <span>{t.purgeBtn}</span>
              </>
            )}
          </motion.button>
        </div>

        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
            <motion.div
              className={cn(
                'h-full rounded-full',
                sessionCacheFreedBytes > 0
                  ? 'bg-gradient-to-r from-emerald-400 via-teal-300 to-white'
                  : 'bg-gradient-to-r from-amber-400/80 to-zinc-200'
              )}
              initial={{ width: '0%' }}
              animate={{
                width:
                  sessionCacheFreedBytes > 0
                    ? `${Math.max(12, reclaimedRatioPct)}%`
                    : items.length > 0
                      ? `${Math.min(100, (selectedPurgeBytes / totalPoolBytes) * 100)}%`
                      : '0%',
              }}
              transition={{ type: 'spring', stiffness: 180, damping: 26 }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500">
            <span>{t.safeRecycleBadge}</span>
            <span className="font-mono">
              {activeItems.length} / {items.length} {t.activeCountSuffix}
            </span>
          </div>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="mt-3 flex items-center gap-1 overflow-x-auto pb-0.5">
        {filterPills.map((fp) => {
          const active = groupFilter === fp.id;
          return (
            <button
              key={fp.id}
              type="button"
              onClick={() => setGroupFilter(fp.id)}
              className={cn(
                'whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                active
                  ? 'bg-white text-black'
                  : 'border border-white/10 bg-[#050507] text-zinc-400 hover:text-zinc-200'
              )}
            >
              {fp.label}
            </button>
          );
        })}
      </div>

      {/* Cache Category Toggle List */}
      <div className="mt-2.5 flex-1 space-y-2 overflow-y-auto max-h-[195px] pr-1">
        <AnimatePresence mode="popLayout" initial={false}>
          {filteredItems.length === 0 ? (
            <motion.div
              key="cache-spotless"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex h-[160px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-4 text-center"
            >
              <CheckCircle2 size={22} className="text-emerald-400" />
              <p className="mt-2 text-xs font-medium text-zinc-300">
                {t.purgedDone} · {displayedFreedGb.toFixed(2)} GB
              </p>
            </motion.div>
          ) : (
            filteredItems.map((item) => {
              const enabled = !item.isProtected && !disabledIds.has(item.id);
              const visual = cacheCategoryVisuals[item.category] || {
                icon: Flame,
                tone: 'obsidian' as SquircleTone,
              };

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, x: -12 }}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-[13px] border px-3 py-2 transition-colors',
                    enabled
                      ? 'border-white/[0.09] bg-white/[0.025]'
                      : 'border-white/[0.04] bg-transparent opacity-50'
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <SquircleIcon icon={visual.icon} tone={visual.tone} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-zinc-100">
                        {item.title}
                      </div>
                      <div className="truncate text-[11px] text-zinc-500">
                        {formatCompactCount(item.fileCount)} {t.filesUnit} ·{' '}
                        <span className="font-mono">{item.path}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-xs font-semibold text-zinc-200 tabular-nums">
                      {formatBytes(item.sizeBytes, 2)}
                    </span>
                    <Switch.Root
                      checked={enabled}
                      disabled={Boolean(item.isProtected)}
                      onCheckedChange={(checked) => toggleSwitch(item.id, checked)}
                      className="relative h-5 w-9 cursor-pointer rounded-full border border-white/15 bg-zinc-900 transition-colors data-[state=checked]:bg-white"
                    >
                      <Switch.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-zinc-400 transition-transform duration-200 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-zinc-950" />
                    </Switch.Root>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </BentoCard>
  );
};
