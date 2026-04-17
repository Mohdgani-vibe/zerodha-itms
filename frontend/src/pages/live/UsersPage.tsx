import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Download, Mail, Search, ShieldAlert, ShieldCheck, Upload, Users as UsersIcon } from 'lucide-react';
import { apiRequest, resolveApiUrl } from '../../lib/api';
import { getStoredSession } from '../../lib/session';
import ConfirmDialog from '../../components/ConfirmDialog';
import Pagination from '../../components/Pagination';
import { isProbeLikeUser } from '../../lib/userVisibility';

const USERS_PAGE_SIZE = 18;
const AUDIT_PAGE_SIZE = 25;
const IMPORTED_DEVICES_PAGE_SIZE = 8;
const LINUX_HARDINFO_PREFERENCE_KEY = 'itms_install_linux_hardinfo_fallback';

interface UserRecord {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string;
  status: string;
  entityId?: string | null;
  departmentId?: string | null;
  branchId?: string | null;
  portals?: string[];
  role?: { name: string } | null;
  department?: { name: string } | null;
  branch?: { name: string } | null;
  _count?: { devices: number; items: number; assets: number };
}

interface ApiUserRecord {
  id: string;
  full_name: string;
  email: string;
  emp_id: string;
  status: string;
  entity_id?: string | null;
  dept_id?: string | null;
  location_id?: string | null;
  role: string;
  department?: string | null;
  location?: string | null;
  asset_count: number;
}

interface NamedCount {
  name: string;
  count: number;
}

interface PaginatedUsersResponse {
  items: ApiUserRecord[];
  total: number;
  page: number;
  pageSize: number;
  summary?: {
    departmentCounts?: NamedCount[];
    assetTotal?: number;
  };
}

interface DeviceAsset {
  id: string;
  assetTag: string;
  hostname: string;
  osName?: string | null;
  category?: string | null;
  serialNumber: string;
  specs: string;
  warrantyExpiresAt: string;
  assignedAt?: string;
  status: string;
  kind: 'device';
  name: string;
  toolStatus?: {
    salt?: { status: 'linked' | 'detected' | 'installed' | 'missing'; detail: string; identifier?: string | null };
    wazuh?: { status: 'linked' | 'detected' | 'installed' | 'missing'; detail: string; identifier?: string | null };
    openscap?: { status: 'linked' | 'detected' | 'installed' | 'missing'; detail: string; identifier?: string | null };
    clamav?: { status: 'linked' | 'detected' | 'installed' | 'missing'; detail: string; identifier?: string | null };
  };
}

interface StockAsset {
  id: string;
  itemCode: string;
  name: string;
  serialNumber: string;
  specs: string;
  warrantyExpiresAt: string;
  assignedAt?: string;
  status: string;
  kind: 'stock';
}

interface UserAssetsResponse {
  devices: DeviceAsset[];
  items: StockAsset[];
}

interface InstallAgentConfig {
  publicServerUrl: string;
  inventoryIngestToken: string;
  saltMasterHost: string;
  wazuhManagerHost: string;
  saltApiConfigured: boolean;
  wazuhApiConfigured: boolean;
  portalInstallReady: boolean;
}

interface InventoryDeviceRecord {
  id: string;
  assetId: string;
  hostname: string;
  deviceType?: string | null;
  osName?: string | null;
  status: string;
  user?: { fullName?: string; employeeCode?: string } | null;
}

interface EnrollmentRequestRecord {
  id: string;
  type: string;
  status: string;
  description: string;
}

interface PaginatedInventoryDevicesResponse {
  items: InventoryDeviceRecord[];
  total: number;
  page: number;
  pageSize: number;
}

interface PaginatedEnrollmentRequestsResponse {
  items: EnrollmentRequestRecord[];
  total: number;
  page: number;
  pageSize: number;
}

interface InstallationIdentity {
  requesterName?: string;
  requesterEmail?: string;
  employeeId?: string;
  department?: string;
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

interface InstallOverrides {
  assignedToName?: string;
  assignedToEmail?: string;
  employeeCode?: string;
  departmentName?: string;
  includeHardinfoFallback?: boolean;
}

interface PendingAssetAction {
  assetId: string;
  action: 'unassign' | 'delete';
}

const PRESET_DEPARTMENTS = [
  'Customer Support',
  'Account Opening',
  'ACOP Compliance',
  'Quality & Training',
  'NRI - Sales & Account Opening',
  'Z Team',
  'Process Team',
  'HR',
  'Travel Desk',
  'Admin',
  'Front Desk',
  'Varsity & Media Production',
  'Z Capital',
  'Z Tech',
];

const PORTAL_CHOICES = [
  { id: 'employee', label: 'Employee' },
  { id: 'it_team', label: 'IT Team' },
  { id: 'super_admin', label: 'Super Admin' },
] as const;

const PORTAL_LABELS = Object.fromEntries(PORTAL_CHOICES.map((portal) => [portal.id, portal.label])) as Record<string, string>;

function portalsForRole(role: string) {
  if (role === 'super_admin') {
    return ['super_admin', 'it_team', 'employee'];
  }
  if (role === 'it_team') {
    return ['it_team', 'employee'];
  }
  return ['employee'];
}

function normalizePortalSelection(portals: string[]) {
  const validPortalIds = new Set<string>(PORTAL_CHOICES.map((portal) => portal.id));
  const selected = new Set(
    portals
      .map((portal) => portal.trim())
      .filter((portal) => validPortalIds.has(portal)),
  );

  if (selected.has('super_admin')) {
    selected.add('it_team');
    selected.add('employee');
  }
  if (selected.has('it_team')) {
    selected.add('employee');
  }
  if (!selected.size) {
    selected.add('employee');
  }

  return PORTAL_CHOICES.map((portal) => portal.id).filter((portal) => selected.has(portal));
}

function formatPortalLabel(portalId: string) {
  return PORTAL_LABELS[portalId] || portalId.replaceAll('_', ' ');
}

function portalsToRole(portals: string[]) {
  const normalized = normalizePortalSelection(portals);
  if (normalized.includes('super_admin')) {
    return 'super_admin';
  }
  if (normalized.includes('it_team')) {
    return 'it_team';
  }
  return 'employee';
}

function mergeDepartmentSuggestions(options: LookupOption[]) {
  const seen = new Set<string>();
  const merged: LookupOption[] = [];

  [...PRESET_DEPARTMENTS, ...options.map((option) => option.name)]
    .map((name) => name.trim())
    .filter(Boolean)
    .forEach((name, index) => {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const existing = options.find((option) => option.name.trim().toLowerCase() === key);
      merged.push(existing || { id: `manual-${index}`, name });
    });

  return merged;
}

function normalizeUsers(data: ApiUserRecord[]): UserRecord[] {
  return data
    .filter((user) => !isProbeLikeUser({ fullName: user.full_name, email: user.email, employeeCode: user.emp_id }))
    .map((user) => ({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      employeeCode: user.emp_id,
      status: user.status,
      entityId: user.entity_id || null,
      departmentId: user.dept_id || null,
      branchId: user.location_id || null,
      portals: portalsForRole(user.role),
      role: { name: user.role },
      department: user.department ? { name: user.department } : null,
      branch: user.location ? { name: user.location } : null,
      _count: { devices: user.asset_count, items: 0, assets: user.asset_count },
    }));
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

const TOOL_STATUS_ITEMS = [
  ['salt', 'Salt'],
  ['wazuh', 'Wazuh'],
  ['openscap', 'OpenSCAP'],
  ['clamav', 'ClamAV'],
] as const;

function getToolBadgeClasses(status?: 'linked' | 'detected' | 'installed' | 'missing') {
  switch (status) {
    case 'linked':
      return 'bg-emerald-100 text-emerald-700';
    case 'installed':
      return 'bg-brand-100 text-brand-700';
    case 'detected':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-zinc-100 text-zinc-600';
  }
}

function formatToolStatusLabel(status?: 'linked' | 'detected' | 'installed' | 'missing') {
  switch (status) {
    case 'linked':
      return 'Linked';
    case 'installed':
      return 'Installed';
    case 'detected':
      return 'Detected';
    default:
      return 'Missing';
  }
}

interface AuditRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
  module?: string;
  actor?: { fullName: string; email: string } | null;
  subject?: { fullName: string } | null;
}

interface PaginatedAuditResponse {
  items: AuditRecord[];
  total: number;
  page: number;
  pageSize: number;
  summary?: {
    moduleCounts?: NamedCount[];
  };
}

type DirectoryTab = 'directory' | 'employee' | 'imports' | 'install' | 'access' | 'audit';
type AuditModule = 'all' | 'access' | 'assets' | 'gatepass' | 'chat' | 'terminal' | 'requests' | 'announcements' | 'alerts' | 'settings';

function getAuditModule(entry: AuditRecord): AuditModule {
  if (entry.entityType === 'user') {
    return 'access';
  }
  if (entry.entityType === 'device' || entry.entityType === 'stock_item' || entry.entityType === 'patch_job' || entry.entityType === 'asset') {
    return 'assets';
  }
  if (entry.entityType === 'gatepass') {
    return 'gatepass';
  }
  if (entry.entityType === 'chat_channel') {
    return 'chat';
  }
  if (entry.entityType === 'terminal_session') {
    return 'terminal';
  }
  if (entry.entityType === 'request') {
    return 'requests';
  }
  if (entry.entityType === 'announcement') {
    return 'announcements';
  }
  if (entry.entityType === 'alert') {
    return 'alerts';
  }
  if (entry.entityType === 'setting') {
    return 'settings';
  }
  return 'all';
}

function formatAuditModuleLabel(module: AuditModule) {
  switch (module) {
    case 'access':
      return 'Access';
    case 'assets':
      return 'Assets';
    case 'gatepass':
      return 'Gatepass';
    case 'chat':
      return 'Chat';
    case 'terminal':
      return 'Terminal';
    case 'requests':
      return 'Requests';
    case 'announcements':
      return 'Announcements';
    case 'alerts':
      return 'Alerts';
    case 'settings':
      return 'Settings';
    default:
      return 'All';
  }
}

function resolveAuditEntityPath(basePath: string, entry: AuditRecord) {
  switch (entry.entityType) {
    case 'user':
      return `${basePath}/users/${entry.entityId}`;
    case 'device':
    case 'asset':
      return `${basePath}/devices/${entry.entityId}`;
    case 'request':
      return `${basePath}/requests`;
    case 'announcement':
      return `${basePath}/announcements`;
    case 'alert':
      return `${basePath}/alerts`;
    case 'chat_channel':
      return `${basePath}/chat`;
    default:
      return '';
  }
}

function formatWarranty(value: string) {
  if (!value) {
    return 'Warranty not tracked';
  }

  return new Date(value).toLocaleDateString();
}

function formatAssignmentAge(value?: string) {
  if (!value) {
    return 'Assignment date unavailable';
  }

  const diffDays = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / (1000 * 60 * 60 * 24)));
  return `${diffDays} day${diffDays === 1 ? '' : 's'} in use`;
}

