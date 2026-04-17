import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../lib/api';

interface AssignedDevice {
  id: string;
  assetTag: string;
  hostname: string;
  serialNumber: string;
  specs: string;
  status: string;
  warrantyExpiresAt: string;
  assignedAt?: string;
  warrantyBadge?: string;
}

interface AssignedItem {
  id: string;
  itemCode: string;
  name: string;
  serialNumber: string;
  specs: string;
  status: string;
  warrantyExpiresAt: string;
  assignedAt?: string;
  warrantyBadge?: string;
}

function getWarrantyBadge(value: string) {
  if (!value) {
    return 'active';
  }

  const diffDays = Math.ceil((new Date(value).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) {
    return '7_days';
  }
  if (diffDays <= 15) {
    return '15_days';
  }
  if (diffDays <= 30) {
    return '30_days';
  }
  return 'active';
}

interface AssetsResponse {
  devices: AssignedDevice[];
  items: AssignedItem[];
}

function warrantyTone(value: string) {
  if (value === '7_days' || value === '15_days') {
    return 'bg-red-100 text-red-700';
  }

  if (value === '30_days') {
    return 'bg-amber-100 text-amber-700';
  }

  return 'bg-emerald-100 text-emerald-700';
}

function formatWarrantyWindow(value: string) {
  if (!value) {
    return 'Warranty date not set';
  }

  const diffDays = Math.ceil((new Date(value).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return `Expired ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} ago`;
  }
  if (diffDays === 0) {
    return 'Expires today';
  }
  return `${diffDays} day${diffDays === 1 ? '' : 's'} remaining`;
}

function formatAssignmentAge(value?: string) {
  if (!value) {
    return 'Assignment date not available';
  }

  const diffDays = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / (1000 * 60 * 60 * 24)));
  return `In use for ${diffDays} day${diffDays === 1 ? '' : 's'}`;
}

export default function MyAssetsPage() {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<AssetsResponse>({ devices: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadAssets = async () => {
      try {
        setLoading(true);
        setError('');
        const data = await apiRequest<AssetsResponse>('/api/me/assets');
        if (!cancelled) {
          setAssets(data);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load assigned assets');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, []);

  const totalAssets = useMemo(() => assets.devices.length + assets.items.length, [assets.devices.length, assets.items.length]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">My Assets</h1>
        <p className="text-sm text-zinc-500 mt-1">Devices and stock items assigned to your account.</p>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm">
        <span className="font-semibold text-zinc-900">{totalAssets}</span> assigned assets
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-zinc-100 bg-zinc-50 px-6 py-4 text-sm font-bold text-zinc-900">Assigned Devices</div>
          <div className="divide-y divide-zinc-100">
            {loading ? <div className="px-6 py-10 text-sm text-zinc-500">Loading devices...</div> : null}
            {!loading && assets.devices.length === 0 ? <div className="px-6 py-10 text-sm text-zinc-500">No assigned devices.</div> : null}
            {assets.devices.map((device) => (
              <button key={device.id} type="button" onClick={() => navigate(`/emp/devices/${device.id}`)} className="w-full px-6 py-4 text-left hover:bg-zinc-50 transition-colors">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-zinc-900">{device.hostname}</div>
                    <div className="mt-1 text-xs text-zinc-500">{device.assetTag} • {device.serialNumber || 'No serial'} • {device.specs || 'No specs'}</div>
                    <div className="mt-2 text-xs text-zinc-500">{formatAssignmentAge(device.assignedAt)}</div>
                    <div className="mt-1 text-xs text-zinc-500">{formatWarrantyWindow(device.warrantyExpiresAt)}</div>
                  </div>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${warrantyTone(device.warrantyBadge || getWarrantyBadge(device.warrantyExpiresAt))}`}>
                    {(device.warrantyBadge || getWarrantyBadge(device.warrantyExpiresAt)).replace('_', ' ')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-zinc-100 bg-zinc-50 px-6 py-4 text-sm font-bold text-zinc-900">Assigned Items</div>
          <div className="divide-y divide-zinc-100">
            {loading ? <div className="px-6 py-10 text-sm text-zinc-500">Loading stock items...</div> : null}
            {!loading && assets.items.length === 0 ? <div className="px-6 py-10 text-sm text-zinc-500">No assigned stock items.</div> : null}
            {assets.items.map((item) => (
              <div key={item.id} className="px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-zinc-900">{item.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{item.itemCode} • {item.serialNumber || 'No serial'} • {item.specs || 'No specs'}</div>
                    <div className="mt-2 text-xs text-zinc-500">{formatAssignmentAge(item.assignedAt)}</div>
                    <div className="mt-1 text-xs text-zinc-500">{formatWarrantyWindow(item.warrantyExpiresAt)}</div>
                  </div>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${warrantyTone(item.warrantyBadge || getWarrantyBadge(item.warrantyExpiresAt))}`}>
                    {(item.warrantyBadge || getWarrantyBadge(item.warrantyExpiresAt)).replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}