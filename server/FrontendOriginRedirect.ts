export interface FrontendOriginRedirectInput {
  method?: string;
  url?: string;
  host?: string;
  accept?: string;
  nodeEnv?: string;
  frontendPort?: string | number;
  disabled?: boolean;
  protocol?: string;
}

const DEFAULT_FRONTEND_PORT = '3000';

const BACKEND_PREFIXES = [
  '/api/',
  '/health',
  '/matchmake',
  '/__lan/',
  '/ws',
  '/colyseus',
];

const STATIC_FILE_PATTERN = /\.[a-z0-9]{1,8}(?:$|[?#])/i;

function normalizePort(port: string | number | undefined): string {
  const raw = String(port ?? '').trim();
  return /^\d+$/.test(raw) ? raw : DEFAULT_FRONTEND_PORT;
}

function acceptsHtml(accept: string | undefined): boolean {
  if (!accept) return false;
  return accept.includes('text/html') || accept.includes('*/*');
}

function isBackendRoute(pathname: string): boolean {
  return BACKEND_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix));
}

export function getFrontendOriginRedirectUrl(input: FrontendOriginRedirectInput): string | null {
  if (input.disabled || input.nodeEnv === 'production') return null;

  const method = (input.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (!acceptsHtml(input.accept)) return null;
  if (!input.host) return null;

  const protocol = input.protocol ?? 'http';
  let target: URL;
  try {
    target = new URL(input.url || '/', `${protocol}://${input.host}`);
  } catch {
    return null;
  }

  if (isBackendRoute(target.pathname)) return null;
  if (STATIC_FILE_PATTERN.test(target.pathname)) return null;

  const frontendPort = normalizePort(input.frontendPort);
  if (target.port === frontendPort) return null;

  target.port = frontendPort;
  return target.toString();
}
