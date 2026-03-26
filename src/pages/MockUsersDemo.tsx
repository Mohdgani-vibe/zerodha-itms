import { useState } from 'react';
import { 
  Building, Search, Filter, Clock, Terminal
} from 'lucide-react';

// --- MOCK DATA ---
const MOCK_DEPARTMENTS = [
  { name: 'All Users', count: 48 },
  { name: 'Support', count: 24 },
  { name: 'HR', count: 8 },
  { name: 'Accounts', count: 5 },
  { name: 'IT', count: 12 },
  { name: 'Sales', count: 9 },
  { name: 'Executive', count: 4 },
];

const MOCK_USERS = [
  { 
    id: 'u1', name: 'Muhammed Gani', employeeId: 'EMP-1024', department: 'Support', status: 'Active', 
    email: 'muhammed.gani@zerodha.com', branch: 'BLR-HQ',
    devices: [
      { id: 'd1', assetId: 'ASSET-2345', name: 'MacBook Pro 14', type: 'Laptop', status: 'Active', manufacturer: 'Apple', model: 'M3 Pro', os: 'macOS Sonoma', warranty: '3 Years', warrantyEnd: '12 Mar 2027', purchase: '12 Mar 2024', cpu: 'Apple M3 Pro', ram: '18GB', storage: '512GB SSD', ip: '192.168.1.45', mac: '00:1A:2B:3C:4D:5E', patchStatus: 'pending' },
      { id: 'd2', assetId: 'ASSET-2271', name: 'HP ProDesk 600', type: 'Desktop', status: 'Active', manufacturer: 'HP', model: 'ProDesk 600 G6', os: 'Windows 11 Pro', warranty: '3 Years', warrantyEnd: '15 Jan 2026', purchase: '15 Jan 2023', cpu: 'Intel Core i5-10500', ram: '16GB', storage: '512GB NVMe', ip: '192.168.1.99', mac: 'A1:B2:C3:D4:E5:F6', patchStatus: 'up_to_date' }
    ]
  },
  { 
    id: 'u2', name: 'Priya Sharma', employeeId: 'EMP-1089', department: 'HR', status: 'Active',
    email: 'priya.sharma@zerodha.com', branch: 'MUM-01',
    devices: [
      { id: 'd3', assetId: 'ASSET-3012', name: 'Dell Latitude 7420', type: 'Laptop', status: 'Active', manufacturer: 'Dell', model: 'Latitude 7420', os: 'Windows 11 Pro', warranty: '3 Years', warrantyEnd: '10 Nov 2025', purchase: '10 Nov 2022', cpu: 'Intel Core i7-1185G7', ram: '16GB', storage: '512GB NVMe', ip: '192.168.2.14', mac: '11:22:33:44:55:66', patchStatus: 'up_to_date' }
    ]
  },
  { 
    id: 'u3', name: 'Rahul Desai', employeeId: 'EMP-2001', department: 'IT', status: 'Active',
    email: 'rahul.desai@zerodha.com', branch: 'BLR-HQ',
    devices: [
      { id: 'd4', assetId: 'ASSET-1005', name: 'ThinkPad T14', type: 'Laptop', status: 'Active', manufacturer: 'Lenovo', model: 'ThinkPad T14 Gen 3', os: 'Ubuntu 22.04 LTS', warranty: '3 Years', warrantyEnd: '01 Apr 2026', purchase: '01 Apr 2023', cpu: 'AMD Ryzen 7 PRO 6850U', ram: '32GB', storage: '1TB NVMe', ip: '10.0.0.55', mac: 'AA:BB:CC:DD:EE:FF', patchStatus: 'failed' }
    ]
  }
];

const MOCK_ALERTS = [
  { id: 1, source: 'Wazuh', title: 'Suspicious process execution', severity: 'High', status: 'Open', firstSeen: '2 hours ago', lastSeen: '10 mins ago' },
  { id: 2, source: 'OpenSCAP', title: 'SSH Root Login Enabled', severity: 'Critical', status: 'Open', firstSeen: '1 day ago', lastSeen: '1 day ago' },
  { id: 3, source: 'ClamAV', title: 'EICAR Test File Detected', severity: 'Low', status: 'Closed', firstSeen: '5 days ago', lastSeen: '5 days ago' },
];

