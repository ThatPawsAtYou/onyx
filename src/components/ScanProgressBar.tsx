import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, OctagonX } from 'lucide-react';
import { ScanProgress } from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cancelActiveScan, fetchScanProgress } from '../lib/bridge';
import { formatBytes, formatCompactCount } from '../lib/format';

interface ScanProgressBarProps {
  active: boolean;
  t: TranslationSet;
}

export const ScanProgressBar: React.FC<ScanProgressBarProps> = ({ active, t }) => {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [stopping, setStopping] = useState<boolean>(false);

  useEffect(() => {
    if (!active) {
      setProgress(null);
      setStopping(false);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetchScanProgress();
        if (!cancelled) {
          setProgress(res);
        }
      } catch {
        // ignore transient polling error
      }
    };

    poll();
    const timer = setInterval(poll, 240);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  const handleStop = async () => {
    setStopping(true);
    try {
      await cancelActiveScan();
    } catch {
      // ignore
    }
  };

  const show = active && progress && (progress.isRunning || progress.filesScanned > 0);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 14 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          className="overflow-hidden"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-indigo-400/25 bg-indigo-500/[0.07] px-4 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-2.5">
              <Loader2 size={13} className="shrink-0 animate-spin text-indigo-300" />
              <span className="font-medium text-indigo-200">
                {t.liveProgressScanning}
              </span>
              {progress.filesScanned > 0 && (
                <span className="font-mono text-[11px] text-zinc-300 tabular-nums">
                  {formatCompactCount(progress.filesScanned)} {t.filesUnit} ·{' '}
                  {formatBytes(progress.bytesScanned, 1)}
                </span>
              )}
              {progress.currentPath && (
                <span className="hidden md:inline max-w-md truncate font-mono text-[11px] text-zinc-500">
                  {progress.currentPath}
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={stopping}
              onClick={handleStop}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/15 px-3 py-1 text-[11px] font-medium text-rose-200 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
            >
              <OctagonX size={12} />
              <span>{t.stopScan}</span>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
