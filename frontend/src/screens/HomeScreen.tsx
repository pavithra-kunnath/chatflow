import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, User, SavedUser, UserPresencePayload } from '../types';
import { getUsers } from '../services/api';
import { getSavedUser, clearUser } from '../utils/storage';
import {
  getSocket,
  connectSocket,
  identifyUser,
  disconnectSocket,
  onUserPresence,
  removeUserPresenceListener,
  onSocketConnectionChange,
  removeSocketConnectionChangeListener,
  SocketConnectionState,
} from '../services/socket';
import { UserListItem } from '../components/UserListItem';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

interface HomeScreenProps {
  navigation: HomeScreenNavigationProp;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const [currentUser, setCurrentUser] = useState<SavedUser | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<SocketConnectionState>('offline');

  const fetchUsers = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const saved = await getSavedUser();
      if (!saved) {
        navigation.replace('Login');
        return;
      }
      setCurrentUser(saved);

      // Ensure socket is connected and identified
      connectSocket(saved.id);
      identifyUser(saved.id);

      const allUsers = await getUsers();
      // Filter out current user from the list
      const otherUsers = allUsers.filter((u) => u.id !== saved.id);
      setUsers(otherUsers);
    } catch (err: any) {
      setError(err?.message || 'Unable to load users. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigation]);

  useEffect(() => {
    fetchUsers();

    // Connection state listener to display real-time status and handle auto-reconnect
    const handleConnChange = (state: SocketConnectionState) => {
      setConnectionState(state);
      if (state === 'connected') {
        fetchUsers(true);
      }
    };
    onSocketConnectionChange(handleConnChange);

    // Real-time presence listener to update user online status instantly without refresh
    const handlePresence = (presence: UserPresencePayload) => {
      setUsers((prevUsers) =>
        prevUsers.map((u) =>
          u.id === presence.userId
            ? {
                ...u,
                isOnline: presence.isOnline,
                lastSeen: presence.lastSeen !== undefined ? presence.lastSeen : u.lastSeen,
              }
            : u
        )
      );
    };

    onUserPresence(handlePresence);

    return () => {
      removeSocketConnectionChangeListener(handleConnChange);
      removeUserPresenceListener(handlePresence);
    };
  }, [fetchUsers]);

  // Local client-side search filter
  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return users;
    return users.filter((u) => u.username.toLowerCase().includes(query));
  }, [users, searchQuery]);

  // Logout handler
  const handleLogout = async () => {
    try {
      disconnectSocket();
      await clearUser();
      navigation.replace('Login');
    } catch (e) {
      console.error('Logout error', e);
      navigation.replace('Login');
    }
  };

  const handleSelectUser = (selectedUser: User) => {
    navigation.navigate('Chat', { recipient: selectedUser });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Top Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.titleRow}>
              <Text style={styles.headerTitle}>ChatFlow</Text>
              <View style={styles.connectionBadge}>
                <View
                  style={[
                    styles.connectionDot,
                    connectionState === 'connected'
                      ? styles.connDotConnected
                      : connectionState === 'reconnecting'
                      ? styles.connDotReconnecting
                      : styles.connDotOffline,
                  ]}
                />
                <Text style={styles.connectionText}>
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

            {currentUser && (
              <View style={styles.userBadgeRow}>
                <View style={styles.headerAvatar}>
                  <Text style={styles.headerAvatarText}>
                    {(currentUser.username || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.userBadge}>
                  Logged in as <Text style={styles.userBadgeName}>{currentUser.username}</Text>
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Text style={styles.logoutButtonText}>Log out</Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchWrapper}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search users..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            accessibilityLabel="Search users by username"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.clearBtn}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Content State: Loading, Error, Empty, List */}
        {loading && !refreshing ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color="#4f46e5" />
            <Text style={styles.stateText}>Loading users...</Text>
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>Unable to load users.</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => fetchUsers()}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Retry loading users"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : users.length === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>No users available</Text>
            <Text style={styles.emptySubtitle}>
              When other users register, they will appear here.
            </Text>
          </View>
        ) : filteredUsers.length === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyTitle}>No users found</Text>
            <Text style={styles.emptySubtitle}>Try another username.</Text>
          </View>
        ) : (
          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <UserListItem user={item} onPress={handleSelectUser} />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => fetchUsers(true)}
                tintColor="#4f46e5"
                colors={['#4f46e5']}
              />
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 4,
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.5,
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 5,
  },
  connectionDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  connDotConnected: {
    backgroundColor: '#10b981',
  },
  connDotReconnecting: {
    backgroundColor: '#f59e0b',
  },
  connDotOffline: {
    backgroundColor: '#94a3b8',
  },
  connectionText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  userBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  headerAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338ca',
  },
  userBadge: {
    fontSize: 13,
    color: '#64748b',
  },
  userBadgeName: {
    fontWeight: '700',
    color: '#4f46e5',
  },
  logoutButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  logoutButtonText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '700',
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
    height: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  searchIcon: {
    fontSize: 15,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
    paddingVertical: 8,
  },
  clearBtn: {
    padding: 6,
  },
  clearBtnText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 24,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  stateText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  errorIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 15,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '500',
  },
  retryButton: {
    backgroundColor: '#4f46e5',
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 8,
    shadowColor: '#4f46e5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyIcon: {
    fontSize: 42,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
});
