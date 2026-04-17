import { useEffect, useMemo, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { 
  Search, Bell, MonitorSmartphone, ChevronDown, Moon, LogOut
} from 'lucide-react';
import { apiRequest, resolveWebSocketUrl } from '../../lib/api';
import { clearStoredSession, getPortalSegmentForRole, getPreferredPortalPath, getStoredSession } from '../../lib/session';
import { getStoredTheme, toggleStoredTheme, type AppTheme } from '../../lib/theme';

interface NotificationAnnouncement {
  id: string;
  title: string;
  audience: string;
  urgent: boolean;
  createdAt: string;
}

interface NotificationChatChannel {
  id: string;
  name: string;
  kind: string;
}

interface NotificationChatMessage {
  id: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    fullName: string;
  };
}

interface NotificationChatItem {
  id: string;
  name: string;
  kind: string;
  latestMessage?: NotificationChatMessage;
}

interface NotificationRequest {
  id: string;
  title: string;
  status: string;
  type: string;
  createdAt: string;
}

interface NotificationListResponse<TItem> {
  items: TItem[];
  total: number;
}

const ANNOUNCEMENT_AUDIENCES = ['All Employees', 'IT Team', 'Super Admin'] as const;
const EMPLOYEE_ANNOUNCEMENT_AUDIENCES = ['All Employees'] as const;
const NOTIFICATION_PAGE_SIZE = 4;
const ANNOUNCEMENTS_UPDATED_EVENT = 'itms:announcements-updated';
const CHAT_UPDATED_EVENT = 'itms:chat-updated';
const REQUESTS_UPDATED_EVENT = 'itms:requests-updated';

function getNotificationAudiences(role: string) {
  if (role === 'super_admin' || role === 'it_team') {
    return ANNOUNCEMENT_AUDIENCES;
  }

  return EMPLOYEE_ANNOUNCEMENT_AUDIENCES;
}

