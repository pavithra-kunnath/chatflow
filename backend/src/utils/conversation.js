/**
 * Generates a deterministic conversation ID for two users.
 * Both participants will always generate the exact same conversation ID.
 *
 * @param {string|mongoose.Types.ObjectId} userId1
 * @param {string|mongoose.Types.ObjectId} userId2
 * @returns {string} e.g. "60d0fe4f5311236168a109ca_60d0fe4f5311236168a109cb"
 */
function createConversationId(userId1, userId2) {
  if (!userId1 || !userId2) {
    throw new Error('Both userId1 and userId2 are required to create a conversation ID');
  }
  return [userId1.toString(), userId2.toString()].sort().join('_');
}

/**
 * Validates whether a conversation ID matches the expected format of two 24-character hexadecimal IDs.
 *
 * @param {string} conversationId
 * @returns {boolean}
 */
function isValidConversationId(conversationId) {
  if (typeof conversationId !== 'string') return false;
  const parts = conversationId.split('_');
  if (parts.length !== 2) return false;
  const objectIdPattern = /^[0-9a-fA-F]{24}$/;
  return objectIdPattern.test(parts[0]) && objectIdPattern.test(parts[1]);
}

/**
 * Extracts participant user IDs from a conversation ID.
 *
 * @param {string} conversationId
 * @returns {string[]|null}
 */
function getParticipantsFromConversationId(conversationId) {
  if (!isValidConversationId(conversationId)) return null;
  return conversationId.split('_');
}

module.exports = {
  createConversationId,
  isValidConversationId,
  getParticipantsFromConversationId,
};
