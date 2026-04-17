import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, ShieldCheck, ShieldAlert, Clock, RefreshCw, Play } from 'lucide-react';
import { apiRequest } from '../lib/api';
import Pagination from '../components/Pagination';

const PATCH_PAGE_SIZE = 20;

interface PatchDevice {
  id: string;
  hostname: string;
  osName?: string | null;
  patchStatus: string;
  department?: { name?: string } | null;
  user?: { fullName?: string } | null;
  patchGroup?: { name?: string } | null;
}

interface PaginatedPatchDevicesResponse {
  items: PatchDevice[];
  total: number;
  page: number;
  pageSize: number;
}

export default function PatchList() {
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.split('/patch')[0];
  const [devices, setDevices] = useState<PatchDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalDevices, setTotalDevices] = useState(0);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [runningPatch, setRunningPatch] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadDevices = async () => {
      try {
        setLoading(true);
        setError('');
        setSuccessMessage('');
        const params = new URLSearchParams({ paginate: '1', page: String(currentPage), page_size: String(PATCH_PAGE_SIZE) });
        if (searchQuery.trim()) {
          params.set('search', searchQuery.trim());
        }
        const data = await apiRequest<PaginatedPatchDevicesResponse>(`/api/patch/devices?${params.toString()}`);
        if (!cancelled) {
          setDevices(data.items || []);
          setTotalDevices(data.total || 0);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load patch devices');
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

  useEffect(() => {
    setSelectedDeviceIds([]);
  }, [currentPage, searchQuery, selectedDepartment]);

  const totalLabel = useMemo(() => {
    if (loading) {
      return 'Loading devices';
    }
    if (searchQuery.trim()) {
      return `${totalDevices} devices match this search`;
    }
    return `${totalDevices} managed devices`;
  }, [loading, searchQuery, totalDevices]);

  const departmentOptions = useMemo(() => ['all', ...Array.from(new Set(devices.map((device) => device.department?.name || '').filter(Boolean))).sort()], [devices]);
  const filteredDevices = useMemo(() => (
    selectedDepartment === 'all'
      ? devices
      : devices.filter((device) => (device.department?.name || '') === selectedDepartment)
  ), [devices, selectedDepartment]);
  const selectedDevices = useMemo(() => filteredDevices.filter((device) => selectedDeviceIds.includes(device.id)), [filteredDevices, selectedDeviceIds]);
  const allVisibleSelected = filteredDevices.length > 0 && filteredDevices.every((device) => selectedDeviceIds.includes(device.id));

  const toggleDeviceSelection = (deviceId: string) => {
    setSelectedDeviceIds((current) => current.includes(deviceId) ? current.filter((id) => id !== deviceId) : [...current, deviceId]);
  };

  const toggleAllVisible = () => {
    setSelectedDeviceIds((current) => {
      if (allVisibleSelected) {
        return current.filter((id) => !filteredDevices.some((device) => device.id === id));
      }
      const next = new Set(current);
      filteredDevices.forEach((device) => next.add(device.id));
      return Array.from(next);
    });
  };

  const queuePatchRun = async (targetDevices: PatchDevice[]) => {
    if (targetDevices.length === 0) {
      return;
    }

    try {
      setRunningPatch(true);
      setError('');
      setSuccessMessage('');
      const results = await Promise.allSettled(targetDevices.map((device) => apiRequest('/api/patch/run', {
        method: 'POST',
        body: JSON.stringify({ scope: device.hostname }),
      })));
      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - successCount;
      setSuccessMessage(failedCount > 0
        ? `Queued ${successCount} patch run(s). ${failedCount} device(s) could not be queued.`
        : `Queued ${successCount} patch run(s).`);
      if (successCount > 0) {
        setSelectedDeviceIds([]);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to queue patch run');
    } finally {
      setRunningPatch(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Deployment & Devices</h1>
          <p className="text-slate-500 text-sm mt-1">Granular visibility into device-level patching actions.</p>
        </div>
        <div className="flex space-x-3">
          <button type="button" onClick={() => navigate(`${basePath}/patch`)} className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
            Dashboard
          </button>
          <button type="button" onClick={() => void queuePatchRun(selectedDevices)} disabled={runningPatch || selectedDevices.length === 0} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60">
            <Play className="mr-2 h-4 w-4" />
            {runningPatch ? 'Queueing...' : `Patch Selected${selectedDevices.length ? ` (${selectedDevices.length})` : ''}`}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px_240px]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Batch Actions</div>
          <p className="mt-2 text-sm text-slate-500">Queue patch runs for the selected rows or the current department view.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void queuePatchRun(selectedDevices)} disabled={runningPatch || selectedDevices.length === 0} className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
              <Play className="mr-2 h-4 w-4" />
              Run Selected
            </button>
            <button type="button" onClick={() => void queuePatchRun(filteredDevices)} disabled={runningPatch || filteredDevices.length === 0} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <RefreshCw className="mr-2 h-4 w-4" />
              Run Department View
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Department Filter</div>
          <select value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)} className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900">
            {departmentOptions.map((department) => (
              <option key={department} value={department}>{department === 'all' ? 'All departments' : department}</option>
            ))}
          </select>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Selection</div>
          <div className="mt-3 text-2xl font-bold text-slate-900">{selectedDevices.length}</div>
          <div className="mt-1 text-sm text-slate-500">selected in this view</div>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {successMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div> : null}

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
              placeholder="Search Hostname, Department..."
            />
          </div>
          <div className="text-sm font-semibold text-slate-600">{totalLabel}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="w-12 px-6 py-3 text-left">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Asset Info</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Department</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Patch Group</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Compliance</th>
                <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-500">Loading device patch statuses...</td></tr>
              ) : filteredDevices.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-500">No managed devices found.</td></tr>
              ) : (
                filteredDevices.map((device) => (
                  <tr key={device.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input type="checkbox" checked={selectedDeviceIds.includes(device.id)} onChange={() => toggleDeviceSelection(device.id)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button type="button" onClick={() => navigate(`${basePath}/devices/${device.id}`)} className="text-sm font-semibold text-slate-900 hover:text-brand-700">{device.hostname}</button>
                      <div className="text-xs text-slate-500 mt-0.5">{device.osName} • {device.user?.fullName || 'Unassigned'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-900">{device.department?.name || 'Unknown'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-slate-600">{device.patchGroup?.name || 'Default Ring'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {device.patchStatus === 'up_to_date' && <ShieldCheck className="h-5 w-5 text-emerald-500" />}
                        {device.patchStatus === 'pending' && <Clock className="h-5 w-5 text-amber-500" />}
                        {device.patchStatus === 'failed' && <ShieldAlert className="h-5 w-5 text-red-500" />}
                        
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                          ${device.patchStatus === 'up_to_date' ? 'bg-green-100 text-green-800' 
                          : device.patchStatus === 'pending' ? 'bg-amber-100 text-amber-800' 
                          : 'bg-red-100 text-red-800'}`}>
                          {device.patchStatus.replace('_', ' ')}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button type="button" onClick={() => void queuePatchRun([device])} disabled={runningPatch} className="text-brand-600 hover:text-brand-900 flex items-center justify-end w-full disabled:opacity-60">
                        <RefreshCw className="mr-1.5 h-4 w-4" /> Run Patch
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
          pageSize={PATCH_PAGE_SIZE}
          onPageChange={setCurrentPage}
          itemLabel="devices"
        />
      </div>
    </div>
  );
}
