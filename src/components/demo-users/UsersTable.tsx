import { Search, Filter } from 'lucide-react';
import { Role } from './mockData';

interface UsersTableProps {
  users: any[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onUserSelect: (user: any) => void;
  role: Role;
}

export default function UsersTable({ users, searchQuery, setSearchQuery, onUserSelect, role }: UsersTableProps) {
  return (
    <div className="flex-1 p-8 bg-white overflow-y-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Users</h1>
        {(role === 'Super Admin' || role === 'IT Team') && (
          <button className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 transition-colors">
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
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <button onClick={() => onUserSelect(user)} className="text-left group outline-none">
                    <div className="text-sm font-semibold text-brand-600 group-hover:text-brand-800 transition-colors">{user.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{user.devices.length} devices</div>
                  </button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button onClick={() => onUserSelect(user)} className="text-sm text-slate-600 hover:text-slate-900 transition-colors font-mono outline-none">{user.employeeId}</button>
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
                    <button onClick={() => onUserSelect(user)} className="text-slate-400 hover:text-slate-900 font-semibold transition-colors outline-none">View</button>
                    {(role === 'Super Admin' || role === 'IT Team') && (
                      <>
                        <button className="text-slate-400 hover:text-brand-600 font-semibold transition-colors outline-none">Edit</button>
                        <button className="text-slate-400 hover:text-brand-600 font-semibold transition-colors outline-none">Assign Device</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-500">No employees found matching your criteria.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
