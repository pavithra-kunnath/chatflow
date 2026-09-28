const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const {
  createConversationId,
  isValidConversationId,
  getParticipantsFromConversationId,
} = require('../utils/conversation');

/**
 * Creates and persists a new message in MongoDB.
 *
 * @param {Object} messageData - { senderId, receiverId, content }
 * @returns {Promise<Object>} Created and sanitized message document
 */
const createMessage = async ({ senderId, receiverId, content }) => {
  // 1. Verify IDs format
  if (!mongoose.Types.ObjectId.isValid(senderId)) {
    throw new ApiError(400, 'Invalid sender ID format');
  }
  if (!mongoose.Types.ObjectId.isValid(receiverId)) {
    throw new ApiError(400, 'Invalid receiver ID format');
  }

  // 2. Sender and receiver cannot be identical
  if (senderId.toString() === receiverId.toString()) {
    throw new ApiError(400, 'Sender and receiver cannot be identical');
  }

  // 3. Verify sender exists
  const sender = await User.findById(senderId);
  if (!sender) {
    throw new ApiError(404, 'Sender user not found');
  }

  // 4. Verify receiver exists
  const receiver = await User.findById(receiverId);
  if (!receiver) {
    throw new ApiError(404, 'Receiver user not found');
  }

  // 5. Generate deterministic conversation ID
  const conversationId = createConversationId(senderId, receiverId);

  // 6. Save message to MongoDB
  const message = await Message.create({
    senderId,
    receiverId,
    conversationId,
    content: content.trim(),
    status: 'sent',
  });

  return message;
};

/**
 * Retrieves conversation message history sorted chronologically (oldest to newest).
 * Enforces participant validation for security.
 *
 * @param {string} conversationId - e.g. "userIdA_userIdB"
 * @param {string} [requesterId] - Optional user ID of the person making the request
 * @returns {Promise<Array>} Chronological list of message documents
 */
const getConversationMessages = async (conversationId, requesterId = null) => {
  // 1. Validate conversationId format
  if (!isValidConversationId(conversationId)) {
    throw new ApiError(400, 'Invalid conversation ID format');
  }

  const [user1Id, user2Id] = getParticipantsFromConversationId(conversationId);

  // 2. If requesterId is provided, enforce that requester belongs to the conversation
  if (requesterId) {
    const reqIdStr = requesterId.toString();
    if (reqIdStr !== user1Id && reqIdStr !== user2Id) {
      throw new ApiError(403, 'Unauthorized: You are not a participant in this conversation');
    }
  }

  // 3. Verify that both participants exist in database
  const [user1, user2] = await Promise.all([
    User.findById(user1Id),
    User.findById(user2Id),
  ]);

  if (!user1 || !user2) {
    throw new ApiError(404, 'One or both conversation participants do not exist');
  }

  // 4. Find all messages for the conversation, sorted oldest -> newest
  const messages = await Message.find({ conversationId })
    .sort({ createdAt: 1 })
    .select('-__v');

  return messages;
};

/**
 * Marks a message as delivered in MongoDB.
 * Enforces recipient validation and idempotency (never downgrades read status).
 *
 * @param {string} messageId - The MongoDB ObjectId of the message
 * @param {string} receiverId - The user ID claiming delivery (must match message.receiverId)
 * @returns {Promise<Object>} Updated message document
 */
const markMessageDelivered = async (messageId, receiverId) => {
  // 1. Validate ID formats
  if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
    throw new ApiError(400, 'Invalid message ID format');
  }
  if (!receiverId || !mongoose.Types.ObjectId.isValid(receiverId)) {
    throw new ApiError(400, 'Invalid receiver ID format');
  }

  // 2. Find message
  const message = await Message.findById(messageId);
  if (!message) {
    throw new ApiError(404, 'Message not found');
  }

  // 3. Verify recipient
  if (message.receiverId.toString() !== receiverId.toString()) {
    throw new ApiError(403, 'Unauthorized: User is not the recipient of this message');
  }

  // 4. Idempotency & Read protection: do not modify if already delivered or read
  if (message.status === 'read' || message.status === 'delivered') {
    return message;
  }

  // 5. Update status to delivered atomically ONLY IF still 'sent' to prevent overwriting 'read'
  const updatedMessage = await Message.findOneAndUpdate(
    { _id: messageId, status: 'sent' },
    { $set: { status: 'delivered', deliveredAt: new Date() } },
    { new: true }
  );

  return updatedMessage || (await Message.findById(messageId));
};

/**
 * Marks a message as read in MongoDB.
 * Enforces recipient validation and idempotency (never downgrades read status).
 *
 * @param {string} messageId - The MongoDB ObjectId of the message
 * @param {string} readerId - The user ID claiming read (must match message.receiverId)
 * @returns {Promise<Object>} Updated message document
 */
const markMessageRead = async (messageId, readerId) => {
  // 1. Validate ID formats
  if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
    throw new ApiError(400, 'Invalid message ID format');
  }
  if (!readerId || !mongoose.Types.ObjectId.isValid(readerId)) {
    throw new ApiError(400, 'Invalid reader ID format');
  }

  // 2. Find message
  const message = await Message.findById(messageId);
  if (!message) {
    throw new ApiError(404, 'Message not found');
  }

  // 3. Verify recipient (reader must be the receiver)
  if (message.receiverId.toString() !== readerId.toString()) {
    throw new ApiError(403, 'Unauthorized: User is not the recipient of this message');
  }

  // 4. Idempotency: If already read, return existing message without modifying
  if (message.status === 'read') {
    return message;
  }

  // 5. Update status to read and record timestamps atomically
  const now = new Date();
  const updateObj = { status: 'read', readAt: now };
  if (!message.deliveredAt) {
    updateObj.deliveredAt = now;
  }

  const updatedMessage = await Message.findOneAndUpdate(
    { _id: messageId },
    { $set: updateObj },
    { new: true }
  );

  return updatedMessage || message;
};

module.exports = {
  createMessage,
  getConversationMessages,
  markMessageDelivered,
  markMessageRead,
};
