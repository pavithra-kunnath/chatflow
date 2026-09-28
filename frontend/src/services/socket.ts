import { io, Socket } from 'socket.io-client';
import { Message, UserPresencePayload, UserTypingPayload, MessageStatusPayload } from '../types';

export type SocketConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'offline';

const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'http://localhost:5000';

let socket: Socket | null = null;
let currentUserId: string | null = null;
let activeConversationId: string | null = null;
let connectionState: SocketConnectionState = 'offline';

let messageListener: ((message: Message) => void) | null = null;
let presenceListeners: Array<(presence: UserPresencePayload) => void> = [];
let typingListeners: Array<(data: UserTypingPayload) => void> = [];
let messageStatusListeners: Array<(status: MessageStatusPayload) => void> = [];
let connectionStateListeners: Array<(state: SocketConnectionState) => void> = [];

const setConnectionState = (state: SocketConnectionState) => {
  if (connectionState !== state) {
    connectionState = state;
    connectionStateListeners.forEach((fn) => {
      try {
        fn(state);
      } catch (e) {
        console.error('[Socket Client] Error in connection state listener:', e);
      }
    });
  }
};

/**
 * Returns current connection state
 */
export const getSocketConnectionState = (): SocketConnectionState => {
  if (!socket) return 'offline';
  if (socket.connected) return 'connected';
  return connectionState;
};

/**
 * Registers a listener for connection state changes (connected, connecting, reconnecting, offline)
 */
export const onSocketConnectionChange = (callback: (state: SocketConnectionState) => void): void => {
  if (!connectionStateListeners.includes(callback)) {
    connectionStateListeners.push(callback);
  }
  callback(getSocketConnectionState());
};

/**
 * Removes a connection state change listener
 */
export const removeSocketConnectionChangeListener = (callback?: (state: SocketConnectionState) => void): void => {
  if (callback) {
    connectionStateListeners = connectionStateListeners.filter((fn) => fn !== callback);
  } else {
    connectionStateListeners = [];
  }
};

/**
 * Returns the singleton Socket instance, creating it if needed.
 */
