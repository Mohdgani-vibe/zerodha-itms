import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, Building2, IdCard, Laptop, Mail, MapPin, Save, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import ConfirmDialog from '../../components/ConfirmDialog';
import { getPreferredPortalPath, getShortName, getStoredSession, normalizeAuthUser, setStoredSession } from '../../lib/session';
import { isProbeLikeUser } from '../../lib/userVisibility';

interface UserRecord {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string;
  status: string;
  role?: { name: string } | null;
  department?: { name: string } | null;
  branch?: { name: string } | null;
  assets?: Array<{ id: string; label: string; assetId: string; deviceType?: string | null; status: string; osName?: string | null; kind: 'device' | 'stock' }>;
}

interface ApiUserRecord {
  id: string;
  full_name: string;
  email: string;
  emp_id: string;
  status: string;
  role: string;
  dept_id?: string | null;
  location_id?: string | null;
}

interface UserAssetsResponse {
  devices: Array<{ id: string; hostname?: string | null; assetTag?: string; asset_tag?: string; category?: string | null; status: string }>;
  items: Array<{ id: string; itemCode: string; name: string; serialNumber?: string | null; specs?: string | null; status: string }>;
}

interface UserOptionsResponse {
  roles: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
}

interface PendingAssetAction {
  assetId: string;
  kind: 'unassign' | 'delete';
}

