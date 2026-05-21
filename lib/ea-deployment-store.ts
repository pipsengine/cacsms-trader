import { queryPostgres } from '@/lib/postgres';
import type { DeploymentLog, DeploymentVerification, EADeploymentConfig, DeploymentMethod } from '@/services/ea-deployment/ea-deployment-engine';

type DbConfigRow = {
  id: number;
  terminal_hash: string;
  project_ea_folder: string;
  mt5_data_folder: string;
  mt5_experts_folder: string;
  target_folder_name: string;
  deployment_method: string;
  environment: string;
  ea_source_folder: string | null;
  ea_compiled_folder: string | null;
  mt5_terminal_name: string | null;
  broker_account_label: string | null;
  updated_at: string;
};

type DbRunRow = {
  run_id: string;
  config_id: number;
  deployment_method: string;
  status: string;
  message: string;
  verification: Record<string, unknown>;
  created_at: string;
};

type DbLogRow = {
  id: number;
  run_id: string;
  timestamp: string;
  severity: string;
  action: string;
  message: string;
  path: string | null;
};

export async function upsertEaDeploymentConfig(config: EADeploymentConfig): Promise<DbConfigRow> {
  const terminalHash = terminalHashFromMt5DataFolder(config.mt5DataFolder);
  const result = await queryPostgres(
    `
      INSERT INTO ea_deployment_configs (
        terminal_hash,
        project_ea_folder,
        mt5_data_folder,
        mt5_experts_folder,
        target_folder_name,
        deployment_method,
        environment,
        ea_source_folder,
        ea_compiled_folder,
        mt5_terminal_name,
        broker_account_label,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
      ON CONFLICT (terminal_hash, target_folder_name) DO UPDATE SET
        project_ea_folder = EXCLUDED.project_ea_folder,
        mt5_data_folder = EXCLUDED.mt5_data_folder,
        mt5_experts_folder = EXCLUDED.mt5_experts_folder,
        deployment_method = EXCLUDED.deployment_method,
        environment = EXCLUDED.environment,
        ea_source_folder = EXCLUDED.ea_source_folder,
        ea_compiled_folder = EXCLUDED.ea_compiled_folder,
        mt5_terminal_name = EXCLUDED.mt5_terminal_name,
        broker_account_label = EXCLUDED.broker_account_label,
        updated_at = now()
      RETURNING *
    `,
    [
      terminalHash,
      config.projectEaFolder,
      config.mt5DataFolder,
      config.mt5ExpertsFolder,
      config.targetFolderName,
      config.deploymentMethod,
      config.environment,
      config.eaSourceFolder ?? null,
      config.eaCompiledFolder ?? null,
      config.mt5TerminalName ?? null,
      config.brokerAccountLabel ?? null,
    ],
  );
  return result.rows[0] as unknown as DbConfigRow;
}

export async function createEaDeploymentRun(input: {
  runId: string;
  configId: number;
  method: DeploymentMethod;
  status: string;
  message: string;
  verification: DeploymentVerification;
}): Promise<DbRunRow> {
  const result = await queryPostgres(
    `
      INSERT INTO ea_deployment_runs (
        run_id,
        config_id,
        deployment_method,
        status,
        message,
        verification,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,now())
      RETURNING *
    `,
    [
      input.runId,
      input.configId,
      input.method,
      input.status,
      input.message,
      JSON.stringify(input.verification ?? {}),
    ],
  );
  return result.rows[0] as unknown as DbRunRow;
}

export async function appendEaDeploymentLogs(runId: string, logs: DeploymentLog[]): Promise<void> {
  if (!logs.length) return;
  const values: unknown[] = [];
  const rowsSql: string[] = [];
  logs.forEach((log, index) => {
    const base = index * 6;
    rowsSql.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    values.push(
      runId,
      new Date(log.timestamp).toISOString(),
      log.severity,
      log.action,
      log.message,
      log.path ?? null,
    );
  });
  await queryPostgres(
    `
      INSERT INTO ea_deployment_logs (run_id, timestamp, severity, action, message, path)
      VALUES ${rowsSql.join(',')}
    `,
    values as any,
  );
}

export async function getLatestEaDeploymentSnapshot(): Promise<{
  config: EADeploymentConfig | null;
  run: DbRunRow | null;
  logs: DeploymentLog[];
  verification: DeploymentVerification | null;
}> {
  const configResult = await queryPostgres(
    `
      SELECT *
      FROM ea_deployment_configs
      ORDER BY updated_at DESC
      LIMIT 1
    `,
  );
  const configRow = (configResult.rows[0] as unknown as DbConfigRow) ?? null;
  if (!configRow) {
    return { config: null, run: null, logs: [], verification: null };
  }

  const runResult = await queryPostgres(
    `
      SELECT *
      FROM ea_deployment_runs
      WHERE config_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [configRow.id],
  );
  const runRow = (runResult.rows[0] as unknown as DbRunRow) ?? null;
  if (!runRow) {
    return { config: mapConfig(configRow), run: null, logs: [], verification: null };
  }

  const logResult = await queryPostgres(
    `
      SELECT *
      FROM ea_deployment_logs
      WHERE run_id = $1
      ORDER BY timestamp DESC, id DESC
      LIMIT 250
    `,
    [runRow.run_id],
  );

  const logs = (logResult.rows as unknown as DbLogRow[]).map(mapLog);
  const verification = runRow.verification as unknown as DeploymentVerification;
  return { config: mapConfig(configRow), run: runRow, logs, verification };
}

function terminalHashFromMt5DataFolder(mt5DataFolder: string): string {
  const parts = mt5DataFolder.replace(/[/\\]+$/, '').split(/[/\\]/g);
  const last = parts[parts.length - 1] ?? '';
  if (!last) {
    return '';
  }
  return last;
}

function mapConfig(row: DbConfigRow): EADeploymentConfig {
  return {
    projectEaFolder: row.project_ea_folder,
    mt5DataFolder: row.mt5_data_folder,
    mt5ExpertsFolder: row.mt5_experts_folder,
    targetFolderName: row.target_folder_name,
    deploymentMethod: row.deployment_method as DeploymentMethod,
    environment: row.environment as EADeploymentConfig['environment'],
    eaSourceFolder: row.ea_source_folder ?? undefined,
    eaCompiledFolder: row.ea_compiled_folder ?? undefined,
    mt5TerminalName: row.mt5_terminal_name ?? undefined,
    brokerAccountLabel: row.broker_account_label ?? undefined,
  };
}

function mapLog(row: DbLogRow): DeploymentLog {
  return {
    id: String(row.id),
    timestamp: new Date(row.timestamp).toISOString(),
    severity: row.severity as DeploymentLog['severity'],
    action: row.action,
    message: row.message,
    path: row.path ?? undefined,
  };
}

