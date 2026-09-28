const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const { validate, messageValidationSchema } = require('../middleware/validate');

// POST /api/messages - Send a new message
router.post('/', validate(messageValidationSchema), messageController.createMessage);

// GET /api/messages/:conversationId - Get messages for conversation (oldest -> newest)
router.get('/:conversationId', messageController.getConversationMessages);

module.exports = router;
