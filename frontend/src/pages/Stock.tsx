import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Archive, Boxes, Building2, Eye, PackageCheck, PackagePlus, Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';

const STOCK_PAGE_SIZE = 24;

interface InventorySummary {
  total: number;
  available: number;
  allocated: number;
  retired: number;
  returned: number;
  inventory: number;
}

interface PaginatedStockResponse {
  items: StockItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: InventorySummary;
  groups?: StockGroupSummary[];
}

interface StockGroupSummary {
  category: string;
  name: string;
  total: number;
  available: number;
  allocated: number;
  retired: number;
  returned: number;
}

interface StockItem {
  id: string;
  itemCode: string;
  category: string;
  name: string;
  serialNumber: string;
  specs: string;
  branchId: string;
  assignedUserId: string;
  warrantyExpiresAt: string;
  status: string;
  createdAt: string;
}

interface BranchOption {
  id: string;
  name: string;
}

interface UserOption {
  id: string;
  fullName?: string;
  full_name?: string;
  employeeCode?: string;
  emp_id?: string;
}

interface UserMetaResponse {
  branches: BranchOption[];
}

interface AuditRecord {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  createdAt: string;
  actor?: { fullName?: string | null; email?: string | null } | null;
  detail?: Record<string, unknown> | null;
}

interface PaginatedAuditResponse {
  items: AuditRecord[];
  total: number;
  page: number;
  pageSize: number;
}

const CATEGORY_OPTIONS = ['Laptop', 'Desktop', 'Peripheral', 'Monitor', 'Cable', 'Consumable', 'Networking', 'Component'];

