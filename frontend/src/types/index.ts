export interface HealthResponse {
  success: boolean;
  message: string;
}

export interface User {
  id: string;
  username: string;
  avatar?: string | null;
  isOnline: boolean;
  lastSeen?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  conversationId: string;
  content: string;
  status: MessageStatus;
  createdAt: string;
  updatedAt?: string;
  deliveredAt?: string | null;
  readAt?: string | null;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface SavedUser {
  id: string;
  username: string;
  avatar?: string | null;
}

export interface UserPresencePayload {
  userId: string;
  isOnline: boolean;
  lastSeen?: string | null;
}

export interface UserTypingPayload {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface MessageStatusPayload {
  messageId: string;
  conversationId: string;
  status: MessageStatus;
  deliveredAt?: string | null;
  readAt?: string | null;
}

export type RootStackParamList = {
  Splash: undefined;
  Login: undefined;
  Home: undefined;
  Chat: { recipient: User };
};
