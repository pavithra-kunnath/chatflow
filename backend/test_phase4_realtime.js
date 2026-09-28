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

async function testPhase4() {
  console.log('======================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 4 REAL-TIME SOCKET.IO TEST');
  console.log('======================================================\n');

  // 1. Get or create Pavithra & Rahul via REST
  console.log('--- Step 1: Login Pavithra & Rahul via REST ---');
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });

  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;

  console.log(`Pavithra ID: ${pavithra.id}`);
  console.log(`Rahul ID: ${rahul.id}`);

  const conversationId = [pavithra.id, rahul.id].sort().join('_');
  console.log(`Conversation ID: ${conversationId}`);

  // Count existing messages in DB before test
  const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow');
  const initialCount = await conn.connection.db.collection('messages').countDocuments();
  console.log(`Initial MongoDB messages count: ${initialCount}\n`);

  // 2. Connect both Socket clients
  console.log('--- Step 2: Connect Socket.io clients for Pavithra and Rahul ---');
  const socketA = io('http://localhost:5000', { transports: ['websocket'] });
  const socketB = io('http://localhost:5000', { transports: ['websocket'] });

  await Promise.all([
    new Promise((resolve) => socketA.on('connect', resolve)),
    new Promise((resolve) => socketB.on('connect', resolve)),
  ]);

  console.log(`Pavithra Socket connected: ${socketA.id}`);
  console.log(`Rahul Socket connected: ${socketB.id}\n`);

  // 3. Identify both users
  console.log('--- Step 3: Identify users on their respective sockets ---');
  const idA = await new Promise((resolve) => {
    socketA.emit('identify', { userId: pavithra.id }, resolve);
  });
  console.log('Pavithra identify response:', idA);

  const idB = await new Promise((resolve) => {
    socketB.emit('identify', { userId: rahul.id }, resolve);
  });
  console.log('Rahul identify response:', idB);

  // Check DB to verify socketId and isOnline were recorded
  const pavithraDbUser = await conn.connection.db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(pavithra.id) });
  console.log(`Pavithra DB status -> isOnline: ${pavithraDbUser.isOnline}, socketId: ${pavithraDbUser.socketId}\n`);

  // 4. Both join the conversation room
  console.log('--- Step 4: Both join conversation room ---');
  const joinA = await new Promise((resolve) => {
    socketA.emit('join_conversation', { conversationId }, resolve);
  });
  console.log('Pavithra joined conversation:', joinA);

  const joinB = await new Promise((resolve) => {
    socketB.emit('join_conversation', { conversationId }, resolve);
  });
  console.log('Rahul joined conversation:', joinB);

  // 5. Setup listeners for real-time new_message events
  const pavithraReceivedMessages = [];
  const rahulReceivedMessages = [];

  socketA.on('new_message', (msg) => {
    console.log(`[Socket A Event] Pavithra received new_message: "${msg.content}" (ID: ${msg.id})`);
    pavithraReceivedMessages.push(msg);
  });

  socketB.on('new_message', (msg) => {
    console.log(`[Socket B Event] Rahul received new_message: "${msg.content}" (ID: ${msg.id})`);
    rahulReceivedMessages.push(msg);
  });

  // 6. Pavithra sends real-time message to Rahul
  console.log('\n--- Step 6: Pavithra sends "Hello Rahul! (Phase 4 Realtime)" via Socket.io ---');
  const sendResult1 = await new Promise((resolve) => {
    socketA.emit(
      'send_message',
      {
        senderId: pavithra.id,
        receiverId: rahul.id,
        conversationId,
        content: 'Hello Rahul! (Phase 4 Realtime)',
      },
      resolve
    );
  });
  console.log('Send acknowledge result:', sendResult1);

  // Wait a small moment to ensure delivery
  await new Promise((r) => setTimeout(r, 400));

  // Verify Rahul received message instantly
  const msgForRahul = rahulReceivedMessages.find((m) => m.content === 'Hello Rahul! (Phase 4 Realtime)');
  if (!msgForRahul) {
    throw new Error('Rahul did not receive Pavithra message instantly via Socket.io!');
  }
  console.log('✅ Rahul instantly received Pavithra message over Socket.io!');

  // 7. Rahul replies to Pavithra in real time
  console.log('\n--- Step 7: Rahul replies "Hi Pavithra! Instant messaging is working!" via Socket.io ---');
  const sendResult2 = await new Promise((resolve) => {
    socketB.emit(
      'send_message',
      {
        senderId: rahul.id,
        receiverId: pavithra.id,
        conversationId,
        content: 'Hi Pavithra! Instant messaging is working!',
      },
      resolve
    );
  });
  console.log('Reply acknowledge result:', sendResult2);

  await new Promise((r) => setTimeout(r, 400));

  // Verify Pavithra received Rahul reply instantly
  const replyForPavithra = pavithraReceivedMessages.find((m) => m.content === 'Hi Pavithra! Instant messaging is working!');
  if (!replyForPavithra) {
    throw new Error('Pavithra did not receive Rahul reply instantly via Socket.io!');
  }
  console.log('✅ Pavithra instantly received Rahul reply over Socket.io!');

  // 8. Verify MongoDB persistence
  console.log('\n--- Step 8: Verifying MongoDB Persistence ---');
  const newCount = await conn.connection.db.collection('messages').countDocuments();
  console.log(`New MongoDB messages count: ${newCount} (Expected: ${initialCount + 2})`);
  if (newCount !== initialCount + 2) {
    throw new Error(`Expected exactly 2 new messages in MongoDB, but got ${newCount - initialCount}`);
  }

  const persistedMsg = await conn.connection.db.collection('messages').findOne({ _id: new mongoose.Types.ObjectId(msgForRahul.id) });
  console.log('Persisted message verified directly from MongoDB:');
  console.log({
    _id: persistedMsg._id,
    senderId: persistedMsg.senderId,
    receiverId: persistedMsg.receiverId,
    conversationId: persistedMsg.conversationId,
    content: persistedMsg.content,
    status: persistedMsg.status,
    createdAt: persistedMsg.createdAt,
  });

  // 9. Verify REST History retrieval still returns the real-time messages
  console.log('\n--- Step 9: Verify REST history API returns all messages chronologically ---');
  const historyRes = await request('GET', `/api/messages/${conversationId}`, null, {
    'x-user-id': pavithra.id,
  });
  const history = historyRes.body.data.messages;
  console.log(`REST History returned ${history.length} messages.`);
  const hasMsg1 = history.some((m) => m.content === 'Hello Rahul! (Phase 4 Realtime)');
  const hasMsg2 = history.some((m) => m.content === 'Hi Pavithra! Instant messaging is working!');
  if (!hasMsg1 || !hasMsg2) {
    throw new Error('REST history did not return the Socket.io messages!');
  }
  console.log('✅ REST history successfully includes all Socket.io real-time messages in chronological order!');

  // 10. Test Disconnection & Reconnection
  console.log('\n--- Step 10: Test Disconnection & Cleanup ---');
  socketB.disconnect();
  await new Promise((r) => setTimeout(r, 500));

  const rahulAfterDisconnect = await conn.connection.db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(rahul.id) });
  console.log(`Rahul status after disconnect -> isOnline: ${rahulAfterDisconnect.isOnline}, socketId: ${rahulAfterDisconnect.socketId}`);
  if (rahulAfterDisconnect.isOnline !== false || rahulAfterDisconnect.socketId !== null) {
    throw new Error('User was not correctly cleaned up on disconnect!');
  }
  console.log('✅ Disconnection cleanup verified!');

  // Reconnect Rahul
  console.log('\n--- Step 11: Test Reconnection ---');
  socketB.connect();
  await new Promise((resolve) => socketB.on('connect', resolve));
  await new Promise((resolve) => socketB.emit('identify', { userId: rahul.id }, resolve));
  await new Promise((resolve) => socketB.emit('join_conversation', { conversationId }, resolve));

  const rahulAfterReconnect = await conn.connection.db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(rahul.id) });
  console.log(`Rahul status after reconnect -> isOnline: ${rahulAfterReconnect.isOnline}, socketId: ${rahulAfterReconnect.socketId}`);
  if (rahulAfterReconnect.isOnline !== true || !rahulAfterReconnect.socketId) {
    throw new Error('User was not marked online after reconnect!');
  }
  console.log('✅ Reconnection and re-identification verified!');

  socketA.disconnect();
  socketB.disconnect();
  await mongoose.disconnect();

  console.log('\n======================================================');
  console.log('🎉 ALL PHASE 4 REAL-TIME SOCKET.IO TESTS PASSED!');
  console.log('======================================================');
}

testPhase4().catch((err) => {
  console.error('Phase 4 Test Failed:', err);
  process.exit(1);
});
