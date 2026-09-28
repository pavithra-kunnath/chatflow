import React, { useEffect } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getSavedUser } from '../utils/storage';

type SplashScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Splash'>;

interface SplashScreenProps {
  navigation: SplashScreenNavigationProp;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ navigation }) => {
  useEffect(() => {
    let isMounted = true;

    const checkAuth = async () => {
      // Small pause for smooth visual transition
      await new Promise((resolve) => setTimeout(resolve, 600));

      if (!isMounted) return;

      try {
        const savedUser = await getSavedUser();
        if (savedUser && savedUser.id && savedUser.username) {
          navigation.replace('Home');
        } else {
          navigation.replace('Login');
        }
      } catch (err) {
        console.warn('[Splash] Session validation failed:', err);
        navigation.replace('Login');
      }
    };

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoIcon}>💬</Text>
        </View>
        <Text style={styles.title}>ChatFlow</Text>
        <Text style={styles.tagline}>
          Real-time conversations,{'\n'}made simple.
        </Text>
      </View>
      <ActivityIndicator size="small" color="#6366f1" style={styles.loader} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#312e81',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  logoIcon: {
    fontSize: 34,
  },
  title: {
    fontSize: 38,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 16,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 24,
  },
  loader: {
    marginTop: 40,
  },
});