function encodeProtocolToken(token: string) {
  return btoa(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function announcementSocketUrl() {
  return resolveWebSocketUrl('/ws/announcements');
}

function announcementSocketProtocols(token: string) {
  return ['itms.announcements.v1', `bearer.${encodeProtocolToken(token)}`];
}

function formatRequestStatus(status: string) {
  return status.replace(/_/g, ' ');
}

const portalNavItems = {
  admin: [
    { name: 'Users', path: '/users' },
    { name: 'Patch', path: '/patch' },
    { name: 'Stock Inventory', path: '/stock' },
    { name: 'Alerts', path: '/alerts' },
    { name: 'Requests', path: '/requests' },
    { name: 'Gatepass', path: '/gatepass' },
    { name: 'Chat', path: '/chat' },
    { name: 'Announcements', path: '/announcements' },
    { name: 'View Settings', path: '/settings' },
  ],
  it: [
    { name: 'Users', path: '/users' },
    { name: 'Patch', path: '/patch' },
    { name: 'Alerts', path: '/alerts' },
    { name: 'Requests', path: '/requests' },
    { name: 'Gatepass', path: '/gatepass' },
    { name: 'Chat', path: '/chat' },
    { name: 'Announcements', path: '/announcements' },
    { name: 'View Settings', path: '/settings' },
  ],
  emp: [
    { name: 'Profile', path: '/profile' },
    { name: 'My Assets', path: '/assets' },
    { name: 'My Alerts', path: '/alerts' },
    { name: 'My Requests', path: '/requests' },
    { name: 'Chat', path: '/chat' },
    { name: 'Announcements', path: '/announcements' },
  ],
} as const;

export default function TopNav() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(() => getStoredTheme());
  const [announcementNotifications, setAnnouncementNotifications] = useState<NotificationAnnouncement[]>([]);
  const [announcementTotal, setAnnouncementTotal] = useState(0);
  const [chatNotifications, setChatNotifications] = useState<NotificationChatItem[]>([]);
  const [chatTotal, setChatTotal] = useState(0);
  const [requestNotifications, setRequestNotifications] = useState<NotificationRequest[]>([]);
  const [requestTotal, setRequestTotal] = useState(0);
  const location = useLocation();
  const session = getStoredSession();
  const sessionToken = session?.token || '';
  const sessionRole = session?.user.role || '';
  const portalMatch = location.pathname.match(/^\/(admin|it|emp)(?:\/|$)/);
  const currentPortal = portalMatch?.[1] || (session ? getPortalSegmentForRole(session.user.role) : 'emp');
  const basePath = portalMatch ? `/${portalMatch[1]}` : `/${currentPortal}`;
  const navItems = portalNavItems[currentPortal as keyof typeof portalNavItems] || portalNavItems.emp;
  const notificationAudiences = getNotificationAudiences(sessionRole);

  const isActive = (path: string) => {
    return location.pathname === `${basePath}${path}` || location.pathname.startsWith(`${basePath}${path}/`);
  };

  useEffect(() => {
    let cancelled = false;
    let announcementSocket: WebSocket | null = null;

    const loadNotifications = async () => {
      if (!sessionToken) {
        setAnnouncementNotifications([]);
        setAnnouncementTotal(0);
        setChatNotifications([]);
        setChatTotal(0);
        setRequestNotifications([]);
        setRequestTotal(0);
        return;
      }

      try {
        const announcementParams = new URLSearchParams({ paginate: '1', page: '1', page_size: String(NOTIFICATION_PAGE_SIZE) });
        const requestsPath = sessionRole === 'employee'
          ? `/api/me/requests?paginate=1&page=1&page_size=${NOTIFICATION_PAGE_SIZE}`
          : `/api/requests?paginate=1&page=1&page_size=${NOTIFICATION_PAGE_SIZE}`;

        notificationAudiences.forEach((audience) => announcementParams.append('audience', audience));
        const [announcementResult, chatChannelsResult, requestsResult] = await Promise.allSettled([
          apiRequest<NotificationListResponse<NotificationAnnouncement>>(`/api/announcements?${announcementParams.toString()}`),
          apiRequest<NotificationListResponse<NotificationChatChannel>>(`/api/chat/channels?paginate=1&page=1&page_size=${NOTIFICATION_PAGE_SIZE}`),
          apiRequest<NotificationListResponse<NotificationRequest>>(requestsPath),
        ]);
        if (!cancelled) {
          const announcementData = announcementResult.status === 'fulfilled' ? announcementResult.value : null;
          const requestsData = requestsResult.status === 'fulfilled' ? requestsResult.value : null;

          let chatItems: NotificationChatItem[] = [];
          let chatCount = 0;
          if (chatChannelsResult.status === 'fulfilled') {
            const chatData = chatChannelsResult.value;
            const latestMessageResults = await Promise.allSettled(
              chatData.items.map(async (channel) => {
                const messages = await apiRequest<NotificationListResponse<NotificationChatMessage>>(`/api/chat/channels/${channel.id}/messages?paginate=1&page=1&page_size=1`);
                const latestMessage = messages.items?.[0];
                return {
                  id: channel.id,
                  name: channel.name,
                  kind: channel.kind,
                  latestMessage,
                } satisfies NotificationChatItem;
              }),
            );

            chatItems = latestMessageResults
              .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
              .sort((left, right) => {
                const leftTime = left.latestMessage?.createdAt ? new Date(left.latestMessage.createdAt).getTime() : 0;
                const rightTime = right.latestMessage?.createdAt ? new Date(right.latestMessage.createdAt).getTime() : 0;
                return rightTime - leftTime;
              });
            chatCount = chatData.total || chatItems.length;
          }

          setAnnouncementNotifications(announcementData?.items ?? []);
          setAnnouncementTotal(announcementData?.total || 0);
          setChatNotifications(chatItems);
          setChatTotal(chatCount);
          setRequestNotifications(requestsData?.items ?? []);
          setRequestTotal(requestsData?.total || 0);
        }
      } catch {
        if (!cancelled) {
          setAnnouncementNotifications([]);
          setAnnouncementTotal(0);
          setChatNotifications([]);
          setChatTotal(0);
          setRequestNotifications([]);
          setRequestTotal(0);
        }
      }
    };

    void loadNotifications();

    if (sessionToken) {
      announcementSocket = new WebSocket(announcementSocketUrl(), announcementSocketProtocols(sessionToken));
      announcementSocket.onmessage = () => {
        if (!cancelled) {
          void loadNotifications();
          window.dispatchEvent(new Event(ANNOUNCEMENTS_UPDATED_EVENT));
        }
      };
    }

    const handleAnnouncementUpdate = () => {
      void loadNotifications();
    };

    const handleChatUpdate = () => {
      void loadNotifications();
    };

    const handleRequestUpdate = () => {
      void loadNotifications();
    };

    window.addEventListener(ANNOUNCEMENTS_UPDATED_EVENT, handleAnnouncementUpdate);
    window.addEventListener(CHAT_UPDATED_EVENT, handleChatUpdate);
    window.addEventListener(REQUESTS_UPDATED_EVENT, handleRequestUpdate);

    return () => {
      cancelled = true;
      window.removeEventListener(ANNOUNCEMENTS_UPDATED_EVENT, handleAnnouncementUpdate);
      window.removeEventListener(CHAT_UPDATED_EVENT, handleChatUpdate);
      window.removeEventListener(REQUESTS_UPDATED_EVENT, handleRequestUpdate);
      announcementSocket?.close();
    };
  }, [location.pathname, notificationAudiences, sessionRole, sessionToken]);

  const notificationSections = useMemo(() => {
    return [
      {
        key: 'announcements',
        title: 'Announcements',
        total: announcementTotal,
        href: `${basePath}/announcements`,
        items: announcementNotifications,
      },
      {
        key: 'chat',
        title: 'Chat',
        total: chatTotal,
        href: `${basePath}/chat`,
        items: chatNotifications,
      },
      {
        key: 'requests',
        title: 'Requests',
        total: requestTotal,
        href: `${basePath}/requests`,
        items: requestNotifications,
      },
    ] as const;
  }, [announcementNotifications, announcementTotal, basePath, chatNotifications, chatTotal, requestNotifications, requestTotal]);

  const totalNotificationCount = announcementTotal + chatTotal + requestTotal;

  return (
    <header className="bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-40 shadow-sm text-zinc-800 dark:text-zinc-100 transition-colors">
      <div className="flex h-14 items-center justify-between px-4 xl:px-6">
        
        {/* Logo */}
        <Link to={`${basePath}/dashboard`} className="flex items-center gap-2 mr-6 flex-shrink-0 group cursor-pointer transition-opacity hover:opacity-90">
          <div className="bg-brand-600 dark:bg-brand-500 p-1.5 rounded flex items-center justify-center shadow-sm group-hover:bg-brand-700 dark:group-hover:bg-brand-600 transition-colors">
            <MonitorSmartphone className="h-5 w-5 text-white" />
          </div>
          <div className="hidden lg:block">
            <span className="font-extrabold text-lg tracking-tight text-zinc-900 dark:text-white group-hover:text-brand-700 dark:group-hover:text-brand-400 transition-colors">
              ITMS
            </span>
          </div>
        </Link>

        {/* Global Navigation */}
        <nav className="hidden md:flex flex-1 space-x-1 overflow-x-auto custom-scrollbar">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <NavLink
                key={item.name}
                to={`${basePath}${item.path}`}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${
                  active
                    ? 'bg-brand-600 dark:bg-brand-600 text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {item.name}
              </NavLink>
            );
          })}
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-3 ml-4 flex-shrink-0">
          <div className="relative hidden lg:block">
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            </div>
            <input
              type="text"
              className="block w-48 pl-9 pr-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 sm:text-xs transition-colors"
              placeholder="Search..."
            />
          </div>
          
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsNotificationsOpen((current) => !current)}
              className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white rounded-md transition-colors relative"
            >
              <Bell className="h-4 w-4" />
              {totalNotificationCount > 0 ? <span className="absolute top-1 right-1 block h-1.5 w-1.5 rounded-full bg-rose-500 ring-2 ring-white dark:ring-zinc-900" /> : null}
            </button>
            {isNotificationsOpen ? (
              <div className="absolute right-0 mt-2 w-[26rem] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg z-50 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-bold text-zinc-900 dark:text-white">
                      Notifications
                    </div>
                    <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                      {totalNotificationCount} total
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    {notificationSections.map((section) => (
                      <Link
                        key={section.key}
                        to={section.href}
                        onClick={() => setIsNotificationsOpen(false)}
                        className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs font-bold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                      >
                        <div>{section.title}</div>
                        <div className="mt-1 text-sm text-zinc-900 dark:text-white">{section.total}</div>
                      </Link>
                    ))}
                  </div>
                </div>
                <div className="max-h-[28rem] overflow-y-auto">
                  {notificationSections.map((section) => (
                    <div key={section.key} className="border-b border-zinc-100 px-4 py-3 last:border-b-0 dark:border-zinc-800">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">{section.title}</div>
                        <Link to={section.href} onClick={() => setIsNotificationsOpen(false)} className="text-xs font-bold text-brand-600 hover:text-brand-500">
                          Open
                        </Link>
                      </div>
                      {section.items.length === 0 ? (
                        <div className="rounded-lg bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">No recent {section.title.toLowerCase()}.</div>
                      ) : null}
                      {section.key === 'announcements' ? (section.items as NotificationAnnouncement[]).map((item) => (
                        <Link key={item.id} to={section.href} onClick={() => setIsNotificationsOpen(false)} className="mb-2 block rounded-lg border border-zinc-100 px-3 py-3 transition last:mb-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/70">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-white">{item.title}</div>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${item.urgent ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
                              {item.urgent ? 'Urgent' : item.audience}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{new Date(item.createdAt).toLocaleString()}</div>
                        </Link>
                      )) : null}
                      {section.key === 'chat' ? (section.items as NotificationChatItem[]).map((item) => (
                        <Link key={item.id} to={section.href} onClick={() => setIsNotificationsOpen(false)} className="mb-2 block rounded-lg border border-zinc-100 px-3 py-3 transition last:mb-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/70">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-white">{item.name}</div>
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{item.kind}</span>
                          </div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            {item.latestMessage ? `${item.latestMessage.author.fullName}: ${item.latestMessage.body}` : 'No recent messages'}
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                            {item.latestMessage?.createdAt ? new Date(item.latestMessage.createdAt).toLocaleString() : 'Waiting for activity'}
                          </div>
                        </Link>
                      )) : null}
                      {section.key === 'requests' ? (section.items as NotificationRequest[]).map((item) => (
                        <Link key={item.id} to={section.href} onClick={() => setIsNotificationsOpen(false)} className="mb-2 block rounded-lg border border-zinc-100 px-3 py-3 transition last:mb-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/70">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-white">{item.title}</div>
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{formatRequestStatus(item.status)}</span>
                          </div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{item.type} • {new Date(item.createdAt).toLocaleString()}</div>
                        </Link>
                      )) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          
          <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-1"></div>

          <div className="relative">
             <button 
                onClick={() => {
                  setIsNotificationsOpen(false);
                  setIsMenuOpen(!isMenuOpen);
                }}
                className="flex items-center gap-2 pl-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 p-1 rounded-md transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 group"
             >
                <div className="h-7 w-7 rounded-sm bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center text-brand-700 dark:text-brand-400 font-bold text-xs ring-1 ring-black/5 dark:ring-white/10">
                  {session?.shortName || 'SA'}
                </div>
                <ChevronDown className={`h-3 w-3 text-zinc-400 dark:text-zinc-500 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
             </button>
             
             {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg rounded-lg py-1 z-50 animate-in fade-in slide-in-from-top-2">
                   <button 
                      onClick={() => {
                       setTheme(toggleStoredTheme());
                         setIsMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 flex items-center transition-colors"
                   >
                      <Moon className="w-4 h-4 mr-2" />
                     {theme === 'dark' ? 'Use Light Mode' : 'Use Dark Mode'}
                   </button>
                   {session ? (
                     <Link
                       to={getPreferredPortalPath(session.user)}
                       onClick={() => setIsMenuOpen(false)}
                       className="block w-full px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50"
                     >
                       My Profile
                     </Link>
                   ) : null}
                   <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-1"></div>
                   <button 
                      onClick={() => {
                       clearStoredSession();
                         window.location.href = '/login';
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center transition-colors"
                   >
                      <LogOut className="w-4 h-4 mr-2" />
                      Secure Logout
                   </button>
                </div>
             )}
          </div>
        </div>
      </div>
    </header>
  );
}
