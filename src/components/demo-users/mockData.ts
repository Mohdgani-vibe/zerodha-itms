export const MOCK_DEPARTMENTS = [
  { name: 'All Users', count: 48 },
  { name: 'Support', count: 24 },
  { name: 'HR', count: 8 },
  { name: 'Accounts', count: 5 },
  { name: 'IT', count: 12 },
  { name: 'Sales', count: 9 },
  { name: 'Executive', count: 4 },
];

export const MOCK_USERS = [
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

export const MOCK_ALERTS = [
  { id: 1, source: 'Wazuh', title: 'Suspicious process execution', severity: 'High', status: 'Open', firstSeen: '2 hours ago', lastSeen: '10 mins ago' },
  { id: 2, source: 'OpenSCAP', title: 'SSH Root Login Enabled', severity: 'Critical', status: 'Open', firstSeen: '1 day ago', lastSeen: '1 day ago' },
  { id: 3, source: 'ClamAV', title: 'EICAR Test File Detected', severity: 'Low', status: 'Closed', firstSeen: '5 days ago', lastSeen: '5 days ago' },
];

export const MOCK_APPS = [
  { name: 'Google Chrome', version: '122.0.6261.111', publisher: 'Google LLC', date: '2024-01-15' },
  { name: 'Visual Studio Code', version: '1.87.0', publisher: 'Microsoft', date: '2024-01-20' },
  { name: 'Slack', version: '4.37.95', publisher: 'Slack Technologies', date: '2023-11-05' },
];

export type Role = 'Super Admin' | 'IT Team' | 'Employee';
