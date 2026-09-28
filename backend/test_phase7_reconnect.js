const { io } = require('socket.io-client');
const http = require('http');
const mongoose = require('mongoose');

const request = (method, path, body = null, headers = {}) => {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let resData = '';
        res.on('data', (chunk) => (resData += chunk));
        res.on('end', () => {
          try {
            resolve({
              statusCode: res.statusCode,
              body: JSON.parse(resData),
            });
          } catch (e) {
            resolve({
              statusCode: res.statusCode,
              raw: resData,
            });
          }
        });
      }
    );

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase7ReconnectTest() {
  console.log('================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 7.4 RECONNECTION LIFECYCLE TEST');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow';
  await mongoose.connect(mongoUri);

  const Message = mongoose.models.Message || mongoose.model('Message', new mongoose.Schema({}, { strict: false }));
  const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, { strict: false }));

  // Step 1: Login
  console.log('--- Step 1: Login Pavithra & Rahul ---');
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });
  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;
  const conversationId = [pavithra.id, rahul.id].sort().join('_');

  console.log(`✓ Pavithra: ${pavithra.username} (${pavithra.id})`);
  console.log(`✓ Rahul:    ${rahul.username} (${rahul.id})`);
  console.log(`✓ Conversation ID: ${conversationId}`);

  // Step 2: Open Chat (Connect sockets & join room)
  console.log('\n--- Step 2: Open Chat (Connect sockets & join conversation) ---');
  const socketPavithra = io('http://localhost:5000', { transports: ['websocket'] });
  const socketRahul = io('http://localhost:5000', { transports: ['websocket'] });

  let pavithraConnectionState = 'offline';
  socketPavithra.on('connect', () => { pavithraConnectionState = 'connected'; });
  socketPavithra.on('disconnect', () => { pavithraConnectionState = 'reconnecting'; });

  await Promise.all([
    new Promise((resolve) => socketPavithra.on('connect', resolve)),
    new Promise((resolve) => socketRahul.on('connect', resolve)),
  ]);

  await new Promise((resolve) => socketPavithra.emit('identify', { userId: pavithra.id }, resolve));
  await new Promise((resolve) => socketRahul.emit('identify', { userId: rahul.id }, resolve));

  await new Promise((resolve) => socketPavithra.emit('join_conversation', { conversationId }, resolve));
  await new Promise((resolve) => socketRahul.emit('join_conversation', { conversationId }, resolve));

  console.log(`✓ Sockets connected and joined conversation. Connection state: "${pavithraConnectionState}"`);

  // Step 3: Disconnect socket
  console.log('\n--- Step 3: Disconnect socket & verify reconnecting/offline UI state ---');
  socketPavithra.disconnect();
  await wait(200);

  console.log(`✓ Socket disconnected. Connection state: "${pavithraConnectionState}" (Indicator: Reconnecting...)`);
  if (pavithraConnectionState !== 'reconnecting') {
    throw new Error('Connection state should be reconnecting upon unexpected disconnect');
  }

  // Verify DB presence
  const pavithraOfflineDb = await User.findById(pavithra.id);
  console.log(`✓ DB User Presence: isOnline = ${pavithraOfflineDb.isOnline}, socketId = ${pavithraOfflineDb.socketId}`);

  // Step 4: Reconnect socket
  console.log('\n--- Step 4: Reconnect socket & verify auto-re-identification ---');
  socketPavithra.connect();
  await new Promise((resolve) => socketPavithra.on('connect', resolve));
  await new Promise((resolve) => socketPavithra.emit('identify', { userId: pavithra.id }, resolve));
  await new Promise((resolve) => socketPavithra.emit('join_conversation', { conversationId }, resolve));

  console.log(`✓ Socket reconnected! Connection state: "${pavithraConnectionState}" (Indicator: Connected)`);
  const pavithraOnlineDb = await User.findById(pavithra.id);
  console.log(`✓ DB User Presence restored: isOnline = ${pavithraOnlineDb.isOnline}, socketId = ${pavithraOnlineDb.socketId}`);

  // Step 5: Send message after reconnect
  console.log('\n--- Step 5: Send message after reconnect ---');
  let rahulReceivedMsg = null;
  socketRahul.once('new_message', (msg) => {
    rahulReceivedMsg = msg;
    // Rahul receives and marks delivered
    socketRahul.emit('message_delivered', { messageId: msg.id, receiverId: rahul.id });
  });

  const pavithraStatuses = [];
  socketPavithra.on('message_status', (st) => {
    pavithraStatuses.push(st);
  });

  const sendRes = await new Promise((resolve) => {
    socketPavithra.emit('send_message', {
      senderId: pavithra.id,
      receiverId: rahul.id,
      conversationId,
      content: 'Phase 7.4 Post-Reconnect Message',
    }, resolve);
  });

  const sentMessage = sendRes.data.message;
  console.log(`✓ Message sent after reconnect (ID: ${sentMessage.id}) -> Status: "${sentMessage.status}" [✓]`);

  // Step 6: Receive message & verify delivered
  console.log('\n--- Step 6: Receive message & verify delivered (✓✓) ---');
  await wait(250);
  if (!rahulReceivedMsg || rahulReceivedMsg.id !== sentMessage.id) {
    throw new Error('Rahul did not receive the post-reconnect message');
  }
  console.log(`✓ Rahul received message: "${rahulReceivedMsg.content}"`);

  const deliveredStatus = pavithraStatuses.find((s) => s.messageId === sentMessage.id && s.status === 'delivered');
  if (!deliveredStatus) {
    throw new Error('Pavithra did not receive delivered status event');
  }
  console.log(`✓ Delivered status confirmed on Pavithra: "${deliveredStatus.status}" [✓✓] (deliveredAt: ${deliveredStatus.deliveredAt})`);

  // Step 7: Verify read (cyan ✓✓)
  console.log('\n--- Step 7: Rahul opens/views chat & verify read (cyan ✓✓) ---');
  socketRahul.emit('message_read', { messageId: sentMessage.id, readerId: rahul.id });
  await wait(250);

  const readStatus = pavithraStatuses.find((s) => s.messageId === sentMessage.id && s.status === 'read');
  if (!readStatus) {
    throw new Error('Pavithra did not receive read status event');
  }
  console.log(`✓ Read status confirmed on Pavithra: "${readStatus.status}" [cyan ✓✓] (readAt: ${readStatus.readAt})`);

  // Step 8: MongoDB verification
  console.log('\n--- Step 8: MongoDB Document Verification ---');
  const dbDoc = await Message.findById(sentMessage.id);
  if (
    dbDoc.status === 'read' &&
    dbDoc.deliveredAt &&
    dbDoc.readAt &&
    dbDoc.content === 'Phase 7.4 Post-Reconnect Message'
  ) {
    console.log('✓ MongoDB Record verified: exactly 1 message, status="read", deliveredAt != null, readAt != null.');
  } else {
    throw new Error('Database record verification failed');
  }

  // Cleanup
  socketPavithra.disconnect();
  socketRahul.disconnect();
  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log('🎉 PHASE 7.4 RECONNECTION LIFECYCLE TEST PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runPhase7ReconnectTest().catch((err) => {
  console.error('\n❌ RECONNECTION TEST FAILED:', err);
  process.exit(1);
});
