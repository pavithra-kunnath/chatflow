/**
 * Generates a deterministic conversation ID for two users.
 * Both participants will always generate the exact same ID.
 */
export const createConversationId = (userId1: string, userId2: string): string => {
  return [userId1.toString(), userId2.toString()].sort().join('_');
};
