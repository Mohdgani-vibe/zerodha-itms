import { Building } from 'lucide-react';
import { MOCK_DEPARTMENTS } from './mockData';

interface DepartmentSidebarProps {
  selectedDept: string;
  setSelectedDept: (dept: string) => void;
  onDeptChange: () => void;
}

export default function DepartmentSidebar({ selectedDept, setSelectedDept, onDeptChange }: DepartmentSidebarProps) {
  return (
    <div className="w-64 bg-slate-50 border-r border-slate-200 min-h-[calc(100vh-3.5rem)] py-6 px-4 hidden md:block flex-shrink-0">
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-3">Departments</h2>
      <nav className="space-y-1">
        {MOCK_DEPARTMENTS.map(dept => (
          <button
            key={dept.name}
            onClick={() => { setSelectedDept(dept.name); onDeptChange(); }}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              selectedDept === dept.name 
                ? 'bg-white text-brand-700 shadow-sm border border-slate-200' 
                : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 border border-transparent'
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
}
