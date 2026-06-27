const INSECURE_SECRETS = new Set([
  'change-me-platform-auth-secret',
  'platform-auth-secret-change-me',
  'P@882w0rd',
  'password',
  'admin',
]);

export function validatePlatformSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const authSecret = String(process.env.PLATFORM_AUTH_SECRET ?? '').trim();
  const adminPassword = String(process.env.GLOBAL_SUPER_ADMIN_PASSWORD ?? '').trim();

  const problems: string[] = [];

  if (!authSecret || authSecret.length < 32 || INSECURE_SECRETS.has(authSecret)) {
    problems.push('PLATFORM_AUTH_SECRET must be set to a unique value of at least 32 characters in production.');
  }

  if (!adminPassword || adminPassword.length < 12 || INSECURE_SECRETS.has(adminPassword)) {
    problems.push('GLOBAL_SUPER_ADMIN_PASSWORD must be set to a strong unique password in production.');
  }

  if (problems.length > 0) {
    throw new Error(`Insecure platform configuration:\n- ${problems.join('\n- ')}`);
  }
}
