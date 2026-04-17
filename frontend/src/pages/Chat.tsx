import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Filter, MessageSquare, Search, Send, ShieldPlus, Trash2, Users } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiRequest, resolveWebSocketUrl } from '../lib/api';
import { getStoredSession } from '../lib/session';
import Pagination from '../components/Pagination';

const CHAT_MESSAGE_PAGE_SIZE = 100;
const CHAT_CHANNEL_PAGE_SIZE = 50;
const CHAT_UPDATED_EVENT = 'itms:chat-updated';

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
   status?: string;
   closedAt?: string;
   createdAt?: string;
   createdBy?: {
      id: string;
      fullName: string;
   };
   primaryOwner?: {
      id: string;
      fullName: string;
   };
   backupOwner?: {
      id: string;
      fullName: string;
   };
   latestMessage?: {
      body: string;
      createdAt: string;
      authorName: string;
   };
   linkedRequest?: {
      id: string;
      ticketNumber?: string;
      status?: string;
   };
   messageCount?: number;
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
   status?: string;
   ticketId?: string;
   ticketNumber?: string;
   typing?: boolean;
}

interface CreateChatChannelResponse {
   id: string;
   routedMemberId?: string;
   primaryOwnerId?: string;
}

interface AddChatMembersResponse {
   added: number;
}

interface RemoveChatMemberResponse {
   removed: number;
}

interface PendingTeammateAction {
   kind: 'add' | 'remove';
   memberId: string;
   memberName: string;
}

interface UpdateChatOwnerResponse {
   ownerId?: string | null;
   backupOwnerId?: string | null;
}

interface CloseChatResponse {
   status: string;
   ticketId?: string;
   ticketNumber?: string;
}

interface ReopenChatResponse {
   status: string;
   ticketId?: string;
}

interface DirectoryUser {
   id: string;
   fullName: string;
   email: string;
   role: string;
}

interface PaginatedUsersResponse {
   items: DirectoryUser[];
}

interface WorkflowSettings {
   chatMemberIds: string[];
}

function defaultWorkflowSettings(): WorkflowSettings {
   return {
      chatMemberIds: [],
   };
}

