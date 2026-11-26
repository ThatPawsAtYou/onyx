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
  MousePointerClick,
  Plus,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  DirectoryEntry,
  DiskTelemetry,
  ProtectedPathEntry,
  ShellIntegrationStatus,
} from '../types/onyx';
import { Lang, TranslationSet } from '../lib/i18n';
import {
  fetchShellIntegrationStatus,
  fetchSubdirectories,
  toggleExplorerContextMenu,
} from '../lib/bridge';

interface FolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentRoot: string;
  defaultHomeDir: string;
  disks?: DiskTelemetry[];
  onApplyRoot: (root: string) => void;
  t: TranslationSet;
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
  const [inputPath, setInputPath] = useState<string>(
    currentRoot || defaultHomeDir
  );
  const [subdirs, setSubdirs] = useState<DirectoryEntry[]>([]);
  const [loadingDirs, setLoadingDirs] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    const base = currentRoot || defaultHomeDir;
    setInputPath(base);
    setLoadingDirs(true);
    fetchSubdirectories(base)
      .then((list) => setSubdirs(list))
      .catch(() => setSubdirs([]))
      .finally(() => setLoadingDirs(false));
  }, [open, currentRoot, defaultHomeDir]);

  const navigateInto = async (dirPath: string) => {
    setInputPath(dirPath);
    setLoadingDirs(true);
    try {
      const children = await fetchSubdirectories(dirPath);
      setSubdirs(children);
    } catch {
      setSubdirs([]);
    } finally {
      setLoadingDirs(false);
    }
  };

  const navigateParent = () => {
    const trimmed = inputPath.replace(/[\\/]+$/, '');
    if (!trimmed) return;
    const lastSep = Math.max(
      trimmed.lastIndexOf('/'),
      trimmed.lastIndexOf('\\')
    );
    if (lastSep < 0) return;
    const parent =
      lastSep === 0
        ? '/'
        : trimmed[lastSep - 1] === ':'
          ? `${trimmed.slice(0, lastSep)}\\`
          : trimmed.slice(0, lastSep);
    if (parent && parent !== inputPath) {
      navigateInto(parent);
    }
  };

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

          <div className="mt-4">
            <label className="block text-[11px] font-medium text-zinc-400">
              {t.chooseFolder}
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={navigateParent}
                title={t.upFolder}
                className="inline-flex shrink-0 items-center justify-center rounded-xl border border-white/12 bg-[#050507] p-2.5 text-zinc-300 hover:border-white/25 hover:text-white"
              >
                <ArrowUp size={14} />
              </button>
              <input
                type="text"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && inputPath.trim()) {
                    navigateInto(inputPath.trim());
                  }
                }}
                placeholder="C:\Users\..."
                className="w-full rounded-xl border border-white/12 bg-[#050507] px-3.5 py-2 font-mono text-xs text-white placeholder-zinc-600 focus:border-white/30 focus:outline-none"
              />
            </div>

            {disks.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {disks.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => navigateInto(d.mountPoint)}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-zinc-300 hover:border-white/25 hover:text-white"
                  >
                    <HardDrive size={11} className="text-zinc-400" />
                    <span>{d.mountPoint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 max-h-52 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#050507] p-2 space-y-1">
            {loadingDirs ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                {t.scanning}
              </div>
            ) : subdirs.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                {inputPath}
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
  protectedEntries: ProtectedPathEntry[];
  onAddProtectedPath: (path: string) => Promise<void>;
  onRemoveProtectedPath: (path: string) => Promise<void>;
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
  protectedEntries,
  onAddProtectedPath,
  onRemoveProtectedPath,
  cpuBrand,
  cpuCores,
  osName,
  t,
}) => {
  const [shellStatus, setShellStatus] =
    useState<ShellIntegrationStatus | null>(null);
  const [newProtectedInput, setNewProtectedInput] = useState<string>('');
  const [togglingShell, setTogglingShell] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    fetchShellIntegrationStatus()
      .then((st) => setShellStatus(st))
      .catch(() => setShellStatus(null));
  }, [open]);

  const handleToggleExplorerMenu = async (nextChecked: boolean) => {
    setTogglingShell(true);
    try {
      const updated = await toggleExplorerContextMenu(nextChecked);
      setShellStatus(updated);
    } catch {
      // Ignore if unsupported OS
    } finally {
      setTogglingShell(false);
    }
  };

  const handleAddWhitelist = async () => {
    const trimmed = newProtectedInput.trim();
    if (!trimmed) return;
    await onAddProtectedPath(trimmed);
    setNewProtectedInput('');
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[92vw] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[22px] border border-white/15 bg-[#0B0B0F] p-6 shadow-2xl focus:outline-none">
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

            {/* Windows Explorer Context Menu Integration */}
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-[#050507] p-4">
              <div className="flex gap-3">
                <MousePointerClick
                  size={18}
                  className="mt-0.5 shrink-0 text-cyan-400"
                />
                <div>
                  <div className="text-xs font-semibold text-white">
                    {t.explorerMenuLabel}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    {t.explorerMenuDesc}
                  </p>
                </div>
              </div>
              <Switch.Root
                checked={Boolean(shellStatus?.contextMenuEnabled)}
                disabled={!shellStatus?.supported || togglingShell}
                onCheckedChange={handleToggleExplorerMenu}
                className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full border border-white/15 bg-zinc-900 transition-colors data-[state=checked]:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Switch.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-zinc-400 transition-transform duration-200 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-zinc-950" />
              </Switch.Root>
            </div>

            {/* User Protected Paths Whitelist */}
            <div className="rounded-2xl border border-white/10 bg-[#050507] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Shield size={14} className="text-emerald-400" />
                {t.whitelistTitle}
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">
                {t.whitelistDesc}
              </p>

              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="text"
                  value={newProtectedInput}
                  onChange={(e) => setNewProtectedInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddWhitelist();
                  }}
                  placeholder={t.whitelistInputPlaceholder}
                  className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-white placeholder-zinc-600 focus:border-white/25 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddWhitelist}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-zinc-200"
                >
                  <Plus size={13} />
                  <span>{t.whitelistAddBtn}</span>
                </button>
              </div>

              <div className="mt-2.5 max-h-28 space-y-1 overflow-y-auto">
                {protectedEntries.length === 0 ? (
                  <p className="text-[11px] text-zinc-500">
                    {t.whitelistEmpty}
                  </p>
                ) : (
                  protectedEntries.map((entry) => (
                    <div
                      key={entry.path}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5"
                    >
                      <span className="truncate font-mono text-[11px] text-emerald-200">
                        {entry.path}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveProtectedPath(entry.path)}
                        className="rounded p-1 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
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

            {/* Built-in Protected System Roots */}
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
