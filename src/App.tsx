import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import PortalLayout from './components/layout/PortalLayout';
import SuperAdminDashboard from './pages/dashboards/SuperAdminDashboard';
import ITTeamDashboard from './pages/dashboards/ITTeamDashboard';
import EmployeeDashboard from './pages/dashboards/EmployeeDashboard';
import Users from './pages/Users';
import UserProfile from './pages/UserProfile';
import Devices from './pages/Devices';
import DeviceDetail from './pages/DeviceDetail';
import PatchDashboard from './pages/PatchDashboard';
import PatchList from './pages/PatchList';
import MockUsersDemo from './pages/MockUsersDemo';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/portal" element={<PortalLayout />}>
          <Route path="superadmin">
             <Route index element={<SuperAdminDashboard />} />
             <Route path="users" element={<Users />} />
             <Route path="users/:id" element={<UserProfile />} />
             <Route path="patch" element={<PatchDashboard />} />
             <Route path="patch/devices" element={<PatchList />} />
             <Route path="stock" element={<Devices />} />
             <Route path="devices/:id" element={<DeviceDetail />} />
          </Route>
          
          <Route path="itteam">
             <Route index element={<ITTeamDashboard />} />
             <Route path="users" element={<Users />} />
             <Route path="users/:id" element={<UserProfile />} />
             <Route path="patch" element={<PatchDashboard />} />
             <Route path="patch/devices" element={<PatchList />} />
             <Route path="stock" element={<Devices />} />
             <Route path="devices/:id" element={<DeviceDetail />} />
          </Route>
          
          <Route path="employee">
             <Route index element={<EmployeeDashboard />} />
             <Route path="users/:id" element={<UserProfile />} />
             <Route path="patch" element={<PatchDashboard />} />
             <Route path="patch/devices" element={<PatchList />} />
             <Route path="stock" element={<Devices />} />
             <Route path="devices/:id" element={<DeviceDetail />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Route>

        <Route path="/demo" element={<MockUsersDemo />} />

        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
