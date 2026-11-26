import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowUpRight,
  Clock,
  HardDrive,
  MemoryStick,
  Sparkles,
  Usb,
} from 'lucide-react';
import { DiskTelemetry, Lang, MemoryTelemetry } from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes, formatUptime } from '../lib/format';
import { BentoCard } from './BentoCard';
import { SquircleIcon } from './SquircleIcon';

interface StorageGaugeCardProps {
  disks: DiskTelemetry[];
  selectedDiskId: string;
  onSelectDisk: (disk: DiskTelemetry) => void;
  onOpenInSpaceLens: (mountPoint: string) => void;
  memory: MemoryTelemetry;
  cpuUsagePercent: number;
  uptimeSeconds: number;
  devJunkBytes: number;
  cacheBytes: number;
  largeFilesBytes: number;
  lang: Lang;
  t: TranslationSet;
}

export const StorageGaugeCard: React.FC<StorageGaugeCardProps> = ({
  disks,
  selectedDiskId,
  onSelectDisk,
  onOpenInSpaceLens,
  memory,
  cpuUsagePercent,
  uptimeSeconds,
  devJunkBytes,
  cacheBytes,
  largeFilesBytes,
  lang,
  t,
}) => {
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

  const activeDisk =
    disks.find((d) => d.id === selectedDiskId) ||
    disks[0] || {
      id: 'fallback',
      name: 'System Root',
      mountPoint: '/',
      fileSystem: 'EXT4',
      kindLabel: 'NVMe SSD',
      totalBytes: 1,
      usedBytes: 0,
      availableBytes: 1,
      usagePercent: 0,
      isRemovable: false,
    };

  const radius = 66;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.min(100, Math.max(0, activeDisk.usagePercent));
  const strokeOffset = circumference - (clampedPct / 100) * circumference;

  const isCritical = clampedPct >= 85;
  const gaugeStrokeColor = isCritical ? '#fb7185' : '#ffffff';

  const reclaimableTotal = devJunkBytes + cacheBytes;

  const total = Math.max(1, activeDisk.totalBytes);
  const devShare = Math.min(28, (devJunkBytes / total) * 100);
  const cacheShare = Math.min(18, (cacheBytes / total) * 100);
  const largeShare = Math.min(25, (largeFilesBytes / total) * 100);
  const categorizedPct = devShare + cacheShare + largeShare;
  const systemShare = Math.max(1.5, clampedPct - categorizedPct);

  const segments = [
    { key: 'system', label: t.segSystem, pct: systemShare, color: 'bg-zinc-200' },
    {
      key: 'dev',
      label: t.segDev,
      pct: devJunkBytes > 0 ? Math.max(devShare, 2.2) : 0,
      color: 'bg-indigo-400',
    },
    {
      key: 'cache',
      label: t.segCache,
      pct: cacheBytes > 0 ? Math.max(cacheShare, 1.6) : 0,
      color: 'bg-amber-400',
    },
    {
      key: 'large',
      label: t.segLarge,
      pct: largeFilesBytes > 0 ? Math.max(largeShare, 2.2) : 0,
      color: 'bg-emerald-400',
    },
  ];

  return (
    <BentoCard className="col-span-12 lg:col-span-5 p-6" delay={0.02}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <SquircleIcon icon={HardDrive} tone="obsidian" size="md" />
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-white">
              {t.storageTitle}
            </h2>
            <p className="text-xs text-zinc-400">{t.storageSubtitle}</p>
          </div>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={() => onOpenInSpaceLens(activeDisk.mountPoint)}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-white/25 hover:text-white"
        >
          <span>{t.openInSpaceLens}</span>
          <ArrowUpRight size={12} />
        </motion.button>
      </div>

      {/* Physical Drive Switcher */}
      {disks.length > 0 && (
        <div className="mt-4 flex items-center gap-1.5 overflow-x-auto rounded-[13px] border border-white/[0.08] bg-[#050507] p-1">
          {disks.map((disk) => {
            const selected = disk.id === activeDisk.id;
            const shortMount =
              disk.mountPoint.length > 12
                ? disk.mountPoint.slice(0, 12) + '…'
                : disk.mountPoint;
            return (
              <motion.button
                key={disk.id}
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => onSelectDisk(disk)}
                className={cn(
                  'relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 py-1.5 text-xs font-medium transition-colors',
                  selected ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                )}
              >
                {selected && (
                  <motion.div
                    layoutId="activeDrivePill"
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    className="absolute inset-0 rounded-[9px] border border-white/15 bg-zinc-800/90 shadow-sm"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {disk.isRemovable ? (
                    <Usb size={12} className="text-zinc-400" />
                  ) : (
                    <HardDrive size={12} className="text-zinc-400" />
                  )}
                  <span className="font-mono font-semibold">{shortMount}</span>
                  <span className="hidden sm:inline text-[11px] text-zinc-400 truncate max-w-[110px]">
                    {disk.name}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* Orbital Gauge + Metrics */}
      <div className="mt-5 flex flex-col sm:flex-row items-center gap-5">
        <div className="relative flex h-[160px] w-[160px] shrink-0 items-center justify-center">
          <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 160 160">
            <defs>
              <filter id="onyxGaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            <circle
              cx="80"
              cy="80"
              r="75"
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="1"
              strokeDasharray="2 5"
            />
            <circle
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="11"
            />
            <motion.circle
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={gaugeStrokeColor}
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: strokeOffset }}
              transition={{ type: 'spring', stiffness: 90, damping: 20 }}
              filter="url(#onyxGaugeGlow)"
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-mono text-[26px] font-semibold tracking-[-0.04em] text-white tabular-nums">
              {clampedPct.toFixed(1)}%
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              {t.usedSpace}
            </span>
            <span className="mt-0.5 font-mono text-[10px] text-zinc-500">
              {activeDisk.fileSystem}
            </span>
          </div>
        </div>

        <div className="grid w-full flex-1 grid-cols-2 sm:grid-cols-1 gap-2">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>{t.usedSpace} / {t.totalCapacity}</span>
              <span className="font-mono text-[10px] text-zinc-500">
                {activeDisk.kindLabel}
              </span>
            </div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-white tabular-nums">
              {formatBytes(activeDisk.usedBytes, 2)}{' '}
              <span className="font-normal text-zinc-500">
                / {formatBytes(activeDisk.totalBytes, 1)}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2">
            <div className="text-[11px] text-zinc-400">{t.freeSpace}</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-emerald-400 tabular-nums">
              {formatBytes(activeDisk.availableBytes, 2)}
            </div>
          </div>

          <div className="col-span-2 sm:col-span-1 rounded-xl border border-indigo-400/20 bg-indigo-500/[0.06] px-3.5 py-2">
            <div className="flex items-center justify-between text-[11px] text-indigo-300">
              <span className="inline-flex items-center gap-1">
                <Sparkles size={11} />
                {t.reclaimableFound}
              </span>
            </div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-white tabular-nums">
              {formatBytes(reclaimableTotal, 2)}
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Segment Linear Breakdown Bar */}
      <div className="mt-4">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full border border-white/[0.07] bg-zinc-900/90 p-0.5 gap-0.5">
          {segments.map((seg) =>
            seg.pct > 0.15 ? (
              <motion.div
                key={seg.key}
                layout
                initial={{ width: 0 }}
                animate={{ width: `${seg.pct}%` }}
                transition={{ type: 'spring', stiffness: 220, damping: 28 }}
                onMouseEnter={() => setHoveredSegment(seg.key)}
                onMouseLeave={() => setHoveredSegment(null)}
                className={cn(
                  'h-full rounded-full transition-opacity duration-200',
                  seg.color,
                  hoveredSegment && hoveredSegment !== seg.key && 'opacity-35'
                )}
              />
            ) : null
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-zinc-400">
          {segments.map((seg) => (
            <button
              key={seg.key}
              type="button"
              onMouseEnter={() => setHoveredSegment(seg.key)}
              onMouseLeave={() => setHoveredSegment(null)}
              className="inline-flex items-center gap-1.5 transition-colors hover:text-zinc-200"
            >
              <span className={cn('h-2 w-2 rounded-full', seg.color)} />
              <span>{seg.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Live Hardware Telemetry Strip: RAM + CPU + Uptime */}
      <div className="mt-auto pt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-white/[0.07] bg-[#060608] px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-zinc-400">
              <MemoryStick size={12} />
              RAM
            </span>
            <span className="font-mono text-zinc-200 tabular-nums">
              {formatBytes(memory.usedBytes, 1)} / {formatBytes(memory.totalBytes, 1)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-zinc-400 to-white"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, memory.usagePercent)}%` }}
              transition={{ type: 'spring', stiffness: 160, damping: 24 }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-[#060608] px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-zinc-400">
              <Activity size={12} />
              {t.cpuLoad}
            </span>
            <span className="font-mono text-zinc-200 tabular-nums">
              {cpuUsagePercent.toFixed(1)}% ·{' '}
              <span className="text-zinc-500 inline-flex items-center gap-0.5">
                <Clock size={10} />
                {formatUptime(uptimeSeconds, lang)}
              </span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-200"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(3, Math.min(100, cpuUsagePercent))}%` }}
              transition={{ type: 'spring', stiffness: 160, damping: 24 }}
            />
          </div>
        </div>
      </div>
    </BentoCard>
  );
};
