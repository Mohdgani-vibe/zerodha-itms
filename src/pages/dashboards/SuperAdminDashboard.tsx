import { Users, ShieldAlert, Package, HardDrive } from 'lucide-react';

export default function SuperAdminDashboard() {
  const kpis = [
    { name: 'Total Employees', value: '1,429', icon: Users, color: 'text-brand-600', bg: 'bg-brand-100' },
    { name: 'Managed Devices', value: '1,503', icon: HardDrive, color: 'text-indigo-600', bg: 'bg-indigo-100' },
    { name: 'Critical Alerts', value: '12', icon: ShieldAlert, color: 'text-red-600', bg: 'bg-red-100' },
    { name: 'Low Stock Items', value: '8', icon: Package, color: 'text-amber-600', bg: 'bg-amber-100' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Super Admin Dashboard</h1>
        <div className="flex space-x-3">
          <span className="inline-flex rounded-md shadow-sm">
            <button type="button" className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500">
              Export Report
            </button>
          </span>
          <span className="inline-flex rounded-md shadow-sm">
            <button type="button" className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500">
              New Announcement
            </button>
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((item) => (
          <div key={item.name} className="bg-white overflow-hidden shadow-sm rounded-lg border border-slate-200">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className={`rounded-md p-3 ${item.bg}`}>
                    <item.icon className={`h-6 w-6 ${item.color}`} aria-hidden="true" />
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-slate-500 truncate">{item.name}</dt>
                    <dd className="flex items-baseline">
                      <div className="text-2xl font-semibold text-slate-900">{item.value}</div>
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-slate-50 px-5 py-3">
              <div className="text-sm text-brand-600 hover:text-brand-500 font-medium">View all</div>
            </div>
          </div>
        ))}
      </div>

      {/* Placeholder Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm min-h-[300px] flex flex-col">
          <h3 className="text-lg font-medium text-slate-900 mb-4 tracking-tight">Patch Compliance by Department</h3>
          <div className="flex-1 border-2 border-dashed border-slate-200 rounded-md flex items-center justify-center text-slate-400">
            [Chart Area]
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm min-h-[300px] flex flex-col">
          <h3 className="text-lg font-medium text-slate-900 mb-4 tracking-tight">Open Requests Overview</h3>
          <div className="flex-1 border-2 border-dashed border-slate-200 rounded-md flex items-center justify-center text-slate-400">
            [Chart Area]
          </div>
        </div>
      </div>
    </div>
  );
}
