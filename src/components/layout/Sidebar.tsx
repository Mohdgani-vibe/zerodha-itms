import { NavLink, useLocation } from 'react-router-dom';
import { 
  Building, 
  MapPin, 
  Laptop, 
  Workflow,
  Network
} from 'lucide-react';

export default function Sidebar() {
  const location = useLocation();
  const portalMatch = location.pathname.match(/^\/portal\/(superadmin|itteam|employee)/);
  const basePath = portalMatch ? portalMatch[0] : '';

  // Determine subnav based on active section (dummy logic for visual feel)
  const isUsersSection = location.pathname.includes('/users');
  
  // Dummy subnav data
  const userSubnav = [
    { name: 'All Employees', path: '/users', icon: UserCircleIcon },
    { name: 'Departments', path: '/departments', icon: Building },
    { name: 'Branches', path: '/branches', icon: MapPin },
    { name: 'Designations', path: '/designations', icon: Workflow },
    { name: 'Asset Assignments', path: '/assignments', icon: Laptop },
  ];

  if (!isUsersSection) {
    // Return a generic left nav or empty based on the section
    // Let's create a generic Dashboard left nav if at root
    return (
      <aside className="w-56 bg-white border-r border-slate-200 h-[calc(100vh-3.5rem)] flex-shrink-0 sticky top-14 hidden md:block">
        <div className="py-4">
          <div className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Overview
          </div>
          <nav className="space-y-1 px-2">
            <NavLink
              to={basePath}
              className={() =>
                `group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  location.pathname === basePath || location.pathname === `${basePath}/`
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              <Network className="mr-3 h-5 w-5 flex-shrink-0" />
              Dashboard
            </NavLink>
          </nav>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-56 bg-white border-r border-slate-200 h-[calc(100vh-3.5rem)] flex-shrink-0 sticky top-14 hidden md:block">
      <div className="py-4">
        <div className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          Organization
        </div>
        <nav className="space-y-1 px-2">
          {userSubnav.map((item) => (
            <NavLink
              key={item.name}
              to={`${basePath}${item.path}`}
              className={({ isActive }) =>
                `group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              <item.icon className={`mr-3 h-5 w-5 flex-shrink-0 ${location.pathname.includes(item.path) ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-500'}`} />
              {item.name}
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  );
}

// Inline UserCircleIcon for the dummy subnav since we already imported UserCircle in TopNav but need a simpler one here without collisions or we can use the same
function UserCircleIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="5"></circle>
      <path d="M20 21a8 8 0 0 0-16 0"></path>
    </svg>
  );
}
