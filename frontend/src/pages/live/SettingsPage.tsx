import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, Settings2 } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { apiRequest } from '../../lib/api';
import { getStoredSession } from '../../lib/session';
import { isProbeLikeUser } from '../../lib/userVisibility';

const LINUX_HARDINFO_PREFERENCE_KEY = 'itms_install_linux_hardinfo_fallback';
const REQUEST_ROUTE_TYPES = ['Laptop change', 'OS reinstall', 'Software install', 'Portal access', 'Settings change', 'General issue', 'Hardware replacement', 'Peripheral request', 'Other'];

interface InstallAgentConfig {
  publicServerUrl: string;
  inventoryIngestToken: string;
  saltMasterHost: string;
  wazuhManagerHost: string;
  saltApiConfigured: boolean;
  wazuhApiConfigured: boolean;
  portalInstallReady: boolean;
}

interface SyncStatus {
  enabled: boolean;
  configured: boolean;
  sourceType: string;
  interval: string;
  running: boolean;
  nextRunAt?: string;
  lastRun?: {
    status: string;
    startedAt: string;
    finishedAt?: string;
    recordsSeen: number;
    recordsUpserted: number;
    error?: string;
  };
}

interface LookupOption {
  id: string;
  name: string;
}

interface UserMetaOptionsResponse {
  roles: LookupOption[];
  departments: LookupOption[];
  branches: LookupOption[];
}

interface WorkflowRoute {
  match: string;
  assigneeId: string;
}

interface WorkflowSettings {
  requestAutoAssignEnabled: boolean;
  chatAutoCreateEnabled: boolean;
  chatAutoRouteEnabled: boolean;
  requestFallbackAssigneeId: string | null;
  chatFallbackAssigneeId: string | null;
  ticketAssigneeIds: string[];
  chatMemberIds: string[];
  requestTypeRoutes: WorkflowRoute[];
  requestSubjectRoutes: WorkflowRoute[];
  chatSubjectRoutes: WorkflowRoute[];
  updatedAt?: string;
}

interface DirectoryUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  employeeCode?: string;
}

interface ApiDirectoryUser {
  id: string;
  full_name?: string;
  fullName?: string;
  email: string;
  role: string;
  emp_id?: string;
}

interface PendingWorkflowMemberAction {
  kind: 'add' | 'remove';
  key: 'ticketAssigneeIds' | 'chatMemberIds';
  userId: string;
  userName: string;
}

interface PaginatedUsersResponse {
  items: ApiDirectoryUser[];
}

function normalizeDirectoryUsers(items: ApiDirectoryUser[]) {
  return items.map((user) => ({
    id: user.id,
    fullName: user.fullName || user.full_name || user.email || user.id,
    email: user.email,
    role: user.role,
    employeeCode: user.emp_id,
  }));
}

function isProbeWorkflowUser(user: DirectoryUser) {
  return isProbeLikeUser(user);
}

function defaultWorkflowSettings(): WorkflowSettings {
  return {
    requestAutoAssignEnabled: false,
    chatAutoCreateEnabled: true,
    chatAutoRouteEnabled: false,
    requestFallbackAssigneeId: null,
    chatFallbackAssigneeId: null,
    ticketAssigneeIds: [],
    chatMemberIds: [],
    requestTypeRoutes: [],
    requestSubjectRoutes: [],
    chatSubjectRoutes: [],
  };
}

function normalizeWorkflowSettings(settings: WorkflowSettings): WorkflowSettings {
  return {
    ...settings,
    requestFallbackAssigneeId: settings.requestFallbackAssigneeId || null,
    chatFallbackAssigneeId: settings.chatFallbackAssigneeId || null,
    ticketAssigneeIds: settings.ticketAssigneeIds || [],
    chatMemberIds: settings.chatMemberIds || [],
    requestTypeRoutes: settings.requestTypeRoutes || [],
    requestSubjectRoutes: settings.requestSubjectRoutes || [],
    chatSubjectRoutes: settings.chatSubjectRoutes || [],
  };
}

function serializeWorkflowSettings(settings: WorkflowSettings) {
  return {
    ...settings,
    requestFallbackAssigneeId: settings.requestFallbackAssigneeId ?? '',
    chatFallbackAssigneeId: settings.chatFallbackAssigneeId ?? '',
  };
}

function routesToEditorText(routes: WorkflowRoute[]) {
  return routes.map((route) => `${route.match} => ${route.assigneeId}`).join('\n');
}

function editorTextToRoutes(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [match, assigneeId] = line.includes('=>') ? line.split('=>') : line.split('=');
      return {
        match: (match || '').trim(),
        assigneeId: (assigneeId || '').trim(),
      };
    })
    .filter((route) => route.match && route.assigneeId);
}

function workflowTypeAssignee(settings: WorkflowSettings | null, type: string) {
  const route = settings?.requestTypeRoutes.find((item) => item.match.toLowerCase() === type.toLowerCase());
  return route?.assigneeId || '';
}

