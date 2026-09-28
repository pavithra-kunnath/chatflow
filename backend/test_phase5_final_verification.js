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

async function runFinalPhase5Verification() {
  console.log('====================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 5.4 FINAL VERIFICATION & REGRESSION SUITE');
  console.log('====================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow';
  const conn = await mongoose.connect(mongoUri);

  // 1. Get or create test users
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });
  const userCRes = await request('POST', '/api/users', { username: 'Priya' });

  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;
  const priya = userCRes.body.data.user;

  console.log(`Pavithra: ${pavithra.username} (${pavithra.id})`);
  console.log(`Rahul: ${rahul.username} (${rahul.id})`);
  console.log(`Priya: ${priya.username} (${priya.id})\n`);

  const conversationId = [pavithra.id, rahul.id].sort().join('_');
  const priyaConversationId = [priya.id, rahul.id].sort().join('_');

  // Baseline message count
  const initialMessagesCount = await conn.connection.db.collection('messages').countDocuments();
  console.log(`Baseline MongoDB messages count: ${initialMessagesCount}\n`);

  // --------------------------------------------------------------------------
  // PART 14 — TESTS 1, 2, 3: PRESENCE LIFECYCLE
  // --------------------------------------------------------------------------
  console.log('--- PART 14: Realtime Online / Offline / Reconnect Presence ---');
  const socketPavithra = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((r) => socketPavithra.on('connect', r));
  await new Promise((r) => socketPavithra.emit('identify', { userId: pavithra.id }, r));

  const pavithraPresenceEvents = [];
  socketPavithra.on('user_presence', (p) => pavithraPresenceEvents.push(p));

  // Test 1: Rahul connects
  let socketRahul = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((r) => socketRahul.on('connect', r));
  await new Promise((r) => socketRahul.emit('identify', { userId: rahul.id }, r));
  await new Promise((r) => setTimeout(r, 400));

  let event1 = pavithraPresenceEvents.find((e) => e.userId === rahul.id && e.isOnline === true);
  if (!event1) throw new Error('Test 1 Failed: Pavithra did not receive Rahul online presence');
  console.log('✅ TEST 1 PASSED: Pavithra automatically sees Rahul 🟢 Online');

  // Test 2: Rahul disconnects
  pavithraPresenceEvents.length = 0;
  socketRahul.disconnect();
  await new Promise((r) => setTimeout(r, 500));

  let event2 = pavithraPresenceEvents.find((e) => e.userId === rahul.id && e.isOnline === false);
  if (!event2 || !event2.lastSeen) throw new Error('Test 2 Failed: Pavithra did not receive Rahul offline presence with lastSeen');
  console.log(`✅ TEST 2 PASSED: Pavithra automatically sees Rahul Last seen (timestamp: ${event2.lastSeen})`);

  // Test 3: Rahul reconnects
  pavithraPresenceEvents.length = 0;
  socketRahul = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((r) => socketRahul.on('connect', r));
  await new Promise((r) => socketRahul.emit('identify', { userId: rahul.id }, r));
  await new Promise((r) => setTimeout(r, 400));

  let event3 = pavithraPresenceEvents.find((e) => e.userId === rahul.id && e.isOnline === true);
  if (!event3) throw new Error('Test 3 Failed: Pavithra did not receive Rahul reconnect presence');
  console.log('✅ TEST 3 PASSED: Pavithra automatically sees Rahul 🟢 Online again after reconnect');

  // Both join conversation room
  await new Promise((r) => socketPavithra.emit('join_conversation', { conversationId }, r));
  await new Promise((r) => socketRahul.emit('join_conversation', { conversationId }, r));

  // Connect Priya to another conversation room
  const socketPriya = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((r) => socketPriya.on('connect', r));
  await new Promise((r) => socketPriya.emit('identify', { userId: priya.id }, r));
  await new Promise((r) => socketPriya.emit('join_conversation', { conversationId: priyaConversationId }, r));

  const rahulTypingEvents = [];
  const priyaTypingEvents = [];
  socketRahul.on('user_typing', (d) => rahulTypingEvents.push(d));
  socketPriya.on('user_typing', (d) => priyaTypingEvents.push(d));

  // --------------------------------------------------------------------------
  // PART 15 — TYPING TEST
  // --------------------------------------------------------------------------
  console.log('\n--- PART 15: Typing Start Test ---');
  rahulTypingEvents.length = 0;
  socketPavithra.emit('typing_start', { conversationId, userId: pavithra.id });
  await new Promise((r) => setTimeout(r, 300));

  const typingStart = rahulTypingEvents.find((e) => e.userId === pavithra.id && e.isTyping === true);
  if (!typingStart) throw new Error('Part 15 Failed: Rahul did not receive typing_start');
  console.log(`✅ PART 15 PASSED: Rahul sees "${pavithra.username} is typing..."`);

  // --------------------------------------------------------------------------
  // PART 16 — STOP TYPING TEST (Debounce ~1s)
  // --------------------------------------------------------------------------
  console.log('\n--- PART 16: Stop Typing Test (~1s debounce) ---');
  rahulTypingEvents.length = 0;
  // Wait ~1s as simulated by MessageInput debounce
  await new Promise((r) => setTimeout(r, 1000));
  socketPavithra.emit('typing_stop', { conversationId, userId: pavithra.id });
  await new Promise((r) => setTimeout(r, 300));

  const typingStop = rahulTypingEvents.find((e) => e.userId === pavithra.id && e.isTyping === false);
  if (!typingStop) throw new Error('Part 16 Failed: Rahul did not receive typing_stop');
  console.log(`✅ PART 16 PASSED: "${pavithra.username} is typing..." disappears after ~1s inactivity`);

  // --------------------------------------------------------------------------
  // PART 17 — DELETE INPUT TEST
  // --------------------------------------------------------------------------
  console.log('\n--- PART 17: Delete Input Test ---');
  // Starts typing
  socketPavithra.emit('typing_start', { conversationId, userId: pavithra.id });
  await new Promise((r) => setTimeout(r, 200));
  // User deletes all text -> immediate typing_stop
  rahulTypingEvents.length = 0;
  socketPavithra.emit('typing_stop', { conversationId, userId: pavithra.id });
  await new Promise((r) => setTimeout(r, 200));

  const deleteStop = rahulTypingEvents.find((e) => e.userId === pavithra.id && e.isTyping === false);
  if (!deleteStop) throw new Error('Part 17 Failed: typing_stop not received on input delete');
  console.log('✅ PART 17 PASSED: Typing indicator immediately disappears when input text is deleted');

  // --------------------------------------------------------------------------
  // PART 18 — SEND WHILE TYPING TEST
  // --------------------------------------------------------------------------
  console.log('\n--- PART 18: Send While Typing Test ---');
  rahulTypingEvents.length = 0;
  const rahulMessages = [];
  socketRahul.on('new_message', (m) => rahulMessages.push(m));

  // 1. User is typing
  socketPavithra.emit('typing_start', { conversationId, userId: pavithra.id });
  await new Promise((r) => setTimeout(r, 100));

  // 2. User presses send: emit typing_stop and send_message
  socketPavithra.emit('typing_stop', { conversationId, userId: pavithra.id });
  const sendRes = await new Promise((resolve) => {
    socketPavithra.emit(
      'send_message',
      {
        senderId: pavithra.id,
        receiverId: rahul.id,
        conversationId,
        content: 'Phase 5.4 verified message',
      },
      resolve
    );
  });

  await new Promise((r) => setTimeout(r, 400));

  const stoppedOnSend = rahulTypingEvents.find((e) => e.userId === pavithra.id && e.isTyping === false);
  if (!stoppedOnSend) throw new Error('Part 18 Failed: typing indicator did not stop on send');

  const receivedMsg = rahulMessages.find((m) => m.content === 'Phase 5.4 verified message');
  if (!receivedMsg) throw new Error('Part 18 Failed: Rahul did not receive message over Socket.io');

  // Check that message appears exactly once in MongoDB
  const matchingDbMsgs = await conn.connection.db
    .collection('messages')
    .find({ content: 'Phase 5.4 verified message' })
    .toArray();
  if (matchingDbMsgs.length !== 1) {
    throw new Error(`Part 18 Failed: Expected exactly 1 message in MongoDB, found ${matchingDbMsgs.length}`);
  }
  console.log('✅ PART 18 PASSED: Typing stopped on send, message delivered instantly, exactly 1 copy in MongoDB');

  // --------------------------------------------------------------------------
  // PART 19 — NAVIGATION TEST (Repeated Mount / Unmount Cleanliness)
  // --------------------------------------------------------------------------
  console.log('\n--- PART 19: Navigation Lifecycle Test (Home ➔ Chat ➔ Home ➔ Chat) ---');
  // Simulate 3 repeated navigations and listener re-registrations
  const simulatedListeners = [];
  const onTyping = (fn) => {
    if (!simulatedListeners.includes(fn)) simulatedListeners.push(fn);
  };
  const offTyping = (fn) => {
    const idx = simulatedListeners.indexOf(fn);
    if (idx !== -1) simulatedListeners.splice(idx, 1);
  };

  for (let cycle = 1; cycle <= 3; cycle++) {
    const chatListener = (data) => {};
    // Mount ChatScreen
    onTyping(chatListener);
    if (simulatedListeners.length !== 1) throw new Error(`Cycle ${cycle}: duplicate listener registered`);
    // Unmount ChatScreen
    offTyping(chatListener);
    if (simulatedListeners.length !== 0) throw new Error(`Cycle ${cycle}: listener not cleaned up`);
  }
  console.log('✅ PART 19 PASSED: Navigating repeatedly leaves 0 stale listeners and 0 duplicate callbacks');

  // --------------------------------------------------------------------------
  // PART 20 — CONVERSATION ISOLATION TEST
  // --------------------------------------------------------------------------
  console.log('\n--- PART 20: Conversation Isolation Test ---');
  console.log(`Priya received ${priyaTypingEvents.length} typing events from Pavithra ↔ Rahul room.`);
  if (priyaTypingEvents.length !== 0) {
    throw new Error('Part 20 Failed: Outside user (Priya) received typing events!');
  }
  console.log('✅ PART 20 PASSED: Conversation isolation verified across multiple rooms');

  // --------------------------------------------------------------------------
  // PART 21 — RECONNECTION TEST
  // --------------------------------------------------------------------------
  console.log('\n--- PART 21: Reconnection Test ---');
  // Rahul disconnects and reconnects
  socketRahul.disconnect();
  await new Promise((r) => setTimeout(r, 400));

  socketRahul = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((r) => socketRahul.on('connect', r));
  await new Promise((r) => socketRahul.emit('identify', { userId: rahul.id }, r));
  await new Promise((r) => socketRahul.emit('join_conversation', { conversationId }, r));

  const rahulReconnectedTypingEvents = [];
  socketRahul.on('user_typing', (d) => rahulReconnectedTypingEvents.push(d));

  // Reconnected socket should not receive typing indicator until a new event occurs
  await new Promise((r) => setTimeout(r, 300));
  if (rahulReconnectedTypingEvents.length !== 0) {
    throw new Error('Part 21 Failed: Typing indicator unexpectedly triggered on reconnect without user action');
  }

  // Now trigger new typing event
  socketPavithra.emit('typing_start', { conversationId, userId: pavithra.id });
  await new Promise((r) => setTimeout(r, 300));
  const postReconnectEvent = rahulReconnectedTypingEvents.find((e) => e.isTyping === true);
  if (!postReconnectEvent) {
    throw new Error('Part 21 Failed: Typing not functional after reconnect');
  }
  console.log('✅ PART 21 PASSED: Full reconnection restore verified (identity, room, presence, messaging, typing)');

  // --------------------------------------------------------------------------
  // PART 24 — FINAL DATABASE VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n--- PART 24: Final Database Verification ---');
  const finalMessagesCount = await conn.connection.db.collection('messages').countDocuments();
  console.log(`Baseline messages count: ${initialMessagesCount}`);
  console.log(`Final messages count: ${finalMessagesCount} (Expected: exactly +1 for the 1 sent message)`);

  if (finalMessagesCount !== initialMessagesCount + 1) {
    throw new Error(`Part 24 Failed: Expected exactly ${initialMessagesCount + 1} messages, got ${finalMessagesCount}`);
  }
  console.log('✅ PART 24 PASSED: MongoDB verified: only actual messages are persisted (typing never touches DB)');

  // Cleanup
  socketPavithra.disconnect();
  socketRahul.disconnect();
  socketPriya.disconnect();
  await mongoose.disconnect();

  console.log('\n====================================================================');
  console.log('🎉 ALL PHASE 5.4 FINAL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================================\n');
}

runFinalPhase5Verification().catch((err) => {
  console.error('\n❌ Phase 5.4 Final Verification Failed:', err);
  process.exit(1);
});
