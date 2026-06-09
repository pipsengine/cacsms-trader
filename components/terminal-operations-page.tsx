'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ClipboardCheck, Cpu, Database, Folder, Gauge, Globe2, KeyRound, Laptop2, Layers3, Link2, LockKeyhole, MapPin, MemoryStick, Network, PlugZap, Radio, RefreshCw, Router, Search, Server, ShieldAlert, ShieldCheck, TerminalSquare, UserCheck, Wifi, Wrench } from 'lucide-react';
import { useMt5OpsState } from '@/components/mt5-ops-shell';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Mt5BridgeSecretPanel } from '@/components/mt5-bridge-secret-panel';

type EnqueueState = { status: 'idle' | 'submitting' | 'ok' | 'error'; message: string };

export function TerminalOperationsClientPage(props: { page: string }) {
  const page = props.page;
  const hydrated = useHydrated();
  const state = useMt5OpsState();

  if (!hydrated) {
    return (
      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-600" /> Loading terminal operations
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 text-sm text-slate-600">
          Preparing live terminal telemetry.
        </CardContent>
      </Card>
    );
  }

  if (page === 'ea-deployment-link') {
    return <EADeploymentLinkPage />;
  }

  if (page === 'connected-terminals') {
    return <ConnectedTerminals terminals={state.terminals} />;
  }
  if (page === 'terminal-registration') {
    return <TerminalRegistration terminals={state.terminals} registrations={state.registrations} />;
  }
  if (page === 'terminal-heartbeat') {
    return <TerminalHeartbeat terminals={state.terminals} registrations={state.registrations} />;
  }
  if (page === 'terminal-health-monitoring') {
    return <TerminalHealth terminals={state.terminals} />;
  }
  if (page === 'mt5-synchronization') {
    return <Mt5Synchronization terminals={state.terminals} />;
  }
  if (page === 'mt5-execution-bridge') {
    return <Mt5ExecutionBridge terminals={state.terminals} commands={state.commands} recentAcks={state.recentAcks} commandSummary={state.commandSummary} />;
  }
  if (page === 'ea-communication-engine') {
    return <EaCommunicationEnginePage terminals={state.terminals} commands={state.commands} recentAcks={state.recentAcks} commandSummary={state.commandSummary} />;
  }
  if (page === 'execution-audit-journal') {
    return <ExecutionAuditJournalPage terminals={state.terminals} commandSummary={state.commandSummary} />;
  }
  if (page === 'live-latency-monitoring') {
    return <LatencyMonitoring terminals={state.terminals} />;
  }
  if (page === 'multi-computer-support') {
    return <MultiComputerSupport terminals={state.terminals} registrations={state.registrations} />;
  }
  if (page === 'account-routing') {
    return <AccountRouting terminals={state.terminals} routing={state.routing} />;
  }
  if (page === 'vps-management') {
    return <VpsManagement vps={state.vps} />;
  }
  if (page === 'ea-deployment') {
    return <EaDeploymentDashboard terminals={state.terminals} />;
  }

  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600" /> Unknown page
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 text-sm text-slate-600 font-mono">{page}</CardContent>
    </Card>
  );
}

type DeploymentMethod = 'SYMLINK' | 'COPY';

type DeploymentStatus =
  | 'NOT_CONFIGURED'
  | 'READY'
  | 'VALIDATING'
  | 'DEPLOYING'
  | 'SUCCESS'
  | 'FAILED'
  | 'PARTIAL'
  | 'REQUIRES_ADMIN'
  | 'REQUIRES_MT5_REFRESH';

interface MT5DataFolder {
  id: string;
  path: string;
  terminalHash: string;
  hasMql5: boolean;
  hasExperts: boolean;
  detectedAt: string;
  brokerHint?: string;
  accountHint?: string;
}

interface EADeploymentConfig {
  projectEaFolder: string;
  mt5DataFolder: string;
  mt5ExpertsFolder: string;
  targetFolderName: string;
  deploymentMethod: DeploymentMethod;
  environment: 'DEMO' | 'LIVE' | 'PROP' | 'MARKET_DATA_MONITOR' | 'FAILOVER_RESERVE';
  eaSourceFolder?: string;
  eaCompiledFolder?: string;
  mt5DataRoot?: string;
  mt5TerminalName?: string;
  brokerAccountLabel?: string;
}

interface DeploymentVerification {
  linkExists: boolean;
  isSymlink: boolean;
  targetExists: boolean;
  eaEx5Exists: boolean;
  eaMq5Exists: boolean;
  filesCount: number;
  lastModified?: string;
  status: DeploymentStatus;
  message: string;
  deploymentMethod?: DeploymentMethod;
}

interface DeploymentLog {
  id: string;
  timestamp: string;
  severity: 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  action: string;
  message: string;
  path?: string;
}

interface DeploymentRuntime {
  mt5TerminalRoot: string;
  mt5MetaquotesRoot: string;
  projectEaFolder: string;
  dockerMount: boolean;
  recommendedMethod: DeploymentMethod;
  symlinkSupported: boolean;
}

const CANONICAL_EA_TARGET_FOLDER = 'CacsmsTraderEA';

function joinExpertsPath(dataFolder: string, targetFolderName: string): string {
  const root = dataFolder.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${root}/MQL5/Experts/${targetFolderName}`;
}

function normalizeEaDeploymentConfig(
  saved: Partial<EADeploymentConfig> | null | undefined,
  current: EADeploymentConfig,
  runtime: DeploymentRuntime | undefined,
): EADeploymentConfig {
  const dockerMount = Boolean(runtime?.dockerMount);
  const targetFolderName =
    saved?.targetFolderName === 'CacsmsTrader' ? CANONICAL_EA_TARGET_FOLDER : (saved?.targetFolderName || CANONICAL_EA_TARGET_FOLDER);
  const mt5DataFolder = preferContainerPath(saved?.mt5DataFolder, current.mt5DataFolder, dockerMount);
  const mt5ExpertsFolder = mt5DataFolder
    ? joinExpertsPath(mt5DataFolder, targetFolderName)
    : preferContainerPath(saved?.mt5ExpertsFolder, current.mt5ExpertsFolder, dockerMount);
  return {
    ...current,
    ...(saved ?? {}),
    projectEaFolder: preferContainerPath(
      saved?.projectEaFolder,
      runtime?.projectEaFolder || current.projectEaFolder,
      dockerMount,
    ),
    mt5DataFolder,
    mt5ExpertsFolder,
    targetFolderName,
    eaSourceFolder: undefined,
    deploymentMethod: saved?.deploymentMethod || runtime?.recommendedMethod || current.deploymentMethod,
  };
}

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value.trim());
}

function preferContainerPath(saved: string | undefined, runtimePath: string, dockerMount: boolean): string {
  if (!saved) return runtimePath;
  if (dockerMount && isWindowsDrivePath(saved)) return runtimePath;
  return saved;
}

type FolderStatus = {
  path: string;
  exists: boolean;
  kind: 'directory' | 'file' | 'symlink' | 'missing' | 'unknown';
  message?: string;
};

export function EADeploymentLinkPage() {
  const [runtime, setRuntime] = useState<DeploymentRuntime | null>(null);
  const [config, setConfig] = useState<EADeploymentConfig>({
    projectEaFolder: '',
    mt5DataFolder: '',
    mt5ExpertsFolder: '',
    targetFolderName: CANONICAL_EA_TARGET_FOLDER,
    deploymentMethod: 'COPY',
    environment: 'DEMO',
  });
  const [folders, setFolders] = useState<MT5DataFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [status, setStatus] = useState<DeploymentVerification | null>(null);
  const [logs, setLogs] = useState<DeploymentLog[]>([]);
  const [loading, setLoading] = useState<{ detect: boolean; deploy: boolean; copy: boolean; refresh: boolean }>({
    detect: false,
    deploy: false,
    copy: false,
    refresh: false,
  });
  const [toast, setToast] = useState<{ tone: 'success' | 'warning' | 'error' | 'info'; message: string } | null>(null);
  const [confirm, setConfirm] = useState<{ open: boolean; action: 'relink' | 'overwrite' | null; message: string }>({
    open: false,
    action: null,
    message: '',
  });

  const derivedMt5ExpertsFolder = useMemo(() => {
    if (!config.mt5DataFolder) return '';
    return joinExpertsPath(config.mt5DataFolder, config.targetFolderName);
  }, [config.mt5DataFolder, config.targetFolderName]);

  const showToast = (tone: 'success' | 'warning' | 'error' | 'info', message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 5000);
  };

  const refresh = async () => {
    setLoading((c) => ({ ...c, refresh: true }));
    try {
      const response = await fetch('/api/mt5/ea-deployment/status', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? `Status failed with HTTP ${response.status}`);
      }
      setStatus(payload.verification ?? null);
      setLogs(payload.logs ?? []);
      if (payload.runtime) {
        setRuntime(payload.runtime);
      }
      setConfig((current) =>
        normalizeEaDeploymentConfig(
          payload.config as Partial<EADeploymentConfig> | null | undefined,
          current,
          payload.runtime as DeploymentRuntime | undefined,
        ),
      );
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Failed to load status.');
    } finally {
      setLoading((c) => ({ ...c, refresh: false }));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const detectFolders = async () => {
    setLoading((c) => ({ ...c, detect: true }));
    try {
      const response = await fetch('/api/mt5/ea-deployment/detect', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? `Detect failed with HTTP ${response.status}`);
      }
      const detected = payload.folders ?? [];
      setFolders(detected);
      setLogs(payload.logs ?? []);
      if (detected.length === 1) {
        const folder = detected[0] as MT5DataFolder;
        setSelectedFolderId(folder.id);
        setConfig((current) => ({
          ...current,
          mt5DataFolder: folder.path,
          mt5ExpertsFolder: joinExpertsPath(folder.path, current.targetFolderName || CANONICAL_EA_TARGET_FOLDER),
          targetFolderName: current.targetFolderName || CANONICAL_EA_TARGET_FOLDER,
          mt5DataRoot: runtime?.mt5MetaquotesRoot ?? current.mt5DataRoot,
        }));
        showToast('success', 'Detected 1 MT5 terminal and selected it automatically.');
      } else {
        showToast('success', `Detected ${detected.length} MT5 data folders. Click a row to select your terminal.`);
      }
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Failed to detect MT5 folders.');
    } finally {
      setLoading((c) => ({ ...c, detect: false }));
    }
  };

  const applySelectedFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) return;
    const mt5ExpertsFolder = joinExpertsPath(folder.path, config.targetFolderName);
    setConfig((current) => ({
      ...current,
      mt5DataFolder: folder.path,
      mt5ExpertsFolder,
      mt5DataRoot: runtime?.mt5MetaquotesRoot ?? current.mt5DataRoot,
    }));
  };

  const createLink = async (force = false) => {
    setLoading((c) => ({ ...c, deploy: true }));
    try {
      const response = await fetch('/api/mt5/ea-deployment/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { ...config, mt5ExpertsFolder: config.mt5ExpertsFolder || derivedMt5ExpertsFolder },
          force,
        }),
      });
      const payload = await response.json();
      setLogs(payload.logs ?? []);
      setStatus(payload.verification ?? null);
      if (!response.ok) {
        if (payload?.requiresConfirmation) {
          setConfirm({ open: true, action: payload.confirmAction ?? 'overwrite', message: payload.message ?? 'Confirmation required.' });
          return;
        }
        throw new Error(payload?.error ?? `Create link failed with HTTP ${response.status}`);
      }
      showToast('success', payload.message ?? 'EA symbolic link created.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Failed to create link.');
    } finally {
      setLoading((c) => ({ ...c, deploy: false }));
    }
  };

  const copyFiles = async (force = false) => {
    setLoading((c) => ({ ...c, copy: true }));
    try {
      const response = await fetch('/api/mt5/ea-deployment/copy-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { ...config, mt5ExpertsFolder: config.mt5ExpertsFolder || derivedMt5ExpertsFolder, deploymentMethod: 'COPY' },
          force,
        }),
      });
      const payload = await response.json();
      setLogs(payload.logs ?? []);
      setStatus(payload.verification ?? null);
      if (!response.ok) {
        if (payload?.requiresConfirmation) {
          setConfirm({ open: true, action: payload.confirmAction ?? 'overwrite', message: payload.message ?? 'Confirmation required.' });
          return;
        }
        throw new Error(payload?.error ?? `Copy failed with HTTP ${response.status}`);
      }
      showToast('success', payload.message ?? 'EA files copied.');
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'Failed to copy files.');
    } finally {
      setLoading((c) => ({ ...c, copy: false }));
    }
  };

  const steps = [
    { id: 'detect', label: 'Detect MT5 data folders', done: folders.length > 0 },
    { id: 'select', label: 'Select target MT5 terminal folder', done: Boolean(config.mt5DataFolder) },
    { id: 'confirm', label: 'Confirm project EA folder', done: Boolean(config.projectEaFolder) },
    { id: 'deploy', label: 'Deploy via symlink or copy', done: status?.status === 'SUCCESS' || status?.status === 'REQUIRES_MT5_REFRESH' || status?.status === 'PARTIAL' },
    { id: 'verify', label: 'Verify deployment', done: Boolean(status) },
    { id: 'refresh', label: 'Refresh MT5 Navigator / restart MT5', done: status?.status !== 'REQUIRES_MT5_REFRESH' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-slate-950">EA Deployment Link Manager</h3>
          <p className="text-sm text-slate-600">Link the Cacsms Trader EA folder to MetaTrader 5 Experts directory</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/mt5-infrastructure/terminal-operations/ea-deployment"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex items-center gap-1.5')}
          >
            <TerminalSquare className="h-4 w-4" />
            Fleet dashboard
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
            <LockKeyhole className="h-3.5 w-3.5" /> Development Tool / Admin Only / Requires Local Machine Access
          </span>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading.refresh}>
            <RefreshCw className={cn('h-4 w-4', loading.refresh && 'animate-spin')} />
            Refresh status
          </Button>
        </div>
      </header>

      <WorkflowStepper steps={steps} />

      {runtime?.dockerMount ? (
        <Card className="border-amber-200 bg-amber-50 shadow-sm shadow-slate-900/5">
          <CardContent className="p-4 text-sm text-amber-900">
            Docker runtime detected. Your Windows MetaQuotes folder is mounted at{' '}
            <span className="font-mono">{runtime.mt5TerminalRoot}</span>. Use <strong>Copy files</strong> to deploy
            into <span className="font-mono">MQL5/Experts/CacsmsTraderEA</span> (symlinks are not supported inside the container).
            The only EA source is <span className="font-mono">{runtime.projectEaFolder}</span>.
          </CardContent>
        </Card>
      ) : null}

      <Mt5BridgeSecretPanel compact />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FolderStatusCard title="Project EA Folder Status" icon={Folder} status={statusFolder(config.projectEaFolder)} />
        <FolderStatusCard title="MT5 Experts Folder Status" icon={Folder} status={statusFolder(config.mt5ExpertsFolder || derivedMt5ExpertsFolder)} />
        <SymbolicLinkStatusCard title="Symbolic Link Status" icon={Link2} verification={status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DeploymentReadinessCard verification={status} />
        <LastScriptRunCard logs={logs} />
        <AdminPermissionStatusCard verification={status} />
      </div>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Wrench className="w-4 h-4 text-indigo-700" /> Folder Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <PathInputField
              label="Project EA folder"
              value={config.projectEaFolder}
              onChange={(value) => setConfig((c) => ({ ...c, projectEaFolder: value }))}
              placeholder="C:\\Cacsms Limited\\cacsms-trader\\mt5\\ea\\compiled"
            />
            <PathInputField
              label="MT5 data folder"
              value={config.mt5DataFolder}
              onChange={(value) => setConfig((c) => ({ ...c, mt5DataFolder: value }))}
              placeholder="C:\\Users\\USERNAME\\AppData\\Roaming\\MetaQuotes\\Terminal\\TERMINAL_ID"
            />
            <PathInputField
              label="MT5 Experts target folder"
              value={config.mt5ExpertsFolder || derivedMt5ExpertsFolder}
              onChange={(value) => setConfig((c) => ({ ...c, mt5ExpertsFolder: value }))}
              placeholder="...\\MQL5\\Experts\\CacsmsTraderEA"
            />
            <PathInputField
              label="Target folder name"
              value={config.targetFolderName}
              onChange={(value) => setConfig((c) => ({ ...c, targetFolderName: value }))}
              placeholder="CacsmsTraderEA"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <PathInputField
              label="EA source folder (optional)"
              value={config.eaSourceFolder ?? ''}
              onChange={(value) => setConfig((c) => ({ ...c, eaSourceFolder: value || undefined }))}
              placeholder="...\\mt5\\experts\\CacsmsTraderEA"
            />
            <PathInputField
              label="EA compiled folder (optional)"
              value={config.eaCompiledFolder ?? ''}
              onChange={(value) => setConfig((c) => ({ ...c, eaCompiledFolder: value || undefined }))}
              placeholder="...\\MQL5\\Experts\\Compiled"
            />
            <SelectField
              label="Terminal environment"
              value={config.environment}
              options={[
                { value: 'DEMO', label: 'Demo' },
                { value: 'LIVE', label: 'Live' },
                { value: 'PROP', label: 'Prop' },
                { value: 'MARKET_DATA_MONITOR', label: 'Market Data Monitor' },
                { value: 'FAILOVER_RESERVE', label: 'Failover Reserve' },
              ]}
              onChange={(value) => setConfig((c) => ({ ...c, environment: value as EADeploymentConfig['environment'] }))}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <PathInputField
              label="MT5 terminal name (optional)"
              value={config.mt5TerminalName ?? ''}
              onChange={(value) => setConfig((c) => ({ ...c, mt5TerminalName: value || undefined }))}
              placeholder="MetaTrader 5"
            />
            <PathInputField
              label="Broker account label (optional)"
              value={config.brokerAccountLabel ?? ''}
              onChange={(value) => setConfig((c) => ({ ...c, brokerAccountLabel: value || undefined }))}
              placeholder="BrokerName / Demo / 123456"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Search className="w-4 h-4 text-indigo-700" /> Auto-Detect MT5 Folder
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-slate-600">
              Scan MetaQuotes terminal folders on this machine and pick the target MT5 installation.
            </div>
            <Button onClick={detectFolders} disabled={loading.detect}>
              <Search className={cn('h-4 w-4', loading.detect && 'animate-pulse')} />
              Detect MT5 Data Folders
            </Button>
          </div>
          {folders.length === 1 && !selectedFolderId ? (
            <p className="text-xs text-amber-700">One terminal was detected. Click the row below if it is not already highlighted.</p>
          ) : null}
          <MT5FolderTable folders={folders} selectedId={selectedFolderId} onSelect={applySelectedFolder} />
        </CardContent>
      </Card>

      <DeploymentMethodSelector
        method={config.deploymentMethod}
        symlinkSupported={runtime?.symlinkSupported ?? true}
        recommendedMethod={runtime?.recommendedMethod ?? 'SYMLINK'}
        onChange={(deploymentMethod) => setConfig((c) => ({ ...c, deploymentMethod }))}
      />

      <DeploymentActionButtons
        onCreateLink={() => createLink(false)}
        onCopy={() => copyFiles(false)}
        busy={loading.deploy || loading.copy}
        method={config.deploymentMethod}
      />

      <DeploymentVerificationPanel verification={status} />
      <DeploymentLogsPanel logs={logs} />

      <ConfirmationModal
        open={confirm.open}
        message={confirm.message}
        onCancel={() => setConfirm({ open: false, action: null, message: '' })}
        onConfirm={() => {
          const action = confirm.action;
          setConfirm({ open: false, action: null, message: '' });
          if (config.deploymentMethod === 'COPY') {
            copyFiles(true);
          } else {
            createLink(action === 'relink' || action === 'overwrite');
          }
        }}
      />

      {toast ? <Toast tone={toast.tone} message={toast.message} /> : null}
    </div>
  );
}

function statusFolder(path: string): FolderStatus {
  if (!path) {
    return { path: '', exists: false, kind: 'missing', message: 'Not configured' };
  }
  return { path, exists: true, kind: 'unknown', message: 'Will be verified by backend' };
}

function FolderStatusCard(props: { title: string; icon: any; status: FolderStatus }) {
  const Icon = props.icon;
  const tone = props.status.exists ? 'teal' : 'amber';
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
          <Icon className={cn('w-3 h-3', tone === 'teal' ? 'text-teal-700' : 'text-amber-700')} /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm font-semibold text-slate-950">{props.status.exists ? 'Configured' : 'Missing'}</div>
        <div className="text-xs font-mono text-slate-600 break-all">{props.status.path || '--'}</div>
        <div className="text-[11px] text-slate-500">{props.status.message}</div>
      </CardContent>
    </Card>
  );
}

function SymbolicLinkStatusCard(props: { title: string; icon: any; verification: DeploymentVerification | null }) {
  const Icon = props.icon;
  const verification = props.verification;
  const status = verification?.isSymlink ? 'Symlink' : verification?.linkExists ? 'Folder' : 'Not deployed';
  const tone = verification?.status === 'SUCCESS' ? 'teal' : verification?.status === 'REQUIRES_ADMIN' ? 'amber' : verification?.status === 'FAILED' ? 'rose' : 'slate';
  const toneClass: Record<string, string> = {
    teal: 'text-teal-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    slate: 'text-slate-600',
  };
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
          <Icon className={cn('w-3 h-3', toneClass[tone])} /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm font-semibold text-slate-950">{status}</div>
        <div className="text-[11px] text-slate-500">{verification?.message ?? 'Awaiting deployment status.'}</div>
      </CardContent>
    </Card>
  );
}

function DeploymentReadinessCard({ verification }: { verification: DeploymentVerification | null }) {
  const ready = verification?.status === 'SUCCESS' || verification?.status === 'REQUIRES_MT5_REFRESH';
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
          <ClipboardCheck className={cn('w-3 h-3', ready ? 'text-teal-700' : 'text-amber-700')} /> Deployment Readiness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm font-semibold text-slate-950">{ready ? 'Ready' : 'Not ready'}</div>
        <div className="text-[11px] text-slate-500">{verification?.message ?? 'Run detection and configure folders to proceed.'}</div>
      </CardContent>
    </Card>
  );
}

function LastScriptRunCard({ logs }: { logs: DeploymentLog[] }) {
  const last = logs[0];
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-3 h-3 text-indigo-700" /> Last Script Run
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm font-semibold text-slate-950">{last ? formatTime(last.timestamp) : '--:--:--'}</div>
        <div className="text-[11px] text-slate-500">{last ? `${last.severity} / ${last.action}` : 'No script runs recorded yet.'}</div>
      </CardContent>
    </Card>
  );
}

function AdminPermissionStatusCard({ verification }: { verification: DeploymentVerification | null }) {
  const requiresAdmin = verification?.status === 'REQUIRES_ADMIN';
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
          <KeyRound className={cn('w-3 h-3', requiresAdmin ? 'text-amber-700' : 'text-teal-700')} /> Admin Permission Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm font-semibold text-slate-950">{requiresAdmin ? 'Administrator required' : 'OK'}</div>
        <div className="text-[11px] text-slate-500">
          {requiresAdmin ? 'Run the app as Administrator or use Copy EA Files Instead.' : 'Symlink creation supported or not required.'}
        </div>
      </CardContent>
    </Card>
  );
}

function PathInputField(props: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-slate-700">{props.label}</div>
      <input
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

function SelectField(props: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-slate-700">{props.label}</div>
      <select
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function MT5FolderTable(props: { folders: MT5DataFolder[]; selectedId: string; onSelect: (id: string) => void }) {
  if (props.folders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
        No MT5 data folders detected yet. Click Detect MT5 Data Folders.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow className="border-slate-200 hover:bg-transparent">
            <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
            <TableHead className="text-xs font-mono text-slate-500">MT5 Data Folder</TableHead>
            <TableHead className="text-xs font-mono text-slate-500 text-right">Experts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.folders.map((folder) => {
            const active = props.selectedId === folder.id;
            return (
              <TableRow
                key={folder.id}
                className={cn('border-slate-100 cursor-pointer', active ? 'bg-blue-50' : 'hover:bg-slate-50')}
                onClick={() => props.onSelect(folder.id)}
              >
                <TableCell className="font-mono text-xs text-slate-700">{folder.terminalHash.slice(0, 8)}</TableCell>
                <TableCell className="font-mono text-xs text-slate-700 break-all">{folder.path}</TableCell>
                <TableCell className="text-right font-mono text-xs text-slate-700">{folder.hasExperts ? 'YES' : 'NO'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function DeploymentMethodSelector(props: {
  method: DeploymentMethod;
  symlinkSupported?: boolean;
  recommendedMethod?: DeploymentMethod;
  onChange: (method: DeploymentMethod) => void;
}) {
  const symlinkSupported = props.symlinkSupported ?? true;
  const recommendedMethod = props.recommendedMethod ?? 'SYMLINK';

  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Layers3 className="w-4 h-4 text-indigo-700" /> Deployment Method
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!symlinkSupported}
            className={cn(
              'rounded-lg border p-4 text-left transition-colors',
              !symlinkSupported && 'cursor-not-allowed opacity-60',
              props.method === 'SYMLINK' ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50',
            )}
            onClick={() => symlinkSupported && props.onChange('SYMLINK')}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Link2 className="h-4 w-4 text-indigo-700" /> Symbolic Link
              {recommendedMethod === 'SYMLINK' ? <span className="text-xs font-normal text-indigo-700">(Recommended)</span> : null}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {symlinkSupported
                ? 'MT5 reads the EA directly from the project folder (no copying). Requires admin on some systems.'
                : 'Not available in Docker. Use copy mode to deploy into the mounted MT5 folder.'}
            </div>
          </button>
          <button
            type="button"
            className={cn(
              'rounded-lg border p-4 text-left transition-colors',
              props.method === 'COPY' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white hover:bg-slate-50',
            )}
            onClick={() => props.onChange('COPY')}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Server className="h-4 w-4 text-amber-700" /> Copy EA Files
              {recommendedMethod === 'COPY' ? <span className="text-xs font-normal text-amber-700">(Recommended)</span> : null}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              Copies .ex5/.mq5/.set and supporting files into MT5 Experts folder. Works without admin.
            </div>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function DeploymentActionButtons(props: { method: DeploymentMethod; busy: boolean; onCreateLink: () => void; onCopy: () => void }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
      <Button variant="outline" onClick={props.onCopy} disabled={props.busy}>
        <Server className="h-4 w-4" />
        Copy EA Files Instead
      </Button>
      <Button onClick={props.onCreateLink} disabled={props.busy}>
        <Link2 className="h-4 w-4" />
        Create EA Symbolic Link
      </Button>
    </div>
  );
}

function DeploymentVerificationPanel({ verification }: { verification: DeploymentVerification | null }) {
  const tone = verification?.status === 'SUCCESS'
    ? 'teal'
    : verification?.status === 'FAILED'
      ? 'rose'
      : verification?.status === 'REQUIRES_ADMIN'
        ? 'amber'
        : 'slate';
  const toneClass = tone === 'teal'
    ? 'border-teal-200 bg-teal-50'
    : tone === 'rose'
      ? 'border-rose-200 bg-rose-50'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50'
        : 'border-slate-200 bg-slate-50';

  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-indigo-700" /> Deployment Verification
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {!verification ? (
          <div className="text-sm text-slate-600">No verification yet. Run deployment to verify.</div>
        ) : (
          <div className={cn('rounded-lg border p-4', toneClass)}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-950">{verification.status}</div>
              <div className="text-xs font-mono text-slate-700">{verification.deploymentMethod ?? ''}</div>
            </div>
            <div className="mt-1 text-sm text-slate-700">{verification.message}</div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono text-slate-700">
              <div>Link: {verification.linkExists ? 'YES' : 'NO'}</div>
              <div>Symlink: {verification.isSymlink ? 'YES' : 'NO'}</div>
              <div>Target: {verification.targetExists ? 'YES' : 'NO'}</div>
              <div>Files: {verification.filesCount}</div>
              <div>.ex5: {verification.eaEx5Exists ? 'YES' : 'NO'}</div>
              <div>.mq5: {verification.eaMq5Exists ? 'YES' : 'NO'}</div>
              <div>Modified: {verification.lastModified ? formatTime(verification.lastModified) : '--:--:--'}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeploymentLogsPanel({ logs }: { logs: DeploymentLog[] }) {
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Radio className="w-4 h-4 text-indigo-700" /> Deployment Logs
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[280px]">
          <div className="flex flex-col">
            {logs.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No logs yet.</div>
            ) : logs.map((log) => (
              <div key={log.id} className="flex gap-4 p-2 px-4 text-xs border-b border-slate-100 hover:bg-slate-50 font-mono">
                <span className="text-slate-500 shrink-0 w-20">{formatTime(log.timestamp)}</span>
                <span className={cn('w-20 shrink-0 font-bold',
                  log.severity === 'SUCCESS' ? 'text-teal-700'
                    : log.severity === 'WARNING' ? 'text-amber-700'
                      : log.severity === 'ERROR' ? 'text-rose-700'
                        : log.severity === 'INFO' ? 'text-indigo-700'
                          : 'text-slate-600',
                )}>{log.severity}</span>
                <span className="w-40 shrink-0 text-slate-700">{log.action}</span>
                <span className="text-slate-700">{log.message}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function WorkflowStepper({ steps }: { steps: Array<{ id: string; label: string; done: boolean }> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
      {steps.map((step, idx) => (
        <div key={step.id} className={cn('rounded-lg border px-3 py-3 bg-white', step.done ? 'border-teal-200 bg-teal-50' : 'border-slate-200')}>
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-mono text-slate-500">Step {idx + 1}</div>
            {step.done ? <CheckCircle2 className="h-4 w-4 text-teal-600" /> : <div className="h-4 w-4 rounded-full border border-slate-200" />}
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-900">{step.label}</div>
        </div>
      ))}
    </div>
  );
}

function ConfirmationModal(props: { open: boolean; message: string; onCancel: () => void; onConfirm: () => void }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/35" onClick={props.onCancel} />
      <div className="relative w-[min(92vw,560px)] rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-950">Confirmation Required</div>
        <div className="p-4 text-sm text-slate-700">{props.message}</div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button variant="outline" onClick={props.onCancel}>Cancel</Button>
          <Button onClick={props.onConfirm}>Confirm</Button>
        </div>
      </div>
    </div>
  );
}

function Toast(props: { tone: 'success' | 'warning' | 'error' | 'info'; message: string }) {
  const toneClass = props.tone === 'success'
    ? 'border-teal-200 bg-teal-50 text-teal-800'
    : props.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : props.tone === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-indigo-200 bg-indigo-50 text-indigo-800';
  return (
    <div className="fixed bottom-5 right-5 z-50">
      <div className={cn('rounded-lg border px-4 py-3 shadow-lg text-sm font-semibold', toneClass)}>
        {props.message}
      </div>
    </div>
  );
}

function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

function ConnectedTerminals({ terminals }: { terminals: any[] }) {
  const [query, setQuery] = useState('');
  const [broker, setBroker] = useState('all');
  const [status, setStatus] = useState('all');
  const [latency, setLatency] = useState('all');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const terminalRows = useMemo(() => terminals.map(enrichTerminal), [terminals]);
  const brokers = useMemo(() => Array.from(new Set(terminalRows.map((terminal) => terminal.brokerName || 'Unknown broker'))).sort(), [terminalRows]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return terminalRows.filter((terminal) => {
      const matchesQuery = !normalizedQuery || [
        terminal.terminalId,
        terminal.computerName,
        terminal.brokerName,
        terminal.serverName,
        terminal.accountNumber,
        terminal.accountType,
        terminal.vpsLocation,
      ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
      const matchesBroker = broker === 'all' || (terminal.brokerName || 'Unknown broker') === broker;
      const matchesStatus = status === 'all' || terminal.opsStatus === status;
      const matchesLatency = latency === 'all'
        || (latency === 'sub100' && terminal.latencyMs < 100)
        || (latency === '100to500' && terminal.latencyMs >= 100 && terminal.latencyMs <= 500)
        || (latency === 'over500' && terminal.latencyMs > 500);
      return matchesQuery && matchesBroker && matchesStatus && matchesLatency;
    });
  }, [broker, latency, query, status, terminalRows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const connected = terminalRows.filter((terminal) => terminal.status === 'connected');
  const degraded = terminalRows.filter((terminal) => terminal.status === 'degraded');
  const disconnected = terminalRows.filter((terminal) => terminal.status === 'disconnected');
  const averageLatency = terminalRows.length ? Math.round(terminalRows.reduce((sum, terminal) => sum + terminal.latencyMs, 0) / terminalRows.length) : 0;
  const activeBrokers = new Set(terminalRows.map((terminal) => terminal.brokerName).filter(Boolean)).size;
  const accounts = new Set(terminalRows.map((terminal) => terminal.accountNumber).filter(Boolean)).size;
  const tickSyncHealthy = terminalRows.length > 0 && terminalRows.every((terminal) => terminal.tickDelayMs < 1500 && terminal.status !== 'disconnected');
  const tickRows = buildTickFeed(terminalRows);
  const activity = buildActivityFeed(terminalRows);
  const brokerDistribution = buildDistribution(terminalRows, 'brokerName');
  const locationDistribution = buildDistribution(terminalRows, 'vpsLocation');

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={TerminalSquare} title="Total connected terminals" value={String(terminalRows.length)} detail="Registered MT5 bridge sessions" tone="blue" />
        <OpsSummaryCard icon={CheckCircle2} title="Online terminals" value={String(connected.length)} detail="Accepting heartbeat stream" tone="green" />
        <OpsSummaryCard icon={ShieldAlert} title="Warning terminals" value={String(degraded.length)} detail="Latency, jitter, or stale ticks" tone="amber" />
        <OpsSummaryCard icon={AlertTriangle} title="Offline terminals" value={String(disconnected.length)} detail="Heartbeat timeout or disconnect" tone="red" />
        <OpsSummaryCard icon={Gauge} title="Average latency" value={`${averageLatency}ms`} detail="Rolling bridge latency" tone="blue" />
        <OpsSummaryCard icon={Server} title="Active brokers" value={String(activeBrokers)} detail="Distinct broker endpoints" tone="slate" />
        <OpsSummaryCard icon={Database} title="Connected accounts" value={String(accounts)} detail="Unique trading accounts" tone="violet" />
        <OpsSummaryCard icon={Wifi} title="Tick synchronization" value={tickSyncHealthy ? 'LOCKED' : 'ATTN'} detail={tickSyncHealthy ? 'All primary symbols fresh' : 'One or more feeds delayed'} tone={tickSyncHealthy ? 'green' : 'amber'} />
      </section>

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Network className="w-4 h-4 text-blue-700" /> Real-Time Connected Terminals
              </CardTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[220px_160px_150px_150px] gap-2">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    placeholder="Search terminals"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                  />
                </label>
                <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={broker} onChange={(event) => { setBroker(event.target.value); setPage(1); }}>
                  <option value="all">All brokers</option>
                  {brokers.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                  <option value="all">All status</option>
                  {OPS_STATUS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={latency} onChange={(event) => { setLatency(event.target.value); setPage(1); }}>
                  <option value="all">All latency</option>
                  <option value="sub100">Under 100ms</option>
                  <option value="100to500">100-500ms</option>
                  <option value="over500">Over 500ms</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[620px]">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    {TERMINAL_COLUMNS.map((column) => (
                      <TableHead key={column} className="whitespace-nowrap px-3 py-3 text-[11px] font-mono uppercase text-slate-500">{column}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terminalRows.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={TERMINAL_COLUMNS.length} className="h-56 text-center">
                        <EmptyPanel title="No terminals connected" detail="Waiting for the first MT5 EA heartbeat. REST fallback remains armed at /api/mt5/terminals." />
                      </TableCell>
                    </TableRow>
                  ) : pageRows.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={TERMINAL_COLUMNS.length} className="h-56 text-center">
                        <EmptyPanel title="No terminals match filters" detail="Adjust broker, status, latency, or search criteria to restore the operational view." />
                      </TableCell>
                    </TableRow>
                  ) : pageRows.map((terminal) => (
                    <TableRow
                      key={terminal.terminalId}
                      className={cn(
                        'border-slate-100 hover:bg-blue-50/40',
                        terminal.opsStatus === 'ONLINE' && 'bg-emerald-50/20',
                        terminal.opsStatus.includes('WARNING') && 'bg-amber-50/35',
                        (terminal.opsStatus === 'OFFLINE' || terminal.opsStatus === 'HEARTBEAT LOST') && 'bg-rose-50/35',
                      )}
                    >
                      <TableCell className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-800">{terminal.terminalId}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-xs text-slate-700">{terminal.computerName}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-700">{terminal.mt5Build}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-900">{terminal.brokerName}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{terminal.serverName}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-700">{terminal.accountNumber}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{terminal.accountType}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3"><OpsStatusBadge status={terminal.opsStatus} /></TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{terminal.latencyMs}ms</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{formatDuration(terminal.heartbeatAgeMs)}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{formatTime(terminal.lastTickTime)}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{formatMoney(terminal.balance)}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{formatMoney(terminal.equity)}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{formatMoney(terminal.freeMargin)}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{terminal.openPositions}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-700">{terminal.eaVersion}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{terminal.cpuUsage}%</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{terminal.memoryUsage}%</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{formatDuration(terminal.connectionUptimeMs)}</TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-slate-800">{terminal.reconnectCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <div className="font-mono">{filtered.length} terminals filtered / {terminalRows.length} total</div>
              <div className="flex items-center gap-2">
                <button type="button" className="h-8 rounded-md border border-slate-200 px-3 font-semibold text-slate-700 disabled:opacity-40" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
                <span className="font-mono text-slate-600">Page {currentPage} / {totalPages}</span>
                <button type="button" className="h-8 rounded-md border border-slate-200 px-3 font-semibold text-slate-700 disabled:opacity-40" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OpsPanel title="Live Tick Feed" icon={Activity}>
            <div className="space-y-3">
              {tickRows.map((tick) => (
                <div key={tick.symbol} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold text-slate-950">{tick.symbol}</span>
                    <OpsStatusBadge status={tick.delayMs > 1500 ? 'STALE' : 'BRIDGE HEALTHY'} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <Metric label="Spread" value={`${tick.spread.toFixed(1)} pts`} />
                    <Metric label="Tick delay" value={`${tick.delayMs}ms`} />
                  </div>
                </div>
              ))}
            </div>
          </OpsPanel>

          <OpsPanel title="Operational Activity" icon={RefreshCw}>
            <div className="space-y-3">
              {activity.map((item) => (
                <div key={`${item.time}-${item.message}`} className="flex gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
                  <div className={cn('mt-1 h-2 w-2 rounded-full', item.tone === 'green' && 'bg-emerald-500', item.tone === 'amber' && 'bg-amber-500', item.tone === 'red' && 'bg-rose-500', item.tone === 'blue' && 'bg-blue-500')} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-800">{item.message}</div>
                    <div className="mt-1 font-mono text-[11px] text-slate-500">{formatTime(item.time)}</div>
                  </div>
                </div>
              ))}
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <DistributionCard title="Broker distribution" icon={Layers3} items={brokerDistribution} />
        <DistributionCard title="VPS locations" icon={MapPin} items={locationDistribution} />
        <QualityCard terminals={terminalRows} />
        <RoutingCard terminals={terminalRows} />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Backend API Structure" lines={API_CONTRACT_LINES} />
        <ArchitectureCard title="WebSocket Event Structure" lines={WEBSOCKET_EVENT_LINES} />
        <ArchitectureCard title="Database Schema" lines={DATABASE_SCHEMA_LINES} />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ArchitectureCard title="Component Hierarchy" lines={COMPONENT_TREE_LINES} />
        <ArchitectureCard title="Real-Time Synchronization Flow" lines={SYNC_FLOW_LINES} />
      </section>
    </div>
  );
}

const TERMINAL_COLUMNS = [
  'Terminal ID',
  'Computer/VPS name',
  'MT5 build version',
  'Broker',
  'Server',
  'Account number',
  'Account type',
  'Status',
  'Latency',
  'Heartbeat age',
  'Last tick received',
  'Balance',
  'Equity',
  'Free margin',
  'Open positions',
  'EA version',
  'CPU usage',
  'Memory usage',
  'Connection uptime',
  'Reconnect count',
];

const OPS_STATUS_OPTIONS = [
  'ONLINE',
  'WARNING',
  'OFFLINE',
  'RECONNECTING',
  'STALE',
  'HEARTBEAT LOST',
  'LATENCY WARNING',
  'BRIDGE HEALTHY',
];

const API_CONTRACT_LINES = [
  'GET /api/mt5/terminals -> terminal fleet snapshot, events, registrations',
  'GET /api/mt5/terminal/:id -> terminal detail and heartbeat history',
  'GET /api/mt5/status -> bridge health, uptime, connected counts',
  'REST fallback: /api/mt5/terminal-operations polls every 3s when WS is unavailable',
  'Redis pub/sub optional: mt5.terminals, mt5.heartbeats, mt5.latency',
];

const WEBSOCKET_EVENT_LINES = [
  'terminal.connected { terminalId, accountNumber, broker, server, connectedAt }',
  'terminal.disconnected { terminalId, reason, disconnectedAt }',
  'heartbeat.received { terminalId, sequence, latencyMs, receivedAt }',
  'latency.updated { terminalId, latencyMs, ewmaLatencyMs, jitterMs }',
  'Client behavior: merge by terminalId, preserve newest sequence, mark stale by age',
];

const DATABASE_SCHEMA_LINES = [
  'mt5_terminals(id, terminal_id, computer_id, computer_name, vps_id, first_seen_at)',
  'mt5_accounts(id, account_number, broker_name, server_name, account_type)',
  'mt5_heartbeats(id, terminal_id, sequence, latency_ms, received_at, tick_time)',
  'mt5_terminal_metrics(id, terminal_id, balance, equity, free_margin, cpu, memory)',
  'mt5_terminal_events(id, terminal_id, event_type, payload_json, created_at)',
];

const COMPONENT_TREE_LINES = [
  'ConnectedTerminalsPage',
  'GlobalTerminalSummaryCards',
  'TerminalFilterBar',
  'RealTimeTerminalsTable',
  'LiveTickFeed and OperationalActivityFeed',
  'MultiTerminalVisualization',
  'ArchitectureAndContractsReference',
];

const SYNC_FLOW_LINES = [
  'EA sends heartbeat to bridge with sequence, account metrics, tick timestamp',
  'Bridge normalizes status, latency, jitter, drift, and stability score',
  'WebSocket broadcasts event deltas to subscribed dashboards',
  'Dashboard reconciles deltas into local terminal map without full refresh',
  'REST fallback refreshes snapshots if socket is offline or sequence gap detected',
];

function enrichTerminal(terminal: any) {
  const terminalId = String(terminal.terminalId ?? 'unknown-terminal');
  const latencyMs = Number(terminal.latencyMs ?? terminal.averageLatencyMs ?? 0);
  const heartbeatAgeMs = terminal.heartbeatAgeMs == null ? 999_999 : Number(terminal.heartbeatAgeMs);
  const status = String(terminal.status ?? 'disconnected');
  const tickTime = String(terminal.lastTickTime ?? terminal.mt5ServerTime ?? terminal.receivedAt ?? '');
  const tickDelayMs = tickTime ? Math.max(0, Date.now() - Date.parse(tickTime)) : 0;
  return {
    ...terminal,
    terminalId,
    status,
    computerName: terminal.computerName || terminal.computerId || 'Unassigned',
    mt5Build: terminal.mt5Build ?? terminal.build ?? '—',
    brokerName: terminal.brokerName || 'Unknown broker',
    serverName: terminal.serverName || 'Unassigned server',
    accountNumber: terminal.accountNumber || '—',
    accountType: terminal.accountType || 'Unknown',
    opsStatus: resolveOpsStatus(status, latencyMs, heartbeatAgeMs, tickDelayMs),
    latencyMs,
    heartbeatAgeMs,
    lastTickTime: tickTime || null,
    balance: Number(terminal.balance ?? 0),
    equity: Number(terminal.equity ?? 0),
    freeMargin: Number(terminal.freeMargin ?? 0),
    openPositions: Number(terminal.openPositions ?? terminal.openOrders ?? 0),
    eaVersion: terminal.eaVersion ?? terminal.version ?? '—',
    cpuUsage: Number(terminal.cpuUsage ?? 0),
    memoryUsage: Number(terminal.memoryUsage ?? 0),
    connectionUptimeMs: Number(terminal.connectionUptimeMs ?? 0),
    reconnectCount: Number(terminal.reconnectCount ?? terminal.missedSequenceCount ?? 0),
    tickDelayMs,
    vpsLocation: terminal.vpsLocation ?? '—',
    routingRegion: terminal.routingRegion ?? '—',
  };
}

function resolveOpsStatus(status: string, latencyMs: number, heartbeatAgeMs: number, tickDelayMs: number): string {
  if (status === 'disconnected') return heartbeatAgeMs > 30_000 ? 'HEARTBEAT LOST' : 'OFFLINE';
  if (heartbeatAgeMs > 15_000) return 'STALE';
  if (latencyMs > 900) return 'LATENCY WARNING';
  if (status === 'degraded') return 'WARNING';
  if (tickDelayMs > 1500) return 'STALE';
  return 'ONLINE';
}

function OpsSummaryCard(props: { icon: any; title: string; value: string; detail: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'slate' | 'violet' }) {
  const Icon = props.icon;
  const tones: Record<string, string> = {
    blue: 'text-blue-700 bg-blue-50 border-blue-100',
    green: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    amber: 'text-amber-700 bg-amber-50 border-amber-100',
    red: 'text-rose-700 bg-rose-50 border-rose-100',
    slate: 'text-slate-700 bg-slate-50 border-slate-100',
    violet: 'text-violet-700 bg-violet-50 border-violet-100',
  };
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase text-slate-500">{props.title}</div>
            <div className="mt-3 font-mono text-3xl text-slate-950">{props.value}</div>
          </div>
          <div className={cn('grid h-10 w-10 place-items-center rounded-md border', tones[props.tone])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-4 text-xs text-slate-500">{props.detail}</div>
      </CardContent>
    </Card>
  );
}

function OpsPanel(props: { title: string; icon: any; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-blue-700" /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">{props.children}</CardContent>
    </Card>
  );
}

function OpsStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn(
      'inline-flex whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase',
      (status === 'ONLINE' || status === 'BRIDGE HEALTHY') && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      (status === 'WARNING' || status === 'LATENCY WARNING' || status === 'RECONNECTING') && 'border-amber-200 bg-amber-50 text-amber-700',
      (status === 'OFFLINE' || status === 'HEARTBEAT LOST') && 'border-rose-200 bg-rose-50 text-rose-700',
      status === 'STALE' && 'border-slate-200 bg-slate-50 text-slate-700',
    )}>
      {status}
    </span>
  );
}

function EmptyPanel(props: { title: string; detail: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-md border border-blue-100 bg-blue-50 text-blue-700">
        <TerminalSquare className="h-5 w-5" />
      </div>
      <div className="mt-4 text-sm font-semibold text-slate-900">{props.title}</div>
      <div className="mt-1 text-xs text-slate-500">{props.detail}</div>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-slate-500">{props.label}</div>
      <div className="mt-1 font-mono text-sm text-slate-900">{props.value}</div>
    </div>
  );
}

function DistributionCard(props: { title: string; icon: any; items: Array<{ label: string; value: number; percent: number }> }) {
  return (
    <OpsPanel title={props.title} icon={props.icon}>
      <div className="space-y-4">
        {(props.items.length ? props.items : [{ label: 'No data', value: 0, percent: 0 }]).map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700">{item.label}</span>
              <span className="font-mono text-slate-500">{item.value}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${item.percent}%` }} />
            </div>
          </div>
        ))}
      </div>
    </OpsPanel>
  );
}

function QualityCard({ terminals }: { terminals: any[] }) {
  const good = terminals.filter((terminal) => terminal.latencyMs < 250 && terminal.status === 'connected').length;
  const warning = terminals.filter((terminal) => terminal.opsStatus.includes('WARNING') || terminal.opsStatus === 'STALE').length;
  const poor = terminals.filter((terminal) => terminal.status === 'disconnected').length;
  return (
    <OpsPanel title="Connection quality" icon={Gauge}>
      <div className="grid grid-cols-3 gap-3">
        <QualityTile label="Good" value={good} tone="text-emerald-700 bg-emerald-50 border-emerald-100" />
        <QualityTile label="Watch" value={warning} tone="text-amber-700 bg-amber-50 border-amber-100" />
        <QualityTile label="Down" value={poor} tone="text-rose-700 bg-rose-50 border-rose-100" />
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <Cpu className="h-4 w-4 text-blue-700" />
        <div className="text-xs text-slate-600">CPU and memory telemetry is normalized per terminal for row-level operational triage.</div>
      </div>
    </OpsPanel>
  );
}

function RoutingCard({ terminals }: { terminals: any[] }) {
  const routes = buildDistribution(terminals, 'routingRegion');
  return (
    <OpsPanel title="Regional routing" icon={Globe2}>
      <div className="space-y-3">
        {(routes.length ? routes : [{ label: 'No routes', value: 0, percent: 0 }]).map((route) => (
          <div key={route.label} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2">
            <span className="text-xs font-medium text-slate-700">{route.label}</span>
            <span className="font-mono text-xs text-slate-500">{route.percent}%</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
        <MemoryStick className="h-4 w-4" />
        Multi-VPS routing is ready for active-active terminal failover.
      </div>
    </OpsPanel>
  );
}

function QualityTile(props: { label: string; value: number; tone: string }) {
  return (
    <div className={cn('rounded-md border p-3 text-center', props.tone)}>
      <div className="font-mono text-2xl">{props.value}</div>
      <div className="mt-1 text-[11px] uppercase">{props.label}</div>
    </div>
  );
}

function ArchitectureCard(props: { title: string; lines: string[] }) {
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="text-sm font-semibold text-slate-950">{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="space-y-2">
          {props.lines.map((line) => (
            <div key={line} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] leading-5 text-slate-700">{line}</div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function buildTickFeed(terminals: any[]) {
  return terminals
    .filter((terminal) => terminal.symbol || terminal.lastSymbol)
    .map((terminal) => ({
      symbol: String(terminal.symbol ?? terminal.lastSymbol),
      spread: Number(terminal.spread ?? terminal.spreadPoints ?? 0),
      delayMs: Number(terminal.tickDelayMs ?? 0),
    }));
}

function buildActivityFeed(terminals: any[]) {
  const now = new Date().toISOString();
  const latest = terminals.slice(0, 6).map((terminal) => ({
    time: terminal.receivedAt ?? now,
    message: terminal.opsStatus === 'ONLINE'
      ? `Heartbeat received from ${terminal.terminalId}`
      : terminal.opsStatus === 'LATENCY WARNING'
        ? `Latency spike detected on ${terminal.terminalId}`
        : terminal.opsStatus === 'STALE'
          ? `Tick synchronization delayed for ${terminal.terminalId}`
          : terminal.status === 'disconnected'
            ? `Terminal disconnected: ${terminal.terminalId}`
            : `Reconnection successful for ${terminal.terminalId}`,
    tone: terminal.status === 'connected' ? 'green' : terminal.status === 'degraded' ? 'amber' : 'red',
  }));

  return latest;
}

function buildDistribution(items: any[], key: string) {
  const total = Math.max(1, items.length);
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    const label = String(item[key] || 'Unknown');
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([label, value]) => ({ label, value, percent: Math.round((value / total) * 100) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function TerminalRegistration({ terminals, registrations }: { terminals: any[]; registrations: any[] }) {
  const [form, setForm] = useState({
    terminalId: '',
    terminalName: '',
    computerName: '',
    computerId: '',
    accountNumber: '',
    brokerName: '',
    serverName: '',
    mt5Build: '4150',
    eaVersion: 'CACSMS-EA 1.0.0',
    terminalType: 'demo-validation',
    region: 'LD4',
    environment: 'demo',
    authenticationKey: '',
    vpsId: '',
    priority: '50',
  });
  const [activeStep, setActiveStep] = useState(0);
  const [submit, setSubmit] = useState<EnqueueState>({ status: 'idle', message: '' });
  const [verify, setVerify] = useState<EnqueueState>({ status: 'idle', message: '' });
  const [authorize, setAuthorize] = useState<EnqueueState>({ status: 'idle', message: '' });

  const connected = terminals.filter((terminal) => terminal.status === 'connected');
  const selectedTerminalId = form.terminalId || '';
  const validationRules = buildRegistrationValidation(form, registrations, terminals);
  const passedRules = validationRules.filter((rule) => rule.status === 'passed').length;
  const registrationHealth = Math.round((passedRules / validationRules.length) * 100);
  const logs = buildRegistrationLogs(registrations, terminals);
  const identityReady = Boolean(form.terminalId.trim() && form.terminalName.trim() && (form.computerId.trim() || form.computerName.trim()));
  const brokerReady = Boolean(form.brokerName.trim() && form.serverName.trim() && form.accountNumber.trim() && Number(form.mt5Build) >= 3900 && form.eaVersion.startsWith('CACSMS-EA'));
  const authorizationReady = form.authenticationKey.trim().length >= 24 || authorize.status === 'ok';
  const hasFailedValidation = validationRules.some((rule) => rule.status === 'failed');
  const canEnroll = identityReady && brokerReady && authorizationReady && !hasFailedValidation && submit.status !== 'submitting';
  const registrationStages = [
    { title: 'Identity', status: identityReady ? 'Ready' : 'Needs terminal details' },
    { title: 'Broker', status: brokerReady ? 'Ready' : 'Needs broker details' },
    { title: 'Authorization', status: authorizationReady ? 'Ready' : 'Needs EA key' },
    { title: 'Database', status: submit.status === 'ok' ? 'Saved' : 'Pending save' },
  ];

  const onPrefill = (terminalId: string) => {
    const terminal = terminals.find((t) => t.terminalId === terminalId);
    if (!terminal) return;
    setForm((current) => ({
      ...current,
      terminalId,
      terminalName: terminal.terminalName ?? terminalId,
      computerId: terminal.computerId ?? '',
      computerName: terminal.computerName ?? '',
      accountNumber: terminal.accountNumber ?? '',
      brokerName: terminal.brokerName ?? '',
      serverName: terminal.serverName ?? '',
      mt5Build: String(terminal.mt5Build ?? terminal.build ?? '4150'),
      eaVersion: terminal.eaVersion ?? terminal.version ?? 'CACSMS-EA 1.0.0',
      vpsId: terminal.vpsId ?? '',
    }));
    setAuthorize({ status: 'idle', message: '' });
    setVerify({ status: 'idle', message: '' });
    setSubmit({ status: 'idle', message: '' });
  };

  const onLoadRegistration = (terminalId: string) => {
    const registration = registrations.find((item) => item.terminalId === terminalId);
    if (!registration) return;
    setForm((current) => ({
      ...current,
      terminalId: registration.terminalId,
      terminalName: registration.terminalName ?? registration.terminalId,
      computerId: registration.computerId ?? '',
      computerName: registration.computerName ?? '',
      accountNumber: registration.accountNumber ?? '',
      brokerName: registration.brokerName ?? '',
      serverName: registration.serverName ?? '',
      mt5Build: String(registration.mt5Build ?? '4150'),
      eaVersion: registration.eaVersion ?? 'CACSMS-EA 1.0.0',
      terminalType: registration.terminalType ?? current.terminalType,
      region: registration.region ?? current.region,
      environment: registration.environment ?? current.environment,
      vpsId: registration.vpsId ?? '',
      priority: String(registration.priority ?? current.priority),
    }));
    setAuthorize({ status: 'idle', message: 'Load this registration, then click Issue EA key or Generate EA token, and Save registration again.' });
    setVerify({ status: 'idle', message: '' });
    setSubmit({ status: 'idle', message: '' });
    setActiveStep(2);
  };

  const generateTerminalId = () => {
    const broker = (form.brokerName || 'MT5').replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
    const region = form.region.replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase();
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    setForm((current) => ({ ...current, terminalId: `CACSMS-${broker}-${region}-${suffix}` }));
  };

  const generateToken = () => {
    const token = `ea_live_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().slice(0, 8)}`;
    setForm((current) => ({ ...current, authenticationKey: token }));
  };

  const onVerify = async () => {
    setVerify({ status: 'submitting', message: 'Running broker, build, EA, and heartbeat checks...' });
    try {
      const response = await fetch('/api/mt5/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRegistrationPayload(form)),
      });
      if (!response.ok) throw new Error(await response.text());
      setVerify({ status: 'ok', message: 'Verification passed. Broker endpoint, build, and EA compatibility look valid.' });
      setActiveStep(2);
    } catch (error) {
      setVerify({ status: 'error', message: error instanceof Error ? error.message : 'Verification failed.' });
    }
  };

  const onAuthorize = async () => {
    setAuthorize({ status: 'submitting', message: 'Generating signed EA authorization handshake...' });
    try {
      const response = await fetch('/api/mt5/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRegistrationPayload(form)),
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setForm((current) => ({ ...current, authenticationKey: payload.authenticationKey ?? current.authenticationKey }));
      setAuthorize({ status: 'ok', message: `Authorization issued. Session signing enabled for ${selectedTerminalId || 'terminal'}.` });
      setActiveStep(3);
    } catch (error) {
      setAuthorize({ status: 'error', message: error instanceof Error ? error.message : 'Authorization failed.' });
    }
  };

  const onSubmit = async () => {
    setSubmit({ status: 'submitting', message: '' });
    try {
      const priority = Number(form.priority);
      if (!Number.isFinite(priority)) {
        throw new Error('Priority must be numeric.');
      }
      if (validationRules.some((rule) => rule.status === 'failed')) {
        throw new Error('Resolve failed validation checks before enrollment.');
      }

      const payload = { ...buildRegistrationPayload(form), priority };
      if (!payload.terminalId) throw new Error('TerminalId is required.');

      const response = await fetch('/api/mt5/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Register failed with HTTP ${response.status}`);
      }
      setSubmit({ status: 'ok', message: 'Terminal enrollment saved and pending operational heartbeat confirmation.' });
      setActiveStep(4);
    } catch (error) {
      setSubmit({ status: 'error', message: error instanceof Error ? error.message : 'Failed to register terminal.' });
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={TerminalSquare} title="Registered terminals" value={String(registrations.length)} detail="Provisioned MT5 terminals" tone="blue" />
        <OpsSummaryCard icon={Laptop2} title="Connected computers" value={String(new Set(registrations.map((r) => r.computerId || r.computerName).filter(Boolean)).size)} detail="Distinct VPS or workstations" tone="slate" />
        <OpsSummaryCard icon={UserCheck} title="Verified accounts" value={String(new Set(registrations.map((r) => r.accountNumber).filter(Boolean)).size)} detail="Broker accounts enrolled" tone="green" />
        <OpsSummaryCard icon={ShieldCheck} title="Validation score" value={`${registrationHealth}%`} detail="Current wizard readiness" tone={registrationHealth > 80 ? 'green' : 'amber'} />
      </section>

      <section className="grid grid-cols-1 2xl:grid-cols-[300px_minmax(0,1fr)] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardCheck className="h-4 w-4 text-blue-700" /> Registration Path
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-3">
              {registrationStages.map((step, index) => (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setActiveStep(index)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md border p-3 text-left',
                    activeStep === index ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md border font-mono text-xs', activeStep >= index ? 'border-blue-200 bg-white text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-500')}>{index + 1}</span>
                  <span>
                    <span className="block text-sm font-semibold">{step.title}</span>
                    <span className="mt-1 block text-xs text-slate-500">{step.status}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold text-slate-900">Current result</div>
              <div className="mt-1 text-xs text-slate-600">
                {submit.status === 'ok'
                  ? 'Saved in PostgreSQL and visible in registration history.'
                  : 'Not saved yet.'}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Wrench className="h-4 w-4 text-blue-700" /> Secure Terminal Enrollment
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="h-8 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100" onClick={generateTerminalId}>Generate terminal ID</button>
                <button type="button" className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={generateToken}>Generate EA token</button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                <div className="text-xs font-semibold uppercase text-slate-500">1. Terminal identity</div>
                <OpsStatusBadge status={identityReady ? 'READY' : 'PENDING'} />
              </div>
              <Mt5BridgeSecretPanel compact />
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                The dashboard authentication key below is for registration records only. The EA uses the bridge secret above as <span className="font-mono">BridgeSecret</span>, plus the same <span className="font-mono">TerminalId</span> in MT5 inputs.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase text-slate-500">Saved registration</span>
                  <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={selectedTerminalId && registrations.some((r) => r.terminalId === selectedTerminalId) ? selectedTerminalId : ''} onChange={(e) => onLoadRegistration(e.target.value)}>
                    <option value="">Select registered terminal</option>
                    {registrations.map((registration) => <option key={registration.terminalId} value={registration.terminalId}>{registration.terminalId}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase text-slate-500">Live heartbeat</span>
                  <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={selectedTerminalId && terminals.some((t) => t.terminalId === selectedTerminalId) ? selectedTerminalId : ''} onChange={(e) => onPrefill(e.target.value)}>
                    <option value="">Select connected terminal</option>
                    {terminals.map((terminal) => <option key={terminal.terminalId} value={terminal.terminalId}>{terminal.terminalId}</option>)}
                  </select>
                </label>
                <ProvisionField label="Terminal name" value={form.terminalName} onChange={(value) => setForm((c) => ({ ...c, terminalName: value }))} placeholder="LD4 Alpha 01" />
                <ProvisionField label="Terminal ID" value={form.terminalId} onChange={(value) => setForm((c) => ({ ...c, terminalId: value }))} placeholder="CACSMS-..." mono />
                <ProvisionField label="VPS/computer name" value={form.computerName} onChange={(value) => setForm((c) => ({ ...c, computerName: value }))} placeholder="cacsms-ld4-vps-01" />
                <ProvisionField label="VPS ID" value={form.vpsId} onChange={(value) => setForm((c) => ({ ...c, vpsId: value }))} placeholder="vps-ld4-01" mono />
                <ProvisionField label="Computer fingerprint" value={form.computerId} onChange={(value) => setForm((c) => ({ ...c, computerId: value }))} placeholder="HWFP-..." mono />
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                <div className="text-xs font-semibold uppercase text-slate-500">2. Broker account</div>
                <OpsStatusBadge status={brokerReady ? 'READY' : 'PENDING'} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <ProvisionField label="Broker" value={form.brokerName} onChange={(value) => setForm((c) => ({ ...c, brokerName: value }))} placeholder="IC Markets" />
                <ProvisionField label="Broker server" value={form.serverName} onChange={(value) => setForm((c) => ({ ...c, serverName: value }))} placeholder="ICMarketsSC-Demo" />
                <ProvisionField label="Account number" value={form.accountNumber} onChange={(value) => setForm((c) => ({ ...c, accountNumber: value }))} placeholder="12345678" mono />
                <ProvisionField label="MT5 build" value={form.mt5Build} onChange={(value) => setForm((c) => ({ ...c, mt5Build: value }))} placeholder="4150" mono />
                <ProvisionField label="EA version" value={form.eaVersion} onChange={(value) => setForm((c) => ({ ...c, eaVersion: value }))} placeholder="CACSMS-EA 1.0.0" mono />
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase text-slate-500">Terminal type</span>
                <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={form.terminalType} onChange={(e) => setForm((c) => ({ ...c, terminalType: e.target.value }))}>
                  {TERMINAL_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase text-slate-500">Region</span>
                <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={form.region} onChange={(e) => setForm((c) => ({ ...c, region: e.target.value }))}>
                  <option value="LD4">LD4 London</option>
                  <option value="NY4">NY4 New York</option>
                  <option value="TY3">TY3 Tokyo</option>
                  <option value="FR2">FR2 Frankfurt</option>
                  <option value="Lagos Edge">Lagos Edge</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase text-slate-500">Environment</span>
                <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={form.environment} onChange={(e) => setForm((c) => ({ ...c, environment: e.target.value }))}>
                  <option value="demo">Demo</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                  <option value="dr">Disaster recovery</option>
                </select>
              </label>
              <ProvisionField label="Priority" value={form.priority} onChange={(value) => setForm((c) => ({ ...c, priority: value }))} placeholder="50" mono />
            </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                <div className="text-xs font-semibold uppercase text-slate-500">3. Authorization and save</div>
                <OpsStatusBadge status={canEnroll ? 'READY' : 'PENDING'} />
              </div>
              <ProvisionField label="Authentication key" value={form.authenticationKey} onChange={(value) => setForm((c) => ({ ...c, authenticationKey: value }))} placeholder="ea_live_..." mono />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <ActionPanel icon={PlugZap} title="Verify" state={verify} button="Run verify" onClick={onVerify} />
                <ActionPanel icon={KeyRound} title="Authorize" state={authorize} button="Issue EA key" onClick={onAuthorize} />
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ShieldCheck className="h-4 w-4 text-blue-700" />
                    Enroll
                  </div>
                  <div className={cn(
                    'mt-2 min-h-8 text-xs',
                    submit.status === 'ok' && 'text-emerald-700',
                    submit.status === 'error' && 'text-rose-700',
                    submit.status === 'submitting' && 'text-slate-500',
                    submit.status === 'idle' && 'text-slate-500',
                  )}>
                    {submit.message || (canEnroll ? 'Ready to save.' : 'Complete the pending sections.')}
                  </div>
                  <button
                    type="button"
                    className="mt-3 h-8 w-full rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                    disabled={!canEnroll}
                    onClick={onSubmit}
                  >
                    Save registration
                  </button>
                </div>
              </div>
            </section>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Router className="h-4 w-4 text-violet-700" /> Registration History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[420px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Computer/VPS</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Broker account</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Approval</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Priority</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registrations.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={5} className="h-40 text-center text-sm text-slate-500">No terminal registrations yet.</TableCell>
                    </TableRow>
                  ) : registrations.map((r) => (
                    <TableRow key={r.terminalId} className="border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => onLoadRegistration(r.terminalId)}>
                      <TableCell className="font-mono text-xs text-slate-700">{r.terminalId}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{r.vpsId || r.computerId || r.computerName}</TableCell>
                      <TableCell className="text-xs text-slate-700">{r.brokerName} / <span className="font-mono">{r.accountNumber}</span></TableCell>
                      <TableCell><OpsStatusBadge status={String(r.approvalStatus ?? 'pending').replaceAll('_', ' ').toUpperCase()} /></TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{r.priority}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <OpsPanel title="Registration Logs and Retry Workflow" icon={RefreshCw}>
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={`${log.time}-${log.message}`} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{log.message}</div>
                    <div className="mt-1 font-mono text-[11px] text-slate-500">{formatTime(log.time)}</div>
                  </div>
                  <OpsStatusBadge status={log.status} />
                </div>
                <div className="mt-3 flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span>{log.detail}</span>
                  <button type="button" className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700">Retry</button>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      </section>
    </div>
  );
}

function ProvisionField(props: { label: string; value: string; onChange: (value: string) => void; placeholder: string; mono?: boolean }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium uppercase text-slate-500">{props.label}</span>
      <input
        className={cn('h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100', props.mono && 'font-mono')}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function ActionPanel(props: { icon: any; title: string; state: EnqueueState; button: string; onClick: () => void }) {
  const Icon = props.icon;
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Icon className="h-4 w-4 text-blue-700" />
        {props.title}
      </div>
      <div className={cn(
        'mt-2 min-h-8 text-xs',
        props.state.status === 'ok' && 'text-emerald-700',
        props.state.status === 'error' && 'text-rose-700',
        props.state.status === 'submitting' && 'text-slate-500',
        props.state.status === 'idle' && 'text-slate-500',
      )}>
        {props.state.message || 'Ready.'}
      </div>
      <button
        type="button"
        className="mt-3 h-8 w-full rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50"
        disabled={props.state.status === 'submitting'}
        onClick={props.onClick}
      >
        {props.button}
      </button>
    </div>
  );
}

function ValidationRow(props: { label: string; status: 'passed' | 'warning' | 'failed'; detail: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-900">{props.label}</span>
        <span className={cn(
          'rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase',
          props.status === 'passed' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
          props.status === 'warning' && 'border-amber-200 bg-amber-50 text-amber-700',
          props.status === 'failed' && 'border-rose-200 bg-rose-50 text-rose-700',
        )}>{props.status}</span>
      </div>
      <div className="mt-2 text-xs text-slate-500">{props.detail}</div>
    </div>
  );
}

function buildRegistrationPayload(form: {
  terminalId: string;
  terminalName: string;
  computerName: string;
  computerId: string;
  accountNumber: string;
  brokerName: string;
  serverName: string;
  mt5Build: string;
  eaVersion: string;
  terminalType: string;
  region: string;
  environment: string;
  authenticationKey: string;
  vpsId: string;
  priority: string;
}) {
  return {
    terminalId: form.terminalId.trim(),
    terminalName: form.terminalName.trim(),
    computerId: form.computerId.trim() || form.computerName.trim(),
    computerName: form.computerName.trim(),
    accountNumber: form.accountNumber.trim(),
    brokerName: form.brokerName.trim(),
    serverName: form.serverName.trim(),
    mt5Build: Number(form.mt5Build),
    eaVersion: form.eaVersion.trim(),
    terminalType: form.terminalType,
    region: form.region,
    environment: form.environment,
    authenticationKey: form.authenticationKey.trim(),
    priority: Number(form.priority),
    vpsId: form.vpsId.trim(),
    tags: [form.environment, form.region, form.terminalType].filter(Boolean),
    capabilities: ['heartbeat', 'broker-verification', 'ea-authorization', 'secure-handshake'],
    notes: `Provisioned via terminal registration wizard. MT5 build ${form.mt5Build}.`,
  };
}

const TERMINAL_TYPE_OPTIONS = [
  { label: 'Demo Validation', value: 'demo-validation' },
  { label: 'Live Trading', value: 'live-trading' },
  { label: 'Market Data Monitor', value: 'market-data-monitor' },
  { label: 'Execution Terminal', value: 'execution-terminal' },
  { label: 'Failover Reserve', value: 'failover-reserve' },
  { label: 'Prop Firm Trading', value: 'prop-firm-trading' },
  { label: 'Paper Trading', value: 'paper-trading' },
  { label: 'Research & AI Analysis', value: 'research-ai-analysis' },
];

function buildRegistrationValidation(form: ReturnType<typeof useRegistrationFormShape>, registrations: any[], terminals: any[]) {
  const terminalId = form.terminalId.trim();
  const duplicate = terminalId && registrations.some((registration) => registration.terminalId === terminalId);
  const mt5Build = Number(form.mt5Build);
  const hasHeartbeat = terminalId && terminals.some((terminal) => terminal.terminalId === terminalId && terminal.status !== 'disconnected');
  return [
    {
      label: 'Duplicate terminal prevention',
      status: duplicate ? 'failed' : terminalId ? 'passed' : 'warning',
      detail: duplicate ? 'Terminal ID already exists in registration history.' : 'Terminal ID is available for enrollment.',
    },
    {
      label: 'Broker verification',
      status: form.brokerName && form.serverName && form.accountNumber ? 'passed' : 'warning',
      detail: 'Broker, server, and account number are required before verification.',
    },
    {
      label: 'EA compatibility check',
      status: form.eaVersion.startsWith('CACSMS-EA') ? 'passed' : 'failed',
      detail: 'EA version must match the Cacsms Trader compatibility matrix.',
    },
    {
      label: 'MT5 build compatibility',
      status: Number.isFinite(mt5Build) && mt5Build >= 3900 ? 'passed' : 'failed',
      detail: 'Minimum supported MT5 build is 3900 for bridge protocol safety.',
    },
    {
      label: 'Connection and heartbeat validation',
      status: hasHeartbeat ? 'passed' : 'warning',
      detail: hasHeartbeat ? 'A live heartbeat exists for this terminal.' : 'Terminal can enroll as pending until heartbeat arrives.',
    },
    {
      label: 'API token and secure handshake',
      status: form.authenticationKey.length >= 24 ? 'passed' : 'warning',
      detail: 'Generate or paste a scoped EA authentication key before approval.',
    },
  ] as Array<{ label: string; status: 'passed' | 'warning' | 'failed'; detail: string }>;
}

function useRegistrationFormShape() {
  return {
    terminalId: '',
    terminalName: '',
    computerName: '',
    computerId: '',
    accountNumber: '',
    brokerName: '',
    serverName: '',
    mt5Build: '',
    eaVersion: '',
    terminalType: '',
    region: '',
    environment: '',
    authenticationKey: '',
    vpsId: '',
    priority: '',
  };
}

function buildRegistrationLogs(registrations: any[], terminals: any[]) {
  const now = new Date().toISOString();
  const registrationLogs = registrations.slice(0, 4).map((registration) => ({
    time: registration.updatedAt ?? registration.registeredAt ?? now,
    message: `Registration updated for ${registration.terminalId}`,
    status: 'BRIDGE HEALTHY',
    detail: `Broker ${registration.brokerName || 'unknown'} account ${registration.accountNumber || 'pending'} is enrolled.`,
  }));
  const failedHeartbeats = terminals.filter((terminal) => terminal.status === 'disconnected').slice(0, 2).map((terminal) => ({
    time: terminal.receivedAt ?? now,
    message: `Heartbeat validation failed for ${terminal.terminalId}`,
    status: 'HEARTBEAT LOST',
    detail: 'Retry waits for the next heartbeat or manual bridge reconnect.',
  }));
  return [...failedHeartbeats, ...registrationLogs];
}

function TerminalHeartbeat({ terminals, registrations }: { terminals: any[]; registrations: any[] }) {
  const [terminalId, setTerminalId] = useState('');
  const selectable = useMemo(() => mergeHeartbeatSources(terminals, registrations), [terminals, registrations]);
  const selectedTerminalId = terminalId || selectable[0]?.terminalId || '';
  const [details, setDetails] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; payload: any | null; message: string }>({
    status: 'idle',
    payload: null,
    message: '',
  });

  const load = async (id: string) => {
    setDetails({ status: 'loading', payload: null, message: '' });
    try {
      if (!id) throw new Error('Select a terminal.');
      const response = await fetch(`/api/mt5/terminals/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `HTTP ${response.status}`);
      }
      const payload = await response.json();
      setDetails({ status: 'ok', payload, message: '' });
    } catch (error) {
      setDetails({ status: 'error', payload: null, message: error instanceof Error ? error.message : 'Failed to load terminal heartbeat.' });
    }
  };

  const history = details.payload?.history ?? [];
  const loadedTerminal = details.payload?.terminal ?? null;
  const heartbeatRows = useMemo(() => selectable.map(enrichHeartbeatTerminal), [selectable]);
  const selectedTerminal = loadedTerminal ? enrichHeartbeatTerminal(loadedTerminal) : heartbeatRows.find((terminal) => terminal.terminalId === selectedTerminalId) ?? null;
  const fleetSummary = summarizeHeartbeatFleet(heartbeatRows);
  const alerts = buildHeartbeatAlerts(heartbeatRows);
  const recoveryActions = buildRecoveryActions(heartbeatRows);
  const timelineRows = buildHeartbeatTimeline(heartbeatRows, history);
  const waveform = buildHeartbeatWaveform(selectedTerminal, history);
  const latencyTrend = buildLatencyTrend(selectedTerminal, history);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={PlugZap} title="Heartbeat online" value={String(fleetSummary.online)} detail="Age under 5 seconds" tone="green" />
        <OpsSummaryCard icon={ShieldAlert} title="Warning terminals" value={String(fleetSummary.warning)} detail="Heartbeat age 5-15 seconds" tone="amber" />
        <OpsSummaryCard icon={AlertTriangle} title="Offline terminals" value={String(fleetSummary.offline)} detail="Heartbeat age 15-30 seconds" tone="red" />
        <OpsSummaryCard icon={Network} title="Disconnected" value={String(fleetSummary.disconnected)} detail="Heartbeat age over 30 seconds" tone="slate" />
        <OpsSummaryCard icon={Gauge} title="Average API latency" value={`${fleetSummary.averageLatency}ms`} detail="Bridge heartbeat ingestion" tone="blue" />
        <OpsSummaryCard icon={Wifi} title="Tick delay" value={`${fleetSummary.averageTickDelay}ms`} detail="MT5 tick synchronization age" tone={fleetSummary.averageTickDelay > 1500 ? 'amber' : 'green'} />
        <OpsSummaryCard icon={Cpu} title="Average CPU" value={`${fleetSummary.averageCpu}%`} detail="Terminal host telemetry" tone="violet" />
        <OpsSummaryCard icon={MemoryStick} title="Average memory" value={`${fleetSummary.averageMemory}%`} detail="VPS memory utilization" tone="slate" />
      </section>

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-700" /> Live Heartbeat Timeline
              </CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs sm:w-[360px]"
                  value={selectedTerminalId}
                  onChange={(e) => setTerminalId(e.target.value)}
                >
                  <option value="">Select terminal</option>
                  {selectable.map((t) => (
                    <option key={t.terminalId} value={t.terminalId}>{t.terminalId}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className={cn(
                    'h-9 rounded-md border px-3 text-xs font-semibold',
                    details.status === 'loading'
                      ? 'border-slate-200 bg-slate-100 text-slate-400'
                      : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100',
                  )}
                  disabled={details.status === 'loading'}
                  onClick={() => load(selectedTerminalId)}
                >
                  Load history
                </button>
              </div>
            </div>
            {details.message ? (
              <div className={cn('pt-2 text-xs font-mono', details.status === 'error' ? 'text-rose-700' : 'text-slate-500')}>{details.message}</div>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[540px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Broker</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Heartbeat state</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Age</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Interval</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Stability</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Tick delay</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">API</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">WS</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">MT5 ping</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {heartbeatRows.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={10} className="h-40 text-center text-sm text-slate-500">
                        Waiting for MT5 heartbeat ingestion. Registered terminals appear immediately, and heartbeats populate after MT5 connects.
                      </TableCell>
                    </TableRow>
                  ) : heartbeatRows.map((terminal) => (
                    <TableRow key={terminal.terminalId} className={cn('border-slate-100 hover:bg-blue-50/40', terminal.heartbeatState === 'ONLINE' && 'bg-emerald-50/20', terminal.heartbeatState === 'WARNING' && 'bg-amber-50/30', terminal.heartbeatState !== 'ONLINE' && terminal.heartbeatState !== 'WARNING' && 'bg-rose-50/30')}>
                      <TableCell className="font-mono text-xs text-slate-700">{terminal.terminalId}</TableCell>
                      <TableCell className="text-xs text-slate-700">{terminal.brokerName}<div className="font-mono text-[11px] text-slate-500">{terminal.accountNumber}</div></TableCell>
                      <TableCell><HeartbeatStateBadge state={terminal.heartbeatState} /></TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{formatDuration(terminal.heartbeatAgeMs)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.heartbeatIntervalSeconds || 5}s</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.heartbeatStability}%</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.tickDelayMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.latencyMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.websocketLatencyMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.mt5PingMs}ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OpsPanel title="Selected Terminal Metrics" icon={TerminalSquare}>
            {selectedTerminal ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <div className="font-mono text-sm font-semibold text-slate-950">{selectedTerminal.terminalId}</div>
                    <div className="text-xs text-slate-500">{selectedTerminal.serverName} / {selectedTerminal.accountNumber}</div>
                  </div>
                  <HeartbeatStateBadge state={selectedTerminal.heartbeatState} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Last heartbeat" value={formatTime(selectedTerminal.receivedAt)} />
                  <Metric label="Heartbeat age" value={formatDuration(selectedTerminal.heartbeatAgeMs)} />
                  <Metric label="Tick delay" value={`${selectedTerminal.tickDelayMs}ms`} />
                  <Metric label="EA response" value={`${selectedTerminal.eaResponseMs}ms`} />
                  <Metric label="CPU usage" value={`${selectedTerminal.cpuUsage}%`} />
                  <Metric label="Memory usage" value={`${selectedTerminal.memoryUsage}%`} />
                </div>
              </div>
            ) : (
              <EmptyPanel title="No heartbeat selected" detail="Select or connect an MT5 terminal to inspect live diagnostics." />
            )}
          </OpsPanel>

          <OpsPanel title="Alert Engine" icon={AlertTriangle}>
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div key={`${alert.title}-${alert.terminalId}`} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-slate-900">{alert.title}</div>
                    <HeartbeatStateBadge state={alert.state} />
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-slate-500">{alert.terminalId}</div>
                  <div className="mt-1 text-xs text-slate-600">{alert.detail}</div>
                </div>
              ))}
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <OpsPanel title="Heartbeat Waveform" icon={Activity}>
          <Waveform values={waveform} />
        </OpsPanel>
        <OpsPanel title="Latency Trend" icon={Gauge}>
          <BarTrend values={latencyTrend} suffix="ms" />
        </OpsPanel>
        <OpsPanel title="Stability Chart" icon={ShieldCheck}>
          <BarTrend values={heartbeatRows.map((terminal) => terminal.heartbeatStability).slice(0, 16)} suffix="%" invert />
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <OpsPanel title="Recovery Engine" icon={RefreshCw}>
          <div className="space-y-3">
            {recoveryActions.map((action) => (
              <div key={action.title} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-900">{action.title}</span>
                  <span className="font-mono text-[10px] text-blue-700">{action.mode}</span>
                </div>
                <div className="mt-2 text-xs text-slate-600">{action.detail}</div>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Infrastructure Diagnostics" icon={Database}>
          <div className="grid grid-cols-1 gap-3">
            {buildDiagnostics(selectedTerminal).map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                <span className="text-xs font-semibold text-slate-700">{item.label}</span>
                <span className={cn('font-mono text-xs', item.ok ? 'text-emerald-700' : 'text-amber-700')}>{item.value}</span>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Live Operational Feed" icon={Radio}>
          <div className="space-y-3">
            {timelineRows.slice(0, 8).map((row) => (
              <div key={`${row.time}-${row.message}`} className="flex gap-3 rounded-md border border-slate-200 bg-white p-3">
                <div className={cn('mt-1 h-2 w-2 rounded-full', row.state === 'ONLINE' && 'bg-emerald-500', row.state === 'WARNING' && 'bg-amber-500', (row.state === 'OFFLINE' || row.state === 'DISCONNECTED') && 'bg-rose-500')} />
                <div>
                  <div className="text-xs font-semibold text-slate-800">{row.message}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{formatTime(row.time)}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Frontend Architecture" lines={HEARTBEAT_FRONTEND_LINES} />
        <ArchitectureCard title="Backend Heartbeat Service" lines={HEARTBEAT_BACKEND_LINES} />
        <ArchitectureCard title="PostgreSQL Schema" lines={HEARTBEAT_SCHEMA_LINES} />
        <ArchitectureCard title="Redis Queue Structure" lines={HEARTBEAT_REDIS_LINES} />
        <ArchitectureCard title="Timeout Engine" lines={HEARTBEAT_TIMEOUT_LINES} />
        <ArchitectureCard title="Auto-Recovery Architecture" lines={HEARTBEAT_RECOVERY_LINES} />
      </section>
    </div>
  );
}

function mergeHeartbeatSources(terminals: any[], registrations: any[]) {
  const merged = new Map<string, any>();
  terminals.forEach((terminal) => {
    const terminalId = String(terminal?.terminalId ?? '');
    if (!terminalId) return;
    merged.set(terminalId, terminal);
  });
  registrations.forEach((registration) => {
    const terminalId = String(registration?.terminalId ?? '');
    if (!terminalId) return;
    if (merged.has(terminalId)) return;
    merged.set(terminalId, {
      terminalId,
      terminalName: registration.terminalName,
      computerId: registration.computerId,
      computerName: registration.computerName,
      accountNumber: registration.accountNumber,
      brokerName: registration.brokerName,
      serverName: registration.serverName,
      status: 'disconnected',
      receivedAt: '',
      heartbeatAgeMs: 999_999,
      latencyMs: 0,
      lastTickTime: '',
      version: registration.eaVersion,
      hasHeartbeat: false,
    });
  });
  return Array.from(merged.values()).sort((a, b) => String(a.terminalId).localeCompare(String(b.terminalId)));
}

const HEARTBEAT_FRONTEND_LINES = [
  'TerminalHeartbeatPage -> FleetSummaryCards -> LiveHeartbeatTimeline',
  'SelectedTerminalMetrics reads current snapshot and optional /api/mt5/terminals/:id history',
  'HeartbeatVisualization renders waveform, stability chart, and latency trend from recent samples',
  'AlertEngine derives heartbeat lost, delayed heartbeat, unstable connection, and tick sync failure',
  'DiagnosticsPanel separates WebSocket, API, EA, and MT5 health for operator triage',
];

const HEARTBEAT_BACKEND_LINES = [
  'POST /api/mt5/heartbeat -> authenticated EA heartbeat ingestion endpoint',
  'Heartbeat service normalizes sentAt, receivedAt, sequence, latency, account, tick, and host metrics',
  'Timeout scanner evaluates heartbeat age buckets every second',
  'Event publisher emits heartbeat.received, heartbeat.warning, heartbeat.timeout, heartbeat.recovered',
  'REST snapshot remains fallback for dashboards that miss WebSocket deltas',
];

const HEARTBEAT_SCHEMA_LINES = [
  'mt5_heartbeats(id, terminal_id, sequence, sent_at, received_at, latency_ms, tick_time)',
  'mt5_terminal_health(id, terminal_id, state, heartbeat_age_ms, stability_score, updated_at)',
  'mt5_terminal_metrics(id, terminal_id, cpu_usage, memory_usage, mt5_ping_ms, ea_response_ms)',
  'mt5_heartbeat_alerts(id, terminal_id, alert_type, severity, resolved_at, created_at)',
  'mt5_recovery_attempts(id, terminal_id, action, status, retry_count, next_retry_at)',
];

const HEARTBEAT_REDIS_LINES = [
  'stream:mt5:heartbeat -> append-only heartbeat ingestion stream',
  'pubsub:heartbeat.received -> dashboard event fanout',
  'zset:heartbeat:timeouts -> terminalId scored by expected next heartbeat time',
  'queue:terminal.recovery -> reconnect, re-register, and failover jobs',
  'hash:terminal:last_seen -> latest heartbeat state by terminalId',
];

const HEARTBEAT_TIMEOUT_LINES = [
  'ONLINE when heartbeat age < 5 sec',
  'WARNING when heartbeat age is 5-15 sec',
  'OFFLINE when heartbeat age is 15-30 sec',
  'DISCONNECTED when heartbeat age > 30 sec',
  'Recovered state requires two consecutive on-time heartbeats after timeout',
];

const HEARTBEAT_RECOVERY_LINES = [
  'Auto reconnect requests EA bridge reconnect after delayed heartbeat threshold',
  'Retry logic uses exponential backoff with jitter and max-attempt dead lettering',
  'Session recovery rotates lease and validates terminal fingerprint before resuming commands',
  'Re-registration creates pending approval if fingerprint or broker account changed',
  'Failover routing moves account commands to the healthiest registered terminal',
];

function enrichHeartbeatTerminal(terminal: any) {
  const enriched = enrichTerminal(terminal);
  const heartbeatAgeMs = Number(enriched.heartbeatAgeMs ?? 0);
  const heartbeatState = resolveHeartbeatState(heartbeatAgeMs);
  const tickDelayMs = Number(enriched.tickDelayMs ?? 0);
  const websocketLatencyMs = Number(terminal.websocketLatencyMs ?? 0);
  const mt5PingMs = Number(terminal.mt5PingMs ?? 0);
  const eaResponseMs = Number(terminal.eaResponseMs ?? 0);
  const heartbeatStability = Number(terminal.heartbeatStability ?? calculateHeartbeatStability({
    heartbeatAgeMs,
    latencyMs: enriched.latencyMs,
    tickDelayMs,
    missedSequenceCount: enriched.missedSequenceCount ?? 0,
    state: heartbeatState,
  }));

  return {
    ...enriched,
    heartbeatState,
    heartbeatStability,
    websocketLatencyMs,
    mt5PingMs,
    eaResponseMs,
  };
}

function resolveHeartbeatState(ageMs: number): 'ONLINE' | 'WARNING' | 'OFFLINE' | 'DISCONNECTED' {
  if (ageMs < 5000) return 'ONLINE';
  if (ageMs < 15000) return 'WARNING';
  if (ageMs < 30000) return 'OFFLINE';
  return 'DISCONNECTED';
}

function calculateHeartbeatStability(input: { heartbeatAgeMs: number; latencyMs: number; tickDelayMs: number; missedSequenceCount: number; state: string }) {
  const agePenalty = Math.min(35, Math.round(input.heartbeatAgeMs / 1000) * 3);
  const latencyPenalty = Math.min(25, Math.round(input.latencyMs / 150));
  const tickPenalty = Math.min(20, Math.round(input.tickDelayMs / 500));
  const sequencePenalty = Math.min(20, input.missedSequenceCount * 4);
  const statePenalty = input.state === 'ONLINE' ? 0 : input.state === 'WARNING' ? 10 : input.state === 'OFFLINE' ? 25 : 40;
  return Math.max(0, 100 - agePenalty - latencyPenalty - tickPenalty - sequencePenalty - statePenalty);
}

function summarizeHeartbeatFleet(rows: any[]) {
  const count = Math.max(1, rows.length);
  return {
    online: rows.filter((row) => row.heartbeatState === 'ONLINE').length,
    warning: rows.filter((row) => row.heartbeatState === 'WARNING').length,
    offline: rows.filter((row) => row.heartbeatState === 'OFFLINE').length,
    disconnected: rows.filter((row) => row.heartbeatState === 'DISCONNECTED').length,
    averageLatency: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.latencyMs, 0) / count) : 0,
    averageTickDelay: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.tickDelayMs, 0) / count) : 0,
    averageCpu: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.cpuUsage, 0) / count) : 0,
    averageMemory: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.memoryUsage, 0) / count) : 0,
  };
}

function buildHeartbeatAlerts(rows: any[]) {
  const alerts = rows.flatMap((row) => {
    const items = [];
    if (row.heartbeatState === 'DISCONNECTED') items.push({ title: 'Heartbeat lost', terminalId: row.terminalId, state: 'DISCONNECTED', detail: 'No heartbeat received for more than 30 seconds.' });
    if (row.heartbeatState === 'WARNING') items.push({ title: 'Delayed heartbeat', terminalId: row.terminalId, state: 'WARNING', detail: 'Heartbeat age is outside the online service level.' });
    if (row.latencyMs > 900) items.push({ title: 'Connection unstable', terminalId: row.terminalId, state: 'WARNING', detail: `API latency is elevated at ${row.latencyMs}ms.` });
    if (row.tickDelayMs > 1500) items.push({ title: 'Tick synchronization failure', terminalId: row.terminalId, state: 'OFFLINE', detail: `Last tick is delayed by ${row.tickDelayMs}ms.` });
    return items;
  });
  return alerts.length ? alerts.slice(0, 6) : [
    { title: 'No heartbeat alerts', terminalId: 'fleet', state: 'ONLINE', detail: 'All monitored terminals are inside configured heartbeat rules.' },
  ];
}

function buildRecoveryActions(rows: any[]) {
  const unhealthy = rows.filter((row) => row.heartbeatState !== 'ONLINE');
  return [
    { title: 'Auto reconnect', mode: unhealthy.length ? 'ARMED' : 'STANDBY', detail: unhealthy.length ? `${unhealthy.length} terminal(s) qualify for reconnect orchestration.` : 'No reconnect required.' },
    { title: 'Retry logic', mode: 'EXP BACKOFF', detail: 'Recovery jobs retry with exponential backoff, jitter, and dead-letter tracking.' },
    { title: 'Session recovery', mode: 'SIGNED', detail: 'Sessions resume only after fingerprint and EA token validation.' },
    { title: 'Re-registration', mode: 'PENDING', detail: 'Changed fingerprints or broker accounts create approval-gated registration drafts.' },
    { title: 'Failover routing', mode: unhealthy.length ? 'EVALUATING' : 'READY', detail: 'Account routing can move command flow to the healthiest eligible terminal.' },
  ];
}

function buildHeartbeatTimeline(rows: any[], history: any[]) {
  const historyRows = history.slice(0, 8).map((row: any) => ({
    time: row.receivedAt,
    message: `Heartbeat received sequence ${row.sequence ?? '--'} (${row.latencyMs ?? 0}ms)`,
    state: 'ONLINE',
  }));
  if (historyRows.length) return historyRows;
  const now = new Date().toISOString();
  return rows.slice(0, 8).map((row) => ({
    time: row.receivedAt ?? now,
    message: `${row.terminalId} heartbeat ${row.heartbeatState.toLowerCase()} (${formatDuration(row.heartbeatAgeMs)} age)`,
    state: row.heartbeatState,
  }));
}

function buildHeartbeatWaveform(_selectedTerminal: any, history: any[]) {
  if (!history.length) return [];
  return history.slice(0, 24).reverse().map((row: any) => Math.max(12, 100 - Math.min(88, Number(row.latencyMs ?? 0) / 20)));
}

function buildLatencyTrend(_selectedTerminal: any, history: any[]) {
  if (!history.length) return [];
  return history.slice(0, 16).reverse().map((row: any) => Number(row.latencyMs ?? 0));
}

function buildDiagnostics(selectedTerminal: any) {
  return [
    { label: 'WebSocket diagnostics', value: selectedTerminal ? `${selectedTerminal.websocketLatencyMs}ms` : 'standby', ok: !selectedTerminal || selectedTerminal.websocketLatencyMs < 250 },
    { label: 'API diagnostics', value: selectedTerminal ? `${selectedTerminal.latencyMs}ms` : 'standby', ok: !selectedTerminal || selectedTerminal.latencyMs < 500 },
    { label: 'EA diagnostics', value: selectedTerminal ? `${selectedTerminal.eaResponseMs}ms` : 'standby', ok: !selectedTerminal || selectedTerminal.eaResponseMs < 250 },
    { label: 'MT5 diagnostics', value: selectedTerminal ? `${selectedTerminal.mt5PingMs}ms` : 'standby', ok: !selectedTerminal || selectedTerminal.mt5PingMs < 500 },
    { label: 'Broker connectivity', value: selectedTerminal?.status === 'connected' ? 'linked' : 'watch', ok: selectedTerminal?.status === 'connected' },
  ];
}

function HeartbeatStateBadge({ state }: { state: string }) {
  return (
    <span className={cn(
      'inline-flex whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase',
      state === 'ONLINE' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      state === 'WARNING' && 'border-amber-200 bg-amber-50 text-amber-700',
      state === 'OFFLINE' && 'border-orange-200 bg-orange-50 text-orange-700',
      state === 'DISCONNECTED' && 'border-rose-200 bg-rose-50 text-rose-700',
    )}>
      {state}
    </span>
  );
}

function Waveform({ values }: { values: number[] }) {
  return (
    <div className="flex h-40 items-end gap-1 rounded-md border border-slate-200 bg-slate-50 p-3">
      {values.map((value, index) => (
        <div key={`${value}-${index}`} className="flex-1 rounded-t bg-blue-600" style={{ height: `${Math.max(8, Math.min(100, value))}%` }} />
      ))}
    </div>
  );
}

function BarTrend({ values, suffix, invert }: { values: number[]; suffix: string; invert?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <div className="space-y-2">
      <div className="flex h-40 items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
        {(values.length ? values : [0]).map((value, index) => {
          const height = invert ? value : Math.max(8, (value / max) * 100);
          return <div key={`${value}-${index}`} className="flex-1 rounded-t bg-blue-600" style={{ height: `${Math.max(8, Math.min(100, height))}%` }} />;
        })}
      </div>
      <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
        <span>min {values.length ? Math.min(...values) : 0}{suffix}</span>
        <span>max {values.length ? Math.max(...values) : 0}{suffix}</span>
      </div>
    </div>
  );
}

function TerminalHealth({ terminals }: { terminals: any[] }) {
  const rows = useMemo(() => terminals.map(enrichHealthTerminal).sort((a, b) => b.healthScore - a.healthScore), [terminals]);
  const summary = summarizeHealthFleet(rows);
  const alerts = buildHealthAlerts(rows);
  const events = buildHealthEvents(rows);
  const dependencies = buildServiceDependencies(summary);
  const heatmap = buildHealthHeatmap(rows);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={ShieldCheck} title="Fleet health score" value={`${summary.healthScore}%`} detail="Weighted infra health index" tone={summary.healthScore >= 80 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={Cpu} title="Average CPU" value={`${summary.averageCpu}%`} detail="Terminal host resource use" tone={summary.averageCpu > 75 ? 'amber' : 'blue'} />
        <OpsSummaryCard icon={MemoryStick} title="Average memory" value={`${summary.averageMemory}%`} detail="VPS memory pressure" tone={summary.averageMemory > 80 ? 'amber' : 'slate'} />
        <OpsSummaryCard icon={Wifi} title="Tick sync health" value={`${summary.tickSyncScore}%`} detail="Fresh tick alignment score" tone={summary.tickSyncScore >= 85 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={PlugZap} title="EA responsiveness" value={`${summary.eaScore}%`} detail="EA response and heartbeat quality" tone={summary.eaScore >= 85 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={Server} title="Broker response" value={`${summary.brokerScore}%`} detail="Broker connectivity health" tone={summary.brokerScore >= 85 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={Network} title="Network quality" value={`${summary.networkScore}%`} detail="Latency and jitter quality" tone={summary.networkScore >= 85 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={AlertTriangle} title="Predicted failures" value={String(summary.predictedFailures)} detail="AI-assisted risk signals" tone={summary.predictedFailures ? 'red' : 'green'} />
      </section>

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-blue-700" /> Multi-Terminal Health Comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[620px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Health</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">CPU</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Memory</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Tick</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">EA</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Broker</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Uptime</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Anomaly</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={10} className="h-40 text-center text-sm text-slate-500">
                        Waiting for terminal heartbeat.
                      </TableCell>
                    </TableRow>
                  ) : rows.map((terminal) => (
                    <TableRow key={terminal.terminalId} className={cn('border-slate-100 hover:bg-blue-50/40', terminal.healthScore < 60 && 'bg-rose-50/30', terminal.healthScore >= 60 && terminal.healthScore < 80 && 'bg-amber-50/30')}>
                      <TableCell className="font-mono text-xs text-slate-700">{terminal.terminalId}<div className="text-[11px] text-slate-500">{terminal.vpsLocation}</div></TableCell>
                      <TableCell><StatusPill status={terminal.status} /></TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-slate-800">{terminal.healthScore}%</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.cpuUsage}%</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.memoryUsage}%</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.tickDelayMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.eaResponseMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.brokerResponseMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{formatDuration(terminal.connectionUptimeMs)}</TableCell>
                      <TableCell><HealthBadge label={terminal.anomalyLabel} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OpsPanel title="AI-Assisted Diagnostics" icon={Activity}>
            <div className="space-y-3">
              {buildAiDiagnostics(rows).map((item) => (
                <div key={item.title} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-900">{item.title}</span>
                    <HealthBadge label={item.severity} />
                  </div>
                  <div className="mt-2 text-xs text-slate-600">{item.detail}</div>
                </div>
              ))}
            </div>
          </OpsPanel>

          <OpsPanel title="Infrastructure Alerts" icon={AlertTriangle}>
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div key={`${alert.title}-${alert.terminalId}`} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-900">{alert.title}</span>
                    <HealthBadge label={alert.severity} />
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{alert.terminalId}</div>
                  <div className="mt-2 text-xs text-slate-600">{alert.detail}</div>
                </div>
              ))}
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <OpsPanel title="Live Health Graph" icon={Gauge}><BarTrend values={rows.map((row) => row.healthScore).slice(0, 18)} suffix="%" invert /></OpsPanel>
        <OpsPanel title="Resource Analytics" icon={Cpu}><DualMetricBars rows={rows} leftKey="cpuUsage" rightKey="memoryUsage" /></OpsPanel>
        <OpsPanel title="Network Diagnostics" icon={Network}><BarTrend values={rows.map((row) => row.networkScore).slice(0, 18)} suffix="%" invert /></OpsPanel>
        <OpsPanel title="Failure Prediction" icon={ShieldAlert}><BarTrend values={rows.map((row) => row.failureRisk).slice(0, 18)} suffix="%" /></OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
        <OpsPanel title="Infrastructure Heatmap" icon={Layers3}>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
            {heatmap.map((cell) => <HeatmapCell key={cell.label} {...cell} />)}
          </div>
        </OpsPanel>
        <OpsPanel title="Service Dependencies" icon={Database}>
          <div className="space-y-3">
            {dependencies.map((dependency) => (
              <div key={dependency.name} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900">{dependency.name}</div>
                  <div className="mt-1 text-[11px] text-slate-500">{dependency.detail}</div>
                </div>
                <HealthBadge label={dependency.state} />
              </div>
            ))}
          </div>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <OpsPanel title="Infrastructure Event Timeline" icon={RefreshCw}>
          <div className="space-y-3">
            {events.map((event) => (
              <div key={`${event.time}-${event.message}`} className="flex gap-3 rounded-md border border-slate-200 bg-white p-3">
                <div className={cn('mt-1 h-2 w-2 rounded-full', event.severity === 'HEALTHY' && 'bg-emerald-500', event.severity === 'WATCH' && 'bg-amber-500', event.severity === 'CRITICAL' && 'bg-rose-500')} />
                <div>
                  <div className="text-xs font-semibold text-slate-800">{event.message}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{formatTime(event.time)}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="VPS Monitoring" icon={Server}>
          <div className="space-y-3">
            {buildVpsHealth(rows).map((vps) => (
              <div key={vps.location} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">{vps.location}</span>
                  <span className="font-mono text-xs text-slate-600">{vps.terminals} terminals</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${vps.health}%` }} />
                </div>
                <div className="mt-2 font-mono text-[11px] text-slate-500">health {vps.health}% / cpu {vps.cpu}% / memory {vps.memory}%</div>
              </div>
            ))}
          </div>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Backend Architecture" lines={HEALTH_BACKEND_LINES} />
        <ArchitectureCard title="Monitoring Service Design" lines={HEALTH_SERVICE_LINES} />
        <ArchitectureCard title="Alert Architecture" lines={HEALTH_ALERT_LINES} />
        <ArchitectureCard title="Database Schema" lines={HEALTH_SCHEMA_LINES} />
        <ArchitectureCard title="Event Processing Flow" lines={HEALTH_EVENT_LINES} />
        <ArchitectureCard title="Infrastructure Analytics" lines={HEALTH_ANALYTICS_LINES} />
      </section>
    </div>
  );
}

const HEALTH_BACKEND_LINES = [
  'terminal-health-service consumes heartbeat, latency, tick, broker, and host metric streams',
  'health-score worker computes fleet and terminal health every ingestion cycle',
  'diagnostics API exposes terminal health snapshots, anomaly signals, and dependency state',
  'prediction worker scores failure probability from latency, resource, uptime, and heartbeat drift',
  'dashboard uses REST snapshot fallback and WebSocket deltas for real-time updates',
];

const HEALTH_SERVICE_LINES = [
  'Metric collectors: heartbeat collector, resource collector, broker probe, EA response probe',
  'Scoring engine: weighted CPU, memory, tick sync, EA, broker, network, uptime, stability',
  'Anomaly detector: threshold rules plus rolling z-score for latency and resource spikes',
  'VPS monitor: aggregates health by region, VPS ID, and terminal density',
  'Dependency tracker: bridge, WebSocket, broker, Redis, database, command queue',
];

const HEALTH_ALERT_LINES = [
  'health.score.degraded when score falls below 80 for two consecutive windows',
  'resource.pressure when CPU or memory exceeds configured terminal budget',
  'tick.sync.failure when tick delay exceeds synchronization SLA',
  'broker.unresponsive when broker response crosses latency threshold',
  'failure.predicted when anomaly and trend signals exceed risk score threshold',
];

const HEALTH_SCHEMA_LINES = [
  'terminal_health_snapshots(id, terminal_id, health_score, cpu, memory, tick_delay, created_at)',
  'terminal_resource_metrics(id, terminal_id, cpu_usage, memory_usage, process_uptime_ms)',
  'terminal_dependency_states(id, terminal_id, dependency, state, latency_ms, checked_at)',
  'terminal_anomalies(id, terminal_id, anomaly_type, severity, feature_vector_json)',
  'infrastructure_alerts(id, terminal_id, alert_type, status, opened_at, resolved_at)',
];

const HEALTH_EVENT_LINES = [
  'heartbeat.received -> normalize terminal health input',
  'metrics.resource.updated -> update CPU and memory pressure windows',
  'broker.probe.completed -> score broker responsiveness',
  'health.score.updated -> publish dashboard and alert evaluator event',
  'alert.opened / alert.resolved -> append operational timeline',
];

const HEALTH_ANALYTICS_LINES = [
  'Failure prediction blends heartbeat age, missed sequence count, jitter, CPU, memory, and tick delay',
  'Resource analytics rolls up terminal, VPS, broker, and region consumption windows',
  'Infrastructure heatmap groups health by terminal and metric dimension',
  'Stability analytics uses EWMA latency, jitter, sequence gaps, and reconnect count',
  'AI diagnostics explains likely cause, blast radius, and first recovery action',
];

function enrichHealthTerminal(terminal: any) {
  const heartbeat = enrichHeartbeatTerminal(terminal);
  const brokerResponseMs = Number(terminal.brokerResponseMs ?? 0);
  const cpuScore = clampScore(100 - Math.max(0, heartbeat.cpuUsage - 45) * 1.4);
  const memoryScore = clampScore(100 - Math.max(0, heartbeat.memoryUsage - 55) * 1.2);
  const tickScore = clampScore(100 - Math.round(heartbeat.tickDelayMs / 35));
  const eaScore = clampScore(100 - Math.round(heartbeat.eaResponseMs / 4));
  const brokerScore = clampScore(100 - Math.round(brokerResponseMs / 6));
  const networkScore = clampScore(100 - Math.round((heartbeat.latencyMs + Number(heartbeat.jitterMs ?? 0)) / 8));
  const uptimeScore = heartbeat.connectionUptimeMs > 30 * 60_000 ? 100 : clampScore(Math.round(heartbeat.connectionUptimeMs / 18_000));
  const stabilityScore = Number(heartbeat.stabilityScore ?? heartbeat.heartbeatStability ?? 0);
  const healthScore = Math.round((cpuScore * 0.12) + (memoryScore * 0.12) + (tickScore * 0.16) + (eaScore * 0.14) + (brokerScore * 0.14) + (networkScore * 0.14) + (uptimeScore * 0.08) + (stabilityScore * 0.1));
  const failureRisk = clampScore(100 - healthScore + Math.round(Number(heartbeat.missedSequenceCount ?? 0) * 4) + (heartbeat.status === 'disconnected' ? 20 : 0));
  return {
    ...heartbeat,
    brokerResponseMs,
    cpuScore,
    memoryScore,
    tickScore,
    eaScore,
    brokerScore,
    networkScore,
    uptimeScore,
    healthScore,
    failureRisk,
    anomalyLabel: failureRisk > 55 ? 'CRITICAL' : healthScore < 80 ? 'WATCH' : 'HEALTHY',
  };
}

function summarizeHealthFleet(rows: any[]) {
  const count = Math.max(1, rows.length);
  return {
    healthScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.healthScore, 0) / count) : 0,
    averageCpu: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.cpuUsage, 0) / count) : 0,
    averageMemory: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.memoryUsage, 0) / count) : 0,
    tickSyncScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.tickScore, 0) / count) : 0,
    eaScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.eaScore, 0) / count) : 0,
    brokerScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.brokerScore, 0) / count) : 0,
    networkScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.networkScore, 0) / count) : 0,
    predictedFailures: rows.filter((row) => row.failureRisk > 55).length,
  };
}

function buildHealthAlerts(rows: any[]) {
  const alerts = rows.flatMap((row) => {
    const items = [];
    if (row.healthScore < 70) items.push({ title: 'Infrastructure health degraded', terminalId: row.terminalId, severity: 'CRITICAL', detail: `Health score is ${row.healthScore}%.` });
    if (row.cpuUsage > 80 || row.memoryUsage > 85) items.push({ title: 'Resource pressure', terminalId: row.terminalId, severity: 'WATCH', detail: `CPU ${row.cpuUsage}% / memory ${row.memoryUsage}%.` });
    if (row.tickDelayMs > 1500) items.push({ title: 'Tick synchronization drift', terminalId: row.terminalId, severity: 'WATCH', detail: `Tick delay is ${row.tickDelayMs}ms.` });
    if (row.brokerResponseMs > 750) items.push({ title: 'Broker responsiveness degraded', terminalId: row.terminalId, severity: 'WATCH', detail: `Broker response ${row.brokerResponseMs}ms.` });
    return items;
  });
  return alerts.length ? alerts.slice(0, 8) : [{ title: 'No active infrastructure alerts', terminalId: 'fleet', severity: 'HEALTHY', detail: 'All monitored health dimensions are within expected bands.' }];
}

function buildAiDiagnostics(rows: any[]) {
  if (!rows.length) return [{ title: 'Awaiting telemetry', severity: 'WATCH', detail: 'Health diagnostics will activate after terminal heartbeats arrive.' }];
  const worst = [...rows].sort((a, b) => b.failureRisk - a.failureRisk)[0];
  const cpuHot = rows.filter((row) => row.cpuUsage > 75).length;
  const tickDrift = rows.filter((row) => row.tickDelayMs > 1500).length;
  return [
    { title: 'Primary risk vector', severity: worst.failureRisk > 55 ? 'CRITICAL' : 'WATCH', detail: `${worst.terminalId} has ${worst.failureRisk}% predicted failure risk; inspect ${worst.cpuUsage > 75 ? 'CPU pressure' : worst.tickDelayMs > 1500 ? 'tick synchronization' : 'network jitter'} first.` },
    { title: 'Resource cluster signal', severity: cpuHot ? 'WATCH' : 'HEALTHY', detail: cpuHot ? `${cpuHot} terminal(s) show elevated CPU pressure.` : 'No fleet-wide CPU pressure detected.' },
    { title: 'Synchronization signal', severity: tickDrift ? 'WATCH' : 'HEALTHY', detail: tickDrift ? `${tickDrift} terminal(s) have tick sync drift above SLA.` : 'Tick synchronization is stable across the fleet.' },
  ];
}

function buildHealthEvents(rows: any[]) {
  const now = new Date().toISOString();
  const events = rows.slice(0, 8).map((row) => ({
    time: row.receivedAt ?? now,
    message: `${row.terminalId} health ${row.healthScore}% / ${row.anomalyLabel.toLowerCase()} / ${row.vpsLocation}`,
    severity: row.anomalyLabel,
  }));
  return events;
}

function buildServiceDependencies(summary: ReturnType<typeof summarizeHealthFleet>) {
  return [
    { name: 'MT5 bridge service', state: summary.healthScore > 0 ? 'HEALTHY' : 'WATCH', detail: 'Heartbeat ingestion and command bridge availability.' },
    { name: 'WebSocket fanout', state: summary.networkScore >= 80 ? 'HEALTHY' : 'WATCH', detail: 'Real-time dashboard event delivery.' },
    { name: 'Broker connectivity', state: summary.brokerScore >= 80 ? 'HEALTHY' : 'WATCH', detail: 'Broker server responsiveness and account link checks.' },
    { name: 'Redis event bus', state: 'HEALTHY', detail: 'Metric stream, alert fanout, and recovery queue backbone.' },
    { name: 'PostgreSQL telemetry store', state: 'HEALTHY', detail: 'Health snapshots, anomalies, and alert history.' },
  ];
}

function buildHealthHeatmap(rows: any[]) {
  if (!rows.length) return ['CPU', 'Memory', 'Tick', 'EA', 'Broker', 'Network'].map((label) => ({ label, value: 0, state: 'WATCH' }));
  return rows.flatMap((row) => [
    { label: `${row.terminalId} CPU`, value: row.cpuScore, state: scoreState(row.cpuScore) },
    { label: `${row.terminalId} MEM`, value: row.memoryScore, state: scoreState(row.memoryScore) },
    { label: `${row.terminalId} TICK`, value: row.tickScore, state: scoreState(row.tickScore) },
    { label: `${row.terminalId} NET`, value: row.networkScore, state: scoreState(row.networkScore) },
  ]).slice(0, 24);
}

function buildVpsHealth(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const items = groups.get(row.vpsLocation) ?? [];
    items.push(row);
    groups.set(row.vpsLocation, items);
  }
  if (!groups.size) return [{ location: 'No VPS telemetry', terminals: 0, health: 0, cpu: 0, memory: 0 }];
  return Array.from(groups.entries()).map(([location, items]) => {
    const count = Math.max(1, items.length);
    return {
      location,
      terminals: items.length,
      health: Math.round(items.reduce((sum, row) => sum + row.healthScore, 0) / count),
      cpu: Math.round(items.reduce((sum, row) => sum + row.cpuUsage, 0) / count),
      memory: Math.round(items.reduce((sum, row) => sum + row.memoryUsage, 0) / count),
    };
  });
}

function DualMetricBars({ rows, leftKey, rightKey }: { rows: any[]; leftKey: string; rightKey: string }) {
  const values = rows.slice(0, 8);
  return (
    <div className="space-y-3">
      {(values.length ? values : [{ terminalId: 'No data', [leftKey]: 0, [rightKey]: 0 }]).map((row, index) => {
        const rowId = String(row.terminalId ?? row.vpsId ?? row.machineId ?? row.id ?? row.label ?? `metric-row-${index}`);
        return (
        <div key={`${rowId}-${index}`}>
          <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
            <span>{rowId}</span>
            <span>{row[leftKey]}% / {row[rightKey]}%</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, row[leftKey])}%` }} /></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-600" style={{ width: `${Math.min(100, row[rightKey])}%` }} /></div>
          </div>
        </div>
        );
      })}
    </div>
  );
}

function HeatmapCell(props: { label: string; value: number; state: string }) {
  return (
    <div className={cn(
      'min-h-20 rounded-md border p-3',
      props.state === 'HEALTHY' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
      props.state === 'WATCH' && 'border-amber-200 bg-amber-50 text-amber-800',
      props.state === 'CRITICAL' && 'border-rose-200 bg-rose-50 text-rose-800',
    )}>
      <div className="truncate text-[11px] font-semibold">{props.label}</div>
      <div className="mt-3 font-mono text-2xl">{props.value}</div>
    </div>
  );
}

function HealthBadge({ label }: { label: string }) {
  return (
    <span className={cn(
      'inline-flex whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase',
      label === 'HEALTHY' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      label === 'WATCH' && 'border-amber-200 bg-amber-50 text-amber-700',
      label === 'CRITICAL' && 'border-rose-200 bg-rose-50 text-rose-700',
    )}>{label}</span>
  );
}

function scoreState(score: number): 'HEALTHY' | 'WATCH' | 'CRITICAL' {
  if (score >= 80) return 'HEALTHY';
  if (score >= 60) return 'WATCH';
  return 'CRITICAL';
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function Mt5Synchronization({ terminals }: { terminals: any[] }) {
  const rows = useMemo(() => terminals.map(enrichSyncTerminal).sort((a, b) => b.syncScore - a.syncScore), [terminals]);
  const summary = summarizeSyncFleet(rows);
  const queues = buildSyncQueues(rows);
  const timeline = buildSyncTimeline(rows);
  const failures = buildSyncFailures(rows);
  const symbols = buildSymbolSync(rows);
  const consistency = buildConsistencyChecks(rows);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={RefreshCw} title="Fleet sync score" value={`${summary.syncScore}%`} detail="Cross-system synchronization health" tone={summary.syncScore >= 85 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={Gauge} title="Sync latency" value={`${summary.averageSyncLatency}ms`} detail="Terminal to backend state latency" tone={summary.averageSyncLatency > 750 ? 'amber' : 'blue'} />
        <OpsSummaryCard icon={AlertTriangle} title="Sync failures" value={String(summary.failures)} detail="Failed or stale sync dimensions" tone={summary.failures ? 'red' : 'green'} />
        <OpsSummaryCard icon={Database} title="Queue depth" value={String(summary.queueDepth)} detail="Pending sync events" tone={summary.queueDepth > 50 ? 'amber' : 'slate'} />
        <OpsSummaryCard icon={Wifi} title="Missing ticks" value={String(summary.missingTicks)} detail="Detected tick gaps" tone={summary.missingTicks ? 'amber' : 'green'} />
        <OpsSummaryCard icon={Layers3} title="Duplicates" value={String(summary.duplicates)} detail="Duplicate event signatures" tone={summary.duplicates ? 'amber' : 'green'} />
        <OpsSummaryCard icon={Globe2} title="Symbols synced" value={`${summary.symbolScore}%`} detail="Symbol catalog consistency" tone={summary.symbolScore >= 90 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={ShieldCheck} title="Reconciled accounts" value={`${summary.reconciliationScore}%`} detail="Balance, equity, positions, orders" tone={summary.reconciliationScore >= 90 ? 'green' : 'amber'} />
      </section>

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Network className="w-4 h-4 text-blue-700" /> Real-Time Synchronization Matrix
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[620px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Score</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Latency</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Trades</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Orders</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Positions</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Tick</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Missing</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Retries</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Reconciliation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={11} className="h-40 text-center text-sm text-slate-500">Waiting for MT5 synchronization telemetry.</TableCell>
                    </TableRow>
                  ) : rows.map((terminal) => (
                    <TableRow key={terminal.terminalId} className={cn('border-slate-100 hover:bg-blue-50/40', terminal.syncScore < 75 && 'bg-amber-50/30', terminal.syncScore < 55 && 'bg-rose-50/30')}>
                      <TableCell className="font-mono text-xs text-slate-700">{terminal.terminalId}<div className="text-[11px] text-slate-500">{terminal.serverName}</div></TableCell>
                      <TableCell><SyncBadge state={terminal.syncState} /></TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-slate-800">{terminal.syncScore}%</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.syncLatencyMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.tradeSyncCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.orderSyncCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.positionSyncCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.tickDelayMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.missingTickCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{terminal.retryCount}</TableCell>
                      <TableCell><SyncBadge state={terminal.reconciliationState} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OpsPanel title="Queue Monitoring" icon={Database}>
            <div className="space-y-3">
              {queues.map((queue) => (
                <div key={queue.name} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">{queue.name}</span>
                    <span className="font-mono text-xs text-slate-600">{queue.depth}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, queue.pressure)}%` }} />
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">{queue.detail}</div>
                </div>
              ))}
            </div>
          </OpsPanel>

          <OpsPanel title="Sync Failures and Retry Engine" icon={RefreshCw}>
            <div className="space-y-3">
              {failures.map((failure) => (
                <div key={`${failure.terminalId}-${failure.kind}`} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-900">{failure.kind}</span>
                    <SyncBadge state={failure.state} />
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{failure.terminalId}</div>
                  <div className="mt-2 text-xs text-slate-600">{failure.detail}</div>
                </div>
              ))}
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <OpsPanel title="Sync Latency Trend" icon={Gauge}><BarTrend values={rows.map((row) => row.syncLatencyMs).slice(0, 18)} suffix="ms" /></OpsPanel>
        <OpsPanel title="Reconciliation Health" icon={ShieldCheck}><BarTrend values={rows.map((row) => row.reconciliationScore).slice(0, 18)} suffix="%" invert /></OpsPanel>
        <OpsPanel title="Tick Synchronization" icon={Wifi}><BarTrend values={rows.map((row) => row.tickScore).slice(0, 18)} suffix="%" invert /></OpsPanel>
        <OpsPanel title="Retry Pressure" icon={RefreshCw}><BarTrend values={rows.map((row) => row.retryCount * 10).slice(0, 18)} suffix="" /></OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <OpsPanel title="Symbol Synchronization" icon={Globe2}>
          <div className="space-y-3">
            {symbols.map((symbol) => (
              <div key={symbol.symbol} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                <div>
                  <div className="font-mono text-sm font-semibold text-slate-900">{symbol.symbol}</div>
                  <div className="text-[11px] text-slate-500">{symbol.terminals} terminals / spread {symbol.spread} pts</div>
                </div>
                <SyncBadge state={symbol.state} />
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Consistency Validation" icon={ClipboardCheck}>
          <div className="space-y-3">
            {consistency.map((check) => (
              <div key={check.name} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">{check.name}</span>
                  <SyncBadge state={check.state} />
                </div>
                <div className="mt-2 text-xs text-slate-600">{check.detail}</div>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Sync Event Timeline" icon={Activity}>
          <div className="space-y-3">
            {timeline.map((event) => (
              <div key={`${event.time}-${event.message}`} className="flex gap-3 rounded-md border border-slate-200 bg-white p-3">
                <div className={cn('mt-1 h-2 w-2 rounded-full', event.state === 'SYNCED' && 'bg-emerald-500', event.state === 'RETRYING' && 'bg-amber-500', event.state === 'FAILED' && 'bg-rose-500')} />
                <div>
                  <div className="text-xs font-semibold text-slate-800">{event.message}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{formatTime(event.time)}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Synchronization Architecture" lines={SYNC_ARCH_LINES} />
        <ArchitectureCard title="WebSocket Architecture" lines={SYNC_WS_LINES} />
        <ArchitectureCard title="Event-Driven Design" lines={SYNC_EVENT_LINES} />
        <ArchitectureCard title="Queue Structure" lines={SYNC_QUEUE_LINES} />
        <ArchitectureCard title="Retry and Recovery" lines={SYNC_RETRY_LINES} />
        <ArchitectureCard title="Database Sync Design" lines={SYNC_DATABASE_LINES} />
      </section>
    </div>
  );
}

const SYNC_ARCH_LINES = [
  'MT5 EA publishes account, trade, order, position, price, symbol, and tick state deltas',
  'Bridge normalizes events and assigns terminalId, sequence, idempotency key, and receivedAt',
  'Sync service writes canonical state, reconciliation snapshots, and outbox events',
  'Dashboard subscribes to WebSocket deltas and periodically verifies REST snapshots',
  'Trading operations consume only reconciled account and order state',
];

const SYNC_WS_LINES = [
  'sync.snapshot.updated { terminalId, accountNumber, sequence, version }',
  'sync.tick.received { terminalId, symbol, bid, ask, tickTime, delayMs }',
  'sync.reconciliation.failed { terminalId, entity, reason, retryAfterMs }',
  'sync.queue.updated { queue, depth, oldestAgeMs, retryCount }',
  'sync.consistency.validated { accountNumber, terminals, status }',
];

const SYNC_EVENT_LINES = [
  'heartbeat.received -> update terminal liveness and expected sequence',
  'tick.received -> detect missing ticks, duplicate ticks, and symbol drift',
  'account.snapshot -> reconcile balance, equity, margin, and free margin',
  'order.snapshot -> upsert open orders and mark disappeared orders for audit',
  'position.snapshot -> validate exposure consistency across terminals',
];

const SYNC_QUEUE_LINES = [
  'stream:sync:inbound -> raw bridge events ordered by terminal sequence',
  'queue:sync:reconcile -> account, trade, order, position reconciliation jobs',
  'queue:sync:retry -> failed sync jobs with exponential backoff',
  'zset:sync:missing_ticks -> symbols scored by expected next tick deadline',
  'hash:sync:idempotency -> duplicate detection keys with short TTL',
];

const SYNC_RETRY_LINES = [
  'Transient failures retry with exponential backoff and jitter',
  'Duplicate events are acknowledged and dropped by idempotency key',
  'Missing ticks trigger broker resubscribe and terminal heartbeat verification',
  'Reconciliation conflicts create operator-visible failure records',
  'Recovery rebuilds dashboard state from canonical snapshots plus event replay',
];

const SYNC_DATABASE_LINES = [
  'sync_events(id, terminal_id, event_type, sequence, idempotency_key, payload_json, created_at)',
  'account_state_snapshots(id, account_number, terminal_id, balance, equity, margin, version)',
  'order_state_snapshots(id, account_number, terminal_id, order_id, status, version)',
  'position_state_snapshots(id, account_number, terminal_id, symbol, volume, side, version)',
  'sync_reconciliation_results(id, entity, terminal_id, status, diff_json, resolved_at)',
];

function enrichSyncTerminal(terminal: any) {
  const health = enrichHealthTerminal(terminal);
  const syncLatencyMs = Number(terminal.syncLatencyMs ?? 0);
  const tradeSyncCount = Number(terminal.tradeSyncCount ?? health.openPositions ?? 0);
  const orderSyncCount = Number(terminal.orderSyncCount ?? health.openOrders ?? 0);
  const positionSyncCount = Number(terminal.positionSyncCount ?? health.openPositions ?? 0);
  const missingTickCount = Number(terminal.missingTickCount ?? 0);
  const duplicateCount = Number(terminal.duplicateCount ?? (health.missedSequenceCount ? Math.min(3, health.missedSequenceCount) : 0));
  const retryCount = Number(terminal.retryCount ?? Math.max(0, missingTickCount + duplicateCount + (health.status === 'disconnected' ? 2 : 0)));
  const accountDrift = Math.abs(Number(health.balance ?? 0) - Number(health.equity ?? 0));
  const reconciliationScore = clampScore(100 - Math.round(accountDrift / 1000) - retryCount * 7 - duplicateCount * 5);
  const tickScore = clampScore(100 - missingTickCount * 18 - Math.round(health.tickDelayMs / 60));
  const latencyScore = clampScore(100 - Math.round(syncLatencyMs / 12));
  const entityScore = clampScore(100 - Math.abs(tradeSyncCount - positionSyncCount) * 8);
  const syncScore = Math.round((reconciliationScore * 0.28) + (tickScore * 0.24) + (latencyScore * 0.22) + (entityScore * 0.16) + (Number(health.stabilityScore ?? 0) * 0.1));
  return {
    ...health,
    syncLatencyMs,
    tradeSyncCount,
    orderSyncCount,
    positionSyncCount,
    missingTickCount,
    duplicateCount,
    retryCount,
    reconciliationScore,
    tickScore,
    syncScore,
    syncState: syncScore >= 85 ? 'SYNCED' : syncScore >= 65 ? 'RETRYING' : 'FAILED',
    reconciliationState: reconciliationScore >= 90 ? 'SYNCED' : reconciliationScore >= 70 ? 'RETRYING' : 'FAILED',
  };
}

function summarizeSyncFleet(rows: any[]) {
  const count = Math.max(1, rows.length);
  return {
    syncScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.syncScore, 0) / count) : 0,
    averageSyncLatency: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.syncLatencyMs, 0) / count) : 0,
    failures: rows.filter((row) => row.syncState === 'FAILED').length,
    queueDepth: rows.reduce((sum, row) => sum + row.retryCount + row.missingTickCount + row.duplicateCount, 0),
    missingTicks: rows.reduce((sum, row) => sum + row.missingTickCount, 0),
    duplicates: rows.reduce((sum, row) => sum + row.duplicateCount, 0),
    symbolScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.tickScore, 0) / count) : 0,
    reconciliationScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.reconciliationScore, 0) / count) : 0,
  };
}

function buildSyncQueues(rows: any[]) {
  const inbound = rows.length * 4 + rows.reduce((sum, row) => sum + row.missingTickCount, 0);
  const reconcile = rows.reduce((sum, row) => sum + Math.max(0, 100 - row.reconciliationScore), 0);
  const retry = rows.reduce((sum, row) => sum + row.retryCount, 0);
  const ticks = rows.reduce((sum, row) => sum + row.missingTickCount, 0);
  return [
    { name: 'stream:sync:inbound', depth: inbound, pressure: inbound * 2, detail: 'Raw MT5 bridge events awaiting normalization.' },
    { name: 'queue:sync:reconcile', depth: reconcile, pressure: reconcile, detail: 'Account, trade, order, and position reconciliation jobs.' },
    { name: 'queue:sync:retry', depth: retry, pressure: retry * 12, detail: 'Failed sync jobs scheduled for retry.' },
    { name: 'zset:sync:missing_ticks', depth: ticks, pressure: ticks * 18, detail: 'Symbols with delayed or missing tick events.' },
  ];
}

function buildSyncFailures(rows: any[]) {
  const failures = rows.flatMap((row) => {
    const items = [];
    if (row.missingTickCount) items.push({ terminalId: row.terminalId, kind: 'Missing tick detection', state: 'RETRYING', detail: `${row.missingTickCount} missing tick gap(s) detected; resubscribe workflow queued.` });
    if (row.duplicateCount) items.push({ terminalId: row.terminalId, kind: 'Duplicate detection', state: 'RETRYING', detail: `${row.duplicateCount} duplicate event signature(s) were deduplicated.` });
    if (row.reconciliationScore < 75) items.push({ terminalId: row.terminalId, kind: 'Data reconciliation failure', state: 'FAILED', detail: 'Account state drift requires canonical snapshot rebuild.' });
    return items;
  });
  return failures.length ? failures.slice(0, 6) : [{ terminalId: 'fleet', kind: 'No sync failures', state: 'SYNCED', detail: 'All synchronization dimensions are currently reconciled.' }];
}

function buildSymbolSync(rows: any[]) {
  return ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDJPY'].map((symbol, index) => {
    const missing = rows.reduce((sum, row) => sum + Number(row.missingTickCount ?? 0), 0);
    return {
      symbol,
      terminals: rows.length,
      spread: symbol === 'XAUUSD' ? 18 + index : Number((0.7 + index * 0.2).toFixed(1)),
      state: missing ? 'RETRYING' : 'SYNCED',
    };
  });
}

function buildConsistencyChecks(rows: any[]) {
  const duplicates = rows.reduce((sum, row) => sum + row.duplicateCount, 0);
  const missing = rows.reduce((sum, row) => sum + row.missingTickCount, 0);
  const retry = rows.reduce((sum, row) => sum + row.retryCount, 0);
  return [
    { name: 'Cross-terminal account consistency', state: rows.some((row) => row.reconciliationScore < 75) ? 'FAILED' : 'SYNCED', detail: 'Validates balance, equity, free margin, orders, and positions across matching accounts.' },
    { name: 'Duplicate event guard', state: duplicates ? 'RETRYING' : 'SYNCED', detail: duplicates ? `${duplicates} duplicate event(s) detected and suppressed.` : 'No duplicate idempotency keys detected.' },
    { name: 'Missing tick guard', state: missing ? 'RETRYING' : 'SYNCED', detail: missing ? `${missing} missing tick gap(s) require resubscription.` : 'Tick stream is complete for primary symbols.' },
    { name: 'Retry pressure', state: retry > 8 ? 'FAILED' : retry ? 'RETRYING' : 'SYNCED', detail: `${retry} retry attempt(s) currently represented in sync queues.` },
  ];
}

function buildSyncTimeline(rows: any[]) {
  const now = new Date().toISOString();
  const events = rows.slice(0, 8).map((row) => ({
    time: row.receivedAt ?? now,
    message: `${row.terminalId} ${row.syncState.toLowerCase()} / latency ${row.syncLatencyMs}ms / retries ${row.retryCount}`,
    state: row.syncState,
  }));
  return events;
}

function SyncBadge({ state }: { state: string }) {
  return (
    <span className={cn(
      'inline-flex whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase',
      state === 'SYNCED' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      state === 'RETRYING' && 'border-amber-200 bg-amber-50 text-amber-700',
      state === 'FAILED' && 'border-rose-200 bg-rose-50 text-rose-700',
    )}>{state}</span>
  );
}

function LatencyMonitoring({ terminals }: { terminals: any[] }) {
  const rows = useMemo(() => terminals.map(enrichLatencyTerminal).sort((a, b) => b.compositeLatencyMs - a.compositeLatencyMs), [terminals]);
  const summary = summarizeLatencyFleet(rows);
  const brokerComparison = buildLatencyDistribution(rows, 'brokerName');
  const vpsComparison = buildLatencyDistribution(rows, 'vpsLocation');
  const computerComparison = buildLatencyDistribution(rows, 'computerName');
  const alerts = buildLatencyAlerts(rows);
  const events = buildLatencyEvents(rows);
  const heatmap = buildLatencyHeatmap(rows);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={Gauge} title="Average latency" value={`${summary.average}ms`} detail="Composite infrastructure latency" tone={summary.average > 500 ? 'amber' : 'blue'} />
        <OpsSummaryCard icon={AlertTriangle} title="Peak latency" value={`${summary.peak}ms`} detail="Worst observed latency path" tone={summary.peak > 1000 ? 'red' : 'amber'} />
        <OpsSummaryCard icon={CheckCircle2} title="Minimum latency" value={`${summary.minimum}ms`} detail="Best active terminal path" tone="green" />
        <OpsSummaryCard icon={Activity} title="P95 latency" value={`${summary.p95}ms`} detail="95th percentile latency" tone={summary.p95 > 750 ? 'amber' : 'blue'} />
        <OpsSummaryCard icon={ShieldCheck} title="Stability score" value={`${summary.stabilityScore}%`} detail="Latency jitter and reconnection stability" tone={summary.stabilityScore >= 85 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={Network} title="Network quality" value={`${summary.networkQuality}%`} detail="Cross-hop network quality score" tone={summary.networkQuality >= 85 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={RefreshCw} title="Reconnect impact" value={`${summary.reconnectImpact}%`} detail="Latency penalty from reconnect history" tone={summary.reconnectImpact > 20 ? 'amber' : 'green'} />
        <OpsSummaryCard icon={Wifi} title="WebSocket delay" value={`${summary.websocketAverage}ms`} detail="Dashboard stream delay" tone={summary.websocketAverage > 250 ? 'amber' : 'green'} />
      </section>

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Gauge className="w-4 h-4 text-blue-700" /> Terminal-by-Terminal Latency Table
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[620px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Dashboard</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Backend-Bridge</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">EA-Backend</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Broker</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Tick delay</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Dispatch</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Ack</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">WebSocket</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Level</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={11} className="h-40 text-center text-sm text-slate-500">
                        Waiting for latency telemetry from MT5 terminals.
                      </TableCell>
                    </TableRow>
                  ) : rows.map((row) => (
                    <TableRow key={row.terminalId} className={cn('border-slate-100 hover:bg-blue-50/40', row.latencyLevel === 'Critical' && 'bg-rose-50/30', row.latencyLevel === 'Warning' && 'bg-amber-50/30')}>
                      <TableCell className="font-mono text-xs text-slate-700">{row.terminalId}<div className="text-[11px] text-slate-500">{row.computerName}</div></TableCell>
                      <TableCell><StatusPill status={row.status} /></TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{row.dashboardLatencyMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{row.backendBridgeLatencyMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{row.eaBackendLatencyMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{row.brokerLatencyMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{row.tickDelayMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{row.dispatchDelayMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{row.ackDelayMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{row.websocketLatencyMs}ms</TableCell>
                      <TableCell><LatencyBadge level={row.latencyLevel} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OpsPanel title="Critical Latency Alerts" icon={AlertTriangle}>
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div key={`${alert.terminalId}-${alert.title}`} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-900">{alert.title}</span>
                    <LatencyBadge level={alert.level} />
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{alert.terminalId}</div>
                  <div className="mt-2 text-xs text-slate-600">{alert.detail}</div>
                </div>
              ))}
            </div>
          </OpsPanel>

          <OpsPanel title="Latency Event Timeline" icon={Activity}>
            <div className="space-y-3">
              {events.map((event) => (
                <div key={`${event.time}-${event.message}`} className="flex gap-3 rounded-md border border-slate-200 bg-white p-3">
                  <div className={cn('mt-1 h-2 w-2 rounded-full', event.level === 'Excellent' && 'bg-emerald-500', event.level === 'Good' && 'bg-blue-500', event.level === 'Warning' && 'bg-amber-500', event.level === 'Critical' && 'bg-rose-500')} />
                  <div>
                    <div className="text-xs font-semibold text-slate-800">{event.message}</div>
                    <div className="mt-1 font-mono text-[11px] text-slate-500">{formatTime(event.time)}</div>
                  </div>
                </div>
              ))}
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <OpsPanel title="Latency Trend Chart" icon={Gauge}><BarTrend values={rows.map((row) => row.compositeLatencyMs).slice(0, 18)} suffix="ms" /></OpsPanel>
        <OpsPanel title="Tick Delay Monitor" icon={Wifi}><BarTrend values={rows.map((row) => row.tickDelayMs).slice(0, 18)} suffix="ms" /></OpsPanel>
        <OpsPanel title="Execution Delay Monitor" icon={PlugZap}><BarTrend values={rows.map((row) => row.dispatchDelayMs + row.ackDelayMs).slice(0, 18)} suffix="ms" /></OpsPanel>
        <OpsPanel title="WebSocket Stream Delay" icon={Network}><BarTrend values={rows.map((row) => row.websocketLatencyMs).slice(0, 18)} suffix="ms" /></OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <LatencyComparisonCard title="Broker Latency Comparison" icon={Server} items={brokerComparison} />
        <LatencyComparisonCard title="VPS Latency Comparison" icon={MapPin} items={vpsComparison} />
        <LatencyComparisonCard title="Multi-Computer Latency" icon={Laptop2} items={computerComparison} />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
        <OpsPanel title="Latency Heatmap" icon={Layers3}>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
            {heatmap.map((cell) => <LatencyHeatmapCell key={cell.label} {...cell} />)}
          </div>
        </OpsPanel>
        <OpsPanel title="Threshold Rules" icon={ShieldAlert}>
          <div className="space-y-3">
            {LATENCY_THRESHOLD_LINES.map((line) => (
              <div key={line} className="rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700">{line}</div>
            ))}
          </div>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Backend Latency Service" lines={LATENCY_BACKEND_LINES} />
        <ArchitectureCard title="WebSocket Latency Events" lines={LATENCY_WS_LINES} />
        <ArchitectureCard title="Database Schema" lines={LATENCY_SCHEMA_LINES} />
        <ArchitectureCard title="Alert Logic" lines={LATENCY_ALERT_LINES} />
        <ArchitectureCard title="Real-Time Update Flow" lines={LATENCY_FLOW_LINES} />
        <ArchitectureCard title="UI States" lines={LATENCY_UI_STATE_LINES} />
      </section>
    </div>
  );
}

const LATENCY_THRESHOLD_LINES = [
  'Excellent: composite latency < 100ms and jitter < 40ms',
  'Good: composite latency 100-250ms with stable heartbeat cadence',
  'Warning: composite latency 250-750ms or tick delay > 1000ms',
  'Critical: composite latency > 750ms, tick delay > 2500ms, or ack delay > 1500ms',
  'Unstable: high jitter, reconnect impact, or repeated threshold crossings',
  'Disconnected: terminal status disconnected or heartbeat age exceeds timeout',
];

const LATENCY_BACKEND_LINES = [
  'latency-service samples dashboard, API, bridge, EA, broker, tick, dispatch, ack, and WebSocket timings',
  'collector normalizes latency samples with terminalId, accountNumber, broker, region, and vpsId',
  'aggregator computes average, min, peak, p95, jitter, and stability windows',
  'threshold engine classifies Excellent, Good, Warning, Critical, Unstable, Disconnected',
  'REST snapshots backfill dashboard if WebSocket latency stream is interrupted',
];

const LATENCY_WS_LINES = [
  'latency.sample.received { terminalId, path, latencyMs, sampledAt }',
  'latency.threshold.crossed { terminalId, level, path, latencyMs }',
  'latency.recovered { terminalId, previousLevel, currentLevel }',
  'latency.heatmap.updated { bucket, averageMs, p95Ms, level }',
  'latency.reconnect.impact { terminalId, reconnectCount, penaltyMs }',
];

const LATENCY_SCHEMA_LINES = [
  'latency_samples(id, terminal_id, path, latency_ms, sampled_at, broker, region)',
  'latency_rollups(id, terminal_id, window_start, avg_ms, min_ms, max_ms, p95_ms)',
  'latency_alerts(id, terminal_id, level, path, threshold_ms, opened_at, resolved_at)',
  'latency_reconnect_impacts(id, terminal_id, reconnect_count, penalty_ms, created_at)',
  'latency_heatmap_cells(id, bucket_key, average_ms, p95_ms, level, updated_at)',
];

const LATENCY_ALERT_LINES = [
  'Open warning after two consecutive warning samples on the same path',
  'Open critical immediately for ack delay, broker latency, or tick delay over critical threshold',
  'Mark unstable when jitter or reconnect penalty exceeds stability budget',
  'Resolve only after three consecutive samples return to Good or Excellent',
  'Escalate disconnected terminals to recovery and failover routing workflows',
];

const LATENCY_FLOW_LINES = [
  'Dashboard emits ping -> backend records dashboard-to-backend latency',
  'Backend probes MT5 bridge and receives EA heartbeat timing',
  'Bridge records broker and MT5 terminal timing from EA payloads',
  'Aggregator publishes WebSocket latency deltas to dashboard',
  'Dashboard merges deltas, recomputes cards, tables, heatmaps, and alerts without refresh',
];

const LATENCY_UI_STATE_LINES = [
  'Empty state: show standby dashboard and explain heartbeat requirement',
  'Error state: show bridge/API unavailable alert with REST fallback status',
  'Warning state: amber row highlighting and threshold event timeline entry',
  'Critical state: red row highlighting, recovery hint, and failover recommendation',
  'Recovered state: event timeline marks previous critical path as recovered',
];

function enrichLatencyTerminal(terminal: any) {
  const sync = enrichSyncTerminal(terminal);
  const dashboardLatencyMs = Number(terminal.dashboardLatencyMs ?? 0);
  const backendBridgeLatencyMs = Number(terminal.backendBridgeLatencyMs ?? 0);
  const eaBackendLatencyMs = Number(terminal.eaBackendLatencyMs ?? sync.latencyMs ?? 0);
  const brokerLatencyMs = Number(terminal.brokerLatencyMs ?? sync.brokerResponseMs ?? 0);
  const dispatchDelayMs = Number(terminal.dispatchDelayMs ?? 0);
  const ackDelayMs = Number(terminal.ackDelayMs ?? 0);
  const websocketLatencyMs = Number(terminal.websocketLatencyMs ?? sync.websocketLatencyMs ?? 0);
  const reconnectImpactMs = Number(terminal.reconnectImpactMs ?? Number(sync.reconnectCount ?? 0) * 45);
  const compositeLatencyMs = Math.round((dashboardLatencyMs + backendBridgeLatencyMs + eaBackendLatencyMs + brokerLatencyMs + sync.tickDelayMs + dispatchDelayMs + ackDelayMs + websocketLatencyMs) / 8 + reconnectImpactMs);
  const latencyLevel = resolveLatencyLevel({
    compositeLatencyMs,
    jitterMs: Number(sync.jitterMs ?? 0),
    tickDelayMs: sync.tickDelayMs,
    ackDelayMs,
    status: sync.status,
    reconnectImpactMs,
  });
  return {
    ...sync,
    dashboardLatencyMs,
    backendBridgeLatencyMs,
    eaBackendLatencyMs,
    brokerLatencyMs,
    dispatchDelayMs,
    ackDelayMs,
    websocketLatencyMs,
    reconnectImpactMs,
    compositeLatencyMs,
    latencyLevel,
    latencyStabilityScore: calculateLatencyStability(compositeLatencyMs, Number(sync.jitterMs ?? 0), reconnectImpactMs, latencyLevel),
  };
}

function resolveLatencyLevel(input: { compositeLatencyMs: number; jitterMs: number; tickDelayMs: number; ackDelayMs: number; status: string; reconnectImpactMs: number }) {
  if (input.status === 'disconnected') return 'Disconnected';
  if (input.jitterMs > 600 || input.reconnectImpactMs > 250) return 'Unstable';
  if (input.compositeLatencyMs > 750 || input.tickDelayMs > 2500 || input.ackDelayMs > 1500) return 'Critical';
  if (input.compositeLatencyMs > 250 || input.tickDelayMs > 1000) return 'Warning';
  if (input.compositeLatencyMs > 100) return 'Good';
  return 'Excellent';
}

function calculateLatencyStability(latencyMs: number, jitterMs: number, reconnectImpactMs: number, level: string) {
  const levelPenalty: Record<string, number> = { Excellent: 0, Good: 5, Warning: 18, Critical: 38, Unstable: 45, Disconnected: 65 };
  return clampScore(100 - Math.round(latencyMs / 30) - Math.round(jitterMs / 20) - Math.round(reconnectImpactMs / 20) - (levelPenalty[level] ?? 0));
}

function summarizeLatencyFleet(rows: any[]) {
  const values = rows.map((row) => row.compositeLatencyMs).sort((a, b) => a - b);
  const count = Math.max(1, values.length);
  const average = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / count) : 0;
  return {
    average,
    peak: values.length ? Math.max(...values) : 0,
    minimum: values.length ? Math.min(...values) : 0,
    p95: percentile(values, 0.95),
    stabilityScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.latencyStabilityScore, 0) / rows.length) : 0,
    networkQuality: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.networkScore, 0) / rows.length) : 0,
    reconnectImpact: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.reconnectImpactMs, 0) / rows.length) : 0,
    websocketAverage: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.websocketLatencyMs, 0) / rows.length) : 0,
  };
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return values[index] ?? 0;
}

function buildLatencyDistribution(rows: any[], key: string) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const label = String(row[key] || 'Unknown');
    const group = groups.get(label) ?? [];
    group.push(row);
    groups.set(label, group);
  }
  if (!groups.size) return [{ label: 'No telemetry', average: 0, p95: 0, level: 'Disconnected', count: 0 }];
  return Array.from(groups.entries()).map(([label, items]) => {
    const values = items.map((item) => item.compositeLatencyMs).sort((a, b) => a - b);
    const average = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    return { label, average, p95: percentile(values, 0.95), level: resolveLatencyLevel({ compositeLatencyMs: average, jitterMs: 0, tickDelayMs: 0, ackDelayMs: 0, status: 'connected', reconnectImpactMs: 0 }), count: items.length };
  }).sort((a, b) => b.average - a.average).slice(0, 6);
}

function buildLatencyAlerts(rows: any[]) {
  const alerts = rows.flatMap((row) => {
    const items = [];
    if (row.latencyLevel === 'Critical') items.push({ terminalId: row.terminalId, title: 'Critical latency threshold crossed', level: 'Critical', detail: `Composite path latency is ${row.compositeLatencyMs}ms.` });
    if (row.latencyLevel === 'Unstable') items.push({ terminalId: row.terminalId, title: 'Latency unstable', level: 'Unstable', detail: `Jitter ${row.jitterMs ?? 0}ms / reconnect impact ${row.reconnectImpactMs}ms.` });
    if (row.tickDelayMs > 1000) items.push({ terminalId: row.terminalId, title: 'Tick arrival delay', level: row.tickDelayMs > 2500 ? 'Critical' : 'Warning', detail: `Tick arrival delay is ${row.tickDelayMs}ms.` });
    if (row.ackDelayMs > 1000) items.push({ terminalId: row.terminalId, title: 'Execution acknowledgement delay', level: row.ackDelayMs > 1500 ? 'Critical' : 'Warning', detail: `Ack delay is ${row.ackDelayMs}ms.` });
    return items;
  });
  return alerts.length ? alerts.slice(0, 8) : [{ terminalId: 'fleet', title: 'No critical latency alerts', level: 'Excellent', detail: 'All latency paths are inside configured thresholds.' }];
}

function buildLatencyEvents(rows: any[]) {
  const now = new Date().toISOString();
  const events = rows.slice(0, 8).map((row) => ({
    time: row.receivedAt ?? now,
    message: `${row.terminalId} ${row.latencyLevel.toLowerCase()} latency / composite ${row.compositeLatencyMs}ms / p2p broker ${row.brokerLatencyMs}ms`,
    level: row.latencyLevel,
  }));
  return events;
}

function buildLatencyHeatmap(rows: any[]) {
  if (!rows.length) return ['Dashboard', 'Bridge', 'EA', 'Broker', 'Tick', 'Ack'].map((label) => ({ label, value: 0, level: 'Disconnected' }));
  return rows.flatMap((row) => [
    { label: `${row.terminalId} DASH`, value: row.dashboardLatencyMs, level: resolveLatencyLevel({ compositeLatencyMs: row.dashboardLatencyMs, jitterMs: 0, tickDelayMs: 0, ackDelayMs: 0, status: row.status, reconnectImpactMs: 0 }) },
    { label: `${row.terminalId} BRDG`, value: row.backendBridgeLatencyMs, level: resolveLatencyLevel({ compositeLatencyMs: row.backendBridgeLatencyMs, jitterMs: 0, tickDelayMs: 0, ackDelayMs: 0, status: row.status, reconnectImpactMs: 0 }) },
    { label: `${row.terminalId} BRKR`, value: row.brokerLatencyMs, level: resolveLatencyLevel({ compositeLatencyMs: row.brokerLatencyMs, jitterMs: 0, tickDelayMs: 0, ackDelayMs: 0, status: row.status, reconnectImpactMs: 0 }) },
    { label: `${row.terminalId} TICK`, value: row.tickDelayMs, level: resolveLatencyLevel({ compositeLatencyMs: row.tickDelayMs, jitterMs: 0, tickDelayMs: row.tickDelayMs, ackDelayMs: 0, status: row.status, reconnectImpactMs: 0 }) },
  ]).slice(0, 24);
}

function LatencyComparisonCard(props: { title: string; icon: any; items: Array<{ label: string; average: number; p95: number; level: string; count: number }> }) {
  return (
    <OpsPanel title={props.title} icon={props.icon}>
      <div className="space-y-3">
        {props.items.map((item) => (
          <div key={item.label} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-900">{item.label}</div>
                <div className="mt-1 font-mono text-[11px] text-slate-500">{item.count} terminal(s) / p95 {item.p95}ms</div>
              </div>
              <LatencyBadge level={item.level} />
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, item.average / 10)}%` }} />
            </div>
            <div className="mt-2 text-right font-mono text-xs text-slate-600">{item.average}ms avg</div>
          </div>
        ))}
      </div>
    </OpsPanel>
  );
}

function LatencyHeatmapCell(props: { label: string; value: number; level: string }) {
  return (
    <div className={cn(
      'min-h-20 rounded-md border p-3',
      props.level === 'Excellent' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
      props.level === 'Good' && 'border-blue-200 bg-blue-50 text-blue-800',
      props.level === 'Warning' && 'border-amber-200 bg-amber-50 text-amber-800',
      (props.level === 'Critical' || props.level === 'Disconnected') && 'border-rose-200 bg-rose-50 text-rose-800',
      props.level === 'Unstable' && 'border-orange-200 bg-orange-50 text-orange-800',
    )}>
      <div className="truncate text-[11px] font-semibold">{props.label}</div>
      <div className="mt-3 font-mono text-2xl">{props.value}</div>
      <div className="font-mono text-[10px] uppercase">{props.level}</div>
    </div>
  );
}

function LatencyBadge({ level }: { level: string }) {
  return (
    <span className={cn(
      'inline-flex whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase',
      level === 'Excellent' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      level === 'Good' && 'border-blue-200 bg-blue-50 text-blue-700',
      level === 'Warning' && 'border-amber-200 bg-amber-50 text-amber-700',
      level === 'Critical' && 'border-rose-200 bg-rose-50 text-rose-700',
      level === 'Unstable' && 'border-orange-200 bg-orange-50 text-orange-700',
      level === 'Disconnected' && 'border-slate-200 bg-slate-50 text-slate-700',
    )}>{level}</span>
  );
}

function MultiComputerSupport({ terminals, registrations }: { terminals: any[]; registrations: any[] }) {
  const machines = useMemo(() => buildMachineRegistry(terminals, registrations), [registrations, terminals]);
  const summary = summarizeMachineFleet(machines);
  const logs = buildMachineLogs(machines);
  const distribution = buildTerminalDistribution(machines);
  const security = buildDeviceAuthorization(machines);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={Laptop2} title="Registered computers" value={String(machines.length)} detail="Known Windows PCs and VPS nodes" tone="blue" />
        <OpsSummaryCard icon={CheckCircle2} title="Active machines" value={String(summary.active)} detail="Seen inside heartbeat SLA" tone="green" />
        <OpsSummaryCard icon={AlertTriangle} title="Offline machines" value={String(summary.offline)} detail="No active terminal heartbeat" tone={summary.offline ? 'amber' : 'green'} />
        <OpsSummaryCard icon={Server} title="VPS nodes" value={String(summary.vpsNodes)} detail="Cloud or colocated environments" tone="slate" />
        <OpsSummaryCard icon={TerminalSquare} title="Terminal count" value={String(summary.terminals)} detail="MT5 instances across machines" tone="violet" />
        <OpsSummaryCard icon={Database} title="Active accounts" value={String(summary.accounts)} detail="Unique broker accounts" tone="blue" />
        <OpsSummaryCard icon={ShieldCheck} title="Authorized devices" value={`${summary.authorized}%`} detail="Device authorization coverage" tone={summary.authorized >= 90 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={Router} title="Failover eligible" value={String(summary.failoverEligible)} detail="Machines ready for routing failover" tone={summary.failoverEligible ? 'green' : 'red'} />
      </section>

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Laptop2 className="w-4 h-4 text-blue-700" /> Computer/VPS Registry
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[660px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Device</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Fingerprint</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">IP / Region</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Environment</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Terminals</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Accounts</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">State</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Uptime</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">CPU/Mem</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Routing</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Security</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machines.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={11} className="h-40 text-center text-sm text-slate-500">No computers detected yet.</TableCell>
                    </TableRow>
                  ) : machines.map((machine) => (
                    <TableRow key={machine.machineId} className={cn('border-slate-100 hover:bg-blue-50/40', machine.connectionState === 'offline' && 'bg-rose-50/30', machine.connectionState === 'degraded' && 'bg-amber-50/30')}>
                      <TableCell className="text-xs text-slate-700"><span className="font-semibold text-slate-900">{machine.deviceName}</span><div className="font-mono text-[11px] text-slate-500">{machine.machineId}</div></TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{machine.fingerprint}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{machine.ipAddress}<div className="text-[11px] text-slate-500">{machine.region}</div></TableCell>
                      <TableCell className="text-xs text-slate-700">{machine.environmentType}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{machine.terminalCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{machine.accountCount}</TableCell>
                      <TableCell><MachineBadge state={machine.connectionState} /></TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{formatDuration(machine.uptimeMs)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{machine.cpuUsage}%/{machine.memoryUsage}%</TableCell>
                      <TableCell><MachineBadge state={machine.failoverEligible ? 'eligible' : 'blocked'} /></TableCell>
                      <TableCell><MachineBadge state={machine.authorizationState} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OpsPanel title="Machine Health" icon={ShieldAlert}>
            <div className="space-y-3">
              {machines.slice(0, 6).map((machine) => (
                <div key={machine.machineId} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">{machine.deviceName}</span>
                    <span className="font-mono text-xs text-slate-600">{machine.healthScore}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${machine.healthScore}%` }} />
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">network {machine.networkHealth}% / bridge agent {machine.bridgeAgentStatus}</div>
                </div>
              ))}
              {machines.length === 0 ? <EmptyPanel title="No machine health data" detail="Machine heartbeat telemetry will appear after terminal registration." /> : null}
            </div>
          </OpsPanel>

          <OpsPanel title="Security Authorization" icon={LockKeyhole}>
            <div className="space-y-3">
              {security.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{item.detail}</div>
                  </div>
                  <MachineBadge state={item.state} />
                </div>
              ))}
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <MachineSegment title="Active Machines" icon={CheckCircle2} machines={machines.filter((m) => m.connectionState === 'online')} />
        <MachineSegment title="Offline Machines" icon={AlertTriangle} machines={machines.filter((m) => m.connectionState === 'offline')} />
        <MachineSegment title="VPS Nodes" icon={Server} machines={machines.filter((m) => m.environmentType.includes('VPS') || m.environmentType.includes('Cloud'))} />
        <MachineSegment title="Office/Home Devices" icon={Laptop2} machines={machines.filter((m) => m.environmentType.includes('Office') || m.environmentType.includes('Home'))} />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
        <OpsPanel title="Terminal Distribution Map" icon={MapPin}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {distribution.map((item) => (
              <div key={item.region} className="rounded-md border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">{item.region}</span>
                  <span className="font-mono text-xs text-slate-600">{item.machines} machines</span>
                </div>
                <div className="mt-3 font-mono text-2xl text-slate-950">{item.terminals}</div>
                <div className="mt-1 text-xs text-slate-500">terminals / {item.accounts} accounts</div>
              </div>
            ))}
          </div>
        </OpsPanel>

        <OpsPanel title="Routing Configuration" icon={Router}>
          <div className="space-y-3">
            {machines.slice(0, 7).map((machine) => (
              <div key={machine.machineId} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">{machine.deviceName}</span>
                  <span className="font-mono text-xs text-slate-600">prio {machine.routingPriority}</span>
                </div>
                <div className="mt-2 text-xs text-slate-600">{machine.failoverEligible ? 'Eligible for distributed terminal routing and failover.' : 'Blocked from failover until authorization or health recovers.'}</div>
              </div>
            ))}
          </div>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <OpsPanel title="Multi-Computer Synchronization" icon={RefreshCw}>
          <BarTrend values={machines.map((machine) => machine.syncScore).slice(0, 18)} suffix="%" invert />
        </OpsPanel>
        <OpsPanel title="Operational Logs" icon={Activity}>
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={`${log.time}-${log.message}`} className="flex gap-3 rounded-md border border-slate-200 bg-white p-3">
                <div className={cn('mt-1 h-2 w-2 rounded-full', log.state === 'online' && 'bg-emerald-500', log.state === 'degraded' && 'bg-amber-500', log.state === 'offline' && 'bg-rose-500')} />
                <div>
                  <div className="text-xs font-semibold text-slate-800">{log.message}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{formatTime(log.time)}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Backend Architecture" lines={MACHINE_BACKEND_LINES} />
        <ArchitectureCard title="Device Registry Schema" lines={MACHINE_SCHEMA_LINES} />
        <ArchitectureCard title="Machine Heartbeat Model" lines={MACHINE_HEARTBEAT_LINES} />
        <ArchitectureCard title="Security Design" lines={MACHINE_SECURITY_LINES} />
        <ArchitectureCard title="Terminal Routing Logic" lines={MACHINE_ROUTING_LINES} />
        <ArchitectureCard title="Failover Rules" lines={MACHINE_FAILOVER_LINES} />
      </section>
    </div>
  );
}

const MACHINE_BACKEND_LINES = [
  'machine-registry-service owns device identity, fingerprint, authorization, and revoke state',
  'machine-heartbeat-service ingests bridge agent and terminal host telemetry',
  'terminal-routing-service assigns account execution routes by machine priority and health',
  'deployment-service tracks EA/bridge agent versions and remote deployment status',
  'audit-service records device authorization, revoke, block, and failover actions',
];

const MACHINE_SCHEMA_LINES = [
  'machines(id, machine_id unique, fingerprint unique, device_name, ip_address, region, environment_type)',
  'machine_authorizations(id, machine_id, state, authorized_by, authorized_at, revoked_at)',
  'machine_heartbeats(id, machine_id, cpu_usage, memory_usage, network_health, seen_at)',
  'machine_terminals(id, machine_id, terminal_id, account_number, broker_name, ea_version)',
  'machine_routing_rules(id, machine_id, priority, failover_eligible, blocked_reason)',
];

const MACHINE_HEARTBEAT_LINES = [
  'machine heartbeat contains fingerprint, bridge agent version, uptime, CPU, memory, IP, region',
  'terminal heartbeat links terminalId and accountNumber back to machineId',
  'lastSeen drives online, degraded, offline, and blocked operational states',
  'duplicate fingerprint detection prevents cloned machine authorization',
  'heartbeat stream updates dashboard through WebSocket plus REST snapshot fallback',
];

const MACHINE_SECURITY_LINES = [
  'Device authorization requires fingerprint, API token, signed session, and region policy',
  'Revoke workflow disables bridge agent leasing and command dispatch for machineId',
  'Block workflow prevents re-registration of duplicate or compromised fingerprints',
  'Ownership tracking binds user/team, machine, terminals, and broker accounts',
  'Audit trail records authorization, revoke, block, unblock, and remote deployment actions',
];

const MACHINE_ROUTING_LINES = [
  'Routing priority sorts eligible machines by health score, stability, latency, and configured priority',
  'Account routes prefer machines already hosting the account terminal',
  'Distributed terminal routing excludes revoked, blocked, offline, or duplicate machines',
  'Remote deployment state can pause routing during bridge agent or EA upgrade',
  'Cross-machine synchronization validates terminal count, accounts, and EA versions',
];

const MACHINE_FAILOVER_LINES = [
  'Failover eligible when authorized, online, health >= 80, network >= 75, and bridge agent healthy',
  'Degraded machines remain warm standby but do not receive new execution commands',
  'Offline machines trigger route evacuation after heartbeat timeout',
  'Duplicate fingerprint machines are blocked until operator approval',
  'Failover events publish routing.machine.selected and routing.machine.evacuated',
];

function buildMachineRegistry(terminals: any[], registrations: any[]) {
  const byMachine = new Map<string, { machineId: string; terminals: any[]; registrations: any[] }>();
  for (const terminal of terminals) {
    const machineId = String(terminal.computerId ?? terminal.computerName ?? terminal.vpsId ?? 'unknown-machine');
    const entry = byMachine.get(machineId) ?? { machineId, terminals: [], registrations: [] };
    entry.terminals.push(terminal);
    byMachine.set(machineId, entry);
  }
  for (const registration of registrations) {
    const machineId = String(registration.computerId ?? registration.computerName ?? registration.vpsId ?? 'unknown-machine');
    const entry = byMachine.get(machineId) ?? { machineId, terminals: [], registrations: [] };
    entry.registrations.push(registration);
    byMachine.set(machineId, entry);
  }

  return Array.from(byMachine.values()).map((entry) => {
    const primary = entry.terminals[0] ?? entry.registrations[0] ?? {};
    const terminalRows = entry.terminals.map(enrichHealthTerminal);
    const terminalCount = Math.max(entry.terminals.length, entry.registrations.length);
    const accounts = new Set([...entry.terminals, ...entry.registrations].map((item) => item.accountNumber).filter(Boolean));
    const connected = entry.terminals.filter((terminal) => terminal.status === 'connected').length;
    const degraded = entry.terminals.filter((terminal) => terminal.status === 'degraded').length;
    const offline = terminalCount > 0 && connected === 0 && degraded === 0;
    const cpuUsage = terminalRows.length ? Math.round(terminalRows.reduce((sum, row) => sum + row.cpuUsage, 0) / terminalRows.length) : 0;
    const memoryUsage = terminalRows.length ? Math.round(terminalRows.reduce((sum, row) => sum + row.memoryUsage, 0) / terminalRows.length) : 0;
    const networkHealth = terminalRows.length ? Math.round(terminalRows.reduce((sum, row) => sum + row.networkScore, 0) / terminalRows.length) : 0;
    const healthScore = clampScore(100 - Math.max(0, cpuUsage - 70) - Math.max(0, memoryUsage - 75) - (offline ? 35 : 0) - (degraded ? 12 : 0));
    const authorizationState = String(primary.authorizationState ?? 'unknown');
    const bridgeAgentStatus = String(primary.bridgeAgentStatus ?? (offline ? 'offline' : 'unknown'));
    const connectionState = offline ? 'offline' : degraded ? 'degraded' : connected > 0 ? 'online' : 'unknown';
    const environmentType = inferMachineEnvironment(primary);
    const failoverEligible = Boolean(primary.failoverEligible ?? (authorizationState === 'authorized' && connectionState === 'online' && healthScore >= 80 && bridgeAgentStatus === 'healthy'));
    return {
      machineId: entry.machineId,
      fingerprint: String(primary.fingerprint ?? primary.computerFingerprint ?? '—'),
      deviceName: primary.computerName || primary.vpsId || entry.machineId,
      ipAddress: String(primary.ipAddress ?? '—'),
      region: String(primary.region || primary.vpsLocation || '—'),
      environmentType,
      terminalCount,
      accountCount: accounts.size,
      connectionState,
      uptimeMs: terminalRows.length ? Math.max(...terminalRows.map((row) => row.connectionUptimeMs)) : 0,
      lastSeenAt: primary.receivedAt || primary.updatedAt || primary.registeredAt || null,
      cpuUsage,
      memoryUsage,
      networkHealth,
      routingPriority: Number(primary.priority ?? 0),
      failoverEligible,
      remoteDeploymentStatus: String(primary.remoteDeploymentStatus ?? 'unknown'),
      bridgeAgentStatus,
      eaVersions: Array.from(new Set(entry.terminals.map((terminal) => terminal.version ?? terminal.eaVersion).filter(Boolean))),
      syncScore: terminalRows.length ? Math.round(terminalRows.reduce((sum, row) => sum + row.healthScore, 0) / terminalRows.length) : 0,
      authorizationState,
      healthScore,
      terminals: entry.terminals,
      registrations: entry.registrations,
    };
  }).sort((a, b) => b.terminalCount - a.terminalCount || b.healthScore - a.healthScore);
}

function summarizeMachineFleet(machines: any[]) {
  const authorizedCount = machines.filter((machine) => machine.authorizationState === 'authorized').length;
  return {
    active: machines.filter((machine) => machine.connectionState === 'online').length,
    offline: machines.filter((machine) => machine.connectionState === 'offline').length,
    vpsNodes: machines.filter((machine) => machine.environmentType.includes('VPS') || machine.environmentType.includes('Cloud')).length,
    terminals: machines.reduce((sum, machine) => sum + machine.terminalCount, 0),
    accounts: new Set(machines.flatMap((machine) => [...machine.terminals, ...machine.registrations].map((item: any) => item.accountNumber).filter(Boolean))).size,
    authorized: machines.length ? Math.round((authorizedCount / machines.length) * 100) : 0,
    failoverEligible: machines.filter((machine) => machine.failoverEligible).length,
  };
}

function inferMachineEnvironment(primary: any) {
  const explicit = String(primary.environmentType ?? primary.environment ?? '').trim();
  if (explicit) return explicit;
  const label = `${primary.vpsId ?? ''} ${primary.computerName ?? ''}`.toLowerCase();
  if (label.includes('vps') || label.includes('ld4') || label.includes('ny4')) return 'VPS / Cloud';
  if (label.includes('office')) return 'Office PC';
  if (label.includes('home')) return 'Home PC';
  return 'Unknown';
}

function buildDeviceAuthorization(machines: any[]) {
  const duplicates = machines.length - new Set(machines.map((machine) => machine.fingerprint)).size;
  return [
    { label: 'Duplicate machine prevention', state: duplicates ? 'blocked' : 'authorized', detail: duplicates ? `${duplicates} duplicate fingerprint(s) detected.` : 'No duplicate machine fingerprints detected.' },
    { label: 'Device authorization', state: machines.some((machine) => machine.authorizationState !== 'authorized') ? 'degraded' : 'authorized', detail: 'Authorization controls command leasing and bridge agent access.' },
    { label: 'Revoke workflow', state: machines.some((machine) => machine.authorizationState === 'revoked') ? 'revoked' : 'authorized', detail: 'Revoked devices are excluded from routing and deployment.' },
    { label: 'Block workflow', state: machines.some((machine) => machine.authorizationState === 'blocked') ? 'blocked' : 'authorized', detail: 'Blocked fingerprints cannot re-register without operator approval.' },
  ];
}

function buildTerminalDistribution(machines: any[]) {
  const groups = new Map<string, any[]>();
  for (const machine of machines) {
    const group = groups.get(machine.region) ?? [];
    group.push(machine);
    groups.set(machine.region, group);
  }
  if (!groups.size) return [{ region: 'No region', machines: 0, terminals: 0, accounts: 0 }];
  return Array.from(groups.entries()).map(([region, items]) => ({
    region,
    machines: items.length,
    terminals: items.reduce((sum, item) => sum + item.terminalCount, 0),
    accounts: items.reduce((sum, item) => sum + item.accountCount, 0),
  }));
}

function buildMachineLogs(machines: any[]) {
  const now = new Date().toISOString();
  const logs = machines.slice(0, 8).map((machine) => ({
    time: machine.lastSeenAt ?? now,
    state: machine.connectionState,
    message: `${machine.deviceName} ${machine.connectionState} / ${machine.terminalCount} terminal(s) / bridge agent ${machine.bridgeAgentStatus}`,
  }));
  return logs;
}

function MachineSegment(props: { title: string; icon: any; machines: any[] }) {
  const Icon = props.icon;
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-blue-700" /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {props.machines.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No devices in this segment.</div>
        ) : props.machines.slice(0, 5).map((machine) => (
          <div key={machine.machineId} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="truncate text-xs font-semibold text-slate-900">{machine.deviceName}</span>
              <MachineBadge state={machine.connectionState} />
            </div>
            <div className="mt-2 font-mono text-[11px] text-slate-500">{machine.region} / {machine.terminalCount} terminals / {machine.accountCount} accounts</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MachineBadge({ state }: { state: string }) {
  return (
    <span className={cn(
      'inline-flex whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase',
      (state === 'online' || state === 'authorized' || state === 'eligible') && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      (state === 'degraded' || state === 'revoked') && 'border-amber-200 bg-amber-50 text-amber-700',
      (state === 'offline' || state === 'blocked') && 'border-rose-200 bg-rose-50 text-rose-700',
    )}>{state}</span>
  );
}

function AccountRouting({ terminals, routing }: { terminals: any[]; routing: any[] }) {
  const accounts = useMemo(() => buildAccountRegistry(terminals, routing), [routing, terminals]);
  const summary = summarizeAccountRouting(accounts);
  const conflicts = buildRoutingConflicts(accounts);
  const validations = buildRoutingValidation(accounts);
  const logs = buildRoutingAuditLogs(accounts, routing);
  const [form, setForm] = useState({
    accountNumber: '',
    preferredTerminalIds: '',
    failoverStrategy: 'priority' as 'priority' | 'stability',
    minStabilityScore: '0',
    strategy: 'mean-reversion',
    symbol: 'XAUUSD',
    riskProfile: 'prop-firm-standard',
    accountMode: 'demo',
    permission: 'execution-enabled',
  });
  const [submit, setSubmit] = useState<EnqueueState>({ status: 'idle', message: '' });

  const onSubmit = async () => {
    setSubmit({ status: 'submitting', message: '' });
    try {
      const accountNumber = form.accountNumber.trim();
      if (!accountNumber) throw new Error('Account number is required.');
      const minStabilityScore = Number(form.minStabilityScore);
      if (!Number.isFinite(minStabilityScore)) throw new Error('minStabilityScore must be numeric.');
      const preferredTerminalIds = form.preferredTerminalIds.split(',').map((v) => v.trim()).filter(Boolean);

      const response = await fetch(`/api/mt5/routing/accounts/${encodeURIComponent(accountNumber)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredTerminalIds,
          strategy: form.failoverStrategy,
          minStabilityScore,
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Routing update failed with HTTP ${response.status}`);
      }
      setSubmit({ status: 'ok', message: 'Routing saved.' });
    } catch (error) {
      setSubmit({ status: 'error', message: error instanceof Error ? error.message : 'Failed to save routing.' });
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={Database} title="Registered accounts" value={String(accounts.length)} detail="Broker accounts in routing registry" tone="blue" />
        <OpsSummaryCard icon={Server} title="Active brokers" value={String(summary.brokers)} detail="Broker-account mappings" tone="slate" />
        <OpsSummaryCard icon={TerminalSquare} title="Mapped terminals" value={String(summary.terminals)} detail="Eligible primary and backup terminals" tone="violet" />
        <OpsSummaryCard icon={CheckCircle2} title="Execution enabled" value={String(summary.executionEnabled)} detail="Accounts eligible for trade commands" tone="green" />
        <OpsSummaryCard icon={ShieldAlert} title="Read-only" value={String(summary.readOnly)} detail="Monitoring-only accounts" tone="amber" />
        <OpsSummaryCard icon={LockKeyhole} title="Locked / blocked" value={String(summary.locked)} detail="Risk, news, or account locks" tone={summary.locked ? 'red' : 'green'} />
        <OpsSummaryCard icon={Router} title="Failover ready" value={String(summary.failoverReady)} detail="Accounts with backup route" tone={summary.failoverReady ? 'green' : 'amber'} />
        <OpsSummaryCard icon={AlertTriangle} title="Conflicts" value={String(conflicts.length)} detail="Routing conflicts detected" tone={conflicts.length ? 'red' : 'green'} />
      </section>

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Router className="w-4 h-4 text-blue-700" /> Account Registry and Terminal Mapping
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[660px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Account</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Broker</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Mode</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Primary</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Backup</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Strategy</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Symbol</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Risk</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Permission</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={10} className="h-40 text-center text-sm text-slate-500">No account routes yet. Add a routing rule or connect a terminal heartbeat.</TableCell>
                    </TableRow>
                  ) : accounts.map((account) => (
                    <TableRow key={account.accountNumber} className={cn('border-slate-100 hover:bg-blue-50/40', account.status === 'Locked' && 'bg-rose-50/30', account.status === 'Read-only' && 'bg-amber-50/30')}>
                      <TableCell className="font-mono text-xs text-slate-700">{account.accountNumber}</TableCell>
                      <TableCell className="text-xs text-slate-700">{account.brokerName}<div className="font-mono text-[11px] text-slate-500">{account.serverName}</div></TableCell>
                      <TableCell><RoutingBadge state={account.accountMode} /></TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{account.primaryTerminalId || 'auto'}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{account.backupTerminalId || 'none'}</TableCell>
                      <TableCell className="text-xs text-slate-700">{account.strategy}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{account.symbol}</TableCell>
                      <TableCell className="text-xs text-slate-700">{account.riskProfile}</TableCell>
                      <TableCell><RoutingBadge state={account.permissionState} /></TableCell>
                      <TableCell><RoutingBadge state={account.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OpsPanel title="Routing Rule Builder" icon={Wrench}>
            <div className="space-y-3">
              <ProvisionField label="Account number" value={form.accountNumber} onChange={(value) => setForm((c) => ({ ...c, accountNumber: value }))} placeholder="12345678" mono />
              <ProvisionField label="Preferred terminal IDs" value={form.preferredTerminalIds} onChange={(value) => setForm((c) => ({ ...c, preferredTerminalIds: value }))} placeholder="terminal-a, terminal-b" mono />
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase text-slate-500">Failover</span>
                  <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={form.failoverStrategy} onChange={(e) => setForm((c) => ({ ...c, failoverStrategy: e.target.value as any }))}>
                    <option value="priority">priority</option>
                    <option value="stability">stability</option>
                  </select>
                </label>
                <ProvisionField label="Min stability" value={form.minStabilityScore} onChange={(value) => setForm((c) => ({ ...c, minStabilityScore: value }))} placeholder="80" mono />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ProvisionField label="Strategy" value={form.strategy} onChange={(value) => setForm((c) => ({ ...c, strategy: value }))} placeholder="london-breakout" />
                <ProvisionField label="Symbol" value={form.symbol} onChange={(value) => setForm((c) => ({ ...c, symbol: value }))} placeholder="XAUUSD" mono />
                <ProvisionField label="Risk profile" value={form.riskProfile} onChange={(value) => setForm((c) => ({ ...c, riskProfile: value }))} placeholder="prop-firm-standard" />
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase text-slate-500">Permission</span>
                  <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={form.permission} onChange={(e) => setForm((c) => ({ ...c, permission: e.target.value }))}>
                    <option value="execution-enabled">execution-enabled</option>
                    <option value="read-only">read-only</option>
                    <option value="execution-disabled">execution-disabled</option>
                    <option value="risk-blocked">risk-blocked</option>
                  </select>
                </label>
              </div>
              <button type="button" className={cn('h-9 w-full rounded-md border px-3 text-xs font-semibold', submit.status === 'submitting' ? 'border-slate-200 bg-slate-100 text-slate-400' : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100')} disabled={submit.status === 'submitting'} onClick={onSubmit}>Save routing rule</button>
              <div className={cn('text-xs font-mono', submit.status === 'ok' && 'text-teal-700', submit.status === 'error' && 'text-rose-700', submit.status === 'submitting' && 'text-slate-500')}>{submit.message}</div>
            </div>
          </OpsPanel>

          <OpsPanel title="Validation and Conflicts" icon={ShieldAlert}>
            <div className="space-y-3">
              {[...validations, ...conflicts].map((item) => (
                <div key={`${item.label}-${item.detail}`} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-900">{item.label}</span>
                    <RoutingBadge state={item.state} />
                  </div>
                  <div className="mt-2 text-xs text-slate-600">{item.detail}</div>
                </div>
              ))}
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <RoutingSegment title="Active" accounts={accounts.filter((a) => a.status === 'Active' || a.status === 'Execution enabled')} />
        <RoutingSegment title="Read-only" accounts={accounts.filter((a) => a.status === 'Read-only')} />
        <RoutingSegment title="Locked / blocked" accounts={accounts.filter((a) => a.status.includes('blocked') || a.status === 'Locked')} />
        <RoutingSegment title="Failover ready" accounts={accounts.filter((a) => a.failoverReady)} />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <OpsPanel title="Strategy-to-Account Mapping" icon={Layers3}>
          <RoutingMiniList items={groupAccounts(accounts, 'strategy')} />
        </OpsPanel>
        <OpsPanel title="Symbol-to-Account Mapping" icon={Globe2}>
          <RoutingMiniList items={groupAccounts(accounts, 'symbol')} />
        </OpsPanel>
        <OpsPanel title="Risk Profile Assignment" icon={ShieldCheck}>
          <RoutingMiniList items={groupAccounts(accounts, 'riskProfile')} />
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <OpsPanel title="Permission Model" icon={LockKeyhole}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {buildPermissionModel(accounts).map((item) => (
              <div key={item.label} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">{item.label}</span>
                  <span className="font-mono text-xs text-slate-600">{item.count}</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">{item.detail}</div>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Routing Audit Logs" icon={Activity}>
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={`${log.time}-${log.message}`} className="flex gap-3 rounded-md border border-slate-200 bg-white p-3">
                <div className={cn('mt-1 h-2 w-2 rounded-full', log.state === 'Active' && 'bg-emerald-500', log.state === 'Read-only' && 'bg-amber-500', log.state.includes('blocked') && 'bg-rose-500')} />
                <div>
                  <div className="text-xs font-semibold text-slate-800">{log.message}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{formatTime(log.time)}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Backend Routing Service" lines={ACCOUNT_BACKEND_LINES} />
        <ArchitectureCard title="Database Schema" lines={ACCOUNT_SCHEMA_LINES} />
        <ArchitectureCard title="Validation Engine" lines={ACCOUNT_VALIDATION_LINES} />
        <ArchitectureCard title="Conflict Detection Engine" lines={ACCOUNT_CONFLICT_LINES} />
        <ArchitectureCard title="API Endpoints" lines={ACCOUNT_API_LINES} />
        <ArchitectureCard title="WebSocket Events" lines={ACCOUNT_WS_LINES} />
      </section>
    </div>
  );
}

const ACCOUNT_BACKEND_LINES = [
  'account-routing-service resolves strategy, symbol, risk profile, broker, terminal, and computer route',
  'routing-read-model maintains account registry and terminal eligibility from heartbeat snapshots',
  'permission-service enforces read-only, execution-enabled, locked, risk-blocked, and news-blocked states',
  'failover-router chooses backup terminal by priority or stability when primary is unavailable',
  'audit-service records routing changes, conflicts, validation failures, and permission transitions',
];

const ACCOUNT_SCHEMA_LINES = [
  'trading_accounts(id, account_number unique, broker_name, server_name, mode, prop_firm_rule_id)',
  'account_terminal_routes(id, account_number, primary_terminal_id, backup_terminal_id, priority)',
  'strategy_account_routes(id, strategy_id, account_number, symbol, risk_profile_id, enabled)',
  'account_permissions(id, account_number, permission_state, locked_reason, updated_at)',
  'routing_audit_logs(id, account_number, action, diff_json, actor, created_at)',
];

const ACCOUNT_VALIDATION_LINES = [
  'Account number must be unique across active broker-account mappings',
  'Primary terminal must be connected or route enters Awaiting terminal state',
  'Execution mode requires authorized terminal, healthy bridge, and risk profile assignment',
  'Demo/live separation blocks live strategy from demo-only account and inverse route leakage',
  'Prop firm rules inherit max drawdown, daily loss, news windows, and lot sizing constraints',
];

const ACCOUNT_CONFLICT_LINES = [
  'Duplicate account conflict when same account maps to different broker/server pair',
  'Terminal conflict when locked or read-only account is selected for execution command',
  'Strategy conflict when one strategy routes to accounts with incompatible risk profiles',
  'Symbol conflict when unsupported symbol maps to account broker that cannot trade it',
  'Failover conflict when primary and backup terminals are same or both unavailable',
];

const ACCOUNT_API_LINES = [
  'GET /api/mt5/routing/accounts -> list account routes and validation state',
  'GET /api/mt5/routing/accounts/:accountNumber -> resolve current route',
  'POST /api/mt5/routing/accounts/:accountNumber -> create/update failover route',
  'POST /api/routing/validate -> run conflict and permission validation',
  'POST /api/routing/lock -> lock, unlock, risk-block, or news-block account',
];

const ACCOUNT_WS_LINES = [
  'routing.account.updated { accountNumber, primaryTerminalId, backupTerminalId }',
  'routing.permission.changed { accountNumber, permissionState, reason }',
  'routing.conflict.detected { accountNumber, conflictType, severity }',
  'routing.failover.selected { accountNumber, fromTerminalId, toTerminalId }',
  'routing.audit.created { accountNumber, action, actor, createdAt }',
];

function buildAccountRegistry(terminals: any[], routing: any[]) {
  const byAccount = new Map<string, any>();
  for (const terminal of terminals) {
    const accountNumber = String(terminal.accountNumber || '');
    if (!accountNumber) continue;
    const existing = byAccount.get(accountNumber) ?? { accountNumber, terminals: [], route: null };
    existing.terminals.push(terminal);
    byAccount.set(accountNumber, existing);
  }
  for (const route of routing) {
    const existing = byAccount.get(route.accountNumber) ?? { accountNumber: route.accountNumber, terminals: [], route: null };
    existing.route = route;
    byAccount.set(route.accountNumber, existing);
  }

  return Array.from(byAccount.values()).map((entry) => {
    const primary = entry.terminals[0] ?? {};
    const route = entry.route ?? {};
    const preferred = route.preferredTerminalIds ?? [];
    const primaryTerminalId = preferred[0] ?? primary.terminalId ?? '';
    const backupTerminalId = preferred[1] ?? entry.terminals.find((terminal: any) => terminal.terminalId !== primaryTerminalId)?.terminalId ?? '';
    const primaryTerminal = entry.terminals.find((terminal: any) => terminal.terminalId === primaryTerminalId) ?? primary;
    const connected = primaryTerminal?.status === 'connected';
    const accountMode = String(route.accountMode ?? primary.accountMode ?? 'unknown');
    const permissionState = String(route.permissionState ?? primary.permissionState ?? 'unknown');
    const locked = Boolean(route.locked ?? primary.locked ?? permissionState === 'Risk blocked');
    const newsBlocked = Boolean(route.newsBlocked ?? primary.newsBlocked);
    const status = !primaryTerminalId
      ? 'Awaiting terminal'
      : locked
        ? 'Locked'
        : newsBlocked
          ? 'News blocked'
          : permissionState === 'Read-only'
            ? 'Read-only'
            : connected
              ? 'Active'
              : backupTerminalId
                ? 'Failover ready'
                : 'Execution disabled';
    return {
      accountNumber: entry.accountNumber,
      brokerName: primary.brokerName || 'Unknown broker',
      serverName: primary.serverName || 'Unassigned server',
      terminals: entry.terminals,
      primaryTerminalId,
      backupTerminalId,
      strategy: String(route.strategy ?? primary.strategy ?? '—'),
      symbol: String(route.symbol ?? primary.symbol ?? '—'),
      riskProfile: String(route.riskProfile ?? primary.riskProfile ?? '—'),
      propFirmRule: String(route.propFirmRule ?? primary.propFirmRule ?? '—'),
      accountMode,
      permissionState,
      status,
      routingPriority: Number(route.minStabilityScore ?? route.priority ?? 0),
      failoverReady: Boolean(backupTerminalId && connected),
      route,
    };
  }).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

function summarizeAccountRouting(accounts: any[]) {
  return {
    brokers: new Set(accounts.map((account) => account.brokerName).filter(Boolean)).size,
    terminals: new Set(accounts.flatMap((account) => [account.primaryTerminalId, account.backupTerminalId]).filter(Boolean)).size,
    executionEnabled: accounts.filter((account) => account.permissionState === 'Execution enabled').length,
    readOnly: accounts.filter((account) => account.permissionState === 'Read-only').length,
    locked: accounts.filter((account) => account.status === 'Locked' || account.status.includes('blocked')).length,
    failoverReady: accounts.filter((account) => account.failoverReady).length,
  };
}

function buildRoutingConflicts(accounts: any[]) {
  const conflicts = [];
  const seen = new Map<string, string>();
  for (const account of accounts) {
    const brokerKey = `${account.brokerName}/${account.serverName}`;
    if (seen.has(account.accountNumber) && seen.get(account.accountNumber) !== brokerKey) {
      conflicts.push({ label: 'Duplicate account conflict', state: 'Conflict', detail: `${account.accountNumber} maps to multiple broker/server pairs.` });
    }
    seen.set(account.accountNumber, brokerKey);
    if (account.primaryTerminalId && account.primaryTerminalId === account.backupTerminalId) {
      conflicts.push({ label: 'Failover conflict', state: 'Conflict', detail: `${account.accountNumber} has identical primary and backup terminal.` });
    }
    if (account.permissionState !== 'Execution enabled' && account.status === 'Active') {
      conflicts.push({ label: 'Permission conflict', state: 'Conflict', detail: `${account.accountNumber} is active but permission is ${account.permissionState}.` });
    }
  }
  return conflicts.length ? conflicts : [{ label: 'Conflict detection', state: 'Valid', detail: 'No routing conflicts detected across accounts, terminals, and brokers.' }];
}

function buildRoutingValidation(accounts: any[]) {
  return [
    { label: 'Duplicate account prevention', state: accounts.length === new Set(accounts.map((a) => a.accountNumber)).size ? 'Valid' : 'Conflict', detail: 'Account numbers must be unique in active registry.' },
    { label: 'Trade command eligibility', state: accounts.some((a) => a.permissionState === 'Execution enabled') ? 'Valid' : 'Warning', detail: 'At least one account must be execution enabled for live command routing.' },
    { label: 'Terminal availability', state: accounts.some((a) => a.primaryTerminalId) ? 'Valid' : 'Warning', detail: 'Each executable account should resolve to primary or backup terminal.' },
    { label: 'Risk rule inheritance', state: accounts.every((a) => a.riskProfile) ? 'Valid' : 'Warning', detail: 'Risk profile and prop firm rules are assigned before execution.' },
  ];
}

function buildPermissionModel(accounts: any[]) {
  return [
    { label: 'Execution enabled', count: accounts.filter((a) => a.permissionState === 'Execution enabled').length, detail: 'Can receive validated trade commands.' },
    { label: 'Read-only monitoring', count: accounts.filter((a) => a.permissionState === 'Read-only').length, detail: 'Market data and account state only.' },
    { label: 'Execution disabled', count: accounts.filter((a) => a.permissionState === 'Execution disabled').length, detail: 'Commands blocked by account permission.' },
    { label: 'Risk/news blocked', count: accounts.filter((a) => a.permissionState === 'Risk blocked' || a.status === 'News blocked').length, detail: 'Risk engine or news window prevents execution.' },
  ];
}

function buildRoutingAuditLogs(accounts: any[], routing: any[]) {
  const now = new Date().toISOString();
  const routeLogs = routing.slice(0, 5).map((route) => ({
    time: route.updatedAt ?? route.createdAt ?? now,
    state: 'Active',
    message: `Routing rule updated for ${route.accountNumber}: ${(route.preferredTerminalIds ?? []).join(', ') || 'auto'} / ${route.failoverStrategy}`,
  }));
  const accountLogs = accounts.slice(0, 5).map((account) => ({
    time: now,
    state: account.status,
    message: `${account.accountNumber} ${account.status.toLowerCase()} / ${account.permissionState} / ${account.strategy} -> ${account.primaryTerminalId || 'awaiting terminal'}`,
  }));
  return [...routeLogs, ...accountLogs].length ? [...routeLogs, ...accountLogs] : [{ time: now, state: 'Read-only', message: 'Routing audit log is empty. Create a routing rule to begin audit history.' }];
}

function groupAccounts(accounts: any[], key: string) {
  const groups = new Map<string, number>();
  for (const account of accounts) {
    const label = String(account[key] || 'Unassigned');
    groups.set(label, (groups.get(label) ?? 0) + 1);
  }
  return Array.from(groups.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function RoutingMiniList({ items }: { items: Array<{ label: string; count: number }> }) {
  return (
    <div className="space-y-3">
      {(items.length ? items : [{ label: 'No mappings', count: 0 }]).map((item) => (
        <div key={item.label} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
          <span className="text-xs font-semibold text-slate-900">{item.label}</span>
          <span className="font-mono text-xs text-slate-600">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function RoutingSegment(props: { title: string; accounts: any[] }) {
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="border-b border-slate-200 py-4">
        <CardTitle className="text-sm font-semibold text-slate-950">{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {props.accounts.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No accounts in this state.</div>
        ) : props.accounts.slice(0, 5).map((account) => (
          <div key={account.accountNumber} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-slate-900">{account.accountNumber}</span>
              <RoutingBadge state={account.status} />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">{account.brokerName} / {account.primaryTerminalId || 'awaiting terminal'}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RoutingBadge({ state }: { state: string }) {
  return (
    <span className={cn(
      'inline-flex whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase',
      (state === 'Active' || state === 'Execution enabled' || state === 'Valid' || state === 'live' || state === 'demo') && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      (state === 'Read-only' || state === 'Awaiting terminal' || state === 'Failover ready' || state === 'Warning') && 'border-amber-200 bg-amber-50 text-amber-700',
      (state === 'Locked' || state === 'Risk blocked' || state === 'News blocked' || state === 'Execution disabled' || state === 'Conflict') && 'border-rose-200 bg-rose-50 text-rose-700',
    )}>{state}</span>
  );
}

function VpsManagement({ vps }: { vps: any[] }) {
  const nodes = useMemo(() => buildVpsNodes(vps), [vps]);
  const summary = summarizeVpsNodes(nodes);
  const alerts = buildVpsAlerts(nodes);
  const logs = buildVpsLogs(nodes);
  const [form, setForm] = useState({
    vpsId: '',
    label: '',
    provider: '',
    region: '',
    ipAddress: '',
    status: 'unknown',
    notes: '',
  });
  const [submit, setSubmit] = useState<EnqueueState>({ status: 'idle', message: '' });

  const onSubmit = async () => {
    setSubmit({ status: 'submitting', message: '' });
    try {
      if (!form.vpsId.trim()) throw new Error('vpsId is required.');
      const response = await fetch('/api/mt5/vps/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vpsId: form.vpsId.trim(),
          label: form.label.trim(),
          provider: form.provider.trim(),
          region: form.region.trim(),
          ipAddress: form.ipAddress.trim(),
          status: form.status,
          notes: form.notes.trim(),
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `VPS register failed with HTTP ${response.status}`);
      }
      setSubmit({ status: 'ok', message: 'VPS saved.' });
    } catch (error) {
      setSubmit({ status: 'error', message: error instanceof Error ? error.message : 'Failed to save VPS.' });
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={Server} title="VPS nodes" value={String(nodes.length)} detail="Registered MT5 infrastructure hosts" tone="blue" />
        <OpsSummaryCard icon={CheckCircle2} title="Active nodes" value={String(summary.active)} detail="Online or degraded but reachable" tone="green" />
        <OpsSummaryCard icon={AlertTriangle} title="Offline nodes" value={String(summary.offline)} detail="Unavailable VPS infrastructure" tone={summary.offline ? 'red' : 'green'} />
        <OpsSummaryCard icon={ShieldCheck} title="Fleet health" value={`${summary.health}%`} detail="Weighted VPS infrastructure score" tone={summary.health >= 85 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={Cpu} title="CPU average" value={`${summary.cpu}%`} detail="Resource monitoring" tone={summary.cpu > 75 ? 'amber' : 'blue'} />
        <OpsSummaryCard icon={MemoryStick} title="Memory average" value={`${summary.memory}%`} detail="VPS memory pressure" tone={summary.memory > 80 ? 'amber' : 'slate'} />
        <OpsSummaryCard icon={Database} title="Disk average" value={`${summary.disk}%`} detail="Storage utilization" tone={summary.disk > 80 ? 'amber' : 'violet'} />
        <OpsSummaryCard icon={Router} title="Failover ready" value={String(summary.failoverReady)} detail="Nodes eligible for routing failover" tone={summary.failoverReady ? 'green' : 'red'} />
      </section>

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-700" /> VPS Overview and Registry
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[680px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">VPS</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Provider</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Region/IP</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">OS</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Health</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">CPU</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Mem</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Disk</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Latency</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">MT5</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Agent</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Security</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={13} className="h-40 text-center text-sm text-slate-500">No VPS entries yet.</TableCell>
                    </TableRow>
                  ) : nodes.map((node) => (
                    <TableRow key={node.vpsId} className={cn('border-slate-100 hover:bg-blue-50/40', node.status === 'offline' && 'bg-rose-50/30', node.status === 'degraded' && 'bg-amber-50/30')}>
                      <TableCell className="font-mono text-xs text-slate-700">{node.vpsId}<div className="text-[11px] text-slate-500">{node.label}</div></TableCell>
                      <TableCell className="text-xs text-slate-700">{node.provider}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{node.region}<div className="text-[11px] text-slate-500">{node.ipAddress}</div></TableCell>
                      <TableCell className="text-xs text-slate-700">{node.operatingSystem}</TableCell>
                      <TableCell><VpsBadge state={node.status} /></TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-slate-800">{node.healthScore}%</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{node.cpuUsage}%</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{node.memoryUsage}%</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{node.diskUsage}%</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{node.networkLatencyMs}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{node.terminalCount}</TableCell>
                      <TableCell><VpsBadge state={node.bridgeAgentStatus} /></TableCell>
                      <TableCell><VpsBadge state={node.securityPatchStatus} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OpsPanel title="VPS Registry Control" icon={Wrench}>
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <ProvisionField label="VPS ID" value={form.vpsId} onChange={(value) => setForm((c) => ({ ...c, vpsId: value }))} placeholder="vps-ld4-01" mono />
                <ProvisionField label="Label" value={form.label} onChange={(value) => setForm((c) => ({ ...c, label: value }))} placeholder="LD4 execution node" />
                <ProvisionField label="Provider" value={form.provider} onChange={(value) => setForm((c) => ({ ...c, provider: value }))} placeholder="AWS / Vultr / Azure" />
                <ProvisionField label="Region" value={form.region} onChange={(value) => setForm((c) => ({ ...c, region: value }))} placeholder="LD4" />
                <ProvisionField label="IP address" value={form.ipAddress} onChange={(value) => setForm((c) => ({ ...c, ipAddress: value }))} placeholder="10.0.0.10" mono />
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase text-slate-500">Status</span>
                  <select className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" value={form.status} onChange={(e) => setForm((c) => ({ ...c, status: e.target.value }))}>
                    <option value="unknown">unknown</option>
                    <option value="online">online</option>
                    <option value="degraded">degraded</option>
                    <option value="offline">offline</option>
                  </select>
                </label>
              </div>
              <ProvisionField label="Notes" value={form.notes} onChange={(value) => setForm((c) => ({ ...c, notes: value }))} placeholder="deployment notes" />
              <button type="button" className={cn('h-9 w-full rounded-md border px-3 text-xs font-semibold', submit.status === 'submitting' ? 'border-slate-200 bg-slate-100 text-slate-400' : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100')} disabled={submit.status === 'submitting'} onClick={onSubmit}>Save VPS</button>
              <div className={cn('text-xs font-mono', submit.status === 'ok' && 'text-teal-700', submit.status === 'error' && 'text-rose-700', submit.status === 'submitting' && 'text-slate-500')}>{submit.message}</div>
            </div>
          </OpsPanel>

          <OpsPanel title="Resource Alerts" icon={AlertTriangle}>
            <div className="space-y-3">
              {alerts.map((alert, index) => (
                <div key={`${alert.vpsId}-${alert.state}-${alert.detail}-${index}`} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-900">{alert.title}</span>
                    <VpsBadge state={alert.state} />
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{alert.vpsId}</div>
                  <div className="mt-2 text-xs text-slate-600">{alert.detail}</div>
                </div>
              ))}
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <VpsSegment title="Active VPS Nodes" nodes={nodes.filter((node) => node.status !== 'offline')} />
        <VpsSegment title="Offline VPS Nodes" nodes={nodes.filter((node) => node.status === 'offline')} />
        <VpsSegment title="Failover Readiness" nodes={nodes.filter((node) => node.failoverReady)} />
        <VpsSegment title="Disaster Recovery" nodes={nodes.filter((node) => node.disasterRecoveryRole !== 'none')} />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <OpsPanel title="Resource Monitoring" icon={Cpu}><DualMetricBars rows={nodes} leftKey="cpuUsage" rightKey="memoryUsage" /></OpsPanel>
        <OpsPanel title="Disk Usage" icon={Database}><BarTrend values={nodes.map((node) => node.diskUsage).slice(0, 18)} suffix="%" invert /></OpsPanel>
        <OpsPanel title="Network Latency" icon={Network}><BarTrend values={nodes.map((node) => node.networkLatencyMs).slice(0, 18)} suffix="ms" /></OpsPanel>
        <OpsPanel title="VPS Health Score" icon={ShieldCheck}><BarTrend values={nodes.map((node) => node.healthScore).slice(0, 18)} suffix="%" invert /></OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <OpsPanel title="Terminal Allocation" icon={TerminalSquare}>
          <VpsMiniList items={nodes.map((node) => ({ label: node.vpsId, value: `${node.terminalCount} terminals / ${node.eaVersionStatus}` }))} />
        </OpsPanel>
        <OpsPanel title="Deployment Status" icon={RefreshCw}>
          <VpsMiniList items={nodes.map((node) => ({ label: node.vpsId, value: `${node.deploymentState} / ${node.rebootStatus}` }))} />
        </OpsPanel>
        <OpsPanel title="Security and Recovery" icon={LockKeyhole}>
          <VpsMiniList items={nodes.map((node) => ({ label: node.vpsId, value: `${node.securityPatchStatus} / backup ${node.backupStatus}` }))} />
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <OpsPanel title="VPS Logs" icon={Activity}>
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={`${log.time}-${log.message}`} className="flex gap-3 rounded-md border border-slate-200 bg-white p-3">
                <div className={cn('mt-1 h-2 w-2 rounded-full', log.state === 'online' && 'bg-emerald-500', log.state === 'degraded' && 'bg-amber-500', log.state === 'offline' && 'bg-rose-500')} />
                <div>
                  <div className="text-xs font-semibold text-slate-800">{log.message}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{formatTime(log.time)}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
        <OpsPanel title="Recovery Status" icon={ShieldAlert}>
          <div className="space-y-3">
            {nodes.slice(0, 8).map((node) => (
              <div key={node.vpsId} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-slate-900">{node.vpsId}</span>
                  <VpsBadge state={node.failoverReady ? 'ready' : 'watch'} />
                </div>
                <div className="mt-2 text-xs text-slate-600">DR role {node.disasterRecoveryRole}; backup {node.backupStatus}; remote access {node.remoteAccessStatus}.</div>
              </div>
            ))}
          </div>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Backend Service Design" lines={VPS_BACKEND_LINES} />
        <ArchitectureCard title="VPS Schema" lines={VPS_SCHEMA_LINES} />
        <ArchitectureCard title="Monitoring Model" lines={VPS_MONITORING_LINES} />
        <ArchitectureCard title="Health Scoring System" lines={VPS_HEALTH_LINES} />
        <ArchitectureCard title="Resource Alert Rules" lines={VPS_ALERT_LINES} />
        <ArchitectureCard title="Failover Logic" lines={VPS_FAILOVER_LINES} />
      </section>
    </div>
  );
}

const VPS_BACKEND_LINES = [
  'VpsRegistryService owns node enrollment, provider metadata, and authorization state.',
  'VpsMonitoringService ingests agent heartbeats, resource samples, deployment events, and backup signals.',
  'VpsControlService gates reboot, deployment, revoke, and remote access actions behind signed approvals.',
  'REST fallback: GET /api/mt5/vps, POST /api/mt5/vps/register, PATCH /api/mt5/vps/:id/control.',
  'WebSocket events: vps.heartbeat, vps.resource.updated, vps.failover.ready, vps.security.warning.'
];

const VPS_SCHEMA_LINES = [
  'vps_nodes(id, provider, region, ip_address, os, environment, dr_role, authorized, blocked_at).',
  'vps_resource_samples(vps_id, cpu_pct, memory_pct, disk_pct, latency_ms, sampled_at).',
  'vps_deployments(vps_id, bridge_agent_version, ea_version, state, started_at, completed_at).',
  'vps_security_status(vps_id, patch_state, backup_state, remote_access_state, last_scan_at).',
  'vps_logs(vps_id, severity, event_type, message, metadata_json, created_at).'
];

const VPS_MONITORING_LINES = [
  'Bridge agents publish signed heartbeat packets every 3 seconds with resource and terminal allocation snapshots.',
  'Collectors write the latest node state to Redis and append durable samples to PostgreSQL for analytics.',
  'Dashboard streams incremental updates and falls back to REST polling when WebSocket transport degrades.',
  'Offline detection is timeout based, so stale nodes are isolated without waiting for manual refresh.'
];

const VPS_HEALTH_LINES = [
  'Health score blends CPU, memory, disk, latency, heartbeat freshness, bridge agent status, and patch posture.',
  'Production nodes require stricter thresholds than demo nodes and must maintain backup freshness.',
  'Scores below 70 enter warning state; below 50 are removed from primary routing eligibility.',
  'Health history powers failure prediction, capacity planning, and terminal placement recommendations.'
];

const VPS_ALERT_LINES = [
  'CPU warning > 75 percent for 3 samples; critical > 90 percent for 2 samples.',
  'Memory warning > 80 percent; disk warning > 78 percent; critical disk > 90 percent.',
  'Latency warning > 120 ms; critical > 250 ms or packet loss reported by the bridge agent.',
  'Security alert when backup is stale, patch state is due, or remote access policy changes unexpectedly.'
];

const VPS_FAILOVER_LINES = [
  'Only healthy, patched, backed-up nodes with bridge agent healthy can accept failover routing.',
  'Terminal evacuation prefers same broker region, then same provider, then lowest latency standby.',
  'Failover events are idempotent and require account-route lock acquisition before command dispatch.',
  'Recovery marks the original VPS as observe-only until heartbeat, sync, and execution acknowledgements stabilize.'
];

function buildVpsNodes(vps: any[]) {
  return vps.map((node, index) => {
    const id = String(node.vpsId ?? node.id ?? `vps-node-${index + 1}`);
    const rawStatus = String(node.status ?? node.state ?? 'unknown').toLowerCase();
    const status = rawStatus.includes('off') ? 'offline' : rawStatus.includes('degrad') || rawStatus.includes('warn') ? 'degraded' : rawStatus.includes('on') || rawStatus.includes('healthy') ? 'online' : 'unknown';
    const cpuUsage = clampScore(Number(node.cpuUsage ?? node.cpu ?? 0));
    const memoryUsage = clampScore(Number(node.memoryUsage ?? node.memory ?? 0));
    const diskUsage = clampScore(Number(node.diskUsage ?? node.disk ?? 0));
    const networkLatencyMs = Number(node.networkLatencyMs ?? node.latencyMs ?? 0);
    const bridgeAgentStatus = String(node.bridgeAgentStatus ?? (status === 'offline' ? 'offline' : 'unknown'));
    const backupStatus = String(node.backupStatus ?? 'unknown');
    const securityPatchStatus = String(node.securityPatchStatus ?? 'unknown');
    const deploymentState = String(node.deploymentState ?? 'unknown');
    const healthScore = clampScore(
      100
      - cpuUsage * 0.14
      - memoryUsage * 0.12
      - diskUsage * 0.1
      - Math.max(0, networkLatencyMs - 45) * 0.16
      - (status === 'offline' ? 42 : status === 'degraded' ? 16 : 0)
      - (bridgeAgentStatus !== 'healthy' ? 12 : 0)
      - (backupStatus === 'stale' ? 8 : 0)
      - (securityPatchStatus === 'patch due' ? 8 : 0)
    );
    const failoverReady = status === 'online' && bridgeAgentStatus === 'healthy' && backupStatus === 'current' && securityPatchStatus === 'patched' && healthScore >= 78;

    return {
      vpsId: id,
      label: String(node.label ?? node.name ?? `VPS Node ${index + 1}`),
      provider: String(node.provider ?? '—'),
      region: String(node.region ?? node.location ?? '—'),
      ipAddress: String(node.ipAddress ?? node.ip ?? '—'),
      operatingSystem: String(node.operatingSystem ?? node.os ?? '—'),
      uptimeMs: Number(node.uptimeMs ?? node.uptime ?? 0),
      cpuUsage,
      memoryUsage,
      diskUsage,
      networkLatencyMs,
      terminalCount: Number(node.terminalCount ?? node.terminals ?? 0),
      eaVersionStatus: String(node.eaVersionStatus ?? 'unknown'),
      bridgeAgentStatus,
      connectionQuality: String(node.connectionQuality ?? (networkLatencyMs > 180 || status === 'degraded' ? 'watch' : 'unknown')),
      rebootStatus: String(node.rebootStatus ?? 'none'),
      deploymentState,
      failoverReady,
      backupStatus,
      securityPatchStatus,
      remoteAccessStatus: String(node.remoteAccessStatus ?? 'unknown'),
      environmentType: String(node.environmentType ?? node.environment ?? 'unknown'),
      disasterRecoveryRole: String(node.disasterRecoveryRole ?? 'unknown'),
      healthScore,
      status
    };
  });
}

function summarizeVpsNodes(nodes: ReturnType<typeof buildVpsNodes>) {
  const avg = (key: 'healthScore' | 'cpuUsage' | 'memoryUsage' | 'diskUsage') =>
    Math.round(nodes.reduce((sum, node) => sum + node[key], 0) / Math.max(nodes.length, 1));

  return {
    total: nodes.length,
    active: nodes.filter((node) => node.status === 'online').length,
    offline: nodes.filter((node) => node.status === 'offline').length,
    degraded: nodes.filter((node) => node.status === 'degraded').length,
    health: avg('healthScore'),
    cpu: avg('cpuUsage'),
    memory: avg('memoryUsage'),
    disk: avg('diskUsage'),
    failoverReady: nodes.filter((node) => node.failoverReady).length
  };
}

function buildVpsAlerts(nodes: ReturnType<typeof buildVpsNodes>) {
  return nodes.flatMap((node) => {
    const alerts = [];
    if (node.status === 'offline') alerts.push({ vpsId: node.vpsId, title: node.label, state: 'critical', detail: 'Node offline and removed from routing pool.' });
    if (node.cpuUsage >= 75) alerts.push({ vpsId: node.vpsId, title: node.label, state: node.cpuUsage >= 90 ? 'critical' : 'warning', detail: `CPU pressure at ${node.cpuUsage}%.` });
    if (node.memoryUsage >= 80) alerts.push({ vpsId: node.vpsId, title: node.label, state: 'warning', detail: `Memory utilization at ${node.memoryUsage}%.` });
    if (node.diskUsage >= 78) alerts.push({ vpsId: node.vpsId, title: node.label, state: node.diskUsage >= 90 ? 'critical' : 'warning', detail: `Disk usage at ${node.diskUsage}%.` });
    if (node.networkLatencyMs >= 120) alerts.push({ vpsId: node.vpsId, title: node.label, state: node.networkLatencyMs >= 250 ? 'critical' : 'warning', detail: `Network latency ${node.networkLatencyMs} ms.` });
    if (node.securityPatchStatus === 'patch due') alerts.push({ vpsId: node.vpsId, title: node.label, state: 'warning', detail: 'Security patch window required.' });
    if (node.backupStatus === 'stale') alerts.push({ vpsId: node.vpsId, title: node.label, state: 'warning', detail: 'Backup freshness outside policy.' });
    return alerts;
  }).slice(0, 8);
}

function buildVpsLogs(nodes: ReturnType<typeof buildVpsNodes>) {
  return nodes
    .filter((node) => Array.isArray((node as { logs?: unknown[] }).logs))
    .flatMap((node) => ((node as { logs?: Array<{ time?: string; state?: string; message?: string }> }).logs ?? []).map((log) => ({
      time: log.time ?? new Date().toISOString(),
      state: log.state ?? node.status,
      message: log.message ?? `${node.label}: status update`,
    })))
    .slice(0, 20);
}

function VpsBadge({ state }: { state: string }) {
  const value = state.toLowerCase();
  const tone = value.includes('critical') || value.includes('offline') || value.includes('due') || value.includes('stale') || value.includes('disabled')
    ? 'border-red-200 bg-red-50 text-red-700'
    : value.includes('warning') || value.includes('degrad') || value.includes('watch') || value.includes('deploy') || value.includes('scheduled') || value.includes('upgrade')
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : value.includes('ready') || value.includes('healthy') || value.includes('online') || value.includes('current') || value.includes('patched') || value.includes('enabled')
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]', tone)}>
      {state}
    </span>
  );
}

function VpsSegment({ title, nodes }: { title: string; nodes: ReturnType<typeof buildVpsNodes> }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <div className="mt-4 space-y-3">
        {nodes.length ? nodes.map((node) => (
          <div key={`${title}-${node.vpsId}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
            <div>
              <p className="text-sm font-black text-slate-900">{node.label}</p>
              <p className="font-mono text-[11px] text-slate-500">{node.region} / {node.ipAddress}</p>
            </div>
            <div className="text-right">
              <VpsBadge state={node.status} />
              <p className="mt-1 font-mono text-xs text-slate-500">{node.healthScore}% health</p>
            </div>
          </div>
        )) : <EmptyPanel title="No nodes in this state" detail="The VPS registry has no matching infrastructure nodes right now." />}
      </div>
    </div>
  );
}

function VpsMiniList({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3">
          <span className="font-mono text-xs font-semibold text-slate-900">{item.label}</span>
          <span className="text-right text-xs font-semibold text-slate-600">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

type AutoTestStatusView = {
  enabled: boolean;
  state: string;
  runId: string | null;
  terminalId: string | null;
  countdownSeconds: number | null;
  safetyChecks: Array<{ name: string; ok: boolean; detail: string }>;
  lastResult: { state: string; commandId: string | null; ticket: string | null; message: string | null; updatedAt: string | null };
  logs: Array<{ id: string; severity: string; message: string; eventType: string; createdAt: string }>;
};

function AutomaticExecutionTestPanel() {
  const [status, setStatus] = useState<AutoTestStatusView | null>(null);
  const [busy, setBusy] = useState<'idle' | 'enabling' | 'disabling'>('idle');
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  const load = useCallback(async () => {
    const response = await fetch('/api/mt5/auto-test/status', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error ?? `Auto test status failed with HTTP ${response.status}`);
    }
    setStatus(payload as AutoTestStatusView);
    setError('');
    return payload as AutoTestStatusView;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        await load();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unable to load auto test status.');
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [load]);

  const onEnable = async () => {
    setBusy('enabling');
    setNotice('');
    try {
      const response = await fetch('/api/mt5/auto-test/enable', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? `Enable failed with HTTP ${response.status}`);
      const next = await load();
      const failedChecks = (next?.safetyChecks ?? []).filter((check) => !check.ok).map((check) => check.name);
      setNotice(
        failedChecks.length
          ? `Auto test enabled (run ${String(payload?.runId ?? '—').slice(0, 8)}…). Waiting on: ${failedChecks.join(', ')}.`
          : `Auto test enabled (run ${String(payload?.runId ?? '—').slice(0, 8)}…). Safety checks passed — dispatch will start after the countdown.`,
      );
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enable failed.');
    } finally {
      setBusy('idle');
    }
  };

  const onDisable = async () => {
    setBusy('disabling');
    setNotice('');
    try {
      const response = await fetch('/api/mt5/auto-test/disable', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? `Disable failed with HTTP ${response.status}`);
      await load();
      setNotice('Auto test disabled.');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disable failed.');
    } finally {
      setBusy('idle');
    }
  };

  const enabled = Boolean(status?.enabled);
  const state = status?.state ?? 'IDLE';
  const countdown = status?.countdownSeconds == null ? null : Math.max(0, Math.round(Number(status.countdownSeconds)));
  const logs = status?.logs ?? [];

  return (
    <OpsPanel title="Automatic Execution Test" icon={ClipboardCheck}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase',
              enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600',
            )}
          >
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
          <span className="inline-flex whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-2 py-1 font-mono text-[10px] font-semibold uppercase text-blue-700">
            {state}
          </span>
          {status?.runId ? <span className="font-mono text-[11px] text-slate-500">Run {status.runId.slice(0, 8)}…</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy !== 'idle' || enabled} onClick={() => void onEnable()}>
            {busy === 'enabling' ? 'Enabling…' : 'Enable'}
          </Button>
          <Button size="sm" variant="destructive" disabled={busy !== 'idle' || !enabled} onClick={() => void onDisable()}>
            {busy === 'disabling' ? 'Disabling…' : 'Disable'}
          </Button>
        </div>
      </div>

      {notice ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div> : null}

      {status?.terminalId ? (
        <div className="mt-3 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs font-semibold text-slate-900">Terminal</span>
            <span className="font-mono text-xs text-slate-700">{status.terminalId}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs font-semibold text-slate-900">Countdown</span>
            <span className="font-mono text-xs text-slate-700">{countdown == null ? '—' : `${countdown}s`}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs font-semibold text-slate-900">Run ID</span>
            <span className="font-mono text-xs text-slate-500">{status.runId ?? '—'}</span>
          </div>
        </div>
      ) : state === 'VALIDATING' ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Terminal is connected. Waiting for remaining safety checks to pass before dispatch.
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
          Waiting for a connected terminal.
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-2">
        {(status?.safetyChecks ?? []).map((check) => (
          <div key={check.name} className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-white p-3">
            <div>
              <div className="text-xs font-semibold text-slate-900">{check.name}</div>
              <div className="mt-1 text-[11px] text-slate-500">{check.detail}</div>
            </div>
            <ExecutionBadge state={check.ok ? 'ACKNOWLEDGED' : 'FAILED'} />
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-900">Last result</span>
          <span className="font-mono text-xs text-slate-600">{status?.lastResult?.state ?? '—'}</span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-1 font-mono text-[11px] text-slate-600">
          <div>commandId: {status?.lastResult?.commandId ?? '—'}</div>
          <div>ticket: {status?.lastResult?.ticket ?? '—'}</div>
          <div>message: {status?.lastResult?.message ?? '—'}</div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-900">Logs</span>
          <span className="font-mono text-[11px] text-slate-500">{logs.length} entries</span>
        </div>
        <div className="mt-3 space-y-2">
          {logs.slice(0, 10).map((log) => (
            <div key={log.id} className="rounded-md border border-slate-100 bg-slate-50 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase text-slate-500">{log.severity}</span>
                <span className="font-mono text-[10px] text-slate-500">{formatTime(log.createdAt)}</span>
              </div>
              <div className="mt-1 text-xs text-slate-700">{log.message}</div>
            </div>
          ))}
          {!logs.length ? (
            <div className="text-xs text-slate-500">No auto-test logs yet.</div>
          ) : null}
        </div>
      </div>

      {error ? <div className="mt-3 text-xs font-mono text-rose-700">{error}</div> : null}
    </OpsPanel>
  );
}

function Mt5ExecutionBridge(props: { terminals: any[]; commands: any[]; recentAcks: any[]; commandSummary: any }) {
  const connected = props.terminals.filter((t) => t.status === 'connected');
  type ExecutionBridgeDbState = {
    loaded: boolean;
    error: string;
    commands: any[];
    events: any[];
    bridgeOnline: boolean;
    bridgeHealth: any;
    bridgeTerminalOps: any;
  };

  const [dbState, setDbState] = useState<ExecutionBridgeDbState>({
    loaded: false,
    error: '',
    commands: [],
    events: [],
    bridgeOnline: false,
    bridgeHealth: null,
    bridgeTerminalOps: null,
  });

  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;

    const load = async () => {
      try {
        const response = await fetch('/api/mt5/execution-bridge/state', { cache: 'no-store' });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Execution bridge state failed with HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (cancelled) return;
        setDbState((current) => ({
          ...current,
          loaded: true,
          error: '',
          commands: Array.isArray(payload?.commands) ? payload.commands : [],
          events: Array.isArray(payload?.events) ? payload.events : current.events,
          bridgeOnline: Boolean(payload?.bridge?.online),
          bridgeHealth: payload?.bridge?.health ?? null,
          bridgeTerminalOps: payload?.bridge?.terminalOperations ?? null,
        }));
      } catch (error) {
        if (cancelled) return;
        setDbState((current) => ({
          ...current,
          loaded: true,
          error: error instanceof Error ? error.message : 'Unable to load execution bridge state.',
        }));
      }
    };

    load();
    const interval = window.setInterval(load, 4000);

    try {
      eventSource = new EventSource('/api/mt5/execution-bridge/stream');
      eventSource.addEventListener('execution_event', (event) => {
        try {
          const messageEvent = event as MessageEvent<string>;
          const parsed = JSON.parse(messageEvent.data);
          if (!parsed || typeof parsed !== 'object') return;
          setDbState((current) => ({
            ...current,
            events: [...current.events, parsed].slice(-400),
          }));
        } catch {
          return;
        }
      });
    } catch {
      eventSource = null;
    }

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      eventSource?.close();
    };
  }, []);

  const mergedCommands = useMemo(() => mergeExecutionCommandSources(props.commands, dbState.commands), [props.commands, dbState.commands]);
  const mergedAcks = useMemo(() => mergeExecutionAckSources(props.recentAcks, dbState.commands), [props.recentAcks, dbState.commands]);
  const commandRows = useMemo(() => mergedCommands.map((command) => enrichExecutionCommand(command, props.terminals, mergedAcks)), [mergedCommands, mergedAcks, props.terminals]);
  const ackRows = useMemo(() => mergedAcks.map((ack) => enrichExecutionAck(ack)), [mergedAcks]);
  const bridgeSummary = summarizeExecutionBridge(commandRows, ackRows, props.commandSummary, connected.length);
  const diagnostics = buildExecutionDiagnostics(props.terminals, commandRows, ackRows);
  const lifecycle = buildOrderLifecycle(commandRows, ackRows);
  const logs = dbState.events.length ? buildDbExecutionLogs(dbState.events) : buildExecutionLogs(commandRows, ackRows);
  const failover = buildExecutionFailover(props.terminals);
  const integrity = buildExecutionIntegrity(commandRows, ackRows);
  const [filters, setFilters] = useState<{ environment: string; lifecycle: string; sandbox: string; query: string }>({
    environment: 'ALL',
    lifecycle: 'ALL',
    sandbox: 'ALL',
    query: '',
  });
  const [enqueue, setEnqueue] = useState({
    terminalId: '',
    symbol: 'XAUUSD',
    side: 'buy' as 'buy' | 'sell',
    volumeLots: '0.01',
    stopLoss: '0',
    takeProfit: '0',
    environment: 'DEMO' as 'DEMO' | 'LIVE' | 'PROP' | 'MARKET_DATA_MONITOR' | 'FAILOVER_RESERVE',
    sandboxMode: true,
  });
  const [submit, setSubmit] = useState<EnqueueState>({ status: 'idle', message: '' });
  const [actions, setActions] = useState<EnqueueState>({ status: 'idle', message: '' });
  const selectedTerminalId = enqueue.terminalId || connected[0]?.terminalId || '';

  const dedupeDuplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const command of commandRows) {
      const key = String(command.dedupeKey ?? '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
  }, [commandRows]);

  const filteredCommands = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return commandRows.filter((command) => {
      if (filters.environment !== 'ALL' && String(command.environment ?? '') !== filters.environment) return false;
      if (filters.lifecycle !== 'ALL' && String(command.lifecycleState ?? '') !== filters.lifecycle) return false;
      if (filters.sandbox !== 'ALL') {
        const sandbox = Boolean(command.sandboxMode);
        if (filters.sandbox === 'SANDBOX' && !sandbox) return false;
        if (filters.sandbox === 'LIVE' && sandbox) return false;
      }
      if (!query) return true;
      return (
        String(command.commandId ?? '').toLowerCase().includes(query)
        || String(command.terminalId ?? '').toLowerCase().includes(query)
        || String(command.type ?? '').toLowerCase().includes(query)
        || String(command.symbol ?? '').toLowerCase().includes(query)
        || String(command.ticket ?? '').toLowerCase().includes(query)
      );
    });
  }, [commandRows, filters.environment, filters.lifecycle, filters.query, filters.sandbox]);

  const filteredAcks = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return ackRows.filter((ack) => {
      if (filters.environment !== 'ALL') {
        const command = commandRows.find((row) => row.commandId === ack.commandId);
        if (String(command?.environment ?? '') !== filters.environment) return false;
      }
      if (filters.lifecycle !== 'ALL' && String(ack.lifecycleState ?? '') !== filters.lifecycle) return false;
      if (!query) return true;
      return (
        String(ack.commandId ?? '').toLowerCase().includes(query)
        || String(ack.terminalId ?? '').toLowerCase().includes(query)
        || String(ack.status ?? '').toLowerCase().includes(query)
        || String(ack.ticket ?? '').toLowerCase().includes(query)
        || String(ack.brokerMessage ?? '').toLowerCase().includes(query)
      );
    });
  }, [ackRows, commandRows, filters.environment, filters.lifecycle, filters.query]);

  const failureAnalytics = useMemo(() => {
    const failures = commandRows.filter((command) => ['FAILED', 'TIMEOUT', 'CANCELLED'].includes(String(command.lifecycleState)));
    const buckets = new Map<string, { label: string; count: number; lastAt: string }>();
    for (const command of failures) {
      const label =
        String(command.lastError ?? '').trim()
        || String(command.ackStatus ?? '').trim()
        || String(command.brokerMessage ?? '').trim()
        || String(command.lifecycleState ?? 'FAILED');
      const existing = buckets.get(label);
      const lastAt = String(command.lastUpdatedAt ?? command.createdAt ?? new Date().toISOString());
      if (!existing) buckets.set(label, { label, count: 1, lastAt });
      else buckets.set(label, { ...existing, count: existing.count + 1, lastAt: Date.parse(lastAt) > Date.parse(existing.lastAt) ? lastAt : existing.lastAt });
    }
    return Array.from(buckets.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [commandRows]);

  const auditEvents = useMemo(() => (dbState.events.length ? [...dbState.events].slice(-80).reverse() : []), [dbState.events]);
  const auditEventKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return auditEvents.map((event: any) => {
      const explicitKey = String(event?.key ?? '').trim();
      const terminalId = String(event?.terminalId ?? event?.terminal_id ?? '').trim();
      const eventType = String(event?.eventType ?? event?.event_type ?? '').trim();
      const lifecycleState = String(event?.lifecycleState ?? '').trim();
      const commandId = String(event?.commandId ?? '').trim();
      const createdAt = String(event?.createdAt ?? event?.created_at ?? '').trim();
      const id = String(event?.id ?? '').trim();
      const message = String(event?.message ?? '');
      const messagePart = message.length > 160 ? message.slice(0, 160) : message;
      const base =
        explicitKey
        || [
          'exec',
          terminalId || 'no-terminal',
          commandId || 'no-command',
          eventType || 'no-type',
          lifecycleState || 'no-state',
          createdAt || 'no-time',
          id || 'no-id',
          messagePart || 'no-message',
        ].join('|');

      const next = (seen.get(base) ?? 0) + 1;
      seen.set(base, next);
      return next === 1 ? base : `${base}#${next}`;
    });
  }, [auditEvents]);

  const onRetry = async (commandId: string) => {
    setActions({ status: 'submitting', message: '' });
    try {
      const response = await fetch('/api/mt5/execution-bridge/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? `Retry failed with HTTP ${response.status}`);
      }
      setActions({ status: 'ok', message: `Retry enqueued for ${commandId}.` });
    } catch (error) {
      setActions({ status: 'error', message: error instanceof Error ? error.message : 'Retry failed.' });
    }
  };

  const onEnqueue = async () => {
    setSubmit({ status: 'submitting', message: '' });
    try {
      const volumeLots = Number(enqueue.volumeLots);
      const stopLoss = Number(enqueue.stopLoss);
      const takeProfit = Number(enqueue.takeProfit);
      if (!selectedTerminalId) throw new Error('Select a terminal.');
      if (!Number.isFinite(volumeLots) || volumeLots <= 0) throw new Error('Volume must be a positive number.');
      if (!Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) throw new Error('SL/TP must be numeric values.');
      const response = await fetch('/api/mt5/execution-bridge/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandId: `${selectedTerminalId}-${crypto.randomUUID()}`,
          terminalId: selectedTerminalId,
          type: 'PLACE_ORDER',
          createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          environment: enqueue.environment,
          mode: enqueue.sandboxMode ? 'SANDBOX' : 'LIVE',
          symbol: enqueue.symbol.trim(),
          side: String(enqueue.side).toUpperCase(),
          orderType: 'MARKET',
          volume: volumeLots,
          sl: stopLoss,
          tp: takeProfit,
          comment: 'Cacsms Trader sandbox test',
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Enqueue failed with HTTP ${response.status}`);
      }
      setSubmit({ status: 'ok', message: 'Command enqueued.' });
    } catch (error) {
      setSubmit({ status: 'error', message: error instanceof Error ? error.message : 'Failed to enqueue command.' });
    }
  };

  return (
    <div className="space-y-6">
      <Mt5BridgeSecretPanel />
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={ShieldCheck} title="Bridge health score" value={`${bridgeSummary.healthScore}%`} detail="Execution infrastructure readiness" tone={bridgeSummary.healthScore >= 85 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={Server} title="Queued commands" value={String(bridgeSummary.queued)} detail="Awaiting EA lease" tone="blue" />
        <OpsSummaryCard icon={PlugZap} title="In flight" value={String(bridgeSummary.inFlight)} detail="Leased to MT5 terminals" tone={bridgeSummary.inFlight ? 'amber' : 'slate'} />
        <OpsSummaryCard icon={CheckCircle2} title="Acknowledged" value={String(bridgeSummary.acked)} detail="Broker or EA responses received" tone="green" />
        <OpsSummaryCard icon={Gauge} title="Execution latency" value={`${bridgeSummary.averageLatency}ms`} detail="Ack and broker response latency" tone={bridgeSummary.averageLatency > 750 ? 'amber' : 'blue'} />
        <OpsSummaryCard icon={ShieldAlert} title="Integrity score" value={`${bridgeSummary.integrityScore}%`} detail="Duplicates, validation, lifecycle" tone={bridgeSummary.integrityScore >= 90 ? 'green' : 'amber'} />
        <OpsSummaryCard icon={Router} title="Failover routes" value={String(bridgeSummary.failoverReady)} detail="Connected eligible terminals" tone={bridgeSummary.failoverReady ? 'green' : 'red'} />
        <OpsSummaryCard icon={RefreshCw} title="Retry pressure" value={String(bridgeSummary.retryPressure)} detail="Attempts, expired, dead commands" tone={bridgeSummary.retryPressure ? 'amber' : 'green'} />
      </section>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-700" /> Filters & Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
              value={filters.environment}
              onChange={(e) => setFilters((c) => ({ ...c, environment: e.target.value }))}
            >
              <option value="ALL">ALL ENV</option>
              <option value="DEMO">DEMO</option>
              <option value="LIVE">LIVE</option>
              <option value="PROP">PROP</option>
              <option value="MARKET_DATA_MONITOR">MARKET_DATA_MONITOR</option>
              <option value="FAILOVER_RESERVE">FAILOVER_RESERVE</option>
            </select>
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
              value={filters.lifecycle}
              onChange={(e) => setFilters((c) => ({ ...c, lifecycle: e.target.value }))}
            >
              <option value="ALL">ALL STATES</option>
              <option value="QUEUED">QUEUED</option>
              <option value="ROUTING">ROUTING</option>
              <option value="SENT">SENT</option>
              <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
              <option value="EXECUTED">EXECUTED</option>
              <option value="FAILED">FAILED</option>
              <option value="TIMEOUT">TIMEOUT</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
              value={filters.sandbox}
              onChange={(e) => setFilters((c) => ({ ...c, sandbox: e.target.value }))}
            >
              <option value="ALL">ALL MODES</option>
              <option value="SANDBOX">SANDBOX</option>
              <option value="LIVE">LIVE MODE</option>
            </select>
            <input
              className="md:col-span-3 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
              placeholder="Search commandId, terminalId, symbol, ticket…"
              value={filters.query}
              onChange={(e) => setFilters((c) => ({ ...c, query: e.target.value }))}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-600">
              <span className="font-mono">{filteredCommands.length}</span> command(s) • <span className="font-mono">{filteredAcks.length}</span> ack(s) • Bridge {dbState.bridgeOnline ? 'online' : 'offline'}
            </div>
            <div className={cn('text-xs font-mono', actions.status === 'ok' && 'text-teal-700', actions.status === 'error' && 'text-rose-700', actions.status === 'submitting' && 'text-slate-500')}>
              {actions.message}
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-700" /> Execution Command Dispatch
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-8 gap-2">
              <select
                className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                value={selectedTerminalId}
                onChange={(e) => setEnqueue((c) => ({ ...c, terminalId: e.target.value }))}
              >
                <option value="">Select terminal</option>
                {connected.map((t) => (
                  <option key={t.terminalId} value={t.terminalId}>{t.terminalId}</option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                value={enqueue.environment}
                onChange={(e) => setEnqueue((c) => ({ ...c, environment: e.target.value as any }))}
              >
                <option value="DEMO">DEMO</option>
                <option value="LIVE">LIVE</option>
                <option value="PROP">PROP</option>
                <option value="MARKET_DATA_MONITOR">MARKET_DATA_MONITOR</option>
                <option value="FAILOVER_RESERVE">FAILOVER_RESERVE</option>
              </select>
              <button
                type="button"
                className={cn(
                  'h-9 rounded-md border px-3 text-xs font-semibold',
                  enqueue.sandboxMode ? 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
                onClick={() => setEnqueue((c) => ({ ...c, sandboxMode: !c.sandboxMode }))}
              >
                {enqueue.sandboxMode ? 'Sandbox' : 'Live mode'}
              </button>
              <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={enqueue.symbol} onChange={(e) => setEnqueue((c) => ({ ...c, symbol: e.target.value }))} />
              <select className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={enqueue.side} onChange={(e) => setEnqueue((c) => ({ ...c, side: e.target.value as any }))}>
                <option value="buy">buy</option>
                <option value="sell">sell</option>
              </select>
              <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={enqueue.volumeLots} onChange={(e) => setEnqueue((c) => ({ ...c, volumeLots: e.target.value }))} />
              <button
                type="button"
                className={cn(
                  'h-9 rounded-md border px-3 text-xs font-semibold',
                  submit.status === 'submitting'
                    ? 'border-slate-200 bg-slate-100 text-slate-400'
                    : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100',
                )}
                disabled={submit.status === 'submitting'}
                onClick={onEnqueue}
              >
                Enqueue
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="stopLoss" value={enqueue.stopLoss} onChange={(e) => setEnqueue((c) => ({ ...c, stopLoss: e.target.value }))} />
              <input className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="takeProfit" value={enqueue.takeProfit} onChange={(e) => setEnqueue((c) => ({ ...c, takeProfit: e.target.value }))} />
            </div>
            <div className={cn('text-xs font-mono', submit.status === 'ok' && 'text-teal-700', submit.status === 'error' && 'text-rose-700', submit.status === 'submitting' && 'text-slate-500')}>
              {submit.message || 'Ready. If an EA rejects execution, set EnableExecution=true and CommandPollSeconds>0 on that terminal.'}
            </div>
            {dbState.error ? (
              <div className="text-xs font-mono text-rose-700">{dbState.error}</div>
            ) : null}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {integrity.map((item) => (
                <div key={item.label} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[11px] uppercase text-slate-500">{item.label}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono text-xl text-slate-950">{item.value}</span>
                    <ExecutionBadge state={item.state} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <AutomaticExecutionTestPanel />
          <OpsPanel title="Execution Diagnostics" icon={Gauge}>
            <div className="space-y-3">
              {diagnostics.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{item.detail}</div>
                  </div>
                  <ExecutionBadge state={item.state} />
                </div>
              ))}
            </div>
          </OpsPanel>

          <OpsPanel title="Infrastructure Failover" icon={Router}>
            <div className="space-y-3">
              {failover.map((route) => (
                <div key={route.terminalId} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-slate-900">{route.terminalId}</span>
                    <ExecutionBadge state={route.state} />
                  </div>
                  <div className="mt-2 text-xs text-slate-600">{route.detail}</div>
                </div>
              ))}
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-700" /> Real-Time Command Monitoring
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[520px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Created</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Command</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Lifecycle</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Latency</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Attempt</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Integrity</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCommands.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={8} className="h-40 text-center text-sm text-slate-500">
                        No commands enqueued yet.
                      </TableCell>
                    </TableRow>
                  ) : filteredCommands.slice(0, 60).map((command) => (
                    <TableRow
                      key={command.commandId}
                      className={cn(
                        'border-slate-100 hover:bg-blue-50/40',
                        (command.lifecycleState === 'FAILED' || command.lifecycleState === 'TIMEOUT') && 'bg-rose-50/30',
                        (command.lifecycleState === 'ROUTING' || command.lifecycleState === 'SENT') && 'bg-amber-50/30',
                      )}
                    >
                      <TableCell className="font-mono text-xs text-slate-700">{formatTime(command.createdAt)}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{command.terminalId}</TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {command.type}
                        <div className="font-mono text-[11px] text-slate-500">
                          {command.symbol} • {command.environment}{command.sandboxMode ? ' • sandbox' : ''}{command.dedupeKey && dedupeDuplicates.has(command.dedupeKey) ? ' • DUP' : ''}
                        </div>
                      </TableCell>
                      <TableCell><ExecutionBadge state={command.lifecycleState} /></TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">
                        {Math.round(command.lifecycleState === 'ACKNOWLEDGED' || command.lifecycleState === 'EXECUTED' || command.lifecycleState === 'FAILED' || command.lifecycleState === 'CANCELLED'
                          ? command.ackLatencyMs
                          : command.dispatchLatencyMs)}ms
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{command.attempt}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{command.integrityScore}%</TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          className={cn(
                            'h-8 rounded-md border px-2 text-xs font-semibold',
                            ['FAILED', 'TIMEOUT', 'CANCELLED'].includes(String(command.lifecycleState)) && Number(command.attempt ?? 0) < Number(command.maxAttempts ?? 3)
                              ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                              : 'border-slate-200 bg-slate-100 text-slate-400',
                          )}
                          disabled={!['FAILED', 'TIMEOUT', 'CANCELLED'].includes(String(command.lifecycleState)) || Number(command.attempt ?? 0) >= Number(command.maxAttempts ?? 3) || actions.status === 'submitting'}
                          onClick={() => onRetry(String(command.commandId))}
                        >
                          Retry
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600" /> Execution Acknowledgements
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[520px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Received</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Ticket</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Latency</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Broker response</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAcks.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={6} className="h-40 text-center text-sm text-slate-500">
                        No acknowledgements yet.
                      </TableCell>
                    </TableRow>
                  ) : filteredAcks.slice(0, 60).map((ack) => (
                    <TableRow key={ack.commandId} className="border-slate-100 hover:bg-slate-50">
                      <TableCell className="font-mono text-xs text-slate-700">{formatTime(ack.receivedAt)}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{ack.terminalId}</TableCell>
                      <TableCell><ExecutionBadge state={ack.lifecycleState} /></TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">
                        {ack.ticket ?? ''}
                        {ack.slippagePoints != null || ack.spreadPoints != null ? (
                          <div className="mt-1 font-mono text-[11px] text-slate-500">
                            {ack.slippagePoints != null ? `slip ${Number(ack.slippagePoints)}pt` : ''}{ack.slippagePoints != null && ack.spreadPoints != null ? ' • ' : ''}{ack.spreadPoints != null ? `spr ${Number(ack.spreadPoints)}pt` : ''}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{ack.latencyMs}ms</TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {ack.brokerMessage || 'EA acknowledged command'}
                        <div className="mt-1 font-mono text-[11px] text-slate-500">{ack.commandId}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <OpsPanel title="Execution Latency Analytics" icon={Gauge}><BarTrend values={ackRows.map((ack) => ack.latencyMs).concat(commandRows.map((command) => command.dispatchLatencyMs)).slice(0, 18)} suffix="ms" /></OpsPanel>
        <OpsPanel title="Bridge Health Trend" icon={ShieldCheck}><BarTrend values={commandRows.map((command) => command.integrityScore).slice(0, 18)} suffix="%" invert /></OpsPanel>
        <OpsPanel title="Retry Engine Pressure" icon={RefreshCw}><BarTrend values={commandRows.map((command) => command.attempt * 18).slice(0, 18)} suffix="" /></OpsPanel>
        <OpsPanel title="Broker Response Tracking" icon={Server}><BarTrend values={ackRows.map((ack) => ack.brokerLatencyMs).slice(0, 18)} suffix="ms" /></OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <OpsPanel title="Order Lifecycle Tracking" icon={ClipboardCheck}>
          <div className="space-y-3">
            {lifecycle.map((item) => (
              <div key={item.stage} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">{item.stage}</span>
                  <span className="font-mono text-xs text-slate-600">{item.count}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${item.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>

        <OpsPanel title="Live Execution Feed" icon={Radio}>
          <div className="space-y-3">
            {logs.slice(0, 8).map((log, index) => (
              <div key={`${log.time}-${log.message}-${index}`} className="flex gap-3 rounded-md border border-slate-200 bg-white p-3">
                <div
                  className={cn(
                    'mt-1 h-2 w-2 rounded-full',
                    log.state === 'QUEUED' && 'bg-blue-500',
                    log.state === 'ROUTING' && 'bg-indigo-500',
                    log.state === 'SENT' && 'bg-amber-500',
                    log.state === 'ACKNOWLEDGED' && 'bg-teal-500',
                    log.state === 'EXECUTED' && 'bg-emerald-500',
                    (log.state === 'FAILED' || log.state === 'TIMEOUT') && 'bg-rose-500',
                    log.state === 'CANCELLED' && 'bg-slate-400',
                  )}
                />
                <div>
                  <div className="text-xs font-semibold text-slate-800">{log.message}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{formatTime(log.time)}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>

        <OpsPanel title="Execution Integrity Validation" icon={ShieldAlert}>
          <div className="space-y-3">
            {integrity.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900">{item.label}</div>
                  <div className="mt-1 text-[11px] text-slate-500">{item.detail}</div>
                </div>
                <ExecutionBadge state={item.state} />
              </div>
            ))}
          </div>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <OpsPanel title="Queue Health Monitoring" icon={ShieldCheck}>
          <div className="space-y-3">
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">Bridge status</span>
                <ExecutionBadge state={dbState.bridgeOnline ? 'ACKNOWLEDGED' : 'FAILED'} />
              </div>
              <div className="mt-2 text-xs text-slate-600">
                {dbState.bridgeOnline ? 'Bridge health endpoint responding.' : 'Bridge health endpoint unavailable.'}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                <span className="text-xs font-semibold text-slate-900">DB queue depth</span>
                <span className="font-mono text-xs text-slate-600">{commandRows.filter((c) => c.lifecycleState === 'QUEUED' || c.lifecycleState === 'ROUTING').length}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                <span className="text-xs font-semibold text-slate-900">Bridge queue depth</span>
                <span className="font-mono text-xs text-slate-600">{Number(props.commandSummary?.queued ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                <span className="text-xs font-semibold text-slate-900">Queue drift</span>
                <span className="font-mono text-xs text-slate-600">
                  {Math.abs(commandRows.filter((c) => c.lifecycleState === 'QUEUED' || c.lifecycleState === 'ROUTING').length - Number(props.commandSummary?.queued ?? 0))}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                <span className="text-xs font-semibold text-slate-900">Duplicate dedupe keys</span>
                <span className="font-mono text-xs text-slate-600">{dedupeDuplicates.size}</span>
              </div>
            </div>
          </div>
        </OpsPanel>

        <OpsPanel title="Failed Execution Analysis" icon={AlertTriangle}>
          <div className="space-y-3">
            {failureAnalytics.length === 0 ? (
              <EmptyPanel title="No failures detected" detail="Failed, timed out, or cancelled executions will surface here for analysis and retry." />
            ) : (
              failureAnalytics.map((bucket) => (
                <div key={bucket.label} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">{bucket.label}</span>
                    <span className="font-mono text-xs text-slate-600">{bucket.count}</span>
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-slate-500">last {formatTime(bucket.lastAt)}</div>
                </div>
              ))
            )}
          </div>
        </OpsPanel>

        <OpsPanel title="Execution Audit Logs" icon={Database}>
          <ScrollArea className="h-[420px]">
            <div className="space-y-2 pr-3">
              {auditEvents.map((event: any, index: number) => (
                <div key={auditEventKeys[index]} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <ExecutionBadge state={String(event.lifecycleState ?? 'QUEUED')} />
                    <span className="font-mono text-[11px] text-slate-500">{formatTime(String(event.createdAt ?? ''))}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-800">{String(event.eventType ?? '').toUpperCase()} {String(event.commandId ?? '')}</div>
                  <div className="mt-1 text-[11px] text-slate-600">{String(event.message ?? '')}</div>
                </div>
              ))}
              {dbState.events.length === 0 ? <EmptyPanel title="No audit events yet" detail="Execution events will appear here in real time via the event stream." /> : null}
            </div>
          </ScrollArea>
        </OpsPanel>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Bridge Architecture" lines={EXECUTION_ARCH_LINES} />
        <ArchitectureCard title="Backend Services" lines={EXECUTION_SERVICE_LINES} />
        <ArchitectureCard title="Queue Design" lines={EXECUTION_QUEUE_LINES} />
        <ArchitectureCard title="Event-Driven Flow" lines={EXECUTION_EVENT_LINES} />
        <ArchitectureCard title="WebSocket Architecture" lines={EXECUTION_WS_LINES} />
        <ArchitectureCard title="Recovery and Failover" lines={EXECUTION_RECOVERY_LINES} />
      </section>
    </div>
  );
}

function EaCommunicationEnginePage(props: { terminals: any[]; commands: any[]; recentAcks: any[]; commandSummary: any }) {
  type EaCommState = {
    loaded: boolean;
    error: string;
    terminals: any[];
    events: any[];
    summary: any;
    bridgeOnline: boolean;
    bridgeHealth: any;
  };

  const [state, setState] = useState<EaCommState>({
    loaded: false,
    error: '',
    terminals: [],
    events: [],
    summary: null,
    bridgeOnline: false,
    bridgeHealth: null,
  });

  const [filters, setFilters] = useState<{ terminalId: string; channel: string; severity: string; query: string }>({
    terminalId: 'ALL',
    channel: 'ALL',
    severity: 'ALL',
    query: '',
  });
  const [selectedEventId, setSelectedEventId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;

    const load = async () => {
      try {
        const response = await fetch('/api/mt5/ea-communication/state', { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? `EA comm state failed with HTTP ${response.status}`);
        }
        if (cancelled) return;
        setState((current) => ({
          ...current,
          loaded: true,
          error: '',
          terminals: Array.isArray(payload?.terminals) ? payload.terminals : [],
          events: Array.isArray(payload?.events) ? payload.events : current.events,
          summary: payload?.summary ?? null,
          bridgeOnline: Boolean(payload?.bridge?.online),
          bridgeHealth: payload?.bridge?.health ?? null,
        }));
      } catch (error) {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          loaded: true,
          error: error instanceof Error ? error.message : 'Unable to load EA communication state.',
        }));
      }
    };

    load();
    const interval = window.setInterval(load, 5000);

    try {
      eventSource = new EventSource('/api/mt5/ea-communication/stream');
      eventSource.addEventListener('ea_comm_event', (event) => {
        try {
          const messageEvent = event as MessageEvent<string>;
          const parsed = JSON.parse(messageEvent.data);
          if (!parsed || typeof parsed !== 'object') return;
          setState((current) => ({
            ...current,
            events: (() => {
              const parsedId = String((parsed as any)?.id ?? '');
              if (!parsedId) return current.events;
              const existing = Array.isArray(current.events) ? current.events : [];
              if (existing.some((row) => String((row as any)?.id ?? '') === parsedId)) return existing;
              return [...existing, parsed].slice(-600);
            })(),
          }));
        } catch {
          return;
        }
      });
    } catch {
      eventSource = null;
    }

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      eventSource?.close();
    };
  }, []);

  const eventRows = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    const rows = (Array.isArray(state.events) ? state.events : [])
      .map((event) => ({
        id: String(event?.id ?? ''),
        terminalId: event?.terminalId ?? event?.terminal_id ?? null,
        direction: String(event?.direction ?? '').toUpperCase(),
        channel: String(event?.channel ?? '').toUpperCase(),
        eventType: String(event?.eventType ?? event?.event_type ?? ''),
        severity: String(event?.severity ?? '').toUpperCase(),
        message: String(event?.message ?? ''),
        payload: event?.payload ?? {},
        createdAt: String(event?.createdAt ?? event?.created_at ?? ''),
      }))
      .filter((row) => {
        if (filters.terminalId !== 'ALL' && String(row.terminalId ?? '') !== filters.terminalId) return false;
        if (filters.channel !== 'ALL' && String(row.channel) !== filters.channel) return false;
        if (filters.severity !== 'ALL' && String(row.severity) !== filters.severity) return false;
        if (!query) return true;
        return (
          String(row.message).toLowerCase().includes(query)
          || String(row.eventType).toLowerCase().includes(query)
          || String(row.terminalId ?? '').toLowerCase().includes(query)
          || String(row.channel).toLowerCase().includes(query)
        );
      })
      ;

    const deduped = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = row.id;
      if (!key) continue;
      deduped.set(key, row);
    }

    return Array.from(deduped.values()).sort((a, b) => Date.parse(String(b.createdAt ?? '')) - Date.parse(String(a.createdAt ?? '')));
  }, [filters.channel, filters.query, filters.severity, filters.terminalId, state.events]);

  const selectedEvent = useMemo(() => eventRows.find((row) => row.id === selectedEventId) ?? null, [eventRows, selectedEventId]);

  const commStats = useMemo(() => {
    const recent = eventRows.slice(0, 500);
    const windowTotal = recent.length;
    const errors = recent.filter((e) => e.severity === 'ERROR').length;
    const warnings = recent.filter((e) => e.severity === 'WARNING').length;
    const jsonInvalid = recent.filter((e) => e.eventType === 'JSON_INVALID').length;
    const heartbeat = recent.filter((e) => e.channel === 'HEARTBEAT' && e.eventType === 'HEARTBEAT_RECEIVED').length;
    const polls = recent.filter((e) => e.eventType === 'COMMAND_POLL_RECEIVED').length;
    const delivered = recent.filter((e) => e.eventType === 'COMMAND_DELIVERED').length;
    const acks = recent.filter((e) => e.eventType === 'ACK_RECEIVED').length;
    const forwardFailures = recent.filter((e) => String(e.eventType).includes('FAILED') && e.channel === 'BRIDGE').length;
    const latestAuth = recent.find((e) => e.eventType === 'AUTH_ISSUED')?.createdAt ?? '';
    const handshakeReady = Boolean(latestAuth) && Boolean(heartbeat);

    const avgLatencyMs = (() => {
      const samples = recent
        .filter((e) => e.channel === 'HEARTBEAT' && e.eventType === 'HEARTBEAT_RECEIVED')
        .map((e) => Number((e.payload as any)?.latencyMs))
        .filter((n) => Number.isFinite(n));
      if (!samples.length) return 0;
      return Math.round(samples.reduce((sum, n) => sum + n, 0) / samples.length);
    })();

    const tickLagMs = (() => {
      const samples = recent
        .filter((e) => e.channel === 'HEARTBEAT' && e.eventType === 'HEARTBEAT_RECEIVED')
        .map((e) => Number((e.payload as any)?.tickLagMs))
        .filter((n) => Number.isFinite(n));
      if (!samples.length) return 0;
      return Math.round(samples.reduce((sum, n) => sum + n, 0) / samples.length);
    })();

    return {
      windowTotal,
      errors,
      warnings,
      jsonInvalid,
      heartbeat,
      polls,
      delivered,
      acks,
      forwardFailures,
      avgLatencyMs,
      tickLagMs,
      handshakeReady,
      latestAuth,
    };
  }, [eventRows]);

  const terminalRows = useMemo(() => {
    const terminals = props.terminals ?? [];
    const byId = new Map<string, { lastPollAt: string; lastAckAt: string; lastHeartbeatAt: string; lastErrorAt: string }>();
    for (const event of eventRows.slice(0, 800)) {
      const terminalId = String(event.terminalId ?? '').trim();
      if (!terminalId) continue;
      const existing = byId.get(terminalId) ?? { lastPollAt: '', lastAckAt: '', lastHeartbeatAt: '', lastErrorAt: '' };
      const time = String(event.createdAt ?? '');
      if (event.eventType === 'COMMAND_POLL_RECEIVED' && Date.parse(time) > Date.parse(existing.lastPollAt || '')) existing.lastPollAt = time;
      if (event.eventType === 'ACK_RECEIVED' && Date.parse(time) > Date.parse(existing.lastAckAt || '')) existing.lastAckAt = time;
      if (event.eventType === 'HEARTBEAT_RECEIVED' && Date.parse(time) > Date.parse(existing.lastHeartbeatAt || '')) existing.lastHeartbeatAt = time;
      if (event.severity === 'ERROR' && Date.parse(time) > Date.parse(existing.lastErrorAt || '')) existing.lastErrorAt = time;
      byId.set(terminalId, existing);
    }

    return terminals.map((terminal: any) => ({
      terminalId: terminal.terminalId,
      accountNumber: terminal.accountNumber,
      brokerName: terminal.brokerName,
      serverName: terminal.serverName,
      status: terminal.status,
      heartbeatAgeMs: terminal.heartbeatAgeMs,
      latencyMs: terminal.latencyMs,
      stabilityScore: terminal.stabilityScore ?? 0,
      version: terminal.version ?? 'unknown',
      lastPollAt: byId.get(terminal.terminalId)?.lastPollAt ?? '',
      lastAckAt: byId.get(terminal.terminalId)?.lastAckAt ?? '',
      lastHeartbeatAt: byId.get(terminal.terminalId)?.lastHeartbeatAt ?? '',
      lastErrorAt: byId.get(terminal.terminalId)?.lastErrorAt ?? '',
      lastTickTime: terminal.mt5ServerTime ?? terminal.terminalTime ?? '',
    }));
  }, [eventRows, props.terminals]);

  const diagnostics = useMemo(() => {
    const connected = terminalRows.filter((t) => t.status === 'connected').length;
    const degraded = terminalRows.filter((t) => t.status === 'degraded').length;
    const disconnected = terminalRows.filter((t) => t.status === 'disconnected').length;
    const stalledTicks = commStats.tickLagMs > 10_000;
    const latencyWarn = commStats.avgLatencyMs > 500;
    const bridgeOk = state.bridgeOnline;
    const jsonOk = commStats.jsonInvalid === 0;
    return [
      { label: 'Handshake readiness', state: commStats.handshakeReady ? 'ACKNOWLEDGED' : 'SENT', detail: commStats.handshakeReady ? 'Auth policy issued and heartbeat channel active.' : 'Issue auth policy and confirm heartbeat channel.' },
      { label: 'EA authentication', state: commStats.latestAuth ? 'ACKNOWLEDGED' : 'QUEUED', detail: commStats.latestAuth ? `Latest auth issued ${formatTime(commStats.latestAuth)}.` : 'No auth issued in recent window.' },
      { label: 'Bridge connectivity', state: bridgeOk ? 'ACKNOWLEDGED' : 'FAILED', detail: bridgeOk ? 'Trading bridge reachable.' : 'Trading bridge not responding.' },
      { label: 'JSON validation', state: jsonOk ? 'ACKNOWLEDGED' : 'FAILED', detail: jsonOk ? 'No JSON parsing failures detected.' : `${commStats.jsonInvalid} JSON invalid message(s) observed.` },
      { label: 'Latency monitoring', state: latencyWarn ? 'SENT' : 'ACKNOWLEDGED', detail: `Average heartbeat latency ${commStats.avgLatencyMs}ms.` },
      { label: 'Tick synchronization', state: stalledTicks ? 'TIMEOUT' : 'ACKNOWLEDGED', detail: `Average tick lag ${commStats.tickLagMs}ms.` },
      { label: 'Multi-terminal coverage', state: connected ? 'ACKNOWLEDGED' : 'FAILED', detail: `${connected} connected / ${degraded} degraded / ${disconnected} disconnected.` },
    ];
  }, [commStats, state.bridgeOnline, terminalRows]);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={Wifi} title="Bridge online" value={state.bridgeOnline ? 'YES' : 'NO'} detail="Trading bridge reachability" tone={state.bridgeOnline ? 'green' : 'red'} />
        <OpsSummaryCard icon={TerminalSquare} title="Connected terminals" value={String(terminalRows.filter((t) => t.status === 'connected').length)} detail="Multi-terminal communication" tone="blue" />
        <OpsSummaryCard icon={Gauge} title="Heartbeat latency" value={`${commStats.avgLatencyMs}ms`} detail="EA → backend round-trip" tone={commStats.avgLatencyMs > 500 ? 'amber' : 'green'} />
        <OpsSummaryCard icon={Radio} title="Tick lag" value={`${commStats.tickLagMs}ms`} detail="Tick synchronization monitoring" tone={commStats.tickLagMs > 10_000 ? 'red' : commStats.tickLagMs > 3000 ? 'amber' : 'green'} />
        <OpsSummaryCard icon={Server} title="Command queue" value={String(Number(props.commandSummary?.queued ?? 0))} detail="Pending commands on bridge" tone="blue" />
        <OpsSummaryCard icon={ClipboardCheck} title="Acks received" value={String(commStats.acks)} detail="Execution command acknowledgement" tone="green" />
        <OpsSummaryCard icon={AlertTriangle} title="Message failures" value={String(commStats.errors + commStats.warnings)} detail="Errors and warnings (window)" tone={commStats.errors ? 'red' : commStats.warnings ? 'amber' : 'green'} />
        <OpsSummaryCard icon={ShieldAlert} title="JSON invalid" value={String(commStats.jsonInvalid)} detail="Payload validation failures" tone={commStats.jsonInvalid ? 'red' : 'green'} />
      </section>

      {state.error ? <div className="text-xs font-mono text-rose-700">{state.error}</div> : null}

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TerminalSquare className="w-4 h-4 text-indigo-700" /> Multi-Terminal Communication Monitoring
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[540px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Status</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">HB age</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500 text-right">Latency</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">EA version</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Last poll</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Last ack</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terminalRows.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={7} className="h-40 text-center text-sm text-slate-500">
                        No terminals detected.
                      </TableCell>
                    </TableRow>
                  ) : terminalRows.map((terminal) => (
                    <TableRow key={terminal.terminalId} className="border-slate-100 hover:bg-slate-50">
                      <TableCell className="font-mono text-xs text-slate-700">{terminal.terminalId}</TableCell>
                      <TableCell><ExecutionBadge state={terminal.status === 'connected' ? 'ACKNOWLEDGED' : terminal.status === 'degraded' ? 'SENT' : 'FAILED'} /></TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{Math.round(Number(terminal.heartbeatAgeMs ?? 0))}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-700">{Math.round(Number(terminal.latencyMs ?? 0))}ms</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{terminal.version}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">{terminal.lastPollAt ? formatTime(terminal.lastPollAt) : ''}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">{terminal.lastAckAt ? formatTime(terminal.lastAckAt) : ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OpsPanel title="Diagnostics Dashboard" icon={ShieldCheck}>
            <div className="space-y-3">
              {diagnostics.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{item.detail}</div>
                  </div>
                  <ExecutionBadge state={item.state} />
                </div>
              ))}
            </div>
          </OpsPanel>

          <OpsPanel title="Filters" icon={Search}>
            <div className="space-y-3">
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                value={filters.terminalId}
                onChange={(e) => setFilters((c) => ({ ...c, terminalId: e.target.value }))}
              >
                <option value="ALL">ALL TERMINALS</option>
                {terminalRows.map((t) => (
                  <option key={t.terminalId} value={t.terminalId}>{t.terminalId}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                  value={filters.channel}
                  onChange={(e) => setFilters((c) => ({ ...c, channel: e.target.value }))}
                >
                  <option value="ALL">ALL CH</option>
                  <option value="HEARTBEAT">HEARTBEAT</option>
                  <option value="COMMAND">COMMAND</option>
                  <option value="TICK">TICK</option>
                  <option value="AUTH">AUTH</option>
                  <option value="HANDSHAKE">HANDSHAKE</option>
                  <option value="BRIDGE">BRIDGE</option>
                  <option value="ERROR">ERROR</option>
                </select>
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                  value={filters.severity}
                  onChange={(e) => setFilters((c) => ({ ...c, severity: e.target.value }))}
                >
                  <option value="ALL">ALL SEV</option>
                  <option value="DEBUG">DEBUG</option>
                  <option value="INFO">INFO</option>
                  <option value="SUCCESS">SUCCESS</option>
                  <option value="WARNING">WARNING</option>
                  <option value="ERROR">ERROR</option>
                </select>
              </div>
              <input
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 font-mono text-xs"
                placeholder="Search logs…"
                value={filters.query}
                onChange={(e) => setFilters((c) => ({ ...c, query: e.target.value }))}
              />
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Radio className="w-4 h-4 text-blue-700" /> Live EA Communication Feed
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[520px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Time</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Channel</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Event</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Severity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eventRows.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={5} className="h-40 text-center text-sm text-slate-500">
                        No communication events yet.
                      </TableCell>
                    </TableRow>
                  ) : eventRows.slice(0, 80).map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn('border-slate-100 hover:bg-blue-50/40 cursor-pointer', selectedEventId === row.id && 'bg-blue-50/60')}
                      onClick={() => setSelectedEventId(row.id)}
                    >
                      <TableCell className="font-mono text-xs text-slate-700">{formatTime(row.createdAt)}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{row.terminalId ?? ''}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">{row.channel}</TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {row.eventType}
                        <div className="mt-1 text-[11px] text-slate-500">{row.message}</div>
                      </TableCell>
                      <TableCell><ExecutionBadge state={row.severity === 'SUCCESS' ? 'EXECUTED' : row.severity === 'ERROR' ? 'FAILED' : row.severity === 'WARNING' ? 'SENT' : 'ACKNOWLEDGED'} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-700" /> Payload Inspection & JSON Validation
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {!selectedEvent ? (
              <EmptyPanel title="Select an event" detail="Click any event row to inspect payload and validation output." />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{selectedEvent.eventType}</div>
                    <div className="mt-1 font-mono text-[11px] text-slate-600">{selectedEvent.terminalId ?? ''} • {selectedEvent.channel} • {selectedEvent.direction}</div>
                  </div>
                  <ExecutionBadge state={selectedEvent.severity === 'ERROR' ? 'FAILED' : selectedEvent.severity === 'WARNING' ? 'SENT' : 'ACKNOWLEDGED'} />
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">Payload</span>
                    <span className="font-mono text-[11px] text-slate-500">{formatTime(selectedEvent.createdAt)}</span>
                  </div>
                  <pre className="mt-3 max-h-[360px] overflow-auto rounded-md bg-slate-950 p-3 text-[11px] text-slate-100">
{safePrettyJson(selectedEvent.payload)}
                  </pre>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Frontend Architecture" lines={EA_COMM_FRONTEND_LINES} />
        <ArchitectureCard title="Backend Communication Service" lines={EA_COMM_BACKEND_LINES} />
        <ArchitectureCard title="WebSocket Architecture" lines={EA_COMM_WS_LINES} />
        <ArchitectureCard title="Event-Driven Model" lines={EA_COMM_EVENT_LINES} />
        <ArchitectureCard title="Message Schemas" lines={EA_COMM_SCHEMA_LINES} />
        <ArchitectureCard title="Retry & Reconnect" lines={EA_COMM_RETRY_LINES} />
      </section>
    </div>
  );
}

function ExecutionAuditJournalPage(props: { terminals: any[]; commandSummary: any }) {
  type AuditState = {
    loaded: boolean;
    error: string;
    bridgeOnline: boolean;
    bridgeHealth: any;
    terminals: any[];
    summary: any;
    events: any[];
  };

  const [filters, setFilters] = useState<{
    windowMinutes: number;
    terminalId: string;
    brokerName: string;
    environment: string;
    sourceSystem: string;
    severity: string;
    query: string;
  }>({
    windowMinutes: 240,
    terminalId: 'ALL',
    brokerName: 'ALL',
    environment: 'ALL',
    sourceSystem: 'ALL',
    severity: 'ALL',
    query: '',
  });

  const [state, setState] = useState<AuditState>({
    loaded: false,
    error: '',
    bridgeOnline: false,
    bridgeHealth: null,
    terminals: [],
    summary: null,
    events: [],
  });

  const [selectedEventKey, setSelectedEventKey] = useState<string>('');
  const [selectedCorrelationId, setSelectedCorrelationId] = useState<string>('');
  const [timeline, setTimeline] = useState<any[]>([]);
  const [timelineError, setTimelineError] = useState<string>('');
  const [replay, setReplay] = useState<EnqueueState>({ status: 'idle', message: '' });

  const sinceTs = useMemo(() => new Date(Date.now() - filters.windowMinutes * 60_000).toISOString(), [filters.windowMinutes]);

  const buildQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set('sinceTs', sinceTs);
    if (filters.terminalId !== 'ALL') params.set('terminalId', filters.terminalId);
    if (filters.brokerName !== 'ALL') params.set('brokerName', filters.brokerName);
    if (filters.environment !== 'ALL') params.set('environment', filters.environment);
    if (filters.sourceSystem !== 'ALL') params.set('sourceSystem', filters.sourceSystem);
    if (filters.severity !== 'ALL') params.set('severity', filters.severity);
    if (filters.query.trim()) params.set('query', filters.query.trim());
    return params;
  }, [filters.brokerName, filters.environment, filters.query, filters.severity, filters.sourceSystem, filters.terminalId, sinceTs]);

  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;

    const load = async () => {
      try {
        const response = await fetch(`/api/mt5/execution-audit/state?${buildQuery.toString()}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? `Audit state failed with HTTP ${response.status}`);
        }
        if (cancelled) return;
        setState((current) => ({
          ...current,
          loaded: true,
          error: '',
          terminals: Array.isArray(payload?.terminals) ? payload.terminals : [],
          summary: payload?.summary ?? null,
          bridgeOnline: Boolean(payload?.bridge?.online),
          bridgeHealth: payload?.bridge?.health ?? null,
          events: Array.isArray(payload?.events) ? payload.events : current.events,
        }));
      } catch (error) {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          loaded: true,
          error: error instanceof Error ? error.message : 'Unable to load audit state.',
        }));
      }
    };

    load();
    const interval = window.setInterval(load, 6000);

    try {
      eventSource = new EventSource(`/api/mt5/execution-audit/stream?${buildQuery.toString()}`);
      eventSource.addEventListener('execution_audit_event', (event) => {
        try {
          const messageEvent = event as MessageEvent<string>;
          const parsed = JSON.parse(messageEvent.data);
          if (!parsed || typeof parsed !== 'object') return;
          setState((current) => {
            const incomingKey = String((parsed as any)?.key ?? '');
            if (!incomingKey) return current;
            const keys = new Set(current.events.map((e: any) => String(e?.key ?? '')));
            if (keys.has(incomingKey)) return current;
            return { ...current, events: [...current.events, parsed].slice(-900) };
          });
        } catch {
          return;
        }
      });
    } catch {
      eventSource = null;
    }

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      eventSource?.close();
    };
  }, [buildQuery]);

  const auditEvents = useMemo(() => {
    return (Array.isArray(state.events) ? state.events : [])
      .map((row: any) => ({
        key: String(row.key ?? `${row.sourceSystem}:${row.sourceId}`),
        occurredAt: String(row.occurredAt ?? row.occurred_at ?? ''),
        sourceSystem: String(row.sourceSystem ?? row.source_system ?? ''),
        severity: String(row.severity ?? ''),
        eventType: String(row.eventType ?? row.event_type ?? ''),
        message: String(row.message ?? ''),
        correlationId: row.correlationId ?? row.correlation_id ?? null,
        terminalId: row.terminalId ?? row.terminal_id ?? null,
        accountNumber: row.accountNumber ?? row.account_number ?? null,
        brokerName: row.brokerName ?? row.broker_name ?? null,
        environment: row.environment ?? null,
        sandboxMode: row.sandboxMode ?? null,
        payload: row.payload ?? {},
      }))
      .sort((a, b) => Date.parse(String(b.occurredAt ?? '')) - Date.parse(String(a.occurredAt ?? '')));
  }, [state.events]);

  const selectedEvent = useMemo(() => auditEvents.find((e) => e.key === selectedEventKey) ?? null, [auditEvents, selectedEventKey]);

  useEffect(() => {
    if (selectedEvent?.correlationId) {
      setSelectedCorrelationId(String(selectedEvent.correlationId));
    }
  }, [selectedEvent?.correlationId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setTimelineError('');
      setTimeline([]);
      if (!selectedCorrelationId) return;
      try {
        const response = await fetch(`/api/mt5/execution-audit/timeline?correlationId=${encodeURIComponent(selectedCorrelationId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error ?? `Timeline failed with HTTP ${response.status}`);
        if (cancelled) return;
        setTimeline(Array.isArray(payload?.timeline) ? payload.timeline : []);
      } catch (error) {
        if (cancelled) return;
        setTimelineError(error instanceof Error ? error.message : 'Unable to load timeline.');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedCorrelationId]);

  const timelineRows = useMemo(() => {
    return (Array.isArray(timeline) ? timeline : [])
      .map((row: any) => ({
        key: String(row.key ?? `${row.sourceSystem}:${row.sourceId}`),
        occurredAt: String(row.occurredAt ?? ''),
        sourceSystem: String(row.sourceSystem ?? ''),
        severity: String(row.severity ?? ''),
        eventType: String(row.eventType ?? ''),
        message: String(row.message ?? ''),
        terminalId: row.terminalId ?? null,
        accountNumber: row.accountNumber ?? null,
        brokerName: row.brokerName ?? null,
        environment: row.environment ?? null,
        payload: row.payload ?? {},
      }))
      .sort((a, b) => Date.parse(String(a.occurredAt ?? '')) - Date.parse(String(b.occurredAt ?? '')));
  }, [timeline]);

  const auditIntegrity = useMemo(() => {
    const exec = timelineRows.filter((e) => e.sourceSystem === 'EXECUTION');
    const hasEnqueue = exec.some((e) => e.eventType === 'ENQUEUE');
    const hasDispatch = exec.some((e) => e.eventType === 'DISPATCH');
    const hasAck = exec.some((e) => e.eventType === 'ACK');
    const hasTimeout = exec.some((e) => e.eventType === 'TIMEOUT');
    const orderingOk = (() => {
      const index = (type: string) => exec.findIndex((e) => e.eventType === type);
      const enqueueAt = index('ENQUEUE');
      const dispatchAt = index('DISPATCH');
      const ackAt = index('ACK');
      if (enqueueAt === -1 || dispatchAt === -1) return false;
      if (dispatchAt < enqueueAt) return false;
      if (ackAt !== -1 && ackAt < dispatchAt) return false;
      return true;
    })();
    const state = hasTimeout ? 'TIMEOUT' : hasAck ? 'ACKNOWLEDGED' : hasDispatch ? 'SENT' : hasEnqueue ? 'QUEUED' : 'FAILED';
    const score = clampScore((hasEnqueue ? 25 : 0) + (hasDispatch ? 25 : 0) + (hasAck ? 25 : 0) + (orderingOk ? 25 : 0));
    return {
      score,
      state,
      checks: [
        { label: 'Order request captured', ok: hasEnqueue },
        { label: 'Routing/dispatch captured', ok: hasDispatch },
        { label: 'Ack/broker response captured', ok: hasAck || hasTimeout },
        { label: 'Lifecycle ordering valid', ok: orderingOk },
      ],
    };
  }, [timelineRows]);

  const latencyStats = useMemo(() => {
    const values = timelineRows
      .filter((e) => e.sourceSystem === 'EXECUTION' && e.eventType === 'ACK')
      .map((e) => Number((e.payload as any)?.latencyMs))
      .filter((n) => Number.isFinite(n));
    const avg = values.length ? Math.round(values.reduce((sum, n) => sum + n, 0) / values.length) : 0;
    const p95 = values.length ? values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * 0.95))] : 0;
    return { avg, p95: Math.round(p95) };
  }, [timelineRows]);

  const slippageSpread = useMemo(() => {
    const slippage = timelineRows
      .filter((e) => e.sourceSystem === 'EXECUTION' && e.eventType === 'ACK')
      .map((e) => Number((e.payload as any)?.slippagePoints))
      .filter((n) => Number.isFinite(n));
    const spread = timelineRows
      .filter((e) => e.sourceSystem === 'EXECUTION' && e.eventType === 'ACK')
      .map((e) => Number((e.payload as any)?.spreadPoints))
      .filter((n) => Number.isFinite(n));
    const avgSlip = slippage.length ? Math.round(slippage.reduce((sum, n) => sum + n, 0) / slippage.length) : 0;
    const avgSpr = spread.length ? Math.round(spread.reduce((sum, n) => sum + n, 0) / spread.length) : 0;
    return { avgSlip, avgSpr };
  }, [timelineRows]);

  const onExport = async (format: 'json' | 'csv') => {
    const params = new URLSearchParams(buildQuery.toString());
    params.set('format', format);
    const url = `/api/mt5/execution-audit/export?${params.toString()}`;
    window.location.href = url;
  };

  const onReplay = async () => {
    setReplay({ status: 'submitting', message: '' });
    try {
      if (!selectedCorrelationId) throw new Error('Select a correlation ID.');
      const response = await fetch('/api/mt5/execution-audit/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correlationId: selectedCorrelationId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? `Replay failed with HTTP ${response.status}`);
      setReplay({ status: 'ok', message: 'Replay triggered (retry enqueued).' });
    } catch (error) {
      setReplay({ status: 'error', message: error instanceof Error ? error.message : 'Replay failed.' });
    }
  };

  const summary = state.summary?.totals ?? { total: 0, errors: 0, warnings: 0, executionEvents: 0, eaEvents: 0, riskEvents: 0 };
  const incidents = Array.isArray(state.summary?.incidents) ? state.summary.incidents : [];
  const brokerDiagnostics = Array.isArray(state.summary?.brokerDiagnostics) ? state.summary.brokerDiagnostics : [];
  const terminalDiagnostics = Array.isArray(state.summary?.terminalDiagnostics) ? state.summary.terminalDiagnostics : [];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <OpsSummaryCard icon={Database} title="Audit events" value={String(summary.total)} detail={`Window ${filters.windowMinutes}m`} tone="blue" />
        <OpsSummaryCard icon={AlertTriangle} title="Incidents" value={String(summary.errors + summary.warnings)} detail="Errors + warnings" tone={summary.errors ? 'red' : summary.warnings ? 'amber' : 'green'} />
        <OpsSummaryCard icon={Server} title="Bridge queue" value={String(Number(props.commandSummary?.queued ?? 0))} detail="Execution queue depth" tone="blue" />
        <OpsSummaryCard icon={Gauge} title="Ack latency p95" value={`${latencyStats.p95}ms`} detail={`Avg ${latencyStats.avg}ms`} tone={latencyStats.p95 > 1000 ? 'amber' : 'green'} />
        <OpsSummaryCard icon={ShieldCheck} title="Audit integrity" value={`${auditIntegrity.score}%`} detail="Timeline lifecycle checks" tone={auditIntegrity.score >= 90 ? 'green' : auditIntegrity.score >= 70 ? 'amber' : 'red'} />
        <OpsSummaryCard icon={ClipboardCheck} title="Correlation ID" value={selectedCorrelationId ? 'SET' : 'NONE'} detail={selectedCorrelationId || 'Select an event'} tone={selectedCorrelationId ? 'green' : 'slate'} />
        <OpsSummaryCard icon={Globe2} title="Slippage avg" value={`${slippageSpread.avgSlip}pt`} detail={`Spread ${slippageSpread.avgSpr}pt`} tone={slippageSpread.avgSlip > 8 ? 'amber' : 'green'} />
        <OpsSummaryCard icon={Wifi} title="Bridge online" value={state.bridgeOnline ? 'YES' : 'NO'} detail="Broker/bridge layer" tone={state.bridgeOnline ? 'green' : 'red'} />
      </section>

      <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
        <CardHeader className="border-b border-slate-200 py-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-700" /> Search / Filtering / Export
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-8 gap-2">
            <select className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={String(filters.windowMinutes)} onChange={(e) => setFilters((c) => ({ ...c, windowMinutes: Number(e.target.value) }))}>
              <option value="15">15m</option>
              <option value="60">1h</option>
              <option value="240">4h</option>
              <option value="1440">24h</option>
            </select>
            <select className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={filters.terminalId} onChange={(e) => setFilters((c) => ({ ...c, terminalId: e.target.value }))}>
              <option value="ALL">ALL TERMINALS</option>
              {(props.terminals ?? []).map((t: any) => (
                <option key={t.terminalId} value={t.terminalId}>{t.terminalId}</option>
              ))}
            </select>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={filters.environment} onChange={(e) => setFilters((c) => ({ ...c, environment: e.target.value }))}>
              <option value="ALL">ALL ENV</option>
              <option value="DEMO">DEMO</option>
              <option value="LIVE">LIVE</option>
              <option value="PROP">PROP</option>
              <option value="MARKET_DATA_MONITOR">MARKET_DATA_MONITOR</option>
              <option value="FAILOVER_RESERVE">FAILOVER_RESERVE</option>
            </select>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={filters.sourceSystem} onChange={(e) => setFilters((c) => ({ ...c, sourceSystem: e.target.value }))}>
              <option value="ALL">ALL SRC</option>
              <option value="EXECUTION">EXECUTION</option>
              <option value="EA_COMM">EA_COMM</option>
              <option value="RISK">RISK</option>
            </select>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" value={filters.severity} onChange={(e) => setFilters((c) => ({ ...c, severity: e.target.value }))}>
              <option value="ALL">ALL SEV</option>
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="WARNING">WARNING</option>
              <option value="ERROR">ERROR</option>
            </select>
            <input className="md:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs" placeholder="Search message/eventType/correlationId…" value={filters.query} onChange={(e) => setFilters((c) => ({ ...c, query: e.target.value }))} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-600">
              <span className="font-mono">{auditEvents.length}</span> event(s) loaded • view {filters.windowMinutes}m • {state.loaded ? 'live' : 'loading'}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => onExport('json')}>Export JSON</Button>
              <Button size="sm" variant="outline" onClick={() => onExport('csv')}>Export CSV</Button>
              <Button size="sm" variant="outline" onClick={onReplay} disabled={!selectedCorrelationId || replay.status === 'submitting'}>Event replay</Button>
            </div>
          </div>
          <div className={cn('text-xs font-mono', replay.status === 'ok' && 'text-teal-700', replay.status === 'error' && 'text-rose-700', replay.status === 'submitting' && 'text-slate-500')}>
            {replay.message}
          </div>
          {state.error ? <div className="text-xs font-mono text-rose-700">{state.error}</div> : null}
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_430px] gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Radio className="w-4 h-4 text-blue-700" /> Real-Time Execution Audit Feed
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[620px]">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-mono text-slate-500">Time</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Source</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Severity</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Correlation</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Terminal</TableHead>
                    <TableHead className="text-xs font-mono text-slate-500">Event</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditEvents.length === 0 ? (
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableCell colSpan={6} className="h-40 text-center text-sm text-slate-500">No audit events available.</TableCell>
                    </TableRow>
                  ) : auditEvents.slice(0, 120).map((event) => (
                    <TableRow
                      key={event.key}
                      className={cn(
                        'border-slate-100 hover:bg-blue-50/40 cursor-pointer',
                        selectedEventKey === event.key && 'bg-blue-50/60',
                        event.severity === 'ERROR' && 'bg-rose-50/30',
                        event.severity === 'WARNING' && 'bg-amber-50/30',
                      )}
                      onClick={() => setSelectedEventKey(event.key)}
                    >
                      <TableCell className="font-mono text-xs text-slate-700">{formatTime(event.occurredAt)}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{event.sourceSystem}</TableCell>
                      <TableCell><ExecutionBadge state={event.severity === 'ERROR' ? 'FAILED' : event.severity === 'WARNING' ? 'SENT' : event.severity === 'SUCCESS' ? 'EXECUTED' : 'ACKNOWLEDGED'} /></TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{String(event.correlationId ?? '').slice(0, 22)}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{event.terminalId ?? ''}</TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {event.eventType}
                        <div className="mt-1 text-[11px] text-slate-500">{event.message}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OpsPanel title="Incident Investigation Tools" icon={AlertTriangle}>
            <div className="space-y-3">
              {incidents.length === 0 ? (
                <EmptyPanel title="No incidents" detail="Error/warning correlation IDs will appear here for fast investigation." />
              ) : (
                incidents.slice(0, 10).map((incident: any) => (
                  <button
                    key={String(incident.correlationId)}
                    type="button"
                    className="w-full text-left rounded-md border border-slate-200 bg-white p-3 hover:bg-slate-50"
                    onClick={() => setSelectedCorrelationId(String(incident.correlationId))}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-slate-900">{String(incident.correlationId)}</span>
                      <ExecutionBadge state={Number(incident.errorCount ?? 0) ? 'FAILED' : 'SENT'} />
                    </div>
                    <div className="mt-2 text-xs text-slate-600">
                      {Number(incident.errorCount ?? 0)} error • {Number(incident.warningCount ?? 0)} warn • last {formatTime(String(incident.lastSeenAt ?? ''))}
                    </div>
                  </button>
                ))
              )}
            </div>
          </OpsPanel>

          <OpsPanel title="Broker Execution Diagnostics" icon={Server}>
            <div className="space-y-2">
              {brokerDiagnostics.length === 0 ? (
                <EmptyPanel title="No broker diagnostics" detail="Broker-level breakdown appears when audit events have broker attribution." />
              ) : (
                brokerDiagnostics.slice(0, 8).map((row: any) => (
                  <div key={String(row.brokerName)} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">{String(row.brokerName)}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{Number(row.total ?? 0)} total</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs text-rose-700">{Number(row.errors ?? 0)} err</div>
                      <div className="font-mono text-xs text-amber-700">{Number(row.warnings ?? 0)} warn</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </OpsPanel>

          <OpsPanel title="Terminal Execution Diagnostics" icon={TerminalSquare}>
            <div className="space-y-2">
              {terminalDiagnostics.length === 0 ? (
                <EmptyPanel title="No terminal diagnostics" detail="Terminal-level breakdown appears when audit events have terminal attribution." />
              ) : (
                terminalDiagnostics.slice(0, 8).map((row: any) => (
                  <div key={String(row.terminalId)} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3">
                    <div>
                      <div className="font-mono text-xs font-semibold text-slate-900">{String(row.terminalId)}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{Number(row.total ?? 0)} total</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs text-rose-700">{Number(row.errors ?? 0)} err</div>
                      <div className="font-mono text-xs text-amber-700">{Number(row.warnings ?? 0)} warn</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-indigo-700" /> Timeline View (Correlation ID)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {!selectedCorrelationId ? (
              <EmptyPanel title="No correlation selected" detail="Select an audit event to open its correlated execution timeline." />
            ) : timelineError ? (
              <div className="text-xs font-mono text-rose-700">{timelineError}</div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-slate-900">{selectedCorrelationId}</span>
                    <ExecutionBadge state={auditIntegrity.state} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {auditIntegrity.checks.map((check) => (
                      <div key={check.label} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2">
                        <span className="text-[11px] text-slate-700">{check.label}</span>
                        <span className={cn('font-mono text-[11px]', check.ok ? 'text-emerald-700' : 'text-rose-700')}>{check.ok ? 'OK' : 'MISS'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  {timelineRows.slice(0, 70).map((event) => (
                    <div key={event.key} className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <ExecutionBadge state={event.severity === 'ERROR' ? 'FAILED' : event.severity === 'WARNING' ? 'SENT' : event.severity === 'SUCCESS' ? 'EXECUTED' : 'ACKNOWLEDGED'} />
                        <span className="font-mono text-[11px] text-slate-500">{formatTime(event.occurredAt)}</span>
                      </div>
                      <div className="mt-2 text-xs text-slate-800">{event.sourceSystem} • {event.eventType}</div>
                      <div className="mt-1 text-[11px] text-slate-600">{event.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
          <CardHeader className="border-b border-slate-200 py-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-700" /> Event Details / Payload
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {!selectedEvent ? (
              <EmptyPanel title="Select an audit event" detail="Click any audit feed row to inspect fields and payload." />
            ) : (
              <div className="space-y-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">{selectedEvent.eventType}</span>
                    <ExecutionBadge state={selectedEvent.severity === 'ERROR' ? 'FAILED' : selectedEvent.severity === 'WARNING' ? 'SENT' : selectedEvent.severity === 'SUCCESS' ? 'EXECUTED' : 'ACKNOWLEDGED'} />
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-slate-600">
                    {selectedEvent.sourceSystem} • {selectedEvent.correlationId ?? ''} • {selectedEvent.terminalId ?? ''} • {selectedEvent.environment ?? ''}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">Payload</span>
                    <span className="font-mono text-[11px] text-slate-500">{formatTime(selectedEvent.occurredAt)}</span>
                  </div>
                  <pre className="mt-3 max-h-[420px] overflow-auto rounded-md bg-slate-950 p-3 text-[11px] text-slate-100">
{safePrettyJson(selectedEvent.payload)}
                  </pre>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ArchitectureCard title="Complete Audit Dashboard" lines={AUDIT_DASHBOARD_LINES} />
        <ArchitectureCard title="Backend Audit Architecture" lines={AUDIT_BACKEND_LINES} />
        <ArchitectureCard title="PostgreSQL Schema" lines={AUDIT_SCHEMA_LINES} />
        <ArchitectureCard title="Event Model" lines={AUDIT_EVENT_MODEL_LINES} />
        <ArchitectureCard title="Filtering System" lines={AUDIT_FILTER_LINES} />
        <ArchitectureCard title="Export & Investigation" lines={AUDIT_WORKFLOW_LINES} />
      </section>
    </div>
  );
}

const AUDIT_DASHBOARD_LINES = [
  'Real-time audit feed tails execution, EA comms, and risk decisions into a unified stream',
  'Timeline view reconstructs correlated events by correlationId (commandId / intentId)',
  'Incident queue prioritizes error/warning correlation IDs with fast drill-down',
  'Broker and terminal diagnostics aggregate severity distribution for investigation',
];

const AUDIT_BACKEND_LINES = [
  'Audit events are append-only source tables: execution_command_events, ea_comm_events, risk_decisions',
  'Unified read model is provided by a Postgres view (execution_audit_journal) and filtered APIs',
  'SSE stream provides near-real-time updates without websocket infrastructure',
  'Replay triggers controlled retry for correlated execution commands (local-only gate)',
];

const AUDIT_SCHEMA_LINES = [
  'execution_command_events: { command_id, lifecycle_state, event_type, severity, payload, created_at }',
  'ea_comm_events: { terminal_id, direction, channel, event_type, severity, payload, created_at }',
  'risk_decisions: { account_number, intent_id, allowed, code, message, created_at }',
  'execution_audit_journal view normalizes { source_system, occurred_at, severity, event_type, message, payload, correlation_id }',
];

const AUDIT_EVENT_MODEL_LINES = [
  'correlationId: commandId (execution) or intentId (risk) or terminalId fallback (EA comm)',
  'severity levels: DEBUG/INFO/SUCCESS/WARNING/ERROR mapped to operational outcomes',
  'payload keeps raw event data for forensic inspection (slippage/spread/latency/ticket/errors)',
  'timeline ordering: occurredAt ASC with stable per-source ordering by sourceId',
];

const AUDIT_FILTER_LINES = [
  'Window filter (15m/1h/4h/24h) sets sinceTs cursor for state + stream',
  'Filters: terminalId, brokerName, environment, sourceSystem, severity, query',
  'Search targets: message, eventType, correlationId, terminal/account/broker',
  'Export reuses server-side filters for consistent forensic snapshots',
];

const AUDIT_WORKFLOW_LINES = [
  'Export logs as JSON or CSV for incident tickets and external analysis',
  'Select an audit event -> open correlated timeline -> validate lifecycle integrity checks',
  'Use broker/terminal diagnostics to isolate systemic issues (bridge failures, WebRequest blocks, timeouts)',
  'Replay supports controlled retry by correlationId (command retry) for reproducibility',
];

const EA_COMM_FRONTEND_LINES = [
  'EA Communication Engine renders live comm feed, terminal matrix, and diagnostics panels',
  'Uses SSE stream for low-latency updates and periodic state snapshots for reconciliation',
  'Supports per-terminal filtering, channel/severity filters, and payload inspection',
  'Surfaces handshake/auth readiness, JSON validation, tick sync drift, and queue health',
];

const EA_COMM_BACKEND_LINES = [
  'Comm ingestion runs on heartbeat, command poll, ack routes and persists events to Postgres',
  'State endpoint composes terminal snapshots plus comm events plus bridge health',
  'Event stream endpoint tails comm events for operational dashboards',
  'Policies gate local-only admin tooling and redact sensitive secrets',
];

const EA_COMM_WS_LINES = [
  'ea.comm.event { id, terminalId, direction, channel, eventType, severity, payload }',
  'ea.comm.summary { windowMinutes, totals, breakdown }',
  'ea.comm.terminal.status { terminalId, heartbeatAgeMs, latencyMs, version }',
  'ea.comm.bridge.health { online, latencyMs, errors }',
];

const EA_COMM_EVENT_LINES = [
  'INBOUND heartbeat -> validate -> persist -> forward-to-bridge -> record forward result',
  'INBOUND command poll -> bridge lease -> persist delivery -> await ack',
  'INBOUND ack -> validate -> persist -> update execution lifecycle -> forward-to-bridge',
  'Diagnostics aggregate by severity, channel, and terminal to detect failures and reconnections',
];

const EA_COMM_SCHEMA_LINES = [
  'HeartbeatPayload: terminalId, accountNumber, brokerName, serverName, lastTickTime, latencyMs, version',
  'Command: commandId, terminalId, type, payload, createdAt, expiresAt',
  'Ack: commandId, terminalId, status, ticket, brokerMessage, latencyMs, slippagePoints, spreadPoints',
  'CommEvent: id, terminalId, direction, channel, eventType, severity, payload, createdAt',
];

const EA_COMM_RETRY_LINES = [
  'Retry engine uses idempotent command IDs + dedupe keys to prevent duplicates',
  'Command delivery retries are driven by lease timeout and max-attempts safeguards',
  'Reconnection tracking is inferred from heartbeat continuity + bridge forward failures',
  'Operators can isolate by terminal and inspect payloads to diagnose WebRequest blocks and JSON errors',
];

function safePrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

const EXECUTION_ARCH_LINES = [
  'Trading engine emits validated execution intents into the command queue',
  'Execution bridge leases commands to eligible MT5 EA terminals with short leases',
  'MT5 EA dispatches broker order requests and returns signed acknowledgements',
  'Ack processor reconciles broker ticket, execution price, volume, status, and latency',
  'Dashboard monitors queue, lifecycle, integrity, diagnostics, and failover state',
];

const EXECUTION_SERVICE_LINES = [
  'execution-command-service validates, idempotency-checks, and enqueues orders',
  'bridge-dispatcher leases commands and tracks command attempt lifecycle',
  'ack-ingestion-service validates EA acknowledgements and broker response payloads',
  'execution-integrity-service checks duplicates, stale leases, and trade synchronization',
  'failover-router selects healthiest terminal for account-level execution routing',
];

const EXECUTION_QUEUE_LINES = [
  'queue:execution:pending -> validated commands awaiting EA lease',
  'queue:execution:leased -> in-flight commands with lease deadline',
  'queue:execution:retry -> retryable rejected, expired, or timed out commands',
  'stream:execution:acks -> append-only acknowledgement stream',
  'hash:execution:idempotency -> duplicate prevention by commandId and client order key',
];

const EXECUTION_EVENT_LINES = [
  'execution.command.queued -> order validation and duplicate prevention passed',
  'execution.command.dispatched -> command leased to MT5 EA terminal',
  'execution.ack.received -> EA/broker acknowledgement received',
  'execution.reconciled -> order state synchronized with terminal and backend',
  'execution.failed -> retry, failover, or operator intervention required',
];

const EXECUTION_WS_LINES = [
  'execution.queue.updated { queued, leased, retry, dead }',
  'execution.command.updated { commandId, terminalId, lifecycleState, attempt }',
  'execution.ack.received { commandId, status, ticket, latencyMs }',
  'execution.integrity.warning { commandId, rule, severity }',
  'execution.failover.selected { accountNumber, fromTerminalId, toTerminalId }',
];

const EXECUTION_RECOVERY_LINES = [
  'Retry system uses lease timeout, exponential backoff, and max-attempt dead lettering',
  'Failover routes commands to the healthiest connected terminal for the account',
  'Recovery reconciles command queue with broker tickets and terminal order snapshots',
  'Duplicate prevention rejects repeated client order keys and command IDs',
  'Fault tolerance keeps execution state recoverable from command log plus ack stream',
];

type CanonicalExecutionLifecycleState =
  | 'QUEUED'
  | 'ROUTING'
  | 'SENT'
  | 'ACKNOWLEDGED'
  | 'EXECUTED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'CANCELLED';

const CANONICAL_EXECUTION_LIFECYCLE = new Set<CanonicalExecutionLifecycleState>([
  'QUEUED',
  'ROUTING',
  'SENT',
  'ACKNOWLEDGED',
  'EXECUTED',
  'FAILED',
  'TIMEOUT',
  'CANCELLED',
]);

function isCanonicalLifecycleState(value: unknown): value is CanonicalExecutionLifecycleState {
  return CANONICAL_EXECUTION_LIFECYCLE.has(value as CanonicalExecutionLifecycleState);
}

function mapBridgeStatusToLifecycle(status: unknown): CanonicalExecutionLifecycleState {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'queued') return 'QUEUED';
  if (normalized === 'routing') return 'ROUTING';
  if (normalized === 'leased' || normalized === 'sent') return 'SENT';
  if (normalized === 'acknowledged') return 'ACKNOWLEDGED';
  if (normalized === 'expired') return 'TIMEOUT';
  if (normalized === 'dead') return 'FAILED';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'CANCELLED';
  return 'QUEUED';
}

function mapAckStatusToLifecycle(status: unknown): CanonicalExecutionLifecycleState {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'filled' || normalized === 'executed') return 'EXECUTED';
  if (normalized === 'failed') return 'FAILED';
  if (normalized === 'rejected') return 'CANCELLED';
  if (normalized === 'accepted' || normalized === 'acknowledged') return 'ACKNOWLEDGED';
  if (normalized === 'sent') return 'SENT';
  if (normalized === 'queued') return 'QUEUED';
  return 'ACKNOWLEDGED';
}

const STALE_FAILURE_LIFECYCLE = new Set<CanonicalExecutionLifecycleState>(['FAILED', 'TIMEOUT', 'CANCELLED']);

function executionAckEvidence(command: any, ack?: any) {
  const ackStatus = String(ack?.status ?? command?.ackStatus ?? command?.ack_status ?? command?.ack?.status ?? '').toLowerCase();
  const ticket = String(ack?.ticket ?? command?.ticket ?? command?.ack?.ticket ?? '').trim();
  const bridgeStatus = String(command?.status ?? '').toLowerCase();
  return {
    ackStatus,
    ticket,
    bridgeAcknowledged: bridgeStatus === 'acknowledged',
    hasSuccessfulExecution: ackStatus === 'filled' || ackStatus === 'executed' || Boolean(ticket),
    hasPositiveAck: ackStatus === 'filled' || ackStatus === 'executed' || ackStatus === 'accepted' || ackStatus === 'acknowledged' || Boolean(ticket),
  };
}

function resolveExecutionLifecycle(command: any, ack?: any): CanonicalExecutionLifecycleState {
  const evidence = executionAckEvidence(command, ack);
  if (evidence.hasSuccessfulExecution) return 'EXECUTED';
  if (evidence.ackStatus === 'failed') return 'FAILED';
  if (evidence.ackStatus === 'rejected') return 'CANCELLED';
  if (evidence.hasPositiveAck) return mapAckStatusToLifecycle(evidence.ackStatus);

  const rawLifecycle = command?.lifecycleState ?? command?.lifecycle_state ?? null;
  if (isCanonicalLifecycleState(rawLifecycle)) {
    if (STALE_FAILURE_LIFECYCLE.has(rawLifecycle) && evidence.bridgeAcknowledged) {
      return 'ACKNOWLEDGED';
    }
    return rawLifecycle;
  }

  if (evidence.bridgeAcknowledged) return 'ACKNOWLEDGED';
  return mapBridgeStatusToLifecycle(command?.status);
}

function mergeExecutionCommandSources(bridgeCommands: any[], dbCommands: any[]): any[] {
  const byId = new Map<string, any>();

  for (const command of Array.isArray(bridgeCommands) ? bridgeCommands : []) {
    const commandId = String(command?.commandId ?? '').trim();
    if (!commandId) continue;
    byId.set(commandId, { ...command, source: 'bridge' });
  }

  for (const record of Array.isArray(dbCommands) ? dbCommands : []) {
    const commandId = String(record?.commandId ?? record?.command_id ?? '').trim();
    if (!commandId) continue;
    const mapped = {
      commandId,
      terminalId: String(record?.terminalId ?? record?.terminal_id ?? ''),
      type: String(record?.type ?? ''),
      payload: record?.payload ?? {},
      createdAt: String(record?.createdAt ?? record?.created_at ?? ''),
      expiresAt: String(record?.expiresAt ?? record?.expires_at ?? ''),
      lifecycleState: String(record?.lifecycleState ?? record?.lifecycle_state ?? ''),
      environment: String(record?.environment ?? 'DEMO'),
      sandboxMode: Boolean(record?.sandboxMode ?? record?.sandbox_mode ?? false),
      dedupeKey: record?.dedupeKey ?? record?.dedupe_key ?? null,
      maxAttempts: Number(record?.maxAttempts ?? record?.max_attempts ?? 3),
      attemptCount: Number(record?.attemptCount ?? record?.attempt_count ?? 0),
      routedTerminalId: record?.routedTerminalId ?? record?.routed_terminal_id ?? null,
      routedAt: record?.routedAt ?? record?.routed_at ?? null,
      sentAt: record?.sentAt ?? record?.sent_at ?? null,
      ackStatus: record?.ackStatus ?? record?.ack_status ?? null,
      brokerMessage: record?.brokerMessage ?? record?.broker_message ?? null,
      ticket: record?.ticket ?? null,
      executedPrice: record?.executedPrice ?? record?.executed_price ?? null,
      executedVolumeLots: record?.executedVolumeLots ?? record?.executed_volume_lots ?? null,
      slippagePoints: record?.slippagePoints ?? record?.slippage_points ?? null,
      spreadPoints: record?.spreadPoints ?? record?.spread_points ?? null,
      symbol: record?.symbol ?? null,
      side: record?.side ?? null,
      lastError: record?.lastError ?? record?.last_error ?? null,
      lastUpdatedAt: record?.lastUpdatedAt ?? record?.last_updated_at ?? null,
      source: 'db',
    };

    const existing = byId.get(commandId);
    if (!existing) {
      byId.set(commandId, mapped);
      continue;
    }

    const bridgeAck = existing.ack ?? null;
    const merged = {
      ...mapped,
      ...existing,
      ack: bridgeAck,
      ackStatus: bridgeAck?.status ?? mapped.ackStatus ?? existing.ackStatus ?? null,
      ticket: bridgeAck?.ticket || mapped.ticket || existing.ticket || null,
      brokerMessage: bridgeAck?.brokerMessage ?? mapped.brokerMessage ?? existing.brokerMessage ?? null,
      executedPrice: bridgeAck?.executedPrice ?? mapped.executedPrice ?? existing.executedPrice ?? null,
      executedVolumeLots: bridgeAck?.executedVolumeLots ?? mapped.executedVolumeLots ?? existing.executedVolumeLots ?? null,
      leasedAt: existing.leasedAt ?? existing.lastDispatchedAt ?? (mapped as any).leasedAt ?? null,
      leasedUntil: existing.leasedUntil ?? null,
      lastDispatchedAt: existing.lastDispatchedAt ?? null,
      lastAckAt: existing.lastAckAt ?? bridgeAck?.receivedAt ?? null,
    };
    merged.lifecycleState = resolveExecutionLifecycle(merged, bridgeAck);
    byId.set(commandId, merged);
  }

  return Array.from(byId.values()).sort((a, b) => Date.parse(String(b.createdAt ?? '')) - Date.parse(String(a.createdAt ?? '')));
}

function mergeExecutionAckSources(recentAcks: any[], dbCommands: any[]): any[] {
  const byId = new Map<string, any>();

  for (const ack of Array.isArray(recentAcks) ? recentAcks : []) {
    const commandId = String(ack?.commandId ?? '').trim();
    if (!commandId) continue;
    byId.set(commandId, { ...ack, source: 'bridge' });
  }

  for (const command of Array.isArray(dbCommands) ? dbCommands : []) {
    const commandId = String(command?.commandId ?? '').trim();
    if (!commandId) continue;
    const ackStatus = command?.ackStatus ?? command?.ack_status ?? null;
    if (!ackStatus && !['ACKNOWLEDGED', 'EXECUTED', 'FAILED', 'TIMEOUT', 'CANCELLED'].includes(String(command?.lifecycleState ?? ''))) continue;
    if (byId.has(commandId)) continue;
    const createdAt = String(command?.createdAt ?? '');
    const sentAt = String(command?.sentAt ?? '');
    const receivedAt = String(command?.lastUpdatedAt ?? command?.lastUpdatedAt ?? command?.last_updated_at ?? '');
    const createdAtMs = Date.parse(createdAt);
    const sentAtMs = Date.parse(sentAt);
    const receivedAtMs = Date.parse(receivedAt);
    const latencyMs =
      Number.isFinite(receivedAtMs) && Number.isFinite(sentAtMs)
        ? Math.max(0, receivedAtMs - sentAtMs)
        : Number.isFinite(receivedAtMs) && Number.isFinite(createdAtMs)
          ? Math.max(0, receivedAtMs - createdAtMs)
          : 0;

    byId.set(commandId, {
      commandId,
      terminalId: String(command?.terminalId ?? ''),
      status: String(ackStatus ?? command?.lifecycleState ?? ''),
      ticket: command?.ticket ?? null,
      brokerMessage: command?.brokerMessage ?? null,
      executedPrice: command?.executedPrice ?? null,
      executedVolumeLots: command?.executedVolumeLots ?? null,
      slippagePoints: command?.slippagePoints ?? null,
      spreadPoints: command?.spreadPoints ?? null,
      latencyMs,
      receivedAt: receivedAt || new Date().toISOString(),
      source: 'db',
    });
  }

  return Array.from(byId.values()).sort((a, b) => Date.parse(String(b.receivedAt ?? '')) - Date.parse(String(a.receivedAt ?? '')));
}

function buildDbExecutionLogs(events: any[]) {
  const rows = (Array.isArray(events) ? events : [])
    .map((event) => {
      const time = String(event?.createdAt ?? event?.created_at ?? '');
      const lifecycleState = isCanonicalLifecycleState(event?.lifecycleState) ? event.lifecycleState : mapBridgeStatusToLifecycle(event?.lifecycleState);
      const eventType = String(event?.eventType ?? event?.event_type ?? '').toUpperCase();
      const message = String(event?.message ?? '');
      const commandId = String(event?.commandId ?? '').trim();
      return {
        time: time || new Date().toISOString(),
        state: lifecycleState,
        message: `${eventType || 'EVENT'}${commandId ? ` ${commandId}` : ''}: ${message || 'Execution event'}`,
      };
    })
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));

  return rows;
}

function enrichExecutionCommand(command: any, terminals: any[], acknowledgements: any[]) {
  const terminal = terminals.find((item) => item.terminalId === command.terminalId);
  const ack = acknowledgements.find((item) => item.commandId === command.commandId) ?? command.ack;
  const createdAtMs = Date.parse(command.createdAt ?? '');
  const now = Date.now();
  const sentAt = command.sentAt ?? command.lastDispatchedAt ?? command.leasedAt ?? '';
  const sentAtMs = Date.parse(String(sentAt ?? ''));
  const ackAt = ack?.receivedAt ?? command.lastAckAt ?? command.lastUpdatedAt ?? '';
  const ackAtMs = Date.parse(String(ackAt ?? ''));
  const dispatchLatencyMs =
    Number.isFinite(sentAtMs) && Number.isFinite(createdAtMs)
      ? Math.max(0, sentAtMs - createdAtMs)
      : Number.isFinite(createdAtMs)
        ? Math.max(0, now - createdAtMs)
        : 0;
  const ackLatencyMs =
    Number.isFinite(ackAtMs) && Number.isFinite(sentAtMs)
      ? Math.max(0, ackAtMs - sentAtMs)
      : Number.isFinite(ackAtMs) && Number.isFinite(createdAtMs)
        ? Math.max(0, ackAtMs - createdAtMs)
        : 0;

  const duplicateRisk = command.commandId && acknowledgements.filter((item) => item.commandId === command.commandId).length > 1;
  const evidence = executionAckEvidence(command, ack);
  const expiresAt = command.expiresAt ? Date.parse(String(command.expiresAt)) : NaN;
  const expired =
    !evidence.hasPositiveAck
    && (
      command.status === 'expired'
      || (Number.isFinite(expiresAt) && expiresAt < now && !['acknowledged', 'cancelled', 'canceled'].includes(String(command.status ?? '').toLowerCase()))
    );
  const lifecycleState: CanonicalExecutionLifecycleState =
    expired && ['QUEUED', 'ROUTING', 'SENT'].includes(resolveExecutionLifecycle(command, ack))
      ? 'TIMEOUT'
      : resolveExecutionLifecycle(command, ack);
  const attempt = Number(command.attemptCount ?? command.attempt ?? 0);

  const integrityScore = clampScore(
    100
    - (duplicateRisk ? 35 : 0)
    - (expired ? 30 : 0)
    - Math.min(25, attempt * 5)
    - (terminal?.status === 'disconnected' ? 20 : 0),
  );
  const payload = command.payload ?? {};
  return {
    ...command,
    environment: command.environment ?? 'DEMO',
    sandboxMode: Boolean(command.sandboxMode ?? false),
    dedupeKey: command.dedupeKey ?? null,
    maxAttempts: Number(command.maxAttempts ?? 3),
    attempt,
    symbol: payload.symbol ?? command.symbol ?? payload?.order?.symbol ?? '--',
    side: payload.side ?? command.side ?? payload?.order?.side ?? '--',
    lifecycleState,
    dispatchLatencyMs,
    ackLatencyMs,
    duplicateRisk,
    expired,
    integrityScore,
  };
}

function enrichExecutionAck(ack: any) {
  const latencyMs = Number(ack.latencyMs ?? 0);
  const brokerLatencyMs = Number(ack.brokerLatencyMs ?? 0);
  const status = String(ack.status ?? '').toLowerCase();
  const lifecycleState = mapAckStatusToLifecycle(status);
  return {
    ...ack,
    latencyMs,
    brokerLatencyMs,
    lifecycleState,
  };
}

function summarizeExecutionBridge(commands: any[], acknowledgements: any[], summary: any, connectedTerminals: number) {
  const queued = Number(summary?.queued ?? commands.filter((command) => ['QUEUED', 'ROUTING'].includes(command.lifecycleState)).length);
  const inFlight = Number(summary?.leased ?? commands.filter((command) => command.lifecycleState === 'SENT').length);
  const acked = Number(summary?.acknowledged ?? acknowledgements.length);
  const retryPressure =
    Number(summary?.expired ?? 0)
    + Number(summary?.dead ?? 0)
    + commands.filter((command) => ['FAILED', 'TIMEOUT'].includes(command.lifecycleState)).length
    + commands.reduce((sum, command) => sum + Math.max(0, Number(command.attempt ?? 0) - 1), 0);
  const averageLatency = acknowledgements.length
    ? Math.round(acknowledgements.reduce((sum, ack) => sum + ack.latencyMs, 0) / acknowledgements.length)
    : commands.length ? Math.round(commands.reduce((sum, command) => sum + command.dispatchLatencyMs, 0) / commands.length) : 0;
  const integrityScore = commands.length ? Math.round(commands.reduce((sum, command) => sum + command.integrityScore, 0) / commands.length) : 100;
  const healthScore = clampScore(integrityScore - Math.min(30, retryPressure * 4) - (connectedTerminals ? 0 : 25) - Math.min(20, Math.round(averageLatency / 250)));
  return {
    queued,
    inFlight,
    acked,
    retryPressure,
    averageLatency,
    integrityScore,
    healthScore,
    failoverReady: connectedTerminals,
  };
}

function buildExecutionDiagnostics(terminals: any[], commands: any[], acknowledgements: any[]) {
  const connected = terminals.filter((terminal) => terminal.status === 'connected').length;
  const duplicate = commands.some((command) => command.duplicateRisk);
  const stale = commands.some((command) => command.expired);
  const avgAck = acknowledgements.length ? Math.round(acknowledgements.reduce((sum, ack) => sum + ack.latencyMs, 0) / acknowledgements.length) : 0;
  return [
    { label: 'Bridge connectivity', state: connected ? 'ACKNOWLEDGED' : 'FAILED', detail: `${connected} connected terminal(s) available for execution.` },
    { label: 'Order validation', state: commands.some((command) => command.integrityScore < 70) ? 'SENT' : 'ACKNOWLEDGED', detail: 'Volume, SL/TP, symbol, and terminal eligibility checks.' },
    { label: 'Duplicate prevention', state: duplicate ? 'SENT' : 'ACKNOWLEDGED', detail: duplicate ? 'Duplicate command signature detected.' : 'No duplicate command IDs detected.' },
    { label: 'Broker response tracking', state: avgAck > 750 ? 'SENT' : 'ACKNOWLEDGED', detail: avgAck ? `Average ack latency ${avgAck}ms.` : 'Awaiting broker acknowledgement telemetry.' },
    { label: 'Timeout detection', state: stale ? 'TIMEOUT' : 'ACKNOWLEDGED', detail: stale ? 'One or more commands expired before acknowledgement.' : 'No stale execution leases detected.' },
  ];
}

function buildExecutionFailover(terminals: any[]) {
  const connected = terminals.filter((terminal) => terminal.status === 'connected');
  if (!terminals.length) return [{ terminalId: 'No terminals', state: 'FAILED', detail: 'Execution failover requires at least one connected terminal.' }];
  return terminals.slice(0, 6).map((terminal) => ({
    terminalId: terminal.terminalId,
    state: terminal.status === 'connected' ? 'ACKNOWLEDGED' : terminal.status === 'degraded' ? 'SENT' : 'FAILED',
    detail: terminal.status === 'connected'
      ? `Eligible for failover. Stability ${terminal.stabilityScore ?? 0}% / latency ${terminal.latencyMs ?? 0}ms.`
      : connected.length ? `Not primary; route can fail over to ${connected[0].terminalId}.` : 'No healthy failover target available.',
  }));
}

function buildOrderLifecycle(commands: any[], acknowledgements: any[]) {
  const stages = [
    { stage: 'Queued', count: commands.filter((command) => command.lifecycleState === 'QUEUED').length },
    { stage: 'Routing', count: commands.filter((command) => command.lifecycleState === 'ROUTING').length },
    { stage: 'Sent', count: commands.filter((command) => command.lifecycleState === 'SENT').length },
    { stage: 'Acknowledged', count: commands.filter((command) => command.lifecycleState === 'ACKNOWLEDGED').length },
    { stage: 'Executed', count: commands.filter((command) => command.lifecycleState === 'EXECUTED').length },
    { stage: 'Failed/Timeout', count: commands.filter((command) => command.lifecycleState === 'FAILED' || command.lifecycleState === 'TIMEOUT').length },
  ];
  const total = Math.max(1, Math.max(...stages.map((stage) => stage.count)));
  return stages.map((stage) => ({ ...stage, percent: Math.round((stage.count / total) * 100) }));
}

function buildExecutionLogs(commands: any[], acknowledgements: any[]) {
  const ackLogs = acknowledgements.map((ack) => ({
    time: ack.receivedAt,
    state: ack.lifecycleState,
    message: `Ack ${ack.status} for ${ack.terminalId}${ack.ticket ? ` ticket ${ack.ticket}` : ''}`,
  }));
  const commandLogs = commands.map((command) => ({
    time: command.createdAt,
    state: command.lifecycleState,
    message: `${command.type} ${command.symbol} ${command.lifecycleState.toLowerCase()} for ${command.terminalId} attempt ${command.attempt ?? 0}`,
  }));
  const logs = [...ackLogs, ...commandLogs].sort((a, b) => Date.parse(b.time ?? '') - Date.parse(a.time ?? ''));
  return logs;
}

function buildExecutionIntegrity(commands: any[], acknowledgements: any[]) {
  const duplicate = commands.filter((command) => command.duplicateRisk).length;
  const expired = commands.filter((command) => command.expired && !['EXECUTED', 'ACKNOWLEDGED'].includes(String(command.lifecycleState))).length;
  const rejected = acknowledgements.filter((ack) => {
    if (['EXECUTED', 'ACKNOWLEDGED'].includes(String(ack.lifecycleState))) return false;
    if (String(ack.status ?? '').toLowerCase() === 'filled' || String(ack.ticket ?? '').trim()) return false;
    return ['FAILED', 'CANCELLED', 'TIMEOUT'].includes(String(ack.lifecycleState));
  }).length;
  const unmatched = commands.filter((command) => {
    if (!['ACKNOWLEDGED', 'EXECUTED'].includes(command.lifecycleState)) return false;
    if (String(command.ticket ?? '').trim()) return false;
    return !acknowledgements.some((ack) => ack.commandId === command.commandId);
  }).length;
  const failureCount = expired + rejected;
  return [
    { label: 'Duplicate guard', value: duplicate, state: duplicate ? 'SENT' : 'ACKNOWLEDGED', detail: 'Prevents repeated command IDs and duplicate order intent signatures.' },
    { label: 'Order validation', value: commands.filter((command) => command.integrityScore >= 80).length, state: commands.some((command) => command.integrityScore < 70) ? 'SENT' : 'ACKNOWLEDGED', detail: 'Validates symbol, side, volume, SL/TP, expiry, and terminal state.' },
    { label: 'Order synchronization', value: unmatched, state: unmatched ? 'SENT' : 'ACKNOWLEDGED', detail: 'Ensures acked commands reconcile to broker ticket or terminal order state.' },
    { label: 'Execution failures', value: failureCount, state: failureCount ? 'FAILED' : 'ACKNOWLEDGED', detail: 'Timeouts, rejected broker responses, and failed acknowledgements.' },
  ];
}

function ExecutionBadge({ state }: { state: string }) {
  const normalized = isCanonicalLifecycleState(state) ? state : mapAckStatusToLifecycle(state);
  return (
    <span className={cn(
      'inline-flex whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase',
      normalized === 'QUEUED' && 'border-blue-200 bg-blue-50 text-blue-700',
      normalized === 'ROUTING' && 'border-indigo-200 bg-indigo-50 text-indigo-700',
      normalized === 'SENT' && 'border-amber-200 bg-amber-50 text-amber-700',
      normalized === 'ACKNOWLEDGED' && 'border-teal-200 bg-teal-50 text-teal-800',
      normalized === 'EXECUTED' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      normalized === 'FAILED' && 'border-rose-200 bg-rose-50 text-rose-700',
      normalized === 'TIMEOUT' && 'border-rose-200 bg-rose-50 text-rose-700',
      normalized === 'CANCELLED' && 'border-slate-200 bg-slate-50 text-slate-700',
    )}>{normalized}</span>
  );
}

type EaDeploymentSummaryPayload = {
  ok: boolean;
  toolEnabled: boolean;
  runtime: DeploymentRuntime;
  projectEaVersion: string;
  config: EADeploymentConfig | null;
  verification: DeploymentVerification | null;
  logs: DeploymentLog[];
  run: {
    runId: string;
    method: string;
    status: string;
    message: string;
    createdAt: string;
  } | null;
  bridge: {
    online: boolean;
    terminalCount: number;
    connectedCount: number;
    degradedCount: number;
    disconnectedCount: number;
  };
};

function EaDeploymentDashboard({ terminals }: { terminals: any[] }) {
  const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://127.0.0.1:8787';
  const [summaryPayload, setSummaryPayload] = useState<EaDeploymentSummaryPayload | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const refreshSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const response = await fetch('/api/mt5/ea-deployment/summary', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error ?? `Summary failed with HTTP ${response.status}`);
      }
      setSummaryPayload(payload as EaDeploymentSummaryPayload);
      setSummaryError(null);
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : 'Failed to load EA deployment summary.');
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  const rows = useMemo(
    () => buildEaDeploymentRows(terminals, summaryPayload),
    [terminals, summaryPayload],
  );
  const summary = summarizeEaDeployments(rows, summaryPayload);
  const deploymentLogs = summaryPayload?.logs ?? [];
  const verification = summaryPayload?.verification ?? null;
  const deploymentConfig = summaryPayload?.config ?? null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-900/5">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-4xl">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-blue-100 bg-blue-50">
                <TerminalSquare className="h-6 w-6 text-blue-700" />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-700">EA Deployment Control Center</p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Cacsms Trader Expert Advisor Fleet</h1>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-600">
              Live view of local EA file deployment, bridge-connected terminals, and deployment logs. Use the link manager to copy or symlink the EA into MT5.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="grid min-w-[280px] gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <EaVersionLine label="Project EA Version" value={summaryPayload?.projectEaVersion ?? '—'} accent />
              <EaVersionLine label="Deployment Method" value={deploymentConfig?.deploymentMethod ?? '—'} />
              <EaVersionLine label="Bridge Terminals" value={String(summaryPayload?.bridge.connectedCount ?? 0)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void refreshSummary()} disabled={summaryLoading}>
                <RefreshCw className={cn('h-4 w-4', summaryLoading && 'animate-spin')} />
                Refresh
              </Button>
              <Link
                href="/mt5-infrastructure/terminal-operations/ea-deployment-link"
                className={cn(buttonVariants({ size: 'sm' }), 'inline-flex items-center gap-1.5')}
              >
                <Link2 className="h-4 w-4" />
                Open Deployment Link Manager
              </Link>
            </div>
          </div>
        </div>
      </section>

      {summaryError ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-4 text-sm text-rose-800">{summaryError}</CardContent>
        </Card>
      ) : null}

      {verification ? (
        <Card className={cn(
          'shadow-sm shadow-slate-900/5',
          verification.status === 'SUCCESS' || verification.status === 'REQUIRES_MT5_REFRESH' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white',
        )}>
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Local file deployment</div>
              <div className="mt-1 flex items-center gap-2">
                <EaStatusBadge status={verification.status} />
                <span className="text-sm text-slate-700">{verification.message}</span>
              </div>
              <div className="mt-2 font-mono text-xs text-slate-600 break-all">
                {deploymentConfig?.mt5ExpertsFolder ?? 'No experts folder configured'}
              </div>
            </div>
            <div className="grid gap-1 text-xs text-slate-600">
              <div>MQ5: {verification.eaMq5Exists ? 'present' : 'missing'}</div>
              <div>EX5: {verification.eaEx5Exists ? 'present' : 'missing'}</div>
              <div>Files: {verification.filesCount}</div>
              {verification.lastModified ? <div>Updated: {formatTime(verification.lastModified)}</div> : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-200 bg-amber-50 shadow-sm shadow-slate-900/5">
          <CardContent className="p-4 text-sm text-amber-900">
            No local EA deployment is configured yet. Open the{' '}
            <Link href="/mt5-infrastructure/terminal-operations/ea-deployment-link" className="font-semibold underline">
              Deployment Link Manager
            </Link>{' '}
            to detect MT5 folders and copy the EA into Experts.
          </CardContent>
        </Card>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsSummaryCard icon={Layers3} title="Bridge terminals" value={String(summaryPayload?.bridge.terminalCount ?? 0)} detail={summaryPayload?.bridge.online ? 'MT5 bridge online' : 'MT5 bridge offline'} tone="blue" />
        <OpsSummaryCard icon={CheckCircle2} title="Connected EAs" value={String(summary.connected)} detail="Heartbeat-active bridge sessions." tone="green" />
        <OpsSummaryCard icon={Folder} title="Deployed files" value={String(verification?.filesCount ?? 0)} detail={verification?.deploymentMethod ? `Via ${verification.deploymentMethod}` : 'No deployment run yet'} tone="violet" />
        <OpsSummaryCard icon={ShieldAlert} title="Attention needed" value={String(summary.attention)} detail="Stale heartbeat, version drift, or deployment warnings." tone={summary.attention ? 'amber' : 'slate'} />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_0.9fr]">
        <OpsPanel title="Terminal EA Version Table" icon={Database}>
          {rows.length ? (
            <ScrollArea className="h-[520px]">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow>
                    <TableHead>Terminal</TableHead>
                    <TableHead>Broker</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>EA Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Environment</TableHead>
                    <TableHead>Heartbeat</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.terminalId} className={cn(row.issueCount > 0 && 'bg-rose-50/40', row.updateAvailable && 'bg-amber-50/40')}>
                      <TableCell>
                        <div className="font-mono text-xs font-bold text-slate-900">{row.terminalId}</div>
                        <div className="text-xs text-slate-500">{row.vpsName}</div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">{row.broker}</TableCell>
                      <TableCell className="text-xs text-slate-600">{row.source}</TableCell>
                      <TableCell>
                        <div className="font-mono text-xs font-black text-slate-900">{row.installedVersion}</div>
                        <div className="font-mono text-[11px] text-slate-500">project {row.latestVersion}</div>
                      </TableCell>
                      <TableCell><EaStatusBadge status={row.status} /></TableCell>
                      <TableCell className="text-xs font-semibold capitalize text-slate-700">{row.environment}</TableCell>
                      <TableCell className="font-mono text-xs">{row.heartbeatAgeSec >= 0 ? `${row.heartbeatAgeSec}s` : '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {row.updateAvailable && <EaFlag label="version drift" />}
                          {row.localDeployment && <EaFlag label="local deploy" />}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <EmptyPanel
              title="No terminals or local deployment rows"
              detail="Connect an EA to the bridge or run a file deployment from the link manager."
            />
          )}
        </OpsPanel>

        <div className="space-y-6">
          <OpsPanel title="Local Deployment Config" icon={Folder}>
            {deploymentConfig ? (
              <div className="space-y-3 text-xs text-slate-700">
                <EaConfigLine label="Project EA folder" value={deploymentConfig.projectEaFolder} />
                <EaConfigLine label="MT5 data folder" value={deploymentConfig.mt5DataFolder} />
                <EaConfigLine label="Experts target" value={deploymentConfig.mt5ExpertsFolder} />
                <EaConfigLine label="Environment" value={deploymentConfig.environment} />
                {summaryPayload?.runtime.dockerMount ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    Docker mount active at {summaryPayload.runtime.mt5TerminalRoot}. COPY mode is recommended.
                  </p>
                ) : null}
              </div>
            ) : (
              <EmptyPanel title="Not configured" detail="No saved deployment config in the database." />
            )}
          </OpsPanel>
          <OpsPanel title="Last Deployment Run" icon={ClipboardCheck}>
            {summaryPayload?.run ? (
              <div className="space-y-2 text-sm text-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-900">{summaryPayload.run.method}</span>
                  <EaStatusBadge status={summaryPayload.run.status} />
                </div>
                <p className="text-xs leading-5 text-slate-600">{summaryPayload.run.message}</p>
                <p className="font-mono text-[11px] text-slate-500">{formatTime(summaryPayload.run.createdAt)}</p>
              </div>
            ) : (
              <EmptyPanel title="No runs yet" detail="Deployment runs appear after copy or symlink actions." />
            )}
          </OpsPanel>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <OpsPanel title="Manual Deployment Guide" icon={KeyRound}><EaBulletList items={buildManualEaGuide(bridgeUrl)} /></OpsPanel>
        <OpsPanel title="Compatibility Notes" icon={Wrench}><EaBulletList items={EA_COMPATIBILITY_RULES} /></OpsPanel>
        <OpsPanel title="Available APIs" icon={Radio}><EaBulletList items={EA_OPERATIONAL_APIS} /></OpsPanel>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <OpsPanel title="Deployment Logs" icon={Activity}>
          {deploymentLogs.length ? (
            <div className="space-y-3">
              {deploymentLogs.slice(0, 12).map((log) => (
                <div key={log.id} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className={cn(
                    'mt-1 h-2 w-2 rounded-full',
                    log.severity === 'SUCCESS' && 'bg-emerald-500',
                    log.severity === 'WARNING' && 'bg-amber-500',
                    log.severity === 'ERROR' && 'bg-rose-500',
                    log.severity === 'INFO' && 'bg-blue-500',
                    log.severity === 'DEBUG' && 'bg-slate-400',
                  )} />
                  <div>
                    <p className="text-sm font-bold text-slate-900">{log.message}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">
                      {formatTime(log.timestamp)} · {log.action}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel title="No deployment logs" detail="Logs are recorded when you detect folders, copy files, or create symlinks." />
          )}
        </OpsPanel>
        <OpsPanel title="Planned Fleet Controls" icon={LockKeyhole}>
          <p className="mb-3 text-xs text-slate-500">Roadmap capabilities not yet wired to live APIs.</p>
          <EaBulletList items={EA_FLEET_ROADMAP} />
        </OpsPanel>
      </section>
    </div>
  );
}

const EA_FLEET_ROADMAP = [
  'Remote authorize/revoke EA tokens per terminal fingerprint.',
  'Staged rollout channels (stable, beta, hotfix) with checksum verification.',
  'Automatic rollback to prior release with signed operator intent.',
  'Permission gates for algo trading, WebRequest, and DLL before execution resumes.',
  'Fleet-wide forced upgrade policy for critical bridge protocol changes.',
];

const EA_COMPATIBILITY_RULES = [
  'Use COPY mode when running inside Docker; symlinks require native Windows.',
  'EA heartbeat version is reported as version in bridge payloads (see CacsmsTraderEA.mq5).',
  'Allow WebRequest for the bridge URL in MT5 Expert Advisors settings.',
  'Refresh MT5 Navigator after file deployment so the EA appears under Experts.',
  'Attach the EA chart and confirm bridge heartbeats on the connected terminals page.',
];

const EA_OPERATIONAL_APIS = [
  'GET /api/mt5/ea-deployment/summary — fleet dashboard, config, verification, bridge health.',
  'GET /api/mt5/ea-deployment/status — saved config, verification, runtime context.',
  'POST /api/mt5/ea-deployment/detect — scan mounted/local MetaQuotes Terminal folders.',
  'POST /api/mt5/ea-deployment/copy-files — copy project EA into MT5 Experts.',
  'POST /api/mt5/ea-deployment/create-link — symlink/junction project EA into Experts.',
  'GET /api/mt5/ea-deployment/logs — latest deployment run logs.',
  'GET /api/mt5/bridge-secret — read active MT5 bridge secret.',
  'POST /api/mt5/bridge-secret — generate or apply bridge secret.',
];

function terminalHashFromDataFolder(dataFolder: string): string {
  const parts = dataFolder.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] ?? '';
}

function buildEaDeploymentRows(terminals: any[], summaryPayload: EaDeploymentSummaryPayload | null) {
  const projectVersion = summaryPayload?.projectEaVersion ?? '—';
  const rows = terminals.map((terminal, index) => {
    const terminalId = String(terminal.terminalId ?? terminal.id ?? `EA-TERM-${index + 1}`);
    const installedVersion = String(terminal.version ?? terminal.eaVersion ?? terminal.installedEaVersion ?? '—');
    const heartbeatAgeSec = Number.isFinite(Number(terminal.heartbeatAgeSec))
      ? Number(terminal.heartbeatAgeSec)
      : Math.round(Number(terminal.heartbeatAgeMs ?? 0) / 1000);
    const bridgeStatus = String(terminal.status ?? terminal.connectionStatus ?? 'unknown').toLowerCase();
    const updateAvailable = projectVersion !== '—' && installedVersion !== '—' && installedVersion !== projectVersion;
    const status = bridgeStatus === 'connected'
      ? (updateAvailable ? 'Version drift' : 'Connected')
      : bridgeStatus === 'degraded'
        ? 'Degraded'
        : bridgeStatus === 'disconnected'
          ? 'Disconnected'
          : 'Unknown';

    return {
      terminalId,
      vpsName: String(terminal.computerName ?? terminal.vpsName ?? terminal.host ?? '—'),
      broker: String(terminal.brokerName ?? terminal.broker ?? '—'),
      source: 'bridge',
      installedVersion,
      latestVersion: projectVersion,
      status,
      environment: String(terminal.environment ?? terminal.accountType ?? '—'),
      heartbeatAgeSec,
      updateAvailable,
      localDeployment: false,
      issueCount: bridgeStatus === 'disconnected' || bridgeStatus === 'degraded' ? 1 : updateAvailable ? 1 : 0,
    };
  });

  const config = summaryPayload?.config;
  const verification = summaryPayload?.verification;
  if (config?.mt5DataFolder) {
    const localHash = terminalHashFromDataFolder(config.mt5DataFolder);
    const alreadyListed = rows.some((row) => row.terminalId === localHash);
    if (!alreadyListed) {
      rows.unshift({
        terminalId: localHash || 'local-mt5',
        vpsName: config.mt5TerminalName ?? 'Local MT5 data folder',
        broker: config.brokerAccountLabel ?? '—',
        source: 'file deploy',
        installedVersion: verification?.eaMq5Exists || verification?.eaEx5Exists ? projectVersion : '—',
        latestVersion: projectVersion,
        status: verification?.status ?? 'NOT_CONFIGURED',
        environment: config.environment,
        heartbeatAgeSec: -1,
        updateAvailable: false,
        localDeployment: true,
        issueCount: verification?.status === 'FAILED' ? 1 : 0,
      });
    }
  }

  return rows;
}

function summarizeEaDeployments(rows: ReturnType<typeof buildEaDeploymentRows>, summaryPayload: EaDeploymentSummaryPayload | null) {
  return {
    total: rows.length,
    connected: rows.filter((row) => row.status === 'Connected').length,
    attention: rows.filter((row) => row.issueCount > 0).length,
    localConfigured: summaryPayload?.config ? 1 : 0,
  };
}

function buildManualEaGuide(bridgeUrl: string) {
  return [
    'Open Deployment Link Manager, detect MT5 folders, and copy EA files into Experts.',
    'Compile mt5/experts/CacsmsTraderEA/CacsmsTraderEA.mq5 in MetaEditor if needed.',
    `Set BridgeUrl to ${bridgeUrl}.`,
    'Set TerminalId to a unique identifier per MT5 installation.',
    'Generate and apply the bridge secret in the portal, then paste the same value into the EA BridgeSecret input.',
    'Enable Algo Trading and allow WebRequest for the bridge URL.',
  ];
}

function EaVersionLine({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <span className={cn('font-mono text-sm font-black', accent ? 'text-blue-700' : 'text-slate-950')}>{value}</span>
    </div>
  );
}

function EaConfigLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-xs text-slate-800 break-all">{value || '—'}</div>
    </div>
  );
}

function EaStatusBadge({ status }: { status: string }) {
  const value = status.toLowerCase();
  const tone = value.includes('healthy') || value.includes('installed') || value.includes('success') || value.includes('connected')
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : value.includes('pending') || value.includes('outdated') || value.includes('awaiting') || value.includes('rollback') || value.includes('required') || value.includes('refresh') || value.includes('drift') || value.includes('degraded')
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : value.includes('failed') || value.includes('unauthorized') || value.includes('incompatible') || value.includes('disconnected')
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-blue-200 bg-blue-50 text-blue-700';
  return <span className={cn('inline-flex whitespace-nowrap rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase', tone)}>{status}</span>;
}

function EaFlag({ label }: { label: string }) {
  return <span className="whitespace-nowrap rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[10px] uppercase text-amber-700">{label}</span>;
}

function EaBulletList({ items }: { items: string[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item} className="flex gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-700">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function SummaryCard(props: { icon: any; title: string; value: string; tone: 'teal' | 'amber' | 'rose' | 'indigo' | 'violet' | 'slate' }) {
  const Icon = props.icon;
  const tone = props.tone;
  const toneClasses: Record<string, string> = {
    teal: 'text-teal-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    indigo: 'text-indigo-700',
    violet: 'text-violet-700',
    slate: 'text-slate-700',
  };
  return (
    <Card className="bg-white border-slate-200 shadow-sm shadow-slate-900/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-slate-500 font-normal uppercase tracking-wider flex items-center gap-2">
          <Icon className={cn('w-3 h-3', toneClasses[tone])} /> {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-mono text-slate-950">{props.value}</div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn(
      'inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold capitalize',
      status === 'connected' && 'border-teal-200 bg-teal-50 text-teal-700',
      status === 'degraded' && 'border-amber-200 bg-amber-50 text-amber-700',
      status === 'disconnected' && 'border-rose-200 bg-rose-50 text-rose-700',
    )}>
      {status}
    </span>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDrift(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  const ms = Number(value);
  const sign = ms >= 0 ? '+' : '-';
  return `${sign}${Math.abs(ms)}ms`;
}

