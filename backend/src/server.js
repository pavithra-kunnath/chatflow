require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const connectDB = require('./config/db');
const { initSocketServer } = require('./sockets/socketHandler');

const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Setup Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Attach socket handlers
initSocketServer(io);

// Connect to MongoDB and start server
const startServer = async () => {
  await connectDB();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ChatFlow Backend] Server running on http://localhost:${PORT}`);
    console.log(`[ChatFlow Backend] Health check: http://localhost:${PORT}/api/health`);
    console.log(`[ChatFlow Backend] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
};

startServer();

module.exports = { server, io };
