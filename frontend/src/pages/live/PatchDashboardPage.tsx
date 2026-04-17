import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../../lib/api';

interface PatchMetrics {
  total: number;
  upToDate: number;
  pending: number;
  failed: number;
  rebootPending: number;
}

interface PatchDevice {
  id: string;
  hostname: string;
  patchStatus: string;
  complianceScore: number;
  osName?: string | null;
  department?: { name: string } | null;
  user?: { fullName: string } | null;
}

interface PaginatedPatchDevicesResponse {
  items: PatchDevice[];
  total: number;
  page: number;
  pageSize: number;
  summary?: PatchMetrics;
}

export default function PatchDashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.split('/patch')[0];
  const [metrics, setMetrics] = useState<PatchMetrics | null>(null);
  const [devices, setDevices] = useState<PatchDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [runningBatch, setRunningBatch] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async () => {
      try {
        setLoading(true);
        setError('');
        setSuccessMessage('');

        const devicesData = await apiRequest<PaginatedPatchDevicesResponse>('/api/patch/devices?paginate=1&page=1&page_size=100');

        if (!cancelled) {
          setMetrics(devicesData.summary || null);
          setDevices(devicesData.items || []);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load patch dashboard');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  const departments = useMemo(() => ['all', ...Array.from(new Set(devices.map((device) => device.department?.name || '').filter(Boolean))).sort()], [devices]);
  const filteredDevices = useMemo(() => (
    selectedDepartment === 'all'
      ? devices
      : devices.filter((device) => (device.department?.name || '') === selectedDepartment)
  ), [devices, selectedDepartment]);
  const topDevices = useMemo(() => filteredDevices.slice(0, 8), [filteredDevices]);

  const handleBatchRun = async (batchDevices: PatchDevice[]) => {
    if (batchDevices.length === 0) {
      return;
    }

    try {
      setRunningBatch(true);
      setError('');
      setSuccessMessage('');
      const results = await Promise.allSettled(batchDevices.map((device) => apiRequest('/api/patch/run', {
        method: 'POST',
        body: JSON.stringify({ scope: device.hostname }),
      })));
      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - successCount;
      setSuccessMessage(failedCount > 0
        ? `Queued ${successCount} patch runs. ${failedCount} device(s) could not be queued.`
        : `Queued ${successCount} patch runs.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to queue batch patch update');
    } finally {
      setRunningBatch(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight flex items-center">
            <Activity className="mr-3 h-6 w-6 text-brand-600" />
            Patch Dashboard
          </h1>
          <p className="text-sm text-zinc-500 mt-1">Live patch compliance summary for managed devices.</p>
        </div>
        <button type="button" onClick={() => navigate(`${basePath}/patch/devices`)} className="px-4 py-2 bg-white border border-zinc-200 rounded-lg text-sm font-bold text-zinc-700 hover:bg-zinc-50">
          View Device List
        </button>
      </div>

      {error ? <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">{error}</div> : null}
  {successMessage ? <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-4 text-sm">{successMessage}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {[
          { label: 'Managed Devices', value: metrics?.total ?? 0, icon: Activity },
          { label: 'Up to Date', value: metrics?.upToDate ?? 0, icon: ShieldCheck },
          { label: 'Pending', value: metrics?.pending ?? 0, icon: RefreshCw },
          { label: 'Failed', value: metrics?.failed ?? 0, icon: ShieldAlert },
          { label: 'Reboot Pending', value: metrics?.rebootPending ?? 0, icon: Activity },
        ].map((card) => (
          <div key={card.label} className="bg-white border border-zinc-200 rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">{card.label}</span>
              <card.icon className="w-4 h-4 text-brand-600" />
            </div>
            <div className="text-3xl font-bold text-zinc-900">{loading ? '-' : card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Batch Update Run</div>
          <h2 className="mt-2 text-lg font-bold text-zinc-900">Run patch updates for multiple devices</h2>
          <p className="mt-2 text-sm text-zinc-500">Use the selected department filter below, then queue patch updates for the visible device set.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleBatchRun(filteredDevices)}
              disabled={runningBatch || filteredDevices.length === 0}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {runningBatch ? 'Queueing...' : `Run Batch Update (${filteredDevices.length})`}
            </button>
            <button
              type="button"
              onClick={() => navigate(`${basePath}/patch/devices`)}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
            >
              Review Device List
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Department Update</div>
          <select
            value={selectedDepartment}
            onChange={(event) => setSelectedDepartment(event.target.value)}
            className="mt-3 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900"
          >
            {departments.map((department) => (
              <option key={department} value={department}>{department === 'all' ? 'All departments' : department}</option>
            ))}
          </select>
          <div className="mt-3 text-sm text-zinc-500">{filteredDevices.length} managed device(s) in this view.</div>
          <button
            type="button"
            onClick={() => void handleBatchRun(filteredDevices)}
            disabled={runningBatch || filteredDevices.length === 0}
            className="mt-4 w-full rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
          >
            {runningBatch ? 'Queueing...' : 'Run Department Update'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-900">Priority Devices</h2>
          <span className="text-sm text-zinc-500">{topDevices.length} shown</span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Device</th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Owner</th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Department</th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Patch Status</th>
                <th className="px-6 py-4 text-left text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Compliance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-zinc-500">Loading patch dashboard...</td>
                </tr>
              ) : topDevices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-zinc-500">No patch data is available yet.</td>
                </tr>
              ) : topDevices.map((device) => (
                <tr key={device.id} className="hover:bg-zinc-50 cursor-pointer" onClick={() => navigate(`${basePath}/devices/${device.id}`)}>
                  <td className="px-6 py-4">
                    <div className="font-semibold text-zinc-900">{device.hostname}</div>
                    <div className="text-xs text-zinc-500 mt-1">{device.osName || 'Unknown OS'}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{device.user?.fullName || 'Unassigned'}</td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{device.department?.name || 'Unknown'}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${device.patchStatus === 'failed' ? 'bg-red-100 text-red-700' : device.patchStatus === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {device.patchStatus.replaceAll('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-zinc-700">{device.complianceScore}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}