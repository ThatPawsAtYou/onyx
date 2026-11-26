import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../lib/format';

export type SquircleTone =
  | 'obsidian'
  | 'silver'
  | 'indigo'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'cyan';

const toneClasses: Record<SquircleTone, string> = {
  obsidian:
    'from-zinc-800/95 via-zinc-900 to-zinc-950 text-zinc-100 border-white/15',
  silver:
    'from-zinc-100 via-zinc-200 to-zinc-300 text-zinc-950 border-white/60',
  indigo:
    'from-indigo-500/25 via-indigo-950/60 to-zinc-950 text-indigo-300 border-indigo-400/25',
  emerald:
    'from-emerald-500/25 via-emerald-950/60 to-zinc-950 text-emerald-300 border-emerald-400/25',
  amber:
    'from-amber-500/25 via-amber-950/60 to-zinc-950 text-amber-300 border-amber-400/25',
  rose:
    'from-rose-500/25 via-rose-950/60 to-zinc-950 text-rose-300 border-rose-400/25',
  cyan:
    'from-cyan-500/25 via-cyan-950/60 to-zinc-950 text-cyan-300 border-cyan-400/25',
};

interface SquircleIconProps {
  icon: LucideIcon;
  tone?: SquircleTone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const SquircleIcon: React.FC<SquircleIconProps> = ({
  icon: Icon,
  tone = 'obsidian',
  size = 'md',
  className,
}) => {
  const sizeClass =
    size === 'sm'
      ? 'h-8 w-8 rounded-[10px]'
      : size === 'lg'
        ? 'h-11 w-11 rounded-[14px]'
        : 'h-9 w-9 rounded-[12px]';
  const iconSize = size === 'sm' ? 15 : size === 'lg' ? 20 : 17;

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center bg-gradient-to-b border shadow-squircle',
        sizeClass,
        toneClasses[tone],
        className
      )}
    >
      <Icon size={iconSize} strokeWidth={1.85} />
    </div>
  );
};
