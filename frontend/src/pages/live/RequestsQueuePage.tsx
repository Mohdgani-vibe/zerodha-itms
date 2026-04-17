import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Filter, PlusCircle, Search, Sparkles, UserPlus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiRequest } from '../../lib/api';
import Pagination from '../../components/Pagination';

const ENROLLMENT_REQUEST_TYPE = 'device_enrollment';
const REQUESTS_PAGE_SIZE = 12;
const ASSIGNEE_OPTIONS_PAGE_SIZE = 200;
const REQUESTS_UPDATED_EVENT = 'itms:requests-updated';

interface QueueComment {
  id: string;
  author: string;
  note: string;
  createdAt: string;
}

interface QueuePerson {
  id?: string;
  fullName?: string;
}

interface QueueRequest {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  requester: QueuePerson;
  assignee: QueuePerson;
  comments: QueueComment[];
}

interface PaginatedQueueResponse {
  items: QueueRequest[];
  total: number;
  page: number;
  pageSize: number;
  summary?: {
    pending: number;
    inProgress: number;
    resolved: number;
    enrollment: number;
    pendingEnrollment: number;
  };
}

interface UserOption {
  id: string;
  fullName?: string;
  full_name?: string;
  role?: string;
}

interface PaginatedUserOptionsResponse {
  items: UserOption[];
  total: number;
  page: number;
  pageSize: number;
}

interface WorkflowSettings {
  ticketAssigneeIds: string[];
}

function defaultWorkflowSettings(): WorkflowSettings {
  return {
    ticketAssigneeIds: [],
  };
}

function normalizeWorkflowSettings(settings?: WorkflowSettings | null): WorkflowSettings {
  return {
    ticketAssigneeIds: Array.isArray(settings?.ticketAssigneeIds)
      ? settings.ticketAssigneeIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [],
  };
}

function normalizeQueueRequest(request: QueueRequest): QueueRequest {
  return {
    ...request,
    title: request.title || '',
    description: request.description || '',
    notes: request.notes || '',
    requester: request.requester || {},
    assignee: request.assignee || {},
    comments: Array.isArray(request.comments) ? request.comments.filter(Boolean) : [],
  };
}

interface QueueDevice {
  id: string;
  assetId: string;
  hostname: string;
}

type QueueSectionId = 'enrollment' | 'support';
type QueueViewMode = 'list' | 'table';

interface BulkActionFeedback {
  tone: 'success' | 'warning';
  actionLabel: string;
  successCount: number;
  failureCount: number;
  failedRequestIds: string[];
}

interface QueueRequestForm {
  type: string;
  title: string;
  description: string;
}

const STATUS_OPTIONS = ['pending', 'in_progress', 'resolved', 'rejected'];
const TYPE_FILTER_OPTIONS = [
  { value: 'all', label: 'All request types' },
  { value: ENROLLMENT_REQUEST_TYPE, label: 'Enrollment reviews' },
  { value: 'other', label: 'Other requests' },
] as const;
const REQUEST_CREATION_TYPES = [
  'Laptop change',
  'OS reinstall',
  'Software install',
  'Portal access',
  'Settings change',
  'General issue',
  'Other',
] as const;

function formatStatusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

function formatTypeLabel(type: string) {
  if (type === ENROLLMENT_REQUEST_TYPE) {
    return 'Enrollment';
  }

  return type.replace(/_/g, ' ');
}

