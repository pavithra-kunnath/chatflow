const messageService = require('../services/message.service');

/**
 * Controller: Send a new message
 * POST /api/messages
 */
const createMessage = async (req, res, next) => {
  try {
    const { senderId, receiverId, content } = req.body;
    const message = await messageService.createMessage({
      senderId,
      receiverId,
      content,
    });

    res.status(201).json({
      success: true,
      data: {
        message: {
          id: message.id || message._id.toString(),
          senderId: message.senderId.toString(),
          receiverId: message.receiverId.toString(),
          conversationId: message.conversationId,
          content: message.content,
          status: message.status,
          deliveredAt: message.deliveredAt,
          readAt: message.readAt,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller: Get conversation message history (chronological: oldest -> newest)
 * GET /api/messages/:conversationId
 */
const getConversationMessages = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    // Extract optional requesterId from header or query param
    const requesterId = req.headers['x-user-id'] || req.query.userId || null;

    const messages = await messageService.getConversationMessages(
      conversationId,
      requesterId
    );

    res.status(200).json({
      success: true,
      data: {
        messages,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createMessage,
  getConversationMessages,
};
