import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Search, Send } from 'lucide-react';
import { apiRequest, resolveWebSocketUrl } from '../lib/api';
import { getStoredSession } from '../lib/session';

const CHAT_MESSAGE_PAGE_SIZE = 100;
const CHAT_CHANNEL_PAGE_SIZE = 100;

interface ChannelMember {
   id: string;
   fullName: string;
   role: string;
}

interface ChatChannel {
   id: string;
   name: string;
   kind: string;
   members: ChannelMember[];
}

interface ChatMessage {
   id: string;
   body: string;
   createdAt: string;
   author: {
      id: string;
      fullName: string;
   };
}

interface PaginatedChatMessagesResponse {
   items: ChatMessage[];
   total: number;
   page: number;
   pageSize: number;
}

interface PaginatedChatChannelsResponse {
   items: ChatChannel[];
   total: number;
   page: number;
   pageSize: number;
}

interface SocketEnvelope {
   type: string;
   messageId: string;
   authorId: string;
   authorName?: string;
   body: string;
   createdAt: string;
}

function encodeProtocolToken(token: string) {
   return btoa(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function chatSocketUrl(channelId: string) {
   const path = `/ws/chat?channelId=${encodeURIComponent(channelId)}`;
   return resolveWebSocketUrl(path);
}

function chatSocketProtocols(token: string) {
   return ['itms.chat.v1', `bearer.${encodeProtocolToken(token)}`];
}

function initials(name: string) {
   return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export default function Chat() {
   const session = getStoredSession();
   const socketRef = useRef<WebSocket | null>(null);
   const reconnectTimerRef = useRef<number | null>(null);
   const [query, setQuery] = useState('');
   const [draft, setDraft] = useState('');
   const [channels, setChannels] = useState<ChatChannel[]>([]);
   const [messages, setMessages] = useState<ChatMessage[]>([]);
   const [activeChannelId, setActiveChannelId] = useState('');
   const [loadingChannels, setLoadingChannels] = useState(true);
   const [loadingMessages, setLoadingMessages] = useState(false);
   const [socketReady, setSocketReady] = useState(false);
   const [error, setError] = useState('');

   const loadChannels = async () => {
      try {
         setLoadingChannels(true);
         setError('');
         const data = await apiRequest<PaginatedChatChannelsResponse>(`/api/chat/channels?paginate=1&page=1&page_size=${CHAT_CHANNEL_PAGE_SIZE}`);
         setChannels(data.items || []);
         setActiveChannelId((current) => current || data.items?.[0]?.id || '');
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to load chat channels');
      } finally {
         setLoadingChannels(false);
      }
   };

   const loadMessages = async (channelId: string) => {
      try {
         setLoadingMessages(true);
         setError('');
         const data = await apiRequest<PaginatedChatMessagesResponse>(`/api/chat/channels/${channelId}/messages?paginate=1&page=1&page_size=${CHAT_MESSAGE_PAGE_SIZE}`);
         setMessages(data.items || []);
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to load chat messages');
      } finally {
         setLoadingMessages(false);
      }
   };

   useEffect(() => {
      void loadChannels();

      const intervalId = window.setInterval(() => {
         void loadChannels();
      }, 5000);

      return () => {
         window.clearInterval(intervalId);
      };
   }, []);

   useEffect(() => {
      if (!activeChannelId) {
         setMessages([]);
         return;
      }

      void loadMessages(activeChannelId);

      const intervalId = window.setInterval(() => {
         void loadMessages(activeChannelId);
      }, 2000);

      return () => {
         window.clearInterval(intervalId);
      };
   }, [activeChannelId]);

   useEffect(() => {
      if (!activeChannelId || !session?.token || !session.user.id) {
         socketRef.current?.close();
         socketRef.current = null;
         setSocketReady(false);
         return;
      }

      let cancelled = false;

      const connect = () => {
         const socket = new WebSocket(chatSocketUrl(activeChannelId), chatSocketProtocols(session.token));
         socketRef.current = socket;

         socket.onopen = () => {
            if (!cancelled) {
               setSocketReady(true);
            }
         };

         socket.onclose = () => {
            if (socketRef.current === socket) {
               socketRef.current = null;
            }
            if (!cancelled) {
               setSocketReady(false);
               reconnectTimerRef.current = window.setTimeout(connect, 1000);
            }
         };

         socket.onerror = () => {
            if (!cancelled) {
               setSocketReady(false);
            }
         };

         socket.onmessage = (event) => {
            try {
               const envelope = JSON.parse(event.data) as SocketEnvelope;
               if (envelope.type !== 'message') {
                  return;
               }

               setMessages((current) => {
                  if (current.some((item) => item.id === envelope.messageId)) {
                     return current;
                  }

                  return [
                     ...current,
                     {
                        id: envelope.messageId,
                        body: envelope.body,
                        createdAt: envelope.createdAt,
                        author: {
                           id: envelope.authorId,
                           fullName: envelope.authorId === session.user.id ? session.user.fullName : envelope.authorName || 'Chat user',
                        },
                     },
                  ];
               });
            } catch {
               return;
            }
         };
      };

      connect();

      return () => {
         cancelled = true;
         if (reconnectTimerRef.current !== null) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
         }
         const currentSocket = socketRef.current;
         socketRef.current = null;
         setSocketReady(false);
         currentSocket?.close();
      };
   }, [activeChannelId, session?.token, session?.user.fullName, session?.user.id]);

   const filteredChannels = useMemo(() => {
      const normalized = query.trim().toLowerCase();
      if (!normalized) {
         return channels;
      }

      return channels.filter((channel) => {
         const memberText = channel.members.map((member) => `${member.fullName} ${member.role}`).join(' ').toLowerCase();
         return `${channel.name} ${channel.kind}`.toLowerCase().includes(normalized) || memberText.includes(normalized);
      });
   }, [channels, query]);

   const activeChannel = channels.find((channel) => channel.id === activeChannelId) || null;

   const handleSend = () => {
      const socket = socketRef.current;
      const body = draft.trim();

      if (!body || !activeChannelId || !socket || socket.readyState !== WebSocket.OPEN) {
         return;
      }

      socket.send(JSON.stringify({ channelId: activeChannelId, body }));

      setDraft('');
   };

   return (
      <div className="grid h-[calc(100vh-64px)] grid-cols-1 overflow-hidden bg-zinc-50 lg:grid-cols-[300px_1fr]">
         <div className="flex flex-col border-r border-zinc-200 bg-white">
            <div className="border-b border-zinc-100 p-4">
               <h2 className="mb-3 flex items-center text-lg font-bold text-zinc-900">
                  <MessageSquare className="mr-2 h-5 w-5 text-brand-600" /> Chat
               </h2>
               <div className="relative">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search channels or members..." className="w-full pl-9 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all" />
               </div>
            </div>
            <div className="flex-1 overflow-y-auto">
               {loadingChannels ? <div className="p-4 text-sm text-zinc-500">Loading channels...</div> : null}
               {!loadingChannels && filteredChannels.length === 0 ? <div className="p-4 text-sm text-zinc-500">No channels available.</div> : null}
               {filteredChannels.map((channel) => {
                  const memberNames = channel.members.map((member) => member.fullName).join(', ');
                  return (
                     <button key={channel.id} type="button" onClick={() => setActiveChannelId(channel.id)} className={`w-full border-b border-zinc-100 px-4 py-3 text-left transition-colors ${channel.id === activeChannelId ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}>
                        <div className="mb-1 flex items-start justify-between">
                           <span className="text-sm font-bold text-zinc-900">{channel.name}</span>
                           <span className="text-[10px] text-zinc-500 font-semibold uppercase">{channel.kind}</span>
                        </div>
                        <p className="mt-1 truncate text-xs text-zinc-600">{memberNames || 'No members listed'}</p>
                     </button>
                  );
               })}
            </div>
         </div>

         <div className="flex min-h-0 flex-col bg-white">
            <div className="shrink-0 border-b border-zinc-200 px-5 py-4">
               <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center">
                     <div className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">
                        {initials(activeChannel?.name || 'CH')}
                     </div>
                     <div className="min-w-0">
                        <h3 className="text-sm font-bold text-zinc-900 leading-tight truncate">{activeChannel?.name || 'Select a channel'}</h3>
                        <p className="text-xs text-zinc-500 font-semibold mt-0.5 truncate">
                           {activeChannel ? activeChannel.members.map((member) => `${member.fullName} (${member.role})`).join(', ') : 'Choose a channel to load messages'}
                        </p>
                     </div>
                  </div>
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold uppercase text-zinc-600">
                     {activeChannel?.kind || 'Channel'}
                  </div>
               </div>
            </div>

            <div className="flex flex-1 flex-col justify-end space-y-5 overflow-y-auto bg-zinc-50 p-5">
               {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 self-stretch">{error}</div> : null}
               {loadingMessages ? <div className="text-sm text-zinc-500">Loading messages...</div> : null}
               {!loadingMessages && activeChannelId && messages.length === 0 ? <div className="text-sm text-zinc-500">No messages in this channel yet.</div> : null}
               {!activeChannelId ? <div className="text-sm text-zinc-500">Select a channel to start chatting.</div> : null}
               {messages.map((msg) => {
                  const isMe = msg.author.id === session?.user.id;
                  return (
                     <div key={msg.id} className={`flex max-w-[80%] ${isMe ? 'self-end flex-row-reverse' : 'self-start'}`}>
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${isMe ? 'ml-3 bg-zinc-900 text-white' : 'mr-3 bg-brand-100 text-brand-700'}`}>
                           {initials(msg.author.fullName)}
                        </div>
                        <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                           <div className="flex items-center space-x-2 mb-1">
                              <span className="text-xs font-semibold text-zinc-500">{msg.author.fullName}</span>
                              <span className="text-[10px] text-zinc-400">{new Date(msg.createdAt).toLocaleString()}</span>
                           </div>
                           <div className={`break-words rounded-2xl p-3 text-sm ${isMe ? 'rounded-tr-none bg-zinc-900 text-white' : 'rounded-tl-none border border-zinc-200 bg-white text-zinc-800'}`}>
                              {msg.body}
                           </div>
                        </div>
                     </div>
                  );
               })}
            </div>

            <div className="shrink-0 border-t border-zinc-200 bg-white p-4">
               <div className="relative flex items-center">
                  <input type="text" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleSend()} disabled={!activeChannelId || !socketReady} placeholder={activeChannelId ? (socketReady ? 'Type a message...' : 'Connecting to chat...') : 'Select a channel first'} className="w-full pl-4 pr-12 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-colors shadow-sm disabled:opacity-60" />
                  <button type="button" onClick={handleSend} disabled={!activeChannelId || !draft.trim() || !socketReady} className="absolute right-2 p-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors shadow-sm disabled:opacity-60">
                     <Send className="w-4 h-4" />
                  </button>
               </div>
            </div>
         </div>
      </div>
   );
}