function getStatusClasses(status: string) {
  if (status === 'resolved') {
    return 'bg-emerald-100 text-emerald-700';
  }
  if (status === 'rejected') {
    return 'bg-rose-100 text-rose-700';
  }
  if (status === 'in_progress') {
    return 'bg-amber-100 text-amber-700';
  }
  return 'bg-zinc-100 text-zinc-700';
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

function getSectionTone(section: QueueSectionId) {
  if (section === 'enrollment') {
    return {
      shell: 'border-brand-200 bg-brand-50/40',
      badge: 'bg-brand-100 text-brand-700',
      heading: 'text-brand-900',
      subtext: 'text-brand-700/80',
    };
  }

  return {
    shell: 'border-zinc-200 bg-white',
    badge: 'bg-zinc-100 text-zinc-700',
    heading: 'text-zinc-900',
    subtext: 'text-zinc-500',
  };
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function getFreshnessTone(value: string) {
  const ageHours = Math.max(0, (Date.now() - new Date(value).getTime()) / 3600000);
  if (ageHours >= 72) {
    return 'bg-rose-100 text-rose-700';
  }
  if (ageHours >= 24) {
    return 'bg-amber-100 text-amber-700';
  }
  return 'bg-emerald-100 text-emerald-700';
}

function buildNoteTemplate(kind: 'triage' | 'waiting' | 'resolved') {
  if (kind === 'triage') {
    return 'Initial triage completed. Queue owner assigned and next action identified.';
  }
  if (kind === 'waiting') {
    return 'Waiting on requester confirmation, supporting details, or external dependency.';
  }
  return 'Work completed and shared with requester. Monitoring for any follow-up.';
}

export default function RequestsQueuePage() {
  const [requests, setRequests] = useState<QueueRequest[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings | null>(null);
  const [devices, setDevices] = useState<QueueDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [assigneeDrafts, setAssigneeDrafts] = useState<Record<string, string>>({});
  const [statusDrafts, setStatusDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState('');
  const [totalRequests, setTotalRequests] = useState(0);
  const [requestSummary, setRequestSummary] = useState({ pending: 0, inProgress: 0, resolved: 0, enrollment: 0, pendingEnrollment: 0 });
  const [viewMode, setViewMode] = useState<QueueViewMode>('list');
  const [selectedTableRequestId, setSelectedTableRequestId] = useState('');
  const [selectedBulkRequestIds, setSelectedBulkRequestIds] = useState<string[]>([]);
  const [bulkAssigneeId, setBulkAssigneeId] = useState('');
  const [bulkStatus, setBulkStatus] = useState('in_progress');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<BulkActionFeedback | null>(null);
  const [requestForm, setRequestForm] = useState<QueueRequestForm>({ type: REQUEST_CREATION_TYPES[0], title: '', description: '' });
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.split('/requests')[0];

  const loadQueuePage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ paginate: '1', page: String(currentPage), page_size: String(REQUESTS_PAGE_SIZE) });
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (typeFilter !== 'all') {
        params.set('type', typeFilter);
      }
      const queue = await apiRequest<PaginatedQueueResponse>(`/api/requests?${params.toString()}`);
      const normalizedItems = Array.isArray(queue.items) ? queue.items.map(normalizeQueueRequest) : [];
      setRequests(normalizedItems);
      setTotalRequests(queue.total || 0);
      setRequestSummary({
        pending: queue.summary?.pending || 0,
        inProgress: queue.summary?.inProgress || 0,
        resolved: queue.summary?.resolved || 0,
        enrollment: queue.summary?.enrollment || 0,
        pendingEnrollment: queue.summary?.pendingEnrollment || 0,
      });
      setAssigneeDrafts(Object.fromEntries(normalizedItems.map((item) => [item.id, item.assignee?.id || ''])));
      setStatusDrafts(Object.fromEntries(normalizedItems.map((item) => [item.id, item.status])));
      setNoteDrafts(Object.fromEntries(normalizedItems.map((item) => [item.id, item.notes || ''])));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load support queue');
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, statusFilter, typeFilter]);

  useEffect(() => {
    void loadQueuePage();
  }, [loadQueuePage]);

  useEffect(() => {
    let cancelled = false;

    const loadAuxiliaryData = async () => {
      try {
        const params = new URLSearchParams({
          paginate: '1',
          page: '1',
          page_size: String(ASSIGNEE_OPTIONS_PAGE_SIZE),
        });
        params.append('role', 'it_team');
        params.append('role', 'super_admin');
        const [userList, workflowData] = await Promise.all([
          apiRequest<PaginatedUserOptionsResponse>(`/api/users?${params.toString()}`),
          apiRequest<WorkflowSettings>('/api/settings/workflow').catch(() => defaultWorkflowSettings()),
        ]);
        if (!cancelled) {
          setUsers(userList.items);
          setWorkflowSettings(normalizeWorkflowSettings(workflowData));
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load support queue helpers');
        }
      }
    };

    void loadAuxiliaryData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const lookupKeys = Array.from(new Set(
      requests
        .filter((request) => request.type === ENROLLMENT_REQUEST_TYPE)
        .map((request) => (parseEnrollmentDetails(request.description)['asset tag / host'] || '').trim().toLowerCase())
        .filter(Boolean),
    ));

    if (!lookupKeys.length) {
      setDevices([]);
      return () => {
        cancelled = true;
      };
    }

    const loadLinkedDevices = async () => {
      try {
        const params = new URLSearchParams();
        lookupKeys.forEach((lookup) => params.append('lookup', lookup));
        const deviceList = await apiRequest<QueueDevice[]>(`/api/devices?${params.toString()}`);
        if (!cancelled) {
          setDevices(deviceList || []);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load linked enrollment devices');
        }
      }
    };

    void loadLinkedDevices();

    return () => {
      cancelled = true;
    };
  }, [requests]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, typeFilter]);

  const itUsers = useMemo(
    () => users.filter((user) => {
      const role = (user.role || '').toLowerCase();
      if (role !== 'it_team' && role !== 'super_admin') {
        return false;
      }
      if (!workflowSettings || workflowSettings.ticketAssigneeIds.length === 0) {
        return true;
      }
      return workflowSettings.ticketAssigneeIds.includes(user.id);
    }),
    [users, workflowSettings],
  );

  const enrollmentCount = requestSummary.enrollment;
  const pendingEnrollmentCount = requestSummary.pendingEnrollment;
  const deviceIdByEnrollmentKey = useMemo(() => {
    const index = new Map<string, string>();

    devices.forEach((device) => {
      const assetId = device.assetId?.trim().toLowerCase();
      const hostname = device.hostname?.trim().toLowerCase();
      if (assetId) {
        index.set(assetId, device.id);
      }
      if (hostname) {
        index.set(hostname, device.id);
      }
    });

    return index;
  }, [devices]);

  const sectionedRequests = useMemo(() => {
    const enrollmentItems = requests.filter((request) => request.type === ENROLLMENT_REQUEST_TYPE);
    const supportItems = requests.filter((request) => request.type !== ENROLLMENT_REQUEST_TYPE);

    if (typeFilter === ENROLLMENT_REQUEST_TYPE) {
      return [{
        id: 'enrollment' as QueueSectionId,
        title: 'Enrollment Reviews',
        description: 'New endpoint onboarding requests that need device linkage and approval.',
        items: enrollmentItems,
        emptyMessage: 'No enrollment reviews matched the current filters.',
      }];
    }

    if (typeFilter === 'other') {
      return [{
        id: 'support' as QueueSectionId,
        title: 'Support Requests',
        description: 'General IT queue for access, software, hardware, and employee support work.',
        items: supportItems,
        emptyMessage: 'No support requests matched the current filters.',
      }];
    }

    return [
      {
        id: 'enrollment' as QueueSectionId,
        title: 'Enrollment Reviews',
        description: 'Requests created from imported systems and onboarding flows.',
        items: enrollmentItems,
        emptyMessage: 'No enrollment reviews matched the current filters.',
      },
      {
        id: 'support' as QueueSectionId,
        title: 'Support Requests',
        description: 'All non-enrollment work items in the IT queue.',
        items: supportItems,
        emptyMessage: 'No support requests matched the current filters.',
      },
    ];
  }, [requests, typeFilter]);

  const activeTypeLabel = useMemo(
    () => TYPE_FILTER_OPTIONS.find((option) => option.value === typeFilter)?.label || 'All request types',
    [typeFilter],
  );

  const activeStatusLabel = useMemo(
    () => (statusFilter === 'all' ? 'All statuses' : formatStatusLabel(statusFilter)),
    [statusFilter],
  );

  const typeCounts = useMemo(() => ({
    all: totalRequests,
    [ENROLLMENT_REQUEST_TYPE]: enrollmentCount,
    other: Math.max(0, totalRequests - enrollmentCount),
  }), [enrollmentCount, totalRequests]);

  const unassignedCount = useMemo(
    () => requests.filter((request) => !request.assignee?.id).length,
    [requests],
  );

  const recentActivityCount = useMemo(
    () => requests.filter((request) => Date.now() - new Date(request.updatedAt).getTime() < 24 * 60 * 60 * 1000).length,
    [requests],
  );

  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilter !== 'all' || typeFilter !== 'all';
  const hasVisibleRequests = requests.length > 0;

  useEffect(() => {
    if (!requests.length) {
      setSelectedTableRequestId('');
      setSelectedBulkRequestIds([]);
      return;
    }

    if (!selectedTableRequestId || !requests.some((request) => request.id === selectedTableRequestId)) {
      setSelectedTableRequestId(requests[0].id);
    }

    setSelectedBulkRequestIds((current) => current.filter((requestId) => requests.some((request) => request.id === requestId)));
  }, [requests, selectedTableRequestId]);

  const bulkSelectedCount = selectedBulkRequestIds.length;

  const toggleBulkRequest = (requestId: string) => {
    setBulkFeedback(null);
    setSelectedBulkRequestIds((current) => (
      current.includes(requestId)
        ? current.filter((id) => id !== requestId)
        : [...current, requestId]
    ));
  };

  const toggleBulkSection = (requestIds: string[]) => {
    const everySelected = requestIds.every((requestId) => selectedBulkRequestIds.includes(requestId));
    setBulkFeedback(null);
    setSelectedBulkRequestIds((current) => {
      if (everySelected) {
        return current.filter((requestId) => !requestIds.includes(requestId));
      }

      return Array.from(new Set([...current, ...requestIds]));
    });
  };

  const handleBulkAssign = async () => {
    if (!bulkAssigneeId || !selectedBulkRequestIds.length) {
      return;
    }

    try {
      const requestIds = [...selectedBulkRequestIds];
      setBulkSaving(true);
      setError('');
      setBulkFeedback(null);
      const results = await Promise.allSettled(requestIds.map((requestId) => apiRequest(`/api/requests/${requestId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assigneeId: bulkAssigneeId }),
      })));

      const failedRequestIds = results.flatMap((result, index) => (result.status === 'rejected' ? [requestIds[index]] : []));
      const successCount = results.length - failedRequestIds.length;

      setBulkFeedback({
        tone: failedRequestIds.length ? 'warning' : 'success',
        actionLabel: 'assign',
        successCount,
        failureCount: failedRequestIds.length,
        failedRequestIds,
      });
      setSelectedBulkRequestIds(failedRequestIds);
      await loadQueuePage();
      window.dispatchEvent(new Event(REQUESTS_UPDATED_EVENT));
    } finally {
      setBulkSaving(false);
    }
  };

  const handleBulkStatusUpdate = async () => {
    if (!selectedBulkRequestIds.length) {
      return;
    }

    const note = bulkStatus === 'resolved'
      ? buildNoteTemplate('resolved')
      : bulkStatus === 'in_progress'
        ? buildNoteTemplate('triage')
        : buildNoteTemplate('waiting');

    try {
      const requestIds = [...selectedBulkRequestIds];
      setBulkSaving(true);
      setError('');
      setBulkFeedback(null);
      const results = await Promise.allSettled(requestIds.map((requestId) => apiRequest(`/api/requests/${requestId}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: bulkStatus,
          notes: noteDrafts[requestId]?.trim() ? noteDrafts[requestId] : note,
        }),
      })));

      const failedRequestIds = results.flatMap((result, index) => (result.status === 'rejected' ? [requestIds[index]] : []));
      const successCount = results.length - failedRequestIds.length;

      setBulkFeedback({
        tone: failedRequestIds.length ? 'warning' : 'success',
        actionLabel: 'status update',
        successCount,
        failureCount: failedRequestIds.length,
        failedRequestIds,
      });
      setSelectedBulkRequestIds(failedRequestIds);
      await loadQueuePage();
      window.dispatchEvent(new Event(REQUESTS_UPDATED_EVENT));
    } finally {
      setBulkSaving(false);
    }
  };

  const handleAssign = async (requestId: string) => {
    const assigneeId = assigneeDrafts[requestId];
    if (!assigneeId) {
      return;
    }

    try {
      setSavingId(requestId);
      setError('');
      await apiRequest(`/api/requests/${requestId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assigneeId }),
      });
      await loadQueuePage();
      window.dispatchEvent(new Event(REQUESTS_UPDATED_EVENT));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to assign request');
    } finally {
      setSavingId('');
    }
  };

  const handleStatusUpdate = async (requestId: string) => {
    try {
      setSavingId(requestId);
      setError('');
      await apiRequest(`/api/requests/${requestId}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: statusDrafts[requestId] || 'pending',
          notes: noteDrafts[requestId] || '',
        }),
      });
      await loadQueuePage();
      window.dispatchEvent(new Event(REQUESTS_UPDATED_EVENT));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update request');
    } finally {
      setSavingId('');
    }
  };

  const handleQuickStatusUpdate = async (requestId: string, status: string, fallbackNote: string) => {
    setStatusDrafts((current) => ({ ...current, [requestId]: status }));
    setNoteDrafts((current) => ({
      ...current,
      [requestId]: current[requestId]?.trim() ? current[requestId] : fallbackNote,
    }));

    try {
      setSavingId(requestId);
      setError('');
      await apiRequest(`/api/requests/${requestId}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          notes: noteDrafts[requestId]?.trim() ? noteDrafts[requestId] : fallbackNote,
        }),
      });
      await loadQueuePage();
      window.dispatchEvent(new Event(REQUESTS_UPDATED_EVENT));
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update request');
      return false;
    } finally {
      setSavingId('');
    }
  };

  const handleApproveAndOpenDevice = async (requestId: string, deviceId?: string) => {
    const updated = await handleQuickStatusUpdate(
      requestId,
      'resolved',
      'Endpoint enrollment approved and onboarding review completed.',
    );

    if (updated && deviceId) {
      navigate(`${basePath}/devices/${deviceId}`, {
        state: {
          enrollmentApprovalMessage: 'Enrollment review approved. Device is now ready for follow-up actions.',
          approvedRequestId: requestId,
        },
      });
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setTypeFilter('all');
  };

  const handleCreateRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!requestForm.type || !requestForm.title.trim()) {
      return;
    }

    try {
      setRequestSubmitting(true);
      setError('');
      await apiRequest('/api/me/requests', {
        method: 'POST',
        body: JSON.stringify({
          type: requestForm.type,
          title: requestForm.title.trim(),
          description: requestForm.description.trim(),
        }),
      });
      setRequestForm({ type: REQUEST_CREATION_TYPES[0], title: '', description: '' });
      await loadQueuePage();
      window.dispatchEvent(new Event(REQUESTS_UPDATED_EVENT));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to create request');
    } finally {
      setRequestSubmitting(false);
    }
  };

  const renderRequestDetail = (request: QueueRequest, shellClassName = '') => {
    const isEnrollmentRequest = request.type === ENROLLMENT_REQUEST_TYPE;
    const enrollmentDetails = isEnrollmentRequest ? parseEnrollmentDetails(request.description) : null;
    const deviceLookupKey = (enrollmentDetails?.['asset tag / host'] || '').trim().toLowerCase();
    const linkedDeviceId = deviceLookupKey ? deviceIdByEnrollmentKey.get(deviceLookupKey) : undefined;

    return (
      <article key={request.id} className={shellClassName || 'bg-white px-5 py-5'}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_340px]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-bold text-zinc-700 ring-1 ring-zinc-200">{request.id.slice(0, 8)}</span>
                  <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-bold text-zinc-700 ring-1 ring-zinc-200">{formatTypeLabel(request.type)}</span>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusClasses(request.status)}`}>{formatStatusLabel(request.status)}</span>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getFreshnessTone(request.updatedAt)}`}>{formatRelativeTime(request.updatedAt)}</span>
                  <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-bold text-zinc-700 ring-1 ring-zinc-200">{request.comments.length} comments</span>
                </div>
                <h2 className="mt-3 text-lg font-black tracking-tight text-zinc-950">{request.title}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{request.description || 'No description provided.'}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[310px] lg:grid-cols-1">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Requester</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">{request.requester?.fullName || '-'}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Assignee</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">{request.assignee?.fullName || 'Unassigned'}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Updated</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">{formatDateTime(request.updatedAt)}</div>
                  <div className="mt-1 text-xs text-zinc-500">Created {formatRelativeTime(request.createdAt)}</div>
                </div>
              </div>
            </div>

            {isEnrollmentRequest ? (
              <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-brand-700">Enrollment Review</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div><div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Asset</div><div className="mt-1 text-sm font-semibold text-zinc-900">{enrollmentDetails?.['asset tag / host'] || '-'}</div></div>
                  <div><div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Requester</div><div className="mt-1 text-sm font-semibold text-zinc-900">{enrollmentDetails?.['requester name'] || request.requester?.fullName || '-'}</div><div className="text-xs text-zinc-500">{enrollmentDetails?.['requester email'] || 'Email not provided'}</div></div>
                  <div><div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Employee ID</div><div className="mt-1 text-sm font-semibold text-zinc-900">{enrollmentDetails?.['employee id'] || '-'}</div></div>
                  <div><div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Department</div><div className="mt-1 text-sm font-semibold text-zinc-900">{enrollmentDetails?.department || '-'}</div></div>
                </div>
                <div className="mt-3"><div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Endpoint Profile</div><div className="mt-1 text-sm font-semibold text-zinc-900">{enrollmentDetails?.model || 'Model pending'}</div><div className="text-xs text-zinc-500">{enrollmentDetails?.os || 'OS details pending'}</div></div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => linkedDeviceId && navigate(`${basePath}/devices/${linkedDeviceId}`)} disabled={!linkedDeviceId} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60">{linkedDeviceId ? 'Open Device' : 'Device Pending Sync'}</button>
                  <button type="button" onClick={() => void handleQuickStatusUpdate(request.id, 'in_progress', 'Enrollment review started by IT team.')} disabled={savingId === request.id || request.status === 'in_progress'} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-60">Start Review</button>
                  <button type="button" onClick={() => void handleApproveAndOpenDevice(request.id, linkedDeviceId)} disabled={savingId === request.id || !linkedDeviceId} className="rounded-lg border border-brand-300 bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">Approve and Open Device</button>
                  <button type="button" onClick={() => void handleQuickStatusUpdate(request.id, 'resolved', 'Endpoint enrollment approved and onboarding review completed.')} disabled={savingId === request.id || request.status === 'resolved'} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">Approve</button>
                  <button type="button" onClick={() => void handleQuickStatusUpdate(request.id, 'rejected', 'Endpoint enrollment rejected during IT review.')} disabled={savingId === request.id || request.status === 'rejected'} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60">Reject</button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Requester</div>
                  {request.requester?.id ? (
                    <button type="button" onClick={() => navigate(`${basePath}/users/${request.requester.id}`)} className="mt-1 text-left text-sm font-semibold text-brand-700 hover:text-brand-800">
                      {request.requester?.fullName || '-'}
                    </button>
                  ) : <div className="mt-1 text-sm font-semibold text-zinc-900">{request.requester?.fullName || '-'}</div>}
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Assignee</div>
                  {request.assignee?.id ? (
                    <button type="button" onClick={() => navigate(`${basePath}/users/${request.assignee.id}`)} className="mt-1 text-left text-sm font-semibold text-brand-700 hover:text-brand-800">
                      {request.assignee?.fullName || 'Unassigned'}
                    </button>
                  ) : <div className="mt-1 text-sm font-semibold text-zinc-900">{request.assignee?.fullName || 'Unassigned'}</div>}
                </div>
                <div><div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Created</div><div className="mt-1 text-sm font-semibold text-zinc-900">{formatDateTime(request.createdAt)}</div><div className="mt-1 text-xs text-zinc-500">Updated {formatRelativeTime(request.updatedAt)}</div></div>
              </div>
            )}

            {request.comments.length ? (
              <div className="space-y-2">
                {request.comments.map((comment) => (
                  <div key={comment.id} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-700">
                    <div className="font-semibold text-zinc-900">{comment.author}</div>
                    <div className="mt-1">{comment.note}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="rounded-xl bg-white px-3 py-3 ring-1 ring-zinc-200">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Queue Controls</div>
              <div className="mt-2 text-sm text-zinc-600">Assign an owner, move the request to the correct state, then save the review note for the queue history.</div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">Assign To</label>
              <div className="flex gap-2">
                <select value={assigneeDrafts[request.id] || ''} onChange={(event) => setAssigneeDrafts((current) => ({ ...current, [request.id]: event.target.value }))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900">
                  <option value="">Select IT owner</option>
                  {itUsers.map((user) => <option key={user.id} value={user.id}>{user.fullName || user.full_name || user.id}</option>)}
                </select>
                <button type="button" onClick={() => void handleAssign(request.id)} disabled={savingId === request.id || !assigneeDrafts[request.id]} className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-100 disabled:opacity-60">Assign</button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">Status</label>
              <select value={statusDrafts[request.id] || request.status} onChange={(event) => setStatusDrafts((current) => ({ ...current, [request.id]: event.target.value }))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900">
                {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{formatStatusLabel(status)}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">Support Notes</label>
              <textarea value={noteDrafts[request.id] || ''} onChange={(event) => setNoteDrafts((current) => ({ ...current, [request.id]: event.target.value }))} rows={4} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900" placeholder="Internal resolution or triage notes" />
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  { id: 'triage', label: 'Add triage note' },
                  { id: 'waiting', label: 'Mark waiting' },
                  { id: 'resolved', label: 'Add resolution note' },
                ].map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setNoteDrafts((current) => ({ ...current, [request.id]: buildNoteTemplate(template.id as 'triage' | 'waiting' | 'resolved') }))}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-600 hover:bg-zinc-100"
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </div>

            <button type="button" onClick={() => void handleStatusUpdate(request.id)} disabled={savingId === request.id} className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-60">
              {savingId === request.id ? 'Saving...' : 'Update Request'}
            </button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_32%),linear-gradient(135deg,_#fafaf9_0%,_#ffffff_52%,_#f0f9ff_100%)] px-6 py-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-brand-700">
                Admin Queue
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-zinc-950 sm:text-4xl">Requests</h1>
              <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
                Review enrollment work, triage support issues, and move requests forward from one queue-first workspace.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 xl:min-w-[620px]">
              <div className="rounded-2xl border border-white/90 bg-white/90 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Total</div>
                <div className="mt-2 text-3xl font-black text-zinc-950">{totalRequests}</div>
              </div>
              <div className="rounded-2xl border border-white/90 bg-white/90 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Pending</div>
                <div className="mt-2 text-3xl font-black text-zinc-950">{requestSummary.pending}</div>
              </div>
              <div className="rounded-2xl border border-white/90 bg-white/90 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">In Progress</div>
                <div className="mt-2 text-3xl font-black text-zinc-950">{requestSummary.inProgress}</div>
              </div>
              <div className="rounded-2xl border border-white/90 bg-white/90 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Resolved</div>
                <div className="mt-2 text-3xl font-black text-zinc-950">{requestSummary.resolved}</div>
              </div>
              <div className="rounded-2xl border border-white/90 bg-white/90 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Enrollment</div>
                <div className="mt-2 text-3xl font-black text-zinc-950">{pendingEnrollmentCount}<span className="ml-1 text-sm font-semibold text-zinc-500">/ {enrollmentCount}</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

      <form onSubmit={handleCreateRequest} className="rounded-[24px] border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-700">
              <PlusCircle className="mr-2 h-3.5 w-3.5" />
              Raise A Request
            </div>
            <h2 className="mt-3 text-xl font-black text-zinc-950">IT and super admin can raise work directly from the queue</h2>
            <p className="mt-2 text-sm text-zinc-600">Use this for laptop change, OS reinstall, software install, portal access, settings change, or general IT issues.</p>
          </div>
          <button type="submit" disabled={requestSubmitting} className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-60">
            {requestSubmitting ? 'Submitting...' : 'Create Request'}
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">Request Type</label>
            <select value={requestForm.type} onChange={(event) => setRequestForm((current) => ({ ...current, type: event.target.value }))} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900">
              {REQUEST_CREATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">Title</label>
            <input value={requestForm.title} onChange={(event) => setRequestForm((current) => ({ ...current, title: event.target.value }))} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900" placeholder="Short request title" />
          </div>
        </div>
        <div className="mt-4">
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">Description</label>
          <textarea value={requestForm.description} onChange={(event) => setRequestForm((current) => ({ ...current, description: event.target.value }))} rows={4} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900" placeholder="Describe the issue, needed change, affected employee, or portal setting to update" />
        </div>
      </form>

      <section className="rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search title, requester, assignee, request id"
              className="w-full rounded-[20px] border border-zinc-200 bg-white py-3 pl-10 pr-4 text-sm text-zinc-900"
            />
          </div>

          <label className="min-w-0 xl:w-[220px] xl:flex-none">
            <span className="sr-only">Request type</span>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="w-full rounded-[20px] border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700"
            >
              {TYPE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} {typeCounts[option.value as keyof typeof typeCounts]}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0 xl:w-[220px] xl:flex-none">
            <span className="sr-only">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full rounded-[20px] border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700"
            >
              {[
                { value: 'all', label: 'All', count: totalRequests },
                { value: 'pending', label: 'Pending', count: requestSummary.pending },
                { value: 'in_progress', label: 'In Progress', count: requestSummary.inProgress },
                { value: 'resolved', label: 'Resolved', count: requestSummary.resolved },
              ].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} {option.count}
                </option>
              ))}
            </select>
          </label>

          <div className="text-sm text-zinc-600 xl:flex-none xl:whitespace-nowrap">
            Showing <span className="font-bold text-zinc-900">{activeTypeLabel}</span> with <span className="font-bold text-zinc-900">{activeStatusLabel}</span>{searchQuery.trim() ? <span> for search <span className="font-bold text-zinc-900">{searchQuery.trim()}</span></span> : null}.
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
            <div className="inline-flex rounded-full border border-zinc-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${viewMode === 'list' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
              >
                List View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${viewMode === 'table' ? 'bg-brand-600 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
              >
                Table View
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Unassigned</div>
                <UserPlus className="h-4 w-4 text-zinc-400" />
              </div>
              <div className="mt-2 text-2xl font-black text-zinc-950">{unassignedCount}</div>
              <div className="mt-1 text-xs text-zinc-500">Requests still waiting for an owner.</div>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Active Today</div>
                <Clock3 className="h-4 w-4 text-zinc-400" />
              </div>
              <div className="mt-2 text-2xl font-black text-zinc-950">{recentActivityCount}</div>
              <div className="mt-1 text-xs text-zinc-500">Requests updated in the last 24 hours.</div>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Needs Review</div>
                <Sparkles className="h-4 w-4 text-zinc-400" />
              </div>
              <div className="mt-2 text-2xl font-black text-zinc-950">{pendingEnrollmentCount + unassignedCount}</div>
              <div className="mt-1 text-xs text-zinc-500">Enrollments and unowned tickets to handle first.</div>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Filtered View</div>
                <Filter className="h-4 w-4 text-zinc-400" />
              </div>
              <div className="mt-2 text-2xl font-black text-zinc-950">{hasActiveFilters ? 1 : 0}</div>
              <div className="mt-1 text-xs text-zinc-500">{hasActiveFilters ? 'Custom filters are narrowing the queue.' : 'Viewing the full queue with default filters.'}</div>
            </div>
          </div>
      </section>

      {loading ? <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm">Loading request queue...</div> : null}
      {!loading && !hasVisibleRequests ? (
        <section className="rounded-[28px] border border-zinc-200 bg-white px-6 py-10 text-center shadow-sm">
          <div className="mx-auto max-w-2xl">
            <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-600">
              Queue Empty
            </div>
            <h2 className="mt-4 text-2xl font-black tracking-tight text-zinc-950">No requests match this view</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
              {hasActiveFilters
                ? 'No requests match the current search and filter combination. Reset the filters to return to the full queue.'
                : 'There are no requests in the queue yet. New enrollment reviews and support tickets will appear here automatically.'}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {hasActiveFilters ? (
                <button type="button" onClick={clearFilters} className="rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-zinc-800">
                  Reset Filters
                </button>
              ) : null}
              <button type="button" onClick={() => navigate(`${basePath}/dashboard`)} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50">
                Open Dashboard
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {!loading && hasVisibleRequests && sectionedRequests.map((section) => {
        const tone = getSectionTone(section.id);

        return (
          <section key={section.id} className={`overflow-hidden rounded-2xl border shadow-sm ${tone.shell}`}>
            <div className="border-b border-zinc-200/80 px-5 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className={`inline-flex rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${tone.badge}`}>
                    {section.title}
                  </div>
                  <h2 className={`mt-3 text-xl font-black tracking-tight ${tone.heading}`}>{section.title}</h2>
                  <p className={`mt-1 text-sm ${tone.subtext}`}>{section.description}</p>
                </div>
                <div className="rounded-2xl bg-white/90 px-4 py-3 text-right shadow-sm ring-1 ring-zinc-200">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Visible Items</div>
                  <div className="mt-1 text-2xl font-black text-zinc-950">{section.items.length}</div>
                </div>
              </div>
            </div>

            {section.items.length === 0 ? <div className="px-5 py-8 text-sm text-zinc-500">{section.emptyMessage}</div> : null}

            {viewMode === 'list' ? section.items.map((request, index) => renderRequestDetail(request, `${index > 0 ? 'border-t border-zinc-200 ' : ''}bg-white px-5 py-5`)) : null}
            {viewMode === 'table' && section.items.length ? (
              <div className="bg-white p-5">
                <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Bulk Triage</div>
                      <div className="mt-1 text-sm text-zinc-600">Select multiple rows to assign an owner or move the queue state in one action.</div>
                    </div>
                    <div className="text-sm font-semibold text-zinc-900">{bulkSelectedCount} selected</div>
                  </div>
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_auto_auto]">
                    <select value={bulkAssigneeId} onChange={(event) => setBulkAssigneeId(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900">
                      <option value="">Assign selected requests</option>
                      {itUsers.map((user) => <option key={user.id} value={user.id}>{user.fullName || user.full_name || user.id}</option>)}
                    </select>
                    <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900">
                      {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{formatStatusLabel(status)}</option>)}
                    </select>
                    <button type="button" onClick={() => void handleBulkAssign()} disabled={bulkSaving || !bulkSelectedCount || !bulkAssigneeId} className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-100 disabled:opacity-60">
                      Assign Selected
                    </button>
                    <button type="button" onClick={() => void handleBulkStatusUpdate()} disabled={bulkSaving || !bulkSelectedCount} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-60">
                      {bulkSaving ? 'Applying...' : 'Update Status'}
                    </button>
                  </div>
                  {bulkFeedback ? (
                    <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${bulkFeedback.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                      <div className="font-bold">
                        {bulkFeedback.failureCount
                          ? `${bulkFeedback.actionLabel} completed with partial results`
                          : `${bulkFeedback.actionLabel} completed successfully`}
                      </div>
                      <div className="mt-1">
                        {bulkFeedback.successCount} request{bulkFeedback.successCount === 1 ? '' : 's'} succeeded
                        {bulkFeedback.failureCount ? `, ${bulkFeedback.failureCount} failed and remain selected for follow-up.` : '.'}
                      </div>
                      {bulkFeedback.failedRequestIds.length ? (
                        <div className="mt-2 text-xs font-semibold uppercase tracking-wider">
                          Failed IDs: {bulkFeedback.failedRequestIds.map((requestId) => requestId.slice(0, 8)).join(', ')}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="mb-3 flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-600 lg:hidden">
                  <div className="font-semibold text-zinc-900">Compact table mode</div>
                  <div>Requester, assignee, and updated details collapse into each row on smaller screens.</div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-zinc-200">
                  <table className="min-w-full divide-y divide-zinc-200">
                    <thead className="bg-zinc-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                          <input
                            type="checkbox"
                            checked={section.items.length > 0 && section.items.every((request) => selectedBulkRequestIds.includes(request.id))}
                            onChange={() => toggleBulkSection(section.items.map((request) => request.id))}
                            className="h-4 w-4 rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">Request</th>
                        <th className="hidden px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500 xl:table-cell">Requester</th>
                        <th className="hidden px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500 xl:table-cell">Assignee</th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">Status</th>
                        <th className="hidden px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500 lg:table-cell">Updated</th>
                        <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white">
                      {section.items.map((request) => {
                        const isSelected = selectedTableRequestId === request.id;
                        const isEnrollmentRequest = request.type === ENROLLMENT_REQUEST_TYPE;
                        const enrollmentDetails = isEnrollmentRequest ? parseEnrollmentDetails(request.description) : null;
                        const deviceLookupKey = (enrollmentDetails?.['asset tag / host'] || '').trim().toLowerCase();
                        const linkedDeviceId = deviceLookupKey ? deviceIdByEnrollmentKey.get(deviceLookupKey) : undefined;
                        const enrollmentOwner = enrollmentDetails?.['requester name'] || request.requester?.fullName || '-';
                        const enrollmentAsset = enrollmentDetails?.['asset tag / host'] || 'Pending asset match';
                        const enrollmentDepartment = enrollmentDetails?.department || 'Department pending';
                        const isBulkSelected = selectedBulkRequestIds.includes(request.id);

                        return (
                          <tr key={request.id} className={isEnrollmentRequest ? (isSelected ? 'bg-sky-50/80 ring-1 ring-inset ring-sky-200' : 'bg-sky-50/40 hover:bg-sky-50/70') : (isSelected ? 'bg-brand-50/40' : 'hover:bg-zinc-50')}>
                            <td className="px-4 py-4 align-top">
                              <input
                                type="checkbox"
                                checked={isBulkSelected}
                                onChange={() => toggleBulkRequest(request.id)}
                                className="mt-1 h-4 w-4 rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
                              />
                            </td>
                            <td className="px-4 py-4 align-top">
                              <button type="button" onClick={() => setSelectedTableRequestId(request.id)} className={`text-left ${isEnrollmentRequest ? 'rounded-xl border border-sky-200 bg-white/90 p-3 shadow-sm' : ''}`}>
                                <div className="flex flex-wrap items-center gap-2">
                                  {isEnrollmentRequest ? (
                                    <span className="inline-flex rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-sky-700">
                                      Enrollment Review
                                    </span>
                                  ) : null}
                                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{request.id.slice(0, 8)}</span>
                                </div>
                                <div className="mt-2 font-semibold text-zinc-900">{request.title}</div>
                                {isEnrollmentRequest ? (
                                  <div className="mt-2 space-y-1 text-xs text-sky-800">
                                    <div><span className="font-bold uppercase tracking-wider text-sky-700">Asset</span> {enrollmentAsset}</div>
                                    <div><span className="font-bold uppercase tracking-wider text-sky-700">Owner</span> {enrollmentOwner}</div>
                                    <div><span className="font-bold uppercase tracking-wider text-sky-700">Department</span> {enrollmentDepartment}</div>
                                  </div>
                                ) : null}
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                                  <span>{formatTypeLabel(request.type)}</span>
                                  <span>{request.comments.length} comments</span>
                                  {isEnrollmentRequest ? <span>{linkedDeviceId ? 'Device linked' : 'Awaiting device link'}</span> : null}
                                </div>
                                <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-2 xl:hidden">
                                  <div>
                                    <span className="font-bold uppercase tracking-wider text-zinc-500">Requester</span> {isEnrollmentRequest ? enrollmentOwner : (request.requester?.fullName || '-')}
                                  </div>
                                  <div>
                                    <span className="font-bold uppercase tracking-wider text-zinc-500">Assignee</span> {request.assignee?.fullName || (isEnrollmentRequest ? 'Needs IT review' : 'Unassigned')}
                                  </div>
                                  <div className="sm:col-span-2 lg:hidden">
                                    <span className="font-bold uppercase tracking-wider text-zinc-500">Updated</span> {formatRelativeTime(request.updatedAt)}
                                  </div>
                                </div>
                              </button>
                            </td>
                            <td className="hidden px-4 py-4 text-sm text-zinc-700 xl:table-cell">{isEnrollmentRequest ? enrollmentOwner : (request.requester?.fullName || '-')}</td>
                            <td className="hidden px-4 py-4 text-sm text-zinc-700 xl:table-cell">{request.assignee?.fullName || (isEnrollmentRequest ? 'Needs IT review' : 'Unassigned')}</td>
                            <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusClasses(request.status)}`}>{formatStatusLabel(request.status)}</span></td>
                            <td className="hidden px-4 py-4 text-sm text-zinc-700 lg:table-cell">{formatRelativeTime(request.updatedAt)}</td>
                            <td className="px-4 py-4">
                              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                <button type="button" onClick={() => setSelectedTableRequestId(request.id)} className={`rounded-lg px-3 py-2 text-xs font-bold ${isEnrollmentRequest ? 'border border-sky-200 bg-sky-100 text-sky-700 hover:bg-sky-200' : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100'}`}>Inspect</button>
                                {isEnrollmentRequest ? (
                                  <>
                                    <button type="button" onClick={() => void handleQuickStatusUpdate(request.id, 'in_progress', 'Enrollment review started by IT team.')} disabled={savingId === request.id || request.status === 'in_progress'} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-60">Start</button>
                                    <button type="button" onClick={() => void handleApproveAndOpenDevice(request.id, linkedDeviceId)} disabled={savingId === request.id || !linkedDeviceId} className="rounded-lg border border-brand-300 bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60">Approve</button>
                                  </>
                                ) : (
                                  <button type="button" onClick={() => void handleQuickStatusUpdate(request.id, 'in_progress', 'Support request moved into active handling.')} disabled={savingId === request.id || request.status === 'in_progress'} className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-100 disabled:opacity-60">Start</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {(() => {
                  const selectedRequest = section.items.find((request) => request.id === selectedTableRequestId) || section.items[0];
                  return selectedRequest ? (
                    <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                      <div className="border-b border-zinc-200 px-5 py-4">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Selected Request</div>
                        <div className="mt-1 text-sm text-zinc-600">Table view is for scanning. Full request controls stay available below for the selected row.</div>
                      </div>
                      {renderRequestDetail(selectedRequest, 'bg-white px-5 py-5')}
                    </div>
                  ) : null;
                })()}
              </div>
            ) : null}
          </section>
        );
      })}

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <Pagination
          currentPage={currentPage}
          totalItems={totalRequests}
          pageSize={REQUESTS_PAGE_SIZE}
          onPageChange={setCurrentPage}
          itemLabel="requests"
        />
      </div>
    </div>
  );
}
