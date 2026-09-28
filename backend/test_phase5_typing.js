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

async function testPhase5Typing() {
  console.log('================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 5.3 REALTIME TYPING INFRASTRUCTURE TEST');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow';
  const conn = await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB directly for message count verification.');

  // Count existing messages before typing tests
  const initialMessageCount = await conn.connection.db.collection('messages').countDocuments();
  console.log(`Initial MongoDB messages count: ${initialMessageCount}\n`);

  // 1. Ensure test users exist: Pavithra, Rahul, and Priya (isolated 3rd user)
  console.log('--- Step 1: Ensure Pavithra, Rahul, and Priya exist via REST ---');
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });
  const userCRes = await request('POST', '/api/users', { username: 'Priya' });

  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;
  const priya = userCRes.body.data.user;

  console.log(`Pavithra ID: ${pavithra.id}`);
  console.log(`Rahul ID: ${rahul.id}`);
  console.log(`Priya ID: ${priya.id}`);

  const conversationId = [pavithra.id, rahul.id].sort().join('_');
  console.log(`Pavithra ↔ Rahul Conversation ID: ${conversationId}\n`);

  // 2. Connect sockets
  console.log('--- Step 2: Connect Socket.io clients ---');
  const socketPavithra = io('http://localhost:5000', { transports: ['websocket'] });
  const socketRahul = io('http://localhost:5000', { transports: ['websocket'] });
  const socketPriya = io('http://localhost:5000', { transports: ['websocket'] });

  await Promise.all([
    new Promise((resolve) => socketPavithra.on('connect', resolve)),
    new Promise((resolve) => socketRahul.on('connect', resolve)),
    new Promise((resolve) => socketPriya.on('connect', resolve)),
  ]);

  // 3. Identify sockets
  console.log('--- Step 3: Identify users on sockets ---');
  await new Promise((resolve) => socketPavithra.emit('identify', { userId: pavithra.id }, resolve));
  await new Promise((resolve) => socketRahul.emit('identify', { userId: rahul.id }, resolve));
  await new Promise((resolve) => socketPriya.emit('identify', { userId: priya.id }, resolve));

  // 4. Pavithra & Rahul join the conversation room; Priya does NOT join this conversation
  console.log('--- Step 4: Pavithra & Rahul join conversation room ---');
  await new Promise((resolve) => socketPavithra.emit('join_conversation', { conversationId }, resolve));
  await new Promise((resolve) => socketRahul.emit('join_conversation', { conversationId }, resolve));

  // Priya joins her own separate room
  const priyaConversationId = [priya.id, rahul.id].sort().join('_');
  await new Promise((resolve) => socketPriya.emit('join_conversation', { conversationId: priyaConversationId }, resolve));

  // 5. Setup user_typing event listeners
  const rahulTypingEvents = [];
  const priyaTypingEvents = [];

  socketRahul.on('user_typing', (data) => {
    console.log('[Rahul Event] Received user_typing:', data);
    rahulTypingEvents.push(data);
  });

  socketPriya.on('user_typing', (data) => {
    console.log('[Priya Event] Received user_typing:', data);
    priyaTypingEvents.push(data);
  });

  // --------------------------------------------------------------------------
  // TEST A — TYPING START
  // --------------------------------------------------------------------------
  console.log('\n--- TEST A: TYPING START ---');
  rahulTypingEvents.length = 0;
  priyaTypingEvents.length = 0;

  socketPavithra.emit('typing_start', {
    conversationId,
    userId: pavithra.id,
  });

  await new Promise((r) => setTimeout(r, 400));

  const startEvent = rahulTypingEvents.find(
    (e) => e.conversationId === conversationId && e.userId === pavithra.id && e.isTyping === true
  );

  if (!startEvent) {
    throw new Error('TEST A FAILED: Rahul did not receive user_typing with isTyping: true');
  }
  console.log('✅ TEST A PASSED: Rahul received user_typing { isTyping: true }');

  // --------------------------------------------------------------------------
  // TEST B — TYPING STOP
  // --------------------------------------------------------------------------
  console.log('\n--- TEST B: TYPING STOP ---');
  rahulTypingEvents.length = 0;

  socketPavithra.emit('typing_stop', {
    conversationId,
    userId: pavithra.id,
  });

  await new Promise((r) => setTimeout(r, 400));

  const stopEvent = rahulTypingEvents.find(
    (e) => e.conversationId === conversationId && e.userId === pavithra.id && e.isTyping === false
  );

  if (!stopEvent) {
    throw new Error('TEST B FAILED: Rahul did not receive user_typing with isTyping: false');
  }
  console.log('✅ TEST B PASSED: Rahul received user_typing { isTyping: false }');

  // --------------------------------------------------------------------------
  // TEST C — CONVERSATION ISOLATION
  // --------------------------------------------------------------------------
  console.log('\n--- TEST C: CONVERSATION ISOLATION ---');
  console.log(`Priya received ${priyaTypingEvents.length} typing events from Pavithra ↔ Rahul room.`);
  if (priyaTypingEvents.length !== 0) {
    throw new Error('TEST C FAILED: Priya received typing events outside of her conversation!');
  }
  console.log('✅ TEST C PASSED: Conversation isolation verified. Outside user received no typing events.');

  // --------------------------------------------------------------------------
  // TEST D — INVALID USER
  // --------------------------------------------------------------------------
  console.log('\n--- TEST D: INVALID USER VALIDATION ---');
  rahulTypingEvents.length = 0;

  // Pavithra socket attempts to emit typing_start for Rahul's userId
  socketPavithra.emit('typing_start', {
    conversationId,
    userId: rahul.id, // Forged userId mismatch
  });

  await new Promise((r) => setTimeout(r, 400));

  if (rahulTypingEvents.length > 0) {
    throw new Error('TEST D FAILED: Server broadcast typing event with mismatched userId!');
  }
  console.log('✅ TEST D PASSED: Server rejected typing event with invalid/mismatched userId.');

  // --------------------------------------------------------------------------
  // TEST E — UNAUTHENTICATED SOCKET
  // --------------------------------------------------------------------------
  console.log('\n--- TEST E: UNAUTHENTICATED SOCKET VALIDATION ---');
  rahulTypingEvents.length = 0;

  // Connect an unauthenticated socket (never identified)
  const socketUnauth = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((resolve) => socketUnauth.on('connect', resolve));

  socketUnauth.emit('typing_start', {
    conversationId,
    userId: pavithra.id,
  });

  await new Promise((r) => setTimeout(r, 400));

  if (rahulTypingEvents.length > 0) {
    throw new Error('TEST E FAILED: Server broadcast typing event from unauthenticated socket!');
  }
  console.log('✅ TEST E PASSED: Server safely rejected unauthenticated socket typing attempt without crashing.');

  socketUnauth.disconnect();

  // --------------------------------------------------------------------------
  // TEST F — DATABASE INTEGRITY
  // --------------------------------------------------------------------------
  console.log('\n--- TEST F: DATABASE INTEGRITY VERIFICATION ---');
  const finalMessageCount = await conn.connection.db.collection('messages').countDocuments();
  console.log(`MongoDB messages before tests: ${initialMessageCount}`);
  console.log(`MongoDB messages after typing tests: ${finalMessageCount}`);

  if (finalMessageCount !== initialMessageCount) {
    throw new Error(`TEST F FAILED: Message count changed from ${initialMessageCount} to ${finalMessageCount}! Typing events must never be persisted.`);
  }
  console.log('✅ TEST F PASSED: MongoDB verified. No typing events created messages (0 DB records modified).');

  // Cleanup
  socketPavithra.disconnect();
  socketRahul.disconnect();
  socketPriya.disconnect();
  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 5.3 TYPING INFRASTRUCTURE TESTS PASSED!');
  console.log('================================================================\n');
}

testPhase5Typing().catch((err) => {
  console.error('\n❌ Phase 5.3 Test Failed:', err);
  process.exit(1);
});
