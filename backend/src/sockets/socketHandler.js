const mongoose = require('mongoose');
const User = require('../models/User');
const messageService = require('../services/message.service');
const { isValidConversationId, getParticipantsFromConversationId } = require('../utils/conversation');

/**
 * ChatFlow Socket.io Handler
 * Manages real-time connection lifecycle, rooms, messaging, presence, and typing indicators
 */
const initSocketServer = (io) => {
  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    /**
     * Event: identify
     * Associates connected socket with a logged-in user
     * Payload: { userId: string }
     */
    socket.on('identify', async (data, callback) => {
      try {
        const userId = typeof data === 'object' && data ? data.userId : data;

        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
          console.warn(`[Socket] Invalid userId received on identify: ${userId}`);
          if (typeof callback === 'function') callback({ success: false, message: 'Invalid userId format' });
          return;
        }

        const user = await User.findById(userId).select('+socketId');
        if (!user) {
          console.warn(`[Socket] User not found for identify: ${userId}`);
          if (typeof callback === 'function') callback({ success: false, message: 'User not found' });
          return;
        }

        // Store identity on socket instance and join personal user room
        socket.userId = user._id.toString();
        socket.join(user._id.toString());

        // Update user state in MongoDB
        user.isOnline = true;
        user.socketId = socket.id;
        await user.save();

        console.log(`[Socket] User identified: ${user.username} (${user._id}) -> Socket: ${socket.id}`);

        // Broadcast presence update to all connected clients
        io.emit('user_presence', {
          userId: user._id.toString(),
          isOnline: true,
          lastSeen: user.lastSeen,
        });

        if (typeof callback === 'function') {
          callback({
            success: true,
            user: {
              id: user._id.toString(),
              username: user.username,
              isOnline: user.isOnline,
              lastSeen: user.lastSeen,
            },
          });
        }
      } catch (error) {
        console.error('[Socket Error on identify]:', error.message);
        if (typeof callback === 'function') callback({ success: false, message: error.message });
      }
    });

    /**
     * Event: join_conversation
     * Joins the socket to a private conversation room
     * Payload: { conversationId: string }
     */
    socket.on('join_conversation', (data, callback) => {
      try {
        const conversationId = typeof data === 'object' && data ? data.conversationId : data;

        if (!conversationId || !isValidConversationId(conversationId)) {
          console.warn(`[Socket] Invalid conversationId on join: ${conversationId}`);
          if (typeof callback === 'function') callback({ success: false, message: 'Invalid conversation ID' });
          return;
        }

        // Validate that the user belongs to this conversation if identified
        if (socket.userId) {
          const participants = getParticipantsFromConversationId(conversationId);
          if (participants && !participants.includes(socket.userId)) {
            console.warn(`[Socket] Unauthorized join attempt by ${socket.userId} to ${conversationId}`);
            if (typeof callback === 'function') callback({ success: false, message: 'Unauthorized room join' });
            return;
          }
        }

        socket.join(conversationId);
        console.log(`[Socket] Socket ${socket.id} (${socket.userId || 'anonymous'}) joined room: ${conversationId}`);

        if (typeof callback === 'function') callback({ success: true, conversationId });
      } catch (error) {
        console.error('[Socket Error on join_conversation]:', error.message);
        if (typeof callback === 'function') callback({ success: false, message: error.message });
      }
    });

    /**
     * Event: leave_conversation
     * Leaves a private conversation room
     * Payload: { conversationId: string }
     */
    socket.on('leave_conversation', (data, callback) => {
      try {
        const conversationId = typeof data === 'object' && data ? data.conversationId : data;
        if (conversationId) {
          socket.leave(conversationId);
          console.log(`[Socket] Socket ${socket.id} left room: ${conversationId}`);
        }
        if (typeof callback === 'function') callback({ success: true });
      } catch (error) {
        console.error('[Socket Error on leave_conversation]:', error.message);
      }
    });

    /**
     * Event: send_message
     * Persists message via message.service and emits new_message to the conversation room
     * Payload: { senderId, receiverId, conversationId, content }
     */
    socket.on('send_message', async (data, callback) => {
      try {
        const { senderId, receiverId, conversationId, content } = data || {};

        if (!senderId || !receiverId || !content || !content.trim()) {
          const errorMsg = 'senderId, receiverId, and content are required';
          if (typeof callback === 'function') callback({ success: false, message: errorMsg });
          return;
        }

        // Persist message in MongoDB reusing existing message service
        const savedMessage = await messageService.createMessage({
          senderId,
          receiverId,
          content: content.trim(),
        });

        const formattedMessage = {
          id: savedMessage.id || savedMessage._id.toString(),
          senderId: savedMessage.senderId.toString(),
          receiverId: savedMessage.receiverId.toString(),
          conversationId: savedMessage.conversationId,
          content: savedMessage.content,
          status: savedMessage.status,
          createdAt: savedMessage.createdAt,
          deliveredAt: savedMessage.deliveredAt,
          readAt: savedMessage.readAt,
        };

        const targetRoom = savedMessage.conversationId || conversationId;

        // Broadcast to all sockets in the conversation room (both sender & receiver)
        io.to(targetRoom).emit('new_message', formattedMessage);

        console.log(`[Socket] Real-time message delivered to room ${targetRoom}: [${formattedMessage.id}] "${formattedMessage.content}"`);

        // Acknowledge sender
        if (typeof callback === 'function') {
          callback({
            success: true,
            data: { message: formattedMessage },
          });
        }
      } catch (error) {
        console.error('[Socket Error on send_message]:', error.message);
        if (typeof callback === 'function') {
          callback({ success: false, message: error.message });
        }
      }
    });

    /**
     * Event: message_delivered
     * Recipient acknowledges message delivery
     * Payload: { messageId, receiverId }
     */
    socket.on('message_delivered', async (data, callback) => {
      try {
        const { messageId, receiverId } = data || {};

        // 1. Socket must be identified
        if (!socket.userId) {
          console.warn('[Socket] Rejected message_delivered: unauthenticated socket');
          if (typeof callback === 'function') callback({ success: false, message: 'Unauthenticated socket' });
          return;
        }

        // 2. Validate messageId
        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
          console.warn(`[Socket] Rejected message_delivered: invalid messageId (${messageId})`);
          if (typeof callback === 'function') callback({ success: false, message: 'Invalid messageId format' });
          return;
        }

        // 3. Validate receiverId
        if (!receiverId || !mongoose.Types.ObjectId.isValid(receiverId)) {
          console.warn(`[Socket] Rejected message_delivered: invalid receiverId (${receiverId})`);
          if (typeof callback === 'function') callback({ success: false, message: 'Invalid receiverId format' });
          return;
        }

        // 4. receiverId must match socket.userId
        if (receiverId.toString() !== socket.userId) {
          console.warn(`[Socket] Rejected message_delivered: receiverId (${receiverId}) does not match socket.userId (${socket.userId})`);
          if (typeof callback === 'function') callback({ success: false, message: 'Receiver ID does not match authenticated user' });
          return;
        }

        // 5 & 6. Persist status change via service (verifies message exists and user is receiver)
        const updatedMessage = await messageService.markMessageDelivered(messageId, socket.userId);

        const statusPayload = {
          messageId: updatedMessage.id || updatedMessage._id.toString(),
          conversationId: updatedMessage.conversationId,
          status: updatedMessage.status,
          deliveredAt: updatedMessage.deliveredAt,
        };

        // Notify sender directly via sender user room and conversation room (deduplicated by Socket.io)
        io.to(updatedMessage.senderId.toString()).to(updatedMessage.conversationId).emit('message_status', statusPayload);

        console.log(`[Socket] Message [${statusPayload.messageId}] marked as ${statusPayload.status} (deliveredAt: ${statusPayload.deliveredAt})`);

        if (typeof callback === 'function') {
          callback({ success: true, data: { message: statusPayload } });
        }
      } catch (err) {
        console.error('[Socket Error on message_delivered]:', err.message);
        if (typeof callback === 'function') {
          callback({ success: false, message: err.message });
        }
      }
    });

    /**
     * Event: message_read
     * Recipient acknowledges message read
     * Payload: { messageId, readerId }
     */
    socket.on('message_read', async (data, callback) => {
      try {
        const { messageId, readerId } = data || {};

        // 1. Socket must be identified
        if (!socket.userId) {
          console.warn('[Socket] Rejected message_read: unauthenticated socket');
          if (typeof callback === 'function') callback({ success: false, message: 'Unauthenticated socket' });
          return;
        }

        // 2. Validate messageId
        if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
          console.warn(`[Socket] Rejected message_read: invalid messageId (${messageId})`);
          if (typeof callback === 'function') callback({ success: false, message: 'Invalid messageId format' });
          return;
        }

        // 3. Validate readerId
        if (!readerId || !mongoose.Types.ObjectId.isValid(readerId)) {
          console.warn(`[Socket] Rejected message_read: invalid readerId (${readerId})`);
          if (typeof callback === 'function') callback({ success: false, message: 'Invalid readerId format' });
          return;
        }

        // 4. readerId must match socket.userId
        if (readerId.toString() !== socket.userId) {
          console.warn(`[Socket] Rejected message_read: readerId (${readerId}) does not match socket.userId (${socket.userId})`);
          if (typeof callback === 'function') callback({ success: false, message: 'Reader ID does not match authenticated user' });
          return;
        }

        // 5 & 6. Persist status change via service (verifies message exists and user is receiver)
        const updatedMessage = await messageService.markMessageRead(messageId, socket.userId);

        const statusPayload = {
          messageId: updatedMessage.id || updatedMessage._id.toString(),
          conversationId: updatedMessage.conversationId,
          status: updatedMessage.status,
          readAt: updatedMessage.readAt,
        };

        // Notify sender directly via sender user room and conversation room (deduplicated by Socket.io)
        io.to(updatedMessage.senderId.toString()).to(updatedMessage.conversationId).emit('message_status', statusPayload);

        console.log(`[Socket] Message [${statusPayload.messageId}] marked as ${statusPayload.status} (readAt: ${statusPayload.readAt})`);

        if (typeof callback === 'function') {
          callback({ success: true, data: { message: statusPayload } });
        }
      } catch (err) {
        console.error('[Socket Error on message_read]:', err.message);
        if (typeof callback === 'function') {
          callback({ success: false, message: err.message });
        }
      }
    });

    /**
     * Event: typing_start
     * Emitted when user starts typing in a conversation
     * Payload: { conversationId, userId }
     */
    socket.on('typing_start', (data) => {
      try {
        const { conversationId, userId } = data || {};

        // 1. Socket must be identified
        if (!socket.userId) {
          console.warn('[Socket] Rejected typing_start: unauthenticated socket');
          return;
        }

        // 2. userId must be provided and must match identified socket user
        if (!userId || userId !== socket.userId) {
          console.warn(`[Socket] Rejected typing_start: invalid userId (${userId}) for socket user ${socket.userId}`);
          return;
        }

        // 3. Conversation ID must be valid
        if (!conversationId || !isValidConversationId(conversationId)) {
          console.warn(`[Socket] Rejected typing_start: invalid conversationId (${conversationId})`);
          return;
        }

        // 4. User must belong to conversation
        const participants = getParticipantsFromConversationId(conversationId);
        if (!participants || !participants.includes(socket.userId)) {
          console.warn(`[Socket] Rejected typing_start: user ${socket.userId} does not belong to conversation ${conversationId}`);
          return;
        }

        // Broadcast user_typing to other participant in room (do NOT persist in MongoDB)
        socket.to(conversationId).emit('user_typing', {
          conversationId,
          userId: socket.userId,
          isTyping: true,
        });
      } catch (err) {
        console.error('[Socket Error on typing_start]:', err.message);
      }
    });

    /**
     * Event: typing_stop
     * Emitted when user stops typing in a conversation
     * Payload: { conversationId, userId }
     */
    socket.on('typing_stop', (data) => {
      try {
        const { conversationId, userId } = data || {};

        // 1. Socket must be identified
        if (!socket.userId) {
          console.warn('[Socket] Rejected typing_stop: unauthenticated socket');
          return;
        }

        // 2. userId must be provided and must match identified socket user
        if (!userId || userId !== socket.userId) {
          console.warn(`[Socket] Rejected typing_stop: invalid userId (${userId}) for socket user ${socket.userId}`);
          return;
        }

        // 3. Conversation ID must be valid
        if (!conversationId || !isValidConversationId(conversationId)) {
          console.warn(`[Socket] Rejected typing_stop: invalid conversationId (${conversationId})`);
          return;
        }

        // 4. User must belong to conversation
        const participants = getParticipantsFromConversationId(conversationId);
        if (!participants || !participants.includes(socket.userId)) {
          console.warn(`[Socket] Rejected typing_stop: user ${socket.userId} does not belong to conversation ${conversationId}`);
          return;
        }

        // Broadcast user_typing to other participant in room (do NOT persist in MongoDB)
        socket.to(conversationId).emit('user_typing', {
          conversationId,
          userId: socket.userId,
          isTyping: false,
        });
      } catch (err) {
        console.error('[Socket Error on typing_stop]:', err.message);
      }
    });

    /**
     * Event: disconnect
     * Cleans up online status, records lastSeen, and broadcasts user_presence
     */
    socket.on('disconnect', async (reason) => {
      console.log(`[Socket] Client disconnected: ${socket.id} (reason: ${reason})`);

      if (socket.userId) {
        try {
          const user = await User.findById(socket.userId).select('+socketId');
          if (user && user.socketId === socket.id) {
            user.isOnline = false;
            user.lastSeen = new Date();
            user.socketId = null;
            await user.save();

            console.log(`[Socket] User marked offline: ${user.username} (${user._id})`);

            // Broadcast offline presence to all connected users
            io.emit('user_presence', {
              userId: user._id.toString(),
              isOnline: false,
              lastSeen: user.lastSeen,
            });
          } else if (user) {
            console.log(`[Socket] Disconnected socket ${socket.id} is not the active socket for user ${socket.userId} (active: ${user.socketId}). Retaining online status.`);
          }
        } catch (err) {
          console.error('[Socket Error on disconnect cleanup]:', err.message);
        }
      }
    });
  });

  return io;
};

module.exports = { initSocketServer };
