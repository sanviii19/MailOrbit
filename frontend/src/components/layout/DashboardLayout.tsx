import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Clock, Send, ChevronDown, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';

const DashboardLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [stats, setStats] = useState({ scheduled: 0, sent: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await api.get('/emails/stats');
        const data = res.data.data.stats;
        setStats({
          scheduled: Number(data.scheduled) + Number(data.rate_limited),
          sent: Number(data.sent) + Number(data.failed)
        });
      } catch (err) {
        console.error('Failed to load email stats', err);
      }
    };
    fetchStats();

    // Auto refresh stats every 10 seconds
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-white">
      {/* Sidebar */}
      <aside className="w-[280px] border-r border-gray-200 flex flex-col bg-white">
        {/* Logo */}
        <div className="p-6">
          <div className="text-3xl font-black tracking-tighter text-gray-900">MailOrbit</div>
        </div>

        {/* User Profile */}
        <div className="px-6 mb-6">
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="w-full flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors text-left"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <img
                  src={user?.avatar_url || `https://ui-avatars.com/api/?name=${user?.name || 'User'}&background=random`}
                  alt="Avatar"
                  className="w-10 h-10 rounded-full object-cover"
                />
                <div className="overflow-hidden">
                  <div className="text-sm font-semibold text-gray-900 truncate">{user?.name}</div>
                  <div className="text-xs text-gray-500 truncate">{user?.email}</div>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowDropdown(false)}
                />
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-lg p-2 z-20">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 font-medium hover:bg-red-50 rounded-lg transition-colors text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Compose Button */}
        <div className="px-6 mb-8">
          <button
            onClick={() => navigate('/compose')}
            className="w-full py-2.5 px-4 rounded-full border border-green-500 text-green-600 font-medium text-sm hover:bg-green-50 transition-colors"
          >
            Compose
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4">
          <div className="text-xs font-semibold text-gray-400 mb-2 px-2">CORE</div>

          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center justify-between px-3 py-2.5 rounded-lg text-sm mb-1 transition-colors ${isActive ? 'bg-green-50 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`
            }
          >
            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4" />
              <span>Scheduled</span>
            </div>
            <span className="text-xs text-gray-400">{stats.scheduled}</span>
          </NavLink>

          <NavLink
            to="/sent"
            className={({ isActive }) =>
              `flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-green-50 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`
            }
          >
            <div className="flex items-center gap-3">
              <Send className="w-4 h-4" />
              <span>Sent</span>
            </div>
            <span className="text-xs text-gray-400">{stats.sent}</span>
          </NavLink>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
};

export default DashboardLayout;