const MOCK_APPS = [
  { name: 'Google Chrome', version: '122.0.6261.111', publisher: 'Google LLC', date: '2024-01-15' },
  { name: 'Visual Studio Code', version: '1.87.0', publisher: 'Microsoft', date: '2024-01-20' },
  { name: 'Slack', version: '4.37.95', publisher: 'Slack Technologies', date: '2023-11-05' },
];

export default function MockUsersDemo() {
  // STATE
  const [role, setRole] = useState<'Super Admin' | 'IT Team' | 'Employee'>('Super Admin');
  const [selectedDept, setSelectedDept] = useState('All Users');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Navigation State
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [selectedDevice, setSelectedDevice] = useState<any>(null);
  const [deviceTab, setDeviceTab] = useState('Overview');

  // DERIVED STATE
  const filteredUsers = MOCK_USERS.filter(u => {
    const matchesDept = selectedDept === 'All Users' || u.department === selectedDept;
    const matchesSearch = u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          u.employeeId.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDept && matchesSearch;
  });

  // HANDLERS
  const handleUserClick = (user: any) => {
    setSelectedUser(user);
    setSelectedDevice(null);
  };

  const handleDeviceClick = (device: any) => {
    setSelectedDevice(device);
    setDeviceTab('Overview');
  };

  const handleBackToUsers = () => {
    setSelectedUser(null);
    setSelectedDevice(null);
  };

  const handleBackToUser = () => {
    setSelectedDevice(null);
  };

  // RENDER HELPERS
  const renderTopNav = () => (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14">
          <div className="flex items-center space-x-8">
            <div className="flex-shrink-0 flex items-center">
              <span className="text-xl font-bold tracking-tight text-slate-900">Zerodha ITMS</span>
            </div>
            <nav className="hidden md:flex space-x-6">
              {['Users', 'Patch', 'Stock', 'Gatepass', 'Alerts', 'Announcements', 'Chat', 'Settings'].map(item => (
                <a key={item} href="#" className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  item === 'Users' ? 'border-brand-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}>
                  {item}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-sm font-medium text-slate-500">Preview Role:</div>
            <select 
              value={role} 
              onChange={(e) => {
                  setRole(e.target.value as any);
                  if (e.target.value === 'Employee') {
                      handleUserClick(MOCK_USERS[0]); // Force to their own profile
                  } else {
                      handleBackToUsers();
                  }
              }}
              className="mt-1 block w-full pl-3 pr-10 py-1.5 text-base border-slate-300 focus:outline-none focus:ring-brand-500 focus:border-brand-500 sm:text-sm rounded-md shadow-sm border"
            >
              <option>Super Admin</option>
              <option>IT Team</option>
              <option>Employee</option>
            </select>
          </div>
        </div>
      </div>
    </header>
  );

  const renderSidebar = () => (
    <div className="w-64 bg-slate-50 border-r border-slate-200 min-h-[calc(100vh-3.5rem)] p-4 hidden md:block flex-shrink-0">
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-3">Departments</h2>
      <nav className="space-y-1">
        {MOCK_DEPARTMENTS.map(dept => (
          <button
            key={dept.name}
            onClick={() => { setSelectedDept(dept.name); handleBackToUsers(); }}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              selectedDept === dept.name ? 'bg-white text-brand-700 shadow-sm border border-slate-200' : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 border border-transparent'
            }`}
          >
            <div className="flex items-center">
              <Building className="mr-3 h-4 w-4 text-slate-400" />
              {dept.name}
            </div>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              selectedDept === dept.name ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600'
            }`}>
              {dept.count}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );

  const renderUsersTable = () => (
    <div className="flex-1 p-8 bg-white overflow-y-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Users</h1>
        {(role === 'Super Admin' || role === 'IT Team') && (
          <button className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 transition-colors">
            Add User
          </button>
        )}
      </div>

      <div className="mb-6 flex space-x-4">
        <div className="relative rounded-md shadow-sm max-w-md w-full">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-400" />
          </div>
          <input
            type="text"
            placeholder="Search employee name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="focus:ring-brand-500 focus:border-brand-500 block w-full pl-10 sm:text-sm border-slate-300 border rounded-md py-2"
          />
        </div>
        <button className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors">
          <Filter className="mr-2 h-4 w-4 text-slate-400" /> Filters
        </button>
      </div>

      <div className="bg-white shadow-sm ring-1 ring-slate-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Employee Name</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Employee ID</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Department</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Devices</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
              <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <button onClick={() => handleUserClick(user)} className="text-left group">
                    <div className="text-sm font-semibold text-brand-600 group-hover:text-brand-800 transition-colors">{user.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{user.devices.length} devices assigned</div>
                  </button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button onClick={() => handleUserClick(user)} className="text-sm text-slate-600 hover:text-slate-900 transition-colors font-mono">{user.employeeId}</button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                    {user.department}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 font-medium">
                  {user.devices.length}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20">
                    {user.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex justify-end space-x-3">
                    <button onClick={() => handleUserClick(user)} className="text-slate-400 hover:text-slate-900 font-semibold transition-colors">View</button>
                    {(role === 'Super Admin' || role === 'IT Team') && (
                      <>
                        <button className="text-slate-400 hover:text-brand-600 font-semibold transition-colors">Edit</button>
                        <button className="text-slate-400 hover:text-brand-600 font-semibold transition-colors">Assign Device</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-500">No employees found matching your criteria.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderUserDetail = () => (
    <div className="flex-1 p-8 bg-slate-50 overflow-y-auto">
      <button onClick={handleBackToUsers} className="mb-4 text-sm font-medium text-slate-500 hover:text-slate-900 inline-flex items-center transition-colors">
        ← Back to Users
      </button>

      <div className="bg-white shadow-sm ring-1 ring-slate-200 rounded-lg overflow-hidden mb-6">
        <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{selectedUser.name}</h2>
            <div className="mt-1 flex items-center text-sm text-slate-500 font-medium space-x-3">
              <span className="font-mono">{selectedUser.employeeId}</span>
              <span>•</span>
              <span>{selectedUser.department}</span>
              <span>•</span>
              <span>{selectedUser.devices.length} devices</span>
            </div>
          </div>
          <div className="flex space-x-3">
            <button className="inline-flex items-center px-3 py-1.5 border border-slate-300 shadow-sm text-sm font-medium rounded text-slate-700 bg-white hover:bg-slate-50">
              Raise Request
            </button>
            {(role === 'Super Admin' || role === 'IT Team') && (
              <button className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-sm font-medium rounded text-white bg-slate-900 hover:bg-slate-800">
                Edit Employee
              </button>
            )}
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <dt className="text-sm font-medium text-slate-500">Email Address</dt>
              <dd className="mt-1 text-sm text-slate-900">{selectedUser.email}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">Branch Location</dt>
              <dd className="mt-1 text-sm text-slate-900">{selectedUser.branch}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-500">Account Status</dt>
              <dd className="mt-1 text-sm text-slate-900">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">{selectedUser.status}</span>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <h3 className="text-lg font-bold text-slate-900 mb-4">Assigned Devices</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {selectedUser.devices.map((device: any) => (
          <div 
            key={device.id} 
            onClick={() => handleDeviceClick(device)}
            className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm hover:shadow-md cursor-pointer transition-all hover:border-brand-300 group"
          >
            <div className="flex justify-between items-start mb-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-700 group-hover:bg-brand-50 group-hover:text-brand-700 transition-colors font-mono">
                {device.assetId}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20">
                {device.status}
              </span>
            </div>
            <h4 className="text-base font-semibold text-slate-900 group-hover:text-brand-600 transition-colors">{device.name}</h4>
            <p className="text-sm text-slate-500 mt-1">{device.manufacturer} {device.type}</p>
          </div>
        ))}
        {selectedUser.devices.length === 0 && (
          <div className="col-span-2 text-center py-10 bg-white border border-dashed border-slate-300 rounded-lg text-slate-500">
            No devices currently assigned to this employee.
          </div>
        )}
      </div>
    </div>
  );

  const renderDeviceDetail = () => {
    const tabs = ['Overview', 'GLPI Details', 'Patch', 'Alerts', 'Requests', 'Terminal', 'Installed Apps', 'Warranty & Asset Info', 'Activity Timeline'];

    return (
      <div className="flex-1 flex flex-col h-full bg-slate-50">
        <div className="bg-white border-b border-slate-200 px-8 py-5 flex-shrink-0">
           <button onClick={handleBackToUser} className="mb-4 text-sm font-medium text-slate-500 hover:text-slate-900 inline-flex items-center transition-colors">
            ← Back to {selectedUser.name}
          </button>
          
          <div className="flex justify-between items-center">
             <div>
                <div className="flex items-center space-x-3 mb-1">
                   <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{selectedDevice.name}</h2>
                   <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300 font-mono">
                     {selectedDevice.assetId}
                   </span>
                </div>
                <div className="text-sm text-slate-500 font-medium">
                  {selectedDevice.type} • Assigned to {selectedUser.name} ({selectedUser.department})
                </div>
             </div>
             <div className="flex space-x-3">
                <button className="inline-flex items-center px-4 py-2 border border-slate-300 shadow-sm text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50">
                  Quick Actions
                </button>
             </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
           {/* Device Sidebar */}
           <div className="w-56 bg-white border-r border-slate-200 flex-shrink-0 overflow-y-auto py-4 px-2">
              {tabs.map(tab => (
                 <button
                   key={tab}
                   onClick={() => setDeviceTab(tab)}
                   className={`w-full text-left px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                     deviceTab === tab ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                   }`}
                 >
                   {tab}
                 </button>
              ))}
           </div>

           {/* Device Content */}
           <div className="flex-1 p-8 overflow-y-auto bg-slate-50">
              {deviceTab === 'Overview' && (
                 <div className="space-y-6">
                    <div className="bg-white shadow-sm ring-1 ring-slate-200 rounded-lg overflow-hidden">
                       <div className="px-6 py-4 border-b border-slate-200 bg-slate-50"><h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Asset Highlights</h3></div>
                       <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
                          <div>
                            <p className="text-sm font-medium text-slate-500">Manufacturer</p>
                            <p className="mt-1 text-base font-semibold text-slate-900">{selectedDevice.manufacturer}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-500">Model</p>
                            <p className="mt-1 text-base font-semibold text-slate-900">{selectedDevice.model}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-500">Operating System</p>
                            <p className="mt-1 text-base font-semibold text-slate-900">{selectedDevice.os}</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-500">Local IP</p>
                            <p className="mt-1 text-base font-semibold text-slate-900 font-mono">{selectedDevice.ip}</p>
                          </div>
                       </div>
                    </div>

                    <div className="bg-white shadow-sm ring-1 ring-slate-200 rounded-lg overflow-hidden">
                       <div className="px-6 py-4 border-b border-slate-200 bg-slate-50"><h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">Warranty Status</h3></div>
                       <div className="p-6 flex items-center justify-between">
                          <div>
                            <p className="text-xl font-bold text-slate-900">{selectedDevice.warranty}</p>
                            <p className="text-sm font-medium text-slate-500 mt-1">Purchased: {selectedDevice.purchase}</p>
                          </div>
                          <div className="text-right">
                             <p className="text-sm font-medium text-slate-500">Warranty Ends</p>
                             <p className="text-lg font-bold text-emerald-600 mt-1">{selectedDevice.warrantyEnd}</p>
                          </div>
                       </div>
                    </div>
                 </div>
              )}

              {deviceTab === 'GLPI Details' && (
                 <div className="bg-white shadow-sm ring-1 ring-slate-200 rounded-lg overflow-hidden">
                   <div className="p-6">
                      <h3 className="text-lg font-semibold text-slate-900 mb-6 border-b pb-2">Hardware Inventory Sync</h3>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div><dt className="text-sm font-medium text-slate-500">Serial Number</dt><dd className="mt-1 text-sm font-mono text-slate-900">SN908234JH89</dd></div>
                        <div><dt className="text-sm font-medium text-slate-500">CPU</dt><dd className="mt-1 text-sm text-slate-900">{selectedDevice.cpu}</dd></div>
                        <div><dt className="text-sm font-medium text-slate-500">RAM</dt><dd className="mt-1 text-sm text-slate-900">{selectedDevice.ram}</dd></div>
                        <div><dt className="text-sm font-medium text-slate-500">Storage</dt><dd className="mt-1 text-sm text-slate-900">{selectedDevice.storage}</dd></div>
                        <div><dt className="text-sm font-medium text-slate-500">MAC Address</dt><dd className="mt-1 text-sm font-mono text-slate-900">{selectedDevice.mac}</dd></div>
                      </dl>
                   </div>
                 </div>
              )}

              {deviceTab === 'Alerts' && (
                 <div className="bg-white shadow-sm ring-1 ring-slate-200 rounded-lg overflow-hidden">
                   <table className="min-w-full divide-y divide-slate-200">
                     <thead className="bg-slate-50">
                       <tr>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Source</th>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Title</th>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Severity</th>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">First Seen</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-200">
                       {MOCK_ALERTS.map(alert => (
                         <tr key={alert.id}>
                           <td className="px-6 py-4 text-sm font-medium text-slate-900">{alert.source}</td>
                           <td className="px-6 py-4 text-sm text-slate-500">{alert.title}</td>
                           <td className="px-6 py-4">
                             <span className={`inline-flex px-2 py-1 rounded text-xs font-bold ${
                               alert.severity === 'Critical' ? 'bg-red-100 text-red-800' : 
                               alert.severity === 'High' ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-800'
                             }`}>{alert.severity}</span>
                           </td>
                           <td className="px-6 py-4 text-sm text-slate-500">{alert.firstSeen}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
              )}

              {deviceTab === 'Installed Apps' && (
                 <div className="bg-white shadow-sm ring-1 ring-slate-200 rounded-lg overflow-hidden">
                   <table className="min-w-full divide-y divide-slate-200">
                     <thead className="bg-slate-50">
                       <tr>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">App Name</th>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Version</th>
                         <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Publisher</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-200">
                       {MOCK_APPS.map((app, idx) => (
                         <tr key={idx}>
                           <td className="px-6 py-4 text-sm font-medium text-slate-900">{app.name}</td>
                           <td className="px-6 py-4 text-sm font-mono text-slate-500">{app.version}</td>
                           <td className="px-6 py-4 text-sm text-slate-500">{app.publisher}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
              )}

              {deviceTab === 'Terminal' && (
                 <div className="bg-slate-900 shadow-sm ring-1 ring-slate-800 rounded-lg overflow-hidden flex flex-col h-[500px]">
                   <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex justify-between items-center text-slate-300 text-sm">
                      <div className="flex items-center"><Terminal className="w-4 h-4 mr-2"/> root@{selectedDevice.hostname || 'system'}</div>
                      <span className="text-xs px-2 py-0.5 bg-slate-700 rounded text-slate-400 font-mono">Connected via NetBird</span>
                   </div>
                   {role === 'Employee' ? (
                      <div className="flex-1 flex items-center justify-center p-6 text-slate-400 text-sm">
                         Your role ({role}) does not have permission to access the remote terminal.
                      </div>
                   ) : (
                     <>
                       <div className="flex-1 p-4 font-mono text-sm text-emerald-400 overflow-y-auto">
                         <div>$ salt-call --local network.ip_addrs</div>
                         <div className="text-slate-300 mt-1 mb-4">local:<br/> - {selectedDevice.ip}</div>
                         <div>$ _</div>
                       </div>
                       <div className="p-3 bg-slate-800 border-t border-slate-700">
                         <input type="text" className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand-500" placeholder="Type a command..." disabled={role === 'Employee'} />
                       </div>
                     </>
                   )}
                 </div>
              )}

              {/* Render placeholders for other tabs to prove they exist */}
              {['Patch', 'Requests', 'Warranty & Asset Info', 'Activity Timeline'].includes(deviceTab) && (
                 <div className="bg-white border-dashed border-2 border-slate-300 rounded-lg p-12 text-center">
                    <Clock className="mx-auto h-12 w-12 text-slate-300" />
                    <h3 className="mt-2 text-sm font-semibold text-slate-900">{deviceTab} Information</h3>
                    <p className="mt-1 text-sm text-slate-500">This section is prototyped but data is pending integration.</p>
                 </div>
              )}
           </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 font-sans text-slate-900">
      {renderTopNav()}
      <main className="flex-1 flex overflow-hidden">
         {selectedDevice ? renderDeviceDetail() : selectedUser ? renderUserDetail() : (
           <>
             {renderSidebar()}
             {renderUsersTable()}
           </>
         )}
      </main>
    </div>
  );
}
