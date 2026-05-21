import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DeploymentMethod = 'SYMLINK' | 'COPY';

export type DeploymentStatus =
  | 'NOT_CONFIGURED'
  | 'READY'
  | 'VALIDATING'
  | 'DEPLOYING'
  | 'SUCCESS'
  | 'FAILED'
  | 'PARTIAL'
  | 'REQUIRES_ADMIN'
  | 'REQUIRES_MT5_REFRESH';

export interface MT5DataFolder {
  id: string;
  path: string;
  terminalHash: string;
  hasMql5: boolean;
  hasExperts: boolean;
  detectedAt: string;
  brokerHint?: string;
  accountHint?: string;
}

export interface EADeploymentConfig {
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

export interface DeploymentVerification {
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

export interface DeploymentLog {
  id: string;
  timestamp: string;
  severity: 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  action: string;
  message: string;
  path?: string;
}

export type ConfirmationAction = 'relink' | 'overwrite';

export interface ExecutionResult {
  ok: boolean;
  message: string;
  verification: DeploymentVerification;
  logs: DeploymentLog[];
  requiresConfirmation?: boolean;
  confirmAction?: ConfirmationAction;
  error?: string;
}

export interface DetectResult {
  ok: boolean;
  folders: MT5DataFolder[];
  logs: DeploymentLog[];
  error?: string;
}

export interface StatusResult {
  ok: boolean;
  verification: DeploymentVerification | null;
  logs: DeploymentLog[];
  config: EADeploymentConfig | null;
}

export interface EnginePolicy {
  enabled: boolean;
  requireLocalhost: boolean;
  allowedRoots: string[];
}

export const DEFAULT_TARGET_FOLDER_NAME = 'CacsmsTrader';

export function enginePolicyFromEnv(): EnginePolicy {
  const enabled = process.env.CACSMS_ENABLE_EA_DEPLOYMENT_TOOL === 'true' || process.env.NODE_ENV !== 'production';
  const requireLocalhost = process.env.CACSMS_EA_DEPLOYMENT_ALLOW_REMOTE !== 'true';
  const allowedRoots = normalizeAllowedRoots([
    process.cwd(),
    path.join(os.homedir(), 'AppData', 'Roaming', 'MetaQuotes', 'Terminal'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'MetaQuotes'),
  ]);
  return { enabled, requireLocalhost, allowedRoots };
}

export function isLocalRequest(headers: Headers): boolean {
  const forwardedFor = headers.get('x-forwarded-for');
  const realIp = headers.get('x-real-ip');
  const host = headers.get('host') ?? '';
  const candidate = (realIp || forwardedFor || '').split(',')[0]?.trim();
  const looksLocal = candidate === '127.0.0.1' || candidate === '::1' || candidate === '' || host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return looksLocal;
}

export function assertPolicy(policy: EnginePolicy, requestHeaders: Headers): void {
  if (!policy.enabled) {
    throw new Error('EA deployment tool is disabled.');
  }
  if (policy.requireLocalhost && !isLocalRequest(requestHeaders)) {
    throw new Error('Remote execution is disabled. Run this tool on the local machine.');
  }
}

export async function detectMt5DataFolders(policy: EnginePolicy): Promise<DetectResult> {
  const logs: DeploymentLog[] = [];
  const root = path.join(os.homedir(), 'AppData', 'Roaming', 'MetaQuotes', 'Terminal');
  logs.push(log('INFO', 'detect_mt5_folders', 'Scanning MT5 terminal root.', root));

  const safeRoot = enforceSafePath(root, policy);
  const entries = await safeReadDir(safeRoot);
  const folders: MT5DataFolder[] = [];
  const now = new Date().toISOString();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const terminalHash = entry.name;
    const folderPath = path.join(safeRoot, terminalHash);
    const hasMql5 = await exists(path.join(folderPath, 'MQL5'));
    const hasExperts = await exists(path.join(folderPath, 'MQL5', 'Experts'));
    const hasConfig = await exists(path.join(folderPath, 'config'));
    if (!(hasMql5 && hasExperts && hasConfig)) {
      continue;
    }
    const id = crypto.createHash('sha1').update(folderPath).digest('hex').slice(0, 16);
    folders.push({
      id,
      path: folderPath,
      terminalHash,
      hasMql5,
      hasExperts,
      detectedAt: now,
    });
  }

