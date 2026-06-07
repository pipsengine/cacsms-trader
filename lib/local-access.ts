const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function hostnameFromHostHeader(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end >= 0 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(':')[0] ?? '';
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return LOCAL_HOSTNAMES.has(normalized);
}

function isLoopbackIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1') return true;
  if (normalized.startsWith('::ffff:')) {
    return isLoopbackIp(normalized.slice('::ffff:'.length));
  }
  return false;
}

function isPrivateNetworkIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  if (!normalized) return false;
  if (isLoopbackIp(normalized)) return true;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  const secondOctet = Number(normalized.split('.')[1] ?? NaN);
  if (normalized.startsWith('172.') && secondOctet >= 16 && secondOctet <= 31) return true;
  return false;
}

function firstClientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim() ?? '';
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  return realIp || forwardedFor;
}

export function isLocalMachineRequest(request: Request): boolean {
  if (process.env.CACSMS_TOOLS_ALLOW_REMOTE === 'true') {
    return true;
  }

  const urlHost = hostnameFromHostHeader(new URL(request.url).hostname);
  const requestHost = hostnameFromHostHeader(request.headers.get('host') ?? '');
  const forwardedHost = hostnameFromHostHeader(request.headers.get('x-forwarded-host') ?? '');
  const hostCandidates = [requestHost, forwardedHost, urlHost].filter(Boolean);

  if (hostCandidates.some(isLocalHostname)) {
    return true;
  }

  const clientIp = firstClientIp(request);
  if (isLoopbackIp(clientIp)) {
    return true;
  }

  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env === 'development' && (isPrivateNetworkIp(clientIp) || !clientIp)) {
    return true;
  }

  return false;
}

export function isLocalMachineHeaders(headers: Headers, requestUrl?: string): boolean {
  if (process.env.CACSMS_TOOLS_ALLOW_REMOTE === 'true') {
    return true;
  }

  const urlHost = requestUrl ? hostnameFromHostHeader(new URL(requestUrl).hostname) : '';
  const requestHost = hostnameFromHostHeader(headers.get('host') ?? '');
  const forwardedHost = hostnameFromHostHeader(headers.get('x-forwarded-host') ?? '');
  const hostCandidates = [requestHost, forwardedHost, urlHost].filter(Boolean);

  if (hostCandidates.some(isLocalHostname)) {
    return true;
  }

  const realIp = headers.get('x-real-ip')?.trim() ?? '';
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const clientIp = realIp || forwardedFor;
  if (isLoopbackIp(clientIp)) {
    return true;
  }

  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env === 'development' && (isPrivateNetworkIp(clientIp) || !clientIp)) {
    return true;
  }

  const host = headers.get('host') ?? '';
  const looksLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return looksLocal;
}

export function assertDevToolEnabled(toolEnvVar: string, toolLabel: string): void {
  const env = String(process.env.CACSMS_ENV ?? 'development').toLowerCase();
  if (env === 'development') return;
  if (String(process.env[toolEnvVar] ?? '').toLowerCase() === 'true') return;
  throw new Error(`${toolLabel} is disabled outside development.`);
}

export function assertLocalToolAccess(request: Request, message: string): void {
  if (!isLocalMachineRequest(request)) {
    throw new Error(message);
  }
}
