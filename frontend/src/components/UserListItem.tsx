import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { User } from '../types';
import { formatLastSeen } from '../utils/date';

interface UserListItemProps {
  user: User;
  onPress: (user: User) => void;
}

export const UserListItem: React.FC<UserListItemProps> = ({ user, onPress }) => {
  const initial = (user.username || '?').charAt(0).toUpperCase();

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(user)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Chat with ${user.username}, ${user.isOnline ? 'Online' : 'Offline'}`}
    >
      {/* Avatar with Status Dot */}
      <View style={styles.avatarWrapper}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View
          style={[
            styles.statusDot,
            user.isOnline ? styles.statusOnline : styles.statusOffline,
          ]}
        />
      </View>

      {/* User Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.username} numberOfLines={1}>
          {user.username}
        </Text>
        <Text
          style={[
            styles.statusText,
            user.isOnline ? styles.onlineText : styles.offlineText,
          ]}
          numberOfLines={1}
        >
          {user.isOnline ? 'Online' : formatLastSeen(user.lastSeen)}
        </Text>
      </View>

      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4338ca',
  },
  statusDot: {
    width: 13,
    height: 13,
    borderRadius: 6.5,
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  statusOnline: {
    backgroundColor: '#10b981',
  },
  statusOffline: {
    backgroundColor: '#94a3b8',
  },
  infoContainer: {
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 3,
  },
  statusText: {
    fontSize: 13,
  },
  onlineText: {
    color: '#10b981',
    fontWeight: '600',
  },
  offlineText: {
    color: '#64748b',
    fontWeight: '400',
  },
  chevron: {
    fontSize: 22,
    fontWeight: '300',
    color: '#94a3b8',
    marginLeft: 8,
  },
});

