import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopNav from './TopNav';
import { getAllowedPortalSegments, getPortalSegmentForRole, getStoredSession } from '../../lib/session';

type PortalSegment = 'admin' | 'it' | 'emp';

const preloadedChunks = new Set<string>();

const portalChunkLoaders: Record<PortalSegment, Array<{ key: string; matches: string[]; load: () => Promise<unknown> }>> = {
  admin: [
    { key: 'devices', matches: ['/devices'], load: () => import('../../pages/Devices') },
    { key: 'alerts', matches: ['/alerts'], load: () => import('../../pages/Alerts') },
    { key: 'requests', matches: ['/requests'], load: () => import('../../pages/live/RequestsQueuePage') },
    { key: 'gatepass', matches: ['/gatepass'], load: () => import('../../pages/Gatepass') },
    { key: 'chat', matches: ['/chat'], load: () => import('../../pages/Chat') },
    { key: 'settings', matches: ['/settings'], load: () => import('../../pages/live/SettingsPage') },
  ],
  it: [
    { key: 'devices', matches: ['/devices'], load: () => import('../../pages/Devices') },
    { key: 'alerts', matches: ['/alerts'], load: () => import('../../pages/Alerts') },
    { key: 'patch', matches: ['/patch'], load: () => import('../../pages/live/PatchDashboardPage') },
    { key: 'requests', matches: ['/requests'], load: () => import('../../pages/live/RequestsQueuePage') },
    { key: 'chat', matches: ['/chat'], load: () => import('../../pages/Chat') },
    { key: 'settings', matches: ['/settings'], load: () => import('../../pages/live/SettingsPage') },
  ],
  emp: [
    { key: 'alerts', matches: ['/alerts'], load: () => import('../../pages/Alerts') },
    { key: 'requests', matches: ['/requests'], load: () => import('../../pages/live/MyRequestsPage') },
    { key: 'chat', matches: ['/chat'], load: () => import('../../pages/Chat') },
    { key: 'announcements', matches: ['/announcements'], load: () => import('../../pages/Announcements') },
  ],
};

function scheduleIdle(task: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  if (typeof window.requestIdleCallback === 'function') {
    const callbackId = window.requestIdleCallback(() => task(), { timeout: 1200 });
    return () => window.cancelIdleCallback(callbackId);
  }

  const timeoutId = globalThis.setTimeout(task, 250);
  return () => globalThis.clearTimeout(timeoutId);
}

export default function PortalLayout() {
  const location = useLocation();
  const session = getStoredSession();
  const sessionUser = session?.user;

  useEffect(() => {
    if (!sessionUser?.role) {
      return;
    }

    const portalFromPath = location.pathname.match(/^\/(admin|it|emp)(?:\/|$)/)?.[1] as PortalSegment | undefined;
    const fallbackPortal = getAllowedPortalSegments(sessionUser)[0] || getPortalSegmentForRole(sessionUser.role);
    const portal = (portalFromPath || fallbackPortal) as PortalSegment;
    const candidates = portalChunkLoaders[portal].filter((candidate) => !candidate.matches.some((match) => location.pathname.includes(match)));

    return scheduleIdle(() => {
      candidates.forEach((candidate) => {
        if (preloadedChunks.has(candidate.key)) {
          return;
        }

        preloadedChunks.add(candidate.key);
        void candidate.load();
      });
    });
  }, [location.pathname, sessionUser]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 transition-colors dark:bg-zinc-950 dark:text-zinc-100 flex flex-col">
      <TopNav />
      <main className="flex-1 overflow-hidden flex flex-col">
         <Outlet />
      </main>
    </div>
  );
}
