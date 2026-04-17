import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Bug, Search, Shield, ShieldAlert, ShieldCheck, TerminalSquare, Wrench } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { getStoredSession } from '../lib/session';
import Pagination from '../components/Pagination';
import { useLocation, useNavigate } from 'react-router-dom';

const ALERTS_PAGE_SIZE = 20;

const DEFAULT_SOURCE_OPTIONS = [
  { value: 'terminal', label: 'Terminal' },
  { value: 'patch', label: 'Patch' },
  { value: 'wazuh', label: 'Wazuh' },
  { value: 'openscap', label: 'OpenSCAP Hardening' },
  { value: 'clamav', label: 'ClamAV' },
  { value: 'inotify', label: 'Inotify' },
];

const ALERT_TABS = [
  { value: 'all', label: 'Alerts' },
  { value: 'wazuh', label: 'Wazuh' },
  { value: 'openscap', label: 'OpenSCAP Hardening' },
  { value: 'clamav', label: 'ClamScan' },
] as const;

interface AlertRecord {
  id: string;
  assetId?: string | null;
  assetTag?: string | null;
  assetName?: string | null;
  hostname?: string | null;
  deviceId: string;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  department?: string | null;
  source: string;
  sourceLabel?: string;
  sourceRaw?: string;
  severity: string;
  title: string;
  detail: string;
  acknowledged: boolean;
  resolved: boolean;
  createdAt: string;
}

interface NamedCount {
  name: string;
  label?: string;
  count: number;
}

interface PaginatedAlertsResponse {
  items: AlertRecord[];
  total: number;
  page: number;
  pageSize: number;
  summary?: {
    open: number;
    acknowledged: number;
    resolved: number;
    sourceCounts: NamedCount[];
  };
}

interface RelatedAssetAlert {
  id: string;
  source: string;
  severity: string;
  title: string;
  detail: string;
  acknowledged: boolean;
  resolved: boolean;
  createdAt: string;
}

