
import { Laptop, LifeBuoy, Megaphone, Ticket, MessageSquare } from 'lucide-react';

export default function EmployeeDashboard() {
  const kpis = [
    { name: 'My Devices', value: '2', icon: Laptop, color: 'text-indigo-600', bg: 'bg-indigo-100' },
    { name: 'My Open Requests', value: '1', icon: LifeBuoy, color: 'text-amber-600', bg: 'bg-amber-100' },
    { name: 'My Gatepasses', value: '0', icon: Ticket, color: 'text-slate-600', bg: 'bg-slate-100' },
    { name: 'Announcements', value: '3', icon: Megaphone, color: 'text-brand-600', bg: 'bg-brand-100' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Employee IT Self-Service</h1>
        <div className="flex space-x-3">
          <span className="inline-flex rounded-md shadow-sm">
            <button type="button" className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500">
              <MessageSquare className="mr-2 h-4 w-4" />
              Chat with IT
            </button>
          </span>
          <span className="inline-flex rounded-md shadow-sm">
            <button type="button" className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500">
              Raise a Request
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
              <div className="text-sm text-brand-600 hover:text-brand-500 font-medium">View</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm mt-6">
        <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-slate-900 tracking-tight">My Assigned Devices</h3>
          <button className="text-sm text-brand-600 font-medium hover:text-brand-700">View All</button>
        </div>
        <div className="divide-y divide-slate-200">
          {[1, 2].map((i) => (
            <div key={i} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer">
              <div className="flex items-center">
                <div className="p-2 bg-slate-100 rounded-md text-slate-500 mr-4">
                  <Laptop className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-slate-900">MacBook Pro 14"</h4>
                  <p className="text-sm text-slate-500">Asset ID: Z-LAP-00{i} • Healthy</p>
                </div>
              </div>
              <div>
                <button className="text-slate-400 hover:text-slate-600">
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
