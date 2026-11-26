import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import {
  ArrowUp,
  Check,
  Cpu,
  Folder,
  FolderSearch,
  Globe,
  HardDrive,
  Lock,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { DirectoryEntry, DiskTelemetry, Lang } from '../types/onyx';
import { TranslationSet } from '../lib/i18n';
import { fetchSubdirectories } from '../lib/bridge';

interface FolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentRoot: string;
  defaultHomeDir: string;
  disks?: DiskTelemetry[];
  onApplyRoot: (root: string) => void;
  t: TranslationSet;
}

function computeParentDir(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed === '/') return null;

  // Windows drive root like "C:\" or "C:"
  if (/^[A-Za-z]:\\?$/.test(trimmed)) {
    return null;
  }

  const isWin = trimmed.includes('\\') || /^[A-Za-z]:/.test(trimmed);
  const sep = isWin ? '\\' : '/';
  const normalized = trimmed.replace(/[\\/]+$/, '');
  const idx = normalized.lastIndexOf(sep);
  if (idx < 0) return null;
  if (isWin && idx === 2 && normalized[1] === ':') {
    return `${normalized.slice(0, 2)}\\`;
  }
  if (!isWin && idx === 0) {
    return '/';
  }
  return normalized.slice(0, idx);
}

export const FolderPickerModal: React.FC<FolderModalProps> = ({
  open,
  onOpenChange,
  currentRoot,
  defaultHomeDir,
  disks = [],
  onApplyRoot,
  t,
}) => {
  const [inputPath, setInputPath] = useState(currentRoot || defaultHomeDir);
  const [subdirs, setSubdirs] = useState<DirectoryEntry[]>([]);

  useEffect(() => {
    if (open) {
      const start = currentRoot || defaultHomeDir;
      setInputPath(start);
      fetchSubdirectories(start)
        .then(setSubdirs)
        .catch(() => setSubdirs([]));
    }
  }, [open, currentRoot, defaultHomeDir]);

  const navigateInto = (dirPath: string) => {
    setInputPath(dirPath);
    fetchSubdirectories(dirPath)
      .then(setSubdirs)
      .catch(() => setSubdirs([]));
  };

  const parentDir = computeParentDir(inputPath);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-white/15 bg-[#0B0B0F] p-6 shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-zinc-900 text-zinc-100">
                <FolderSearch size={17} />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold text-white">
                  {t.folderModalTitle}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-zinc-400">
                  {t.folderModalDesc}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white">
              <X size={16} />
            </Dialog.Close>
          </div>

          {/* Quick Drive Switcher */}
          {disks.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {disks.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => navigateInto(d.mountPoint)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#050507] px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-white/25 hover:text-white"
                >
                  <HardDrive size={11} className="text-zinc-400" />
                  <span>{d.mountPoint}</span>
                </button>
              ))}
            </div>
          )}

          {/* Path Bar + Up Button */}
          <div className="mt-3 flex items-center gap-2">
            {parentDir && (
              <button
                type="button"
                onClick={() => navigateInto(parentDir)}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-white/15 bg-[#050507] px-3 py-2 text-xs font-medium text-zinc-200 hover:border-white/30 hover:text-white"
                title={t.upFolder}
              >
                <ArrowUp size={13} />
                <span>{t.upFolder}</span>
              </button>
            )}
            <input
              type="text"
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  navigateInto(inputPath.trim());
                }
              }}
              className="w-full rounded-xl border border-white/15 bg-[#050507] px-3.5 py-2 font-mono text-xs text-white placeholder-zinc-600 focus:border-white/35 focus:outline-none"
            />
          </div>

          <div className="mt-3 max-h-52 overflow-y-auto rounded-xl border border-white/10 bg-[#050507] p-1.5 space-y-1">
            {subdirs.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                {t.spaceEmpty}
              </div>
            ) : (
              subdirs.map((d) => (
                <button
                  key={d.path}
                  type="button"
                  onClick={() => navigateInto(d.path)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <Folder size={14} className="shrink-0 text-zinc-400" />
                  <span className="truncate font-medium">{d.name}</span>
                  <span className="ml-auto truncate font-mono text-[10px] text-zinc-600 max-w-[180px]">
                    {d.path}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                onApplyRoot('');
                onOpenChange(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-xs text-zinc-400 hover:border-white/20 hover:text-white"
            >
              <RotateCcw size={12} />
              {t.resetDefaultRoot}
            </button>

            <button
              type="button"
              onClick={() => {
                onApplyRoot(inputPath.trim());
                onOpenChange(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200"
            >
              <Check size={13} />
              {t.applyRoot}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang: Lang;
  onChangeLang: (lang: Lang) => void;
  cpuBrand: string;
  cpuCores: number;
  osName: string;
  t: TranslationSet;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onOpenChange,
  lang,
  onChangeLang,
  cpuBrand,
  cpuCores,
  osName,
  t,
}) => {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-white/15 bg-[#0B0B0F] p-6 shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-zinc-900 text-zinc-100">
                <SlidersHorizontal size={17} />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold text-white">
                  {t.settingsTitle}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-zinc-400">
                  {t.settingsDesc}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="mt-5 space-y-3">
            {/* Interface Language Selector */}
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#050507] p-4">
              <div className="flex items-center gap-3">
                <Globe size={17} className="shrink-0 text-zinc-300" />
                <div>
                  <div className="text-xs font-semibold text-white">
                    {lang === 'en' ? 'Interface Language' : 'Язык интерфейса'}
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    {lang === 'en'
                      ? 'Switch UI localization instantly'
                      : 'Мгновенное переключение языка программы'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 rounded-full border border-white/10 bg-zinc-900/90 p-0.5">
                <button
                  type="button"
                  onClick={() => onChangeLang('en')}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    lang === 'en'
                      ? 'bg-white text-zinc-950'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => onChangeLang('ru')}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    lang === 'ru'
                      ? 'bg-white text-zinc-950'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Русский
                </button>
              </div>
            </div>

            {/* Safe Trash Guard */}
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-[#050507] p-4">
              <div className="flex gap-3">
                <Shield size={18} className="mt-0.5 shrink-0 text-emerald-400" />
                <div>
                  <div className="text-xs font-semibold text-white">
                    {t.safeTrashLabel}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    {t.safeTrashDesc}
                  </p>
                </div>
              </div>
              <Switch.Root
                checked={true}
                disabled
                className="relative h-5 w-9 shrink-0 rounded-full bg-emerald-400 opacity-90"
              >
                <Switch.Thumb className="block h-3.5 w-3.5 translate-x-[18px] rounded-full bg-zinc-950" />
              </Switch.Root>
            </div>

            {/* Hardware Info */}
            <div className="rounded-2xl border border-white/10 bg-[#050507] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Cpu size={14} className="text-indigo-400" />
                {t.engineInfoLabel}
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">{t.engineInfoDesc}</p>
              <div className="mt-2.5 flex flex-wrap gap-2 font-mono text-[11px] text-zinc-300">
                <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5">
                  {osName}
                </span>
                <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5">
                  {cpuCores} Threads
                </span>
                <span className="truncate max-w-[260px] rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-zinc-400">
                  {cpuBrand}
                </span>
              </div>
            </div>

            {/* Protected Paths List */}
            <div className="rounded-2xl border border-white/10 bg-[#050507] p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                <Lock size={13} className="text-zinc-400" />
                {t.protectedPathsLabel}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-zinc-400">
                {[
                  'C:\\Windows',
                  'C:\\Program Files',
                  '/usr',
                  '/etc',
                  '/bin',
                  '/boot',
                  '/proc',
                  '/sys',
                ].map((p) => (
                  <span
                    key={p}
                    className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <Dialog.Close className="rounded-full bg-white px-5 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200">
              {t.close}
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
