import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  Archive,
  Database,
  Disc,
  Film,
  FolderOpen,
  HardDriveDownload,
  ScanSearch,
  Search,
  Trash2,
} from 'lucide-react';
import { LargeFileItem } from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes } from '../lib/format';
import { BentoCard } from './BentoCard';
import { SquircleIcon, SquircleTone } from './SquircleIcon';

interface LargeFilesCardProps {
  items: LargeFileItem[];
  minSizeMb: number;
  onChangeThresholdMb: (mb: number) => void;
  onTrashFile: (file: LargeFileItem) => Promise<void>;
  onRevealPath: (path: string) => void;
  t: TranslationSet;
}

const THRESHOLD_OPTIONS = [
  { label: '> 1 GB', mb: 1024 },
  { label: '> 500 MB', mb: 500 },
  { label: '> 100 MB', mb: 100 },
  { label: '> 10 MB', mb: 10 },
];

export const LargeFilesCard: React.FC<LargeFilesCardProps> = ({
  items,
  minSizeMb,
  onChangeThresholdMb,
  onTrashFile,
  onRevealPath,
  t,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const categories = [
    { id: 'all', label: t.catAll },
    { id: 'video', label: t.catVideo },
    { id: 'archive', label: t.catArchive },
    { id: 'installer', label: t.catInstaller },
    { id: 'disk_data', label: t.catDiskData },
  ];

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((f) => {
      if (activeCategory !== 'all' && f.category !== activeCategory) return false;
      if (q && !f.name.toLowerCase().includes(q) && !f.path.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [items, activeCategory, searchQuery]);

  const maxFileSize = useMemo(
    () => Math.max(1, ...filteredFiles.map((f) => f.sizeBytes)),
    [filteredFiles]
  );

  const getVisualForCategory = (
    cat: string
  ): { icon: typeof Film; tone: SquircleTone } => {
    switch (cat) {
      case 'video':
        return { icon: Film, tone: 'rose' };
      case 'archive':
        return { icon: Archive, tone: 'amber' };
      case 'installer':
        return { icon: HardDriveDownload, tone: 'emerald' };
      default:
        return { icon: Database, tone: 'indigo' };
    }
  };

  const handleTrash = async (file: LargeFileItem) => {
    setDeletingId(file.id);
    try {
      await onTrashFile(file);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <BentoCard className="col-span-12 lg:col-span-7 p-6" delay={0.14}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <SquircleIcon icon={Disc} tone="emerald" size="md" />
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">
              {t.largeTitle}
            </h2>
            <p className="text-xs text-zinc-400">{t.largeSubtitle}</p>
          </div>
        </div>

        {/* Threshold Selector Pills */}
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[#050507] p-0.5">
          {THRESHOLD_OPTIONS.map((opt) => {
            const active = minSizeMb === opt.mb;
            return (
              <motion.button
                key={opt.mb}
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => onChangeThresholdMb(opt.mb)}
                className={cn(
                  'rounded-full px-2.5 py-1 font-mono text-[11px] font-medium transition-colors',
                  active
                    ? 'bg-zinc-800 text-white border border-white/15'
                    : 'text-zinc-500 hover:text-zinc-300'
                )}
              >
                {opt.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Category Filter Tabs + Instant Search */}
      <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto rounded-[13px] border border-white/[0.08] bg-[#050507] p-1">
          {categories.map((cat) => {
            const active = activeCategory === cat.id;
            const count =
              cat.id === 'all'
                ? items.length
                : items.filter((i) => i.category === cat.id).length;

            return (
              <motion.button
                key={cat.id}
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  'relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-2.5 py-1.5 text-xs font-medium transition-colors',
                  active ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                )}
              >
                {active && (
                  <motion.div
                    layoutId="largeCategoryTab"
                    transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                    className="absolute inset-0 rounded-[9px] border border-white/15 bg-zinc-800/90"
                  />
                )}
                <span className="relative z-10">{cat.label}</span>
                <span
                  className={cn(
                    'relative z-10 font-mono text-[10px]',
                    active ? 'text-zinc-300' : 'text-zinc-600'
                  )}
                >
                  {count}
                </span>
              </motion.button>
            );
          })}
        </div>

        <div className="relative sm:w-48">
          <Search
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchFilesPlaceholder}
            className="w-full rounded-[12px] border border-white/[0.08] bg-[#050507] py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-600 focus:border-white/25 focus:outline-none"
          />
        </div>
      </div>

      {/* Large File List */}
      <div className="mt-3.5 flex-1 min-h-[220px] max-h-[264px] overflow-y-auto pr-1 space-y-1.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {filteredFiles.length === 0 ? (
            <motion.div
              key="empty-large"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-[210px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-6 text-center"
            >
              <SquircleIcon icon={ScanSearch} tone="obsidian" size="lg" />
              <p className="mt-3 text-sm font-medium text-zinc-200">
                {t.largeEmptyTitle}
              </p>
              <p className="mt-1 max-w-sm text-xs text-zinc-500">
                {t.largeEmptyDesc}
              </p>
            </motion.div>
          ) : (
            filteredFiles.map((file) => {
              const visual = getVisualForCategory(file.category);
              const barRatioPct = Math.max(
                6,
                Math.round((file.sizeBytes / maxFileSize) * 100)
              );
              const isRemoving = deletingId === file.id;

              return (
                <motion.div
                  layout
                  key={file.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 18, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  whileHover={{ scale: 0.996 }}
                  className="group/file relative overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 transition-colors hover:border-white/[0.16] hover:bg-white/[0.04]"
                >
                  <div
                    aria-hidden="true"
                    style={{ width: `${barRatioPct}%` }}
                    className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-white/[0.035] to-transparent transition-all duration-500"
                  />

                  <div className="relative z-10 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <SquircleIcon icon={visual.icon} tone={visual.tone} size="sm" />

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Tooltip.Provider delayDuration={250}>
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <span className="truncate text-[13px] font-medium text-zinc-100 max-w-[240px] sm:max-w-[320px]">
                                  {file.name}
                                </span>
                              </Tooltip.Trigger>
                              <Tooltip.Portal>
                                <Tooltip.Content
                                  sideOffset={6}
                                  className="z-50 max-w-md break-all rounded-lg border border-white/15 bg-zinc-900 px-3 py-1.5 font-mono text-[11px] text-zinc-200 shadow-xl"
                                >
                                  {file.path}
                                </Tooltip.Content>
                              </Tooltip.Portal>
                            </Tooltip.Root>
                          </Tooltip.Provider>

                          <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                            {file.extension}
                          </span>
                        </div>

                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                          <span className="truncate max-w-[250px] font-mono">
                            {file.parentDir}
                          </span>
                          <span>·</span>
                          <span className="shrink-0">
                            {file.modifiedDaysAgo === 0
                              ? t.today
                              : `${file.modifiedDaysAgo} ${t.daysAgo}`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onRevealPath(file.path)}
                        className="rounded-lg p-1.5 text-zinc-500 opacity-0 transition-all hover:bg-white/10 hover:text-zinc-200 group-hover/file:opacity-100"
                        title={t.revealFolder}
                      >
                        <FolderOpen size={14} />
                      </button>

                      <motion.button
                        type="button"
                        disabled={isRemoving}
                        whileTap={{ scale: 0.92 }}
                        onClick={() => handleTrash(file)}
                        className="rounded-lg p-1.5 text-zinc-500 opacity-0 transition-all hover:bg-rose-500/15 hover:text-rose-300 group-hover/file:opacity-100"
                        title={t.moveToTrash}
                      >
                        <Trash2 size={14} />
                      </motion.button>

                      <span className="min-w-[74px] text-right font-mono text-[13px] font-semibold text-white tabular-nums">
                        {formatBytes(file.sizeBytes, 2)}
                      </span>
                    </div>
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
