import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Bell, ClipboardList, LayoutDashboard, MessageSquare, ShieldCheck, Users, UserRound, BarChart3, CircleDot } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { getStoredSession } from '../../lib/session';

const ANNOUNCEMENTS_UPDATED_EVENT = 'itms:announcements-updated';

interface ListResponse<TItem> {
  items?: TItem[];
  total?: number;
  summary?: {
    pending?: number;
    inProgress?: number;
    resolved?: number;
    enrollment?: number;
    pendingEnrollment?: number;
  };
}

interface AuditRecord {
  id: string;
  action: string;
  createdAt: string;
  actor?: {
    fullName?: string | null;
    email?: string | null;
  } | null;
}

interface AssetResponse {
  devices?: Array<unknown>;
  items?: Array<unknown>;
}

interface SimpleItem {
  id: string;
  title?: string;
  name?: string;
  full_name?: string;
  fullName?: string;
  email?: string;
  createdAt?: string;
  status?: string;
  severity?: string;
  kind?: string;
}

interface DashboardCard {
  label: string;
  value: number;
  icon: typeof ShieldCheck;
  href: string;
}

interface DashboardSection {
  title: string;
  items: SimpleItem[];
  href: string;
  kind: 'default' | 'chat' | 'user';
}

interface ChatTicketSummaryItem {
  id: string;
  fullName: string;
  total: number;
  open: number;
  resolved: number;
}

function formatWhen(value?: string) {
  if (!value) {
    return 'Just now';
  }

  return new Date(value).toLocaleString();
}

