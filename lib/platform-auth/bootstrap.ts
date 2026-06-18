import { hashPassword } from '@/lib/platform-auth/password';
import {
  GLOBAL_SUPER_ADMIN_DISPLAY_NAME,
  globalSuperAdminEmail,
  GLOBAL_SUPER_ADMIN_ID,
  GLOBAL_SUPER_ADMIN_USERNAME,
  globalSuperAdminPassword,
} from '@/lib/platform-auth/global-super-admin';
import {
  ensurePlatformAuthTables,
  getUserByEmail,
  getUserById,
  getUserByUsername,
  insertAuditLog,
} from '@/lib/platform-auth/store';
import type { PlatformUserPublic } from '@/lib/platform-auth/types';
import { queryPostgres } from '@/lib/postgres';

let ensureStarted = false;

export async function bootstrapPlatformSuperAdmin(): Promise<void> {
  if (ensureStarted) return;
  ensureStarted = true;
  await ensureGlobalSuperAdmin();
}

export async function ensureGlobalSuperAdmin(): Promise<PlatformUserPublic> {
  await ensurePlatformAuthTables();

  const existing =
    (await getUserById(GLOBAL_SUPER_ADMIN_ID))
    ?? (await getUserByEmail(globalSuperAdminEmail()))
    ?? (await getUserByUsername(GLOBAL_SUPER_ADMIN_USERNAME));

  if (existing) {
    await queryPostgres(
      `UPDATE platform_users
       SET username = $1,
           display_name = $2,
           email = $3,
           role = 'super_admin',
           status = 'active',
           is_system_protected = true,
           updated_at = now()
       WHERE id = $4`,
      [GLOBAL_SUPER_ADMIN_USERNAME, GLOBAL_SUPER_ADMIN_DISPLAY_NAME, globalSuperAdminEmail(), existing.id],
    );
    const user = await getUserById(existing.id);
    if (user) return user;
  }

  const passwordHash = hashPassword(globalSuperAdminPassword());
  const result = await queryPostgres(
    `INSERT INTO platform_users (
       id, username, email, display_name, password_hash, role, status,
       is_system_protected, permissions, password_changed_at
     )
     VALUES ($1, $2, $3, $4, $5, 'super_admin', 'active', true, '{}'::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       display_name = EXCLUDED.display_name,
       email = EXCLUDED.email,
       role = 'super_admin',
       status = 'active',
       is_system_protected = true,
       updated_at = now()
     RETURNING id`,
    [
      GLOBAL_SUPER_ADMIN_ID,
      GLOBAL_SUPER_ADMIN_USERNAME,
      globalSuperAdminEmail(),
      GLOBAL_SUPER_ADMIN_DISPLAY_NAME,
      passwordHash,
    ],
  );

  const userId = String(result.rows[0]?.id ?? GLOBAL_SUPER_ADMIN_ID);

  await queryPostgres(
    `INSERT INTO platform_user_mt5_config (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  await queryPostgres(
    `INSERT INTO platform_user_trading_config (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );

  const user = await getUserById(userId);
  if (!user) {
    throw new Error('Failed to provision Global Super Administrator.');
  }

  await insertAuditLog({
    actorUserId: user.id,
    targetUserId: user.id,
    category: 'admin',
    action: 'global_super_admin_ensured',
    detail: { username: user.username, email: user.email },
  });

  return user;
}