function formatDate(value: string) {
  if (!value) {
    return 'No expiry set';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString();
}

function getStatusTone(status: string) {
  if (status === 'allocated') {
    return 'bg-brand-100 text-brand-700 ring-brand-200';
  }
  if (status === 'retired') {
    return 'bg-rose-100 text-rose-700 ring-rose-200';
  }
  if (status === 'returned') {
    return 'bg-amber-100 text-amber-700 ring-amber-200';
  }
  return 'bg-emerald-100 text-emerald-700 ring-emerald-200';
}

function formatActivityAction(action: string) {
  return action
    .replace(/^stock_item_/, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatActivityTime(value: string) {
  if (!value) {
    return 'Unknown time';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function userDisplayName(user: UserOption) {
  return user.fullName || user.full_name || user.employeeCode || user.emp_id || user.id;
}

function userAllocationLabel(user: UserOption) {
  const name = userDisplayName(user);
  const employeeCode = user.employeeCode || user.emp_id || '';
  return employeeCode ? `${name} (${employeeCode})` : name;
}

function getReferencedUserIds(entries: AuditRecord[]) {
  return Array.from(new Set(entries.flatMap((entry) => {
    if (!entry.detail || typeof entry.detail !== 'object' || Array.isArray(entry.detail)) {
      return [] as string[];
    }
    const userId = entry.detail.userId;
    return typeof userId === 'string' && userId.trim() ? [userId] : [];
  })));
}

function formatAuditFieldLabel(key: string) {
  switch (key) {
    case 'branchId':
      return 'Branch';
    case 'category':
      return 'Category';
    case 'name':
      return 'Name';
    case 'serialNumber':
      return 'Serial Number';
    case 'specs':
      return 'Specs';
    case 'userId':
      return 'Allocated To';
    case 'warrantyExpiresAt':
      return 'Warranty';
    default:
      return key.replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase());
  }
}

function getAuditDetailRows(
  entry: AuditRecord,
  branchNameById: Record<string, string>,
  userNameById: Record<string, string>,
) {
  if (!entry.detail || typeof entry.detail !== 'object' || Array.isArray(entry.detail)) {
    return [] as Array<{ label: string; value: string }>;
  }

  return Object.entries(entry.detail).flatMap(([key, rawValue]) => {
    if (rawValue === null || rawValue === undefined) {
      return [];
    }

    let value = '';
    if (key === 'branchId') {
      value = branchNameById[String(rawValue)] || 'Branch removed';
    } else if (key === 'userId') {
      value = userNameById[String(rawValue)] || String(rawValue);
    } else if (key === 'warrantyExpiresAt') {
      value = rawValue ? formatDate(String(rawValue)) : 'No expiry set';
    } else if (typeof rawValue === 'string') {
      value = rawValue.trim() || (entry.action === 'stock_item_updated' ? 'Cleared' : 'Not set');
    } else {
      value = String(rawValue);
    }

    return [{ label: formatAuditFieldLabel(key), value }];
  });
}

export default function Stock() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [groupedItems, setGroupedItems] = useState<StockGroupSummary[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [recentStockActivity, setRecentStockActivity] = useState<AuditRecord[]>([]);
  const [selectedItemActivity, setSelectedItemActivity] = useState<AuditRecord[]>([]);
  const [allocationByItem, setAllocationByItem] = useState<Record<string, string>>({});
  const [allocationQueryByItem, setAllocationQueryByItem] = useState<Record<string, string>>({});
  const [allocationSuggestionsByItem, setAllocationSuggestionsByItem] = useState<Record<string, UserOption[]>>({});
  const [allocationLookupLoadingByItem, setAllocationLookupLoadingByItem] = useState<Record<string, boolean>>({});
  const [editingItemId, setEditingItemId] = useState('');
  const [deletingItemId, setDeletingItemId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [pendingDeleteItem, setPendingDeleteItem] = useState<StockItem | null>(null);
  const [form, setForm] = useState({
    category: 'Laptop',
    name: '',
    serialNumber: '',
    specs: '',
    branchId: '',
    warrantyExpiresAt: '',
  });

  const branchNameById = useMemo(() => Object.fromEntries(branches.map((branch) => [branch.id, branch.name])), [branches]);
  const stockGroups = useMemo(() => {
    if (groupedItems.length > 0) {
      return groupedItems;
    }

    const grouped = new Map<string, StockGroupSummary>();
    items.forEach((item) => {
      const key = `${item.category}::${item.name}`;
      const current = grouped.get(key) || { category: item.category, name: item.name, total: 0, available: 0, allocated: 0, retired: 0, returned: 0 };
      current.total += 1;
      if (item.status === 'allocated') {
        current.allocated += 1;
      } else if (item.status === 'retired') {
        current.retired += 1;
      } else if (item.status === 'returned') {
        current.returned += 1;
        current.available += 1;
      } else {
        current.available += 1;
      }
      grouped.set(key, current);
    });
    return Array.from(grouped.values()).sort((left, right) => left.available - right.available || left.name.localeCompare(right.name));
  }, [groupedItems, items]);
  const stockGroupByName = useMemo(() => Object.fromEntries(stockGroups.map((group) => [`${group.category}::${group.name}`, group])), [stockGroups]);

  const [inventoryMetrics, setInventoryMetrics] = useState<InventorySummary>({ total: 0, available: 0, allocated: 0, retired: 0, returned: 0, inventory: 0 });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        paginate: '1',
        page: String(currentPage),
        page_size: String(STOCK_PAGE_SIZE),
      });
      if (branchFilter !== 'all') {
        params.set('branch', branchFilter);
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const [stockData, meta, recentAudit] = await Promise.all([
        apiRequest<PaginatedStockResponse>(`/api/stock?${params.toString()}`),
        apiRequest<UserMetaResponse>('/api/users/meta/options'),
        apiRequest<PaginatedAuditResponse>('/api/audit?paginate=1&page=1&page_size=10&entity_type=stock_item').catch(() => ({ items: [], total: 0, page: 1, pageSize: 10 })),
      ]);
      setItems(stockData.items);
      setGroupedItems(stockData.groups || []);
      setFilteredTotal(stockData.total);
      setInventoryMetrics(stockData.summary);
      setBranches(meta.branches || []);
      setRecentStockActivity(recentAudit.items || []);
      setForm((current) => ({ ...current, branchId: current.branchId || meta.branches?.[0]?.id || '' }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load stock data');
    } finally {
      setLoading(false);
    }
  }, [branchFilter, currentPage, searchQuery]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setCurrentPage(1);
  }, [branchFilter, searchQuery]);

  const filteredCountLabel = useMemo(() => {
    if (loading) {
      return 'Loading inventory';
    }

    if (!searchQuery.trim() && branchFilter === 'all') {
      return `${filteredTotal} items in inventory`;
    }

    return `${filteredTotal} items match the current view`;
  }, [branchFilter, filteredTotal, loading, searchQuery]);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) || null, [items, selectedItemId]);

  useEffect(() => {
    if (!selectedItemId) {
      setSelectedItemActivity([]);
      return;
    }

    let cancelled = false;

    const loadSelectedItemActivity = async () => {
      try {
        const data = await apiRequest<PaginatedAuditResponse>(`/api/audit?paginate=1&page=1&page_size=12&entity_type=stock_item&entity_id=${encodeURIComponent(selectedItemId)}`);
        if (!cancelled) {
          setSelectedItemActivity(data.items || []);
        }
      } catch {
        if (!cancelled) {
          setSelectedItemActivity([]);
        }
      }
    };

    void loadSelectedItemActivity();

    return () => {
      cancelled = true;
    };
  }, [selectedItemId]);

  useEffect(() => {
    const referencedUserIds = Array.from(new Set([
      ...items.map((item) => item.assignedUserId).filter(Boolean),
      ...getReferencedUserIds(recentStockActivity),
    ])).filter((userId) => !userNameById[userId]);

    if (referencedUserIds.length === 0) {
      return;
    }

    let cancelled = false;

    const loadUserNames = async () => {
      const users = await Promise.all(referencedUserIds.map(async (userId) => {
        try {
          const user = await apiRequest<UserOption>(`/api/users/${encodeURIComponent(userId)}`);
          return [userId, userDisplayName(user)] as const;
        } catch {
          return null;
        }
      }));

      if (cancelled) {
        return;
      }

      const nextEntries = Object.fromEntries(users.filter((entry): entry is readonly [string, string] => Boolean(entry)));
      if (Object.keys(nextEntries).length > 0) {
        setUserNameById((current) => ({ ...current, ...nextEntries }));
      }
    };

    void loadUserNames();

    return () => {
      cancelled = true;
    };
  }, [items, recentStockActivity, userNameById]);

  useEffect(() => {
    const referencedUserIds = getReferencedUserIds(selectedItemActivity).filter((userId) => !userNameById[userId]);
    if (referencedUserIds.length === 0) {
      return;
    }

    let cancelled = false;

    const loadUserNames = async () => {
      const users = await Promise.all(referencedUserIds.map(async (userId) => {
        try {
          const user = await apiRequest<UserOption>(`/api/users/${encodeURIComponent(userId)}`);
          return [userId, userDisplayName(user)] as const;
        } catch {
          return null;
        }
      }));

      if (cancelled) {
        return;
      }

      const nextEntries = Object.fromEntries(users.filter((entry): entry is readonly [string, string] => Boolean(entry)));
      if (Object.keys(nextEntries).length > 0) {
        setUserNameById((current) => ({ ...current, ...nextEntries }));
      }
    };

    void loadUserNames();

    return () => {
      cancelled = true;
    };
  }, [selectedItemActivity, userNameById]);

  const loadAllocationSuggestions = async (itemId: string, query: string) => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      setAllocationLookupLoadingByItem((current) => ({ ...current, [itemId]: false }));
      setAllocationSuggestionsByItem((current) => ({ ...current, [itemId]: [] }));
      return;
    }

    try {
      setAllocationLookupLoadingByItem((current) => ({ ...current, [itemId]: true }));
      const params = new URLSearchParams({
        paginate: '1',
        page: '1',
        page_size: '12',
        search: trimmedQuery,
        exclude_role: 'super_admin',
      });
      const data = await apiRequest<{ items: UserOption[] }>(`/api/users?${params.toString()}`);
      const suggestions = data.items || [];
      setAllocationSuggestionsByItem((current) => ({ ...current, [itemId]: suggestions }));
      setUserNameById((current) => ({
        ...current,
        ...Object.fromEntries(suggestions.map((user) => [user.id, userDisplayName(user)])),
      }));
      const exactMatch = suggestions.find((user) => {
        const normalized = trimmedQuery.toLowerCase();
        return userAllocationLabel(user).toLowerCase() === normalized
          || userDisplayName(user).toLowerCase() === normalized
          || (user.employeeCode || user.emp_id || '').toLowerCase() === normalized;
      });
      if (exactMatch) {
        setAllocationByItem((current) => ({ ...current, [itemId]: exactMatch.id }));
      }
    } catch {
      setAllocationSuggestionsByItem((current) => ({ ...current, [itemId]: [] }));
    } finally {
      setAllocationLookupLoadingByItem((current) => ({ ...current, [itemId]: false }));
    }
  };

  const handleAllocationLookupChange = (itemId: string, value: string) => {
    setAllocationQueryByItem((current) => ({ ...current, [itemId]: value }));
    const normalized = value.trim().toLowerCase();
    const matchedUser = (allocationSuggestionsByItem[itemId] || []).find((user) => userAllocationLabel(user).toLowerCase() === normalized);
    setAllocationByItem((current) => ({ ...current, [itemId]: matchedUser?.id || '' }));
    void loadAllocationSuggestions(itemId, value);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      await apiRequest(editingItemId ? `/api/stock/${editingItemId}` : '/api/stock', {
        method: editingItemId ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      });
      setForm({
        category: 'Laptop',
        name: '',
        serialNumber: '',
        specs: '',
        branchId: branches[0]?.id || '',
        warrantyExpiresAt: '',
      });
      setEditingItemId('');
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : editingItemId ? 'Failed to update stock item' : 'Failed to create stock item');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditStart = (item: StockItem) => {
    setEditingItemId(item.id);
    setError('');
    setForm({
      category: item.category || 'Laptop',
      name: item.name || '',
      serialNumber: item.serialNumber || '',
      specs: item.specs || '',
      branchId: item.branchId || branches[0]?.id || '',
      warrantyExpiresAt: item.warrantyExpiresAt ? item.warrantyExpiresAt.slice(0, 10) : '',
    });
  };

  const handleEditCancel = () => {
    setEditingItemId('');
    setError('');
    setForm({
      category: 'Laptop',
      name: '',
      serialNumber: '',
      specs: '',
      branchId: branches[0]?.id || '',
      warrantyExpiresAt: '',
    });
  };

  const handleDelete = async (itemId: string) => {
    try {
      setDeletingItemId(itemId);
      setError('');
      await apiRequest(`/api/stock/${itemId}`, { method: 'DELETE' });
      if (editingItemId === itemId) {
        handleEditCancel();
      }
      setPendingDeleteItem(null);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete stock item');
    } finally {
      setDeletingItemId('');
    }
  };

  const handleAllocate = async (itemId: string) => {
    const userId = allocationByItem[itemId];
    if (!userId) {
      return;
    }

    try {
      setError('');
      await apiRequest(`/api/stock/${itemId}/allocate`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      setAllocationByItem((current) => ({ ...current, [itemId]: '' }));
      setAllocationQueryByItem((current) => ({ ...current, [itemId]: '' }));
      setAllocationSuggestionsByItem((current) => ({ ...current, [itemId]: [] }));
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to allocate stock item');
    }
  };

  const renderAllocationControl = (item: StockItem, variant: 'mobile' | 'desktop') => {
    const datalistId = `stock-allocate-users-${variant}-${item.id}`;
    const suggestions = allocationSuggestionsByItem[item.id] || [];
    const query = allocationQueryByItem[item.id] || '';
    const isLookupLoading = Boolean(allocationLookupLoadingByItem[item.id]);

    return (
      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
        <input
          list={datalistId}
          value={allocationQueryByItem[item.id] || ''}
          onChange={(event) => handleAllocationLookupChange(item.id, event.target.value)}
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          placeholder="Search user by name or employee code"
        />
        <datalist id={datalistId}>
          {suggestions.map((user) => <option key={user.id} value={userAllocationLabel(user)} />)}
        </datalist>
        <div className="text-[11px] text-zinc-500">
          {query.trim().length < 2
            ? 'Type at least 2 characters to search users.'
            : isLookupLoading
              ? 'Searching users...'
              : suggestions.length > 0
                ? `${suggestions.length} user suggestion${suggestions.length === 1 ? '' : 's'} ready.`
                : 'No users matched this search.'}
        </div>
        <button type="button" onClick={() => void handleAllocate(item.id)} disabled={!allocationByItem[item.id]} className="inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
          Allocate Item
        </button>
      </div>
    );
  };

  const handleTransition = async (itemId: string, action: 'return' | 'retire') => {
    try {
      setError('');
      await apiRequest(`/api/stock/${itemId}/${action}`, { method: 'POST' });
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Failed to ${action} stock item`);
    }
  };

  return (
    <div className="space-y-6 px-4 py-5 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
        <div className="relative bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.14),_transparent_32%),linear-gradient(135deg,#f8fafc_0%,#ffffff_55%,#eef4ff_100%)] px-6 py-7 lg:px-8">
          <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-brand-100/60 blur-3xl" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-brand-700">
                Inventory Control
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-zinc-950 sm:text-4xl">Stock Inventory</h1>
              <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">Track stock counts, branch placement, allocation, returns, and low-stock items from one view.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:min-w-[520px]">
              {[
                { label: 'Total Items', value: inventoryMetrics.total, icon: Boxes },
                { label: 'Ready to Assign', value: inventoryMetrics.available, icon: PackageCheck },
                { label: 'Allocated', value: inventoryMetrics.allocated, icon: RotateCcw },
                { label: 'Retired', value: inventoryMetrics.retired, icon: Archive },
              ].map((card) => (
                <div key={card.label} className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm backdrop-blur">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{card.label}</span>
                    <card.icon className="h-4 w-4 text-brand-600" />
                  </div>
                  <div className="mt-3 text-3xl font-black tracking-tight text-zinc-950">{loading ? '...' : card.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

      <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 bg-zinc-50/80 px-6 py-5">
          <h2 className="text-lg font-black text-zinc-950">Stock Item Counts</h2>
          <p className="mt-1 text-sm text-zinc-500">Grouped item availability with low-stock highlighting when ready count drops below 3.</p>
        </div>
        <div className="grid gap-3 px-6 py-6 md:grid-cols-2 xl:grid-cols-4">
          {stockGroups.length === 0 ? <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">No grouped stock data yet.</div> : null}
          {stockGroups.slice(0, 8).map((group) => {
            const lowStock = group.available < 3;
            return (
              <div key={`${group.category}-${group.name}`} className={`rounded-2xl border px-4 py-4 ${lowStock ? 'border-rose-200 bg-rose-50' : 'border-zinc-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-zinc-900">{group.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{group.category}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${lowStock ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {lowStock ? 'Low' : 'Healthy'}
                  </span>
                </div>
                <div className={`mt-4 text-2xl font-black ${lowStock ? 'text-rose-700' : 'text-zinc-950'}`}>{group.available}</div>
                <div className="mt-1 text-xs text-zinc-500">Ready to assign out of {group.total} total</div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
        <form onSubmit={handleCreate} className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 bg-zinc-50/80 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-black text-zinc-950">
                  <PackagePlus className="h-5 w-5 text-brand-600" />
                  {editingItemId ? 'Edit Inventory Item' : 'Add Inventory Item'}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">{editingItemId ? 'Update stock metadata and branch assignment.' : 'Create a stock entry for branch inventory.'}</p>
              </div>
              <div className="rounded-2xl border border-brand-200 bg-brand-50 px-3 py-2 text-right">
                <div className="text-[11px] font-bold uppercase tracking-wider text-brand-700">Branch Coverage</div>
                <div className="mt-1 text-xl font-black text-brand-900">{branches.length}</div>
              </div>
            </div>
          </div>

          <div className="space-y-5 px-6 py-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Category</label>
                <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100">
                  {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Item Name</label>
                <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" placeholder="MacBook Pro 14, Dell Dock, Headset" />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Serial Number</label>
                <input value={form.serialNumber} onChange={(event) => setForm((current) => ({ ...current, serialNumber: event.target.value }))} className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" placeholder="Serial or service tag" />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Warranty Expiry</label>
                <input type="date" value={form.warrantyExpiresAt ? form.warrantyExpiresAt.slice(0, 10) : ''} onChange={(event) => setForm((current) => ({ ...current, warrantyExpiresAt: event.target.value }))} className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Branch</label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <select value={form.branchId} onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))} className="w-full rounded-xl border border-zinc-200 bg-white py-3 pl-11 pr-4 text-sm text-zinc-900 transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100">
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Specs</label>
                <textarea value={form.specs} onChange={(event) => setForm((current) => ({ ...current, specs: event.target.value }))} rows={4} className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" placeholder="Processor, RAM, model, vendor notes, or anything needed for handover" />
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
              Keep the item name human-readable. Use Specs for model details, accessory notes, and procurement identifiers that help the IT team during allocation.
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
                <PackagePlus className="mr-2 h-4 w-4" />
                {submitting ? (editingItemId ? 'Saving Changes...' : 'Saving Inventory Item...') : (editingItemId ? 'Save Changes' : 'Add Inventory Item')}
              </button>
              {editingItemId ? (
                <button type="button" onClick={handleEditCancel} disabled={submitting} className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </form>

        <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 bg-zinc-50/80 px-6 py-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-lg font-black text-zinc-950">Inventory Registry</h2>
                <p className="mt-1 text-sm text-zinc-500">Search, filter, assign, return, and retire stock items without leaving the page.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px] xl:min-w-[520px] xl:max-w-[640px] xl:flex-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search by code, name, serial, or specs" className="w-full rounded-xl border border-zinc-200 bg-white py-3 pl-11 pr-4 text-sm text-zinc-900 transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </div>
                <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 transition focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100">
                  <option value="all">All branches</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-6 py-4">
            <div className="text-sm font-semibold text-zinc-700">{filteredCountLabel}</div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 ring-1 ring-emerald-200">Inventory {items.filter((item) => item.status === 'inventory').length}</span>
              <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-700 ring-1 ring-brand-200">Allocated {inventoryMetrics.allocated}</span>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700 ring-1 ring-amber-200">Returned {inventoryMetrics.returned}</span>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700 ring-1 ring-rose-200">Retired {inventoryMetrics.retired}</span>
            </div>
          </div>

          <div className="space-y-4 p-4 md:hidden">
            {loading ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">Loading stock inventory...</div>
            ) : null}
            {!loading && items.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-zinc-500 ring-1 ring-zinc-200">
                  <Boxes className="h-6 w-6" />
                </div>
                <div className="mt-4 text-base font-bold text-zinc-900">No stock items match this view</div>
                <p className="mt-2 text-sm text-zinc-500">Try another branch filter, clear the search, or add the first inventory item from the form above.</p>
              </div>
            ) : null}
            {!loading ? items.map((item) => (
              <article key={item.id} className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-black text-zinc-950">{item.name}</h3>
                    <p className="mt-1 text-xs text-zinc-500">{item.itemCode} • {item.category}</p>
                  </div>
                  <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-[11px] font-bold capitalize ring-1 ${getStatusTone(item.status)}`}>
                    {item.status.replaceAll('_', ' ')}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Branch</div>
                    <div className="mt-1 font-semibold text-zinc-800">{branchNameById[item.branchId] || 'Unassigned'}</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Warranty</div>
                    <div className="mt-1 font-semibold text-zinc-800">{formatDate(item.warrantyExpiresAt)}</div>
                  </div>
                  <div className="col-span-2 rounded-2xl bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Serial / Specs</div>
                    <div className="mt-1 text-sm text-zinc-700">
                      {item.serialNumber || 'No serial number'}
                      {item.specs ? ` • ${item.specs}` : ''}
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setSelectedItemId(item.id)} className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-bold text-zinc-700 transition hover:bg-zinc-50">
                      <Eye className="mr-2 h-3.5 w-3.5" />
                      Details
                    </button>
                    <button type="button" onClick={() => handleEditStart(item)} className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-bold text-zinc-700 transition hover:bg-zinc-50">
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Edit
                    </button>
                  </div>
                  {item.status !== 'allocated' ? (
                    <button type="button" onClick={() => setPendingDeleteItem(item)} disabled={deletingItemId === item.id} className="inline-flex w-full items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60">
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      {deletingItemId === item.id ? 'Deleting...' : 'Delete'}
                    </button>
                  ) : null}
                  {(item.status === 'inventory' || item.status === 'returned') ? (
                    renderAllocationControl(item, 'mobile')
                  ) : null}
                  {item.status === 'allocated' ? (
                    <button type="button" onClick={() => void handleTransition(item.id, 'return')} className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-900 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-zinc-800">
                      Mark Returned
                    </button>
                  ) : null}
                  {item.status !== 'retired' ? (
                    <button type="button" onClick={() => void handleTransition(item.id, 'retire')} className="inline-flex w-full items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100">
                      Retire Item
                    </button>
                  ) : null}
                </div>
              </article>
            )) : null}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-6 py-4">Item</th>
                  <th className="px-6 py-4">Branch</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Warranty</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center text-zinc-500">Loading stock inventory...</td>
                  </tr>
                ) : null}
                {!loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <div className="mx-auto max-w-md">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500">
                          <Boxes className="h-6 w-6" />
                        </div>
                        <div className="mt-4 text-base font-bold text-zinc-900">No stock items match this view</div>
                        <p className="mt-2 text-sm text-zinc-500">Try another branch filter, clear the search, or add the first inventory item from the form on the left.</p>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {items.map((item) => (
                  <tr key={item.id} className="align-top transition hover:bg-zinc-50/70">
                    <td className="px-6 py-5">
                      <button type="button" onClick={() => setSelectedItemId(item.id)} className="text-left font-bold text-zinc-950 transition hover:text-brand-700">
                        {item.name}
                      </button>
                      <div className="mt-1 text-xs text-zinc-500">{item.itemCode} • {item.category}</div>
                      {stockGroupByName[`${item.category}::${item.name}`] ? (
                        <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${stockGroupByName[`${item.category}::${item.name}`].available < 3 ? 'bg-rose-100 text-rose-700' : 'bg-zinc-100 text-zinc-700'}`}>
                          {stockGroupByName[`${item.category}::${item.name}`].available} ready • {stockGroupByName[`${item.category}::${item.name}`].total} total
                        </div>
                      ) : null}
                      <div className="mt-2 text-xs text-zinc-500">{item.serialNumber || 'No serial number'}{item.specs ? ` • ${item.specs}` : ''}</div>
                    </td>
                    <td className="px-6 py-5 text-sm text-zinc-600">{branchNameById[item.branchId] || 'Unassigned'}</td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold capitalize ring-1 ${getStatusTone(item.status)}`}>
                        {item.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-sm text-zinc-600">{formatDate(item.warrantyExpiresAt)}</td>
                    <td className="px-6 py-5">
                      <div className="space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <button type="button" onClick={() => setSelectedItemId(item.id)} className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-bold text-zinc-700 transition hover:bg-zinc-50">
                            <Eye className="mr-2 h-3.5 w-3.5" />
                            Details
                          </button>
                          <button type="button" onClick={() => handleEditStart(item)} className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-bold text-zinc-700 transition hover:bg-zinc-50">
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Edit
                          </button>
                          {item.status !== 'allocated' ? (
                            <button type="button" onClick={() => setPendingDeleteItem(item)} disabled={deletingItemId === item.id} className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60">
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              {deletingItemId === item.id ? 'Deleting...' : 'Delete'}
                            </button>
                          ) : (
                            <div />
                          )}
                        </div>
                        {(item.status === 'inventory' || item.status === 'returned') ? (
                          renderAllocationControl(item, 'desktop')
                        ) : null}
                        {item.status === 'allocated' ? (
                          <button type="button" onClick={() => void handleTransition(item.id, 'return')} className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-900 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-zinc-800">
                            Mark Returned
                          </button>
                        ) : null}
                        {item.status !== 'retired' ? (
                          <button type="button" onClick={() => void handleTransition(item.id, 'retire')} className="inline-flex w-full items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100">
                            Retire Item
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalItems={filteredTotal}
            pageSize={STOCK_PAGE_SIZE}
            onPageChange={setCurrentPage}
            itemLabel="stock items"
          />
        </div>
      </div>

      <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 bg-zinc-50/80 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-brand-50 p-2 text-brand-700">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-zinc-950">Recent Stock Activity</h2>
              <p className="mt-1 text-sm text-zinc-500">Live audit trail for stock create, update, allocation, return, retire, and delete actions.</p>
            </div>
          </div>
        </div>

        <div className="divide-y divide-zinc-100">
          {recentStockActivity.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-zinc-500">No stock activity has been recorded yet.</div>
          ) : recentStockActivity.map((entry) => (
            <div key={entry.id} className="grid gap-3 px-6 py-4 md:grid-cols-[220px_minmax(0,1fr)_220px] md:items-start">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Action</div>
                <div className="mt-1 text-sm font-bold text-zinc-900">{formatActivityAction(entry.action)}</div>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Summary</div>
                <div className="mt-1 text-sm text-zinc-700">{entry.summary}</div>
                {entry.entityId ? <div className="mt-1 text-xs text-zinc-500">Item ID: {entry.entityId}</div> : null}
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Actor / Time</div>
                <div className="mt-1 text-sm font-semibold text-zinc-800">{entry.actor?.fullName || entry.actor?.email || 'System'}</div>
                <div className="mt-1 text-xs text-zinc-500">{formatActivityTime(entry.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {selectedItem ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/45">
          <button type="button" aria-label="Close item details" className="flex-1" onClick={() => setSelectedItemId('')} />
          <aside className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 border-b border-zinc-100 bg-white/95 px-6 py-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">Stock Item Detail</div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-zinc-950">{selectedItem.name}</h2>
                  <p className="mt-1 text-sm text-zinc-500">{selectedItem.itemCode} • {selectedItem.category}</p>
                </div>
                <button type="button" onClick={() => setSelectedItemId('')} className="rounded-xl border border-zinc-200 bg-white p-2 text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="space-y-6 px-6 py-6">
              <div className="grid gap-4 sm:grid-cols-2">
                {stockGroupByName[`${selectedItem.category}::${selectedItem.name}`] ? (
                  <div className={`rounded-2xl border p-4 sm:col-span-2 ${stockGroupByName[`${selectedItem.category}::${selectedItem.name}`].available < 3 ? 'border-rose-200 bg-rose-50' : 'border-zinc-200 bg-zinc-50'}`}>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Stock Count</div>
                    <div className={`mt-2 text-2xl font-black ${stockGroupByName[`${selectedItem.category}::${selectedItem.name}`].available < 3 ? 'text-rose-700' : 'text-zinc-900'}`}>
                      {stockGroupByName[`${selectedItem.category}::${selectedItem.name}`].available} ready
                    </div>
                    <div className="mt-1 text-sm text-zinc-600">
                      {stockGroupByName[`${selectedItem.category}::${selectedItem.name}`].total} total • {stockGroupByName[`${selectedItem.category}::${selectedItem.name}`].allocated} allocated • {stockGroupByName[`${selectedItem.category}::${selectedItem.name}`].returned} returned
                    </div>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Status</div>
                  <div className="mt-2">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold capitalize ring-1 ${getStatusTone(selectedItem.status)}`}>
                      {selectedItem.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Branch</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{branchNameById[selectedItem.branchId] || 'Unassigned'}</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Serial Number</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{selectedItem.serialNumber || 'No serial number'}</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Warranty Expiry</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{formatDate(selectedItem.warrantyExpiresAt)}</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:col-span-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Specs</div>
                  <div className="mt-2 text-sm leading-6 text-zinc-700">{selectedItem.specs || 'No specs recorded for this item.'}</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:col-span-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Created</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{formatActivityTime(selectedItem.createdAt)}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => { handleEditStart(selectedItem); setSelectedItemId(''); }} className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50">
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit Item
                </button>
                {selectedItem.status !== 'allocated' ? (
                  <button type="button" onClick={() => { setPendingDeleteItem(selectedItem); setSelectedItemId(''); }} className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700 transition hover:bg-rose-100">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Item
                  </button>
                ) : null}
              </div>

              <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-100 bg-zinc-50 px-5 py-4">
                  <h3 className="text-base font-black text-zinc-950">Item History</h3>
                  <p className="mt-1 text-sm text-zinc-500">Recent audit entries linked to this stock item.</p>
                </div>
                <div className="divide-y divide-zinc-100">
                  {selectedItemActivity.length === 0 ? (
                    <div className="px-5 py-10 text-center text-sm text-zinc-500">No audit entries are linked to this stock item yet.</div>
                  ) : selectedItemActivity.map((entry) => (
                    <div key={entry.id} className="grid gap-2 px-5 py-4 md:grid-cols-[180px_minmax(0,1fr)]">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Action</div>
                        <div className="mt-1 text-sm font-bold text-zinc-900">{formatActivityAction(entry.action)}</div>
                        <div className="mt-1 text-xs text-zinc-500">{formatActivityTime(entry.createdAt)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-zinc-700">{entry.summary}</div>
                        <div className="mt-2 text-xs text-zinc-500">Actor: {entry.actor?.fullName || entry.actor?.email || 'System'}</div>
                        {getAuditDetailRows(entry, branchNameById, userNameById).length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {getAuditDetailRows(entry, branchNameById, userNameById).map((detail) => (
                              <div key={`${entry.id}-${detail.label}`} className="rounded-2xl bg-zinc-100 px-3 py-2 text-xs text-zinc-700 ring-1 ring-zinc-200">
                                <span className="font-bold text-zinc-900">{detail.label}:</span> {detail.value}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </aside>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDeleteItem)}
        title="Delete Stock Item"
        message={pendingDeleteItem ? `Delete ${pendingDeleteItem.name} from stock inventory? This cannot be undone.` : 'Delete this stock item?'}
        confirmLabel="Delete Item"
        tone="danger"
        busy={Boolean(pendingDeleteItem && deletingItemId === pendingDeleteItem.id)}
        onClose={() => setPendingDeleteItem(null)}
        onConfirm={() => {
          if (pendingDeleteItem) {
            void handleDelete(pendingDeleteItem.id);
          }
        }}
      />
    </div>
  );
}