export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const session = getStoredSession();
  const portalMatch = location.pathname.match(/^\/(admin|it|emp)(?:\/|$)/);
  const basePath = portalMatch ? `/${portalMatch[1]}` : '/emp';
  const isSelfProfileRoute = location.pathname === '/emp/profile';
  const targetUserId = id || (isSelfProfileRoute ? session?.user.id : undefined);
  const [user, setUser] = useState<UserRecord | null>(null);
  const [options, setOptions] = useState<UserOptionsResponse>({ roles: [], departments: [], branches: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assetActionLoadingId, setAssetActionLoadingId] = useState('');
  const [pendingAssetAction, setPendingAssetAction] = useState<PendingAssetAction | null>(null);
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [formState, setFormState] = useState({
    fullName: '',
    email: '',
    employeeCode: '',
    status: 'active',
    roleName: '',
    departmentId: '',
    branchId: '',
  });

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      if (!targetUserId) {
        return;
      }

      try {
        setLoading(true);
        setError('');

        const [userData, optionsData, assetsData] = await Promise.all([
          apiRequest<ApiUserRecord>(isSelfProfileRoute ? '/api/me/profile' : `/api/users/${targetUserId}`),
          apiRequest<UserOptionsResponse>('/api/users/meta/options'),
          apiRequest<UserAssetsResponse>(isSelfProfileRoute ? '/api/me/assets' : `/api/users/${targetUserId}/assets`),
        ]);

        if (cancelled) {
          return;
        }

        setUser({
          id: userData.id,
          fullName: userData.full_name,
          email: userData.email,
          employeeCode: userData.emp_id,
          status: userData.status,
          role: userData.role ? { name: userData.role } : null,
          department: optionsData.departments.find((item) => item.id === userData.dept_id) || null,
          branch: optionsData.branches.find((item) => item.id === userData.location_id) || null,
          assets: [
            ...assetsData.devices.map((device) => ({
              id: device.id,
              label: device.hostname || device.assetTag || device.asset_tag || 'Unnamed device',
              assetId: device.assetTag || device.asset_tag || device.id,
              deviceType: device.category || null,
              status: device.status,
              osName: null,
              kind: 'device' as const,
            })),
            ...assetsData.items.map((item) => ({
              id: item.id,
              label: item.name,
              assetId: item.itemCode,
              deviceType: 'Stock Item',
              status: item.status,
              osName: item.specs || null,
              kind: 'stock' as const,
            })),
          ],
        });
        setOptions(optionsData);
        setFormState({
          fullName: userData.full_name,
          email: userData.email,
          employeeCode: userData.emp_id,
          status: userData.status,
          roleName: userData.role || '',
          departmentId: userData.dept_id || '',
          branchId: userData.location_id || '',
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load user profile');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [isSelfProfileRoute, targetUserId]);

  const roleOptions = useMemo(() => Array.from(new Set([formState.roleName, ...options.roles.map((role) => role.name)].filter(Boolean))), [formState.roleName, options.roles]);
  const canSelfEditProfile = Boolean(session?.user.id && user?.id === session.user.id);
  const canEditProfile = session?.user.role === 'super_admin' || canSelfEditProfile;
  const canEditPrivilegedFields = session?.user.role === 'super_admin';
  const canManageAssets = session?.user.role === 'super_admin' || session?.user.role === 'it_team';

  const handleSave = async () => {
    if (!targetUserId || !canEditProfile) {
      if (!canEditProfile) {
        setError('You do not have permission to edit this profile.');
      }
      return;
    }

    try {
      setSaving(true);
      setError('');
      if (canEditPrivilegedFields) {
        await apiRequest<{ ok: boolean }>(`/api/users/${targetUserId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            full_name: formState.fullName,
            email: formState.email,
            emp_id: formState.employeeCode,
            role: formState.roleName,
            dept_id: formState.departmentId,
            location_id: formState.branchId,
            is_active: formState.status === 'active',
          }),
        });
      } else {
        const response = await apiRequest<{ id: string; email: string; role: string; full_name?: string; dept_id?: string | null; location_id?: string | null; default_portal?: string; portals?: string[] }>('/api/me/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            full_name: formState.fullName,
            dept_id: formState.departmentId,
            location_id: formState.branchId,
          }),
        });

        if (session) {
          const refreshedUser = normalizeAuthUser(response);
          setStoredSession({
            token: session.token,
            user: refreshedUser,
            shortName: getShortName(refreshedUser.fullName, refreshedUser.role),
          });
          navigate(getPreferredPortalPath(refreshedUser), { replace: true });
          return;
        }
      }

      setIsEditing(false);
      navigate(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save user profile');
    } finally {
      setSaving(false);
    }
  };

  const handleAssetAction = async (assetId: string, kind: 'unassign' | 'delete') => {
    if (!targetUserId || !canManageAssets) {
      return;
    }

    try {
      setAssetActionLoadingId(assetId);
      setError('');
      await apiRequest(kind === 'delete' ? `/api/assets/${assetId}` : `/api/assets/${assetId}/unassign`, {
        method: kind === 'delete' ? 'DELETE' : 'POST',
      });
      setPendingAssetAction(null);
      navigate(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Failed to ${kind} asset`);
    } finally {
      setAssetActionLoadingId('');
    }
  };

  if (loading) {
    return <div className="py-20 text-center text-sm text-zinc-500">Loading user profile...</div>;
  }

  if (!user) {
    return <div className="py-20 text-center text-sm text-rose-600">User not found.</div>;
  }

  const assetCount = user.assets?.length ?? 0;
  const isProbeUser = isProbeLikeUser(user);
  const roleLabel = (user.role?.name || 'Employee').replaceAll('_', ' ');
  const statusClassName = user.status === 'active' ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : 'bg-zinc-200 text-zinc-700 ring-zinc-300';
  const summaryCards = [
    { label: 'Employee ID', value: user.employeeCode, icon: IdCard },
    { label: 'Department', value: user.department?.name || 'Unassigned', icon: Building2 },
    { label: 'Role', value: roleLabel, icon: ShieldCheck },
    { label: 'Assets', value: `${assetCount}`, icon: Laptop },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-4 xl:px-2">
      <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-[0_18px_60px_-28px_rgba(15,23,42,0.35)]">
        <div className="relative overflow-hidden border-b border-zinc-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_34%),linear-gradient(135deg,_#f8fafc_0%,_#fff7ed_52%,_#ffffff_100%)] px-6 py-6 sm:px-8">
          <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-amber-200/30 blur-3xl" />
          <div className="absolute left-24 top-0 h-36 w-36 rounded-full bg-sky-200/40 blur-3xl" />

          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <button type="button" onClick={() => navigate(-1)} className="mt-1 rounded-2xl border border-white/80 bg-white/90 p-3 text-zinc-500 shadow-sm transition hover:text-zinc-900">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">User Profile</div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">{user.fullName}</h1>
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusClassName}`}>{user.status}</span>
                  </div>
                  <p className="text-sm text-zinc-600 sm:text-base">{user.employeeCode} • {roleLabel}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-2 ring-1 ring-zinc-200/80">
                    <Mail className="h-4 w-4 text-zinc-400" />
                    {user.email}
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-2 ring-1 ring-zinc-200/80">
                    <Building2 className="h-4 w-4 text-zinc-400" />
                    {user.department?.name || 'Unassigned department'}
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-2 ring-1 ring-zinc-200/80">
                    <MapPin className="h-4 w-4 text-zinc-400" />
                    {user.branch?.name || 'Unassigned branch'}
                  </div>
                </div>
              </div>
            </div>

            <div className="relative flex flex-wrap items-center gap-3 xl:justify-end">
              <button type="button" onClick={() => canEditProfile && setIsEditing((currentValue) => !currentValue)} disabled={!canEditProfile} className="rounded-2xl border border-zinc-200 bg-white/90 px-4 py-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60">
                {isEditing ? 'Cancel' : 'Edit Profile'}
              </button>
              {isEditing ? (
                <button type="button" onClick={handleSave} disabled={saving} className="rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-60">
                  <Save className="mr-2 inline-block h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-t border-white/40 bg-zinc-50/70 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4 sm:px-8">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">{card.label}</div>
                <card.icon className="h-4 w-4 text-zinc-400" />
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 sm:text-base">{card.value}</div>
            </div>
          ))}
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}
      {isProbeUser ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">This is a synthetic probe or smoke-test profile. It is kept only for history and should not be treated as a real employee account.</div> : null}
      {!canEditProfile ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">This profile cannot be edited from your current session.</div> : null}

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-[24px] border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-zinc-100 p-3 text-zinc-700">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-950">Identity</h2>
              <p className="text-sm text-zinc-500">Core profile and access details.</p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <div className="rounded-2xl bg-zinc-50 p-4">
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-5 w-5 text-zinc-400" />
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Email</div>
                  {isEditing ? (
                    <input value={formState.email} onChange={(event) => setFormState((currentValue) => ({ ...currentValue, email: event.target.value }))} disabled={!canEditPrivilegedFields} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 disabled:bg-zinc-100" />
                  ) : (
                    <div className="mt-2 text-sm font-semibold text-zinc-900 break-all">{user.email}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 p-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Employee ID</div>
                {isEditing ? (
                  <input value={formState.employeeCode} onChange={(event) => setFormState((currentValue) => ({ ...currentValue, employeeCode: event.target.value }))} disabled={!canEditPrivilegedFields} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 disabled:bg-zinc-100" />
                ) : (
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{user.employeeCode}</div>
                )}
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-zinc-200 p-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Full Name</div>
                {isEditing ? (
                  <input value={formState.fullName} onChange={(event) => setFormState((currentValue) => ({ ...currentValue, fullName: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900" />
                ) : (
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{user.fullName}</div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Role</div>
                {isEditing ? (
                  <select value={formState.roleName} onChange={(event) => setFormState((currentValue) => ({ ...currentValue, roleName: event.target.value }))} disabled={!canEditPrivilegedFields} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 disabled:bg-zinc-100">
                    {roleOptions.map((roleName) => <option key={roleName} value={roleName}>{roleName}</option>)}
                  </select>
                ) : (
                  <div className="mt-2 text-sm font-semibold text-zinc-900">{roleLabel}</div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Status</div>
                {isEditing ? (
                  <select value={formState.status} onChange={(event) => setFormState((currentValue) => ({ ...currentValue, status: event.target.value }))} disabled={!canEditPrivilegedFields} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 disabled:bg-zinc-100">
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                ) : (
                  <div className="mt-2">
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusClassName}`}>{user.status}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 p-4">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 text-zinc-400" />
                <div className="w-full space-y-4">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Department</div>
                    {isEditing ? (
                      <select value={formState.departmentId} onChange={(event) => setFormState((currentValue) => ({ ...currentValue, departmentId: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900">
                        <option value="">Unassigned</option>
                        {options.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                      </select>
                    ) : (
                      <div className="mt-2 text-sm font-semibold text-zinc-900">{user.department?.name || 'Unassigned'}</div>
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Branch</div>
                    {isEditing ? (
                      <select value={formState.branchId} onChange={(event) => setFormState((currentValue) => ({ ...currentValue, branchId: event.target.value }))} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900">
                        <option value="">Unassigned</option>
                        {options.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                      </select>
                    ) : (
                      <div className="mt-2 text-sm font-semibold text-zinc-900">{user.branch?.name || 'Unassigned'}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[24px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50/80 px-6 py-5">
            <div>
              <h2 className="flex items-center text-lg font-bold text-zinc-950">
                <Laptop className="mr-2 h-5 w-5 text-zinc-500" />
                Assigned Assets
              </h2>
              <p className="mt-1 text-sm text-zinc-500">Live devices and accessories currently linked to this user.</p>
            </div>
            <div className="rounded-2xl bg-white px-4 py-2 text-right shadow-sm ring-1 ring-zinc-200">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Count</div>
              <div className="mt-1 text-lg font-bold text-zinc-950">{assetCount}</div>
            </div>
          </div>

          <div className="divide-y divide-zinc-100">
            {assetCount ? user.assets?.map((asset) => (
              <div key={asset.id} className="px-6 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => asset.kind === 'device' ? navigate(`${basePath}/devices/${asset.id}`) : undefined}
                      className={`text-left ${asset.kind === 'device' ? 'group' : 'cursor-default'}`}
                    >
                      <div className={`text-base font-bold ${asset.kind === 'device' ? 'text-brand-700 group-hover:text-brand-800' : 'text-zinc-900'}`}>{asset.label}</div>
                      <div className="mt-1 text-sm text-zinc-500">{asset.assetId} • {asset.deviceType || 'Asset'} • {asset.osName || (asset.kind === 'device' ? 'Unknown OS' : 'No extra details')}</div>
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {canManageAssets ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setPendingAssetAction({ assetId: asset.id, kind: 'unassign' })}
                          disabled={assetActionLoadingId === asset.id}
                          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
                        >
                          {assetActionLoadingId === asset.id ? 'Updating...' : 'Remove From User'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingAssetAction({ assetId: asset.id, kind: 'delete' })}
                          disabled={assetActionLoadingId === asset.id}
                          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                        >
                          {assetActionLoadingId === asset.id ? 'Updating...' : 'Delete Asset'}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            )) : (
              <div className="px-6 py-16">
                <div className="mx-auto max-w-md rounded-[24px] border border-dashed border-zinc-300 bg-zinc-50/70 px-8 py-10 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200">
                    <Laptop className="h-6 w-6 text-zinc-400" />
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-zinc-900">No Assigned Assets</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">{user.status === 'active' ? 'This active profile does not have any live devices or accessories linked right now.' : 'This inactive profile does not have any live devices or accessories linked right now.'}</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingAssetAction)}
        title={pendingAssetAction?.kind === 'delete' ? 'Delete Asset' : 'Remove Asset From User'}
        message={pendingAssetAction?.kind === 'delete' ? 'This will permanently delete the asset from ITMS and cannot be undone.' : 'This will remove the asset assignment from the current user but keep the asset in ITMS.'}
        confirmLabel={pendingAssetAction?.kind === 'delete' ? 'Delete Asset' : 'Remove From User'}
        tone={pendingAssetAction?.kind === 'delete' ? 'danger' : 'default'}
        busy={Boolean(pendingAssetAction && assetActionLoadingId === pendingAssetAction.assetId)}
        onClose={() => setPendingAssetAction(null)}
        onConfirm={() => {
          if (pendingAssetAction) {
            void handleAssetAction(pendingAssetAction.assetId, pendingAssetAction.kind);
          }
        }}
      />
    </div>
  );
}