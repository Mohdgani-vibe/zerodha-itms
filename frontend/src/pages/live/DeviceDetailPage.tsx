import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Cpu, HardDrive, MonitorSmartphone, Package, Play, ShieldCheck, TerminalSquare } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { getStoredSession } from '../../lib/session';
import ConfirmDialog from '../../components/ConfirmDialog';

interface DeviceDetailNavigationState {
  enrollmentApprovalMessage?: string;
  approvedRequestId?: string;
}

interface EnrollmentRequestComment {
  id: string;
  author: string;
  note: string;
  createdAt: string;
}

interface EnrollmentRequestRecord {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  notes: string;
  updatedAt: string;
  assignee: { fullName?: string };
  comments: EnrollmentRequestComment[];
}

interface ApiUserRecord {
  id: string;
  full_name: string;
  email: string;
  emp_id: string;
  status: string;
  role?: string;
}

interface PaginatedUsersResponse {
  items: ApiUserRecord[];
  total: number;
  page: number;
  pageSize: number;
}

interface AssignableUserRecord {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string;
  status: string;
}

interface DeviceRecord {
  id: string;
  assetId: string;
  hostname: string;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  deviceType?: string | null;
  osName?: string | null;
  osVersion?: string | null;
  processor?: string | null;
  memory?: string | null;
  storage?: string | null;
  gpu?: string | null;
  display?: string | null;
  macAddress?: string | null;
  architecture?: string | null;
  biosVersion?: string | null;
  kernelVersion?: string | null;
  osBuild?: string | null;
  lastBootAt?: string | null;
  lastSeenAt?: string | null;
  status: string;
  patchStatus: string;
  alertStatus: string;
  complianceScore: number;
  warrantyExpiresAt?: string | null;
  user?: { id: string; fullName: string; email: string; employeeCode: string } | null;
  department?: { name: string } | null;
  branch?: { name: string } | null;
  installedApps?: Array<{ id: string; name: string; version?: string | null; publisher?: string | null }>;
  toolStatus?: ToolStatusMap;
}

interface AlertRecord {
  id: string;
  source: string;
  severity: string;
  title: string;
  detail: string;
  acknowledged: boolean;
  resolved: boolean;
  createdAt: string;
}

interface PatchJob {
  id: string;
  jid: string;
  status: string;
  scope: string;
  createdAt: string;
  updatedAt: string;
}

interface TerminalSessionRecord {
  id: string;
  deviceId: string;
  status: string;
  createdAt: string;
  requestedBy: string;
}

interface ToolStatusEntry {
  status: 'linked' | 'detected' | 'installed' | 'missing';
  detail: string;
  identifier?: string | null;
  connected?: boolean;
}

interface ToolStatusMap {
  salt?: ToolStatusEntry;
  wazuh?: ToolStatusEntry;
  openscap?: ToolStatusEntry;
  clamav?: ToolStatusEntry;
}

interface InstallAgentConfig {
  saltApiConfigured: boolean;
  portalInstallReady: boolean;
}

interface PendingAssetAction {
  kind: 'unassign' | 'delete';
}

function isPatchJobForDevice(job: PatchJob, device: DeviceRecord) {
  const scope = job.scope.trim().toLowerCase();
  const candidates = [
    device.hostname,
    device.assetId,
    device.toolStatus?.salt?.identifier || '',
  ]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return candidates.includes(scope);
}

function formatDate(value?: string | null) {
  if (!value) {
    return 'Not available';
  }

  return new Date(value).toLocaleString();
}

function isComputeAsset(device: DeviceRecord) {
  const kind = (device.deviceType || '').toLowerCase();
  return ['laptop', 'desktop', 'workstation', 'server'].some((value) => kind.includes(value)) || Boolean(device.osName);
}

function formatDetailValue(value?: string | null, fallback = 'Not reported') {
  if (!value) {
    return fallback;
  }

  return value;
}

function severityBadgeClassName(severity: string) {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
    case 'high':
      return 'bg-red-100 text-red-700';
    case 'medium':
    case 'warning':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-sky-100 text-sky-700';
  }
}

const dedicatedSecuritySources = new Set(['wazuh', 'clamav', 'openscap']);

function inferPlatform(osName?: string | null) {
  const normalized = (osName || '').toLowerCase();
  if (normalized.includes('windows')) {
    return 'Windows';
  }
  if (normalized.includes('ubuntu') || normalized.includes('linux')) {
    return 'Linux';
  }
  if (normalized.includes('mac')) {
    return 'macOS';
  }

  return 'Unknown platform';
}

function parseEnrollmentDetails(description: string) {
  return description
    .split('\n')
    .map((line) => line.trim())
    .reduce<Record<string, string>>((details, line) => {
      const separator = line.indexOf(':');
      if (separator <= 0) {
        return details;
      }

      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (value) {
        details[key] = value;
      }
      return details;
    }, {});
}

function formatStatusLabel(status: string) {
  return status.replaceAll('_', ' ');
}

function normalizeAssignableUsers(data: ApiUserRecord[]): AssignableUserRecord[] {
  return data
    .filter((user) => user.role !== 'super_admin')
    .map((user) => ({
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    employeeCode: user.emp_id,
    status: user.status,
  }));
}

function dedupeAssignableUsers(data: AssignableUserRecord[]) {
  const seen = new Map<string, AssignableUserRecord>();
  data.forEach((user) => {
    if (!seen.has(user.id)) {
      seen.set(user.id, user);
    }
  });
  return Array.from(seen.values());
}