  logs.push(log('SUCCESS', 'detect_mt5_folders', `Detected ${folders.length} MT5 terminal folder(s).`, safeRoot));
  return { ok: true, folders, logs };
}

export async function createEaSymlink(policy: EnginePolicy, config: EADeploymentConfig, force: boolean): Promise<ExecutionResult> {
  const logs: DeploymentLog[] = [];
  const normalized = normalizeConfig(config);
  logs.push(log('INFO', 'validate_config', 'Validating EA deployment config.'));
  validateConfig(normalized, policy);

  const projectFolder = enforceSafePath(normalized.projectEaFolder, policy);
  const targetPath = enforceSafePath(normalized.mt5ExpertsFolder, policy);

  logs.push(await verifyFolderExists('project_ea_folder', projectFolder));
  logs.push(await verifyParentExists('mt5_experts_parent', targetPath));

  const verificationBefore = await verifyDeployment(normalized, policy, 'SYMLINK');
  if (verificationBefore.linkExists && !verificationBefore.isSymlink) {
    const message = 'Target folder exists and is not a symlink. Use copy mode or remove it manually.';
    logs.push(log('WARNING', 'symlink_conflict', message, targetPath));
    return {
      ok: false,
      message,
      verification: verificationBefore,
      logs: logs.reverse(),
      requiresConfirmation: false,
      error: message,
    };
  }

  if (verificationBefore.isSymlink && verificationBefore.linkExists) {
    const linkTarget = await readSymlinkTarget(targetPath);
    const desired = projectFolder;
    if (linkTarget && normalizePath(linkTarget) !== normalizePath(desired) && !force) {
      const message = `Symlink points to a different folder. Confirm relink to: ${desired}`;
      logs.push(log('WARNING', 'symlink_relink_required', message, targetPath));
      return {
        ok: false,
        message,
        verification: verificationBefore,
        logs: logs.reverse(),
        requiresConfirmation: true,
        confirmAction: 'relink',
        error: message,
      };
    }
  }

  if (!verificationBefore.linkExists) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
  }

  if (verificationBefore.isSymlink && force) {
    await fs.unlink(targetPath);
    logs.push(log('WARNING', 'symlink_removed', 'Removed existing symlink before relink.', targetPath));
  }

  logs.push(log('INFO', 'symlink_create', 'Creating directory symlink.', `${targetPath} -> ${projectFolder}`));
  const symlinkResult = await trySymlink(targetPath, projectFolder, logs);
  if (!symlinkResult.ok) {
    const verification = await verifyDeployment(normalized, policy, 'SYMLINK');
    return {
      ok: false,
      message: symlinkResult.message,
      verification,
      logs: logs.reverse(),
      error: symlinkResult.message,
    };
  }

  const verificationAfter = await verifyDeployment(normalized, policy, 'SYMLINK');
  const ok = verificationAfter.status === 'SUCCESS' || verificationAfter.status === 'REQUIRES_MT5_REFRESH';
  return {
    ok,
    message: verificationAfter.message,
    verification: verificationAfter,
    logs: logs.reverse(),
  };
}

export async function copyEaFiles(policy: EnginePolicy, config: EADeploymentConfig, force: boolean): Promise<ExecutionResult> {
  const logs: DeploymentLog[] = [];
  const normalized = normalizeConfig(config);
  validateConfig(normalized, policy);

  const projectFolder = enforceSafePath(normalized.projectEaFolder, policy);
  const targetPath = enforceSafePath(normalized.mt5ExpertsFolder, policy);

  logs.push(log('INFO', 'copy_validate', 'Validating source and destination paths.'));
  logs.push(await verifyFolderExists('project_ea_folder', projectFolder));
  await fs.mkdir(targetPath, { recursive: true });

  const destStat = await safeLstat(targetPath);
  if (destStat?.isSymbolicLink()) {
    const message = 'Destination is a symlink. Use symlink mode or remove the link before copying.';
    logs.push(log('WARNING', 'copy_blocked', message, targetPath));
    const verification = await verifyDeployment(normalized, policy, 'COPY');
    return { ok: false, message, verification, logs: logs.reverse(), error: message };
  }

  const existingFiles = await listFilesRecursive(targetPath, 2);
  if (existingFiles.length > 0 && !force) {
    const message = 'Destination folder already contains files. Confirm overwrite to proceed.';
    logs.push(log('WARNING', 'copy_confirmation_required', message, targetPath));
    const verification = await verifyDeployment(normalized, policy, 'COPY');
    return { ok: false, message, verification, logs: logs.reverse(), requiresConfirmation: true, confirmAction: 'overwrite', error: message };
  }

  const copied = await copyFiltered(projectFolder, targetPath, logs);
  logs.push(log('SUCCESS', 'copy_complete', `Copied ${copied} file(s).`, targetPath));

  const verificationAfter = await verifyDeployment(normalized, policy, 'COPY');
  const ok = verificationAfter.status === 'SUCCESS' || verificationAfter.status === 'REQUIRES_MT5_REFRESH' || verificationAfter.status === 'PARTIAL';
  return { ok, message: verificationAfter.message, verification: verificationAfter, logs: logs.reverse() };
}

