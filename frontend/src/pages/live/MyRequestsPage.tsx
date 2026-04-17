import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Clock3, MessageSquareText, PlusCircle, Sparkles } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import Pagination from '../../components/Pagination';

interface RequestComment {
  id: string;
  author: string;
  note: string;
  createdAt: string;
}

interface RequestRecord {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  comments: RequestComment[];
}

interface PaginatedRequestsResponse {
  items: RequestRecord[];
  total: number;
  page: number;
  pageSize: number;
}

function normalizeRequestRecord(request: RequestRecord): RequestRecord {
  return {
    ...request,
    title: request.title || '',
    description: request.description || '',
    notes: request.notes || '',
    comments: Array.isArray(request.comments) ? request.comments.filter(Boolean) : [],
  };
}

const REQUEST_TYPES = [
  'Laptop change',
  'OS reinstall',
  'Software install',
  'Portal access',
  'Settings change',
  'General issue',
  'Hardware replacement',
  'Peripheral request',
  'Other',
];

const MY_REQUESTS_PAGE_SIZE = 10;

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
  return 'bg-zinc-100 text-zinc-600';
}

export default function MyRequestsPage() {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRequests, setTotalRequests] = useState(0);
  const [form, setForm] = useState({ type: REQUEST_TYPES[0], title: '', description: '' });

  const summary = useMemo(() => ({
    open: requests.filter((request) => request.status === 'pending').length,
    inProgress: requests.filter((request) => request.status === 'in_progress').length,
    resolved: requests.filter((request) => request.status === 'resolved').length,
    comments: requests.reduce((count, request) => count + request.comments.length, 0),
  }), [requests]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ paginate: '1', page: String(currentPage), page_size: String(MY_REQUESTS_PAGE_SIZE) });
      const data = await apiRequest<PaginatedRequestsResponse>(`/api/me/requests?${params.toString()}`);
      setRequests(Array.isArray(data.items) ? data.items.map(normalizeRequestRecord) : []);
      setTotalRequests(data.total);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [currentPage]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.type || !form.title.trim()) {
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      await apiRequest('/api/me/requests', {
        method: 'POST',
        body: JSON.stringify({
          type: form.type,
          title: form.title.trim(),
          description: form.description.trim(),
        }),
      });
      setForm({ type: REQUEST_TYPES[0], title: '', description: '' });
      await loadRequests();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to create request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_32%),linear-gradient(135deg,_#fafaf9_0%,_#ffffff_52%,_#fef3c7_100%)] px-6 py-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-brand-700">
                <Sparkles className="mr-2 h-3.5 w-3.5" />
                Employee Support
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-zinc-950 sm:text-4xl">My Requests</h1>
              <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">Raise a request with the right context, then follow updates, notes, and replies without digging through a flat list.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:min-w-[520px]">
              <div className="rounded-2xl border border-white/90 bg-white/90 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Total</div>
                <div className="mt-2 text-3xl font-black text-zinc-950">{totalRequests}</div>
              </div>
              <div className="rounded-2xl border border-white/90 bg-white/90 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Open On Page</div>
                <div className="mt-2 text-3xl font-black text-zinc-950">{summary.open}</div>
              </div>
              <div className="rounded-2xl border border-white/90 bg-white/90 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">In Progress On Page</div>
                <div className="mt-2 text-3xl font-black text-zinc-950">{summary.inProgress}</div>
              </div>
              <div className="rounded-2xl border border-white/90 bg-white/90 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Replies On Page</div>
                <div className="mt-2 text-3xl font-black text-zinc-950">{summary.comments}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

      <form onSubmit={handleSubmit} className="grid gap-4 rounded-[24px] border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
            <PlusCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-bold text-zinc-900">Create A Request</div>
            <div className="mt-1 text-sm text-zinc-500">Pick the closest request type, keep the title specific, and add the business impact in the description.</div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">Request Type</label>
            <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900">
              {REQUEST_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">Title</label>
            <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900" placeholder="Short request title" />
          </div>
        </div>
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">Description</label>
          <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={4} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900" placeholder="Describe the request" />
          <div className="mt-2 text-xs text-zinc-500">Useful details: device name, software name, urgency, affected date, and what you already tried.</div>
        </div>
        <div>
          <button type="submit" disabled={submitting} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">
            {submitting ? 'Submitting...' : 'Raise Request'}
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-zinc-100 bg-zinc-50 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-bold text-zinc-900">Request History</div>
              <div className="mt-1 text-xs text-zinc-500">Follow the latest status, IT notes, and reply trail for each request.</div>
            </div>
            <div className="hidden items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500 md:flex">
              <ClipboardList className="h-4 w-4" />
              {totalRequests} tracked
            </div>
          </div>
        </div>
        <div className="divide-y divide-zinc-100">
          {loading ? <div className="px-6 py-10 text-sm text-zinc-500">Loading requests...</div> : null}
          {!loading && requests.length === 0 ? <div className="px-6 py-10 text-sm text-zinc-500">No requests raised yet.</div> : null}
          {requests.map((request) => (
            <div key={request.id} className="px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-zinc-900">{request.title}</div>
                    <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-700">{request.type}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> Created {formatRelativeTime(request.createdAt)}</span>
                    <span>Updated {formatRelativeTime(request.updatedAt)}</span>
                    <span>{request.comments.length} comments</span>
                  </div>
                </div>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusClasses(request.status)}`}>
                  {request.status.replaceAll('_', ' ')}
                </span>
              </div>
              <div className="mt-3 text-sm text-zinc-600">{request.description || 'No description provided.'}</div>
              {request.notes ? (
                <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/60 px-3 py-3 text-sm text-zinc-700">
                  <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-700">
                    <MessageSquareText className="h-3.5 w-3.5" />
                    IT notes
                  </div>
                  {request.notes}
                </div>
              ) : null}
              {request.comments.length ? (
                <div className="mt-4 space-y-2">
                  {request.comments.map((comment) => (
                    <div key={comment.id} className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-sm text-zinc-700">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-zinc-900">{comment.author}</div>
                        <div className="text-xs text-zinc-500">{formatDateTime(comment.createdAt)}</div>
                      </div>
                      <div className="mt-1">{comment.note}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={totalRequests}
          pageSize={MY_REQUESTS_PAGE_SIZE}
          onPageChange={setCurrentPage}
          itemLabel="requests"
        />
      </div>
    </div>
  );
}