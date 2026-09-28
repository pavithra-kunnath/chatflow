import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  TextInput,
  TouchableOpacity,
  Text,
  ActivityIndicator,
} from 'react-native';

interface MessageInputProps {
  onSend: (content: string) => Promise<void>;
  onTypingChange?: (isTyping: boolean) => void;
  disabled?: boolean;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSend,
  onTypingChange,
  disabled = false,
}) => {
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef<boolean>(false);

  const canSend = content.trim().length > 0 && !isSending && !disabled;

  // Cleanup typing timer on unmount
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
      if (isTypingRef.current && onTypingChange) {
        onTypingChange(false);
      }
    };
  }, [onTypingChange]);

  const handleTextChange = (text: string) => {
    setContent(text);

    if (!onTypingChange) return;

    if (text.trim().length > 0) {
      if (!isTypingRef.current) {
        isTypingRef.current = true;
        onTypingChange(true);
      }

      // Reset debounce timer to stop typing after 1 second of inactivity
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }

      typingTimerRef.current = setTimeout(() => {
        isTypingRef.current = false;
        onTypingChange(false);
      }, 1000);
    } else {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingChange(false);
      }
    }
  };

  const handleSend = async () => {
    if (!canSend) return;

    // Instantly stop typing indicator on send
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    if (isTypingRef.current && onTypingChange) {
      isTypingRef.current = false;
      onTypingChange(false);
    }

    const messageToSend = content.trim();
    setContent('');
    setIsSending(true);

    try {
      await onSend(messageToSend);
    } catch {
      // Restore input text if send failed
      setContent(messageToSend);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Type a message..."
        placeholderTextColor="#94a3b8"
        value={content}
        onChangeText={handleTextChange}
        multiline
        maxLength={2000}
        editable={!isSending && !disabled}
        accessibilityLabel="Message text input"
      />
      <TouchableOpacity
        style={[styles.sendButton, canSend ? styles.sendButtonActive : styles.sendButtonDisabled]}
        onPress={handleSend}
        disabled={!canSend}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Send message"
      >
        {isSending ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <Text style={styles.sendButtonText}>Send</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: '#0f172a',
    maxHeight: 120,
    minHeight: 42,
  },
  sendButton: {
    height: 42,
    paddingHorizontal: 18,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonActive: {
    backgroundColor: '#4f46e5',
    shadowColor: '#4f46e5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  },
  sendButtonDisabled: {
    backgroundColor: '#e2e8f0',
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
