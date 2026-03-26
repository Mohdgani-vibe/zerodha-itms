import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserCircle, Mail, Briefcase, MapPin, Laptop, ShieldAlert, ArrowLeft } from 'lucide-react';

export default function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/users/${id}`)
      .then(res => res.json())
      .then(data => {
        setUser(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading profile...</div>;
  if (!user || user.error) return <div className="p-8 text-center text-red-500">User not found</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center space-x-4 mb-8">
        <button onClick={() => navigate(-1)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-full transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 flex items-center justify-between">
          <div className="flex items-center space-x-5">
            <div className="h-16 w-16 bg-brand-100 rounded-full flex items-center justify-center text-2xl text-brand-700 font-bold">
              {user.fullName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{user.fullName}</h1>
              <p className="text-slate-500 font-medium">
                {user.employeeCode} • {user.role?.name} 
                <span className={`ml-3 px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {user.status}
                </span>
              </p>
            </div>
          </div>
          <div className="flex space-x-3">
            <button className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50">
              Edit Details
            </button>
            <button className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700">
              Assign Device
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Profile Info */}
        <div className="bg-white shadow-sm rounded-lg border border-slate-200 p-6 space-y-6 h-fit">
          <h3 className="text-lg font-medium text-slate-900 border-b border-slate-100 pb-2">Profile Information</h3>
          
          <div className="space-y-4">
            <div className="flex items-start">
              <Mail className="h-5 w-5 text-slate-400 mr-3 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-500">Email Contact</p>
                <p className="text-sm text-slate-900">{user.email}</p>
              </div>
            </div>
            <div className="flex items-start">
              <Briefcase className="h-5 w-5 text-slate-400 mr-3 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-500">Department</p>
                <p className="text-sm text-slate-900">{user.department?.name || 'Not assigned'}</p>
              </div>
            </div>
            <div className="flex items-start">
              <MapPin className="h-5 w-5 text-slate-400 mr-3 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-500">Branch Location</p>
                <p className="text-sm text-slate-900">{user.branch?.name || 'Not assigned'} {user.branch?.city ? `(${user.branch.city})` : ''}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Devices and Activity */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Assigned Devices */}
          <div className="bg-white shadow-sm rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h3 className="text-lg font-medium text-slate-900 flex items-center">
                <Laptop className="h-5 w-5 text-slate-400 mr-2" />
                Assigned Assets
              </h3>
              <span className="bg-slate-200 text-slate-700 py-0.5 px-2.5 rounded-full text-xs font-medium">
                {user.devices?.length || 0}
              </span>
            </div>
            <div className="divide-y divide-slate-200">
              {user.devices && user.devices.length > 0 ? (
                user.devices.map((device: any) => (
                  <div key={device.id} className="p-6 flex items-center justify-between hover:bg-slate-50 cursor-pointer">
                    <div>
                      <h4 className="text-sm font-semibold text-brand-600">{device.hostname}</h4>
                      <p className="text-xs text-slate-500 mt-1">{device.assetId} • {device.deviceType} • {device.osName}</p>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div className="text-xs font-medium bg-green-100 text-green-800 px-2 py-1 rounded-full">
                        {device.status}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-slate-500 text-sm">No devices currently assigned.</div>
              )}
            </div>
          </div>

          {/* Dummy Open alerts block */}
          <div className="bg-white shadow-sm rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-red-50 flex justify-between items-center">
              <h3 className="text-lg font-medium text-red-900 flex items-center">
                <ShieldAlert className="h-5 w-5 text-red-500 mr-2" />
                Actionable Alerts
              </h3>
            </div>
            <div className="p-6 text-sm text-slate-600">
              No active security or operational alerts for this employee's assets.
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
