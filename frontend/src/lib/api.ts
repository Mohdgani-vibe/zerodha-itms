import { clearStoredSession, getStoredSession } from './session';

const explicitApiOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim();
const explicitWebSocketOrigin = (import.meta.env.VITE_WS_ORIGIN as string | undefined)?.trim();

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let authRedirectInFlight = false;

export function resetAuthRedirectState() {
  authRedirectInFlight = false;
}

function trimTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function inferLocalApiOrigin() {
  return '';
}

export function getApiOrigin() {
  if (explicitApiOrigin) {
    return trimTrailingSlash(explicitApiOrigin);
  }

  return inferLocalApiOrigin();
}

export function resolveApiUrl(url: string) {
  if (!url.startsWith('/')) {
    return url;
  }

  const origin = getApiOrigin();
  return origin ? `${origin}${url}` : url;
}

export function resolveWebSocketUrl(path: string) {
  if (!path.startsWith('/')) {
    return path;
  }

  if (explicitWebSocketOrigin) {
    return `${trimTrailingSlash(explicitWebSocketOrigin)}${path}`;
  }

  const apiOrigin = getApiOrigin();
  if (!apiOrigin) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}${path}`;
  }

  const socketOrigin = apiOrigin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${socketOrigin}${path}`;
}

export async function apiRequest<T>(url: string, init: RequestInit = {}) {
  const session = getStoredSession();
  const headers = new Headers(init.headers ?? {});

  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (session?.token) {
    headers.set('Authorization', `Bearer ${session.token}`);
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(url), {
      ...init,
      headers,
    });
  } catch {
    throw new ApiError('Backend is not running. Start the API and try again.', 503);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredSession();
      if (typeof window !== 'undefined' && !authRedirectInFlight) {
        authRedirectInFlight = true;
        const nextPath = `${window.location.pathname}${window.location.search}`;
        const loginUrl = new URL('/login', window.location.origin);
        if (nextPath !== '/login') {
          loginUrl.searchParams.set('next', nextPath);
        }
        window.location.replace(loginUrl.toString());
      }
    }

    const message = response.status === 502
      ? 'Backend is not running. Start the API and try again.'
      : typeof payload === 'object' && payload && 'error' in payload
      ? String(payload.error)
      : response.statusText || 'Request failed';

    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export async function validateStoredSession() {
  const session = getStoredSession();
  if (!session?.token) {
    return false;
  }

  try {
    const response = await fetch(resolveApiUrl('/api/auth/me'), {
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    });

    if (!response.ok) {
      clearStoredSession();
      return false;
    }

    return true;
  } catch {
    return false;
  }
}