export default function Alerts() {
  const session = getStoredSession();
  const role = session?.user.role || '';
  const canResolve = role === 'super_admin' || role === 'it_team';
  const feedLabel = role === 'employee' ? 'My Security Feed' : 'Security Operations';
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.split('/alerts')[0] || '';
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [alertSummary, setAlertSummary] = useState({ open: 0, acknowledged: 0, resolved: 0, sourceCounts: [] as NamedCount[] });
  const [selectedAlert, setSelectedAlert] = useState<AlertRecord | null>(null);
  const [detailActionLoading, setDetailActionLoading] = useState('');
  const [detailMessage, setDetailMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [relatedAlerts, setRelatedAlerts] = useState<RelatedAssetAlert[]>([]);
  const [relatedAlertsLoading, setRelatedAlertsLoading] = useState(false);

  const applyAlertUpdate = useCallback((alertId: string, updater: (alert: AlertRecord) => AlertRecord) => {
    setAlerts((current) => current.map((alert) => (alert.id === alertId ? updater(alert) : alert)));
    setSelectedAlert((current) => (current && current.id === alertId ? updater(current) : current));
  }, []);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const endpoint = role === 'employee' ? '/api/me/alerts' : '/api/alerts';
      const params = new URLSearchParams({
        paginate: '1',
        page: String(currentPage),
        page_size: String(ALERTS_PAGE_SIZE),
      });
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }
      if (sourceFilter !== 'all') {
        params.set('source', sourceFilter);
      }
      const data = await apiRequest<PaginatedAlertsResponse>(`${endpoint}?${params.toString()}`);
      setAlerts(data.items);
      setTotalAlerts(data.total);
      setAlertSummary({
        open: data.summary?.open || 0,
        acknowledged: data.summary?.acknowledged || 0,
        resolved: data.summary?.resolved || 0,
        sourceCounts: data.summary?.sourceCounts || [],
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [currentPage, role, searchQuery, sourceFilter]);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const sourceOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    for (const option of DEFAULT_SOURCE_OPTIONS) {
      optionMap.set(option.value, option.label);
    }
    for (const entry of alertSummary.sourceCounts) {
      optionMap.set(entry.name, entry.label || entry.name);
    }

    return Array.from(optionMap.entries()).map(([value, label]) => ({ value, label }));
  }, [alertSummary.sourceCounts]);

  const sourceCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of alertSummary.sourceCounts) {
      counts.set(entry.name, entry.count);
    }
    return counts;
  }, [alertSummary.sourceCounts]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sourceFilter]);

  useEffect(() => {
    setDetailActionLoading('');
    setDetailMessage(null);
  }, [selectedAlert?.id]);

  useEffect(() => {
    if (alerts.length === 0) {
      setSelectedAlert(null);
      return;
    }
    setSelectedAlert((current) => {
      if (current) {
        const matchingAlert = alerts.find((alert) => alert.id === current.id);
        if (matchingAlert) {
          return matchingAlert;
        }
      }
      return alerts[0];
    });
  }, [alerts]);

  useEffect(() => {
    if (!selectedAlert?.assetId) {
      setRelatedAlerts([]);
      setRelatedAlertsLoading(false);
      return;
    }

    let cancelled = false;

    const loadRelatedAlerts = async () => {
      try {
        setRelatedAlertsLoading(true);
        const items = await apiRequest<RelatedAssetAlert[]>(`/api/assets/${selectedAlert.assetId}/alerts`);
        if (!cancelled) {
          setRelatedAlerts(items.filter((item) => item.id !== selectedAlert.id).slice(0, 6));
        }
      } catch {
        if (!cancelled) {
          setRelatedAlerts([]);
        }
      } finally {
        if (!cancelled) {
          setRelatedAlertsLoading(false);
        }
      }
    };

    void loadRelatedAlerts();

    return () => {
      cancelled = true;
    };
  }, [selectedAlert?.assetId, selectedAlert?.id]);

  const handleAcknowledge = async (id: string) => {
    try {
      setError('');
      await apiRequest(`/api/alerts/${id}/acknowledge`, { method: 'PUT' });
      applyAlertUpdate(id, (alert) => ({ ...alert, acknowledged: true }));
      await loadAlerts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to acknowledge alert');
    }
  };

  const handleResolve = async (id: string) => {
    try {
      setError('');
      await apiRequest(`/api/alerts/${id}/resolve`, { method: 'PUT' });
      applyAlertUpdate(id, (alert) => ({ ...alert, acknowledged: true, resolved: true }));
      await loadAlerts();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to resolve alert');
    }
  };

  const renderAlertAsset = (alert: AlertRecord) => {
    const parts = [alert.assetTag, alert.hostname].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' / ');
    }
    if (alert.assetName) {
      return alert.assetName;
    }
    return alert.assetId || alert.deviceId || '-';
  };

  const renderAlertUser = (alert: AlertRecord) => {
    return alert.userName || alert.userEmail || '-';
  };

  const renderSystemName = (alert: AlertRecord) => {
    return alert.hostname || alert.assetName || alert.assetTag || alert.deviceId || '-';
  };

  const renderSeverityClassName = (alert: AlertRecord) => {
    const severity = alert.severity.toLowerCase();
    if (severity === 'critical' || severity === 'high') {
      return 'bg-red-100 text-red-700';
    }
    if (severity === 'medium' || severity === 'warning') {
      return 'bg-amber-100 text-amber-700';
    }
    if (severity === 'info' || severity === 'low') {
      return 'bg-sky-100 text-sky-700';
    }
    return 'bg-zinc-100 text-zinc-700';
  };

  const renderSeverityDotClassName = (alert: AlertRecord) => {
    const severity = alert.severity.toLowerCase();
    if (severity === 'critical' || severity === 'high') {
      return 'bg-red-500';
    }
    if (severity === 'medium' || severity === 'warning') {
      return 'bg-amber-500';
    }
    return 'bg-emerald-500';
  };

  const renderAlertStatusLabel = (alert: AlertRecord) => {
    if (alert.resolved) {
      return 'Resolved';
    }
    if (alert.acknowledged) {
      return 'Acknowledged';
    }
    return 'Open';
  };

  const renderAlertStatusClassName = (alert: AlertRecord) => {
    if (alert.resolved) {
      return 'bg-emerald-100 text-emerald-700';
    }
    if (alert.acknowledged) {
      return 'bg-amber-100 text-amber-700';
    }
    return 'bg-rose-100 text-rose-700';
  };

  const formatRelativeTime = (value: string) => {
    const timestamp = new Date(value).getTime();
    const diffMs = Date.now() - timestamp;
    const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
    if (diffMinutes < 60) {
      return `${diffMinutes} min ago`;
    }
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hr ago`;
    }
    return 'yesterday';
  };

  const handleOpenAsset = () => {
    if (!selectedAlert?.assetId) {
      return;
    }
    navigate(`${basePath}/devices/${selectedAlert.assetId}`);
  };

  const handleStartTerminal = async () => {
    if (!selectedAlert?.assetId || !canResolve) {
      return;
    }
    try {
      setDetailActionLoading('terminal');
      setDetailMessage(null);
      const sessionData = await apiRequest<{ connection?: { url?: string } }>('/api/terminal/session', {
        method: 'POST',
        body: JSON.stringify({ deviceId: selectedAlert.assetId }),
      });
      if (sessionData.connection?.url) {
        window.open(sessionData.connection.url, '_blank', 'noopener,noreferrer');
      }
      setDetailMessage({ tone: 'success', text: `Terminal session started for ${renderSystemName(selectedAlert)}.` });
    } catch (requestError) {
      setDetailMessage({ tone: 'error', text: requestError instanceof Error ? requestError.message : 'Failed to start terminal session' });
    } finally {
      setDetailActionLoading('');
    }
  };

  const handleRunPatch = async () => {
    if (!selectedAlert?.deviceId || !canResolve) {
      return;
    }
    try {
      setDetailActionLoading('patch');
      setDetailMessage(null);
      await apiRequest(`/api/assets/${selectedAlert.deviceId}/patch`, { method: 'POST' });
      setDetailMessage({ tone: 'success', text: `Patch run queued for ${renderSystemName(selectedAlert)}.` });
    } catch (requestError) {
      setDetailMessage({ tone: 'error', text: requestError instanceof Error ? requestError.message : 'Failed to queue patch run' });
    } finally {
      setDetailActionLoading('');
    }
  };

  const selectedAlertSource = (selectedAlert?.source || '').toLowerCase();

  const renderSourceLabel = (value: string) => {
    return DEFAULT_SOURCE_OPTIONS.find((option) => option.value === value)?.label || value;
  };

  const renderSourceBadgeClassName = (value: string) => {
    const source = value.toLowerCase();
    if (source === 'wazuh') {
      return 'bg-sky-100 text-sky-700 border-sky-200';
    }
    if (source === 'openscap') {
      return 'bg-violet-100 text-violet-700 border-violet-200';
    }
    if (source === 'clamav') {
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    }
    if (source === 'patch') {
      return 'bg-amber-100 text-amber-700 border-amber-200';
    }
    if (source === 'inotify') {
      return 'bg-orange-100 text-orange-700 border-orange-200';
    }
    return 'bg-zinc-100 text-zinc-700 border-zinc-200';
  };

  const renderSourceIcon = (value: string, className = 'h-3.5 w-3.5') => {
    const source = value.toLowerCase();
    if (source === 'terminal') {
      return <TerminalSquare className={className} />;
    }
    if (source === 'patch') {
      return <Wrench className={className} />;
    }
    if (source === 'wazuh') {
      return <Shield className={className} />;
    }
    if (source === 'openscap') {
      return <ShieldCheck className={className} />;
    }
    if (source === 'clamav') {
      return <Bug className={className} />;
    }
    if (source === 'inotify') {
      return <Bell className={className} />;
    }
    return <ShieldAlert className={className} />;
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[24px] border border-zinc-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_32%),linear-gradient(135deg,_#fafaf9_0%,_#ffffff_52%,_#eefbf3_100%)] px-5 py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-700">
                <ShieldAlert className="mr-2 h-3.5 w-3.5" />
                {feedLabel}
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-tight text-zinc-950 sm:text-3xl">Alerts</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600">Track endpoint, hardening, malware, patching, and file-watch events in one queue that matches the requests workspace layout.</p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[500px]">
              <div className="rounded-xl border border-white/90 bg-white/90 px-3 py-3 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Total</div>
                <div className="mt-1.5 text-2xl font-black text-zinc-950">{totalAlerts}</div>
              </div>
              <div className="rounded-xl border border-white/90 bg-white/90 px-3 py-3 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Open</div>
                <div className="mt-1.5 text-2xl font-black text-zinc-950">{alertSummary.open}</div>
              </div>
              <div className="rounded-xl border border-white/90 bg-white/90 px-3 py-3 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Acknowledged</div>
                <div className="mt-1.5 text-2xl font-black text-zinc-950">{alertSummary.acknowledged}</div>
              </div>
              <div className="rounded-xl border border-white/90 bg-white/90 px-3 py-3 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Resolved</div>
                <div className="mt-1.5 text-2xl font-black text-zinc-950">{alertSummary.resolved}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

      <section className="rounded-[24px] border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {ALERT_TABS.map((tab) => {
              const active = sourceFilter === tab.value || (tab.value === 'all' && sourceFilter === 'all');
              const count = tab.value === 'all' ? totalAlerts : (sourceCountMap.get(tab.value) || 0);
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setSourceFilter(tab.value)}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
                >
                  {tab.value !== 'all' ? renderSourceIcon(tab.value, 'h-3.5 w-3.5') : <ShieldAlert className="h-3.5 w-3.5" />}
                  {tab.label}
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-700">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-b border-zinc-200 px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search alert title, asset, hostname, source"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-3 pl-10 pr-4 text-sm text-zinc-900"
              />
            </div>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 md:w-64">
              <option value="all">All sources</option>
              {sourceOptions.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
            </select>
          </div>
        </div>

        <div className="m-4 grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)] md:m-5">
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50/60">
            <div className="border-b border-zinc-200 bg-white/80 px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-zinc-900">Alert Feed</div>
                  <div className="mt-1 text-xs text-zinc-500">Review incidents by source, inspect the selected asset, and act from the panel on the right.</div>
                </div>
                <div className="hidden items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500 md:flex">
                  <ShieldAlert className="h-4 w-4" />
                  {totalAlerts} tracked
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4 md:p-5">
              {loading ? <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm">Loading alerts...</div> : null}
              {!loading && alerts.length === 0 ? <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm">No alerts found.</div> : null}
              {alerts.map((alert) => {
                const isActive = selectedAlert?.id === alert.id;
                return (
                  <article
                    key={alert.id}
                    onClick={() => setSelectedAlert(alert)}
                    className={`cursor-pointer rounded-2xl border px-4 py-4 shadow-sm transition ${isActive ? 'border-brand-300 bg-brand-50/60 shadow-md ring-1 ring-brand-100' : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-md'}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${renderSeverityDotClassName(alert)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="truncate text-base font-semibold text-zinc-900">{renderSystemName(alert)}</h2>
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${renderAlertStatusClassName(alert)}`}>{renderAlertStatusLabel(alert)}</span>
                            </div>
                            <div className="mt-1 text-sm font-medium text-zinc-700">{alert.title}</div>
                          </div>
                          <div className="text-right text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">{formatRelativeTime(alert.createdAt)}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-bold shadow-sm ${renderSourceBadgeClassName(alert.source)}`}>{renderSourceIcon(alert.source)}{alert.sourceLabel || renderSourceLabel(alert.source)}</span>
                          <span>{renderAlertAsset(alert)}</span>
                        </div>
                        <div className="mt-2 line-clamp-2 text-sm text-zinc-600">{alert.detail || 'No detail provided.'}</div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <Pagination
              currentPage={currentPage}
              totalItems={totalAlerts}
              pageSize={ALERTS_PAGE_SIZE}
              onPageChange={setCurrentPage}
              itemLabel="alerts"
            />
          </div>

          <div className="min-h-[420px] rounded-2xl border border-zinc-200 bg-white shadow-sm lg:sticky lg:top-24">
            {selectedAlert ? (
              <div className="p-6" aria-labelledby="alert-detail-title">
                <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${renderSeverityClassName(selectedAlert)}`}>{selectedAlert.severity || 'unknown'}</span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${renderSourceBadgeClassName(selectedAlert.source)}`}>{renderSourceIcon(selectedAlert.source)}{selectedAlert.sourceLabel || renderSourceLabel(selectedAlert.source)}</span>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${renderAlertStatusClassName(selectedAlert)}`}>{renderAlertStatusLabel(selectedAlert)}</span>
                    </div>
                    <h2 id="alert-detail-title" className="mt-3 text-xl font-bold text-zinc-900">{selectedAlert.title}</h2>
                    <p className="mt-2 max-w-2xl text-sm text-zinc-600">{selectedAlert.detail || 'No detail provided.'}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-right shadow-sm">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Selected Asset</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-900">{renderSystemName(selectedAlert)}</div>
                    <div className="mt-1 text-xs text-zinc-500">{formatRelativeTime(selectedAlert.createdAt)}</div>
                  </div>
                </div>

                {(selectedAlertSource === 'openscap' || selectedAlertSource === 'wazuh' || selectedAlertSource === 'clamav') ? (
                  <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                    {selectedAlertSource === 'openscap' ? 'OpenSCAP findings can be reviewed on the asset page, patched through the Salt-backed patch run, or investigated through a terminal session.' : null}
                    {selectedAlertSource === 'wazuh' ? 'Wazuh findings can be reviewed on the asset page or investigated through a terminal session.' : null}
                    {selectedAlertSource === 'clamav' ? 'ClamScan findings can be investigated through a terminal session and then resolved once the infected artifact is handled.' : null}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedAlert.assetId ? <button type="button" onClick={handleOpenAsset} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50">Open Asset</button> : null}
                  {canResolve && selectedAlert.assetId ? <button type="button" onClick={() => void handleStartTerminal()} disabled={detailActionLoading === 'terminal'} className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-bold text-brand-700 hover:bg-brand-100 disabled:opacity-60"><TerminalSquare className="mr-2 inline h-4 w-4" />{detailActionLoading === 'terminal' ? 'Starting...' : 'Start Terminal'}</button> : null}
                  {canResolve && selectedAlert.assetId && selectedAlertSource === 'openscap' ? <button type="button" onClick={() => void handleRunPatch()} disabled={detailActionLoading === 'patch'} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-60">{detailActionLoading === 'patch' ? 'Queueing...' : 'Run Patch'}</button> : null}
                  {!selectedAlert.acknowledged ? <button type="button" onClick={() => void handleAcknowledge(selectedAlert.id)} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700 hover:bg-amber-100">Acknowledge</button> : null}
                  {canResolve && !selectedAlert.resolved ? <button type="button" onClick={() => void handleResolve(selectedAlert.id)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100">Mark Resolved</button> : null}
                </div>

                <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.8fr)]">
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">System Name</div>
                        <div className="mt-1.5 text-sm font-semibold text-zinc-900">{renderSystemName(selectedAlert)}</div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Asset Tag</div>
                        <div className="mt-1.5 text-sm font-semibold text-zinc-900">{selectedAlert.assetTag || '-'}</div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Asset ID</div>
                        <div className="mt-1.5 break-all text-sm font-semibold text-zinc-900">{selectedAlert.assetId || '-'}</div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">User</div>
                        <div className="mt-1.5 text-sm font-semibold text-zinc-900">{renderAlertUser(selectedAlert)}</div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Email</div>
                        <div className="mt-1.5 text-sm font-semibold text-zinc-900">{selectedAlert.userEmail || '-'}</div>
                      </div>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Department</div>
                        <div className="mt-1.5 text-sm font-semibold text-zinc-900">{selectedAlert.department || '-'}</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Created</div>
                          <div className="mt-1.5 text-sm font-semibold text-zinc-900">{new Date(selectedAlert.createdAt).toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Raw Source</div>
                          <div className="mt-1.5 text-sm font-semibold text-zinc-900">{selectedAlert.sourceRaw || selectedAlert.source}</div>
                        </div>
                      </div>
                    </div>

                    {detailMessage ? <div className={`rounded-xl border px-4 py-3 text-sm ${detailMessage.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{detailMessage.text}</div> : null}
                  </div>

                  <aside className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3">
                      <div>
                        <div className="text-sm font-bold text-zinc-900">Asset Findings</div>
                        <div className="mt-1 text-xs text-zinc-500">Other recent issues on this same asset.</div>
                      </div>
                      {relatedAlerts.length > 0 ? <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-zinc-700 shadow-sm">{relatedAlerts.length}</span> : null}
                    </div>
                    <div className="mt-4 space-y-3">
                      {relatedAlertsLoading ? <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Loading related findings...</div> : null}
                      {!relatedAlertsLoading && relatedAlerts.length === 0 ? <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-500">No additional findings on this asset.</div> : null}
                      {relatedAlerts.map((item) => (
                        <div key={item.id} className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                          <div className="flex items-start gap-3">
                            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${renderSeverityDotClassName(item as AlertRecord)}`} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold text-zinc-900">{item.title}</div>
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${renderAlertStatusClassName(item as AlertRecord)}`}>{renderAlertStatusLabel(item as AlertRecord)}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${renderSourceBadgeClassName(item.source)}`}>{renderSourceIcon(item.source, 'h-3 w-3')}{renderSourceLabel(item.source)}</span>
                                <span>{formatRelativeTime(item.createdAt)}</span>
                              </div>
                              <div className="mt-2 line-clamp-3 text-sm text-zinc-600">{item.detail || 'No detail provided.'}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </aside>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[420px] items-center justify-center p-8 text-center text-sm text-zinc-500">
                Select an alert to inspect the asset context and actions.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}