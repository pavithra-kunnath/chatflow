import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  RootStackParamList,
  Message,
  SavedUser,
  UserPresencePayload,
  UserTypingPayload,
  MessageStatusPayload,
} from '../types';
import { getConversationMessages } from '../services/api';
import { getSavedUser } from '../utils/storage';
import { createConversationId } from '../utils/conversation';
import { formatLastSeen } from '../utils/date';
import {
  getSocket,
  connectSocket,
  identifyUser,
  joinConversation,
  leaveConversation,
  onNewMessage,
  removeNewMessageListener,
  sendSocketMessage,
  onUserPresence,
  removeUserPresenceListener,
  startTyping,
  stopTyping,
  onUserTyping,
  removeUserTypingListener,
  markMessageDelivered,
  markMessageRead,
  onMessageStatus,
  removeMessageStatusListener,
  onSocketConnectionChange,
  removeSocketConnectionChangeListener,
  SocketConnectionState,
} from '../services/socket';
import { MessageBubble } from '../components/MessageBubble';
import { MessageInput } from '../components/MessageInput';

type ChatScreenProps = NativeStackScreenProps<RootStackParamList, 'Chat'>;

export const ChatScreen: React.FC<ChatScreenProps> = ({ route, navigation }) => {
  const { recipient } = route.params;
  const [currentUser, setCurrentUser] = useState<SavedUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<SocketConnectionState>('offline');
  const [sendError, setSendError] = useState<string | null>(null);

  // Recipient presence state (online / lastSeen)
  const [recipientPresence, setRecipientPresence] = useState<{
    isOnline: boolean;
    lastSeen?: string | null;
  }>({
    isOnline: recipient.isOnline,
    lastSeen: recipient.lastSeen,
  });

  // Typing indicator state
  const [isRecipientTyping, setIsRecipientTyping] = useState<boolean>(false);

  const flatListRef = useRef<FlatList<Message>>(null);
  const conversationIdRef = useRef<string>('');
  const currentUserRef = useRef<SavedUser | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to bottom helper
  const scrollToBottom = (animated = true) => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated });
    }, 100);
  };

  // Handle incoming real-time messages from Socket.io
  const handleIncomingMessage = useCallback((incomingMessage: Message) => {
    if (incomingMessage.conversationId !== conversationIdRef.current) {
      return;
    }

    // If message is from recipient, clear typing indicator immediately
    if (incomingMessage.senderId === recipient.id) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      setIsRecipientTyping(false);
    }

    // If current user is the receiver, acknowledge delivery and read to server (actively viewing chat)
    if (currentUserRef.current && incomingMessage.receiverId === currentUserRef.current.id) {
      markMessageDelivered(incomingMessage.id, currentUserRef.current.id);
      markMessageRead(incomingMessage.id, currentUserRef.current.id);
    }

    setMessages((prev) => {
      if (prev.some((m) => m.id === incomingMessage.id)) {
        return prev;
      }
      return [...prev, incomingMessage];
    });

    scrollToBottom(true);
  }, [recipient.id]);

  // Fetch initial messages from REST API and setup Socket room & listeners
  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const saved = await getSavedUser();
      if (!saved) {
        navigation.replace('Login');
        return;
      }
      setCurrentUser(saved);
      currentUserRef.current = saved;

      const convId = createConversationId(saved.id, recipient.id);
      conversationIdRef.current = convId;

      // 1. Fetch persistent history from REST
      const history = await getConversationMessages(convId, saved.id);
      setMessages(history);

      // 2. Setup Socket.io real-time connection and join room
      connectSocket(saved.id);

      await identifyUser(saved.id);
      await joinConversation(convId);

      // Mark unread incoming messages as read since they are being viewed
      history.forEach((m) => {
        if (m.receiverId === saved.id && (m.status === 'sent' || m.status === 'delivered')) {
          markMessageRead(m.id, saved.id);
        }
      });

      // Register real-time message listener
      onNewMessage(handleIncomingMessage);
    } catch (err: any) {
      setError(err?.message || 'Unable to load messages. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [recipient.id, navigation, handleIncomingMessage]);

  useEffect(() => {
    fetchMessages();

    // Socket connection status listener
    const handleConnChange = (state: SocketConnectionState) => {
      setConnectionState(state);
      if (state !== 'connected') {
        setIsRecipientTyping(false);
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
      }
    };
    onSocketConnectionChange(handleConnChange);

    // Real-time recipient presence listener
    const handlePresence = (presence: UserPresencePayload) => {
      if (presence.userId === recipient.id) {
        setRecipientPresence((prev) => ({
          isOnline: presence.isOnline,
          lastSeen: presence.lastSeen !== undefined ? presence.lastSeen : prev.lastSeen,
        }));
        if (!presence.isOnline) {
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = null;
          }
          setIsRecipientTyping(false);
        }
      }
    };
    onUserPresence(handlePresence);

    // Real-time typing indicator listener scoped to this conversation
    const handleTyping = (data: UserTypingPayload) => {
      if (data.conversationId === conversationIdRef.current && data.userId === recipient.id) {
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }

        setIsRecipientTyping(data.isTyping);

        if (data.isTyping) {
          scrollToBottom(true);
          // Safety timeout: auto-stop typing indicator after 3.5s if stop event is delayed
          typingTimeoutRef.current = setTimeout(() => {
            setIsRecipientTyping(false);
          }, 3500);
        }
      }
    };
    onUserTyping(handleTyping);

    // Real-time message status listener (sent -> delivered -> read)
    const handleStatus = (data: MessageStatusPayload) => {
      if (!data || !data.messageId) return;
      if (data.conversationId && data.conversationId !== conversationIdRef.current) {
        return;
      }

      if (data.status === 'read') {
        setMessages((prevMessages) =>
          prevMessages.map((m) =>
            m.id === data.messageId
              ? {
                  ...m,
                  status: 'read',
                  readAt: data.readAt || m.readAt || new Date().toISOString(),
                }
              : m
          )
        );
      } else if (data.status === 'delivered') {
        setMessages((prevMessages) =>
          prevMessages.map((m) => {
            if (m.id !== data.messageId) return m;
            // Never downgrade from read to delivered
            if (m.status === 'read') return m;
            return {
              ...m,
              status: 'delivered',
              deliveredAt: data.deliveredAt || m.deliveredAt || new Date().toISOString(),
            };
          })
        );
      }
    };
    onMessageStatus(handleStatus);

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      removeSocketConnectionChangeListener(handleConnChange);
      removeNewMessageListener();
      removeUserPresenceListener(handlePresence);
      removeUserTypingListener(handleTyping);
      removeMessageStatusListener(handleStatus);

      if (conversationIdRef.current) {
        // Stop typing if we were typing
        if (currentUserRef.current) {
          stopTyping(conversationIdRef.current, currentUserRef.current.id);
        }
        leaveConversation(conversationIdRef.current);
      }
    };
  }, [fetchMessages, recipient.id]);

  // Local typing handler with debounce
  const handleTypingChange = (isTyping: boolean) => {
    if (!currentUser || !conversationIdRef.current) return;

    if (isTyping) {
      startTyping(conversationIdRef.current, currentUser.id);
    } else {
      stopTyping(conversationIdRef.current, currentUser.id);
    }
  };

  // Real-time send message handler over Socket.io
  const handleSend = async (content: string) => {
    if (!currentUser) return;
    setSendError(null);

    const socket = getSocket();
    if (!socket.connected) {
      const msg = 'Message could not be sent. Reconnecting...';
      setSendError(msg);
      socket.connect();
      throw new Error(msg);
    }

    try {
      const convId = conversationIdRef.current;

      // Ensure typing stops when message is sent
      stopTyping(convId, currentUser.id);

      const sentMessage = await sendSocketMessage({
        senderId: currentUser.id,
        receiverId: recipient.id,
        conversationId: convId,
        content,
      });

      // Add message if room broadcast has not yet processed
      setMessages((prev) => {
        if (prev.some((m) => m.id === sentMessage.id)) {
          return prev;
        }
        return [...prev, sentMessage];
      });

      scrollToBottom(true);
    } catch (err: any) {
      console.error('[Socket Send Error]', err);
      const msg = err?.message || 'Message could not be sent. Please try again.';
      setSendError(msg);
      throw err;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Custom Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back to conversations"
          >
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>

          <View style={styles.avatarWrapper}>
            <View style={styles.headerAvatar}>
              <Text style={styles.headerAvatarText}>
                {(recipient.username || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View
              style={[
                styles.statusDot,
                recipientPresence.isOnline ? styles.statusOnlineDot : styles.statusOfflineDot,
              ]}
            />
          </View>

          <View style={styles.headerInfo}>
            <Text style={styles.headerName} numberOfLines={1}>
              {recipient.username}
            </Text>
            <View style={styles.headerStatusRow}>
              {/* Recipient Presence Status or Typing */}
              {isRecipientTyping ? (
                <Text style={[styles.headerStatus, styles.statusTyping]}>
                  typing...
                </Text>
              ) : (
                <Text
                  style={[
                    styles.headerStatus,
                    recipientPresence.isOnline ? styles.statusOnline : styles.statusOffline,
                  ]}
                  numberOfLines={1}
                >
                  {recipientPresence.isOnline
                    ? 'Online'
                    : formatLastSeen(recipientPresence.lastSeen)}
                </Text>
              )}

              {/* Current User Socket Gateway Status */}
              <View style={styles.socketIndicator}>
                <View
                  style={[
                    styles.socketDot,
                    connectionState === 'connected'
                      ? styles.socketOnline
                      : connectionState === 'reconnecting'
                      ? styles.socketReconnecting
                      : styles.socketOffline,
                  ]}
                />
                <Text style={styles.socketText}>
                  {connectionState === 'connected'
                    ? 'Connected'
                    : connectionState === 'connecting'
                    ? 'Connecting...'
                    : connectionState === 'reconnecting'
                    ? 'Reconnecting...'
                    : 'Offline'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Send Error Notice */}
        {sendError && (
          <View style={styles.sendErrorBanner}>
            <Text style={styles.sendErrorText}>⚠️ {sendError}</Text>
            <TouchableOpacity
              onPress={() => setSendError(null)}
              style={styles.sendErrorDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
            >
              <Text style={styles.sendErrorDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Message Area */}
        <View style={styles.messagesContainer}>
          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color="#4f46e5" />
              <Text style={styles.stateText}>Loading messages...</Text>
            </View>
          ) : error && messages.length === 0 ? (
            <View style={styles.centerState}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>Unable to load messages.</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={fetchMessages}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Retry loading messages"
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.centerState}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySubtitle}>Start the conversation!</Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <MessageBubble
                  message={item}
                  isCurrentUser={currentUser?.id === item.senderId}
                />
              )}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => scrollToBottom(false)}
            />
          )}
        </View>

        {/* Typing Indicator Bar */}
        {isRecipientTyping && (
          <View style={styles.typingContainer}>
            <View style={styles.typingPulseDot} />
            <Text style={styles.typingText}>
              <Text style={styles.typingName}>{recipient.username}</Text> is typing...
            </Text>
          </View>
        )}

        {/* Message Input Component */}
        <MessageInput
          onSend={handleSend}
          onTypingChange={handleTypingChange}
          disabled={loading || !currentUser}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  keyboardContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
    maxWidth: 700,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 6,
  },
  backButtonText: {
    fontSize: 24,
    color: '#1e293b',
    fontWeight: '600',
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 10,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  statusOnlineDot: {
    backgroundColor: '#10b981',
  },
  statusOfflineDot: {
    backgroundColor: '#94a3b8',
  },
  headerAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4338ca',
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  headerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 8,
  },
  headerStatus: {
    fontSize: 12,
  },
  statusOnline: {
    color: '#10b981',
    fontWeight: '600',
  },
  statusOffline: {
    color: '#64748b',
  },
  statusTyping: {
    color: '#4f46e5',
    fontStyle: 'italic',
    fontWeight: '600',
  },
  socketIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  socketDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  socketOnline: {
    backgroundColor: '#10b981',
  },
  socketReconnecting: {
    backgroundColor: '#f59e0b',
  },
  socketOffline: {
    backgroundColor: '#94a3b8',
  },
  socketText: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '500',
  },
  sendErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fef2f2',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#fecaca',
  },
  sendErrorText: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  sendErrorDismiss: {
    padding: 4,
    marginLeft: 8,
  },
  sendErrorDismissText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  listContent: {
    paddingVertical: 12,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  stateText: {
    marginTop: 10,
    fontSize: 14,
    color: '#64748b',
  },
  errorIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 14,
  },
  retryButton: {
    backgroundColor: '#4f46e5',
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94a3b8',
  },
  typingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#f8fafc',
    gap: 6,
  },
  typingPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#6366f1',
  },
  typingText: {
    fontSize: 12,
    color: '#64748b',
    fontStyle: 'italic',
  },
  typingName: {
    fontWeight: '600',
    color: '#4338ca',
  },
});