export async function verifyDeployment(config: EADeploymentConfig, policy: EnginePolicy, method?: DeploymentMethod): Promise<DeploymentVerification> {
  const normalized = normalizeConfig(config);
  const projectFolder = normalizePath(enforceSafePath(normalized.projectEaFolder, policy));
  const targetPath = normalizePath(enforceSafePath(normalized.mt5ExpertsFolder, policy));

  const linkLstat = await safeLstat(targetPath);
  const linkExists = Boolean(linkLstat);
  const isSymlink = Boolean(linkLstat?.isSymbolicLink());
  const linkTarget = isSymlink ? await readSymlinkTarget(targetPath) : null;
  const targetExists = linkExists;

  const { filesCount, eaEx5Exists, eaMq5Exists, lastModified } = await inspectEaFiles(isSymlink ? (linkTarget ? normalizePath(linkTarget) : targetPath) : targetPath);

  const missing = !linkExists || !targetExists;
  if (missing) {
    return {
      linkExists,
      isSymlink,
      targetExists,
      eaEx5Exists,
      eaMq5Exists,
      filesCount,
      lastModified,
      status: 'NOT_CONFIGURED',
      message: 'Deployment target is not configured yet.',
      deploymentMethod: method,
    };
  }

  if (isSymlink && linkTarget && normalizePath(linkTarget) !== projectFolder) {
    return {
      linkExists,
      isSymlink,
      targetExists,
      eaEx5Exists,
      eaMq5Exists,
      filesCount,
      lastModified,
      status: 'FAILED',
      message: 'Symlink exists but points to a different source folder.',
      deploymentMethod: 'SYMLINK',
    };
  }

  if (!eaEx5Exists && !eaMq5Exists) {
    return {
      linkExists,
      isSymlink,
      targetExists,
      eaEx5Exists,
      eaMq5Exists,
      filesCount,
      lastModified,
      status: 'PARTIAL',
      message: 'Deployment target exists but EA binaries/source were not found (.ex5/.mq5).',
      deploymentMethod: method,
    };
  }

  return {
    linkExists,
    isSymlink,
    targetExists,
    eaEx5Exists,
    eaMq5Exists,
    filesCount,
    lastModified,
    status: 'REQUIRES_MT5_REFRESH',
    message: 'Deployment completed. Refresh MT5 Navigator or restart MT5 to see the EA.',
    deploymentMethod: method,
  };
}

function normalizeConfig(config: EADeploymentConfig): EADeploymentConfig {
  const mt5ExpertsFolder = config.mt5ExpertsFolder || path.join(config.mt5DataFolder || '', 'MQL5', 'Experts', config.targetFolderName || DEFAULT_TARGET_FOLDER_NAME);
  return {
    ...config,
    projectEaFolder: normalizePath(config.projectEaFolder),
    mt5DataFolder: normalizePath(config.mt5DataFolder),
    mt5ExpertsFolder: normalizePath(mt5ExpertsFolder),
    targetFolderName: config.targetFolderName || DEFAULT_TARGET_FOLDER_NAME,
  };
}

function validateConfig(config: EADeploymentConfig, policy: EnginePolicy): void {
  if (!config.projectEaFolder) throw new Error('projectEaFolder is required.');
  if (!config.mt5ExpertsFolder) throw new Error('mt5ExpertsFolder is required.');
  enforceSafePath(config.projectEaFolder, policy);
  enforceSafePath(config.mt5ExpertsFolder, policy);
}

function enforceSafePath(input: string, policy: EnginePolicy): string {
  if (!input) throw new Error('Path is required.');
  if (input.includes('\0')) throw new Error('Invalid path.');
  const resolved = path.resolve(input);
  const normalized = normalizePath(resolved);
  const allowed = policy.allowedRoots.some((root) => normalized.startsWith(root));
  if (!allowed) {
    throw new Error(`Path is outside allowed roots: ${normalized}`);
  }
  return normalized;
}

function normalizeAllowedRoots(roots: string[]): string[] {
  return Array.from(new Set(roots.map((root) => normalizePath(path.resolve(root)))))
    .map((root) => (root.endsWith(path.sep) ? root : `${root}${path.sep}`));
}

