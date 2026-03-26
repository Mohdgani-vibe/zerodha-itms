
import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';
import Sidebar from './Sidebar';

export default function PortalLayout() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navigation */}
      <TopNav />
      
      {/* Main Layout Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sub-Navigation */}
        <Sidebar />
        
        {/* Page Content */}
        <main className="flex-1 overflow-y-auto w-full">
          <div className="p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
