import AsyncStorage from '@react-native-async-storage/async-storage';
import { SavedUser } from '../types';

const USER_STORAGE_KEY = '@chatflow_user';

/**
 * Persists the logged-in user in AsyncStorage.
 * Only stores necessary fields (id, username, avatar). Never stores socketId.
 */
export const saveUser = async (user: SavedUser): Promise<void> => {
  try {
    const dataToSave = {
      id: user.id,
      username: user.username,
      avatar: user.avatar || null,
    };
    await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(dataToSave));
  } catch (error) {
    console.error('[Storage Error] Failed to save user:', error);
    throw error;
  }
};

/**
 * Retrieves the stored user from AsyncStorage.
 */
export const getSavedUser = async (): Promise<SavedUser | null> => {
  try {
    const data = await AsyncStorage.getItem(USER_STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.username) {
      console.warn('[Storage] Corrupted or incomplete user data found, clearing storage');
      await AsyncStorage.removeItem(USER_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('[Storage Error] Failed to parse saved user:', error);
    try {
      await AsyncStorage.removeItem(USER_STORAGE_KEY);
    } catch {}
    return null;
  }
};

/**
 * Clears the stored user from AsyncStorage (logout).
 */
export const clearUser = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(USER_STORAGE_KEY);
  } catch (error) {
    console.error('[Storage Error] Failed to clear user:', error);
    throw error;
  }
};