function normalizeWorkflowSettings(settings?: WorkflowSettings | null): WorkflowSettings {
   return {
      chatMemberIds: Array.isArray(settings?.chatMemberIds)
         ? settings.chatMemberIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
         : [],
   };
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

function formatDateTime(value?: string) {
   if (!value) {
      return 'No activity yet';
   }

   const date = new Date(value);
   if (Number.isNaN(date.getTime())) {
      return 'No activity yet';
   }

   return date.toLocaleString();
}

function formatChannelStatus(status?: string) {
   return status === 'closed' ? 'Closed' : 'Open';
}

function isRecentlyClosed(value?: string, days = 7) {
   if (!value) {
      return true;
   }

   const closedAt = new Date(value).getTime();
   if (Number.isNaN(closedAt)) {
      return true;
   }

   return Date.now() - closedAt <= days * 24 * 60 * 60 * 1000;
}

function mergeMessages(messages: ChatMessage[]) {
   const seen = new Set<string>();
   return messages.filter((message) => {
      if (!message?.id || seen.has(message.id)) {
         return false;
      }
      seen.add(message.id);
      return true;
   });
}

export default function Chat() {
   const session = getStoredSession();
   const socketRef = useRef<WebSocket | null>(null);
   const reconnectTimerRef = useRef<number | null>(null);
   const typingTimerRef = useRef<number | null>(null);
   const remoteTypingTimerRef = useRef<Record<string, number>>({});
   const isTypingRef = useRef(false);
   const role = session?.user.role || '';
   const isEmployee = role === 'employee';
   const isManager = role === 'super_admin' || role === 'it_team';
   const [query, setQuery] = useState('');
   const [draft, setDraft] = useState('');
   const [kindFilter, setKindFilter] = useState<'all' | 'support' | 'operations'>('all');
   const [newChannelName, setNewChannelName] = useState('');
   const [newChannelMessage, setNewChannelMessage] = useState('');
   const [channels, setChannels] = useState<ChatChannel[]>([]);
   const [channelPage, setChannelPage] = useState(1);
   const [totalChannels, setTotalChannels] = useState(0);
   const [messages, setMessages] = useState<ChatMessage[]>([]);
   const [messagePage, setMessagePage] = useState(1);
   const [totalMessages, setTotalMessages] = useState(0);
   const [teammates, setTeammates] = useState<DirectoryUser[]>([]);
   const [selectedTeammateId, setSelectedTeammateId] = useState('');
   const [pendingTeammateAction, setPendingTeammateAction] = useState<PendingTeammateAction | null>(null);
   const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
   const [selectedBackupOwnerId, setSelectedBackupOwnerId] = useState<string | null>(null);
   const [activeChannelId, setActiveChannelId] = useState('');
   const [loadingChannels, setLoadingChannels] = useState(true);
   const [loadingMessages, setLoadingMessages] = useState(false);
   const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
   const [loadingTeammates, setLoadingTeammates] = useState(false);
   const [socketReady, setSocketReady] = useState(false);
   const [creatingChannel, setCreatingChannel] = useState(false);
   const [addingTeammate, setAddingTeammate] = useState(false);
   const [removingMemberId, setRemovingMemberId] = useState('');
   const [transferringOwner, setTransferringOwner] = useState(false);
   const [closingChannel, setClosingChannel] = useState(false);
   const [closeDialogOpen, setCloseDialogOpen] = useState(false);
   const [closeResult, setCloseResult] = useState<CloseChatResponse | null>(null);
   const [remoteTypingUsers, setRemoteTypingUsers] = useState<Record<string, string>>({});
   const [error, setError] = useState('');
   const [notice, setNotice] = useState('');

   const loadChannels = useCallback(async () => {
      try {
         setLoadingChannels(true);
         setError('');
         const params = new URLSearchParams({
            paginate: '1',
            page: String(channelPage),
            page_size: String(CHAT_CHANNEL_PAGE_SIZE),
         });
         if (query.trim()) {
            params.set('search', query.trim());
         }
         if (kindFilter !== 'all') {
            params.set('kind', kindFilter);
         }
         const data = await apiRequest<PaginatedChatChannelsResponse>(`/api/chat/channels?${params.toString()}`);
         const nextChannels = Array.isArray(data.items) ? data.items : [];
         setChannels(nextChannels);
         setTotalChannels(data.total || nextChannels.length);
         setActiveChannelId((current) => (nextChannels.some((channel) => channel.id === current) ? current : nextChannels[0]?.id || ''));
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to load chat channels');
      } finally {
         setLoadingChannels(false);
      }
   }, [channelPage, kindFilter, query]);

   const loadTeammates = useCallback(async () => {
      if (!isManager) {
         setTeammates([]);
         return;
      }

      try {
         setLoadingTeammates(true);
         const [data, settings] = await Promise.all([
            apiRequest<PaginatedUsersResponse>('/api/users?paginate=1&page=1&page_size=200&role=it_team&role=super_admin&status=active'),
            apiRequest<WorkflowSettings>('/api/settings/workflow').catch(() => defaultWorkflowSettings()),
         ]);
         const normalizedSettings = normalizeWorkflowSettings(settings);
         setTeammates(data.items.filter((user) => normalizedSettings.chatMemberIds.length === 0 || normalizedSettings.chatMemberIds.includes(user.id)));
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to load available teammates');
      } finally {
         setLoadingTeammates(false);
      }
   }, [isManager]);

   const loadMessages = useCallback(async (channelId: string, page = 1, mode: 'replace' | 'prepend' = 'replace') => {
      try {
         if (mode === 'prepend') {
            setLoadingOlderMessages(true);
         } else {
            setLoadingMessages(true);
         }
         setError('');
         const data = await apiRequest<PaginatedChatMessagesResponse>(`/api/chat/channels/${channelId}/messages?paginate=1&page=${page}&page_size=${CHAT_MESSAGE_PAGE_SIZE}`);
         const nextItems = Array.isArray(data.items) ? data.items : [];
         setMessagePage(page);
         setTotalMessages(data.total || nextItems.length);
         setMessages((current) => (mode === 'prepend' ? mergeMessages([...nextItems, ...current]) : mergeMessages(nextItems)));
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to load chat messages');
      } finally {
         if (mode === 'prepend') {
            setLoadingOlderMessages(false);
         } else {
            setLoadingMessages(false);
         }
      }
   }, []);

   useEffect(() => {
      void loadChannels();
      if (isManager) {
         void loadTeammates();
      }

      return () => {
         if (typingTimerRef.current !== null) {
            window.clearTimeout(typingTimerRef.current);
         }
      };
   }, [isManager, loadChannels, loadTeammates]);

   useEffect(() => {
      setChannelPage(1);
   }, [kindFilter, query]);

   useEffect(() => {
      if (!activeChannelId) {
         setMessages([]);
         setMessagePage(1);
         setTotalMessages(0);
         setRemoteTypingUsers({});
         return;
      }

      setMessagePage(1);
      setTotalMessages(0);
      void loadMessages(activeChannelId, 1, 'replace');

      return () => {
         Object.values(remoteTypingTimerRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
         remoteTypingTimerRef.current = {};
         setRemoteTypingUsers({});
      };
   }, [activeChannelId, loadMessages]);

   const sendTypingState = useCallback((typing: boolean) => {
      const socket = socketRef.current;
      if (!activeChannelId || !socket || socket.readyState !== WebSocket.OPEN) {
         return;
      }
      socket.send(JSON.stringify({ type: 'typing', channelId: activeChannelId, typing }));
      isTypingRef.current = typing;
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
               if (envelope.type === 'typing') {
                  if (envelope.authorId === session.user.id) {
                     return;
                  }
                  if (!envelope.typing) {
                     setRemoteTypingUsers((current) => {
                        const next = { ...current };
                        delete next[envelope.authorId];
                        return next;
                     });
                     const timerId = remoteTypingTimerRef.current[envelope.authorId];
                     if (timerId) {
                        window.clearTimeout(timerId);
                        delete remoteTypingTimerRef.current[envelope.authorId];
                     }
                     return;
                  }

                  setRemoteTypingUsers((current) => ({
                     ...current,
                     [envelope.authorId]: envelope.authorName || 'Chat user',
                  }));
                  const existingTimer = remoteTypingTimerRef.current[envelope.authorId];
                  if (existingTimer) {
                     window.clearTimeout(existingTimer);
                  }
                  remoteTypingTimerRef.current[envelope.authorId] = window.setTimeout(() => {
                     setRemoteTypingUsers((current) => {
                        const next = { ...current };
                        delete next[envelope.authorId];
                        return next;
                     });
                     delete remoteTypingTimerRef.current[envelope.authorId];
                  }, 1600);
                  return;
               }
               if (envelope.type !== 'message') {
                  void loadChannels();
                  window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
                  if (envelope.type === 'channel_closed') {
                     setNotice(envelope.ticketNumber ? `Chat closed and moved into ticket ${envelope.ticketNumber}.` : 'Chat closed.');
                  } else if (envelope.type === 'channel_reopened') {
                     setNotice('Chat reopened.');
                  }
                  return;
               }

               setMessages((current) => {
                  if (current.some((item) => item.id === envelope.messageId)) {
                     return current;
                  }

                  setTotalMessages((count) => count + 1);
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
               setRemoteTypingUsers((current) => {
                  const next = { ...current };
                  delete next[envelope.authorId];
                  return next;
               });
               void loadChannels();
               window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
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
         if (isTypingRef.current && currentSocket?.readyState === WebSocket.OPEN && activeChannelId) {
            currentSocket.send(JSON.stringify({ type: 'typing', channelId: activeChannelId, typing: false }));
         }
         socketRef.current = null;
         setSocketReady(false);
         currentSocket?.close();
      };
   }, [activeChannelId, loadChannels, loadMessages, session?.token, session?.user.fullName, session?.user.id]);

   const visibleChannels = useMemo(() => channels.filter((channel) => channel.status !== 'closed' || isRecentlyClosed(channel.closedAt)), [channels]);
   const activeChannel = visibleChannels.find((channel) => channel.id === activeChannelId) || null;
   const hasOlderMessages = messages.length < totalMessages;
   const availableTeammates = useMemo(() => {
      if (!activeChannel) {
         return teammates;
      }

      const memberLookup = new Set(activeChannel.members.map((member) => member.id));
      return teammates.filter((user) => !memberLookup.has(user.id));
   }, [activeChannel, teammates]);
   const ownerCandidates = useMemo(() => {
      return (activeChannel?.members || []).filter((member) => member.role === 'it_team' || member.role === 'super_admin');
   }, [activeChannel]);
   const backupOwnerCandidates = useMemo(() => {
      const currentPrimaryOwnerId = selectedOwnerId ?? activeChannel?.primaryOwner?.id ?? null;
      return ownerCandidates.filter((member) => member.id !== currentPrimaryOwnerId);
   }, [activeChannel?.primaryOwner?.id, ownerCandidates, selectedOwnerId]);
   const isActiveChannelClosed = activeChannel?.status === 'closed';
   const canCloseActiveChannel = Boolean(activeChannel && !isActiveChannelClosed && (role === 'super_admin' || role === 'it_team'));
   const canReopenActiveChannel = Boolean(activeChannel && isActiveChannelClosed && (role === 'employee' || role === 'super_admin' || role === 'it_team'));

   useEffect(() => {
      setSelectedOwnerId(activeChannel?.primaryOwner?.id ?? null);
      setSelectedBackupOwnerId(activeChannel?.backupOwner?.id ?? null);
      setCloseDialogOpen(false);
      setCloseResult(null);
   }, [activeChannel?.backupOwner?.id, activeChannel?.id, activeChannel?.primaryOwner?.id]);

   useEffect(() => {
      if (!visibleChannels.some((channel) => channel.id === activeChannelId)) {
         setActiveChannelId(visibleChannels[0]?.id || '');
      }
   }, [activeChannelId, visibleChannels]);

   const remoteTypingLabel = useMemo(() => {
      const names = Object.values(remoteTypingUsers);
      if (names.length === 0) {
         return '';
      }
      if (names.length === 1) {
         return `${names[0]} is typing...`;
      }
      return `${names.slice(0, 2).join(', ')} are typing...`;
   }, [remoteTypingUsers]);

   const handleSend = () => {
      const socket = socketRef.current;
      const body = draft.trim();

      if (!body || !activeChannelId || !socket || socket.readyState !== WebSocket.OPEN) {
         return;
      }

      socket.send(JSON.stringify({ channelId: activeChannelId, body }));

      if (typingTimerRef.current !== null) {
         window.clearTimeout(typingTimerRef.current);
         typingTimerRef.current = null;
      }
      sendTypingState(false);
      setDraft('');
      setNotice('');
   };

   const handleLoadOlderMessages = () => {
      if (!activeChannelId || loadingOlderMessages || !hasOlderMessages) {
         return;
      }
      void loadMessages(activeChannelId, messagePage + 1, 'prepend');
   };

   const handleDraftChange = (value: string) => {
      setDraft(value);

      if (!activeChannelId || isActiveChannelClosed || !socketReady) {
         return;
      }

      const hasBody = value.trim().length > 0;
      if (hasBody && !isTypingRef.current) {
         sendTypingState(true);
      }
      if (!hasBody && isTypingRef.current) {
         sendTypingState(false);
      }
      if (typingTimerRef.current !== null) {
         window.clearTimeout(typingTimerRef.current);
      }
      if (hasBody) {
         typingTimerRef.current = window.setTimeout(() => {
            sendTypingState(false);
            typingTimerRef.current = null;
         }, 1200);
      }
   };

   const handleCreateSupportChat = async () => {
      const name = newChannelName.trim();
      const initialMessage = newChannelMessage.trim();

      if (!name) {
         setError('Enter a chat subject to route the conversation.');
         return;
      }

      try {
         setCreatingChannel(true);
         setError('');
         setNotice('');
         const response = await apiRequest<CreateChatChannelResponse>('/api/chat/channels', {
            method: 'POST',
            body: JSON.stringify({
               name,
               kind: 'support',
               initialMessage,
            }),
         });
         setNewChannelName('');
         setNewChannelMessage('');
         await loadChannels();
         setActiveChannelId(response.id);
         if (response.id) {
            await loadMessages(response.id);
         }
         window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
         setNotice(response.primaryOwnerId ? 'Support chat created and assigned to a primary IT owner.' : response.routedMemberId ? 'Support chat created and routed to an IT owner.' : 'Support chat created.');
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to create support chat');
      } finally {
         setCreatingChannel(false);
      }
   };

   const handleTransferOwner = async () => {
      if (!activeChannelId || !selectedOwnerId) {
         return;
      }

      try {
         setTransferringOwner(true);
         setError('');
         setNotice('');
         const response = await apiRequest<UpdateChatOwnerResponse>(`/api/chat/channels/${activeChannelId}/owner`, {
            method: 'PUT',
            body: JSON.stringify({ ownerId: selectedOwnerId }),
         });
         await loadChannels();
         setSelectedOwnerId(response.ownerId ?? null);
         if ((response.ownerId ?? null) === selectedBackupOwnerId) {
            setSelectedBackupOwnerId(null);
         }
         window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
         const ownerName = ownerCandidates.find((member) => member.id === response.ownerId)?.fullName || 'Selected owner';
         setNotice(`${ownerName} is now the primary owner.`);
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to transfer primary owner');
      } finally {
         setTransferringOwner(false);
      }
   };

   const handleBackupOwnerUpdate = async (backupOwnerIdOverride?: string | null) => {
      if (!activeChannelId) {
         return;
      }

      const nextBackupOwnerId = typeof backupOwnerIdOverride === 'string' || backupOwnerIdOverride === null ? backupOwnerIdOverride : selectedBackupOwnerId;

      try {
         setTransferringOwner(true);
         setError('');
         setNotice('');
         const response = await apiRequest<UpdateChatOwnerResponse>(`/api/chat/channels/${activeChannelId}/owner`, {
            method: 'PUT',
            body: JSON.stringify({ backupOwnerId: nextBackupOwnerId ?? '' }),
         });
         await loadChannels();
         setSelectedBackupOwnerId(response.backupOwnerId ?? null);
         window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
         if (response.backupOwnerId) {
            const backupName = ownerCandidates.find((member) => member.id === response.backupOwnerId)?.fullName || 'Selected backup owner';
            setNotice(`${backupName} is now the backup owner.`);
         } else {
            setNotice('Backup owner cleared.');
         }
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to update backup owner');
      } finally {
         setTransferringOwner(false);
      }
   };

   const handleReopenChannel = async () => {
      if (!activeChannelId || !activeChannel) {
         return;
      }

      try {
         setClosingChannel(true);
         setError('');
         setNotice('');
         await apiRequest<ReopenChatResponse>(`/api/chat/channels/${activeChannelId}/reopen`, { method: 'PUT' });
         await loadChannels();
         window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
         setNotice(activeChannel.linkedRequest?.ticketNumber ? `Chat reopened under ticket ${activeChannel.linkedRequest.ticketNumber}.` : 'Chat reopened.');
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to reopen chat');
      } finally {
         setClosingChannel(false);
      }
   };

   const handleAddTeammate = async () => {
      if (!activeChannelId || !selectedTeammateId) {
         return;
      }

      try {
         setAddingTeammate(true);
         setError('');
         setNotice('');
         const response = await apiRequest<AddChatMembersResponse>(`/api/chat/channels/${activeChannelId}/members`, {
            method: 'POST',
            body: JSON.stringify({ memberIds: [selectedTeammateId] }),
         });
         await loadChannels();
         setSelectedTeammateId('');
         window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
         setNotice(response.added > 0 ? 'Teammate added to the chat.' : 'That teammate is already in the chat.');
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to add teammate');
      } finally {
         setAddingTeammate(false);
      }
   };

   const openAddTeammateDialog = () => {
      if (!selectedTeammateId) {
         return;
      }
      const memberName = teammates.find((member) => member.id === selectedTeammateId)?.fullName || 'Selected teammate';
      setPendingTeammateAction({ kind: 'add', memberId: selectedTeammateId, memberName });
   };

   const handleCloseChannel = () => {
      if (!activeChannelId || !activeChannel) {
         return;
      }

      setCloseDialogOpen(true);
   };

   const handleConfirmCloseChannel = async () => {
      if (!activeChannelId || !activeChannel) {
         return;
      }

      try {
         setClosingChannel(true);
         setError('');
         setNotice('');
         const response = await apiRequest<CloseChatResponse>(`/api/chat/channels/${activeChannelId}/close`, { method: 'PUT' });
         await loadChannels();
         window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
         setCloseDialogOpen(false);
         setCloseResult(response);
         setDraft('');
         setNotice(response.ticketNumber ? `Chat closed and converted to ticket ${response.ticketNumber}.` : 'Chat closed.');
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to close chat');
      } finally {
         setClosingChannel(false);
      }
   };

   const handleRemoveTeammate = async (memberId: string, memberName: string) => {
      if (!activeChannelId) {
         return;
      }

      try {
         setRemovingMemberId(memberId);
         setError('');
         setNotice('');
         const response = await apiRequest<RemoveChatMemberResponse>(`/api/chat/channels/${activeChannelId}/members/${memberId}`, {
            method: 'DELETE',
         });
         await loadChannels();
         window.dispatchEvent(new Event(CHAT_UPDATED_EVENT));
         setNotice(response.removed > 0 ? `${memberName} removed from the chat.` : `${memberName} was already removed.`);
      } catch (requestError) {
         setError(requestError instanceof Error ? requestError.message : 'Failed to remove teammate');
      } finally {
         setRemovingMemberId('');
      }
   };

   const handleConfirmTeammateAction = () => {
      if (!pendingTeammateAction) {
         return;
      }
      const action = pendingTeammateAction;
      setPendingTeammateAction(null);
      if (action.kind === 'add') {
         void handleAddTeammate();
         return;
      }
      void handleRemoveTeammate(action.memberId, action.memberName);
   };

   const handleStartFreshChat = () => {
      setActiveChannelId('');
      setDraft('');
      setNewChannelName('');
      setNewChannelMessage('');
      setNotice('');
      setError('');
   };

   const layoutClassName = `grid h-[calc(100vh-64px)] grid-cols-1 overflow-hidden bg-zinc-50 ${isManager ? 'lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_320px]' : 'lg:grid-cols-[320px_1fr]'}`;

   return (
      <div className={layoutClassName}>
         <div className="flex flex-col border-r border-zinc-200 bg-white">
            <div className="border-b border-zinc-100 p-4">
               <h2 className="mb-3 flex items-center text-lg font-bold text-zinc-900">
                  <MessageSquare className="mr-2 h-5 w-5 text-brand-600" /> Chat
               </h2>
               <div className="relative">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search channels or members..." className="w-full pl-9 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all" />
               </div>
               {isManager ? (
                  <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                     <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-600">
                        <Filter className="h-3.5 w-3.5" /> Queue Filter
                     </div>
                     <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-semibold">
                        {(['all', 'support', 'operations'] as const).map((value) => (
                           <button
                              key={value}
                              type="button"
                              onClick={() => setKindFilter(value)}
                              className={`rounded-lg px-2 py-2 capitalize transition-colors ${kindFilter === value ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-700 hover:bg-zinc-100'}`}
                           >
                              {value}
                           </button>
                        ))}
                     </div>
                  </div>
               ) : null}
               {isEmployee ? (
                  <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/60 p-3">
                     <div className="flex items-center justify-between gap-3">
                        <div>
                           <div className="text-[11px] font-bold uppercase tracking-wider text-brand-700">Open Support Chat</div>
                           <p className="mt-1 text-xs text-zinc-600">Use a clear subject so the right IT owner is routed in quickly.</p>
                        </div>
                        <button type="button" onClick={handleStartFreshChat} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50">New Chat</button>
                     </div>
                     <input
                        type="text"
                        value={newChannelName}
                        onChange={(event) => setNewChannelName(event.target.value)}
                        placeholder="Chat subject"
                        className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                     />
                     <textarea
                        value={newChannelMessage}
                        onChange={(event) => setNewChannelMessage(event.target.value)}
                        rows={3}
                        placeholder="Optional first message"
                        className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                     />
                     <button
                        type="button"
                        onClick={() => void handleCreateSupportChat()}
                        disabled={creatingChannel || !newChannelName.trim()}
                        className="mt-3 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
                     >
                        {creatingChannel ? 'Creating...' : 'Start Support Chat'}
                     </button>
                  </div>
               ) : null}
            </div>
            <div className="flex-1 overflow-y-auto">
               {loadingChannels ? <div className="p-4 text-sm text-zinc-500">Loading channels...</div> : null}
               {!loadingChannels && visibleChannels.length === 0 ? <div className="p-4 text-sm text-zinc-500">No channels available.</div> : null}
               {visibleChannels.map((channel) => {
                  const memberNames = channel.members.map((member) => member.fullName).join(', ');
                  return (
                     <button key={channel.id} type="button" onClick={() => setActiveChannelId(channel.id)} className={`w-full border-b border-zinc-100 px-4 py-3 text-left transition-colors ${channel.id === activeChannelId ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}>
                        <div className="mb-1 flex items-start justify-between gap-3">
                           <span className="min-w-0 truncate text-sm font-bold text-zinc-900">{channel.name}</span>
                           <div className="flex shrink-0 items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${channel.status === 'closed' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{formatChannelStatus(channel.status)}</span>
                              <span className="text-[10px] text-zinc-500 font-semibold uppercase">{channel.kind}</span>
                           </div>
                        </div>
                        <p className="truncate text-xs text-zinc-600">{channel.latestMessage?.body || memberNames || 'No members listed'}</p>
                        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
                           <span className="truncate">{channel.latestMessage ? `${channel.latestMessage.authorName || 'Chat user'} · ${formatDateTime(channel.latestMessage.createdAt)}` : `Opened ${formatDateTime(channel.createdAt)}`}</span>
                           <span className="shrink-0">{channel.linkedRequest?.ticketNumber || `${channel.messageCount || 0} msgs`}</span>
                        </div>
                     </button>
                  );
               })}
            </div>
            <Pagination
               currentPage={channelPage}
               totalItems={totalChannels}
               pageSize={CHAT_CHANNEL_PAGE_SIZE}
               onPageChange={setChannelPage}
               itemLabel="channels"
            />
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
                        <p className="text-xs text-zinc-500 mt-0.5 truncate">
                           {activeChannel ? activeChannel.members.map((member) => member.fullName).join(', ') : 'Choose a channel to load messages'}
                        </p>
                     </div>
                  </div>
                  <div className="flex items-center gap-2">
                     {activeChannel?.linkedRequest?.ticketNumber ? <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-bold uppercase text-brand-700">{activeChannel.linkedRequest.ticketNumber}</div> : null}
                     <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold uppercase text-zinc-600">
                        {activeChannel?.kind || 'Channel'} · {formatChannelStatus(activeChannel?.status)}
                     </div>
                  </div>
               </div>
            </div>

            <div className="flex flex-1 flex-col justify-end space-y-5 overflow-y-auto bg-zinc-50 p-5">
               {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 self-stretch">{error}</div> : null}
               {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 self-stretch">{notice}</div> : null}
               {canReopenActiveChannel && !isManager ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                     <div>
                        <div className="font-semibold">This chat is closed.</div>
                        <div className="mt-1 text-xs text-amber-800">Reopen it if you still need help, or start a new support chat for a fresh thread.</div>
                     </div>
                     <div className="flex items-center gap-2">
                        <button type="button" onClick={handleStartFreshChat} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-800 hover:bg-amber-100">New Chat</button>
                        <button
                           type="button"
                           onClick={() => void handleReopenChannel()}
                           disabled={closingChannel}
                           className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-amber-600 disabled:opacity-60"
                        >
                           {closingChannel ? 'Updating...' : 'Reopen Chat'}
                        </button>
                     </div>
                  </div>
               ) : null}
               {activeChannelId && hasOlderMessages ? (
                  <div className="self-center">
                     <button
                        type="button"
                        onClick={handleLoadOlderMessages}
                        disabled={loadingMessages || loadingOlderMessages}
                        className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
                     >
                        {loadingOlderMessages ? 'Loading older messages...' : `Load older messages (${Math.max(totalMessages - messages.length, 0)} more)`}
                     </button>
                  </div>
               ) : null}
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
               {remoteTypingLabel ? <div className="text-xs font-semibold text-zinc-500">{remoteTypingLabel}</div> : null}
            </div>

            <div className="shrink-0 border-t border-zinc-200 bg-white p-4">
               <div className="relative flex items-center">
                  <input type="text" value={draft} onChange={(event) => handleDraftChange(event.target.value)} onBlur={() => sendTypingState(false)} onKeyDown={(event) => event.key === 'Enter' && handleSend()} disabled={!activeChannelId || !socketReady || isActiveChannelClosed} placeholder={!activeChannelId ? 'Select a channel first' : isActiveChannelClosed ? 'This chat is closed. Reopen it to continue.' : socketReady ? 'Type a message...' : 'Connecting to chat...'} className="w-full pl-4 pr-12 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-colors shadow-sm disabled:opacity-60" />
                  <button type="button" onClick={handleSend} disabled={!activeChannelId || !draft.trim() || !socketReady || isActiveChannelClosed} className="absolute right-2 p-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors shadow-sm disabled:opacity-60">
                     <Send className="w-4 h-4" />
                  </button>
               </div>
            </div>
         </div>

         {isManager ? (
            <aside className="hidden min-h-0 flex-col border-l border-zinc-200 bg-white xl:flex">
               <div className="border-b border-zinc-100 p-4">
                  <div className="text-sm font-bold text-zinc-900">Chat Control</div>
                  <p className="mt-1 text-xs text-zinc-500">Inspect routed support chats, add backup owners, and close completed conversations.</p>
               </div>
               <div className="flex-1 space-y-4 overflow-y-auto p-4">
                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                     <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                        <Users className="h-3.5 w-3.5" /> Members
                     </div>
                     <div className="mt-3 space-y-2">
                        {activeChannel?.members.length ? activeChannel.members.map((member) => {
                           const canRemoveMember = member.role === 'it_team' || member.role === 'super_admin';
                           return (
                              <div key={member.id} className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                                 <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                       <div className="truncate text-sm font-semibold text-zinc-900">{member.fullName}</div>
                                       <div className="text-[11px] uppercase tracking-wider text-zinc-500">{member.role}</div>
                                    </div>
                                    {canRemoveMember ? (
                                       <button
                                          type="button"
                                          onClick={() => setPendingTeammateAction({ kind: 'remove', memberId: member.id, memberName: member.fullName })}
                                          disabled={!activeChannel || removingMemberId === member.id}
                                          className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
                                       >
                                          {removingMemberId === member.id ? 'Removing...' : 'Remove'}
                                       </button>
                                    ) : null}
                                 </div>
                              </div>
                           );
                        }) : <div className="text-sm text-zinc-500">Select a channel to inspect its members.</div>}
                     </div>
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                     <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                        <ShieldPlus className="h-3.5 w-3.5" /> Primary Owner
                     </div>
                     <p className="mt-2 text-xs text-zinc-500">Set the accountable IT owner for this conversation. Routing can still add backups, but this keeps one explicit owner on record.</p>
                     <select
                        value={selectedOwnerId ?? ''}
                        onChange={(event) => setSelectedOwnerId(event.target.value || null)}
                        disabled={!activeChannel || ownerCandidates.length === 0 || isActiveChannelClosed}
                        className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:bg-zinc-100"
                     >
                        <option value="">{ownerCandidates.length === 0 ? 'No IT owners in this chat' : 'Select primary owner'}</option>
                        {ownerCandidates.map((member) => (
                           <option key={member.id} value={member.id}>{member.fullName} ({member.role})</option>
                        ))}
                     </select>
                     <button
                        type="button"
                        onClick={() => void handleTransferOwner()}
                        disabled={!activeChannel || !selectedOwnerId || selectedOwnerId === activeChannel?.primaryOwner?.id || transferringOwner || isActiveChannelClosed}
                        className="mt-3 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
                     >
                        {transferringOwner ? 'Updating owner...' : 'Set Primary Owner'}
                     </button>
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                     <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                        <ShieldPlus className="h-3.5 w-3.5" /> Backup Owner
                     </div>
                     <p className="mt-2 text-xs text-zinc-500">Keep one secondary IT owner ready to step in when the primary owner is busy or out of office.</p>
                     <select
                        value={selectedBackupOwnerId ?? ''}
                        onChange={(event) => setSelectedBackupOwnerId(event.target.value || null)}
                        disabled={!activeChannel || backupOwnerCandidates.length === 0 || isActiveChannelClosed}
                        className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:bg-zinc-100"
                     >
                        <option value="">{backupOwnerCandidates.length === 0 ? 'No backup owner candidates' : 'Select backup owner'}</option>
                        {backupOwnerCandidates.map((member) => (
                           <option key={member.id} value={member.id}>{member.fullName} ({member.role})</option>
                        ))}
                     </select>
                     <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                           type="button"
                           onClick={() => void handleBackupOwnerUpdate()}
                           disabled={!activeChannel || transferringOwner || selectedBackupOwnerId === (activeChannel?.backupOwner?.id ?? null) || isActiveChannelClosed}
                           className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
                        >
                           {transferringOwner ? 'Updating...' : 'Set Backup'}
                        </button>
                        <button
                           type="button"
                           onClick={() => {
                              setSelectedBackupOwnerId(null);
                              void handleBackupOwnerUpdate(null);
                           }}
                           disabled={!activeChannel || !activeChannel.backupOwner || transferringOwner || isActiveChannelClosed}
                           className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
                        >
                           Clear
                        </button>
                     </div>
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-white p-4">
                     <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                        <ShieldPlus className="h-3.5 w-3.5" /> Add Backup Owner
                     </div>
                     <p className="mt-2 text-xs text-zinc-500">Pull another IT teammate into this conversation when the first routed owner needs help, then remove the previous backup if needed.</p>
                     <select
                        value={selectedTeammateId}
                        onChange={(event) => setSelectedTeammateId(event.target.value)}
                        disabled={!activeChannel || loadingTeammates || availableTeammates.length === 0 || isActiveChannelClosed}
                        className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:bg-zinc-100"
                     >
                        <option value="">{loadingTeammates ? 'Loading teammates...' : availableTeammates.length === 0 ? 'No more teammates available' : 'Select IT teammate'}</option>
                        {availableTeammates.map((member) => (
                           <option key={member.id} value={member.id}>{member.fullName} ({member.role})</option>
                        ))}
                     </select>
                     <button
                        type="button"
                        onClick={openAddTeammateDialog}
                        disabled={!activeChannel || !selectedTeammateId || addingTeammate || isActiveChannelClosed}
                        className="mt-3 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
                     >
                        {addingTeammate ? 'Adding...' : 'Add Teammate'}
                     </button>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                     <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-rose-700">
                        <Trash2 className="h-3.5 w-3.5" /> Close Channel
                     </div>
                     <p className="mt-2 text-xs text-rose-700/80">Closing a chat converts it into a ticket automatically and keeps the ticket number linked for follow-up.</p>
                     <button
                        type="button"
                        onClick={handleCloseChannel}
                        disabled={!activeChannel || !canCloseActiveChannel || closingChannel}
                        className="mt-3 w-full rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60"
                     >
                        {closingChannel ? 'Closing...' : 'Close Chat'}
                     </button>
                     {canReopenActiveChannel ? (
                        <button
                           type="button"
                           onClick={() => void handleReopenChannel()}
                           disabled={!activeChannel || !canReopenActiveChannel || closingChannel}
                           className="mt-3 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
                        >
                           {closingChannel ? 'Updating...' : 'Reopen Chat'}
                        </button>
                     ) : null}
                  </div>
               </div>
            </aside>
         ) : null}

         {closeDialogOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-4">
               <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
                  <div className="text-lg font-bold text-zinc-900">Close ticket and chat?</div>
                  <p className="mt-2 text-sm text-zinc-600">Closing this chat will keep the conversation history and convert it into a linked ticket for follow-up.</p>
                  <div className="mt-6 flex justify-end gap-3">
                     <button type="button" onClick={() => setCloseDialogOpen(false)} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-100">Cancel</button>
                     <button type="button" onClick={() => void handleConfirmCloseChannel()} disabled={closingChannel} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60">{closingChannel ? 'Closing...' : 'Close Now'}</button>
                  </div>
               </div>
            </div>
         ) : null}

         {closeResult ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-4">
               <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
                  <div className="text-lg font-bold text-zinc-900">Ticket closed</div>
                  <p className="mt-2 text-sm text-zinc-600">{closeResult.ticketNumber ? `Follow-up is now tracked under ${closeResult.ticketNumber}. Thanks.` : 'The chat is closed. Thanks.'}</p>
                  <div className="mt-6 flex justify-end">
                     <button type="button" onClick={() => {
                        setCloseResult(null);
                        if (isEmployee) {
                           handleStartFreshChat();
                        }
                     }} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800">Okay</button>
                  </div>
               </div>
            </div>
         ) : null}

         <ConfirmDialog
            open={Boolean(pendingTeammateAction)}
            title={pendingTeammateAction?.kind === 'remove' ? 'Remove Teammate' : 'Add Teammate'}
            message={pendingTeammateAction ? `${pendingTeammateAction.kind === 'remove' ? 'Remove' : 'Add'} ${pendingTeammateAction.memberName} ${pendingTeammateAction.kind === 'remove' ? 'from' : 'to'} this chat?` : 'Confirm teammate change.'}
            confirmLabel={pendingTeammateAction?.kind === 'remove' ? 'Remove' : 'Add'}
            tone={pendingTeammateAction?.kind === 'remove' ? 'danger' : 'default'}
            busy={Boolean((pendingTeammateAction?.kind === 'remove' && removingMemberId === pendingTeammateAction.memberId) || (pendingTeammateAction?.kind === 'add' && addingTeammate))}
            onClose={() => setPendingTeammateAction(null)}
            onConfirm={handleConfirmTeammateAction}
         />
      </div>
   );
}