function normalizePath(value: string): string {
  const replaced = value.replace(/\//g, path.sep);
  return replaced.endsWith(path.sep) ? replaced : replaced;
}

async function safeReadDir(folder: string) {
  try {
    return await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function exists(folder: string): Promise<boolean> {
  try {
    await fs.access(folder);
    return true;
  } catch {
    return false;
  }
}

function log(severity: DeploymentLog['severity'], action: string, message: string, targetPath?: string): DeploymentLog {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    severity,
    action,
    message,
    path: targetPath,
  };
}

async function safeLstat(targetPath: string) {
  try {
    return await fs.lstat(targetPath);
  } catch {
    return null;
  }
}

async function verifyFolderExists(action: string, targetPath: string): Promise<DeploymentLog> {
  const stat = await safeLstat(targetPath);
  if (!stat || !stat.isDirectory()) {
    return log('ERROR', action, 'Folder does not exist or is not a directory.', targetPath);
  }
  return log('SUCCESS', action, 'Folder exists.', targetPath);
}

async function verifyParentExists(action: string, targetPath: string): Promise<DeploymentLog> {
  const parent = path.dirname(targetPath);
  const stat = await safeLstat(parent);
  if (!stat || !stat.isDirectory()) {
    return log('ERROR', action, 'Target parent folder does not exist.', parent);
  }
  return log('SUCCESS', action, 'Target parent exists.', parent);
}

async function readSymlinkTarget(targetPath: string): Promise<string | null> {
  try {
    const raw = await fs.readlink(targetPath);
    if (!raw) return null;
    const resolved = path.isAbsolute(raw) ? raw : path.resolve(path.dirname(targetPath), raw);
    return normalizePath(resolved);
  } catch {
    return null;
  }
}

async function trySymlink(targetPath: string, sourcePath: string, logs: DeploymentLog[]) {
  try {
    await fs.symlink(sourcePath, targetPath, 'junction');
    logs.push(log('SUCCESS', 'symlink_created', 'Symlink created with fs.symlink (junction).', targetPath));
    return { ok: true, message: 'Symlink created.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Symlink creation failed.';
    logs.push(log('WARNING', 'symlink_failed', `fs.symlink failed: ${message}`, targetPath));
    const mklink = await tryMklink(targetPath, sourcePath, logs);
    return mklink;
  }
}

async function tryMklink(targetPath: string, sourcePath: string, logs: DeploymentLog[]) {
  try {
    const parent = path.dirname(targetPath);
    await fs.mkdir(parent, { recursive: true });
    const command = 'cmd.exe';
    const args = ['/d', '/s', '/c', 'mklink', '/D', targetPath, sourcePath];
    await execFileAsync(command, args, { windowsHide: true });
    logs.push(log('SUCCESS', 'mklink_created', 'Symlink created with mklink /D.', targetPath));
    return { ok: true, message: 'Symlink created.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'mklink failed.';
    const requiresAdmin = /privilege|administrator|elevat/i.test(message);
    logs.push(log(requiresAdmin ? 'WARNING' : 'ERROR', 'mklink_failed', message, targetPath));
    return { ok: false, message: requiresAdmin ? 'Administrator permission required to create symlink.' : message };
  }
}

async function inspectEaFiles(folder: string): Promise<{ filesCount: number; eaEx5Exists: boolean; eaMq5Exists: boolean; lastModified?: string }> {
  const stat = await safeLstat(folder);
  if (!stat || !stat.isDirectory()) {
    return { filesCount: 0, eaEx5Exists: false, eaMq5Exists: false };
  }

  const files = await listFilesRecursive(folder, 3);
  const eaEx5 = files.find((file) => file.toLowerCase().endsWith('.ex5'));
  const eaMq5 = files.find((file) => file.toLowerCase().endsWith('.mq5'));
  const lastModified = files.length ? (await mostRecentMtime(folder, files)).toISOString() : undefined;

  return {
    filesCount: files.length,
    eaEx5Exists: Boolean(eaEx5),
    eaMq5Exists: Boolean(eaMq5),
    lastModified,
  };
}

async function listFilesRecursive(root: string, maxDepth: number): Promise<string[]> {
  const items: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const next = stack.pop();
    if (!next) break;
    const { dir, depth } = next;
    let entries: any[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (entry.isFile()) {
        items.push(full);
      }
    }
  }
  return items;
}

async function mostRecentMtime(root: string, files: string[]): Promise<Date> {
  let latest = new Date(0);
  for (const filePath of files.slice(0, 400)) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtime > latest) latest = stat.mtime;
    } catch {
      continue;
    }
  }
  return latest;
}

async function copyFiltered(source: string, destination: string, logs: DeploymentLog[]): Promise<number> {
  const allowedExtensions = new Set(['.ex5', '.mq5', '.set', '.json', '.txt', '.csv', '.png', '.jpg', '.jpeg']);
  const files = await listFilesRecursive(source, 4);
  const selected = files.filter((filePath) => allowedExtensions.has(path.extname(filePath).toLowerCase()));
  let copied = 0;

  for (const filePath of selected) {
    const relative = path.relative(source, filePath);
    const target = path.join(destination, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      const stat = await fs.stat(filePath);
      if (stat.size <= 0) continue;
    } catch {
      continue;
    }
    await fs.copyFile(filePath, target);
    copied += 1;
  }

  logs.push(log('INFO', 'copy_filtered', `Selected ${selected.length} candidate file(s).`, destination));
  return copied;
}

