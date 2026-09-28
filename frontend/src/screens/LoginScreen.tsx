import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { createOrGetUser } from '../services/api';
import { saveUser } from '../utils/storage';

type LoginScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Login'>;

interface LoginScreenProps {
  navigation: LoginScreenNavigationProp;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      setErrorMessage('Please enter a username');
      return;
    }
    if (trimmed.length < 2) {
      setErrorMessage('Username must be at least 2 characters');
      return;
    }
    if (trimmed.length > 30) {
      setErrorMessage('Username cannot exceed 30 characters');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const user = await createOrGetUser(trimmed);

      // Persist user in AsyncStorage
      await saveUser({
        id: user.id,
        username: user.username,
        avatar: user.avatar,
      });

      navigation.replace('Home');
    } catch (err: any) {
      // User-friendly error message, no raw backend traces
      setErrorMessage(err?.message || 'Unable to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Text style={styles.iconText}>💬</Text>
            </View>
            <Text style={styles.title}>ChatFlow</Text>
            <Text style={styles.tagline}>
              Real-time conversations,{'\n'}made simple.
            </Text>
          </View>

          {/* Form Card */}
          <View style={styles.formCard}>
            <Text style={styles.inputLabel}>Choose your username</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter username"
              placeholderTextColor="#94a3b8"
              value={username}
              onChangeText={(text) => {
                setUsername(text);
                if (errorMessage) setErrorMessage(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              accessibilityLabel="Username input"
              accessibilityHint="Enter a unique username between 2 and 30 characters"
            />

            {errorMessage ? (
              <View style={styles.errorContainer} accessibilityRole="alert">
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.submitButton,
                (!username.trim() || loading) && styles.submitButtonDisabled,
              ]}
              onPress={handleLogin}
              disabled={!username.trim() || loading}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Continue to conversations"
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.footerNote}>
            No password required • Instant username access
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#312e81',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 30,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  formCard: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#cbd5e1',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#334155',
  },
  errorContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  submitButtonDisabled: {
    backgroundColor: '#475569',
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  footerNote: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
  },
});
