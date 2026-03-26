import { Role } from './mockData';

interface TopNavbarProps {
  role: Role;
  setRole: (r: Role) => void;
  onRoleChangeTrigger: (newRole: Role) => void;
}

export default function TopNavbar({ role, setRole, onRoleChangeTrigger }: TopNavbarProps) {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
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
                  const newRole = e.target.value as Role;
                  setRole(newRole);
                  onRoleChangeTrigger(newRole);
              }}
              className="mt-1 block w-full pl-3 pr-10 py-1.5 text-sm border-slate-300 focus:outline-none focus:ring-brand-500 focus:border-brand-500 rounded-md shadow-sm border bg-slate-50 font-medium"
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
}
