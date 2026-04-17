import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Megaphone, Plus } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { getStoredSession } from '../lib/session';
import Pagination from '../components/Pagination';

const ANNOUNCEMENTS_PAGE_SIZE = 12;
const AUDIENCE_OPTIONS = ['All Employees', 'IT Team', 'Super Admin'] as const;
const ANNOUNCEMENT_FILTERS = ['All', ...AUDIENCE_OPTIONS] as const;
const ANNOUNCEMENTS_UPDATED_EVENT = 'itms:announcements-updated';

interface Announcement {
   id: string;
   title: string;
   body: string;
   audience: string;
   urgent: boolean;
   createdAt: string;
   authorName: string;
}

interface PaginatedAnnouncementsResponse {
   items: Announcement[];
   total: number;
   page: number;
   pageSize: number;
}

type AnnouncementFilter = typeof ANNOUNCEMENT_FILTERS[number];

function getVisibleAudiences(role: string, canPost: boolean) {
   if (canPost) {
      return [...AUDIENCE_OPTIONS];
   }

   if (role === 'super_admin') {
      return ['All Employees', 'Super Admin'];
   }

   if (role === 'it_team') {
      return ['All Employees', 'IT Team'];
   }

   return ['All Employees'];
}

export default function Announcements() {
   const session = getStoredSession();
   const role = session?.user.role || '';
   const canPost = role === 'super_admin' || role === 'it_team';
   const [announcements, setAnnouncements] = useState<Announcement[]>([]);
   const [loading, setLoading] = useState(true);
   const [saving, setSaving] = useState(false);
   const [error, setError] = useState('');
   const [successMessage, setSuccessMessage] = useState('');
   const [currentPage, setCurrentPage] = useState(1);
   const [totalAnnouncements, setTotalAnnouncements] = useState(0);
   const [audienceFilter, setAudienceFilter] = useState<AnnouncementFilter>('All');
   const [form, setForm] = useState({ title: '', body: '', audience: 'All Employees', urgent: false });
   const visibleAudiences = useMemo(() => getVisibleAudiences(role, canPost), [canPost, role]);
   const featuredAnnouncements = useMemo(() => announcements.slice(0, 3), [announcements]);
   const olderAnnouncements = useMemo(() => announcements.slice(3), [announcements]);

   const loadAnnouncements = useCallback(async () => {
      setLoading(true);
      setError('');
      try {
         const params = new URLSearchParams({
            paginate: '1',
            page: String(currentPage),
            page_size: String(ANNOUNCEMENTS_PAGE_SIZE),
         });
         if (audienceFilter === 'All') {
            visibleAudiences.forEach((audience) => params.append('audience', audience));
         } else {
            params.append('audience', audienceFilter);
         }
         const data = await apiRequest<PaginatedAnnouncementsResponse>(`/api/announcements?${params.toString()}`);
         setAnnouncements(Array.isArray(data.items) ? data.items : []);
         setTotalAnnouncements(data.total);
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to load announcements');
      } finally {
         setLoading(false);
      }
   }, [audienceFilter, currentPage, visibleAudiences]);

   useEffect(() => {
      void loadAnnouncements();
   }, [loadAnnouncements]);

   useEffect(() => {
      const handleAnnouncementUpdate = () => {
         void loadAnnouncements();
      };
      window.addEventListener(ANNOUNCEMENTS_UPDATED_EVENT, handleAnnouncementUpdate);

      return () => {
         window.removeEventListener(ANNOUNCEMENTS_UPDATED_EVENT, handleAnnouncementUpdate);
      };
   }, [loadAnnouncements]);

   useEffect(() => {
      setCurrentPage(1);
   }, [audienceFilter]);

   const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canPost || !form.title.trim() || !form.body.trim()) {
         return;
      }

      try {
         setSaving(true);
         setError('');
         setSuccessMessage('');
         await apiRequest('/api/announcements', {
            method: 'POST',
            body: JSON.stringify({
               title: form.title.trim(),
               body: form.body.trim(),
               audience: form.audience,
               urgent: form.urgent,
            }),
         });
         setForm({ title: '', body: '', audience: 'All Employees', urgent: false });
         setAudienceFilter(form.audience as AnnouncementFilter);
         setSuccessMessage('Announcement posted successfully.');
         await loadAnnouncements();
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to create announcement');
      } finally {
         setSaving(false);
      }
   };

   return (
      <div className="max-w-5xl mx-auto space-y-6 p-4">
         <div className="flex items-start justify-between gap-4 mb-8">
            <div>
               <h1 className="text-2xl font-bold text-zinc-900 tracking-tight flex items-center">
                  <Megaphone className="mr-3 h-6 w-6 text-brand-600" />
                  Company Announcements
               </h1>
               <p className="text-sm text-zinc-500 mt-1">Live broadcast feed for employees, IT, and admins.</p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-600 shadow-sm">
               {totalAnnouncements} visible announcements
            </div>
         </div>

         {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
         {successMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{successMessage}</div> : null}

         {canPost ? (
            <form onSubmit={handleSubmit} className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
               <div className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                  <Plus className="w-4 h-4 text-brand-600" />
                  New Announcement
               </div>
               <div className="grid gap-4 md:grid-cols-2">
                  <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Announcement title" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900" />
                  <select value={form.audience} onChange={(event) => setForm((current) => ({ ...current, audience: event.target.value }))} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900">
                     {AUDIENCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
               </div>
               <textarea value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} rows={4} placeholder="Write the announcement body" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900" />
               <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input type="checkbox" checked={form.urgent} onChange={(event) => setForm((current) => ({ ...current, urgent: event.target.checked }))} />
                  Mark as urgent
               </label>
               <div>
                  <button type="submit" disabled={saving} className="inline-flex items-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-zinc-800 disabled:opacity-60">
                     <Plus className="w-4 h-4 mr-2" />
                     {saving ? 'Posting...' : 'Post Announcement'}
                  </button>
               </div>
            </form>
         ) : null}

         <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
               {ANNOUNCEMENT_FILTERS.filter((option) => option === 'All' || visibleAudiences.includes(option)).map((option) => {
                  const active = audienceFilter === option;
                  return (
                     <button
                        key={option}
                        type="button"
                        onClick={() => setAudienceFilter(option)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-100'}`}
                     >
                        {option}
                     </button>
                  );
               })}
            </div>
         </div>

         <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
               <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">Older Announcements</div>
                  <p className="mt-1 text-sm text-zinc-500">Previous posts stay visible here for quick review.</p>
               </div>
               {loading ? <div className="text-sm text-zinc-500">Loading announcements...</div> : null}
               {!loading && olderAnnouncements.length === 0 ? <div className="rounded-xl bg-zinc-50 px-3 py-4 text-sm text-zinc-500">No older announcements for this filter.</div> : null}
               {olderAnnouncements.map((item) => (
                  <div key={item.id} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                     <div className="text-sm font-bold text-zinc-900">{item.title}</div>
                     <div className="mt-1 text-xs text-zinc-500">{item.authorName}</div>
                     <div className="mt-2 text-xs text-zinc-500">{new Date(item.createdAt).toLocaleString()}</div>
                  </div>
               ))}
            </aside>
            <div className="space-y-4">
               {loading ? <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm">Loading announcements...</div> : null}
               {!loading && announcements.length === 0 ? <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm">No announcements available for this filter.</div> : null}
               {featuredAnnouncements.map((item) => (
                  <div key={item.id} className={`bg-white rounded-xl p-6 shadow-sm relative overflow-hidden border ${item.urgent ? 'border-red-200' : 'border-zinc-200'}`}>
                     <div className="absolute top-0 right-0 p-3 pt-4">
                        <div className={`${item.urgent ? 'bg-red-100 text-red-700' : 'bg-zinc-100 text-zinc-600'} text-[10px] font-extrabold uppercase px-2 py-1 rounded`}>
                           {item.urgent ? 'Urgent' : item.audience}
                        </div>
                     </div>
                     <div className="flex items-start">
                        <div className={`w-12 h-12 rounded-full border flex items-center justify-center shrink-0 ${item.urgent ? 'bg-red-50 text-red-600 border-red-100' : 'bg-brand-50 text-brand-600 border-brand-100'}`}>
                           <BellRing className="w-6 h-6" />
                        </div>
                        <div className="ml-5">
                           <h3 className="text-lg font-bold text-zinc-900">{item.title}</h3>
                           <p className="text-sm text-zinc-600 mt-1.5 leading-relaxed max-w-3xl whitespace-pre-wrap">{item.body}</p>
                           <div className="flex flex-wrap gap-4 mt-4 text-xs font-semibold text-zinc-500">
                              <span>Target: {item.audience || 'All Employees'}</span>
                              <span>Author: {item.authorName}</span>
                              <span>{new Date(item.createdAt).toLocaleString()}</span>
                           </div>
                        </div>
                     </div>
                  </div>
               ))}
            </div>
         </div>
         <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <Pagination
               currentPage={currentPage}
               totalItems={totalAnnouncements}
               pageSize={ANNOUNCEMENTS_PAGE_SIZE}
               onPageChange={setCurrentPage}
               itemLabel="announcements"
            />
         </div>
      </div>
   );
}
