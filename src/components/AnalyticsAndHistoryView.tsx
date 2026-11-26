import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  Clock,
  Download,
  FileCode2,
  FileJson,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { CleanupHistoryEntry, ExtensionsReport, Lang } from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes, formatCompactCount } from '../lib/format';
import {
  clearCleanupHistory,
  fetchCleanupHistory,
  runExtensionsScan,
} from '../lib/bridge';
import { BentoCard } from './BentoCard';
import { SquircleIcon } from './SquircleIcon';

interface AnalyticsAndHistoryViewProps {
  customRoot: string;
  onExportMarkdown: () => void;
  onExportJson: () => void;
  lang: Lang;
  t: TranslationSet;
}

const BAR_COLORS = [
  'bg-indigo-400',
  'bg-emerald-400',
  'bg-amber-400',
  'bg-cyan-400',
  'bg-rose-400',
  'bg-violet-400',
  'bg-zinc-300',
];

export const AnalyticsAndHistoryView: React.FC<AnalyticsAndHistoryViewProps> = ({
  customRoot,
  onExportMarkdown,
  onExportJson,
  lang,
  t,
}) => {
  const [extStats, setExtStats] = useState<ExtensionsReport | null>(null);
  const [history, setHistory] = useState<CleanupHistoryEntry[]>([]);
  const [loadingExt, setLoadingExt] = useState<boolean>(true);

  const loadAnalytics = useCallback(async () => {
    setLoadingExt(true);
    try {
      const [stats, hist] = await Promise.all([
        runExtensionsScan(customRoot || undefined),
        fetchCleanupHistory(),
      ]);
      setExtStats(stats);
      setHistory(hist);
    } finally {
      setLoadingExt(false);
    }
  }, [customRoot]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const lifetimeFreedBytes = useMemo(
    () => history.reduce((sum, h) => sum + h.freedBytes, 0),
    [history]
  );

  const handleClearLog = async () => {
    await clearCleanupHistory();
    setHistory([]);
  };

  const maxExtBytes = useMemo(
    () => Math.max(1, ...(extStats?.items.map((i) => i.totalBytes) || [1])),
    [extStats]
  );

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Left 7 Cols: File Extensions Footprint */}
      <BentoCard className="col-span-12 lg:col-span-7 p-6" delay={0.02}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <SquircleIcon icon={BarChart3} tone="indigo" size="md" />
            <div>
              <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">
                {t.extTitle}
              </h2>
              <p className="text-xs text-zinc-400">{t.extSubtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={onExportMarkdown}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-white/25 hover:text-white"
            >
              <Download size={12} />
              <span>{t.exportMdBtn}</span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={onExportJson}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs font-mono text-zinc-300 hover:border-white/25 hover:text-white"
              title="Export JSON"
            >
              <FileJson size={12} />
              <span>{t.exportJsonBtn}</span>
            </motion.button>

            <button
              type="button"
              onClick={loadAnalytics}
              className="rounded-full border border-white/10 bg-white/[0.03] p-1.5 text-zinc-400 hover:border-white/25 hover:text-white"
            >
              <RefreshCw size={13} className={cn(loadingExt && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Summary Ribbon */}
        {extStats && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#050507] px-3.5 py-2 text-xs text-zinc-400">
            <span className="truncate font-mono max-w-[320px]">
              {extStats.scannedRoot}
            </span>
            <span className="font-mono text-zinc-200">
              {formatCompactCount(extStats.totalFiles)} {t.filesUnit} ·{' '}
              {formatBytes(extStats.totalBytes, 2)} ({extStats.durationMs} ms)
            </span>
          </div>
        )}

        {/* Horizontal Proportional Extension Bars */}
        <div className="mt-4 flex-1 min-h-[320px] max-h-[380px] overflow-y-auto pr-1 space-y-2">
          {loadingExt ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 size={24} className="animate-spin text-zinc-400" />
            </div>
          ) : (
            (extStats?.items || []).map((item, idx) => {
              const widthPct = Math.max(
                4,
                Math.round((item.totalBytes / maxExtBytes) * 100)
              );
              const colorClass = BAR_COLORS[idx % BAR_COLORS.length];

              return (
                <div
                  key={item.extension}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.015] px-3.5 py-2.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <FileCode2 size={13} className="text-zinc-400" />
                      <span className="font-mono font-semibold text-white">
                        {item.extension}
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        {formatCompactCount(item.fileCount)} {t.filesUnit}
                      </span>
                    </div>
                    <div className="font-mono text-xs font-semibold text-white tabular-nums">
                      {formatBytes(item.totalBytes, 2)}{' '}
                      <span className="text-[10px] font-normal text-zinc-500">
                        ({item.sharePercent.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${widthPct}%` }}
                      transition={{ type: 'spring', stiffness: 180, damping: 26 }}
                      className={cn('h-full rounded-full', colorClass)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </BentoCard>

      {/* Right 5 Cols: Persistent Cleanup Audit Log */}
      <BentoCard className="col-span-12 lg:col-span-5 p-6" delay={0.06}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <SquircleIcon icon={History} tone="emerald" size="md" />
            <div>
              <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">
                {t.historyTitle}
              </h2>
              <p className="text-xs text-zinc-400">{t.historySubtitle}</p>
            </div>
          </div>

          {history.length > 0 && (
            <button
              type="button"
              onClick={handleClearLog}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-rose-400/30 hover:text-rose-300"
            >
              <Trash2 size={11} />
              {t.clearHistoryBtn}
            </button>
          )}
        </div>

        {/* Lifetime Freed Hero */}
        <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
            <Sparkles size={12} />
            <span>{t.lifetimeFreed}</span>
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-white tabular-nums">
            {formatBytes(lifetimeFreedBytes, 2)}
          </div>
        </div>

        {/* History Timeline */}
        <div className="mt-4 flex-1 min-h-[270px] max-h-[320px] overflow-y-auto pr-1 space-y-2">
          {history.length === 0 ? (
            <div className="flex h-[250px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-6 text-center">
              <ShieldCheck size={26} className="text-zinc-500" />
              <p className="mt-2.5 text-xs text-zinc-400">{t.historyEmpty}</p>
            </div>
          ) : (
            history.map((entry) => {
              const dateStr = new Date(entry.timestampUnix * 1000).toLocaleString(
                lang === 'ru' ? 'ru-RU' : 'en-US',
                {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }
              );
              return (
                <div
                  key={entry.id}
                  className="rounded-xl border border-white/[0.08] bg-[#050507] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase text-zinc-300">
                      {entry.category}
                    </span>
                    <span className="font-mono text-xs font-semibold text-emerald-400">
                      +{formatBytes(entry.freedBytes, 2)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>{entry.deletedCount} items → Trash</span>
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500">
                      <Clock size={10} />
                      {dateStr}
                    </span>
                  </div>
                  {entry.samplePaths.length > 0 && (
                    <div className="mt-1.5 truncate font-mono text-[10px] text-zinc-500">
                      {entry.samplePaths.join(', ')}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </BentoCard>
    </div>
  );
};