function buildEndpointCategory(user?: UserRecord | null) {
  void user;
  return 'auto';
}

function quoteShell(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
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

function buildLinuxBootstrapCommand(config?: InstallAgentConfig | null, user?: UserRecord | null, overrides?: InstallOverrides) {
  const category = buildEndpointCategory(user);
  const serverUrl = config?.publicServerUrl || '<ITMS_SERVER_URL>';
  const ingestToken = config?.inventoryIngestToken || '<INVENTORY_INGEST_TOKEN>';
  const saltMaster = config?.saltMasterHost || '<SALT_MASTER>';
  const wazuhManager = config?.wazuhManagerHost || '<WAZUH_MANAGER>';
  const notes = 'Installed by ITMS bootstrap';
  const installArgs: Array<[string, string]> = [
    ['server-url', serverUrl],
    ['token', ingestToken],
    ['category', category],
    ['assigned-to-name', overrides?.assignedToName || ''],
    ['assigned-to-email', overrides?.assignedToEmail || ''],
    ['employee-code', overrides?.employeeCode || ''],
    ['department-name', overrides?.departmentName || ''],
    ['salt-master', saltMaster],
    ['wazuh-manager', wazuhManager],
    ['notes', notes],
  ];
  const commandParts = [buildLinuxArgumentString(installArgs.filter(([, value]) => value.trim().length > 0))];
  if (overrides?.includeHardinfoFallback) {
    commandParts.push('--use-hardinfo-fallback');
  }
  const commandArgs = commandParts.filter((value) => value.trim().length > 0).join(' ');
  return `curl -fsSL ${quoteShell(`${serverUrl}/installers/install-itms-agent.sh`)} -o /tmp/install-itms-agent.sh && sudo bash /tmp/install-itms-agent.sh ${commandArgs}`;
}

function buildWindowsBootstrapCommand(config?: InstallAgentConfig | null, user?: UserRecord | null, overrides?: InstallOverrides) {
  const category = buildEndpointCategory(user);
  const serverUrl = config?.publicServerUrl || '<ITMS_SERVER_URL>';
  const ingestToken = config?.inventoryIngestToken || '<INVENTORY_INGEST_TOKEN>';
  const saltMaster = config?.saltMasterHost || '<SALT_MASTER>';
  const wazuhManager = config?.wazuhManagerHost || '<WAZUH_MANAGER>';
  const notes = 'Installed by ITMS bootstrap';
  const installArgs: Array<[string, string]> = [
    ['server-url', serverUrl],
    ['token', ingestToken],
    ['category', category],
    ['use-detailed-hardware-inventory', '$true'],
    ['assigned-to-name', overrides?.assignedToName || ''],
    ['assigned-to-email', overrides?.assignedToEmail || ''],
    ['employee-code', overrides?.employeeCode || ''],
    ['department-name', overrides?.departmentName || ''],
    ['salt-master', saltMaster],
    ['wazuh-manager', wazuhManager],
    ['notes', notes],
  ];
  const commandArgs = buildWindowsArgumentString(installArgs.filter(([, value]) => value.trim().length > 0));
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$scriptPath = Join-Path $env:TEMP 'install-itms-agent.ps1'; Invoke-WebRequest ${quotePowerShell(`${serverUrl}/installers/install-itms-agent.ps1`)} -OutFile $scriptPath; & $scriptPath ${commandArgs}"`;
}

function buildLinuxSyncCommand(config?: InstallAgentConfig | null, user?: UserRecord | null, includeHardinfoFallback = true) {
  const category = buildEndpointCategory(user);
  const serverUrl = config?.publicServerUrl || '<ITMS_SERVER_URL>';
  const ingestToken = config?.inventoryIngestToken || '<INVENTORY_INGEST_TOKEN>';
  const commandParts = [
    `sudo /usr/bin/python3 /opt/itms/push-system-inventory.py --server-url ${quoteShell(serverUrl)} --token ${quoteShell(ingestToken)} --category ${quoteShell(category)}`,
  ];
  if (includeHardinfoFallback) {
    commandParts.push('--use-hardinfo-fallback');
  }
  return commandParts.join(' ');
}

function buildWindowsSyncCommand(config?: InstallAgentConfig | null, user?: UserRecord | null) {
  const category = buildEndpointCategory(user);
  const serverUrl = config?.publicServerUrl || '<ITMS_SERVER_URL>';
  const ingestToken = config?.inventoryIngestToken || '<INVENTORY_INGEST_TOKEN>';
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\ProgramData\\ITMS\\push-system-inventory.ps1" -ServerUrl ${quotePowerShell(serverUrl)} -Token ${quotePowerShell(ingestToken)} -Category ${quotePowerShell(category)} -UseDetailedHardwareInventory $true`;
}

export default function UsersPage() {
  const session = getStoredSession();
  const navigate = useNavigate();
  const location = useLocation();
  const userImportInputRef = useRef<HTMLInputElement | null>(null);
  const basePath = location.pathname.split('/users')[0];
  const isSuperAdmin = session?.user.role === 'super_admin';
  const [activeTab, setActiveTab] = useState<DirectoryTab>('directory');
  const [directoryUsers, setDirectoryUsers] = useState<UserRecord[]>([]);
  const [installUsers, setInstallUsers] = useState<UserRecord[]>([]);
  const [accessUsers, setAccessUsers] = useState<UserRecord[]>([]);
  const [assets, setAssets] = useState<UserAssetsResponse>({ devices: [], items: [] });
  const [inventoryDevices, setInventoryDevices] = useState<InventoryDeviceRecord[]>([]);
  const [enrollmentRequests, setEnrollmentRequests] = useState<EnrollmentRequestRecord[]>([]);
  const [rejectedEnrollmentLookupKeys, setRejectedEnrollmentLookupKeys] = useState<string[]>([]);
  const [inventoryDevicesTotal, setInventoryDevicesTotal] = useState(0);
  const [inventoryDevicesPage, setInventoryDevicesPage] = useState(1);
  const [inventoryDevicesLoading, setInventoryDevicesLoading] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [directoryPage, setDirectoryPage] = useState(1);
  const [installPage, setInstallPage] = useState(1);
  const [accessPage, setAccessPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditModuleFilter, setAuditModuleFilter] = useState<AuditModule>('all');
  const [auditSearchQuery, setAuditSearchQuery] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [assetActionLoadingId, setAssetActionLoadingId] = useState('');
  const [assigningDeviceId, setAssigningDeviceId] = useState('');
  const [installConfig, setInstallConfig] = useState<InstallAgentConfig | null>(null);
  const [installConfigLoading, setInstallConfigLoading] = useState(false);
  const [departmentOptions, setDepartmentOptions] = useState<LookupOption[]>([]);
  const [branchOptions, setBranchOptions] = useState<LookupOption[]>([]);
  const [accessSavingUserId, setAccessSavingUserId] = useState('');
  const [creatingEmployee, setCreatingEmployee] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({
    fullName: '',
    email: '',
    employeeCode: '',
    departmentId: '',
    branchId: '',
    role: 'employee',
    initialPassword: '',
  });
  const [installAssignedToName, setInstallAssignedToName] = useState('');
  const [installAssignedToEmail, setInstallAssignedToEmail] = useState('');
  const [installEmployeeCode, setInstallEmployeeCode] = useState('');
  const [installDepartmentName, setInstallDepartmentName] = useState('');
  const [includeLinuxHardinfoFallback, setIncludeLinuxHardinfoFallback] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.localStorage.getItem(LINUX_HARDINFO_PREFERENCE_KEY) !== 'false';
  });
  const [copyStatus, setCopyStatus] = useState<'linux' | 'windows' | 'linux-sync' | 'windows-sync' | ''>('');
  const [pendingAssetAction, setPendingAssetAction] = useState<PendingAssetAction | null>(null);
  const [portalDrafts, setPortalDrafts] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [csvActionLoading, setCsvActionLoading] = useState<'template' | 'minimal-template' | 'export' | ''>('');
  const [importingUsers, setImportingUsers] = useState(false);
  const [usersReloadKey, setUsersReloadKey] = useState(0);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const [installTotal, setInstallTotal] = useState(0);
  const [accessTotal, setAccessTotal] = useState(0);
  const [auditTotal, setAuditTotal] = useState(0);
  const [activeEmployeeTotal, setActiveEmployeeTotal] = useState(0);
  const [directorySummary, setDirectorySummary] = useState<{ departmentCounts: NamedCount[]; assetTotal: number }>({ departmentCounts: [], assetTotal: 0 });
  const [auditSummary, setAuditSummary] = useState<{ moduleCounts: NamedCount[] }>({ moduleCounts: [] });

  const activePagedUsers = useMemo(() => (activeTab === 'install' ? installUsers : directoryUsers), [activeTab, directoryUsers, installUsers]);

  const mergedDepartmentOptions = useMemo(() => mergeDepartmentSuggestions(departmentOptions), [departmentOptions]);

  const triggerUsersReload = useCallback(() => {
    setUsersReloadKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (activeTab === 'access' && !isSuperAdmin) {
      setActiveTab('directory');
    }
  }, [activeTab, isSuperAdmin]);

  useEffect(() => {
    setPortalDrafts((current) => {
      const next: Record<string, string[]> = {};
      accessUsers.forEach((user) => {
        next[user.id] = current[user.id] ? normalizePortalSelection(current[user.id]) : normalizePortalSelection(user.portals || []);
      });
      return next;
    });
  }, [accessUsers]);

  const loadUsersPage = useCallback(async (options: {
    page: number;
    search?: string;
    departmentLabel?: string;
    excludeRole?: string;
    role?: string;
    status?: string;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams({
      paginate: '1',
      page: String(options.page),
      page_size: String(options.pageSize || USERS_PAGE_SIZE),
    });

    if (options.search?.trim()) {
      params.set('search', options.search.trim());
    }
    if (options.departmentLabel && options.departmentLabel !== 'all') {
      params.set('department_label', options.departmentLabel);
    }
    if (options.excludeRole) {
      params.set('exclude_role', options.excludeRole);
    }
    if (options.role) {
      params.set('role', options.role);
    }
    if (options.status) {
      params.set('status', options.status);
    }

    return apiRequest<PaginatedUsersResponse>(`/api/users?${params.toString()}`);
  }, []);

  const loadImportedSystemsPage = async (page: number) => {
    const deviceParams = new URLSearchParams({
      paginate: '1',
      page: String(page),
      page_size: String(IMPORTED_DEVICES_PAGE_SIZE),
      assigned: 'unassigned',
    });
    const deviceData = await apiRequest<PaginatedInventoryDevicesResponse>(`/api/devices?${deviceParams.toString()}`);

    const lookupKeys = Array.from(new Set(
      (deviceData.items || [])
        .flatMap((device) => [device.assetId, device.hostname])
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ));

    if (!lookupKeys.length) {
      return {
        devices: deviceData.items || [],
        total: deviceData.total || 0,
        requests: [] as EnrollmentRequestRecord[],
        rejectedLookupKeys: [] as string[],
      };
    }

    const requestParams = new URLSearchParams({
      paginate: '1',
      page: '1',
      page_size: String(Math.max(lookupKeys.length, 25)),
      type: 'device_enrollment',
    });
    lookupKeys.forEach((lookup) => requestParams.append('lookup', lookup));
    const rejectedRequestParams = new URLSearchParams({
      paginate: '1',
      page: '1',
      page_size: String(Math.max(lookupKeys.length, 25)),
      type: 'device_enrollment',
      status: 'rejected',
    });
    lookupKeys.forEach((lookup) => rejectedRequestParams.append('lookup', lookup));

    const [requestData, rejectedRequestData] = await Promise.all([
      apiRequest<PaginatedEnrollmentRequestsResponse>(`/api/requests?${requestParams.toString()}`),
      apiRequest<PaginatedEnrollmentRequestsResponse>(`/api/requests?${rejectedRequestParams.toString()}`),
    ]);

    const rejectedLookupKeys = (rejectedRequestData.items || [])
      .map((request) => (parseEnrollmentDetails(request.description || '')['asset tag / host'] || '').trim().toLowerCase())
      .filter(Boolean);

    return {
      devices: deviceData.items || [],
      total: deviceData.total || 0,
      requests: requestData.items || [],
      rejectedLookupKeys,
    };
  };

  const refreshUserSummary = useCallback(async () => {
    const data = await loadUsersPage({ page: 1, excludeRole: 'super_admin' });
    setDirectoryTotal(data.total);
    setDirectorySummary({
      departmentCounts: data.summary?.departmentCounts || [],
      assetTotal: data.summary?.assetTotal || 0,
    });
  }, [loadUsersPage]);

  useEffect(() => {
    void refreshUserSummary();
  }, [refreshUserSummary, usersReloadKey]);

  useEffect(() => {
    let cancelled = false;

    const loadActiveEmployeeCount = async () => {
      try {
        const data = await loadUsersPage({ page: 1, pageSize: 1, role: 'employee', status: 'active' });
        if (!cancelled) {
          setActiveEmployeeTotal(data.total || 0);
        }
      } catch {
        if (!cancelled) {
          setActiveEmployeeTotal(0);
        }
      }
    };

    void loadActiveEmployeeCount();

    return () => {
      cancelled = true;
    };
  }, [loadUsersPage, usersReloadKey]);

  useEffect(() => {
    let cancelled = false;

    const loadDirectoryUsers = async () => {
      try {
        setLoading(true);
        setError('');
        setSuccessMessage('');
        const [data, summary] = await Promise.all([
          loadUsersPage({
            page: directoryPage,
            search: searchQuery,
            departmentLabel: departmentFilter,
            excludeRole: 'super_admin',
          }),
          loadUsersPage({ page: 1, excludeRole: 'super_admin' }),
        ]);
        if (cancelled) {
          return;
        }

        const normalizedUsers = normalizeUsers(data.items);
        setDirectoryUsers(normalizedUsers);
        setDirectoryTotal(data.total);
        setDirectorySummary({
          departmentCounts: summary.summary?.departmentCounts || [],
          assetTotal: summary.summary?.assetTotal || 0,
        });
        setSelectedUserId((current) => current || normalizedUsers[0]?.id || '');
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load users');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    if (activeTab === 'directory') {
      void loadDirectoryUsers();
    }

    return () => {
      cancelled = true;
    };
  }, [activeTab, departmentFilter, directoryPage, loadUsersPage, searchQuery, usersReloadKey]);

  useEffect(() => {
    if (activeTab !== 'install') {
      return;
    }

    let cancelled = false;

    const loadInstallUsers = async () => {
      try {
        setLoading(true);
        setError('');
        const data = await loadUsersPage({
          page: installPage,
          search: searchQuery,
          departmentLabel: departmentFilter,
          excludeRole: 'super_admin',
        });
        if (cancelled) {
          return;
        }

        const normalizedUsers = normalizeUsers(data.items);
        setInstallUsers(normalizedUsers);
        setInstallTotal(data.total);
        setSelectedUserId((current) => current || normalizedUsers[0]?.id || '');
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load users');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadInstallUsers();

    return () => {
      cancelled = true;
    };
  }, [activeTab, departmentFilter, installPage, loadUsersPage, searchQuery, usersReloadKey]);

  useEffect(() => {
    if (activeTab !== 'access') {
      return;
    }

    if (!isSuperAdmin) {
      return;
    }

    let cancelled = false;

    const loadAccessUsers = async () => {
      try {
        setLoading(true);
        setError('');
        const data = await loadUsersPage({ page: accessPage });
        if (cancelled) {
          return;
        }

        setAccessUsers(normalizeUsers(data.items));
        setAccessTotal(data.total);
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load users');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadAccessUsers();

    return () => {
      cancelled = true;
    };
  }, [accessPage, activeTab, isSuperAdmin, loadUsersPage, usersReloadKey]);

  useEffect(() => {
    if (!selectedUserId || activeTab !== 'directory') {
      return;
    }

    let cancelled = false;

    const loadAssets = async () => {
      try {
        setAssetsLoading(true);
        setSuccessMessage('');
        const data = await apiRequest<UserAssetsResponse>(`/api/users/${selectedUserId}/assets`);
        if (!cancelled) {
          setAssets(data);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load user assets');
        }
      } finally {
        if (!cancelled) {
          setAssetsLoading(false);
        }
      }
    };

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedUserId]);

  useEffect(() => {
    if (activeTab !== 'directory' && activeTab !== 'install') {
      return;
    }

    let cancelled = false;

    const loadInventoryDevices = async () => {
      try {
        setInventoryDevicesLoading(true);
        const importedData = await loadImportedSystemsPage(inventoryDevicesPage);
        if (!cancelled) {
          setInventoryDevices(importedData.devices);
          setInventoryDevicesTotal(importedData.total);
          setEnrollmentRequests(importedData.requests);
          setRejectedEnrollmentLookupKeys(importedData.rejectedLookupKeys);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load imported systems');
        }
      } finally {
        if (!cancelled) {
          setInventoryDevicesLoading(false);
        }
      }
    };

    void loadInventoryDevices();

    return () => {
      cancelled = true;
    };
  }, [activeTab, inventoryDevicesPage]);

  useEffect(() => {
    if (activeTab !== 'access' && activeTab !== 'install' && activeTab !== 'employee' && activeTab !== 'imports') {
      return;
    }

    let cancelled = false;

    const loadMetaOptions = async () => {
      try {
        const data = await apiRequest<UserMetaOptionsResponse>('/api/users/meta/options');
        if (!cancelled) {
          setDepartmentOptions(data.departments || []);
          setBranchOptions(data.branches || []);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load access options');
        }
      }
    };

    void loadMetaOptions();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'install') {
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
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load install-agent configuration');
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
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'audit') {
      return;
    }

    let cancelled = false;

    const loadAudit = async () => {
      try {
        setAuditLoading(true);
        const params = new URLSearchParams({
          paginate: '1',
          page: String(auditPage),
          page_size: String(AUDIT_PAGE_SIZE),
        });
        if (auditModuleFilter !== 'all') {
          params.set('module', auditModuleFilter);
        }
        if (auditSearchQuery.trim()) {
          params.set('search', auditSearchQuery.trim());
        }
        if (auditActionFilter.trim()) {
          params.set('action', auditActionFilter.trim());
        }
        const data = await apiRequest<PaginatedAuditResponse>(`/api/audit?${params.toString()}`);
        if (!cancelled) {
          setAuditItems(data.items || []);
          setAuditTotal(data.total || 0);
          setAuditSummary({ moduleCounts: data.summary?.moduleCounts || [] });
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load audit activity');
        }
      } finally {
        if (!cancelled) {
          setAuditLoading(false);
        }
      }
    };

    void loadAudit();

    return () => {
      cancelled = true;
    };
  }, [activeTab, auditActionFilter, auditModuleFilter, auditPage, auditSearchQuery]);

  const departmentCounts = useMemo(() => {
    return directorySummary.departmentCounts;
  }, [directorySummary.departmentCounts]);

  useEffect(() => {
    setDirectoryPage(1);
    setInstallPage(1);
  }, [departmentFilter, searchQuery]);

  useEffect(() => {
    setInventoryDevicesPage(1);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'directory' && activeTab !== 'install') {
      return;
    }

    if (!activePagedUsers.length) {
      setSelectedUserId('');
      return;
    }

    if (!activePagedUsers.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(activePagedUsers[0].id);
    }
  }, [activePagedUsers, activeTab, selectedUserId]);

  const selectedUser = activePagedUsers.find((user) => user.id === selectedUserId) || null;

  useEffect(() => {
    if (!selectedUser) {
      setInstallAssignedToName('');
      setInstallAssignedToEmail('');
      setInstallEmployeeCode('');
      setInstallDepartmentName('');
      return;
    }

    setInstallAssignedToName(selectedUser.fullName || '');
    setInstallAssignedToEmail(selectedUser.email || '');
    setInstallEmployeeCode(selectedUser.employeeCode || '');
    setInstallDepartmentName(selectedUser.department?.name || selectedUser.branch?.name || '');
  }, [selectedUser]);

  useEffect(() => {
    window.localStorage.setItem(LINUX_HARDINFO_PREFERENCE_KEY, includeLinuxHardinfoFallback ? 'true' : 'false');
  }, [includeLinuxHardinfoFallback]);

  const installOverrides = useMemo<InstallOverrides>(() => ({
    assignedToName: installAssignedToName.trim(),
    assignedToEmail: installAssignedToEmail.trim(),
    employeeCode: installEmployeeCode.trim(),
    departmentName: installDepartmentName.trim(),
    includeHardinfoFallback: includeLinuxHardinfoFallback,
  }), [includeLinuxHardinfoFallback, installAssignedToName, installAssignedToEmail, installEmployeeCode, installDepartmentName]);
  const installEmailValid = useMemo(() => /.+@zerodha\.com$/i.test(installAssignedToEmail.trim()), [installAssignedToEmail]);
  const installFieldsComplete = useMemo(() => (
    installAssignedToName.trim().length > 0
      && installEmailValid
      && installEmployeeCode.trim().length > 0
      && installDepartmentName.trim().length > 0
  ), [installAssignedToName, installDepartmentName, installEmailValid, installEmployeeCode]);
  const linuxInstallCommand = useMemo(
    () => installFieldsComplete ? buildLinuxBootstrapCommand(installConfig, selectedUser, installOverrides) : 'Fill Employee name, Employee email, Employee ID, and Department to generate the install command.',
    [installConfig, installFieldsComplete, installOverrides, selectedUser],
  );
  const windowsInstallCommand = useMemo(
    () => installFieldsComplete ? buildWindowsBootstrapCommand(installConfig, selectedUser, installOverrides) : 'Fill Employee name, Employee email, Employee ID, and Department to generate the install command.',
    [installConfig, installFieldsComplete, installOverrides, selectedUser],
  );
  const linuxSyncCommand = useMemo(
    () => buildLinuxSyncCommand(installConfig, selectedUser, includeLinuxHardinfoFallback),
    [includeLinuxHardinfoFallback, installConfig, selectedUser],
  );
  const selectedAssets = useMemo(() => [...assets.devices, ...assets.items], [assets.devices, assets.items]);
  const unassignedImportedDevices = useMemo(() => {
    const enrollmentRequestByLookup = new Map<string, EnrollmentRequestRecord>();
    const rejectedLookupKeySet = new Set(rejectedEnrollmentLookupKeys);
    enrollmentRequests.forEach((request) => {
      const details = parseEnrollmentDetails(request.description || '');
      const requestKey = (details['asset tag / host'] || '').trim().toLowerCase();
      if (requestKey && !enrollmentRequestByLookup.has(requestKey)) {
        enrollmentRequestByLookup.set(requestKey, request);
      }
    });

    return inventoryDevices
      .filter((device) => {
        if (device.user?.fullName || device.user?.employeeCode) {
          return false;
        }

        const assetKey = device.assetId.trim().toLowerCase();
        const hostnameKey = device.hostname.trim().toLowerCase();
        return !rejectedLookupKeySet.has(assetKey) && !rejectedLookupKeySet.has(hostnameKey);
      })
      .map((device) => {
        const assetKey = device.assetId.trim().toLowerCase();
        const hostnameKey = device.hostname.trim().toLowerCase();
        const matchingRequest = enrollmentRequestByLookup.get(assetKey) || enrollmentRequestByLookup.get(hostnameKey);

        const details = matchingRequest ? parseEnrollmentDetails(matchingRequest.description || '') : null;
        const installationIdentity: InstallationIdentity | null = details
          ? {
              requesterName: details['requester name'] || details['name'] || '',
              requesterEmail: details['requester email'] || details['email'] || '',
              employeeId: details['employee id'] || details['employee code'] || '',
              department: details['department'] || '',
            }
          : null;

        return {
          ...device,
          installationIdentity,
        };
      });
  }, [enrollmentRequests, inventoryDevices, rejectedEnrollmentLookupKeys]);
  const auditModuleCounts = useMemo(() => {
    const counts = new Map<AuditModule, number>();
    auditSummary.moduleCounts.forEach((entry) => {
      counts.set(entry.name as AuditModule, entry.count);
    });
    return counts;
  }, [auditSummary.moduleCounts]);

  useEffect(() => {
    setAuditPage(1);
  }, [auditActionFilter, auditModuleFilter, auditSearchQuery]);

  const refreshSelectedUserAssets = async () => {
    if (!selectedUserId) {
      return;
    }

    const [usersData, assetsData] = await Promise.all([
      loadUsersPage({
        page: activeTab === 'install' ? installPage : directoryPage,
        search: searchQuery,
        departmentLabel: departmentFilter,
        excludeRole: 'super_admin',
      }),
      apiRequest<UserAssetsResponse>(`/api/users/${selectedUserId}/assets`),
    ]);

    const normalizedUsers = normalizeUsers(usersData.items);
    if (activeTab === 'install') {
      setInstallUsers(normalizedUsers);
      setInstallTotal(usersData.total);
    } else {
      setDirectoryUsers(normalizedUsers);
      setDirectoryTotal(usersData.total);
    }
    setAssets(assetsData);
    await refreshUserSummary();
  };

  const defaultEntityId = selectedUser?.entityId || directoryUsers[0]?.entityId || installUsers[0]?.entityId || accessUsers[0]?.entityId || '';

  const handleCreateEmployee = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!defaultEntityId) {
      setError('No entity is available yet. Create or load an existing user first.');
      return;
    }

    try {
      setCreatingEmployee(true);
      setError('');
      setSuccessMessage('');
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          full_name: employeeForm.fullName.trim(),
          email: employeeForm.email.trim(),
          emp_id: employeeForm.employeeCode.trim(),
          entity_id: defaultEntityId,
          dept_id: employeeForm.departmentId,
          location_id: employeeForm.branchId,
          role: employeeForm.role,
          initial_password: employeeForm.initialPassword,
          is_active: true,
        }),
      });
      setEmployeeForm({ fullName: '', email: '', employeeCode: '', departmentId: '', branchId: '', role: 'employee', initialPassword: '' });
      setSuccessMessage('Employee created successfully.');
      setDirectoryPage(1);
      setActiveTab('directory');
      triggerUsersReload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to create employee');
    } finally {
      setCreatingEmployee(false);
    }
  };

  const handleStockAction = async (assetId: string, action: 'return' | 'retire') => {
    if (!selectedUserId) {
      return;
    }

    try {
      setAssetActionLoadingId(assetId);
      setError('');
      setSuccessMessage('');
      await apiRequest<{ status: string }>(`/api/stock/${assetId}/${action}`, { method: 'POST' });

      await refreshSelectedUserAssets();
      setSuccessMessage(`Stock item ${action === 'retire' ? 'scrapped' : 'returned'} successfully.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Failed to ${action === 'retire' ? 'scrap' : action} stock item`);
    } finally {
      setAssetActionLoadingId('');
    }
  };

  const handleAssetAction = async (assetId: string, action: 'unassign' | 'delete') => {
    try {
      setAssetActionLoadingId(assetId);
      setError('');
      setSuccessMessage('');
      await apiRequest(action === 'delete' ? `/api/assets/${assetId}` : `/api/assets/${assetId}/unassign`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
      });
      await refreshSelectedUserAssets();
      setPendingAssetAction(null);
      setSuccessMessage(action === 'delete' ? 'Asset deleted successfully.' : 'Asset removed from user successfully.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Failed to ${action} asset`);
    } finally {
      setAssetActionLoadingId('');
    }
  };

  const handleAssignImportedDevice = async (deviceId: string) => {
    if (!selectedUserId || !selectedUser) {
      setError('Select a user before assigning an imported system.');
      return;
    }

    try {
      setAssigningDeviceId(deviceId);
      setError('');
      setSuccessMessage('');

      await apiRequest(`/api/assets/${deviceId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ user_id: selectedUserId }),
      });

      const [usersData, assetsData, importedData] = await Promise.all([
        loadUsersPage({
          page: activeTab === 'install' ? installPage : directoryPage,
          search: searchQuery,
          departmentLabel: departmentFilter,
          excludeRole: 'super_admin',
        }),
        apiRequest<UserAssetsResponse>(`/api/users/${selectedUserId}/assets`),
        loadImportedSystemsPage(inventoryDevicesPage),
      ]);

      const normalizedUsers = normalizeUsers(usersData.items);
      if (activeTab === 'install') {
        setInstallUsers(normalizedUsers);
        setInstallTotal(usersData.total);
      } else {
        setDirectoryUsers(normalizedUsers);
        setDirectoryTotal(usersData.total);
      }
      setAssets(assetsData);
      setInventoryDevices(importedData.devices);
      setInventoryDevicesTotal(importedData.total);
      setEnrollmentRequests(importedData.requests);
      setRejectedEnrollmentLookupKeys(importedData.rejectedLookupKeys);
      await refreshUserSummary();
      setSuccessMessage(`Assigned imported system to ${selectedUser.fullName}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to assign imported system');
    } finally {
      setAssigningDeviceId('');
    }
  };

  const handleRoleChange = async (user: UserRecord, nextRole: string) => {
    if (!isSuperAdmin) {
      setError('Only super admin can update portal access.');
      return false;
    }

    if (!nextRole || nextRole === user.role?.name) {
      return false;
    }

    try {
      setAccessSavingUserId(user.id);
      setError('');
      setSuccessMessage('');

      await apiRequest(`/api/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: user.fullName,
          emp_id: user.employeeCode,
          email: user.email,
          entity_id: user.entityId,
          dept_id: user.departmentId || '',
          location_id: user.branchId || '',
          role: nextRole,
        }),
      });

      const [accessData, summaryData] = await Promise.all([
        loadUsersPage({ page: accessPage }),
        loadUsersPage({ page: 1, excludeRole: 'super_admin' }),
      ]);
      setAccessUsers(normalizeUsers(accessData.items));
      setAccessTotal(accessData.total);
      setDirectorySummary({
        departmentCounts: summaryData.summary?.departmentCounts || [],
        assetTotal: summaryData.summary?.assetTotal || 0,
      });
      setSuccessMessage(`Updated portal access for ${user.fullName}.`);
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update portal access');
      return false;
    } finally {
      setAccessSavingUserId('');
    }
  };

  const handlePortalToggle = (userId: string, portalId: string, checked: boolean) => {
    setPortalDrafts((current) => {
      const existing = new Set(current[userId] || ['employee']);
      if (checked) {
        existing.add(portalId);
      } else {
        existing.delete(portalId);
      }
      return {
        ...current,
        [userId]: normalizePortalSelection(Array.from(existing)),
      };
    });
  };

  const handlePortalSave = async (user: UserRecord) => {
    if (!isSuperAdmin) {
      setError('Only super admin can update portal access.');
      return;
    }

    const draftPortals = normalizePortalSelection(portalDrafts[user.id] || user.portals || []);
    const nextRole = portalsToRole(draftPortals);
    const saved = await handleRoleChange(user, nextRole);
    if (saved) {
      setPortalDrafts((current) => ({
        ...current,
        [user.id]: draftPortals,
      }));
    }
  };

  const handleDownloadUsersCsv = useCallback(async (kind: 'template' | 'minimal-template' | 'export') => {
    if (!session?.token) {
      setError('Sign in again before downloading CSV files.');
      return;
    }

    try {
      setCsvActionLoading(kind);
      setError('');
      setSuccessMessage('');

      const response = await fetch(resolveApiUrl(
        kind === 'template'
          ? '/api/users/import-template'
          : kind === 'minimal-template'
            ? '/api/users/import-template-minimal'
            : '/api/users/export',
      ), {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Failed to download ${kind === 'export' ? 'export' : 'template'} CSV`);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const fileNameMatch = contentDisposition.match(/filename\s*=\s*"?([^";]+)"?/i);
      const fileName = fileNameMatch?.[1] || (kind === 'template' ? 'user-import-template.csv' : kind === 'minimal-template' ? 'user-import-minimal-template.csv' : 'users-export.csv');
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setSuccessMessage(kind === 'export' ? 'Current users exported to CSV.' : kind === 'minimal-template' ? 'Minimal user import template downloaded.' : 'Extended user import template downloaded.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to download CSV file');
    } finally {
      setCsvActionLoading('');
    }
  }, [session?.token]);

  const handleImportUsers = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      setImportingUsers(true);
      setError('');
      setSuccessMessage('');

      const formData = new FormData();
      formData.append('file', file);
      const result = await apiRequest<{ created: number; updated: number; errors?: Array<{ row: number; message: string }> }>('/api/users/import', {
        method: 'POST',
        body: formData,
      });

      setDirectoryPage(1);
      setInstallPage(1);
      setAccessPage(1);
      setSelectedUserId('');
      setActiveTab('directory');
      triggerUsersReload();

      const failures = result.errors || [];
      setSuccessMessage(`CSV processed: ${result.created} created, ${result.updated} updated.${failures.length ? ` ${failures.length} row(s) need attention.` : ''}`);
      if (failures.length) {
        setError(failures.slice(0, 3).map((entry) => `Row ${entry.row}: ${entry.message}`).join(' | '));
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to import users CSV');
    } finally {
      setImportingUsers(false);
    }
  }, [triggerUsersReload]);

  const handleCopyCommand = async (kind: 'linux' | 'windows' | 'linux-sync' | 'windows-sync', command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyStatus(kind);
      setSuccessMessage(`${kind.startsWith('linux') ? 'Linux' : 'Windows'} ${kind.endsWith('sync') ? 'sync' : 'install'} command copied.`);
      window.setTimeout(() => setCopyStatus((current) => (current === kind ? '' : current)), 1500);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Failed to copy command');
    }
  };

  return (
    <div className="space-y-6 px-4 py-6 xl:px-6">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="flex items-center text-2xl font-bold tracking-tight text-zinc-900">
            <UsersIcon className="mr-3 h-6 w-6 text-brand-600" />
            Superadmin User Portal
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Manage portal roles, review assigned assets, and track audit activity for users and assets.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Users</div>
            <div className="mt-2 text-xl font-bold text-zinc-900">{directoryTotal}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Departments</div>
            <div className="mt-2 text-xl font-bold text-zinc-900">{departmentCounts.length}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Assets</div>
            <div className="mt-2 text-xl font-bold text-zinc-900">{directorySummary.assetTotal}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Audit Events</div>
            <div className="mt-2 text-xl font-bold text-zinc-900">{auditTotal}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[
          ['directory', 'Directory'],
          ['employee', 'Add Employee'],
          ['imports', 'Import / Export'],
          ['install', 'Install Agents'],
          ['audit', 'Audit'],
          ...(isSuperAdmin ? [['access', 'Portal Access'] as const] : []),
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id as DirectoryTab)}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === id ? 'bg-brand-600 text-white' : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        ref={userImportInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => void handleImportUsers(event)}
      />

      {activeEmployeeTotal === 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          No active employee users exist in the directory right now. Request owners and ticket assignees will stay limited to active IT/admin accounts until employee users are imported.
        </div>
      ) : null}

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
      {successMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{successMessage}</div> : null}

      <ConfirmDialog
        open={Boolean(pendingAssetAction)}
        title={pendingAssetAction?.action === 'delete' ? 'Delete Asset' : 'Remove Asset From User'}
        message={pendingAssetAction?.action === 'delete' ? 'This will permanently delete the asset from ITMS and cannot be undone.' : 'This will remove the asset assignment from the selected user but keep the asset in ITMS.'}
        confirmLabel={pendingAssetAction?.action === 'delete' ? 'Delete Asset' : 'Remove From User'}
        tone={pendingAssetAction?.action === 'delete' ? 'danger' : 'default'}
        busy={Boolean(pendingAssetAction && assetActionLoadingId === pendingAssetAction.assetId)}
        onClose={() => setPendingAssetAction(null)}
        onConfirm={() => {
          if (pendingAssetAction) {
            void handleAssetAction(pendingAssetAction.assetId, pendingAssetAction.action);
          }
        }}
      />

      {activeTab === 'directory' ? (
        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)_420px]">
          <aside className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Departments</div>
              <p className="mt-1 text-sm text-zinc-500">Filter users by department and review count per team.</p>
            </div>

            <button
              type="button"
              onClick={() => setDepartmentFilter('all')}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-semibold ${departmentFilter === 'all' ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'bg-zinc-50 text-zinc-700 hover:bg-zinc-100'}`}
            >
              <span>All Departments</span>
              <span>{directoryTotal}</span>
            </button>

            <div className="space-y-2">
              {departmentCounts.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => setDepartmentFilter(entry.name)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-medium ${departmentFilter === entry.name ? 'bg-zinc-900 text-white' : 'bg-zinc-50 text-zinc-700 hover:bg-zinc-100'}`}
                >
                  <span>{entry.name}</span>
                  <span>{entry.count}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zinc-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-3 pl-10 pr-4 text-sm text-zinc-900"
                  placeholder="Search by employee name, employee ID, email, role, or department"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-zinc-500">Employee directory and assigned assets are shown here.</div>
            </div>

            <div className="space-y-3">
              {loading ? <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm">Loading user directory...</div> : null}
              {!loading && directoryUsers.length === 0 ? <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm">No users matched the current filters.</div> : null}

              {directoryUsers.map((user) => {
                const active = user.id === selectedUserId;

                return (
                  <div
                    key={user.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedUserId(user.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedUserId(user.id);
                      }
                    }}
                    className={`cursor-pointer rounded-2xl border p-4 shadow-sm transition-colors ${active ? 'border-brand-300 bg-brand-50/60' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-left text-lg font-bold text-zinc-900 hover:text-brand-700">
                            {user.fullName}
                          </div>
                          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${user.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        </div>
                        <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">{user.employeeCode}</div>
                        <div className="mt-2 flex items-center text-sm text-brand-700 hover:text-brand-800">
                          <Mail className="mr-2 h-4 w-4" />
                          {user.email}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Assets</div>
                        <div className="mt-2 text-xl font-bold text-zinc-900">{user._count?.assets || 0}</div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl bg-zinc-50 px-3 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Department</div>
                        <div className="mt-2 text-sm font-semibold text-zinc-900">{user.department?.name || 'Unassigned'}</div>
                      </div>
                      <div className="rounded-xl bg-zinc-50 px-3 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Location</div>
                        <div className="mt-2 text-sm font-semibold text-zinc-900">{user.branch?.name || 'Unassigned'}</div>
                      </div>
                      <div className="rounded-xl bg-zinc-50 px-3 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Access</div>
                        <div className="mt-2 text-sm font-semibold text-zinc-900">{normalizePortalSelection(user.portals || []).map(formatPortalLabel).join(', ') || 'Employee'}</div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex flex-wrap gap-2">
                        {normalizePortalSelection(user.portals || []).map((portal) => (
                          <span key={portal} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-700 ring-1 ring-zinc-200">
                            {formatPortalLabel(portal)}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/admin/users/${user.id}`.replace('/admin', location.pathname.startsWith('/it/') ? '/it' : '/admin'));
                        }}
                        className="inline-flex items-center text-sm font-semibold text-brand-700 hover:text-brand-800"
                      >
                        Open profile
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <Pagination
              currentPage={directoryPage}
              totalItems={directoryTotal}
              pageSize={USERS_PAGE_SIZE}
              onPageChange={setDirectoryPage}
              itemLabel="users"
            />
          </section>

          <aside className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Assigned Assets</div>
              <h2 className="mt-1 text-lg font-bold text-zinc-900">{selectedUser?.fullName || 'Select a user'}</h2>
              <p className="mt-1 text-sm text-zinc-500">Click employee name or email to see devices and accessories on the right.</p>
            </div>

            {!selectedUser ? (
              <div className="px-5 py-10 text-center text-sm text-zinc-500">Choose a user to inspect assigned assets.</div>
            ) : assetsLoading ? (
              <div className="px-5 py-10 text-center text-sm text-zinc-500">Loading assigned assets...</div>
            ) : (
              <div className="space-y-3 p-4">
                {selectedAssets.length === 0 ? <div className="rounded-xl bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">No assets are assigned to this user.</div> : null}

                {assets.devices.map((asset) => (
                  <div
                    key={asset.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`${basePath}/devices/${asset.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`${basePath}/devices/${asset.id}`);
                      }
                    }}
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-left shadow-sm hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">{asset.assetTag}</div>
                        <div className="mt-1 text-base font-bold text-zinc-900">{asset.hostname}</div>
                        <div className="mt-1 text-sm text-zinc-500">Laptop / Desktop asset</div>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 text-zinc-400" />
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-zinc-600">
                      <div>Serial: {asset.serialNumber || 'Unavailable'}</div>
                      <div>Hardware: {asset.specs || 'Unknown specs'}</div>
                      <div>Warranty: {formatWarranty(asset.warrantyExpiresAt)}</div>
                      <div>Assigned: {formatAssignmentAge(asset.assignedAt)}</div>
                      <div>Status: {asset.status}</div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingAssetAction({ assetId: asset.id, action: 'unassign' });
                        }}
                        disabled={assetActionLoadingId === asset.id}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                      >
                        {assetActionLoadingId === asset.id ? 'Updating...' : 'Remove From User'}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingAssetAction({ assetId: asset.id, action: 'delete' });
                        }}
                        disabled={assetActionLoadingId === asset.id}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                      >
                        {assetActionLoadingId === asset.id ? 'Updating...' : 'Delete Asset'}
                      </button>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {TOOL_STATUS_ITEMS.map(([key, label]) => {
                        const statusEntry = asset.toolStatus?.[key as 'salt' | 'wazuh' | 'openscap' | 'clamav'];
                        return (
                          <div key={key} className="rounded-xl bg-zinc-50 px-3 py-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
                              <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${getToolBadgeClasses(statusEntry?.status)}`}>
                                {formatToolStatusLabel(statusEntry?.status)}
                              </span>
                            </div>
                            <div className="mt-2 text-xs text-zinc-500">{statusEntry?.detail || 'Status unavailable'}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {assets.items.map((asset) => (
                  <div
                    key={asset.id}
                    className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-left"
                  >
                    <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">{asset.itemCode}</div>
                    <div className="mt-1 text-base font-bold text-zinc-900">{asset.name}</div>
                    <div className="mt-4 grid gap-2 text-sm text-zinc-600">
                      <div>Specs: {asset.specs || 'Unknown specs'}</div>
                      <div>Serial Number: {asset.serialNumber || 'Unavailable'}</div>
                      <div>Warranty: {formatWarranty(asset.warrantyExpiresAt)}</div>
                      <div>Assigned: {formatAssignmentAge(asset.assignedAt)}</div>
                      <div>Status: {asset.status}</div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleStockAction(asset.id, 'return')}
                        disabled={assetActionLoadingId === asset.id}
                        className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
                      >
                        {assetActionLoadingId === asset.id ? 'Updating...' : 'Return'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStockAction(asset.id, 'retire')}
                        disabled={assetActionLoadingId === asset.id}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"
                      >
                        {assetActionLoadingId === asset.id ? 'Updating...' : 'Scrap'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAssetAction({ assetId: asset.id, action: 'delete' })}
                        disabled={assetActionLoadingId === asset.id}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                      >
                        {assetActionLoadingId === asset.id ? 'Updating...' : 'Delete Asset'}
                      </button>
                    </div>
                  </div>
                ))}

                {unassignedImportedDevices.length ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                    <div className="text-xs font-bold uppercase tracking-wider text-amber-700">Imported Systems Awaiting Assignment</div>
                    <p className="mt-1 text-sm text-amber-900">These systems have synced into ITMS but are not linked to a portal user yet, so they will not appear under a user profile.</p>
                    <div className="mt-2 text-xs font-semibold text-amber-800">{inventoryDevicesLoading ? 'Loading imported systems...' : `${inventoryDevicesTotal} imported systems pending assignment`}</div>
                    <div className="mt-3 space-y-2">
                      {unassignedImportedDevices.map((device) => (
                        <div
                          key={`unassigned-${device.id}`}
                          className="rounded-xl border border-amber-100 bg-white px-3 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => navigate(`${basePath}/devices/${device.id}`)}
                              className="min-w-0 text-left"
                            >
                              <div className="text-sm font-bold text-zinc-900">{device.hostname}</div>
                              <div className="mt-1 text-xs text-zinc-500">{device.assetId} • {device.deviceType || 'device'} • {device.osName || 'OS pending'}</div>
                            </button>
                            <span className="text-xs font-bold text-amber-700">Unassigned</span>
                          </div>
                          {device.installationIdentity ? (
                            <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-700">
                              <div><span className="font-bold text-zinc-900">Name:</span> {device.installationIdentity.requesterName || '-'}</div>
                              <div className="mt-1"><span className="font-bold text-zinc-900">Email:</span> {device.installationIdentity.requesterEmail || '-'}</div>
                              <div className="mt-1"><span className="font-bold text-zinc-900">Employee ID:</span> {device.installationIdentity.employeeId || '-'}</div>
                              <div className="mt-1"><span className="font-bold text-zinc-900">Department:</span> {device.installationIdentity.department || '-'}</div>
                            </div>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`${basePath}/devices/${device.id}`)}
                              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                            >
                              Open device
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAssignImportedDevice(device.id)}
                              disabled={!selectedUser || assigningDeviceId === device.id}
                              className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {assigningDeviceId === device.id ? 'Assigning...' : `Assign to ${selectedUser?.fullName || 'selected user'}`}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Pagination
                      currentPage={inventoryDevicesPage}
                      totalItems={inventoryDevicesTotal}
                      pageSize={IMPORTED_DEVICES_PAGE_SIZE}
                      onPageChange={setInventoryDevicesPage}
                      itemLabel="systems"
                    />
                  </div>
                ) : null}

              </div>
            )}
          </aside>
        </div>
      ) : null}

      {activeTab === 'employee' ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <form onSubmit={handleCreateEmployee} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Add Employee</div>
            <h2 className="mt-2 text-xl font-bold text-zinc-900">Create a new employee account</h2>
            <p className="mt-1 text-sm text-zinc-500">Manual employee creation uses the current entity and keeps CSV tools in their own tab.</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-sm text-zinc-700">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Full Name</div>
                <input value={employeeForm.fullName} onChange={(event) => setEmployeeForm((current) => ({ ...current, fullName: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900" />
              </label>
              <label className="text-sm text-zinc-700">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Email</div>
                <input type="email" value={employeeForm.email} onChange={(event) => setEmployeeForm((current) => ({ ...current, email: event.target.value }))} placeholder="employee@zerodha.com" className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900" />
              </label>
              <label className="text-sm text-zinc-700">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Employee ID</div>
                <input value={employeeForm.employeeCode} onChange={(event) => setEmployeeForm((current) => ({ ...current, employeeCode: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900" />
              </label>
              <label className="text-sm text-zinc-700">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Role</div>
                <select value={employeeForm.role} onChange={(event) => setEmployeeForm((current) => ({ ...current, role: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900">
                  <option value="employee">Employee</option>
                  <option value="it_team">IT Team</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </label>
              <label className="text-sm text-zinc-700">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Department</div>
                <select value={employeeForm.departmentId} onChange={(event) => setEmployeeForm((current) => ({ ...current, departmentId: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900">
                  <option value="">Select department</option>
                  {departmentOptions.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </label>
              <label className="text-sm text-zinc-700">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Branch</div>
                <select value={employeeForm.branchId} onChange={(event) => setEmployeeForm((current) => ({ ...current, branchId: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900">
                  <option value="">Select branch</option>
                  {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
              <label className="text-sm text-zinc-700 md:col-span-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Initial Password</div>
                <input type="password" value={employeeForm.initialPassword} onChange={(event) => setEmployeeForm((current) => ({ ...current, initialPassword: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900" />
              </label>
            </div>
            <button type="submit" disabled={creatingEmployee || !defaultEntityId} className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">{creatingEmployee ? 'Creating...' : 'Create Employee'}</button>
          </form>
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Entity</div>
            <div className="mt-2 text-sm text-zinc-700">{defaultEntityId || 'No entity available yet'}</div>
            <p className="mt-3 text-sm text-zinc-500">This form uses the current workspace entity. Department and branch selections are optional.</p>
          </div>
        </div>
      ) : null}

      {activeTab === 'imports' ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Import / Export</div>
              <h2 className="mt-2 text-xl font-bold text-zinc-900">User CSV tools</h2>
              <p className="mt-1 text-sm text-zinc-600">Use the minimal or extended template, export current users, or import a CSV file.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleDownloadUsersCsv('minimal-template')}
                disabled={csvActionLoading !== '' || importingUsers}
                className="inline-flex items-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="mr-2 h-4 w-4" />
                {csvActionLoading === 'minimal-template' ? 'Downloading...' : 'Download Minimal Template'}
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadUsersCsv('template')}
                disabled={csvActionLoading !== '' || importingUsers}
                className="inline-flex items-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="mr-2 h-4 w-4" />
                {csvActionLoading === 'template' ? 'Downloading...' : 'Download Extended Template'}
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadUsersCsv('export')}
                disabled={csvActionLoading !== '' || importingUsers}
                className="inline-flex items-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="mr-2 h-4 w-4" />
                {csvActionLoading === 'export' ? 'Exporting...' : 'Export Users'}
              </button>
              <button
                type="button"
                onClick={() => userImportInputRef.current?.click()}
                disabled={csvActionLoading !== '' || importingUsers}
                className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Upload className="mr-2 h-4 w-4" />
                {importingUsers ? 'Importing...' : 'Import CSV'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'install' ? (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Users</div>
              <p className="mt-1 text-sm text-zinc-500">Select a user and run the full endpoint install from this single page.</p>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-3 pl-10 pr-4 text-sm text-zinc-900"
                placeholder="Search user, employee ID, email, or department"
              />
            </div>

            <div className="space-y-2">
              {installUsers.map((user) => {
                const active = selectedUserId === user.id;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => setSelectedUserId(user.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${active ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'}`}
                  >
                    <div className="text-sm font-bold">{user.fullName}</div>
                    <div className="mt-1 text-xs text-zinc-500">{user.employeeCode} • {user.email}</div>
                  </button>
                );
              })}
            </div>
            <Pagination
              currentPage={installPage}
              totalItems={installTotal}
              pageSize={USERS_PAGE_SIZE}
              onPageChange={setInstallPage}
              itemLabel="users"
            />
          </aside>

          <section className="space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Install Agents</div>
                  <h2 className="mt-1 text-xl font-bold text-zinc-900">{selectedUser?.fullName || 'Select a user'}</h2>
                  <p className="mt-1 text-sm text-zinc-500">Run these commands directly on the target system. The employee fields below are included in the generated command and can still be changed before you run it. Asset name and asset tag are fetched or generated automatically on the endpoint during installation. The sync commands can be used later to push inventory again.</p>
                </div>
                {selectedUser ? <div className="rounded-xl bg-zinc-50 px-4 py-3 text-right"><div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Employee</div><div className="mt-2 text-sm font-bold text-zinc-900">{selectedUser.employeeCode}</div><div className="mt-1 text-xs text-zinc-500">These values are prefilled from the selected user and can be edited below before generating the final command.</div></div> : null}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-zinc-50 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Public server URL</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{installConfig?.publicServerUrl || (installConfigLoading ? 'Loading...' : 'Not configured')}</div>
                </div>
                <div className="rounded-xl bg-zinc-50 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Salt API</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{installConfig?.saltApiConfigured ? 'Configured' : installConfigLoading ? 'Loading...' : 'Not configured'}</div>
                </div>
                <div className="rounded-xl bg-zinc-50 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Wazuh API</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{installConfig?.wazuhApiConfigured ? 'Configured' : installConfigLoading ? 'Loading...' : 'Not configured'}</div>
                </div>
                <div className="rounded-xl bg-zinc-50 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Inventory token</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{installConfig?.inventoryIngestToken ? 'Ready' : installConfigLoading ? 'Loading...' : 'Missing'}</div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Employee Name</div>
                  <input
                    type="text"
                    value={installAssignedToName}
                    onChange={(event) => setInstallAssignedToName(event.target.value)}
                    placeholder="Employee name"
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                  />
                </label>
                <label className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Employee Email</div>
                  <input
                    type="email"
                    value={installAssignedToEmail}
                    onChange={(event) => setInstallAssignedToEmail(event.target.value)}
                    placeholder="employee@zerodha.com"
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                  />
                  {!installEmailValid && installAssignedToEmail.trim().length > 0 ? <div className="mt-2 text-xs text-rose-600">Use a valid `@zerodha.com` employee email.</div> : null}
                </label>
                <label className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Employee ID</div>
                  <input
                    type="text"
                    value={installEmployeeCode}
                    onChange={(event) => setInstallEmployeeCode(event.target.value)}
                    placeholder="Employee ID"
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                  />
                </label>
                <label className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Department</div>
                  <input
                    type="text"
                    list="install-department-options"
                    value={installDepartmentName}
                    onChange={(event) => setInstallDepartmentName(event.target.value)}
                    placeholder={mergedDepartmentOptions.length ? 'Select or type department' : 'Department'}
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                  />
                  <datalist id="install-department-options">
                    {mergedDepartmentOptions.map((department) => (
                      <option key={department.id} value={department.name} />
                    ))}
                  </datalist>
                  <div className="mt-2 text-xs text-zinc-500">
                    {mergedDepartmentOptions.length ? 'Choose one of the listed departments or type a new one manually.' : 'No department list is configured yet, so enter the department manually.'}
                  </div>
                </label>
              </div>
              <label className="mt-4 flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={includeLinuxHardinfoFallback}
                  onChange={(event) => setIncludeLinuxHardinfoFallback(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
                />
                <span>
                  <span className="block font-semibold text-zinc-900">Include Linux hardinfo fallback</span>
                  <span className="mt-1 block text-xs text-zinc-500">Adds `--use-hardinfo-fallback` to copied Linux install and sync commands. Turn it off if you want to keep Linux collection limited to the default structured probes.</span>
                </span>
              </label>
              <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">Use the Linux or Windows install code below on the endpoint. Each one-liner includes the employee fields shown above and triggers the first sync to ITMS automatically. Salt and Wazuh improve remote control and security visibility when configured, but the core onboarding flow only requires the server URL and inventory ingest token.</div>
              {!installFieldsComplete ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Complete Employee name, Employee email, Employee ID, and Department to generate a runnable install command.</div> : null}
            </div>

            {unassignedImportedDevices.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-700">Imported Systems Awaiting Assignment</div>
                <p className="mt-1 text-sm text-amber-900">The endpoint sync succeeded. These systems are in ITMS already, but they are not attached to a matching user record yet.</p>
                <div className="mt-2 text-xs font-semibold text-amber-800">{inventoryDevicesLoading ? 'Loading imported systems...' : `${inventoryDevicesTotal} imported systems pending assignment`}</div>
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  {unassignedImportedDevices.map((device) => (
                    <div
                      key={`install-unassigned-${device.id}`}
                      className="rounded-xl border border-amber-100 bg-white px-4 py-4 text-left"
                    >
                      <button
                        type="button"
                        onClick={() => navigate(`${basePath}/devices/${device.id}`)}
                        className="w-full text-left"
                      >
                        <div className="text-sm font-bold text-zinc-900">{device.hostname}</div>
                        <div className="mt-1 text-xs text-zinc-500">{device.assetId} • {device.deviceType || 'device'} • {device.osName || 'OS pending'}</div>
                        <div className="mt-2 text-xs font-semibold text-amber-700">Open device details</div>
                      </button>
                      {device.installationIdentity ? (
                        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-700">
                          <div><span className="font-bold text-zinc-900">Name:</span> {device.installationIdentity.requesterName || '-'}</div>
                          <div className="mt-1"><span className="font-bold text-zinc-900">Email:</span> {device.installationIdentity.requesterEmail || '-'}</div>
                          <div className="mt-1"><span className="font-bold text-zinc-900">Employee ID:</span> {device.installationIdentity.employeeId || '-'}</div>
                        </div>
                      ) : null}
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => void handleAssignImportedDevice(device.id)}
                          disabled={!selectedUser || assigningDeviceId === device.id}
                          className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {assigningDeviceId === device.id ? 'Assigning...' : `Assign to ${selectedUser?.fullName || 'selected user'}`}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <Pagination
                  currentPage={inventoryDevicesPage}
                  totalItems={inventoryDevicesTotal}
                  pageSize={IMPORTED_DEVICES_PAGE_SIZE}
                  onPageChange={setInventoryDevicesPage}
                  itemLabel="systems"
                />
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Linux Install Code</div>
                  <button
                    type="button"
                    onClick={() => void handleCopyCommand('linux', linuxInstallCommand)}
                    disabled={!installFieldsComplete}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {copyStatus === 'linux' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <h3 className="mt-1 text-lg font-bold text-zinc-900">Ubuntu or Debian install + first sync</h3>
                <p className="mt-2 text-sm text-zinc-500">Run once on the Linux endpoint. It installs the ITMS collector stack{includeLinuxHardinfoFallback ? ', enables the optional hardinfo fallback,' : ','} and performs the first inventory sync automatically.</p>
                  <pre className="mt-3 overflow-x-auto rounded-xl bg-zinc-900 px-3 py-3 text-xs text-zinc-100">{linuxInstallCommand}</pre>

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
                <p className="mt-2 text-sm text-zinc-500">Run later on the same Linux system whenever you want to push inventory into ITMS again.</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-zinc-900 px-3 py-3 text-xs text-zinc-100">{linuxSyncCommand}</pre>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Windows Install Code</div>
                  <button
                    type="button"
                    onClick={() => void handleCopyCommand('windows', windowsInstallCommand)}
                    disabled={!installFieldsComplete}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {copyStatus === 'windows' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <h3 className="mt-1 text-lg font-bold text-zinc-900">Windows install + first sync</h3>
                <p className="mt-2 text-sm text-zinc-500">Run once in an elevated PowerShell session on the Windows endpoint. It installs the ITMS collector stack, keeps detailed hardware inventory enabled, and performs the first inventory sync automatically.</p>
                  <pre className="mt-3 overflow-x-auto rounded-xl bg-zinc-900 px-3 py-3 text-xs text-zinc-100">{windowsInstallCommand}</pre>

                <div className="mt-5 flex items-center justify-between gap-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Windows Sync Code</div>
                  <button
                    type="button"
                    onClick={() => void handleCopyCommand('windows-sync', buildWindowsSyncCommand(installConfig, selectedUser))}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
                  >
                    {copyStatus === 'windows-sync' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="mt-2 text-sm text-zinc-500">Run later on the same Windows system whenever you want to push inventory into ITMS again.</p>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-zinc-900 px-3 py-3 text-xs text-zinc-100">{buildWindowsSyncCommand(installConfig, selectedUser)}</pre>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === 'access' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {!isSuperAdmin ? (
            <div className="lg:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
              <div className="text-base font-bold text-amber-900">Portal access editing is restricted</div>
              <p className="mt-2 text-sm text-amber-800">Only super admin can edit user portal access.</p>
            </div>
          ) : null}
          {loading ? <div className="lg:col-span-2 rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm">Loading portal access...</div> : null}
          {!loading && isSuperAdmin && accessUsers.length === 0 ? (
            <div className="lg:col-span-2 rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
              <div className="text-base font-bold text-zinc-900">No users available for portal access</div>
              <p className="mt-2 text-sm text-zinc-500">The access tab now ignores directory filters. If this is still empty, no user records were returned by the API for the current account.</p>
            </div>
          ) : null}
          {!loading && isSuperAdmin && accessUsers.map((user) => (
            <div key={user.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              {(() => {
                const selectedPortals = normalizePortalSelection(portalDrafts[user.id] || user.portals || []);
                const isCurrentSessionUser = session?.user.id === user.id;
                const isLockedUser = isCurrentSessionUser && user.role?.name === 'super_admin';
                const nextRole = portalsToRole(selectedPortals);
                const saveDisabled = isLockedUser || accessSavingUserId === user.id || nextRole === (user.role?.name || 'employee');
                return (
                  <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-bold text-zinc-900">{user.fullName}</div>
                  <div className="mt-1 text-sm text-zinc-500">{user.employeeCode} • {user.email}</div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isLockedUser ? <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Protected Role</div> : null}
                  <div className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-700">{user.department?.name || 'Department'}</div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl bg-zinc-50 p-4">
                <div className="flex items-center text-sm font-bold text-zinc-700">
                  <ShieldCheck className="mr-2 h-4 w-4 text-brand-600" />
                  Portal Access
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedPortals.map((portal) => (
                    <span key={portal} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-700 ring-1 ring-zinc-200">
                      {formatPortalLabel(portal)}
                    </span>
                  ))}
                </div>
                <div className="mt-4 space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Select Portals</div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {PORTAL_CHOICES.map((portal) => {
                      const selected = selectedPortals.includes(portal.id);
                      const disabled = isLockedUser || accessSavingUserId === user.id || (portal.id === 'employee' && selectedPortals.some((value) => value === 'it_team' || value === 'super_admin'));
                      return (
                        <label key={portal.id} className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-semibold ${selected ? 'border-brand-300 bg-white text-brand-700' : 'border-zinc-200 bg-white text-zinc-700'} ${disabled ? 'opacity-70' : ''}`}>
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={disabled}
                            onChange={(event) => handlePortalToggle(user.id, portal.id, event.target.checked)}
                            className="h-4 w-4 rounded border-zinc-300 text-brand-600 focus:ring-brand-500"
                          />
                          <span>{portal.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void handlePortalSave(user)}
                      disabled={saveDisabled}
                      className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {accessSavingUserId === user.id ? 'Saving access...' : 'Save Access'}
                    </button>
                    <span className="text-xs text-zinc-500">{isLockedUser ? 'Your own super admin access is kept read-only here to prevent locking yourself out of the portal.' : 'Choose one or more portals, then save. IT Team includes Employee, and Super Admin includes all portals.'}</span>
                  </div>
                </div>
              </div>
                  </>
                );
              })()}
            </div>
          ))}
          <div className="lg:col-span-2">
            <Pagination
              currentPage={accessPage}
              totalItems={accessTotal}
              pageSize={USERS_PAGE_SIZE}
              onPageChange={setAccessPage}
              itemLabel="users"
            />
          </div>
        </div>
      ) : null}

      {activeTab === 'audit' ? (
        <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-6 py-4">
            <h2 className="text-lg font-bold text-zinc-900">Audit Activity</h2>
            <p className="mt-1 text-sm text-zinc-500">Track who added assets, created gatepasses, ran patch jobs, or changed users.</p>
          </div>

          <div className="border-b border-zinc-100 px-6 py-4 space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                value={auditSearchQuery}
                onChange={(event) => setAuditSearchQuery(event.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-3 pl-10 pr-4 text-sm text-zinc-900"
                placeholder="Search by summary, actor, subject, action, or module"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {(['all', 'access', 'assets', 'gatepass', 'chat', 'terminal', 'requests', 'announcements', 'alerts', 'settings'] as AuditModule[]).map((module) => (
                <button
                  key={module}
                  type="button"
                  onClick={() => setAuditModuleFilter(module)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${auditModuleFilter === module ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                >
                  {formatAuditModuleLabel(module)}
                  <span className="ml-2 opacity-80">{module === 'all' ? auditTotal : (auditModuleCounts.get(module) || 0)}</span>
                </button>
              ))}
            </div>

            {auditActionFilter ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-3 text-sm text-brand-900">
                <span className="font-semibold">Action filter:</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-700 ring-1 ring-brand-200">{auditActionFilter}</span>
                <button type="button" onClick={() => setAuditActionFilter('')} className="text-xs font-bold uppercase tracking-wider text-brand-700 hover:text-brand-800">
                  Clear
                </button>
              </div>
            ) : null}
          </div>

          <div className="divide-y divide-zinc-100">
            {auditLoading ? <div className="px-6 py-10 text-center text-sm text-zinc-500">Loading audit activity...</div> : null}
            {!auditLoading && auditItems.length === 0 ? <div className="px-6 py-10 text-center text-sm text-zinc-500">No audit activity matched the current filters.</div> : null}

            {auditItems.map((entry) => {
              const module = getAuditModule(entry);
              const entityPath = resolveAuditEntityPath(basePath, entry);
              return (
              <div key={entry.id} className="px-6 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAuditModuleFilter(module)}
                        className="rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100"
                      >
                        {formatAuditModuleLabel(module)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuditActionFilter(entry.action)}
                        className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-700 hover:bg-zinc-200"
                      >
                        {entry.action}
                      </button>
                      {module === 'alerts' ? <ShieldAlert className="h-4 w-4 text-amber-600" /> : null}
                    </div>

                    <div className="mt-3 text-sm font-bold text-zinc-900">{entry.summary}</div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setAuditSearchQuery(entry.actor?.fullName || '')}
                        className="rounded-xl bg-zinc-50 px-3 py-3 text-left hover:bg-zinc-100"
                      >
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Actor</div>
                        <div className="mt-1 text-sm font-semibold text-zinc-900">{entry.actor?.fullName || 'Unknown user'}</div>
                        <div className="mt-1 text-xs text-zinc-500">{entry.actor?.email || 'No email recorded'}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (entityPath) {
                            navigate(entityPath);
                            return;
                          }
                          setAuditSearchQuery(entry.entityId);
                        }}
                        className="rounded-xl bg-zinc-50 px-3 py-3 text-left hover:bg-zinc-100"
                      >
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Subject</div>
                        <div className="mt-1 text-sm font-semibold text-zinc-900">{entry.subject?.fullName || 'System / none'}</div>
                        <div className="mt-1 text-xs text-zinc-500">Entity ID: {entry.entityId}</div>
                        <div className="mt-2 text-[11px] font-bold uppercase tracking-wider text-brand-700">{entityPath ? 'Open related record' : 'Filter by entity id'}</div>
                      </button>
                    </div>
                  </div>
                  <div className="text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    <div>{entry.entityType.replaceAll('_', ' ')}</div>
                    <div className="mt-1 normal-case text-zinc-400">{new Date(entry.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            )})}
          </div>
          <div className="border-t border-zinc-100 px-6 py-4">
            <Pagination
              currentPage={auditPage}
              totalItems={auditTotal}
              pageSize={AUDIT_PAGE_SIZE}
              onPageChange={setAuditPage}
              itemLabel="audit events"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}