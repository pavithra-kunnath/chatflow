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

async function testPhase6Delivered() {
  console.log('================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 6.1 DELIVERED MESSAGE STATUS TESTS');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow';
  const conn = await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB directly for message status verification.');

  // 1. Create or fetch test users: Pavithra & Rahul
  console.log('\n--- Step 1: Ensure Pavithra & Rahul exist via REST ---');
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });

  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;

  console.log(`Pavithra: ${pavithra.username} (${pavithra.id})`);
  console.log(`Rahul: ${rahul.username} (${rahul.id})`);

  const conversationId = [pavithra.id, rahul.id].sort().join('_');
  console.log(`Conversation ID: ${conversationId}\n`);

  // 2. Connect both Socket clients
  console.log('--- Step 2: Connect Socket.io clients for Pavithra and Rahul ---');
  const socketPavithra = io('http://localhost:5000', { transports: ['websocket'] });
  const socketRahul = io('http://localhost:5000', { transports: ['websocket'] });

  await Promise.all([
    new Promise((resolve) => socketPavithra.on('connect', resolve)),
    new Promise((resolve) => socketRahul.on('connect', resolve)),
  ]);

  // 3. Identify both users
  console.log('--- Step 3: Identify users on their sockets ---');
  await new Promise((resolve) => socketPavithra.emit('identify', { userId: pavithra.id }, resolve));
  await new Promise((resolve) => socketRahul.emit('identify', { userId: rahul.id }, resolve));

  // 4. Join conversation room
  console.log('--- Step 4: Join conversation room ---');
  await new Promise((resolve) => socketPavithra.emit('join_conversation', { conversationId }, resolve));
  await new Promise((resolve) => socketRahul.emit('join_conversation', { conversationId }, resolve));

  // Setup message and status listeners
  const rahulReceivedMessages = [];
  socketRahul.on('new_message', (msg) => {
    console.log(`[Rahul Socket] Received new_message: "${msg.content}" (ID: ${msg.id})`);
    rahulReceivedMessages.push(msg);
  });

  const pavithraReceivedStatuses = [];
  socketPavithra.on('message_status', (status) => {
    console.log(`[Pavithra Socket] Received message_status:`, status);
    pavithraReceivedStatuses.push(status);
  });

  // --------------------------------------------------------------------------
  // TEST A — MESSAGE STARTS AS SENT
  // --------------------------------------------------------------------------
  console.log('\n--- TEST A: Message starts as "sent" ---');
  const sendResult = await new Promise((resolve) => {
    socketPavithra.emit(
      'send_message',
      {
        senderId: pavithra.id,
        receiverId: rahul.id,
        conversationId,
        content: 'Hello delivery test',
      },
      resolve
    );
  });

  const sentMessage = sendResult.data.message;
  console.log('Sent message acknowledged:', sentMessage);

  if (sentMessage.status !== 'sent') {
    throw new Error(`TEST A FAILED: Expected message status to be 'sent', got '${sentMessage.status}'`);
  }

  // Verify MongoDB initially has status = 'sent' and deliveredAt = null
  const initialDbMsg = await conn.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(sentMessage.id) });

  console.log('MongoDB initial state:', {
    _id: initialDbMsg._id,
    content: initialDbMsg.content,
    status: initialDbMsg.status,
    deliveredAt: initialDbMsg.deliveredAt,
  });

  if (initialDbMsg.status !== 'sent' || initialDbMsg.deliveredAt !== null) {
    throw new Error('TEST A FAILED: MongoDB does not have initial status "sent" with null deliveredAt');
  }
  console.log('✅ TEST A PASSED: Message correctly created with status="sent" and deliveredAt=null');

  // --------------------------------------------------------------------------
  // TEST B — RECIPIENT RECEIVES MESSAGE AND EMITS message_delivered
  // --------------------------------------------------------------------------
  console.log('\n--- TEST B: Recipient receives message and emits message_delivered ---');
  await new Promise((r) => setTimeout(r, 300));

  const incomingForRahul = rahulReceivedMessages.find((m) => m.content === 'Hello delivery test');
  if (!incomingForRahul) {
    throw new Error('TEST B FAILED: Rahul did not receive new_message event');
  }

  const deliveryAck = await new Promise((resolve) => {
    socketRahul.emit(
      'message_delivered',
      {
        messageId: incomingForRahul.id,
        receiverId: rahul.id,
      },
      resolve
    );
  });
  console.log('Rahul message_delivered callback response:', deliveryAck);

  if (!deliveryAck.success || deliveryAck.data?.message?.status !== 'delivered') {
    throw new Error('TEST B FAILED: message_delivered acknowledgment was unsuccessful');
  }
  console.log('✅ TEST B PASSED: Recipient received message and successfully acknowledged delivery');

  // --------------------------------------------------------------------------
  // TEST C — DATABASE UPDATE (status = delivered, deliveredAt populated)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST C: Database update verification ---');
  await new Promise((r) => setTimeout(r, 300));

  const deliveredDbMsg = await conn.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(incomingForRahul.id) });

  console.log('MongoDB updated state:', {
    _id: deliveredDbMsg._id,
    content: deliveredDbMsg.content,
    status: deliveredDbMsg.status,
    deliveredAt: deliveredDbMsg.deliveredAt,
  });

  if (deliveredDbMsg.status !== 'delivered') {
    throw new Error(`TEST C FAILED: Expected MongoDB status 'delivered', got '${deliveredDbMsg.status}'`);
  }
  if (!deliveredDbMsg.deliveredAt) {
    throw new Error('TEST C FAILED: deliveredAt was not set in MongoDB');
  }
  if (deliveredDbMsg.content !== 'Hello delivery test') {
    throw new Error('TEST C FAILED: Message content was modified during delivery update');
  }
  console.log('✅ TEST C PASSED: MongoDB persists status="delivered" and populated deliveredAt');

  // --------------------------------------------------------------------------
  // TEST D — SENDER RECEIVES STATUS UPDATE
  // --------------------------------------------------------------------------
  console.log('\n--- TEST D: Sender receives message_status event ---');
  const statusEvent = pavithraReceivedStatuses.find(
    (s) => s.messageId === incomingForRahul.id && s.status === 'delivered'
  );

  if (!statusEvent) {
    throw new Error('TEST D FAILED: Pavithra did not receive message_status event with status="delivered"');
  }
  if (!statusEvent.deliveredAt) {
    throw new Error('TEST D FAILED: message_status event payload did not include deliveredAt');
  }
  console.log('Pavithra received status event verified:', statusEvent);
  console.log('✅ TEST D PASSED: Sender received realtime message_status update');

  // --------------------------------------------------------------------------
  // TEST E — IDEMPOTENCY
  // --------------------------------------------------------------------------
  console.log('\n--- TEST E: Idempotency (repeated message_delivered calls) ---');
  const firstDeliveredAt = deliveredDbMsg.deliveredAt.toISOString();

  // Call message_delivered 2 more times
  await new Promise((resolve) => {
    socketRahul.emit(
      'message_delivered',
      { messageId: incomingForRahul.id, receiverId: rahul.id },
      resolve
    );
  });
  await new Promise((resolve) => {
    socketRahul.emit(
      'message_delivered',
      { messageId: incomingForRahul.id, receiverId: rahul.id },
      resolve
    );
  });

  const idempotentDbMsg = await conn.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(incomingForRahul.id) });

  if (idempotentDbMsg.status !== 'delivered') {
    throw new Error('TEST E FAILED: Status changed on repeated delivery call');
  }
  if (idempotentDbMsg.deliveredAt.toISOString() !== firstDeliveredAt) {
    throw new Error('TEST E FAILED: deliveredAt timestamp was mutated on idempotent delivery call');
  }
  console.log('✅ TEST E PASSED: Repeated message_delivered calls are idempotent (no status regression or mutations)');

  // --------------------------------------------------------------------------
  // TEST F — READ PROTECTION (Never downgrade 'read' to 'delivered')
  // --------------------------------------------------------------------------
  console.log('\n--- TEST F: Read protection (never downgrade "read" to "delivered") ---');
  // Directly set status = 'read' in MongoDB
  const readTimestamp = new Date();
  await conn.connection.db.collection('messages').updateOne(
    { _id: new mongoose.Types.ObjectId(incomingForRahul.id) },
    { $set: { status: 'read', readAt: readTimestamp } }
  );

  // Now emit message_delivered
  const ackReadProtect = await new Promise((resolve) => {
    socketRahul.emit(
      'message_delivered',
      { messageId: incomingForRahul.id, receiverId: rahul.id },
      resolve
    );
  });
  console.log('Callback response on read message:', ackReadProtect);

  const readProtectedDbMsg = await conn.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(incomingForRahul.id) });

  if (readProtectedDbMsg.status !== 'read') {
    throw new Error(`TEST F FAILED: Message status was downgraded from 'read' to '${readProtectedDbMsg.status}'`);
  }
  console.log('✅ TEST F PASSED: Read status protected; never downgraded to "delivered"');

  // --------------------------------------------------------------------------
  // TEST G — INVALID RECEIVER
  // --------------------------------------------------------------------------
  console.log('\n--- TEST G: Invalid receiver validation ---');
  // Attempt with forged receiverId (e.g. Pavithra's ID)
  const invalidReceiverAck = await new Promise((resolve) => {
    socketRahul.emit(
      'message_delivered',
      { messageId: incomingForRahul.id, receiverId: pavithra.id },
      resolve
    );
  });
  console.log('Invalid receiver response:', invalidReceiverAck);

  if (invalidReceiverAck.success !== false) {
    throw new Error('TEST G FAILED: Server accepted message_delivered with mismatched receiverId');
  }
  console.log('✅ TEST G PASSED: Server rejected delivery attempt with invalid receiverId');

  // --------------------------------------------------------------------------
  // TEST H — UNAUTHENTICATED SOCKET
  // --------------------------------------------------------------------------
  console.log('\n--- TEST H: Unauthenticated socket validation ---');
  const socketUnauth = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((r) => socketUnauth.on('connect', r));

  const unauthAck = await new Promise((resolve) => {
    socketUnauth.emit(
      'message_delivered',
      { messageId: incomingForRahul.id, receiverId: rahul.id },
      resolve
    );
  });
  console.log('Unauthenticated socket response:', unauthAck);

  if (unauthAck.success !== false) {
    throw new Error('TEST H FAILED: Server accepted message_delivered from unauthenticated socket');
  }
  socketUnauth.disconnect();
  console.log('✅ TEST H PASSED: Server safely rejected unauthenticated delivery attempt without crashing');

  // --------------------------------------------------------------------------
  // TEST I — NONEXISTENT MESSAGE
  // --------------------------------------------------------------------------
  console.log('\n--- TEST I: Nonexistent message validation ---');
  const fakeMessageId = new mongoose.Types.ObjectId().toString();
  const fakeMsgAck = await new Promise((resolve) => {
    socketRahul.emit(
      'message_delivered',
      { messageId: fakeMessageId, receiverId: rahul.id },
      resolve
    );
  });
  console.log('Nonexistent message response:', fakeMsgAck);

  if (fakeMsgAck.success !== false) {
    throw new Error('TEST I FAILED: Server succeeded for nonexistent messageId');
  }
  console.log('✅ TEST I PASSED: Server safely returned error for nonexistent message without crashing');

  // Cleanup
  socketPavithra.disconnect();
  socketRahul.disconnect();
  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 6.1 DELIVERED MESSAGE STATUS TESTS PASSED!');
  console.log('================================================================\n');
}

testPhase6Delivered().catch((err) => {
  console.error('\n❌ Phase 6.1 Test Failed:', err);
  process.exit(1);
});
