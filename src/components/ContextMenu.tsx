import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ClipboardCopy,
  FolderOpen,
  Layers,
  Shield,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { ContextMenuTarget } from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes } from '../lib/format';

interface ContextMenuProps {
  target: ContextMenuTarget | null;
  onClose: () => void;
  onInspectSpaceLens: (path: string) => void;
  onRevealPath: (path: string) => void;
  onCopyPath: (path: string) => void;
  onToggleProtect: (path: string, currentlyProtected: boolean) => void;
  onMoveToTrash: (target: ContextMenuTarget) => void;
  t: TranslationSet;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  target,
  onClose,
  onInspectSpaceLens,
  onRevealPath,
  onCopyPath,
  onToggleProtect,
  onMoveToTrash,
  t,
}) => {
  useEffect(() => {
    if (!target) return;
    const handlePointer = () => onClose();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('click', handlePointer);
    window.addEventListener('scroll', handlePointer, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handlePointer);
      window.removeEventListener('scroll', handlePointer, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [target, onClose]);

  const safeLeft = target
    ? Math.min(target.x, (typeof window !== 'undefined' ? window.innerWidth : 1400) - 260)
    : 0;
  const safeTop = target
    ? Math.min(target.y, (typeof window !== 'undefined' ? window.innerHeight : 900) - 250)
    : 0;

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.12 }}
          style={{ left: safeLeft, top: safeTop }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-60 overflow-hidden rounded-[15px] border border-white/15 bg-[#0C0C10]/95 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          <div className="border-b border-white/[0.08] px-2.5 py-1.5">
            <p className="truncate text-xs font-semibold text-white">{target.name}</p>
            <p className="truncate font-mono text-[10px] text-zinc-500">
              {target.sizeBytes ? `${formatBytes(target.sizeBytes, 1)} · ` : ''}
              {target.path}
            </p>
          </div>

          <div className="mt-1 space-y-0.5">
            {target.isDir && (
              <button
                type="button"
                onClick={() => {
                  onInspectSpaceLens(target.path);
                  onClose();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                <Layers size={13} className="text-cyan-400" />
                <span>{t.ctxOpenSpaceLens}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onRevealPath(target.path);
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <FolderOpen size={13} className="text-zinc-400" />
              <span>{t.ctxRevealExplorer}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onCopyPath(target.path);
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <ClipboardCopy size={13} className="text-zinc-400" />
              <span>{t.ctxCopyPath}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onToggleProtect(target.path, Boolean(target.isProtected));
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-emerald-300 transition-colors hover:bg-emerald-500/15"
            >
              {target.isProtected ? (
                <>
                  <ShieldOff size={13} className="text-amber-300" />
                  <span className="text-amber-200">{t.ctxUnprotectPath}</span>
                </>
              ) : (
                <>
                  <Shield size={13} className="text-emerald-400" />
                  <span>{t.ctxProtectPath}</span>
                </>
              )}
            </button>

            <div className="my-1 border-t border-white/[0.07]" />

            <button
              type="button"
              disabled={Boolean(target.isProtected)}
              onClick={() => {
                onMoveToTrash(target);
                onClose();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                target.isProtected
                  ? 'cursor-not-allowed text-zinc-600'
                  : 'text-rose-300 hover:bg-rose-500/15 hover:text-rose-200'
              )}
            >
              <Trash2 size={13} />
              <span>
                {target.isProtected ? t.protectedBadge : t.ctxMoveToTrash}
              </span>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
