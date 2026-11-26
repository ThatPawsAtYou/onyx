import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Copy,
  FolderOpen,
  Loader2,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react';
import {
  ContextMenuTarget,
  DuplicateFileEntry,
  DuplicateGroup,
  DuplicatesReport,
} from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes } from '../lib/format';
import { runDuplicatesScan } from '../lib/bridge';
import { BentoCard } from './BentoCard';
import { SquircleIcon } from './SquircleIcon';

interface DuplicatesViewProps {
  customRoot: string;
  protectedSet: Set<string>;
  onToggleProtect: (path: string, currentlyProtected: boolean) => Promise<void>;
  onRevealPath: (path: string) => void;
  onCleanPaths: (paths: string[]) => Promise<void>;
  onOpenContextMenu: (
    e: React.MouseEvent,
    item: Omit<ContextMenuTarget, 'x' | 'y'>
  ) => void;
  t: TranslationSet;
}

const MIN_SIZE_OPTIONS = [
  { label: '> 64 KB', kb: 64 },
  { label: '> 1 MB', kb: 1024 },
  { label: '> 10 MB', kb: 10240 },
];

export const DuplicatesView: React.FC<DuplicatesViewProps> = ({
  customRoot,
  protectedSet,
  onToggleProtect,
  onRevealPath,
  onCleanPaths,
  onOpenContextMenu,
  t,
}) => {
  const [report, setReport] = useState<DuplicatesReport | null>(null);
  const [minSizeKb, setMinSizeKb] = useState<number>(64);
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [isCleaning, setIsCleaning] = useState<boolean>(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  const executeDuplicateScan = useCallback(
    async (kb: number) => {
      setIsScanning(true);
      try {
        const res = await runDuplicatesScan(customRoot || undefined, kb);
        setReport(res);
        const autoSelected = new Set<string>();
        for (const grp of res.groups) {
          for (const f of grp.files) {
            if (
              !f.isOriginal &&
              !f.isProtected &&
              !protectedSet.has(f.path.toLowerCase())
            ) {
              autoSelected.add(f.path);
            }
          }
        }
        setSelectedPaths(autoSelected);
      } finally {
        setIsScanning(false);
      }
    },
    [customRoot, protectedSet]
  );

  useEffect(() => {
    executeDuplicateScan(minSizeKb);
  }, [customRoot, minSizeKb]);

  const toggleFile = (path: string, isProt: boolean) => {
    if (isProt) return;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const smartSelectCopies = () => {
    if (!report) return;
    const next = new Set<string>();
    for (const grp of report.groups) {
      grp.files.forEach((f: DuplicateFileEntry, idx: number) => {
        const isProt =
          Boolean(f.isProtected) || protectedSet.has(f.path.toLowerCase());
        if (idx > 0 && !isProt) next.add(f.path);
      });
    }
    setSelectedPaths(next);
  };

  const selectedReclaimableBytes = useMemo(() => {
    if (!report) return 0;
    let sum = 0;
    for (const grp of report.groups) {
      for (const f of grp.files) {
        if (selectedPaths.has(f.path)) {
          sum += grp.sizeBytes;
        }
      }
    }
    return sum;
  }, [report, selectedPaths]);

  const handleTrashDuplicates = async () => {
    const paths = Array.from(selectedPaths).filter(
      (p) => !protectedSet.has(p.toLowerCase())
    );
    if (paths.length === 0) return;
    setIsCleaning(true);
    try {
      await onCleanPaths(paths);
      await executeDuplicateScan(minSizeKb);
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-4">
      <BentoCard className="col-span-12 p-6" delay={0.02}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <SquircleIcon icon={Copy} tone="indigo" size="lg" />
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-white">
                {t.dupTitle}
              </h2>
              <p className="text-xs text-zinc-400">{t.dupSubtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-[#050507] p-0.5">
              {MIN_SIZE_OPTIONS.map((opt) => {
                const active = minSizeKb === opt.kb;
                return (
                  <button
                    key={opt.kb}
                    type="button"
                    onClick={() => setMinSizeKb(opt.kb)}
                    className={cn(
                      'rounded-full px-3 py-1 font-mono text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-zinc-800 text-white border border-white/15'
                        : 'text-zinc-500 hover:text-zinc-300'
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={smartSelectCopies}
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-medium text-indigo-200 hover:border-indigo-300/50 hover:text-white"
            >
              <Wand2 size={13} />
              {t.autoSelectCopies}
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => executeDuplicateScan(minSizeKb)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 hover:border-white/25 hover:text-white"
            >
              <RefreshCw size={13} className={cn(isScanning && 'animate-spin')} />
            </motion.button>
          </div>
        </div>

        {/* KPI Pills */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-white/[0.07] bg-[#050507] px-4 py-3">
            <div className="text-[11px] text-zinc-400">{t.dupWasted}</div>
            <div className="mt-1 font-mono text-xl font-semibold text-white tabular-nums">
              {formatBytes(report?.totalWastedBytes || 0, 2)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-[#050507] px-4 py-3">
            <div className="text-[11px] text-zinc-400">{t.dupGroupsCount}</div>
            <div className="mt-1 font-mono text-xl font-semibold text-indigo-300 tabular-nums">
              {report?.groups.length || 0}{' '}
              <span className="text-xs font-normal text-zinc-500">
                ({report?.scannedFiles || 0} {t.dupScannedFiles.toLowerCase()})
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-[#050507] px-4 py-3">
            <div>
              <div className="text-[11px] text-zinc-400">{t.selectedLabel}</div>
              <div className="mt-1 font-mono text-xl font-semibold text-emerald-400 tabular-nums">
                {formatBytes(selectedReclaimableBytes, 2)}
              </div>
            </div>

            <motion.button
              type="button"
              disabled={selectedPaths.size === 0 || isCleaning || isScanning}
              whileTap={selectedPaths.size > 0 ? { scale: 0.97 } : undefined}
              onClick={handleTrashDuplicates}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all',
                selectedPaths.size > 0 && !isCleaning
                  ? 'bg-white text-zinc-950 shadow-[0_0_24px_rgba(255,255,255,0.18)] hover:bg-zinc-200'
                  : 'cursor-not-allowed border border-white/10 bg-white/[0.04] text-zinc-500'
              )}
            >
              {isCleaning ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              <span>
                {t.cleanDuplicatesBtn} ({selectedPaths.size})
              </span>
            </motion.button>
          </div>
        </div>
      </BentoCard>

      {/* Duplicate Groups List */}
      <BentoCard className="col-span-12 p-6" delay={0.06}>
        {isScanning ? (
          <div className="flex h-[280px] flex-col items-center justify-center">
            <Loader2 size={26} className="animate-spin text-indigo-300" />
            <p className="mt-3 text-xs text-zinc-400">{t.scanning}</p>
          </div>
        ) : !report || report.groups.length === 0 ? (
          <div className="flex h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-6 text-center">
            <SquircleIcon icon={Sparkles} tone="emerald" size="lg" />
            <p className="mt-3 text-sm font-medium text-zinc-200">
              {t.dupEmptyTitle}
            </p>
            <p className="mt-1 max-w-md text-xs text-zinc-500">
              {t.dupEmptyDesc}
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
            <div className="flex items-center justify-between text-[11px] text-zinc-500 px-1">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={13} className="text-emerald-400" />
                SHA-256 verified byte-identical clusters ({report.scannedRoot})
              </span>
              <span className="inline-flex items-center gap-1 font-mono">
                <Zap size={11} className="text-amber-300" />
                {report.durationMs} ms
              </span>
            </div>

            <AnimatePresence initial={false}>
              {report.groups.map((grp: DuplicateGroup) => (
                <motion.div
                  key={grp.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-white/[0.09] bg-[#060609] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs text-white">
                        {grp.fileName}
                      </span>
                      <span className="rounded-md border border-indigo-400/25 bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] text-indigo-300">
                        SHA-256: {grp.hashShort}…
                      </span>
                      <span className="font-mono text-xs text-zinc-400">
                        {grp.files.length} × {formatBytes(grp.sizeBytes, 2)}
                      </span>
                    </div>
                    <span className="font-mono text-xs font-semibold text-amber-300">
                      +{formatBytes(grp.wastedBytes, 2)}
                    </span>
                  </div>

                  <div className="mt-2.5 space-y-1.5">
                    {grp.files.map((file: DuplicateFileEntry) => {
                      const isProt =
                        Boolean(file.isProtected) ||
                        protectedSet.has(file.path.toLowerCase());
                      const checked = !isProt && selectedPaths.has(file.path);

                      return (
                        <div
                          key={file.path}
                          onClick={() => toggleFile(file.path, isProt)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            onOpenContextMenu(e, {
                              name: grp.fileName,
                              path: file.path,
                              isDir: false,
                              sizeBytes: grp.sizeBytes,
                              isProtected: isProt,
                            });
                          }}
                          className={cn(
                            'group/dup flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors',
                            isProt
                              ? 'border-emerald-400/20 bg-emerald-500/[0.04]'
                              : checked
                                ? 'border-rose-400/25 bg-rose-500/[0.05]'
                                : 'border-white/[0.06] bg-white/[0.015] hover:border-white/15'
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                                isProt
                                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                                  : checked
                                    ? 'border-white bg-white text-zinc-950'
                                    : 'border-white/25 bg-zinc-950'
                              )}
                            >
                              {isProt ? (
                                <Shield size={10} />
                              ) : (
                                checked && <Check size={11} strokeWidth={3} />
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate font-mono text-xs text-zinc-100 max-w-[440px]">
                                  {file.path}
                                </span>
                                {file.isOriginal ? (
                                  <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                    {t.originalProtected}
                                  </span>
                                ) : (
                                  <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-400">
                                    {t.duplicateCopy}
                                  </span>
                                )}
                                {isProt && (
                                  <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                                    {t.protectedBadge}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="text-[11px] text-zinc-500">
                              {file.modifiedDaysAgo === 0
                                ? t.today
                                : `${file.modifiedDaysAgo} ${t.daysAgo}`}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleProtect(file.path, isProt);
                              }}
                              className={cn(
                                'rounded-lg p-1.5 transition-all',
                                isProt
                                  ? 'text-emerald-300 opacity-100'
                                  : 'text-zinc-500 opacity-0 hover:bg-white/10 hover:text-emerald-300 group-hover/dup:opacity-100'
                              )}
                            >
                              <Shield size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRevealPath(file.path);
                              }}
                              className="rounded-lg p-1.5 text-zinc-500 opacity-0 transition-all hover:bg-white/10 hover:text-zinc-200 group-hover/dup:opacity-100"
                              title={t.revealFolder}
                            >
                              <FolderOpen size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </BentoCard>
    </div>
  );
};