interface SecurityFindingsPanelProps {
  title: string;
  description: string;
  alerts: AlertRecord[];
  loading: boolean;
  emptyMessage: string;
  onSelectAlert: (alert: AlertRecord) => void;
}

function SecurityFindingsPanel({ title, description, alerts, loading, emptyMessage, onSelectAlert }: SecurityFindingsPanelProps) {
  const latestAlert = alerts[0] ?? null;

  return <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center text-sm font-bold uppercase tracking-wider text-zinc-500">
        <ShieldCheck className="mr-2 h-4 w-4 text-brand-600" /> {title}
      </div>
      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-bold text-zinc-700">{alerts.length} recent</span>
    </div>
    <p className="mt-2 text-sm text-zinc-500">{description}</p>
    <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Latest Finding</div>
      <div className="mt-2 text-sm font-semibold text-zinc-900">{latestAlert?.title || `No recent ${title.toLowerCase()}`}</div>
      <div className="mt-1 text-xs text-zinc-500">{latestAlert ? formatDate(latestAlert.createdAt) : 'No timestamp available'}</div>
    </div>
    <div className="mt-4 space-y-3">
      {loading ? <div className="text-sm text-zinc-500">Loading {title.toLowerCase()}...</div> : null}
      {!loading && alerts.length === 0 ? <div className="rounded-xl bg-zinc-50 px-3 py-4 text-sm text-zinc-500">{emptyMessage}</div> : null}
      {alerts.slice(0, 4).map((alert) => (
        <button key={alert.id} type="button" onClick={() => onSelectAlert(alert)} className="block w-full rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-left transition hover:border-zinc-200 hover:shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900">{alert.title}</div>
              <div className="mt-1 text-xs text-zinc-500">{formatDate(alert.createdAt)}</div>
            </div>
            <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${severityBadgeClassName(alert.severity)}`}>
              {alert.severity}
            </span>
          </div>
          <div className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-zinc-600">{alert.detail}</div>
          <div className="mt-2 text-xs font-medium text-zinc-400">Click for full details</div>
        </button>
      ))}
    </div>
  </div>;
}

function alertSourceLabel(source: string) {
  switch ((source || '').toLowerCase()) {
    case 'openscap':
      return 'OpenSCAP Hardening';
    case 'clamav':
      return 'ClamAV';
    case 'wazuh':
      return 'Wazuh';
    case 'patch':
      return 'Patch';
    case 'terminal':
      return 'Terminal';
    default:
      return source || 'Unknown source';
  }
}

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.split('/devices')[0];
  const session = getStoredSession();
  const canOperate = session?.user.role.toLowerCase() !== 'employee';
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [patchJobs, setPatchJobs] = useState<PatchJob[]>([]);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [runningPatch, setRunningPatch] = useState(false);
  const [startingTerminal, setStartingTerminal] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [enrollmentRequest, setEnrollmentRequest] = useState<EnrollmentRequestRecord | null>(null);
  const [installConfig, setInstallConfig] = useState<InstallAgentConfig | null>(null);
  const [installConfigLoading, setInstallConfigLoading] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUserRecord[]>([]);
  const [assignmentUsersLoading, setAssignmentUsersLoading] = useState(false);
  const [assignmentSearchQuery, setAssignmentSearchQuery] = useState('');
  const [selectedAssignmentUserId, setSelectedAssignmentUserId] = useState('');
  const [assigningDevice, setAssigningDevice] = useState(false);
  const [assetActionLoading, setAssetActionLoading] = useState(false);
  const [pendingAssetAction, setPendingAssetAction] = useState<PendingAssetAction | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<AlertRecord | null>(null);
  const alertCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const alertDialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const navigationState = (location.state ?? null) as DeviceDetailNavigationState | null;

  const loadDeviceDetails = async (showLoading = true) => {
    if (!id) {
      return;
    }

    try {
      if (showLoading) {
        setLoading(true);
      }
      setError('');
      const data = await apiRequest<DeviceRecord>(`/api/devices/${id}`);
      setDevice(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load device details');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (navigationState?.enrollmentApprovalMessage) {
      setSuccessMessage(navigationState.enrollmentApprovalMessage);
    }
  }, [navigationState?.enrollmentApprovalMessage]);

  useEffect(() => {
    if (!selectedAlert) {
      return;
    }

    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    alertCloseButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedAlert(null);
        return;
      }

      if (event.key !== 'Tab' || !alertDialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        alertDialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      lastFocusedElementRef.current?.focus();
    };
  }, [selectedAlert]);

  useEffect(() => {
    let cancelled = false;

    const loadDevice = async () => {
      if (!id) {
        return;
      }

      try {
        setLoading(true);
        setError('');
        const data = await apiRequest<DeviceRecord>(`/api/devices/${id}`);
        if (!cancelled) {
          setDevice(data);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load device details');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDevice();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id || !device) {
      return;
    }

    if (!isComputeAsset(device)) {
      setAlerts([]);
      setPatchJobs([]);
      setTerminalSessions([]);
      setSidebarLoading(false);
      return;
    }

    let cancelled = false;

    const loadSidebarData = async () => {
      try {
        setSidebarLoading(true);
        const [deviceAlerts, allPatchJobs, sessions] = await Promise.all([
          apiRequest<AlertRecord[]>(`/api/devices/${id}/alerts`),
          apiRequest<PatchJob[]>('/api/patch/jobs'),
          apiRequest<TerminalSessionRecord[]>(`/api/terminal/session?deviceId=${id}`),
        ]);
        if (cancelled) {
          return;
        }

        setAlerts(deviceAlerts);
        setPatchJobs(allPatchJobs.filter((job) => isPatchJobForDevice(job, device)).slice(0, 6));
        setTerminalSessions(sessions);
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load asset activity');
        }
      } finally {
        if (!cancelled) {
          setSidebarLoading(false);
        }
      }
    };

    void loadSidebarData();

    return () => {
      cancelled = true;
    };
  }, [device, id]);

  useEffect(() => {
    if (!canOperate) {
      setInstallConfig(null);
      return;
    }

    let cancelled = false;

    const loadInstallConfig = async () => {
      try {
        setInstallConfigLoading(true);
        const data = await apiRequest<InstallAgentConfig>('/api/integrations/install-config');
        if (!cancelled) {
          setInstallConfig(data);
        }
      } catch {
        if (!cancelled) {
          setInstallConfig(null);
        }
      } finally {
        if (!cancelled) {
          setInstallConfigLoading(false);
        }
      }
    };

    void loadInstallConfig();

    return () => {
      cancelled = true;
    };
  }, [canOperate]);

  useEffect(() => {
    if (!device || !canOperate) {
      setEnrollmentRequest(null);
      return;
    }

    let cancelled = false;

    const loadEnrollmentRequest = async () => {
      try {
        const searchValue = device.assetId.trim() || device.hostname.trim();
        const params = new URLSearchParams({ type: 'device_enrollment' });
        if (searchValue) {
          params.set('search', searchValue);
        }
        const requests = await apiRequest<EnrollmentRequestRecord[]>(`/api/requests?${params.toString()}`);
        if (cancelled) {
          return;
        }

        const assetKey = device.assetId.trim().toLowerCase();
        const hostnameKey = device.hostname.trim().toLowerCase();
        const match = requests.find((request) => {
          if (request.type !== 'device_enrollment') {
            return false;
          }
          const details = parseEnrollmentDetails(request.description || '');
          const requestKey = (details['asset tag / host'] || '').trim().toLowerCase();
          return requestKey === assetKey || requestKey === hostnameKey;
        });

        setEnrollmentRequest(match || null);
      } catch {
        if (!cancelled) {
          setEnrollmentRequest(null);
        }
      }
    };

    void loadEnrollmentRequest();

    return () => {
      cancelled = true;
    };
  }, [canOperate, device]);

  const enrollmentDetails = useMemo(
    () => (enrollmentRequest ? parseEnrollmentDetails(enrollmentRequest.description || '') : {}),
    [enrollmentRequest],
  );

  useEffect(() => {
    if (!canOperate || !device || device.user?.id?.trim()) {
      setAssignableUsers([]);
      setAssignmentSearchQuery('');
      setSelectedAssignmentUserId('');
      return;
    }

    let cancelled = false;

    const loadAssignableUsers = async () => {
      try {
        setAssignmentUsersLoading(true);
        const requesterEmail = (enrollmentDetails['requester email'] || enrollmentDetails['email'] || '').trim();
        const employeeCode = (enrollmentDetails['employee id'] || enrollmentDetails['employee code'] || '').trim();
        const requesterName = (enrollmentDetails['requester name'] || enrollmentDetails['name'] || '').trim();
        const manualQuery = assignmentSearchQuery.trim();
        const searchTerms = manualQuery
          ? [manualQuery]
          : [requesterEmail, employeeCode, requesterName].filter(Boolean);

        if (!searchTerms.length) {
          if (!cancelled) {
            setAssignableUsers([]);
          }
          return;
        }

        const uniqueTerms = Array.from(new Set(searchTerms.map((term) => term.trim()).filter(Boolean))).slice(0, 3);
        const responses = await Promise.all(uniqueTerms.map((term) => {
          const params = new URLSearchParams({
            paginate: '1',
            page: '1',
            page_size: manualQuery ? '25' : '10',
            search: term,
            exclude_role: 'super_admin',
          });
          return apiRequest<PaginatedUsersResponse>(`/api/users?${params.toString()}`);
        }));
        if (!cancelled) {
          setAssignableUsers(dedupeAssignableUsers(responses.flatMap((response) => normalizeAssignableUsers(response.items || []))));
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load assignable users');
        }
      } finally {
        if (!cancelled) {
          setAssignmentUsersLoading(false);
        }
      }
    };

    void loadAssignableUsers();

    return () => {
      cancelled = true;
    };
  }, [assignmentSearchQuery, canOperate, device, enrollmentDetails]);

  useEffect(() => {
    if (!canOperate || !device || device.user?.id?.trim()) {
      return;
    }

    const requesterEmail = (enrollmentDetails['requester email'] || enrollmentDetails['email'] || '').trim();
    const employeeCode = (enrollmentDetails['employee id'] || enrollmentDetails['employee code'] || '').trim();
    const requesterName = (enrollmentDetails['requester name'] || enrollmentDetails['name'] || '').trim();
    setAssignmentSearchQuery(requesterEmail || employeeCode || requesterName);
  }, [canOperate, device, enrollmentDetails]);

  const suggestedAssignmentUser = useMemo(() => {
    if (!assignableUsers.length) {
      return null;
    }

    const requesterEmail = (enrollmentDetails['requester email'] || enrollmentDetails['email'] || '').trim().toLowerCase();
    const employeeCode = (enrollmentDetails['employee id'] || enrollmentDetails['employee code'] || '').trim().toLowerCase();
    const requesterName = (enrollmentDetails['requester name'] || enrollmentDetails['name'] || '').trim().toLowerCase();

    if (requesterEmail) {
      const emailMatch = assignableUsers.find((user) => user.email.trim().toLowerCase() === requesterEmail);
      if (emailMatch) {
        return emailMatch;
      }
    }

    if (employeeCode) {
      const employeeMatch = assignableUsers.find((user) => user.employeeCode.trim().toLowerCase() === employeeCode);
      if (employeeMatch) {
        return employeeMatch;
      }
    }

    if (requesterName) {
      const nameMatch = assignableUsers.find((user) => user.fullName.trim().toLowerCase() === requesterName);
      if (nameMatch) {
        return nameMatch;
      }
    }

    return null;
  }, [assignableUsers, enrollmentDetails]);

  useEffect(() => {
    if (device?.user?.id?.trim()) {
      setSelectedAssignmentUserId(device.user.id.trim());
      return;
    }

    if (!assignableUsers.length) {
      setSelectedAssignmentUserId('');
      return;
    }

    if (selectedAssignmentUserId && assignableUsers.some((user) => user.id === selectedAssignmentUserId)) {
      return;
    }

    setSelectedAssignmentUserId(suggestedAssignmentUser?.id || assignableUsers[0].id);
  }, [assignableUsers, device?.user?.id, selectedAssignmentUserId, suggestedAssignmentUser]);

  const installedApps = useMemo(() => device?.installedApps ?? [], [device?.installedApps]);
  const wazuhAlerts = useMemo(() => alerts.filter((alert) => alert.source.toLowerCase() === 'wazuh'), [alerts]);
  const clamavAlerts = useMemo(() => alerts.filter((alert) => alert.source.toLowerCase() === 'clamav'), [alerts]);
  const openscapAlerts = useMemo(() => alerts.filter((alert) => alert.source.toLowerCase() === 'openscap'), [alerts]);
  const otherAlerts = useMemo(() => alerts.filter((alert) => !dedicatedSecuritySources.has(alert.source.toLowerCase())), [alerts]);
  const refreshSidebarData = async () => {
    if (!id || !device || !isComputeAsset(device)) {
      return;
    }

    const [deviceAlerts, allPatchJobs, sessions] = await Promise.all([
      apiRequest<AlertRecord[]>(`/api/devices/${id}/alerts`),
      apiRequest<PatchJob[]>('/api/patch/jobs'),
      apiRequest<TerminalSessionRecord[]>(`/api/terminal/session?deviceId=${id}`),
    ]);
    setAlerts(deviceAlerts);
    setPatchJobs(allPatchJobs.filter((job) => isPatchJobForDevice(job, device)).slice(0, 6));
    setTerminalSessions(sessions);
  };

  const handleRunPatch = async () => {
    if (!device || !isComputeAsset(device)) {
      return;
    }

    try {
      setRunningPatch(true);
      setError('');
      setSuccessMessage('');
      await apiRequest('/api/patch/run', {
        method: 'POST',
        body: JSON.stringify({ scope: device.hostname }),
      });
      await refreshSidebarData();
      setSuccessMessage(`Patch run queued for ${device.hostname}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to queue patch run');
    } finally {
      setRunningPatch(false);
    }
  };

  const handleStartTerminal = async () => {
    if (!device || !isComputeAsset(device)) {
      return;
    }

    const popup = window.open('', 'itms-terminal', 'popup=yes,width=1200,height=760,noopener,noreferrer');

    try {
      setStartingTerminal(true);
      setError('');
      setSuccessMessage('');
      if (popup) {
        popup.document.write('<title>ITMS Terminal</title><body style="font-family: sans-serif; padding: 24px; color: #18181b;">Preparing terminal session...</body>');
      }
      const session = await apiRequest<{ connection?: { url?: string } }>('/api/terminal/session', {
        method: 'POST',
        body: JSON.stringify({ deviceId: device.id }),
      });
      await refreshSidebarData();
      if (session.connection?.url) {
        if (popup) {
          popup.location.replace(session.connection.url);
          popup.focus();
        } else {
          window.open(session.connection.url, '_blank', 'noopener,noreferrer');
        }
      } else if (popup) {
        popup.document.body.innerHTML = 'Terminal session was requested, but no terminal URL is configured for this environment.';
      }
      setSuccessMessage(`Terminal session started for ${device.hostname}.`);
    } catch (requestError) {
      if (popup && !popup.closed) {
        popup.document.body.innerHTML = 'Terminal session could not be started.';
      }
      setError(requestError instanceof Error ? requestError.message : 'Failed to start terminal session');
    } finally {
      setStartingTerminal(false);
    }
  };

  const handleAssignDevice = async () => {
    if (!id || !selectedAssignmentUserId) {
      setError('Select a user before assigning this system.');
      return;
    }

    const targetUser = assignableUsers.find((user) => user.id === selectedAssignmentUserId);
    const targetHostname = device?.hostname || 'this device';

    try {
      setAssigningDevice(true);
      setError('');
      setSuccessMessage('');
      await apiRequest(`/api/assets/${id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ user_id: selectedAssignmentUserId }),
      });
      await loadDeviceDetails(false);
      setSuccessMessage(`Assigned ${targetHostname} to ${targetUser?.fullName || 'the selected user'}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to assign device');
    } finally {
      setAssigningDevice(false);
    }
  };

  const handleAssetAction = async (kind: 'unassign' | 'delete') => {
    if (!id || !device) {
      return;
    }

    try {
      setAssetActionLoading(true);
      setError('');
      setSuccessMessage('');
      await apiRequest(kind === 'delete' ? `/api/assets/${id}` : `/api/assets/${id}/unassign`, {
        method: kind === 'delete' ? 'DELETE' : 'POST',
      });
      setPendingAssetAction(null);

      if (kind === 'delete') {
        navigate(`${basePath}/devices`);
        return;
      }

      await loadDeviceDetails(false);
      setSuccessMessage(`Removed ${device.hostname} from the assigned user.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Failed to ${kind} asset`);
    } finally {
      setAssetActionLoading(false);
    }
  };

  if (loading) {
    return <div className="py-20 text-center text-sm text-zinc-500">Loading asset details...</div>;
  }

  if (!device) {
    return <div className="py-20 text-center text-sm text-rose-600">{error || 'Device not found.'}</div>;
  }

  const computeAsset = isComputeAsset(device);
  const latestEnrollmentComment = enrollmentRequest?.comments.at(-1) || null;
  const isAssigned = Boolean(device.user?.id?.trim());
  const saltIdentifier = device.toolStatus?.salt?.identifier?.trim();
  const hasSaltTarget = Boolean(saltIdentifier);
  const saltTargetConnected = device.toolStatus?.salt?.connected !== false;
  const saltApiReady = Boolean(installConfig?.saltApiConfigured);
  const terminalGatewayReady = Boolean(installConfig?.portalInstallReady);
  const canStartTerminal = canOperate && computeAsset && hasSaltTarget && saltTargetConnected && terminalGatewayReady;
  const canRunPatch = canOperate && computeAsset && hasSaltTarget && saltTargetConnected && saltApiReady;
  const terminalBlockedReason = !canOperate || !computeAsset
    ? ''
    : !hasSaltTarget
      ? 'Terminal sessions are unavailable until this asset reports a Salt minion ID.'
      : !saltTargetConnected
        ? 'Terminal sessions are unavailable because the linked Salt minion is not currently connected to the master.'
      : installConfigLoading
        ? 'Checking terminal gateway availability...'
        : !terminalGatewayReady
          ? 'Terminal sessions are unavailable because the server terminal gateway is not reachable.'
          : '';
  const patchBlockedReason = !canOperate || !computeAsset
    ? ''
    : !hasSaltTarget
      ? 'Patch runs are unavailable until this asset reports a Salt minion ID.'
      : !saltTargetConnected
        ? 'Patch runs are unavailable because the linked Salt minion is not currently connected to the master.'
      : installConfigLoading
        ? 'Checking Salt API availability...'
        : !saltApiReady
          ? 'Patch runs are unavailable because the server Salt API is not reachable.'
          : '';
  const hardwareDetails = [
    { label: 'Manufacturer', value: formatDetailValue(device.manufacturer, 'Unknown') },
    { label: 'Model', value: formatDetailValue(device.model, 'Unknown') },
    { label: 'Device Type', value: formatDetailValue(device.deviceType, 'Device') },
    { label: 'Hardware Profile', value: formatDetailValue(device.model || device.manufacturer ? [device.manufacturer, device.model].filter(Boolean).join(' ') : device.model, device.model || 'Standard managed asset') },
    { label: 'Processor', value: formatDetailValue(device.processor) },
    { label: 'GPU', value: formatDetailValue(device.gpu) },
    { label: 'Memory', value: formatDetailValue(device.memory) },
    { label: 'Storage', value: formatDetailValue(device.storage) },
    { label: 'Architecture', value: formatDetailValue(device.architecture) },
    { label: 'Serial Number', value: formatDetailValue(device.serialNumber, 'Unavailable') },
    { label: 'MAC Address', value: formatDetailValue(device.macAddress) },
    { label: 'BIOS / Firmware', value: formatDetailValue(device.biosVersion) },
    { label: 'Asset ID', value: formatDetailValue(device.assetId) },
    { label: 'Warranty', value: formatDate(device.warrantyExpiresAt) },
  ];
  const operatingSystemDetails = [
    { label: 'Platform', value: inferPlatform(device.osName) },
    { label: 'OS Name', value: formatDetailValue(device.osName, 'Unknown') },
    { label: 'OS Version', value: formatDetailValue(device.osVersion, 'Unknown') },
    { label: 'OS Build', value: formatDetailValue(device.osBuild) },
    { label: 'Kernel Version', value: formatDetailValue(device.kernelVersion) },
    { label: 'Display', value: formatDetailValue(device.display) },
    { label: 'Hostname', value: formatDetailValue(device.hostname) },
    { label: 'Installed Software', value: `${installedApps.length}` },
    { label: 'Status', value: formatDetailValue(device.status) },
    { label: 'Last Boot', value: formatDate(device.lastBootAt) },
    { label: 'Last Seen', value: formatDate(device.lastSeenAt) },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 xl:px-6">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => navigate(-1)} className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{device.hostname}</h1>
          <p className="mt-1 text-sm text-zinc-500">{device.assetId} • {device.deviceType || 'Device'}{computeAsset ? ` • ${device.osName || 'Unknown OS'}` : ''}</p>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
      {successMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{successMessage}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Status', value: device.status, icon: MonitorSmartphone },
          ...(computeAsset
            ? [
                { label: 'Patch Status', value: device.patchStatus.replaceAll('_', ' '), icon: Package },
                { label: 'Alert Status', value: device.alertStatus, icon: ShieldCheck },
                { label: 'Compliance', value: `${device.complianceScore}%`, icon: Activity },
              ]
            : [
                { label: 'Asset Type', value: device.deviceType || 'Accessory', icon: Package },
                { label: 'Assigned To', value: device.user?.fullName || 'Unassigned', icon: ShieldCheck },
                { label: 'Warranty', value: formatDate(device.warrantyExpiresAt), icon: Activity },
              ]),
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{card.label}</span>
              <card.icon className="h-4 w-4 text-brand-600" />
            </div>
            <div className="text-xl font-bold text-zinc-900">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-zinc-900">{computeAsset ? 'GLPI-style Asset Overview' : 'Asset Overview'}</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                <div className="mb-2 flex items-center text-xs font-bold uppercase tracking-wider text-zinc-500">
                  <Cpu className="mr-2 h-4 w-4" /> {computeAsset ? 'Hardware' : 'Inventory'}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-sm text-zinc-700">
                  {hardwareDetails.map((detail) => (
                    <div key={detail.label}>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{detail.label}</div>
                      <div className="mt-1 font-medium text-zinc-900">{detail.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                <div className="mb-2 flex items-center text-xs font-bold uppercase tracking-wider text-zinc-500">
                  <HardDrive className="mr-2 h-4 w-4" /> {computeAsset ? 'Operating System' : 'Location & Assignment'}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-sm text-zinc-700">
                  {computeAsset ? operatingSystemDetails.map((detail) => (
                    <div key={detail.label}>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{detail.label}</div>
                      <div className="mt-1 font-medium text-zinc-900">{detail.value}</div>
                    </div>
                  )) : [
                    { label: 'Category', value: device.deviceType || 'Accessory' },
                    { label: 'Assigned To', value: device.user?.fullName || 'Unassigned' },
                    { label: 'Department', value: device.department?.name || 'Unassigned' },
                    { label: 'Location', value: device.branch?.name || 'Unassigned' },
                  ].map((detail) => (
                    <div key={detail.label}>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{detail.label}</div>
                      <div className="mt-1 font-medium text-zinc-900">{detail.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Assignment</div>
                <div className="space-y-2 text-sm text-zinc-700">
                  <div>Employee: {device.user?.fullName || 'Unassigned'}</div>
                  <div>Employee ID: {device.user?.employeeCode || '-'}</div>
                  <div>Email: {device.user?.email || '-'}</div>
                  <div>Department: {device.department?.name || 'Unassigned'}</div>
                </div>
                {canOperate ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {isAssigned ? (
                      <button
                        type="button"
                        onClick={() => setPendingAssetAction({ kind: 'unassign' })}
                        disabled={assetActionLoading}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                      >
                        {assetActionLoading && pendingAssetAction?.kind === 'unassign' ? 'Working...' : 'Remove From User'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPendingAssetAction({ kind: 'delete' })}
                      disabled={assetActionLoading}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                    >
                      {assetActionLoading && pendingAssetAction?.kind === 'delete' ? 'Working...' : 'Delete Asset'}
                    </button>
                  </div>
                ) : null}
              </div>

              {canOperate && !isAssigned ? <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-700">Assign Imported System</div>
                <div className="space-y-3 text-sm text-zinc-700">
                  {enrollmentRequest ? (
                    <div className="rounded-lg border border-amber-100 bg-white px-3 py-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Enrollment signal</div>
                      <div className="mt-2">Requester: <span className="font-semibold text-zinc-900">{enrollmentDetails['requester name'] || 'Unknown'}</span></div>
                      <div>Email: <span className="font-semibold text-zinc-900">{enrollmentDetails['requester email'] || '-'}</span></div>
                      <div>Employee ID: <span className="font-semibold text-zinc-900">{enrollmentDetails['employee id'] || '-'}</span></div>
                    </div>
                  ) : null}

                  {suggestedAssignmentUser ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-800">
                      Suggested user match: <span className="font-semibold">{suggestedAssignmentUser.fullName}</span> ({suggestedAssignmentUser.employeeCode || suggestedAssignmentUser.email})
                    </div>
                  ) : enrollmentRequest ? (
                    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3 text-zinc-600">
                      No exact user match was found from the enrollment details. Select the correct user manually.
                    </div>
                  ) : null}

                  {assignmentUsersLoading ? <div className="text-zinc-500">Loading users...</div> : null}
                  <label className="block">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Search User</div>
                    <input
                      value={assignmentSearchQuery}
                      onChange={(event) => setAssignmentSearchQuery(event.target.value)}
                      placeholder="Search by employee name, email, or employee ID"
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900"
                    />
                  </label>

                  {!assignmentUsersLoading && assignableUsers.length ? (
                    <label className="block">
                      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Assign To</div>
                      <select
                        value={selectedAssignmentUserId}
                        onChange={(event) => setSelectedAssignmentUserId(event.target.value)}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900"
                      >
                        {assignableUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.fullName} • {user.employeeCode || user.email}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {!assignmentUsersLoading && !assignableUsers.length ? <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3 text-zinc-600">{assignmentSearchQuery.trim() ? 'No matching users were found for this search.' : 'Search for a user to assign this system.'}</div> : null}

                  <button
                    type="button"
                    onClick={() => void handleAssignDevice()}
                    disabled={assigningDevice || !selectedAssignmentUserId || assignmentUsersLoading}
                    className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {assigningDevice ? 'Assigning...' : 'Assign Device'}
                  </button>
                </div>
              </div> : null}

              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Lifecycle</div>
                <div className="space-y-2 text-sm text-zinc-700">
                  {computeAsset ? <div>Patch Status: {device.patchStatus.replaceAll('_', ' ')}</div> : <div>Warranty: {formatDate(device.warrantyExpiresAt)}</div>}
                  {computeAsset ? <div>Alert Status: {device.alertStatus}</div> : <div>Assigned To: {device.user?.fullName || 'Unassigned'}</div>}
                  {computeAsset ? <div>Compliance Score: {device.complianceScore}%</div> : <div>Location: {device.branch?.name || 'Unassigned'}</div>}
                  <div>Asset Type: {device.deviceType || 'Device'}</div>
                </div>
              </div>

              {enrollmentRequest ? <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-brand-700">Enrollment Review Audit</div>
                <div className="space-y-2 text-sm text-zinc-700">
                  <div>Status: <span className="font-semibold text-zinc-900">{formatStatusLabel(enrollmentRequest.status)}</span></div>
                  <div>Request: <span className="font-semibold text-zinc-900">{enrollmentRequest.title}</span></div>
                  <div>Submitted Name: <span className="font-semibold text-zinc-900">{enrollmentDetails['requester name'] || enrollmentDetails['name'] || 'Unknown'}</span></div>
                  <div>Submitted Email: <span className="font-semibold text-zinc-900">{enrollmentDetails['requester email'] || enrollmentDetails['email'] || '-'}</span></div>
                  <div>Submitted Employee ID: <span className="font-semibold text-zinc-900">{enrollmentDetails['employee id'] || enrollmentDetails['employee code'] || '-'}</span></div>
                  <div>Submitted Department: <span className="font-semibold text-zinc-900">{enrollmentDetails['department'] || '-'}</span></div>
                  <div>Assigned Reviewer: <span className="font-semibold text-zinc-900">{enrollmentRequest.assignee?.fullName || 'Unassigned'}</span></div>
                  <div>Last Updated: <span className="font-semibold text-zinc-900">{formatDate(enrollmentRequest.updatedAt)}</span></div>
                  {latestEnrollmentComment ? <div>Last Review Entry: <span className="font-semibold text-zinc-900">{latestEnrollmentComment.author}</span> • {formatDate(latestEnrollmentComment.createdAt)}</div> : null}
                  {latestEnrollmentComment ? <div className="rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm text-zinc-700">{latestEnrollmentComment.note}</div> : null}
                </div>
              </div> : null}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-6 py-4">
              <h2 className="text-lg font-bold text-zinc-900">{computeAsset ? 'Installed Software' : 'Asset Notes'}</h2>
            </div>
            <div className="divide-y divide-zinc-100">
              {computeAsset && installedApps.length ? installedApps.map((application) => (
                <div key={application.id} className="px-6 py-4">
                  <div className="font-semibold text-zinc-900">{application.name}</div>
                  <div className="mt-1 text-sm text-zinc-500">{application.publisher || 'Unknown publisher'} • {application.version || 'Unknown version'}</div>
                </div>
              )) : <div className="px-6 py-10 text-center text-sm text-zinc-500">{computeAsset ? 'No installed software data is available for this asset.' : 'This asset is treated as non-compute inventory, so processor, operating system, and installed software details are not shown.'}</div>}
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          {computeAsset ? <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center text-sm font-bold uppercase tracking-wider text-zinc-500">
              <TerminalSquare className="mr-2 h-4 w-4 text-brand-600" /> Terminal
            </div>
            <p className="mt-2 text-sm text-zinc-500">Start a terminal session for this particular asset and review recent session history.</p>
            {canOperate ? (
              <button type="button" onClick={() => void handleStartTerminal()} disabled={startingTerminal || !canStartTerminal} className="mt-4 w-full rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60">
                {startingTerminal ? 'Starting session...' : 'Start Terminal Session'}
              </button>
            ) : null}
            {canOperate && terminalBlockedReason ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">{terminalBlockedReason}</div> : null}
            <div className="mt-4 space-y-3">
              {sidebarLoading ? <div className="text-sm text-zinc-500">Loading sessions...</div> : null}
              {!sidebarLoading && terminalSessions.length === 0 ? <div className="rounded-xl bg-zinc-50 px-3 py-4 text-sm text-zinc-500">No terminal sessions recorded for this asset.</div> : null}
              {terminalSessions.map((sessionEntry) => (
                <div key={sessionEntry.id} className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3">
                  <div className="text-sm font-semibold text-zinc-900">{sessionEntry.status}</div>
                  <div className="mt-1 text-xs text-zinc-500">{sessionEntry.requestedBy || 'Unknown user'} • {formatDate(sessionEntry.createdAt)}</div>
                </div>
              ))}
            </div>
          </div> : null}

          {computeAsset ? <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center text-sm font-bold uppercase tracking-wider text-zinc-500">
              <Play className="mr-2 h-4 w-4 text-brand-600" /> Patch Run
            </div>
            <p className="mt-2 text-sm text-zinc-500">Queue a patch run for this asset and review recent patch jobs.</p>
            {canOperate ? (
              <button type="button" onClick={() => void handleRunPatch()} disabled={runningPatch || !canRunPatch} className="mt-4 w-full rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
                {runningPatch ? 'Queueing patch...' : 'Run Patch for This Asset'}
              </button>
            ) : null}
            {canOperate && patchBlockedReason ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">{patchBlockedReason}</div> : null}
            <div className="mt-4 space-y-3">
              {sidebarLoading ? <div className="text-sm text-zinc-500">Loading patch jobs...</div> : null}
              {patchJobs.map((job) => (
                <div key={job.id} className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3">
                  <div className="text-sm font-semibold text-zinc-900">{job.jid}</div>
                  <div className="mt-1 text-xs text-zinc-500">{job.scope} • {job.status} • {formatDate(job.createdAt)}</div>
                </div>
              ))}
            </div>
          </div> : null}

          {computeAsset ? <SecurityFindingsPanel title="Wazuh Findings" description="Latest file-integrity and compliance findings linked through the Wazuh agent for this asset." alerts={wazuhAlerts} loading={sidebarLoading} emptyMessage="No recent Wazuh findings for this asset." onSelectAlert={setSelectedAlert} /> : null}

          {computeAsset ? <SecurityFindingsPanel title="ClamAV Findings" description="Recent malware scan results reported by the endpoint agent for this asset." alerts={clamavAlerts} loading={sidebarLoading} emptyMessage="No recent ClamAV findings for this asset." onSelectAlert={setSelectedAlert} /> : null}

          {computeAsset ? <SecurityFindingsPanel title="OpenSCAP Findings" description="Recent hardening and compliance results reported from OpenSCAP scans for this asset." alerts={openscapAlerts} loading={sidebarLoading} emptyMessage="No recent OpenSCAP findings for this asset." onSelectAlert={setSelectedAlert} /> : null}

          {computeAsset ? <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center text-sm font-bold uppercase tracking-wider text-zinc-500">
                <ShieldCheck className="mr-2 h-4 w-4 text-brand-600" /> Other Alerts
              </div>
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-bold text-zinc-700">{otherAlerts.length} recent</span>
            </div>
            <p className="mt-2 text-sm text-zinc-500">Operational and lifecycle alerts for this asset, excluding the dedicated Wazuh, ClamAV, and OpenSCAP findings shown above.</p>
            <div className="mt-4 space-y-3">
              {sidebarLoading ? <div className="text-sm text-zinc-500">Loading alerts...</div> : null}
              {!sidebarLoading && otherAlerts.length === 0 ? <div className="rounded-xl bg-zinc-50 px-3 py-4 text-sm text-zinc-500">No additional operational alerts for this asset.</div> : null}
              {otherAlerts.map((alert) => (
                <button key={alert.id} type="button" onClick={() => setSelectedAlert(alert)} className="block w-full rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-left transition hover:border-zinc-200 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900">{alert.title}</div>
                      <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">{alert.source} • {alert.severity}</div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${alert.resolved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {alert.resolved ? 'resolved' : 'open'}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-zinc-600">{alert.detail}</div>
                  <div className="mt-2 text-xs text-zinc-500">{formatDate(alert.createdAt)}</div>
                  <div className="mt-2 text-xs font-medium text-zinc-400">Click for full details</div>
                </button>
              ))}
            </div>
          </div> : null}
        </aside>
      </div>

      {selectedAlert ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/55 p-4" onClick={() => setSelectedAlert(null)}>
          <div ref={alertDialogRef} className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="device-alert-detail-title" aria-describedby="device-alert-detail-body" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${severityBadgeClassName(selectedAlert.severity)}`}>{selectedAlert.severity || 'unknown'}</span>
                  <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-700">{alertSourceLabel(selectedAlert.source)}</span>
                  {selectedAlert.resolved ? <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">Resolved</span> : <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">Open</span>}
                </div>
                <h2 id="device-alert-detail-title" className="mt-3 text-xl font-bold text-zinc-900">{selectedAlert.title}</h2>
                <p id="device-alert-detail-body" className="mt-2 whitespace-pre-line text-sm text-zinc-600">{selectedAlert.detail || 'No detail provided.'}</p>
              </div>
              <button ref={alertCloseButtonRef} type="button" onClick={() => setSelectedAlert(null)} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50">Close</button>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">System Name</div>
                <div className="mt-2 text-sm font-semibold text-zinc-900">{device.hostname || '-'}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Asset ID</div>
                <div className="mt-2 break-all text-sm font-semibold text-zinc-900">{device.assetId || '-'}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Source</div>
                <div className="mt-2 text-sm font-semibold text-zinc-900">{alertSourceLabel(selectedAlert.source)}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Assigned User</div>
                <div className="mt-2 text-sm font-semibold text-zinc-900">{device.user?.fullName || '-'}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Email</div>
                <div className="mt-2 text-sm font-semibold text-zinc-900">{device.user?.email || '-'}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Department</div>
                <div className="mt-2 text-sm font-semibold text-zinc-900">{device.department?.name || '-'}</div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Created</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{formatDate(selectedAlert.createdAt)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Current Status</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{selectedAlert.resolved ? 'Resolved' : 'Open'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingAssetAction)}
        title={pendingAssetAction?.kind === 'delete' ? 'Delete Asset' : 'Remove Asset From User'}
        message={pendingAssetAction?.kind === 'delete' ? 'This will permanently delete the asset from ITMS and cannot be undone.' : 'This will remove the asset assignment from the current user but keep the asset in ITMS.'}
        confirmLabel={pendingAssetAction?.kind === 'delete' ? 'Delete Asset' : 'Remove From User'}
        tone={pendingAssetAction?.kind === 'delete' ? 'danger' : 'default'}
        busy={assetActionLoading}
        onClose={() => setPendingAssetAction(null)}
        onConfirm={() => {
          if (pendingAssetAction) {
            void handleAssetAction(pendingAssetAction.kind);
          }
        }}
      />
    </div>
  );
}