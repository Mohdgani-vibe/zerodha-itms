import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Filter, HardDrive, RefreshCw, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import Pagination from '../components/Pagination';

const DEVICES_PAGE_SIZE = 50;

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
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

async function loadInventoryData(page: number, searchQuery: string) {
  const params = new URLSearchParams({
    paginate: '1',
    page: String(page),
    page_size: String(DEVICES_PAGE_SIZE),
  });
  if (searchQuery.trim()) {
    params.set('search', searchQuery.trim());
  }
  const deviceData = await apiRequest<PaginatedResponse<DeviceRecord>>(`/api/devices?${params.toString()}`);
  let statusData: SyncStatus | null = null;
  try {
    statusData = await apiRequest<SyncStatus>('/api/inventory-sync/status');
  } catch {
    statusData = null;
  }
  return { deviceData, statusData };
}

interface DeviceRecord {
  id: string;
  assetId: string;
  hostname: string;
  deviceType?: string;
  osName?: string;
  gpu?: string | null;
  macAddress?: string | null;
  lastSeenAt?: string | null;
  patchStatus: string;
  alertStatus: string;
  status: string;
  user?: { fullName?: string; employeeCode?: string } | null;
  branch?: { name?: string } | null;
  department?: { name?: string } | null;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export default function Devices() {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalDevices, setTotalDevices] = useState(0);
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [runningServerSync, setRunningServerSync] = useState(false);
  const [showAdvancedColumns, setShowAdvancedColumns] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.split('/devices')[0];

  useEffect(() => {
    let cancelled = false;

    const loadDevices = async () => {
      try {
        setLoading(true);
        setError('');
        const { deviceData, statusData } = await loadInventoryData(currentPage, searchQuery);
        if (!cancelled) {
          setDevices(deviceData.items);
          setTotalDevices(deviceData.total);
          setSyncStatus(statusData);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load devices');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDevices();

    return () => {
      cancelled = true;
    };
  }, [currentPage, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const handleRunBackendSync = async () => {
    try {
      setRunningServerSync(true);
      setError('');
      await apiRequest('/api/inventory-sync/run', { method: 'POST' });
      const { deviceData, statusData } = await loadInventoryData(currentPage, searchQuery);
      setDevices(deviceData.items);
      setTotalDevices(deviceData.total);
      setSyncStatus(statusData);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to run backend inventory sync');
    } finally {
      setRunningServerSync(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center">
          <HardDrive className="mr-3 h-6 w-6 text-brand-600" />
          Asset Inventory
        </h1>
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={() => setShowAdvancedColumns((current) => !current)}
            className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50"
          >
            {showAdvancedColumns ? 'Hide More Columns' : 'Show More Columns'}
          </button>
          <button className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
            <Filter className="mr-2 h-4 w-4" />
            Filters
          </button>
        </div>
      </div>

      {syncStatus?.enabled ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Backend Inventory Sync</div>
              <h2 className="mt-2 text-lg font-bold text-slate-900">Daily sync runs on the server</h2>
              <p className="mt-1 text-sm text-slate-600">The backend fetches inventory from the configured source, stores hardware details in PostgreSQL, and this UI reads the synced asset records.</p>
              {!syncStatus.configured ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Configure `INVENTORY_SYNC_SOURCE_URL` with a real inventory source before running sync.
                </div>
              ) : null}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => void handleRunBackendSync()}
                  disabled={runningServerSync || !syncStatus.configured}
                  className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${runningServerSync ? 'animate-spin' : ''}`} />
                  {runningServerSync ? 'Running Backend Sync...' : 'Run Real Backend Sync'}
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-xl border border-white bg-white p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Source</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{syncStatus.sourceType}</div>
              </div>
              <div className="rounded-xl border border-white bg-white p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Interval</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{syncStatus.interval}</div>
              </div>
              <div className="rounded-xl border border-white bg-white p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Last Run</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{syncStatus.lastRun ? new Date(syncStatus.lastRun.startedAt).toLocaleString() : 'Not run yet'}</div>
              </div>
              <div className="rounded-xl border border-white bg-white p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Records</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{syncStatus.lastRun ? `${syncStatus.lastRun.recordsUpserted}/${syncStatus.lastRun.recordsSeen}` : '0/0'}</div>
              </div>
              <div className="rounded-xl border border-white bg-white p-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Status</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{syncStatus.running ? 'Running now' : syncStatus.lastRun?.status || (syncStatus.configured ? 'Scheduled' : 'Not configured')}</div>
              </div>
            </div>
          </div>
          {syncStatus.lastRun?.error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{syncStatus.lastRun.error}</div> : null}
        </div>
      ) : null}

      <div className="bg-white shadow-sm rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <div className="relative rounded-md shadow-sm w-96">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="focus:ring-brand-500 focus:border-brand-500 block w-full pl-10 sm:text-sm border-slate-300 rounded-md py-2 px-3 border"
              placeholder="Search by hostname, Asset ID or user..."
            />
          </div>
        </div>
        {error ? <div className="px-6 py-4 text-sm text-rose-700 bg-rose-50 border-b border-rose-100">{error}</div> : null}
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Asset Info</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Assigned To</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Location</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Health / Patch</th>
                {showAdvancedColumns ? <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Hardware</th> : null}
                {showAdvancedColumns ? <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Last Seen</th> : null}
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {loading ? (
                <tr><td colSpan={showAdvancedColumns ? 8 : 6} className="px-6 py-12 text-center text-slate-500">Loading assets...</td></tr>
              ) : devices.length === 0 ? (
                <tr><td colSpan={showAdvancedColumns ? 8 : 6} className="px-6 py-12 text-center text-slate-500">No devices found.</td></tr>
              ) : (
                devices.map((device) => (
                  <tr key={device.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="ml-0">
                          <div className="text-sm font-semibold text-brand-700 hover:text-brand-900 cursor-pointer">{device.hostname}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{device.deviceType} • {device.osName} • {device.assetId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-900">{device.user?.fullName || 'Unassigned'}</div>
                      <div className="text-xs text-slate-500">{device.user?.employeeCode || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-900">{device.branch?.name || '-'}</div>
                      <div className="text-xs text-slate-500">{device.department?.name || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {device.alertStatus === 'healthy' || device.alertStatus === 'secure' ? (
                          <ShieldCheck className="h-5 w-5 text-emerald-500" />
                        ) : (
                          <ShieldAlert className="h-5 w-5 text-red-500" />
                        )}
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${device.patchStatus === 'up_to_date' ? 'bg-slate-100 text-slate-800' : 'bg-amber-100 text-amber-800'}`}>
                          {device.patchStatus.replace('_', ' ')}
                        </span>
                      </div>
                    </td>
                    {showAdvancedColumns ? (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-slate-900">{device.gpu || '-'}</div>
                        <div className="text-xs text-slate-500">{device.macAddress || '-'}</div>
                      </td>
                    ) : null}
                    {showAdvancedColumns ? (
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                        {formatDateTime(device.lastSeenAt)}
                      </td>
                    ) : null}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                        {device.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => navigate(`${basePath}/devices/${device.id}`)}
                        className="text-slate-400 hover:text-slate-600 font-semibold"
                      >
                       Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={totalDevices}
          pageSize={DEVICES_PAGE_SIZE}
          onPageChange={setCurrentPage}
          itemLabel="devices"
        />
      </div>
    </div>
  );
}
