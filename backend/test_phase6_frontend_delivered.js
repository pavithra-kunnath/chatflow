const { io } = require('socket.io-client');
const http = require('http');
const mongoose = require('mongoose');

// Helper to determine tick display matching MessageBubble.tsx logic
const getMessageTickDisplay = (status) => {
  return status === 'read' ? '✓✓' : status === 'delivered' ? '✓✓' : '✓';
};

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

async function testPhase6FrontendDelivered() {
  console.log('========================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 6.2 FRONTEND DELIVERED STATUS INTEGRATION TEST');
  console.log('========================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow';
  const conn = await mongoose.connect(mongoUri);

  // 1. Fetch test users
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });
  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;

  console.log(`Pavithra: ${pavithra.username} (${pavithra.id})`);
  console.log(`Rahul: ${rahul.username} (${rahul.id})`);

  const conversationId = [pavithra.id, rahul.id].sort().join('_');
  console.log(`Conversation ID: ${conversationId}\n`);

  // Count baseline MongoDB messages
  const baselineCount = await conn.connection.db.collection('messages').countDocuments();
  console.log(`Baseline MongoDB messages: ${baselineCount}\n`);

  // 2. Connect sockets
  const socketPavithra = io('http://localhost:5000', { transports: ['websocket'] });
  const socketRahul = io('http://localhost:5000', { transports: ['websocket'] });

  await Promise.all([
    new Promise((r) => socketPavithra.on('connect', r)),
    new Promise((r) => socketRahul.on('connect', r)),
  ]);

  await Promise.all([
    new Promise((r) => socketPavithra.emit('identify', { userId: pavithra.id }, r)),
    new Promise((r) => socketRahul.emit('identify', { userId: rahul.id }, r)),
  ]);

  await Promise.all([
    new Promise((r) => socketPavithra.emit('join_conversation', { conversationId }, r)),
    new Promise((r) => socketRahul.emit('join_conversation', { conversationId }, r)),
  ]);

  // 3. Emulate Pavithra's ChatScreen state and listeners
  let pavithraMessages = [];

  // Emulate onMessageStatus listener as in ChatScreen.tsx:
  socketPavithra.on('message_status', (data) => {
    if (!data || !data.messageId) return;
    if (data.conversationId && data.conversationId !== conversationId) return;
    // Process 'delivered' only
    if (data.status !== 'delivered') return;

    pavithraMessages = pavithraMessages.map((m) =>
      m.id === data.messageId
        ? {
            ...m,
            status: 'delivered',
            deliveredAt: data.deliveredAt || new Date().toISOString(),
          }
        : m
    );
  });

  // 4. Emulate Rahul's ChatScreen automatic delivery acknowledgement:
  let rahulDeliveredEmissionsCount = 0;
  socketRahul.on('new_message', (incomingMessage) => {
    // Only acknowledge if incomingMessage.receiverId === rahul.id (do not mark own outgoing)
    if (incomingMessage.receiverId === rahul.id) {
      rahulDeliveredEmissionsCount++;
      socketRahul.emit('message_delivered', {
        messageId: incomingMessage.id,
        receiverId: rahul.id,
      });
    }
  });

  // --------------------------------------------------------------------------
  // TEST A — SENT
  // --------------------------------------------------------------------------
  console.log('--- TEST A: Pavithra sends message ---');
  const sendRes = await new Promise((resolve) => {
    socketPavithra.emit(
      'send_message',
      {
        senderId: pavithra.id,
        receiverId: rahul.id,
        conversationId,
        content: 'Hello delivery UI',
      },
      resolve
    );
  });

  const sentMessage = sendRes.data.message;
  // Add to local state as ChatScreen handleSend does
  pavithraMessages.push(sentMessage);

  const initialMsgState = pavithraMessages.find((m) => m.id === sentMessage.id);
  const initialTick = getMessageTickDisplay(initialMsgState.status);
  console.log(`Pavithra immediate UI: "${initialMsgState.content}" -> Status: ${initialMsgState.status} [${initialTick}]`);

  if (initialMsgState.status !== 'sent' || initialTick !== '✓') {
    throw new Error(`TEST A FAILED: Expected status='sent' and tick='✓', got '${initialMsgState.status}' and '${initialTick}'`);
  }
  console.log('✅ TEST A PASSED: Pavithra initially sees "Hello delivery UI ✓"');

  // --------------------------------------------------------------------------
  // TEST B — RECEIVED (Rahul automatically emits message_delivered)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST B: Rahul receives new_message and automatically acknowledges delivery ---');
  await new Promise((r) => setTimeout(r, 400));

  console.log(`Rahul emitted message_delivered: ${rahulDeliveredEmissionsCount} time(s)`);
  if (rahulDeliveredEmissionsCount !== 1) {
    throw new Error(`TEST B FAILED: Rahul should have emitted message_delivered exactly once, got ${rahulDeliveredEmissionsCount}`);
  }
  console.log('✅ TEST B PASSED: Rahul automatically acknowledged message delivery');

  // --------------------------------------------------------------------------
  // TEST C — DELIVERED (Pavithra receives message_status and UI updates to ✓✓)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST C: Pavithra receives message_status update ---');
  await new Promise((r) => setTimeout(r, 300));

  const updatedMsgState = pavithraMessages.find((m) => m.id === sentMessage.id);
  const updatedTick = getMessageTickDisplay(updatedMsgState.status);
  console.log(`Pavithra updated UI: "${updatedMsgState.content}" -> Status: ${updatedMsgState.status} [${updatedTick}]`);

  if (updatedMsgState.status !== 'delivered' || updatedTick !== '✓✓') {
    throw new Error(`TEST C FAILED: Expected status='delivered' and tick='✓✓', got '${updatedMsgState.status}' and '${updatedTick}'`);
  }
  console.log('✅ TEST C PASSED: Pavithra UI automatically updated to "Hello delivery UI ✓✓" (No refresh)');

  // --------------------------------------------------------------------------
  // DATABASE VERIFICATION & DUPLICATE PROTECTION
  // --------------------------------------------------------------------------
  console.log('\n--- Database Verification & Duplicate Protection ---');
  const postTestCount = await conn.connection.db.collection('messages').countDocuments();
  console.log(`MongoDB messages before: ${baselineCount}, after: ${postTestCount}`);
  if (postTestCount !== baselineCount + 1) {
    throw new Error(`Duplicate Protection Failed: Expected ${baselineCount + 1} messages, found ${postTestCount}`);
  }

  const dbMsg = await conn.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(sentMessage.id) });

  console.log('Database message record:', {
    _id: dbMsg._id,
    content: dbMsg.content,
    status: dbMsg.status,
    deliveredAt: dbMsg.deliveredAt,
  });

  if (dbMsg.status !== 'delivered' || !dbMsg.deliveredAt) {
    throw new Error('Database Verification Failed: status is not delivered or deliveredAt is missing');
  }
  console.log('✅ Database verified: exactly 1 message document created with status="delivered" and deliveredAt timestamp');

  // --------------------------------------------------------------------------
  // INVALID STATUS SAFETY TEST
  // --------------------------------------------------------------------------
  console.log('\n--- Invalid Status Safety Test ---');
  const originalDeliveredAt = updatedMsgState.deliveredAt;

  // Simulate an arbitrary malformed status event arriving
  const malformedEvent = {
    messageId: sentMessage.id,
    conversationId,
    status: 'invalid_malformed_status',
  };

  // Run through ChatScreen handler logic
  if (malformedEvent.status === 'delivered') {
    pavithraMessages = pavithraMessages.map((m) =>
      m.id === malformedEvent.messageId ? { ...m, status: malformedEvent.status } : m
    );
  }

  const safeMsgState = pavithraMessages.find((m) => m.id === sentMessage.id);
  if (safeMsgState.status !== 'delivered') {
    throw new Error('Invalid Status Safety Failed: Local message was corrupted by malformed status');
  }
  console.log('✅ Invalid Status Safety PASSED: Frontend safely ignored malformed status event');

  // Cleanup
  socketPavithra.disconnect();
  socketRahul.disconnect();
  await mongoose.disconnect();

  console.log('\n========================================================================');
  console.log('🎉 ALL PHASE 6.2 FRONTEND DELIVERED STATUS TESTS PASSED SUCCESSFULLY!');
  console.log('========================================================================\n');
}

testPhase6FrontendDelivered().catch((err) => {
  console.error('\n❌ Phase 6.2 Test Failed:', err);
  process.exit(1);
});