function formatRelativeWhen(value?: string) {
  if (!value) {
    return 'Just now';
  }

  const deltaMs = Date.now() - new Date(value).getTime();
  const deltaMinutes = Math.max(0, Math.round(deltaMs / 60000));
  if (deltaMinutes < 1) {
    return 'Just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  return `${Math.round(deltaHours / 24)}d ago`;
}

export default function DashboardPage() {
  const location = useLocation();
  const portal = location.pathname.match(/^\/(admin|it|emp)(?:\/|$)/)?.[1] || 'emp';
  const basePath = `/${portal}`;
  const session = getStoredSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usersTotal, setUsersTotal] = useState(0);
  const [requestsTotal, setRequestsTotal] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [inProgressRequests, setInProgressRequests] = useState(0);
  const [resolvedRequests, setResolvedRequests] = useState(0);
  const [announcementsTotal, setAnnouncementsTotal] = useState(0);
  const [chatTotal, setChatTotal] = useState(0);
  const [assetsTotal, setAssetsTotal] = useState(0);
  const [gatepassTotal, setGatepassTotal] = useState(0);
  const [recentRequests, setRecentRequests] = useState<SimpleItem[]>([]);
  const [recentAnnouncements, setRecentAnnouncements] = useState<SimpleItem[]>([]);
  const [recentChats, setRecentChats] = useState<SimpleItem[]>([]);
  const [recentUsers, setRecentUsers] = useState<SimpleItem[]>([]);
  const [recentLogins, setRecentLogins] = useState<AuditRecord[]>([]);
  const [chatTicketSummary, setChatTicketSummary] = useState<ChatTicketSummaryItem[]>([]);
  const [activeNow, setActiveNow] = useState(() => new Date());

  const loadDashboard = useMemo(() => {
    return async (cancelledRef?: { cancelled: boolean }) => {
      try {
        setLoading(true);
        setError('');

        if (portal === 'emp') {
          const [assetsData, requestsData, announcementsData, chatData] = await Promise.all([
            apiRequest<AssetResponse>('/api/me/assets'),
            apiRequest<ListResponse<SimpleItem>>('/api/me/requests?paginate=1&page=1&page_size=5'),
            apiRequest<ListResponse<SimpleItem>>('/api/announcements?paginate=1&page=1&page_size=5'),
            apiRequest<ListResponse<SimpleItem>>('/api/chat/channels?paginate=1&page=1&page_size=5'),
          ]);

          if (cancelledRef?.cancelled) {
            return;
          }

            const requestItems = requestsData.items ?? [];
            const announcementItems = announcementsData.items ?? [];
            const chatItems = chatData.items ?? [];

          setAssetsTotal((assetsData.devices?.length || 0) + (assetsData.items?.length || 0));
          setRequestsTotal(requestsData.total || 0);
            setPendingRequests(requestsData.summary?.pending || requestItems.filter((item) => item.status === 'pending').length || 0);
            setInProgressRequests(requestsData.summary?.inProgress || requestItems.filter((item) => item.status === 'in_progress').length || 0);
            setResolvedRequests(requestsData.summary?.resolved || requestItems.filter((item) => item.status === 'resolved').length || 0);
          setAnnouncementsTotal(announcementsData.total || 0);
          setChatTotal(chatData.total || 0);
            setRecentRequests(requestItems);
            setRecentAnnouncements(announcementItems);
            setRecentChats(chatItems);
          return;
        }

        const [usersData, requestsData, announcementsData, chatData, gatepassData, auditData, chatTicketData] = await Promise.all([
          apiRequest<ListResponse<SimpleItem>>('/api/users?paginate=1&page=1&page_size=5'),
          apiRequest<ListResponse<SimpleItem>>('/api/requests?paginate=1&page=1&page_size=5'),
          apiRequest<ListResponse<SimpleItem>>('/api/announcements?paginate=1&page=1&page_size=5'),
          apiRequest<ListResponse<SimpleItem>>('/api/chat/channels?paginate=1&page=1&page_size=5'),
          apiRequest<ListResponse<SimpleItem>>('/api/gatepass?paginate=1&page=1&page_size=1'),
          apiRequest<{ items?: AuditRecord[] }>('/api/audit?paginate=1&page=1&page_size=4&action=login&module=access'),
          portal === 'admin' ? apiRequest<{ items?: ChatTicketSummaryItem[] }>('/api/chat/tickets/summary').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        ]);

        if (cancelledRef?.cancelled) {
          return;
        }

        const userItems = usersData.items ?? [];
        const requestItems = requestsData.items ?? [];
        const announcementItems = announcementsData.items ?? [];
        const chatItems = chatData.items ?? [];
        const auditItems = auditData.items ?? [];
        const chatTicketItems = chatTicketData.items ?? [];

        setUsersTotal(usersData.total || 0);
        setRequestsTotal(requestsData.total || 0);
        setPendingRequests(requestsData.summary?.pending || 0);
        setInProgressRequests(requestsData.summary?.inProgress || 0);
        setResolvedRequests(requestsData.summary?.resolved || 0);
        setAnnouncementsTotal(announcementsData.total || 0);
        setChatTotal(chatData.total || 0);
        setGatepassTotal(gatepassData.total || 0);
        setRecentRequests(requestItems);
        setRecentAnnouncements(announcementItems);
        setRecentChats(chatItems);
        setRecentUsers(userItems);
        setRecentLogins(auditItems);
        setChatTicketSummary(chatTicketItems);
      } catch (requestError) {
        if (!cancelledRef?.cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load dashboard');
        }
      } finally {
        if (!cancelledRef?.cancelled) {
          setLoading(false);
        }
      }
    };
  }, [portal]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setActiveNow(new Date()), 60000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const cancelledRef = { cancelled: false };

    void loadDashboard(cancelledRef);

    const handleAnnouncementUpdate = () => {
      void loadDashboard(cancelledRef);
    };

    window.addEventListener(ANNOUNCEMENTS_UPDATED_EVENT, handleAnnouncementUpdate);

    return () => {
      cancelledRef.cancelled = true;
      window.removeEventListener(ANNOUNCEMENTS_UPDATED_EVENT, handleAnnouncementUpdate);
    };
  }, [loadDashboard]);

  const cards = useMemo<DashboardCard[]>(() => {
    if (portal === 'emp') {
      return [
        { label: 'My Requests', value: requestsTotal, icon: ClipboardList, href: `${basePath}/requests` },
        { label: 'My Assets', value: assetsTotal, icon: ShieldCheck, href: `${basePath}/assets` },
        { label: 'Chat Channels', value: chatTotal, icon: MessageSquare, href: `${basePath}/chat` },
        { label: 'Announcements', value: announcementsTotal, icon: Bell, href: `${basePath}/announcements` },
      ];
    }

    return [
      { label: 'Open Requests', value: requestsTotal, icon: ClipboardList, href: `${basePath}/requests` },
      { label: 'Gatepasses', value: gatepassTotal, icon: ClipboardList, href: `${basePath}/gatepass` },
      { label: 'Chat Channels', value: chatTotal, icon: MessageSquare, href: `${basePath}/chat` },
      { label: 'Users', value: usersTotal, icon: Users, href: `${basePath}/users` },
    ];
  }, [announcementsTotal, assetsTotal, basePath, chatTotal, gatepassTotal, portal, requestsTotal, usersTotal]);

  const requestChart = useMemo(() => {
    const segments = [
      { label: 'Pending', value: pendingRequests, tone: 'bg-amber-400' },
      { label: 'In Progress', value: inProgressRequests, tone: 'bg-sky-500' },
      { label: 'Resolved', value: resolvedRequests, tone: 'bg-emerald-500' },
    ];
    const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;

    return segments.map((segment) => ({
      ...segment,
      width: `${Math.max(10, Math.round((segment.value / total) * 100))}%`,
    }));
  }, [inProgressRequests, pendingRequests, resolvedRequests]);

  const requestChartTotal = pendingRequests + inProgressRequests + resolvedRequests;

  const operationsChart = useMemo(() => {
    const segments = portal === 'emp'
      ? [
          { label: 'Requests', value: requestsTotal, tone: 'bg-zinc-900' },
          { label: 'Assets', value: assetsTotal, tone: 'bg-brand-600' },
          { label: 'Chat', value: chatTotal, tone: 'bg-emerald-500' },
          { label: 'Announcements', value: announcementsTotal, tone: 'bg-amber-400' },
        ]
      : [
          { label: 'Requests', value: requestsTotal, tone: 'bg-zinc-900' },
          { label: 'Users', value: usersTotal, tone: 'bg-brand-600' },
          { label: 'Chat', value: chatTotal, tone: 'bg-emerald-500' },
          { label: 'Gatepasses', value: gatepassTotal, tone: 'bg-amber-400' },
        ];
    const max = Math.max(1, ...segments.map((segment) => segment.value));

    return segments.map((segment) => ({
      ...segment,
      height: `${Math.max(18, Math.round((segment.value / max) * 100))}%`,
    }));
  }, [announcementsTotal, assetsTotal, chatTotal, gatepassTotal, portal, requestsTotal, usersTotal]);

  const welcomeName = session?.user.fullName || 'Team Member';
  const overviewLabel = portal === 'emp' ? 'Employee Overview' : portal === 'it' ? 'IT Team Overview' : 'Super Admin Overview';
  const welcomeSubtitle = portal === 'emp'
    ? 'Keep requests, assets, chat, and announcements in one task-first view.'
    : 'Keep users, requests, gatepasses, chat channels, and core records in one task-first view.';

  const sections: DashboardSection[] = portal === 'emp'
    ? [
        { title: 'Requests', items: recentRequests, href: `${basePath}/requests`, kind: 'default' },
        { title: 'Chat Channels', items: recentChats, href: `${basePath}/chat`, kind: 'chat' },
        { title: 'Announcements', items: recentAnnouncements, href: `${basePath}/announcements`, kind: 'default' },
      ]
    : [
        { title: 'Chat Channels', items: recentChats, href: `${basePath}/chat`, kind: 'chat' },
        { title: 'Users', items: recentUsers, href: `${basePath}/users`, kind: 'user' },
        { title: 'Requests', items: recentRequests, href: `${basePath}/requests`, kind: 'default' },
      ];

  const showLoginPanel = portal !== 'emp';
  const workspaceStats = portal === 'emp'
    ? [
        { label: 'My Requests', value: requestsTotal, hint: 'All requests visible to your account', tone: 'text-brand-700' },
        { label: 'My Assets', value: assetsTotal, hint: 'Assigned hardware and stock', tone: 'text-amber-700' },
        { label: 'Chat Channels', value: chatTotal, hint: 'Support chats you can join', tone: 'text-emerald-700' },
      ]
    : [
        { label: 'Total Users', value: usersTotal, hint: 'Visible user records across the portal', tone: 'text-brand-700' },
        { label: 'Open Requests', value: pendingRequests + inProgressRequests, hint: 'Requests needing active handling', tone: 'text-zinc-900' },
        { label: 'Gatepasses', value: gatepassTotal, hint: 'Current gatepass volume', tone: 'text-amber-700' },
      ];

  const getSectionItemTitle = (item: SimpleItem, kind: DashboardSection['kind']) => {
    if (kind === 'user') {
      return item.fullName || item.full_name || item.name || item.title || item.email || 'Untitled user';
    }
    return item.title || item.name || item.fullName || item.full_name || 'Untitled item';
  };

  const getSectionItemMeta = (item: SimpleItem, kind: DashboardSection['kind']) => {
    if (kind === 'chat') {
      return item.kind ? `${item.kind} chat channel` : 'Chat channel';
    }
    if (kind === 'user') {
      return item.email || item.status || 'User record';
    }
    const summary = item.status || item.severity || 'Info';
    return item.createdAt ? `${summary} • ${formatWhen(item.createdAt)}` : summary;
  };

  const cardsGridClass = cards.length >= 5 ? 'xl:grid-cols-5' : cards.length === 3 ? 'xl:grid-cols-3' : 'xl:grid-cols-4';

  const requestMixSummary = [
    { label: 'Pending', value: pendingRequests, helper: 'New or waiting for review', tone: 'bg-amber-400' },
    { label: 'In Progress', value: inProgressRequests, helper: 'Currently handled by IT', tone: 'bg-sky-500' },
    { label: 'Resolved', value: resolvedRequests, helper: 'Closed successfully', tone: 'bg-emerald-500' },
  ];

  const employeeSnapshot = [
    { label: 'My Requests', value: requestsTotal, helper: 'All employee request items', tone: 'bg-brand-600' },
    { label: 'My Assets', value: assetsTotal, helper: 'Assigned devices and stock', tone: 'bg-amber-400' },
    { label: 'Chat', value: chatTotal, helper: 'Available support channels', tone: 'bg-emerald-500' },
    { label: 'Announcements', value: announcementsTotal, helper: 'Latest visible company updates', tone: 'bg-zinc-900' },
  ];

  const employeeSnapshotTotal = employeeSnapshot.reduce((sum, item) => sum + item.value, 0) || 1;

  const employeeSnapshotChart = employeeSnapshot.map((item) => ({
    ...item,
    width: `${Math.max(10, Math.round((item.value / employeeSnapshotTotal) * 100))}%`,
  }));

  const dashboardSnapshot = portal === 'emp'
    ? []
    : [
        { label: 'Total Users', value: usersTotal, helper: 'Visible user records', tone: 'bg-brand-600' },
        { label: 'Open Requests', value: pendingRequests + inProgressRequests, helper: 'Pending and active work', tone: 'bg-zinc-900' },
        { label: 'Gatepasses', value: gatepassTotal, helper: 'Total gatepass records', tone: 'bg-zinc-900' },
        { label: 'Chat Channels', value: chatTotal, helper: 'Latest visible chat channels', tone: 'bg-emerald-500' },
        { label: 'Announcements', value: announcementsTotal, helper: 'Broadcast items visible now', tone: 'bg-amber-400' },
        { label: 'Users', value: usersTotal, helper: 'Directory records shown now', tone: 'bg-sky-500' },
      ];

  const dashboardSnapshotTotal = dashboardSnapshot.reduce((sum, item) => sum + item.value, 0) || 1;

  const dashboardSnapshotChart = dashboardSnapshot.map((item) => ({
    ...item,
    width: `${Math.max(10, Math.round((item.value / dashboardSnapshotTotal) * 100))}%`,
  }));

  return (
    <div className="space-y-8 px-4 py-6 xl:px-6">
      <section className="overflow-hidden rounded-[30px] border border-zinc-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.10),_transparent_24%),linear-gradient(135deg,_#fcfcfd_0%,_#ffffff_48%,_#f2f7ff_100%)] px-6 py-8 lg:px-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_360px]">
            <div className="space-y-5">
              <div className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-brand-700">
                <LayoutDashboard className="mr-2 h-3.5 w-3.5" />
                ITMS Overview
              </div>
              <div className="inline-flex items-center rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 shadow-sm">
                <UserRound className="mr-2 h-4 w-4 text-brand-600" />
                Welcome {welcomeName}
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-black tracking-tight text-zinc-950 sm:text-4xl">{overviewLabel}</h1>
                <p className="max-w-3xl text-sm leading-6 text-zinc-600 sm:text-base">{welcomeSubtitle}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link to={`${basePath}/requests`} className="rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-zinc-800">Open Requests</Link>
                {portal !== 'emp' ? <Link to={`${basePath}/users`} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50">Open Users</Link> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {workspaceStats.map((stat) => (
                  <div key={stat.label} className="min-h-[132px] rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">{stat.label}</div>
                    <div className={`mt-4 text-3xl font-black ${stat.tone}`}>{loading ? '...' : stat.value}</div>
                    <div className="mt-2 text-sm leading-5 text-zinc-500">{stat.hint}</div>
                  </div>
                ))}
              </div>
            </div>

            <aside className="grid gap-4 self-start">
              <div className="rounded-[26px] border border-zinc-200 bg-zinc-950 p-5 text-white shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300">Workspace Pulse</div>
                    <div className="mt-1 text-lg font-black">Live Overview</div>
                  </div>
                  <BarChart3 className="h-5 w-5 text-sky-300" />
                </div>
                <div className="mt-5 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">Request Status Mix</div>
                    <div className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-200">{loading ? '...' : `${requestChartTotal} total`}</div>
                  </div>
                  <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-white/10">
                    {requestChart.map((segment) => (
                      <div key={segment.label} className={segment.tone} style={{ width: segment.width }} />
                    ))}
                  </div>
                  <div className="mt-4 space-y-3">
                    {requestMixSummary.map((segment) => (
                      <div key={segment.label} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-3 ring-1 ring-white/10">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-200">
                            <span className={`h-2.5 w-2.5 rounded-full ${segment.tone}`} />
                            {segment.label}
                          </div>
                          <div className="mt-1 text-xs text-zinc-400">{segment.helper}</div>
                        </div>
                        <div className="text-right text-xl font-black text-white">{loading ? '...' : segment.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">Active Session</div>
                    <div className="mt-1 text-sm font-semibold text-white">{welcomeName}</div>
                  </div>
                  <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/20">{activeNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

      <div className={`grid gap-4 sm:grid-cols-2 ${cardsGridClass}`}>
        {cards.map((card) => (
          <Link key={card.label} to={card.href} className="flex min-h-[152px] flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:bg-brand-50/30">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{card.label}</div>
              <card.icon className="h-5 w-5 text-brand-600" />
            </div>
            <div className="mt-4 text-3xl font-black text-zinc-950">{loading ? '...' : card.value}</div>
            <div className="mt-2 text-sm text-zinc-500">{card.label === 'Gatepasses' ? 'Review total gatepass activity.' : card.label === 'Chat Channels' ? 'Open the latest visible chat channels.' : card.label === 'Users' ? 'Review visible user records and profiles.' : card.label === 'Pending Requests' ? 'Track queue backlog and follow-up work.' : 'Open the latest records in this area.'}</div>
            <div className="mt-auto pt-4 inline-flex items-center text-xs font-bold uppercase tracking-wider text-brand-700">Open <ArrowRight className="ml-1 h-3.5 w-3.5" /></div>
          </Link>
        ))}
      </div>

      <div className={`grid gap-6 ${showLoginPanel ? 'xl:grid-cols-[minmax(0,1.2fr)_420px]' : 'xl:grid-cols-1'}`}>
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Charts Snapshot</div>
              <h2 className="mt-1 text-xl font-black text-zinc-950">{portal === 'emp' ? 'Employee Snapshot' : 'Dashboard Order Snapshot'}</h2>
              <p className="mt-1 text-sm text-zinc-500">{portal === 'emp' ? 'Requests, assets, chat, and announcements follow the same task-first rhythm as the updated admin and IT views.' : 'Users, requests, gatepasses, chat channels, and records now follow one consistent dashboard order.'}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div className="rounded-2xl bg-zinc-950 p-5 text-white">
              {portal === 'emp' ? (
                <>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">Priority Order</div>
                  <div className="mt-4 flex h-5 overflow-hidden rounded-full bg-white/10">
                    {employeeSnapshotChart.map((segment) => (
                      <div key={segment.label} className={segment.tone} style={{ width: segment.width }} />
                    ))}
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {employeeSnapshot.map((segment) => (
                      <div key={segment.label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">
                          <CircleDot className="h-3.5 w-3.5" />
                          {segment.label}
                        </div>
                        <div className="mt-3 text-3xl font-black text-white">{loading ? '...' : segment.value}</div>
                        <div className="mt-1 text-xs text-zinc-400">{segment.helper}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">Priority Order</div>
                  <div className="mt-4 flex h-5 overflow-hidden rounded-full bg-white/10">
                    {dashboardSnapshotChart.map((segment) => (
                      <div key={segment.label} className={segment.tone} style={{ width: segment.width }} />
                    ))}
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {dashboardSnapshot.map((segment) => (
                      <div key={segment.label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">
                          <CircleDot className="h-3.5 w-3.5" />
                          {segment.label}
                        </div>
                        <div className="mt-3 text-3xl font-black text-white">{loading ? '...' : segment.value}</div>
                        <div className="mt-1 text-xs text-zinc-400">{segment.helper}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-[linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] p-5">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">{portal === 'emp' ? 'Operations Volume' : 'Ordered Volume Bars'}</div>
              <div className={`mt-4 grid h-56 items-end gap-4 ${portal === 'emp' ? 'grid-cols-4' : 'grid-cols-6'}`}>
                {(portal === 'emp' ? operationsChart : dashboardSnapshot.map((segment) => ({
                  ...segment,
                  height: `${Math.max(18, Math.round((segment.value / Math.max(1, ...dashboardSnapshot.map((item) => item.value))) * 100))}%`,
                }))).map((segment) => (
                  <div key={segment.label} className="flex h-full flex-col items-center justify-end gap-2">
                    <div className="text-xs font-black text-zinc-700">{loading ? '...' : segment.value}</div>
                    <div className={`w-full rounded-t-[20px] shadow-[0_12px_24px_rgba(15,23,42,0.12)] ${segment.tone}`} style={{ height: segment.height }} />
                    <div className="text-center text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">{segment.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {showLoginPanel ? (
          <div className="space-y-6">
            {portal === 'admin' ? (
              <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Closed Chat Tickets</div>
                    <h2 className="mt-1 text-xl font-black text-zinc-950">IT Owner Load</h2>
                    <p className="mt-1 text-sm text-zinc-500">Track how many closed-chat tickets are currently assigned to each IT owner.</p>
                  </div>
                  <div className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-700">Live</div>
                </div>
                <div className="mt-5 space-y-3">
                  {loading ? <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-500">Loading ticket ownership summary...</div> : null}
                  {!loading && chatTicketSummary.length === 0 ? <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-500">No closed chat tickets have been assigned yet.</div> : null}
                  {!loading ? chatTicketSummary.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-black text-zinc-950">{item.fullName}</div>
                          <div className="mt-1 text-xs text-zinc-500">{item.open} open from closed chats • {item.resolved} resolved</div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-black text-zinc-950">{item.total}</div>
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Total Tickets</div>
                        </div>
                      </div>
                    </div>
                  )) : null}
                </div>
              </section>
            ) : null}

            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Recent Sign-ins</div>
                  <h2 className="mt-1 text-xl font-black text-zinc-950">Access Activity</h2>
                  <p className="mt-1 text-sm text-zinc-500">Latest successful sign-ins visible in the audit stream.</p>
                </div>
                <div className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-700">Audit</div>
              </div>
              <div className="mt-5 space-y-3">
                {loading ? <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-500">Loading sign-in activity...</div> : null}
                {!loading && recentLogins.length === 0 ? <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-500">No recent login activity found.</div> : null}
                {!loading && recentLogins.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-zinc-950">{entry.actor?.fullName || 'Unknown user'}</div>
                        <div className="mt-1 text-xs text-zinc-500">{entry.actor?.email || 'No employee ID available'}</div>
                        <div className="mt-2 text-xs text-zinc-500">{formatWhen(entry.createdAt)}</div>
                      </div>
                      <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">{formatRelativeWhen(entry.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {sections.map((section) => (
          <section key={section.title} className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-zinc-950">{section.title}</h2>
                <p className="mt-1 text-sm text-zinc-500">Latest visible activity for this portal.</p>
              </div>
              <Link to={section.href} className="text-sm font-bold text-brand-700 hover:text-brand-800">Open</Link>
            </div>
            <div className="divide-y divide-zinc-100">
              {loading ? <div className="px-5 py-8 text-sm text-zinc-500">Loading...</div> : null}
              {!loading && section.items.length === 0 ? <div className="px-5 py-8 text-sm text-zinc-500">No recent items.</div> : null}
              {!loading && section.items.map((item) => (
                <Link key={item.id} to={section.href} className="block px-5 py-4 transition hover:bg-zinc-50">
                  <div className="text-sm font-semibold text-zinc-900">{getSectionItemTitle(item, section.kind)}</div>
                  <div className="mt-1 text-xs text-zinc-500">{getSectionItemMeta(item, section.kind)}</div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}