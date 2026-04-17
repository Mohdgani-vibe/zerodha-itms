import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

interface NavigationMetric {
  from: string;
  to: string;
  source: 'pushState' | 'replaceState' | 'popstate' | 'location-change';
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

declare global {
  interface Window {
    __ITMS_NAV_METRICS__?: NavigationMetric[];
  }

  interface WindowEventMap {
    'itms:navigation-metric': CustomEvent<NavigationMetric>;
  }
}

type PendingNavigation = {
  from: string;
  to: string;
  source: NavigationMetric['source'];
  startedAt: number;
};

let pendingNavigation: PendingNavigation | null = null;
let historyPatchRefs = 0;
let restoreHistoryPatch: (() => void) | null = null;

function currentRoute() {
  return `${window.location.pathname}${window.location.search}`;
}

function markPendingNavigation(url: string | URL | null | undefined, source: NavigationMetric['source']) {
  const nextUrl = new URL(url ? String(url) : window.location.href, window.location.href);
  const to = `${nextUrl.pathname}${nextUrl.search}`;
  const from = currentRoute();

  if (to === from) {
    return;
  }

  pendingNavigation = {
    from,
    to,
    source,
    startedAt: performance.now(),
  };
}

function appendMetric(metric: NavigationMetric) {
  window.__ITMS_NAV_METRICS__ = [...(window.__ITMS_NAV_METRICS__ ?? []), metric].slice(-30);
  window.dispatchEvent(new CustomEvent('itms:navigation-metric', { detail: metric }));
  console.info(`[nav] ${metric.source} ${metric.from} -> ${metric.to} in ${metric.durationMs.toFixed(1)}ms`);
}

function retainMatchingPendingNavigation(route: string) {
  if (!pendingNavigation) {
    return null;
  }

  if (pendingNavigation.to !== route) {
    pendingNavigation = null;
    return null;
  }

  const matchedNavigation = pendingNavigation;
  pendingNavigation = null;
  return matchedNavigation;
}

function requestAfterPaint(task: () => void) {
  const firstFrame = window.requestAnimationFrame(() => {
    window.requestAnimationFrame(task);
  });

  return () => window.cancelAnimationFrame(firstFrame);
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }

  const sortedValues = values.slice().sort((left, right) => left - right);
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * ratio) - 1));
  return sortedValues[index];
}

function ensureHistoryInstrumentation() {
  historyPatchRefs += 1;
  if (restoreHistoryPatch) {
    return () => {
      historyPatchRefs -= 1;
      if (historyPatchRefs === 0 && restoreHistoryPatch) {
        restoreHistoryPatch();
        restoreHistoryPatch = null;
      }
    };
  }

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);
  const popstateHandler = () => markPendingNavigation(window.location.href, 'popstate');

  window.history.pushState = function pushState(data, unused, url) {
    markPendingNavigation(url, 'pushState');
    originalPushState(data, unused, url);
  };

  window.history.replaceState = function replaceState(data, unused, url) {
    markPendingNavigation(url, 'replaceState');
    originalReplaceState(data, unused, url);
  };

  window.addEventListener('popstate', popstateHandler);

  restoreHistoryPatch = () => {
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
    window.removeEventListener('popstate', popstateHandler);
  };

  return () => {
    historyPatchRefs -= 1;
    if (historyPatchRefs === 0 && restoreHistoryPatch) {
      restoreHistoryPatch();
      restoreHistoryPatch = null;
    }
  };
}

function NavigationMetricsOverlay() {
  const [metrics, setMetrics] = useState<NavigationMetric[]>(() => window.__ITMS_NAV_METRICS__ ?? []);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const handleMetric = (event: WindowEventMap['itms:navigation-metric']) => {
      setMetrics((current) => [...current, event.detail].slice(-6));
    };

    window.addEventListener('itms:navigation-metric', handleMetric);
    return () => {
      window.removeEventListener('itms:navigation-metric', handleMetric);
    };
  }, []);

  if (metrics.length === 0) {
    return null;
  }

  const latestMetric = metrics[metrics.length - 1];
  const recentDurations = metrics.map((metric) => metric.durationMs);
  const p50 = percentile(recentDurations, 0.5);
  const p95 = percentile(recentDurations, 0.95);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100]">
      <div className="pointer-events-auto w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-800 bg-zinc-950/92 text-zinc-100 shadow-2xl backdrop-blur">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Navigation Metrics</div>
            <div className="mt-1 text-sm font-semibold text-white">
              {latestMetric.durationMs.toFixed(1)}ms
              <span className="ml-2 text-xs font-medium text-zinc-400">{latestMetric.to}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
              <span>p50 {p50.toFixed(1)}ms</span>
              <span>p95 {p95.toFixed(1)}ms</span>
              <span>{metrics.length} entries</span>
            </div>
          </div>
          <div className="rounded-full border border-zinc-700 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-300">
            {expanded ? 'Hide' : 'Show'}
          </div>
        </button>

        {expanded ? (
          <div className="border-t border-zinc-800 px-4 py-3">
            <div className="mb-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Latest</div>
                <div className="mt-1 text-sm font-semibold text-white">{latestMetric.durationMs.toFixed(1)}ms</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">p50</div>
                <div className="mt-1 text-sm font-semibold text-white">{p50.toFixed(1)}ms</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">p95</div>
                <div className="mt-1 text-sm font-semibold text-white">{p95.toFixed(1)}ms</div>
              </div>
            </div>
            <div className="space-y-2">
              {metrics.slice().reverse().map((metric) => (
                <div key={`${metric.startedAt}-${metric.to}`} className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-xs font-semibold text-zinc-200">{metric.to}</div>
                    <div className="shrink-0 text-xs font-bold text-emerald-400">{metric.durationMs.toFixed(1)}ms</div>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-zinc-400">{metric.source} from {metric.from}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function NavigationMetrics() {
  const location = useLocation();
  const previousRouteRef = useRef(`${location.pathname}${location.search}`);
  const isFirstRender = useRef(true);
  const enabled = import.meta.env.DEV && typeof window !== 'undefined';

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return ensureHistoryInstrumentation();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const route = `${location.pathname}${location.search}`;
    const previousRoute = previousRouteRef.current;
    previousRouteRef.current = route;

    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const matchedNavigation = retainMatchingPendingNavigation(route);
    const navigation = matchedNavigation ?? {
      from: previousRoute,
      to: route,
      source: 'location-change' as const,
      startedAt: performance.now(),
    };

    return requestAfterPaint(() => {
      const completedAt = performance.now();
      appendMetric({
        from: navigation.from,
        to: navigation.to,
        source: navigation.source,
        startedAt: navigation.startedAt,
        completedAt,
        durationMs: completedAt - navigation.startedAt,
      });
    });
  }, [enabled, location.pathname, location.search]);

  if (!enabled) {
    return null;
  }

  return <NavigationMetricsOverlay />;
}