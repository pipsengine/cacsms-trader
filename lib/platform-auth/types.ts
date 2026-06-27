export const PLATFORM_ROLES = ['super_admin', 'administrator', 'trader', 'viewer'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_USER_STATUSES = ['active', 'suspended', 'disabled'] as const;
export type PlatformUserStatus = (typeof PLATFORM_USER_STATUSES)[number];

export const PLATFORM_PERMISSION_KEYS = [
  'view_command_center',
  'manage_own_profile',
  'manage_own_mt5',
  'manage_own_trading_config',
  'view_own_trade_history',
  'manage_users',
  'manage_user_mt5',
  'manage_user_trading',
  'enable_disable_trading_engine',
  'view_all_users',
  'view_audit_log',
  'manage_roles_permissions',
  'view_admin_dashboard',
  'view_mt5_infrastructure',
  'manage_trading_accounts',
  'manage_active_sessions',
] as const;

export type PlatformPermissionKey = (typeof PLATFORM_PERMISSION_KEYS)[number];
export type PlatformPermissions = Partial<Record<PlatformPermissionKey, boolean>>;

export type PlatformUserPublic = {
  id: string;
  username: string | null;
  email: string;
  displayName: string;
  role: PlatformRole;
  status: PlatformUserStatus;
  isSystemProtected: boolean;
  managedByUserId: string | null;
  permissions: PlatformPermissions;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlatformMt5Config = {
  brokerName: string;
  accountNumber: string;
  serverName: string;
  terminalId: string | null;
  symbol: string;
  hasPassword: boolean;
  hasInvestorPassword: boolean;
  connectionStatus: string;
  lastConnectedAt: string | null;
  updatedAt: string;
};

export type PlatformTradingConfig = {
  tradingEnabled: boolean;
  lotSize: number;
  riskPerTradePercent: number;
  dailyDrawdownPercent: number;
  maxOpenTrades: number;
  basketLimit: number;
  profitLockEnabled: boolean;
  profitLockPercent: number;
  goldEngineEnabled: boolean;
  updatedAt: string;
};

export type PlatformAuditEntry = {
  id: number;
  actorUserId: string | null;
  actorEmail: string | null;
  targetUserId: string | null;
  targetEmail: string | null;
  category: string;
  action: string;
  detail: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
};

export type PlatformAdminOverview = {
  totalUsers: number;
  activeUsers: number;
  connectedMt5: number;
  tradingEnginesActive: number;
  activeBaskets: number;
  dailyPnl: number;
  riskExposure: number;
  activeSessions: number;
  users: Array<{
    id: string;
    username: string | null;
    email: string;
    displayName: string;
    role: PlatformRole;
    status: PlatformUserStatus;
    isSystemProtected: boolean;
    mt5Connected: boolean;
    tradingEnabled: boolean;
    goldEngineEnabled: boolean;
    accountNumber: string | null;
    brokerName: string | null;
  }>;
};

export type PlatformSessionView = {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  isCurrent: boolean;
};

export type PlatformTradingAccountLink = {
  id: string;
  userId: string;
  label: string;
  accountNumber: string;
  brokerName: string;
  serverName: string;
  terminalId: string | null;
  symbol: string;
  isPrimary: boolean;
  tradingEnabled: boolean;
  goldEngineEnabled: boolean;
  connectionStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformEaInstance = {
  id: string;
  userId: string;
  tradingAccountId: string | null;
  terminalId: string;
  symbol: string;
  eaName: string;
  status: string;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlatformMfaStatus = {
  enabled: boolean;
  method: string;
  verifiedAt: string | null;
  enrollable: boolean;
};