export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });

    // Reconnection listener
    socket.on('connect', () => {
      console.log(`[Socket Client] Connected with ID: ${socket?.id}`);
      setConnectionState('connected');

      // Auto-re-identify user on connect or reconnect
      if (currentUserId && socket) {
        identifyUser(currentUserId);
      }

      // Auto-re-join active room if user was inside a conversation
      if (activeConversationId && socket) {
        socket.emit('join_conversation', { conversationId: activeConversationId });
      }
    });

    socket.on('connect_error', (error) => {
      console.warn('[Socket Client] Connection error:', error.message);
      setConnectionState('reconnecting');
    });

    socket.io.on('reconnect_attempt', () => {
      setConnectionState('reconnecting');
    });

    socket.io.on('reconnect_failed', () => {
      setConnectionState('offline');
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket Client] Disconnected: ${reason}`);
      if (reason === 'io client disconnect') {
        setConnectionState('offline');
      } else {
        setConnectionState('reconnecting');
      }
    });

    // Internal global dispatcher for user_presence
    socket.on('user_presence', (data: UserPresencePayload) => {
      presenceListeners.forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          console.error('[Socket Client] Error in presence listener:', e);
        }
      });
    });

    // Internal global dispatcher for user_typing
    socket.on('user_typing', (data: UserTypingPayload) => {
      typingListeners.forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          console.error('[Socket Client] Error in typing listener:', e);
        }
      });
    });

    // Internal global dispatcher for message_status
    socket.on('message_status', (data: MessageStatusPayload) => {
      messageStatusListeners.forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          console.error('[Socket Client] Error in message_status listener:', e);
        }
      });
    });
  }

  return socket;
};

/**
 * Connects the socket and optionally identifies the user.
 */
export const connectSocket = (userId?: string): Socket => {
  const s = getSocket();
  if (userId) {
    currentUserId = userId;
  }

  if (!s.connected) {
    setConnectionState('connecting');
    s.connect();
  } else if (userId) {
    identifyUser(userId);
  }

  return s;
};

/**
 * Disconnects the socket cleanly (e.g. on logout).
 */
export const disconnectSocket = (): void => {
  setConnectionState('offline');
  currentUserId = null;
  activeConversationId = null;
  removeNewMessageListener();
  typingListeners = [];
  presenceListeners = [];
  messageStatusListeners = [];
  connectionStateListeners = [];

  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

/**
 * Emits the 'identify' event to associate the socket with a user.
 */
export const identifyUser = (userId: string): Promise<boolean> => {
  return new Promise((resolve) => {
    currentUserId = userId;
    const s = getSocket();

    if (!s.connected) {
      s.connect();
    }

    s.emit('identify', { userId }, (response: any) => {
      if (response && response.success) {
        console.log(`[Socket Client] Successfully identified as ${userId}`);
        resolve(true);
      } else {
        console.warn(`[Socket Client] Identification failed:`, response?.message);
        resolve(false);
      }
    });
  });
};

/**
 * Joins a private conversation room.
 */
export const joinConversation = (conversationId: string): Promise<boolean> => {
  return new Promise((resolve) => {
    activeConversationId = conversationId;
    const s = getSocket();

    if (!s.connected) {
      s.connect();
    }

    s.emit('join_conversation', { conversationId }, (response: any) => {
      if (response && response.success) {
        console.log(`[Socket Client] Joined room: ${conversationId}`);
        resolve(true);
      } else {
        console.warn(`[Socket Client] Failed to join room:`, response?.message);
        resolve(false);
      }
    });
  });
};

/**
 * Leaves a private conversation room.
 */
export const leaveConversation = (conversationId: string): void => {
  if (activeConversationId === conversationId) {
    activeConversationId = null;
  }

  if (socket && socket.connected) {
    socket.emit('leave_conversation', { conversationId });
  }
};

/**
 * Emits 'send_message' over Socket.io and returns the persisted message.
 */
export const sendSocketMessage = (payload: {
  senderId: string;
  receiverId: string;
  conversationId: string;
  content: string;
}): Promise<Message> => {
  return new Promise((resolve, reject) => {
    const s = getSocket();

    if (!s.connected) {
      return reject(new Error('Unable to send message. Reconnecting to server...'));
    }

    const timer = setTimeout(() => {
      reject(new Error('Message could not be sent. Please check your connection and try again.'));
    }, 10000);

    s.emit('send_message', payload, (response: any) => {
      clearTimeout(timer);
      if (response && response.success && response.data?.message) {
        resolve(response.data.message);
      } else {
        const errMsg = response?.message || 'Message could not be sent. Please try again.';
        reject(new Error(errMsg));
      }
    });
  });
};

/**
 * Registers a listener for 'new_message' events.
 */
export const onNewMessage = (callback: (message: Message) => void): void => {
  const s = getSocket();
  if (messageListener) {
    s.off('new_message', messageListener);
  }

  messageListener = callback;
  s.on('new_message', messageListener);
};

/**
 * Removes the 'new_message' event listener.
 */
export const removeNewMessageListener = (): void => {
  if (socket && messageListener) {
    socket.off('new_message', messageListener);
    messageListener = null;
  }
};

/**
 * Registers a listener for real-time user presence updates.
 */
export const onUserPresence = (
  callback: (presence: UserPresencePayload) => void
): void => {
  getSocket(); // Ensure socket is initialized with internal presence listener
  if (!presenceListeners.includes(callback)) {
    presenceListeners.push(callback);
  }
};

/**
 * Removes a user presence listener.
 */
export const removeUserPresenceListener = (
  callback?: (presence: UserPresencePayload) => void
): void => {
  if (callback) {
    presenceListeners = presenceListeners.filter((fn) => fn !== callback);
  } else {
    presenceListeners = [];
  }
};

/**
 * Emits typing_start event for a conversation.
 */
export const startTyping = (conversationId: string, userId: string): void => {
  try {
    const s = getSocket();
    if (s && s.connected) {
      s.emit('typing_start', { conversationId, userId });
    }
  } catch (err) {
    console.warn('[Socket] Could not emit typing_start:', err);
  }
};

/**
 * Emits typing_stop event for a conversation.
 */
export const stopTyping = (conversationId: string, userId: string): void => {
  try {
    const s = getSocket();
    if (s && s.connected) {
      s.emit('typing_stop', { conversationId, userId });
    }
  } catch (err) {
    console.warn('[Socket] Could not emit typing_stop:', err);
  }
};

/**
 * Registers a listener for user typing events in the active conversation room.
 */
export const onUserTyping = (
  callback: (data: UserTypingPayload) => void
): void => {
  getSocket();
  if (!typingListeners.includes(callback)) {
    typingListeners.push(callback);
  }
};

/**
 * Removes user typing listener.
 */
export const removeUserTypingListener = (
  callback?: (data: UserTypingPayload) => void
): void => {
  if (callback) {
    typingListeners = typingListeners.filter((fn) => fn !== callback);
  } else {
    typingListeners = [];
  }
};

/**
 * Emits 'message_delivered' to inform server that recipient received the message.
 */
export const markMessageDelivered = (
  messageId: string,
  receiverId: string
): void => {
  try {
    const s = getSocket();
    if (s && s.connected) {
      s.emit('message_delivered', { messageId, receiverId });
    }
  } catch (err) {
    console.warn('[Socket] Could not emit message_delivered:', err);
  }
};

/**
 * Registers a listener for 'message_status' events.
 */
export const onMessageStatus = (
  callback: (status: MessageStatusPayload) => void
): void => {
  getSocket();
  if (!messageStatusListeners.includes(callback)) {
    messageStatusListeners.push(callback);
  }
};

/**
 * Removes a 'message_status' listener.
 */
export const removeMessageStatusListener = (
  callback?: (status: MessageStatusPayload) => void
): void => {
  if (callback) {
    messageStatusListeners = messageStatusListeners.filter((fn) => fn !== callback);
  } else {
    messageStatusListeners = [];
  }
};

/**
 * Emits 'message_read' to inform server that recipient has read the message.
 */
export const markMessageRead = (
  messageId: string,
  readerId: string
): void => {
  try {
    const s = getSocket();
    if (s && s.connected) {
      s.emit('message_read', { messageId, readerId });
    }
  } catch (err) {
    console.warn('[Socket] Could not emit message_read:', err);
  }
};
