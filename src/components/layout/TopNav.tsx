
import { NavLink, useLocation } from 'react-router-dom';
import { 
  Users, 
  ShieldCheck, 
  Package, 
  Ticket, 
  Bell, 
  Megaphone, 
  MessageSquare, 
  Settings,
  MonitorSmartphone,
  Search,
  UserCircle
} from 'lucide-react';

const navItems = [
  { name: 'Users', icon: Users, path: '/users' },
  { name: 'Patch', icon: ShieldCheck, path: '/patch' },
  { name: 'Stock', icon: Package, path: '/stock' },
  { name: 'Gatepass', icon: Ticket, path: '/gatepass' },
  { name: 'Alerts', icon: Bell, path: '/alerts' },
  { name: 'Announcements', icon: Megaphone, path: '/announcements' },
  { name: 'Chat', icon: MessageSquare, path: '/chat' },
  { name: 'Settings', icon: Settings, path: '/settings' },
];

export default function TopNav() {
  const location = useLocation();
  const portalMatch = location.pathname.match(/^\/portal\/(superadmin|itteam|employee)/);
  const basePath = portalMatch ? portalMatch[0] : '';

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* Left Section: Logo & Main Nav */}
        <div className="flex items-center flex-1">
          {/* Logo */}
          <div className="flex items-center gap-2 mr-8">
            <div className="bg-brand-600 p-1.5 rounded-lg">
              <MonitorSmartphone className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-lg text-slate-900 tracking-tight hidden md:block">
              ITMS
            </span>
          </div>

          {/* Top Navigation */}
          <nav className="hidden lg:flex space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.name}
                  to={`${basePath}${item.path}`}
                  className={({ isActive }) =>
                    `flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  }
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {item.name}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Right Section: Actions */}
        <div className="flex items-center gap-4">
          <div className="relative hidden sm:block">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-1.5 border border-slate-300 rounded-md leading-5 bg-slate-50 placeholder-slate-500 focus:outline-none focus:placeholder-slate-400 focus:ring-1 focus:ring-brand-500 focus:border-brand-500 sm:text-sm transition-colors"
              placeholder="Search assets or users..."
            />
          </div>
          
          <button className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-full transition-colors relative">
            <Bell className="h-5 w-5" />
            <span className="absolute top-1 right-1.5 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
          </button>
          
          <div className="flex items-center gap-2 pl-4 border-l border-slate-200">
            <UserCircle className="h-8 w-8 text-slate-400" />
          </div>
        </div>

      </div>
    </header>
  );
}