function quoteShell(value: string) {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function quotePowerShell(value: string) {
  return `'${value.replace(/'/g, `''`)}'`;
}

function buildLinuxArgumentString(args: Array<[string, string]>) {
  return args.map(([key, value]) => `--${key} ${quoteShell(value)}`).join(' ');
}

function buildWindowsArgumentString(args: Array<[string, string]>) {
  return args.map(([key, value]) => `-${key.replace(/(^|-)([a-z])/g, (_, prefix: string, chr: string) => `${prefix === '-' ? '' : ''}${chr.toUpperCase()}`)} ${quotePowerShell(value)}`).join(' ');
}

function buildSettingsLinuxBootstrapCommand(config?: InstallAgentConfig | null, includeHardinfoFallback = true) {
  const serverUrl = config?.publicServerUrl || '<ITMS_SERVER_URL>';
  const ingestToken = config?.inventoryIngestToken || '<INVENTORY_INGEST_TOKEN>';
  const saltMaster = config?.saltMasterHost || '<SALT_MASTER>';
  const wazuhManager = config?.wazuhManagerHost || '<WAZUH_MANAGER>';
  const installArgs: Array<[string, string]> = [
    ['server-url', serverUrl],
    ['token', ingestToken],
    ['category', 'auto'],
    ['assigned-to-name', '<EMPLOYEE_NAME>'],
    ['assigned-to-email', '<EMPLOYEE_EMAIL>'],
    ['employee-code', '<EMPLOYEE_ID>'],
    ['department-name', '<DEPARTMENT>'],
    ['salt-master', saltMaster],
    ['wazuh-manager', wazuhManager],
    ['notes', 'Installed by ITMS bootstrap'],
  ];
  const commandParts = [buildLinuxArgumentString(installArgs)];
  if (includeHardinfoFallback) {
    commandParts.push('--use-hardinfo-fallback');
  }
  return `curl -fsSL ${quoteShell(`${serverUrl}/installers/install-itms-agent.sh`)} -o /tmp/install-itms-agent.sh && sudo bash /tmp/install-itms-agent.sh ${commandParts.join(' ')}`;
}

function buildSettingsWindowsBootstrapCommand(config?: InstallAgentConfig | null) {
  const serverUrl = config?.publicServerUrl || '<ITMS_SERVER_URL>';
  const ingestToken = config?.inventoryIngestToken || '<INVENTORY_INGEST_TOKEN>';
  const saltMaster = config?.saltMasterHost || '<SALT_MASTER>';
  const wazuhManager = config?.wazuhManagerHost || '<WAZUH_MANAGER>';
  const installArgs: Array<[string, string]> = [
    ['server-url', serverUrl],
    ['token', ingestToken],
    ['category', 'auto'],
    ['use-detailed-hardware-inventory', '$true'],
    ['assigned-to-name', '<EMPLOYEE_NAME>'],
    ['assigned-to-email', '<EMPLOYEE_EMAIL>'],
    ['employee-code', '<EMPLOYEE_ID>'],
    ['department-name', '<DEPARTMENT>'],
    ['salt-master', saltMaster],
    ['wazuh-manager', wazuhManager],
    ['notes', 'Installed by ITMS bootstrap'],
  ];
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$scriptPath = Join-Path $env:TEMP 'install-itms-agent.ps1'; Invoke-WebRequest ${quotePowerShell(`${serverUrl}/installers/install-itms-agent.ps1`)} -OutFile $scriptPath; & $scriptPath ${buildWindowsArgumentString(installArgs)}"`;
}

function buildSettingsLinuxSyncCommand(config?: InstallAgentConfig | null, includeHardinfoFallback = true) {
  const serverUrl = config?.publicServerUrl || '<ITMS_SERVER_URL>';
  const ingestToken = config?.inventoryIngestToken || '<INVENTORY_INGEST_TOKEN>';
  const commandParts = [
    `sudo /usr/bin/python3 /opt/itms/push-system-inventory.py --server-url ${quoteShell(serverUrl)} --token ${quoteShell(ingestToken)} --category 'auto'`,
  ];
  if (includeHardinfoFallback) {
    commandParts.push('--use-hardinfo-fallback');
  }
  return commandParts.join(' ');
}

function buildSettingsWindowsSyncCommand(config?: InstallAgentConfig | null) {
  const serverUrl = config?.publicServerUrl || '<ITMS_SERVER_URL>';
  const ingestToken = config?.inventoryIngestToken || '<INVENTORY_INGEST_TOKEN>';
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\ProgramData\\ITMS\\push-system-inventory.ps1" -ServerUrl ${quotePowerShell(serverUrl)} -Token ${quotePowerShell(ingestToken)} -Category 'auto' -UseDetailedHardwareInventory $true`;
}

function formatDateTime(value?: string) {
  if (!value) {
    return 'Not available';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
      {label}
    </span>
  );
}

export default function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = getStoredSession();
  const portalLabel = useMemo(() => {
    if (location.pathname.startsWith('/admin')) {
      return 'Super Admin Portal';
    }
    if (location.pathname.startsWith('/it')) {
      return 'IT Portal';
    }
    return 'Portal';
  }, [location.pathname]);

  const [installConfig, setInstallConfig] = useState<InstallAgentConfig | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [meta, setMeta] = useState<UserMetaOptionsResponse | null>(null);
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings | null>(null);
  const [requestWorkflowUsers, setRequestWorkflowUsers] = useState<DirectoryUser[]>([]);
  const [chatWorkflowUsers, setChatWorkflowUsers] = useState<DirectoryUser[]>([]);
  const [ticketAssigneeDraft, setTicketAssigneeDraft] = useState('');
  const [chatMemberDraft, setChatMemberDraft] = useState('');
  const [requestSubjectEditor, setRequestSubjectEditor] = useState('');
  const [chatSubjectEditor, setChatSubjectEditor] = useState('');
  const [pendingWorkflowMemberAction, setPendingWorkflowMemberAction] = useState<PendingWorkflowMemberAction | null>(null);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [workflowSaveStatus, setWorkflowSaveStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState<'linux' | 'windows' | 'linux-sync' | 'windows-sync' | ''>('');
  const [includeLinuxHardinfoFallback, setIncludeLinuxHardinfoFallback] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.localStorage.getItem(LINUX_HARDINFO_PREFERENCE_KEY) !== 'false';
  });

  const linuxBootstrapCommand = useMemo(
    () => buildSettingsLinuxBootstrapCommand(installConfig, includeLinuxHardinfoFallback),
    [includeLinuxHardinfoFallback, installConfig],
  );
  const windowsBootstrapCommand = useMemo(
    () => buildSettingsWindowsBootstrapCommand(installConfig),
    [installConfig],
  );
  const linuxSyncCommand = useMemo(
    () => buildSettingsLinuxSyncCommand(installConfig, includeLinuxHardinfoFallback),
    [includeLinuxHardinfoFallback, installConfig],
  );
  const windowsSyncCommand = useMemo(
    () => buildSettingsWindowsSyncCommand(installConfig),
    [installConfig],
  );
  const canViewWorkflowSettings = session?.user.role === 'super_admin' || session?.user.role === 'it_team';
  const canEditWorkflowSettings = session?.user.role === 'super_admin';
  const usersImportPath = location.pathname.startsWith('/admin') ? '/admin/users' : '/it/users';
  const hasActiveEmployeeWorkflowUsers = useMemo(
    () => requestWorkflowUsers.some((user) => user.role === 'employee'),
    [requestWorkflowUsers],
  );
  const availableTicketAssigneeOptions = useMemo(
    () => requestWorkflowUsers.filter((user) => !workflowSettings?.ticketAssigneeIds.includes(user.id)),
    [requestWorkflowUsers, workflowSettings?.ticketAssigneeIds],
  );
  const ticketAssigneeUsers = useMemo(() => {
    if (!workflowSettings || workflowSettings.ticketAssigneeIds.length === 0) {
      return requestWorkflowUsers;
    }
    return requestWorkflowUsers.filter((user) => workflowSettings.ticketAssigneeIds.includes(user.id));
  }, [requestWorkflowUsers, workflowSettings]);
  const chatMemberUsers = useMemo(() => {
    if (!workflowSettings || workflowSettings.chatMemberIds.length === 0) {
      return chatWorkflowUsers;
    }
    return chatWorkflowUsers.filter((user) => workflowSettings.chatMemberIds.includes(user.id));
  }, [chatWorkflowUsers, workflowSettings]);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async (background = false) => {
      try {
        if (background) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError('');

        const [installData, syncData, metaData, workflowData, requestWorkflowUsersData, chatWorkflowUsersData] = await Promise.all([
          apiRequest<InstallAgentConfig>('/api/integrations/install-config').catch(() => null),
          apiRequest<SyncStatus>('/api/inventory-sync/status').catch(() => null),
          apiRequest<UserMetaOptionsResponse>('/api/users/meta/options').catch(() => null),
          canViewWorkflowSettings ? apiRequest<WorkflowSettings>('/api/settings/workflow').catch(() => defaultWorkflowSettings()) : Promise.resolve(null),
          canViewWorkflowSettings
            ? apiRequest<PaginatedUsersResponse>('/api/users?paginate=1&page=1&page_size=2000&status=active').catch(() => ({ items: [] }))
            : Promise.resolve({ items: [] }),
          canViewWorkflowSettings
            ? apiRequest<PaginatedUsersResponse>('/api/users?paginate=1&page=1&page_size=500&role=it_team&role=super_admin&status=active').catch(() => ({ items: [] }))
            : Promise.resolve({ items: [] }),
        ]);

        if (!cancelled) {
          const normalizedWorkflowData = workflowData ? normalizeWorkflowSettings(workflowData) : workflowData;
          const requestWorkflowUserItems = normalizeDirectoryUsers(requestWorkflowUsersData.items || []).filter((user) => !isProbeWorkflowUser(user));
          const chatWorkflowUserItems = normalizeDirectoryUsers(chatWorkflowUsersData.items || []);
          setInstallConfig(installData);
          setSyncStatus(syncData);
          setMeta(metaData);
          setWorkflowSettings(normalizedWorkflowData);
          setRequestWorkflowUsers(requestWorkflowUserItems);
          setChatWorkflowUsers(chatWorkflowUserItems);
          setRequestSubjectEditor(routesToEditorText(normalizedWorkflowData?.requestSubjectRoutes ?? []));
          setChatSubjectEditor(routesToEditorText(normalizedWorkflowData?.chatSubjectRoutes ?? []));
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load settings');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [canViewWorkflowSettings]);

  useEffect(() => {
    window.localStorage.setItem(LINUX_HARDINFO_PREFERENCE_KEY, includeLinuxHardinfoFallback ? 'true' : 'false');
  }, [includeLinuxHardinfoFallback]);

  const handleCopyCommand = async (kind: 'linux' | 'windows' | 'linux-sync' | 'windows-sync', command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyStatus(kind);
      window.setTimeout(() => setCopyStatus((current) => (current === kind ? '' : current)), 1500);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Failed to copy command');
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setError('');
      const [installData, syncData, metaData, workflowData, requestWorkflowUsersData, chatWorkflowUsersData] = await Promise.all([
        apiRequest<InstallAgentConfig>('/api/integrations/install-config').catch(() => null),
        apiRequest<SyncStatus>('/api/inventory-sync/status').catch(() => null),
        apiRequest<UserMetaOptionsResponse>('/api/users/meta/options').catch(() => null),
        canViewWorkflowSettings ? apiRequest<WorkflowSettings>('/api/settings/workflow').catch(() => defaultWorkflowSettings()) : Promise.resolve(null),
        canViewWorkflowSettings
          ? apiRequest<PaginatedUsersResponse>('/api/users?paginate=1&page=1&page_size=2000&status=active').catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
        canViewWorkflowSettings
          ? apiRequest<PaginatedUsersResponse>('/api/users?paginate=1&page=1&page_size=500&role=it_team&role=super_admin&status=active').catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
      ]);
      const normalizedWorkflowData = workflowData ? normalizeWorkflowSettings(workflowData) : workflowData;
      const requestWorkflowUserItems = normalizeDirectoryUsers(requestWorkflowUsersData.items || []).filter((user) => !isProbeWorkflowUser(user));
      const chatWorkflowUserItems = normalizeDirectoryUsers(chatWorkflowUsersData.items || []);
      setInstallConfig(installData);
      setSyncStatus(syncData);
      setMeta(metaData);
      setWorkflowSettings(normalizedWorkflowData);
      setRequestWorkflowUsers(requestWorkflowUserItems);
      setChatWorkflowUsers(chatWorkflowUserItems);
      setRequestSubjectEditor(routesToEditorText(normalizedWorkflowData?.requestSubjectRoutes ?? []));
      setChatSubjectEditor(routesToEditorText(normalizedWorkflowData?.chatSubjectRoutes ?? []));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to refresh settings');
    } finally {
      setRefreshing(false);
    }
  };

  const handleWorkflowTypeChange = (type: string, assigneeId: string) => {
    setWorkflowSettings((current) => {
      if (!current) {
        return current;
      }
      const remaining = current.requestTypeRoutes.filter((route) => route.match.toLowerCase() !== type.toLowerCase());
      return {
        ...current,
        requestTypeRoutes: assigneeId ? [...remaining, { match: type, assigneeId }] : remaining,
      };
    });
  };

  const workflowMemberScopeLabel = (key: 'ticketAssigneeIds' | 'chatMemberIds') => key === 'ticketAssigneeIds' ? 'ticket assignee list' : 'chat member list';

  const findWorkflowUserName = (userId: string) => requestWorkflowUsers.find((user) => user.id === userId)?.fullName || chatWorkflowUsers.find((user) => user.id === userId)?.fullName || 'Selected teammate';

  const addWorkflowMember = (key: 'ticketAssigneeIds' | 'chatMemberIds', userId: string) => {
    if (!userId) {
      return;
    }
    setWorkflowSettings((current) => {
      if (!current || current[key].includes(userId)) {
        return current;
      }
      return {
        ...current,
        [key]: [...current[key], userId],
      };
    });
  };

  const openAddWorkflowMemberDialog = (key: 'ticketAssigneeIds' | 'chatMemberIds', userId: string) => {
    if (!userId) {
      return;
    }
    setPendingWorkflowMemberAction({ kind: 'add', key, userId, userName: findWorkflowUserName(userId) });
  };

  const openRemoveWorkflowMemberDialog = (key: 'ticketAssigneeIds' | 'chatMemberIds', userId: string) => {
    setPendingWorkflowMemberAction({ kind: 'remove', key, userId, userName: findWorkflowUserName(userId) });
  };

  const handleConfirmWorkflowMemberAction = () => {
    if (!pendingWorkflowMemberAction) {
      return;
    }
    if (pendingWorkflowMemberAction.kind === 'add') {
      addWorkflowMember(pendingWorkflowMemberAction.key, pendingWorkflowMemberAction.userId);
      if (pendingWorkflowMemberAction.key === 'ticketAssigneeIds') {
        setTicketAssigneeDraft('');
      } else {
        setChatMemberDraft('');
      }
    } else {
      removeWorkflowMember(pendingWorkflowMemberAction.key, pendingWorkflowMemberAction.userId);
    }
    setPendingWorkflowMemberAction(null);
  };

  const removeWorkflowMember = (key: 'ticketAssigneeIds' | 'chatMemberIds', userId: string) => {
    setWorkflowSettings((current) => {
      if (!current) {
        return current;
      }
      const next = current[key].filter((id) => id !== userId);
      return {
        ...current,
        [key]: next,
        requestFallbackAssigneeId: key === 'ticketAssigneeIds' && current.requestFallbackAssigneeId === userId ? null : current.requestFallbackAssigneeId,
        chatFallbackAssigneeId: key === 'chatMemberIds' && current.chatFallbackAssigneeId === userId ? null : current.chatFallbackAssigneeId,
      };
    });
  };

  const handleWorkflowSave = async () => {
    if (!workflowSettings) {
      return;
    }
    try {
      setSavingWorkflow(true);
      setError('');
      setWorkflowSaveStatus('');
      const saved = await apiRequest<WorkflowSettings>('/api/settings/workflow', {
        method: 'PUT',
        body: JSON.stringify({
          ...serializeWorkflowSettings(workflowSettings),
          requestSubjectRoutes: editorTextToRoutes(requestSubjectEditor),
          chatSubjectRoutes: editorTextToRoutes(chatSubjectEditor),
        }),
      });
      const normalizedSaved = normalizeWorkflowSettings(saved);
      setWorkflowSettings(normalizedSaved);
      setRequestSubjectEditor(routesToEditorText(normalizedSaved.requestSubjectRoutes));
      setChatSubjectEditor(routesToEditorText(normalizedSaved.chatSubjectRoutes));
      setWorkflowSaveStatus('Saved');
      window.setTimeout(() => setWorkflowSaveStatus((current) => (current === 'Saved' ? '' : current)), 1600);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save workflow settings');
    } finally {
      setSavingWorkflow(false);
    }
  };

  return (
    <div className="space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-zinc-700">
            {canEditWorkflowSettings ? 'Super Admin Settings' : 'View Settings'}
          </div>
          <h1 className="mt-3 flex items-center gap-3 text-2xl font-bold tracking-tight text-zinc-900">
            <Settings2 className="h-7 w-7 text-brand-600" />
            View Settings
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            {portalLabel} can view current installation, sync, and directory settings from the running backend.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-bold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Endpoint Onboarding</div><div className="mt-2 text-xl font-bold text-zinc-900">{loading ? '...' : installConfig?.portalInstallReady ? 'Ready' : 'Not Ready'}</div><div className="mt-2"><StatusPill ok={Boolean(installConfig?.portalInstallReady)} label={installConfig?.portalInstallReady ? 'Configured' : 'Missing server URL or token'} /></div></div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Inventory Sync</div><div className="mt-2 text-xl font-bold text-zinc-900">{loading ? '...' : syncStatus?.running ? 'Running' : syncStatus?.enabled ? 'Idle' : 'Disabled'}</div><div className="mt-2"><StatusPill ok={Boolean(syncStatus?.enabled && syncStatus?.configured)} label={syncStatus?.enabled && syncStatus?.configured ? 'Active' : 'Not Ready'} /></div></div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Departments</div><div className="mt-2 text-xl font-bold text-zinc-900">{loading ? '...' : meta?.departments.length ?? 0}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"><div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Branches</div><div className="mt-2 text-xl font-bold text-zinc-900">{loading ? '...' : meta?.branches.length ?? 0}</div></div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-5 py-4">
            <h2 className="text-lg font-bold text-zinc-900">Platform Status</h2>
            <p className="mt-1 text-sm text-zinc-500">Current backend values.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Portal API</div>
              <div className="mt-2 break-all text-sm font-semibold text-zinc-900">{installConfig?.publicServerUrl || 'Not configured'}</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Sync Interval</div>
              <div className="mt-2 text-sm font-semibold text-zinc-900">{syncStatus?.interval || 'Not available'}</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Salt Master</div>
              <div className="mt-2 text-sm font-semibold text-zinc-900">{installConfig?.saltMasterHost || 'Not configured'}</div>
              <div className="mt-2"><StatusPill ok={Boolean(installConfig?.saltApiConfigured)} label={installConfig?.saltApiConfigured ? 'Connected' : 'Optional integration not configured'} /></div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Wazuh Manager</div>
              <div className="mt-2 text-sm font-semibold text-zinc-900">{installConfig?.wazuhManagerHost || 'Not configured'}</div>
              <div className="mt-2"><StatusPill ok={Boolean(installConfig?.wazuhApiConfigured)} label={installConfig?.wazuhApiConfigured ? 'Connected' : 'Optional integration not configured'} /></div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 md:col-span-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Last Inventory Run</div>
              <div className="mt-2 text-sm font-semibold text-zinc-900">{formatDateTime(syncStatus?.lastRun?.startedAt)}</div>
              <p className="mt-2 text-sm text-zinc-500">
                Status: {syncStatus?.lastRun?.status || 'Unknown'} • Records seen: {syncStatus?.lastRun?.recordsSeen ?? 0} • Upserted: {syncStatus?.lastRun?.recordsUpserted ?? 0}
              </p>
              {syncStatus?.lastRun?.error ? <p className="mt-2 text-sm text-rose-600">{syncStatus.lastRun.error}</p> : null}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-5 py-4">
            <h2 className="text-lg font-bold text-zinc-900">Portal Context</h2>
            <p className="mt-1 text-sm text-zinc-500">Read-only portal information for the current user.</p>
          </div>
          <div className="space-y-3 p-5">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Signed In As</div>
              <div className="mt-2 text-base font-bold text-zinc-900">{session?.user.fullName || 'Unknown user'}</div>
              <p className="mt-1 text-sm text-zinc-500">{session?.user.email || 'No email'} • {session?.user.role || 'No role'}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Default Portal</div>
              <div className="mt-2 text-sm font-semibold text-zinc-900">{session?.user.defaultPortal || 'Not set'}</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Departments</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(meta?.departments || []).slice(0, 16).map((department) => (
                  <span key={department.id} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
                    {department.name}
                  </span>
                ))}
                {!meta?.departments?.length ? <span className="text-sm text-zinc-500">No departments returned by the backend.</span> : null}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Branches</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(meta?.branches || []).slice(0, 16).map((branch) => (
                  <span key={branch.id} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
                    {branch.name}
                  </span>
                ))}
                {!meta?.branches?.length ? <span className="text-sm text-zinc-500">No branches returned by the backend.</span> : null}
              </div>
            </div>
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">
              Next run: {formatDateTime(syncStatus?.nextRunAt)}
            </div>
          </div>
        </section>
      </div>

      {canViewWorkflowSettings && workflowSettings ? (
        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-5 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-zinc-900">Workflow Routing</h2>
                <p className="mt-1 text-sm text-zinc-500">Control request auto-assignment and chat subject routing from one place.</p>
              </div>
              <div className="flex items-center gap-3">
                {workflowSettings.updatedAt ? <span className="text-xs font-semibold text-zinc-500">Updated {formatDateTime(workflowSettings.updatedAt)}</span> : null}
                <button
                  type="button"
                  onClick={handleWorkflowSave}
                  disabled={savingWorkflow || !canEditWorkflowSettings}
                  className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingWorkflow ? 'Saving...' : workflowSaveStatus || (canEditWorkflowSettings ? 'Save routing' : 'Super admin only')}
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-5 p-5">
            {!hasActiveEmployeeWorkflowUsers ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 lg:flex-row lg:items-center lg:justify-between">
                <span>No active employee users are available right now. Request routing can still use active IT and admin accounts, but employee assignees will not appear until employee users are imported or activated.</span>
                <button
                  type="button"
                  onClick={() => navigate(usersImportPath)}
                  className="inline-flex items-center justify-center rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
                >
                  Open Users Import
                </button>
              </div>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900">Ticket Assignee List</h3>
                    <p className="mt-1 text-xs text-zinc-500">Super admin can limit which active users appear for request assignment and request routing. Employee names show here only when active employee accounts exist.</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <select
                    value={ticketAssigneeDraft}
                    onChange={(event) => setTicketAssigneeDraft(event.target.value)}
                    disabled={!canEditWorkflowSettings}
                    className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:bg-zinc-100"
                  >
                    <option value="">{hasActiveEmployeeWorkflowUsers ? 'Select assignee' : 'Select assignee (active IT/admin only)'}</option>
                    {availableTicketAssigneeOptions.map((user) => (
                      <option key={user.id} value={user.id}>{user.fullName} • {user.role}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      openAddWorkflowMemberDialog('ticketAssigneeIds', ticketAssigneeDraft);
                    }}
                    disabled={!canEditWorkflowSettings || !ticketAssigneeDraft}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {workflowSettings.ticketAssigneeIds.length === 0 ? (
                    <span className="text-sm text-zinc-500">
                      {hasActiveEmployeeWorkflowUsers
                        ? 'All active users remain eligible until you add specific names.'
                        : 'All active IT and admin users remain eligible until employee accounts are added or you narrow this list.'}
                    </span>
                  ) : null}
                  {ticketAssigneeUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => openRemoveWorkflowMemberDialog('ticketAssigneeIds', user.id)}
                      disabled={!canEditWorkflowSettings}
                      className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 disabled:cursor-default"
                    >
                      {user.fullName} • Remove
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <div>
                  <h3 className="text-sm font-bold text-zinc-900">Chat Member List</h3>
                  <p className="mt-1 text-xs text-zinc-500">Controls which active IT team and super admin users can be routed in, assigned as backup owner, or added through chat controls.</p>
                </div>
                <div className="mt-3 flex gap-2">
                  <select
                    value={chatMemberDraft}
                    onChange={(event) => setChatMemberDraft(event.target.value)}
                    disabled={!canEditWorkflowSettings}
                    className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:bg-zinc-100"
                  >
                    <option value="">Select chat member</option>
                    {chatWorkflowUsers.filter((user) => !workflowSettings.chatMemberIds.includes(user.id)).map((user) => (
                      <option key={user.id} value={user.id}>{user.fullName} • {user.role}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      openAddWorkflowMemberDialog('chatMemberIds', chatMemberDraft);
                    }}
                    disabled={!canEditWorkflowSettings || !chatMemberDraft}
                    className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {workflowSettings.chatMemberIds.length === 0 ? <span className="text-sm text-zinc-500">All active IT team and super admin users remain eligible until you add specific names.</span> : null}
                  {chatMemberUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => openRemoveWorkflowMemberDialog('chatMemberIds', user.id)}
                      disabled={!canEditWorkflowSettings}
                      className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 disabled:cursor-default"
                    >
                      {user.fullName} • Remove
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                <span className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={workflowSettings.requestAutoAssignEnabled}
                    onChange={(event) => setWorkflowSettings((current) => current ? { ...current, requestAutoAssignEnabled: event.target.checked } : current)}
                    disabled={!canEditWorkflowSettings}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span>
                    <span className="block font-semibold text-zinc-900">Enable request auto-assignment</span>
                    <span className="mt-1 block text-xs text-zinc-500">Requests created by employees, IT, or admins will pick an assignee from the rules below.</span>
                  </span>
                </span>
              </label>
              <label className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                <span className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={workflowSettings.chatAutoRouteEnabled}
                    onChange={(event) => setWorkflowSettings((current) => current ? { ...current, chatAutoRouteEnabled: event.target.checked } : current)}
                    disabled={!canEditWorkflowSettings}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span>
                    <span className="block font-semibold text-zinc-900">Enable chat subject routing</span>
                    <span className="mt-1 block text-xs text-zinc-500">New channels can auto-add the right IT owner when the chat subject matches a rule.</span>
                  </span>
                </span>
              </label>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Request Fallback Assignee</span>
                <span className="mt-1 block text-xs text-zinc-500">Only users from the request assignee list appear here. If there are no active employees, this will currently be limited to active IT/admin users.</span>
                <select
                  value={workflowSettings.requestFallbackAssigneeId ?? ''}
                  onChange={(event) => setWorkflowSettings((current) => current ? { ...current, requestFallbackAssigneeId: event.target.value || null } : current)}
                  disabled={!canEditWorkflowSettings}
                  className="mt-3 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">No fallback assignee</option>
                  {ticketAssigneeUsers.map((user) => (
                    <option key={user.id} value={user.id}>{user.fullName} • {user.role}</option>
                  ))}
                </select>
              </label>
              <label className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Chat Fallback Assignee</span>
                <span className="mt-1 block text-xs text-zinc-500">Only users from the chat member list appear here.</span>
                <select
                  value={workflowSettings.chatFallbackAssigneeId ?? ''}
                  onChange={(event) => setWorkflowSettings((current) => current ? { ...current, chatFallbackAssigneeId: event.target.value || null } : current)}
                  disabled={!canEditWorkflowSettings}
                  className="mt-3 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">No fallback assignee</option>
                  {chatMemberUsers.map((user) => (
                    <option key={user.id} value={user.id}>{user.fullName} • {user.role}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-zinc-900">Request Type Owners</h3>
                <p className="mt-1 text-xs text-zinc-500">Assign fixed owners for the main request categories already used across the portal. Choices come from the request assignee list above, so this will reflect only active IT/admin users until employee accounts are available.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {REQUEST_ROUTE_TYPES.map((type) => (
                  <label key={type} className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
                    <span className="block font-semibold text-zinc-900">{type}</span>
                    <select
                      value={workflowTypeAssignee(workflowSettings, type)}
                      onChange={(event) => handleWorkflowTypeChange(type, event.target.value)}
                      disabled={!canEditWorkflowSettings}
                      className="mt-3 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                    >
                      <option value="">No dedicated owner</option>
                      {ticketAssigneeUsers.map((user) => (
                        <option key={user.id} value={user.id}>{user.fullName} • {user.role}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <label className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                <span className="block text-sm font-bold text-zinc-900">Request Subject Rules</span>
                <span className="mt-1 block text-xs text-zinc-500">One rule per line in the format keyword =&gt; assignee-id. These run after request type rules.</span>
                <textarea
                  value={requestSubjectEditor}
                  onChange={(event) => setRequestSubjectEditor(event.target.value)}
                  disabled={!canEditWorkflowSettings}
                  rows={8}
                  placeholder="portal access => user-uuid\nsoftware install => user-uuid"
                  className="mt-3 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 font-mono text-xs text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              </label>
              <label className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                <span className="block text-sm font-bold text-zinc-900">Chat Subject Rules</span>
                <span className="mt-1 block text-xs text-zinc-500">One rule per line in the format keyword =&gt; assignee-id. Matching channels auto-add that IT owner.</span>
                <textarea
                  value={chatSubjectEditor}
                  onChange={(event) => setChatSubjectEditor(event.target.value)}
                  disabled={!canEditWorkflowSettings}
                  rows={8}
                  placeholder="leave request => user-uuid\nos reinstall => user-uuid"
                  className="mt-3 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 font-mono text-xs text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              </label>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Leave-aware diversion is still not wired because the current platform does not expose a leave-status source for IT ownership handoff.
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 px-5 py-4">
          <h2 className="text-lg font-bold text-zinc-900">Bootstrap Commands</h2>
          <p className="mt-1 text-sm text-zinc-500">Generic endpoint setup commands with placeholders for employee fields.</p>
        </div>
        <div className="space-y-4 p-5">
          <label className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={includeLinuxHardinfoFallback}
              onChange={(event) => setIncludeLinuxHardinfoFallback(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              <span className="block font-semibold text-zinc-900">Include Linux hardinfo fallback</span>
              <span className="mt-1 block text-xs text-zinc-500">Controls whether the generic Linux install and sync commands include `--use-hardinfo-fallback`.</span>
            </span>
          </label>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Linux Install Code</div>
                <button
                  type="button"
                  onClick={() => void handleCopyCommand('linux', linuxBootstrapCommand)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                >
                  {copyStatus === 'linux' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <h3 className="mt-1 text-lg font-bold text-zinc-900">Ubuntu or Debian install + first sync</h3>
              <p className="mt-2 text-sm text-zinc-500">Uses current backend values and leaves employee-specific fields as placeholders.</p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-zinc-900 px-3 py-3 text-xs text-zinc-100">{linuxBootstrapCommand}</pre>

              <div className="mt-5 flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Linux Sync Code</div>
                <button
                  type="button"
                  onClick={() => void handleCopyCommand('linux-sync', linuxSyncCommand)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                >
                  {copyStatus === 'linux-sync' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-sm text-zinc-500">Run later on the same Linux system when you want another inventory push.</p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-zinc-900 px-3 py-3 text-xs text-zinc-100">{linuxSyncCommand}</pre>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Windows Install Code</div>
                <button
                  type="button"
                  onClick={() => void handleCopyCommand('windows', windowsBootstrapCommand)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                >
                  {copyStatus === 'windows' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <h3 className="mt-1 text-lg font-bold text-zinc-900">Windows install + first sync</h3>
              <p className="mt-2 text-sm text-zinc-500">Uses current backend values and keeps detailed hardware inventory explicit.</p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-zinc-900 px-3 py-3 text-xs text-zinc-100">{windowsBootstrapCommand}</pre>

              <div className="mt-5 flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Windows Sync Code</div>
                <button
                  type="button"
                  onClick={() => void handleCopyCommand('windows-sync', windowsSyncCommand)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                >
                  {copyStatus === 'windows-sync' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-sm text-zinc-500">Run later on the same Windows system when you want another inventory push.</p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-zinc-900 px-3 py-3 text-xs text-zinc-100">{windowsSyncCommand}</pre>
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(pendingWorkflowMemberAction)}
        title={pendingWorkflowMemberAction?.kind === 'remove' ? 'Remove Workflow Member' : 'Add Workflow Member'}
        message={pendingWorkflowMemberAction ? `${pendingWorkflowMemberAction.kind === 'remove' ? 'Remove' : 'Add'} ${pendingWorkflowMemberAction.userName} ${pendingWorkflowMemberAction.kind === 'remove' ? 'from' : 'to'} the ${workflowMemberScopeLabel(pendingWorkflowMemberAction.key)}?` : 'Confirm workflow member update.'}
        confirmLabel={pendingWorkflowMemberAction?.kind === 'remove' ? 'Remove' : 'Add'}
        tone={pendingWorkflowMemberAction?.kind === 'remove' ? 'danger' : 'default'}
        onClose={() => setPendingWorkflowMemberAction(null)}
        onConfirm={handleConfirmWorkflowMemberAction}
      />
    </div>
  );
}