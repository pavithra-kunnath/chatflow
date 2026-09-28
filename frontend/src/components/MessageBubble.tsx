import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Message } from '../types';
import { formatMessageTime } from '../utils/date';

interface MessageBubbleProps {
  message: Message;
  isCurrentUser: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isCurrentUser }) => {
  const formattedTime = formatMessageTime(message.createdAt);

  return (
    <View
      style={[
        styles.container,
        isCurrentUser ? styles.containerRight : styles.containerLeft,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isCurrentUser ? styles.bubbleOutgoing : styles.bubbleIncoming,
        ]}
      >
        <Text
          style={[
            styles.messageText,
            isCurrentUser ? styles.textOutgoing : styles.textIncoming,
          ]}
          selectable
        >
          {message.content}
        </Text>

        <View style={styles.metaRow}>
          <Text
            style={[
              styles.timeText,
              isCurrentUser ? styles.timeOutgoing : styles.timeIncoming,
            ]}
          >
            {formattedTime}
          </Text>
          {isCurrentUser && (
            <Text
              style={[
                styles.statusIndicator,
                message.status === 'read' && styles.statusRead,
              ]}
              accessibilityLabel={`Status: ${message.status}`}
            >
              {message.status === 'read' ? '✓✓' : message.status === 'delivered' ? '✓✓' : '✓'}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 3,
    paddingHorizontal: 14,
    flexDirection: 'row',
  },
  containerRight: {
    justifyContent: 'flex-end',
  },
  containerLeft: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1.5,
    elevation: 1,
  },
  bubbleOutgoing: {
    backgroundColor: '#4f46e5',
    borderBottomRightRadius: 4,
  },
  bubbleIncoming: {
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    flexWrap: 'wrap',
  },
  textOutgoing: {
    color: '#ffffff',
  },
  textIncoming: {
    color: '#0f172a',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  timeText: {
    fontSize: 11,
    fontWeight: '400',
  },
  timeOutgoing: {
    color: 'rgba(255, 255, 255, 0.75)',
  },
  timeIncoming: {
    color: '#94a3b8',
  },
  statusIndicator: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.75)',
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  statusRead: {
    color: '#67e8f9',
  },
});

