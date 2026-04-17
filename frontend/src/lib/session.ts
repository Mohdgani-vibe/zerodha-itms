export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  departmentId?: string | null;
  locationId?: string | null;
  defaultPortal: string;
  portals: string[];
}

export interface AppSession {
  token: string;
  user: SessionUser;
  shortName: string;
}

const SESSION_KEY = 'itms_session';
const TOKEN_KEY = 'itms_token';

interface TokenClaims {
  uid?: string;
  sub?: string;
  email?: string;
  role?: string;
  name?: string;
  exp?: number;
}

interface AuthUserPayload {
  id: string;
  email: string;
  role: string;
  fullName?: string;
  full_name?: string;
  deptId?: string | null;
  dept_id?: string | null;
  locationId?: string | null;
  location_id?: string | null;
  defaultPortal?: string;
  default_portal?: string;
  portals?: string[];
}

function normalizePortals(role: string, portals?: string[]) {
  const fallback = role.toLowerCase().includes('super')
    ? ['super_admin', 'it_team', 'employee']
    : role.toLowerCase().includes('it')
      ? ['it_team', 'employee']
      : ['employee'];

  const candidates = (portals && portals.length > 0 ? portals : fallback)
    .map((portal) => portal.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const portal of candidates) {
    if (!seen.has(portal)) {
      seen.add(portal);
      normalized.push(portal);
    }
  }

  return normalized.length > 0 ? normalized : fallback;
}

function isExpired(exp?: number) {
  if (!exp) {
    return false;
  }

  return exp * 1000 <= Date.now();
}

function normalizePortalPath(defaultPortal: string | undefined, role: string) {
  const fallbackPortal = getDefaultPortalForRole(role);

  if (!defaultPortal) {
    return fallbackPortal;
  }

  if (defaultPortal === '/admin/dashboard') {
    return '/admin/dashboard';
  }

  if (defaultPortal === '/it/dashboard') {
    return '/it/dashboard';
  }

  if (defaultPortal === '/employee/dashboard') {
    return '/emp/dashboard';
  }

  if (/^\/(admin|it|emp)(?:\/|$)/.test(defaultPortal)) {
    return defaultPortal;
  }

  return fallbackPortal;
}

function normalizeSession(session: AppSession) {
  return {
    ...session,
    shortName: session.shortName || getShortName(session.user.fullName, session.user.role),
    user: {
      ...session.user,
      defaultPortal: normalizePortalPath(session.user.defaultPortal, session.user.role),
      portals: normalizePortals(session.user.role, session.user.portals),
    },
  } satisfies AppSession;
}

export function getPortalSegmentForRole(role: string) {
  const normalizedRole = role.toLowerCase();

  if (normalizedRole.includes('super')) {
    return 'admin';
  }

  if (normalizedRole.includes('it')) {
    return 'it';
  }

  return 'emp';
}

export function getDefaultPortalForRole(role: string) {
  const segment = getPortalSegmentForRole(role);

  if (segment === 'admin') {
    return '/admin/dashboard';
  }

  if (segment === 'it') {
    return '/it/dashboard';
  }

  return '/emp/dashboard';
}

export function isProfileSetupRequired(user: Pick<SessionUser, 'role' | 'departmentId' | 'locationId'>) {
  return user.role === 'employee' && (!user.departmentId || !user.locationId);
}

export function getPreferredPortalPath(user: SessionUser) {
  if (isProfileSetupRequired(user)) {
    return '/emp/profile';
  }

  return user.defaultPortal;
}

export function getAllowedPortalSegments(user: Pick<SessionUser, 'role' | 'portals'>) {
  const allowed = new Set<string>();
  for (const portal of normalizePortals(user.role, user.portals)) {
    if (portal === 'super_admin') {
      allowed.add('admin');
    } else if (portal === 'it_team') {
      allowed.add('it');
    } else if (portal === 'employee') {
      allowed.add('emp');
    }
  }

  if (allowed.size === 0) {
    allowed.add(getPortalSegmentForRole(user.role));
  }

  return Array.from(allowed);
}

export function getShortName(fullName: string, role: string) {
  const normalizedRole = role.toLowerCase();

  if (normalizedRole.includes('super')) {
    return 'SA';
  }

  if (normalizedRole.includes('it')) {
    return 'IT';
  }

  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return initials || 'EM';
}

export function getStoredSession() {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawSession = window.localStorage.getItem(SESSION_KEY);
  if (rawSession) {
    try {
      const session = JSON.parse(rawSession) as AppSession;

      if (!session?.token || !session?.user) {
        clearStoredSession();
        return null;
      }

      const claims = decodeTokenClaims(session.token);
      if (claims && isExpired(claims.exp)) {
        clearStoredSession();
        return null;
      }

      const normalizedSession = normalizeSession(session);
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(normalizedSession));
      if (!window.localStorage.getItem(TOKEN_KEY)) {
        window.localStorage.setItem(TOKEN_KEY, normalizedSession.token);
      }

      return normalizedSession;
    } catch {
      clearStoredSession();
      return null;
    }
  }

  const token = window.localStorage.getItem(TOKEN_KEY);
  if (token) {
    const claims = decodeTokenClaims(token);

    if (claims?.role && claims?.email && !isExpired(claims.exp)) {
      const fullName = claims.name || claims.email;
      return normalizeSession({
        token,
        shortName: getShortName(fullName, claims.role),
        user: {
          id: claims.uid || claims.sub || '',
          email: claims.email,
          fullName,
          role: claims.role,
          defaultPortal: normalizePortalPath(undefined, claims.role),
          portals: normalizePortals(claims.role),
        },
      });
    }

    if (claims && isExpired(claims.exp)) {
      clearStoredSession();
    }
  }

  return null;
}

export function setStoredSession(session: AppSession) {
  const normalizedSession = normalizeSession(session);
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(normalizedSession));
  window.localStorage.setItem(TOKEN_KEY, normalizedSession.token);
}

export function clearStoredSession() {
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem('itms_role');
  window.localStorage.removeItem('itms_short');
}

function decodeTokenClaims(token: string) {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const normalized = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const decoded = window.atob(normalized);
    return JSON.parse(decoded) as TokenClaims;
  } catch {
    return null;
  }
}

export function normalizeLoginIdentifier(value: string) {
  const trimmedValue = value.trim().toLowerCase();

  if (!trimmedValue) {
    return trimmedValue;
  }

  if (trimmedValue.includes('@')) {
    return trimmedValue;
  }

  return `${trimmedValue}@zerodha.com`;
}

export function normalizeAuthUser(user: AuthUserPayload): SessionUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName || user.full_name || user.email,
    role: user.role,
    departmentId: user.deptId || user.dept_id || null,
    locationId: user.locationId || user.location_id || null,
    defaultPortal: normalizePortalPath(user.defaultPortal || user.default_portal, user.role),
    portals: normalizePortals(user.role, user.portals),
  };
}