import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { HardDrive, Activity, Terminal, ShieldAlert, Cpu, Network, Package, ArrowLeft } from 'lucide-react';

export default function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    fetch(`/api/devices/${id}`)
      .then(res => res.json())
      .then(data => {
        setDevice(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading device details...</div>;
  if (!device || device.error) return <div className="p-8 text-center text-red-500">Device not found</div>;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center space-x-4 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-full transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 flex items-center justify-between w-full">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{device.hostname}</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${device.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}`}>
                {device.status}
              </span>
            </div>
            <p className="text-slate-500 text-sm mt-1">
              {device.assetId} • {device.deviceType} • {device.osName} {device.osVersion}
            </p>
          </div>
          <div className="flex space-x-3">
            <button className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
              Settings
            </button>
            <button className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-slate-900 hover:bg-slate-800">
              <Terminal className="w-4 h-4 mr-2" />
              Remote Terminal
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {['overview', 'inventory', 'software', 'security'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`
                whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm capitalize transition-colors
                ${activeTab === tab 
                  ? 'border-brand-500 text-brand-600' 
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}
              `}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            <div className="bg-white shadow-sm rounded-lg border border-slate-200 p-6 space-y-4">
               <h3 className="text-lg font-medium text-slate-900 border-b border-slate-100 pb-2 flex items-center">
                 <Activity className="h-5 w-5 mr-2 text-slate-400" /> Current Health
               </h3>
               <div className="flex justify-between items-center py-2">
                 <span className="text-sm text-slate-500">Patch Compliance</span>
                 <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${device.patchStatus === 'up_to_date' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                   {device.patchStatus.replace('_', ' ')}
                 </span>
               </div>
               <div className="flex justify-between items-center py-2">
                 <span className="text-sm text-slate-500">Security Alerts</span>
                 <span className="text-sm font-medium px-2.5 py-0.5 bg-slate-100 text-slate-800 rounded-full">Secure</span>
               </div>
            </div>

            <div className="lg:col-span-2 bg-white shadow-sm rounded-lg border border-slate-200 p-6">
               <h3 className="text-lg font-medium text-slate-900 border-b border-slate-100 pb-2 mb-4">Assignment Info</h3>
               <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                 <div>
                   <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Employee</label>
                   <p className="mt-1 text-sm text-slate-900 font-medium">{device.user ? device.user.fullName : 'Unassigned'}</p>
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Department</label>
                   <p className="mt-1 text-sm text-slate-900">{device.department?.name || '-'}</p>
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Branch</label>
                   <p className="mt-1 text-sm text-slate-900">{device.branch?.name || '-'}</p>
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Last Sync</label>
                   <p className="mt-1 text-sm text-slate-900">{device.updatedAt ? new Date(device.updatedAt).toLocaleString() : 'Never'}</p>
                 </div>
               </div>
            </div>

          </div>
        )}

        {activeTab === 'inventory' && (
          <div className="bg-white shadow-sm rounded-lg border border-slate-200">
             <div className="px-6 py-5 border-b border-slate-200">
               <h3 className="text-lg font-medium text-slate-900 flex items-center">
                 <Cpu className="h-5 w-5 mr-3 text-slate-400" />
                 Hardware Metadata
               </h3>
             </div>
             <div className="p-6 text-sm text-slate-500 text-center py-12">
               Full hardware inventory (CPU, RAM, Disks) will be synced via GLPI Agent.
             </div>
          </div>
        )}

        {activeTab === 'software' && (
          <div className="bg-white shadow-sm rounded-lg border border-slate-200">
             <div className="px-6 py-5 border-b border-slate-200">
               <h3 className="text-lg font-medium text-slate-900 flex items-center">
                 <Package className="h-5 w-5 mr-3 text-slate-400" />
                 Installed Software
               </h3>
             </div>
             <div className="divide-y divide-slate-200">
               {device.installedApps && device.installedApps.length > 0 ? (
                 device.installedApps.map((app: any) => (
                   <div key={app.id} className="p-4 flex justify-between items-center text-sm">
                     <span className="font-medium text-slate-900">{app.name}</span>
                     <span className="text-slate-500">{app.version}</span>
                   </div>
                 ))
               ) : (
                 <div className="p-6 text-sm text-slate-500 text-center py-12">
                   No installed apps datastore synced yet.
                 </div>
               )}
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
