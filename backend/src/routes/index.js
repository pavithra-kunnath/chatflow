const express = require('express');
const router = express.Router();
const healthRoutes = require('./health.routes');
const userRoutes = require('./user.routes');
const messageRoutes = require('./message.routes');

// Health endpoint: /api/health
router.use('/health', healthRoutes);

// User endpoints: /api/users
router.use('/users', userRoutes);

// Message endpoints: /api/messages
router.use('/messages', messageRoutes);

module.exports = router;
