import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Monitor, Server, Clock, Search, Filter } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function PatchDashboard() {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname;

  useEffect(() => {
    fetch('/api/patch/dashboard')
      .then(res => res.json())
      .then(data => {
        setMetrics(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center">
          <ShieldCheck className="mr-3 h-7 w-7 text-brand-600" />
          Patch Center
        </h1>
        <div className="flex space-x-3">
          <button className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
            Export Report
          </button>
          <button className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700">
            Schedule Patch Job
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500">Loading compliance data...</div>
      ) : metrics && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-center">
              <span className="text-sm font-medium text-slate-500 mb-1">Managed Devices</span>
              <span className="text-3xl font-bold text-slate-900">{metrics.total}</span>
            </div>
            <div className="bg-green-50 p-6 rounded-lg border border-green-200 shadow-sm flex flex-col justify-center">
              <span className="text-sm font-medium text-green-700 mb-1">Up to Date</span>
              <span className="text-3xl font-bold text-green-800">{metrics.upToDate}</span>
            </div>
            <div className="bg-amber-50 p-6 rounded-lg border border-amber-200 shadow-sm flex flex-col justify-center">
              <span className="text-sm font-medium text-amber-700 mb-1">Pending Updates</span>
              <span className="text-3xl font-bold text-amber-800">{metrics.pending}</span>
            </div>
            <div className="bg-red-50 p-6 rounded-lg border border-red-200 shadow-sm flex flex-col justify-center">
              <span className="text-sm font-medium text-red-700 mb-1">Failed Jobs</span>
              <span className="text-3xl font-bold text-red-800">{metrics.failed}</span>
            </div>
            <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 shadow-sm flex flex-col justify-center">
              <span className="text-sm font-medium text-blue-700 mb-1">Reboot Pending</span>
              <span className="text-3xl font-bold text-blue-800">{metrics.rebootPending}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
             <div className="bg-white shadow-sm rounded-lg border border-slate-200">
                <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="text-lg font-medium text-slate-900">Compliance by Department</h3>
                </div>
                <div className="p-6">
                   <div className="space-y-4">
                     {/* Mocked visualization of departments */}
                     <div>
                       <div className="flex justify-between text-sm font-medium mb-1">
                         <span className="text-slate-700">Engineering</span>
                         <span className="text-slate-900">92%</span>
                       </div>
                       <div className="w-full bg-slate-200 rounded-full h-2">
                         <div className="bg-brand-500 h-2 rounded-full" style={{ width: '92%' }}></div>
                       </div>
                     </div>
                     <div>
                       <div className="flex justify-between text-sm font-medium mb-1">
                         <span className="text-slate-700">Support</span>
                         <span className="text-slate-900">100%</span>
                       </div>
                       <div className="w-full bg-slate-200 rounded-full h-2">
                         <div className="bg-green-500 h-2 rounded-full" style={{ width: '100%' }}></div>
                       </div>
                     </div>
                     <div>
                       <div className="flex justify-between text-sm font-medium mb-1">
                         <span className="text-slate-700">Sales</span>
                         <span className="text-slate-900">74%</span>
                       </div>
                       <div className="w-full bg-slate-200 rounded-full h-2">
                         <div className="bg-amber-500 h-2 rounded-full" style={{ width: '74%' }}></div>
                       </div>
                     </div>
                   </div>
                </div>
             </div>

             <div className="bg-white shadow-sm rounded-lg border border-slate-200">
                <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="text-lg font-medium text-slate-900">Recent Patch Events</h3>
                </div>
                <div className="p-6">
                   <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
                      Audit logs for recent Salt executions will appear here.
                   </div>
                   <div className="mt-4 text-center">
                     <button 
                       onClick={() => navigate(`${basePath}/devices`)}
                       className="text-brand-600 font-medium text-sm hover:text-brand-800"
                     >
                       View All Devices →
                     </button>
                   </div>
                </div>
             </div>
          </div>
        </>
      )}
    </div>
  );
}
