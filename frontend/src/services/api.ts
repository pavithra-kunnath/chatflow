import axios from 'axios';
import { ApiResponse, User, Message, HealthResponse } from '../types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Maps HTTP and network errors to friendly user-facing messages.
 * Never exposes stack traces, raw Axios errors, or internal DB details.
 */
export const getErrorMessage = (
  error: any,
  fallbackMessage: string = 'Something went wrong. Please try again.'
): string => {
  if (!error) return fallbackMessage;

  // Timeout error
  if (
    error.code === 'ECONNABORTED' ||
    (typeof error.message === 'string' && error.message.toLowerCase().includes('timeout'))
  ) {
    return 'Request timed out. Please check your connection and try again.';
  }

  // Network offline / connection refused error
  if (
    error.isAxiosError && !error.response ||
    error.message === 'Network Error' ||
    error.code === 'ERR_NETWORK' ||
    error.code === 'ECONNREFUSED'
  ) {
    return 'Unable to connect to server. Please check your connection.';
  }

  // HTTP response status codes
  if (error.response) {
    const status = error.response.status;
    const serverMsg = error.response.data?.message;

    // Use clean server message if safe and non-technical
    if (
      typeof serverMsg === 'string' &&
      serverMsg.length > 0 &&
      !serverMsg.includes('E11000') &&
      !serverMsg.includes('CastError') &&
      !serverMsg.includes('ValidationError') &&
      !serverMsg.includes('Mongo') &&
      !serverMsg.includes('at ')
    ) {
      return serverMsg;
    }

    switch (status) {
      case 400:
        return 'Invalid request. Please try again.';
      case 401:
        return 'Session expired. Please log in again.';
      case 403:
        return 'Access denied. You do not have permission for this conversation.';
      case 404:
        return 'The requested resource was not found.';
      case 409:
        return 'Conflict detected. Please try again.';
      case 500:
      default:
        return 'Server error. Please try again later.';
    }
  }

  if (
    typeof error.message === 'string' &&
    error.message.length > 0 &&
    !error.message.includes('AxiosError') &&
    !error.message.includes('Network Error')
  ) {
    return error.message;
  }

  return fallbackMessage;
};

// Response interceptor to catch and sanitize all API errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const friendlyMessage = getErrorMessage(error);
    const sanitizedError = new Error(friendlyMessage);
    (sanitizedError as any).status = error.response?.status;
    return Promise.reject(sanitizedError);
  }
);

/**
 * Checks backend health
 */
export const checkHealth = async (): Promise<HealthResponse> => {
  const response = await apiClient.get<HealthResponse>('/health');
  return response.data;
};

/**
 * Registers or logs in a user by username
 */
export const createOrGetUser = async (username: string): Promise<User> => {
  const response = await apiClient.post<ApiResponse<{ user: User }>>('/users', {
    username: username.trim(),
  });

  if (!response.data.success || !response.data.data?.user) {
    throw new Error(response.data.message || 'Failed to authenticate user');
  }

  return response.data.data.user;
};

/**
 * Retrieves all registered users
 */
export const getUsers = async (): Promise<User[]> => {
  const response = await apiClient.get<ApiResponse<{ users: User[] }>>('/users');

  if (!response.data.success || !response.data.data?.users) {
    throw new Error(response.data.message || 'Failed to fetch users');
  }

  return response.data.data.users;
};

/**
 * Retrieves a user by their ID
 */
export const getUserById = async (id: string): Promise<User> => {
  const response = await apiClient.get<ApiResponse<{ user: User }>>(`/users/${id}`);

  if (!response.data.success || !response.data.data?.user) {
    throw new Error(response.data.message || 'User not found');
  }

  return response.data.data.user;
};

/**
 * Sends a new 1-on-1 message
 */
export const sendMessage = async (
  senderId: string,
  receiverId: string,
  content: string
): Promise<Message> => {
  const response = await apiClient.post<ApiResponse<{ message: Message }>>('/messages', {
    senderId,
    receiverId,
    content: content.trim(),
  });

  if (!response.data.success || !response.data.data?.message) {
    throw new Error(response.data.message || 'Failed to send message');
  }

  return response.data.data.message;
};

/**
 * Retrieves conversation message history (oldest to newest).
 * Passes userId in x-user-id header for conversation security.
 */
export const getConversationMessages = async (
  conversationId: string,
  userId: string
): Promise<Message[]> => {
  const response = await apiClient.get<ApiResponse<{ messages: Message[] }>>(
    `/messages/${conversationId}`,
    {
      headers: {
        'x-user-id': userId,
      },
      params: {
        userId,
      },
    }
  );

  if (!response.data.success || !response.data.data?.messages) {
    throw new Error(response.data.message || 'Failed to load conversation history');
  }

  return response.data.data.messages;
};
