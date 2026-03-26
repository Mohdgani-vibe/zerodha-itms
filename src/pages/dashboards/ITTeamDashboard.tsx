
import { ShieldAlert, LifeBuoy, WifiOff, Ticket } from 'lucide-react';

export default function ITTeamDashboard() {
  const kpis = [
    { name: 'My Assigned Alerts', value: '4', icon: ShieldAlert, color: 'text-red-600', bg: 'bg-red-100' },
    { name: 'Pending Support Requests', value: '18', icon: LifeBuoy, color: 'text-amber-600', bg: 'bg-amber-100' },
    { name: 'Offline Devices', value: '3', icon: WifiOff, color: 'text-slate-600', bg: 'bg-slate-100' },
    { name: 'Pending Gatepasses', value: '5', icon: Ticket, color: 'text-brand-600', bg: 'bg-brand-100' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">IT Team Dashboard</h1>
        <div className="flex space-x-3">
          <span className="inline-flex rounded-md shadow-sm">
            <button type="button" className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500">
              Work Next Ticket
            </button>
          </span>
        </div>
      </div>

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
              <div className="text-sm text-brand-600 hover:text-brand-500 font-medium">View detailed list</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm mt-6">
        <div className="px-6 py-5 border-b border-slate-200">
          <h3 className="text-lg font-medium text-slate-900 tracking-tight">Recent Unassigned Requests</h3>
        </div>
        <div className="p-6 text-center text-slate-500 py-12">
          No pending requests at the moment.
        </div>
      </div>
    </div>
  );
}
