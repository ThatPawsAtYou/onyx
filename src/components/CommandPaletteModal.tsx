import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  BarChart3,
  Command,
  Copy,
  Download,
  Flame,
  FolderSearch,
  HardDrive,
  Layers,
  LayoutGrid,
  PackageSearch,
  RefreshCw,
  Search,
  Terminal,
} from 'lucide-react';
import { ActiveView, DevJunkItem, LargeFileItem } from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { cn, formatBytes } from '../lib/format';

interface CommandPaletteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (view: ActiveView) => void;
  onRescan: () => void;
  onPurgeCache?: () => void;
  onOpenFolderPicker: () => void;
  onExportReport: () => void;
  onRevealPath: (path: string) => void;
  devItems: DevJunkItem[];
  largeFiles: LargeFileItem[];
  t: TranslationSet;
}

interface PaletteCommand {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: typeof LayoutGrid;
  onSelect: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  onOpenChange,
  onNavigate,
  onRescan,
  onPurgeCache,
  onOpenFolderPicker,
  onExportReport,
  onRevealPath,
  devItems,
  largeFiles,
  t,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  const allCommands = useMemo<PaletteCommand[]>(() => {
    const base: PaletteCommand[] = [
      {
        id: 'nav-dashboard',
        group: t.cmdViewsGroup,
        title: t.navDashboard,
        subtitle: t.storageTitle,
        icon: LayoutGrid,
        onSelect: () => onNavigate('dashboard'),
      },
      {
        id: 'nav-spacelens',
        group: t.cmdViewsGroup,
        title: t.navSpaceLens,
        subtitle: t.spaceLensSubtitle,
        icon: Layers,
        onSelect: () => onNavigate('spacelens'),
      },
      {
        id: 'nav-duplicates',
        group: t.cmdViewsGroup,
        title: t.navDuplicates,
        subtitle: t.dupTitle,
        icon: Copy,
        onSelect: () => onNavigate('duplicates'),
      },
      {
        id: 'nav-apps',
        group: t.cmdViewsGroup,
        title: t.navApps,
        subtitle: t.appsSubtitle,
        icon: PackageSearch,
        onSelect: () => onNavigate('apps'),
      },
      {
        id: 'nav-analytics',
        group: t.cmdViewsGroup,
        title: t.navAnalytics,
        subtitle: t.extTitle,
        icon: BarChart3,
        onSelect: () => onNavigate('analytics'),
      },
      {
        id: 'act-rescan',
        group: t.cmdActionsGroup,
        title: t.scanAll,
        subtitle: t.storageSubtitle,
        icon: RefreshCw,
        onSelect: onRescan,
      },
      ...(onPurgeCache
        ? [
            {
              id: 'act-purge-cache',
              group: t.cmdActionsGroup,
              title: t.cmdSmartClean,
              subtitle: t.cacheSubtitle,
              icon: Flame,
              onSelect: onPurgeCache,
            },
          ]
        : []),
      {
        id: 'act-folder',
        group: t.cmdActionsGroup,
        title: t.chooseFolder,
        subtitle: t.folderModalDesc,
        icon: FolderSearch,
        onSelect: onOpenFolderPicker,
      },
      {
        id: 'act-export',
        group: t.cmdActionsGroup,
        title: t.exportMdBtn,
        subtitle: t.cmdExportAudit,
        icon: Download,
        onSelect: onExportReport,
      },
    ];

    const itemCmds: PaletteCommand[] = [
      ...devItems.slice(0, 15).map((item) => ({
        id: `dev-${item.id}`,
        group: t.cmdItemsGroup,
        title: `${item.projectName} (${item.ecosystem})`,
        subtitle: `${formatBytes(item.sizeBytes, 1)} · ${item.path}`,
        icon: Terminal,
        onSelect: () => onRevealPath(item.path),
      })),
      ...largeFiles.slice(0, 15).map((f) => ({
        id: `file-${f.id}`,
        group: t.cmdItemsGroup,
        title: f.name,
        subtitle: `${formatBytes(f.sizeBytes, 1)} · ${f.path}`,
        icon: HardDrive,
        onSelect: () => onRevealPath(f.path),
      })),
    ];

    return [...base, ...itemCmds];
  }, [
    t,
    devItems,
    largeFiles,
    onNavigate,
    onRescan,
    onPurgeCache,
    onOpenFolderPicker,
    onExportReport,
    onRevealPath,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands.slice(0, 12);
    return allCommands
      .filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.subtitle && c.subtitle.toLowerCase().includes(q))
      )
      .slice(0, 14);
  }, [allCommands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) =>
        filtered.length ? (prev + 1) % filtered.length : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0
      );
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      e.preventDefault();
      filtered[activeIndex].onSelect();
      onOpenChange(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
        <Dialog.Content
          onKeyDown={handleKeyDown}
          className="fixed left-1/2 top-[16%] z-50 w-[92vw] max-w-xl -translate-x-1/2 overflow-hidden rounded-[22px] border border-white/15 bg-[#0A0A0E]/95 shadow-[0_24px_80px_rgba(0,0,0,0.85)] backdrop-blur-xl focus:outline-none"
        >
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
            <Search size={16} className="shrink-0 text-zinc-400" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.cmdPlaceholder}
              className="w-full bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
            />
            <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-zinc-400">
              ESC
            </span>
          </div>

          <div className="max-h-[340px] overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="py-10 text-center text-xs text-zinc-500">
                {t.cmdNoResults}
              </div>
            ) : (
              filtered.map((cmd, idx) => {
                const Icon = cmd.icon;
                const active = idx === activeIndex;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      cmd.onSelect();
                      onOpenChange(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                      active
                        ? 'bg-white/[0.09] text-white'
                        : 'text-zinc-300 hover:bg-white/[0.05]'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-zinc-900 text-zinc-200">
                        <Icon size={15} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-white">
                          {cmd.title}
                        </div>
                        {cmd.subtitle && (
                          <div className="truncate font-mono text-[11px] text-zinc-500 max-w-[360px]">
                            {cmd.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-400">
                      {cmd.group}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.08] bg-[#060609] px-4 py-2 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <Command size={11} />
              Onyx Command Bar
            </span>
            <span className="font-mono">↑↓ Navigate · ↵ Run</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
