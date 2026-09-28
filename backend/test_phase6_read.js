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

async function runPhase6ReadTests() {
  console.log('================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 6.3 READ MESSAGE STATUS TEST SUITE');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow';
  await mongoose.connect(mongoUri);
  console.log('✓ Connected to MongoDB directly for verification.\n');

  const Message = mongoose.model('Message', new mongoose.Schema({}, { strict: false }));

  // Step 1: Ensure users Pavithra, Rahul, and Eve (third-party) exist
  console.log('--- Step 1: Ensure users Pavithra, Rahul, Eve exist via REST ---');
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });
  const userCRes = await request('POST', '/api/users', { username: 'Eve' });

  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;
  const eve = userCRes.body.data.user;

  console.log(`✓ Pavithra: ${pavithra.username} (${pavithra.id})`);
  console.log(`✓ Rahul:    ${rahul.username} (${rahul.id})`);
  console.log(`✓ Eve:      ${eve.username} (${eve.id})`);

  const conversationId = [pavithra.id, rahul.id].sort().join('_');
  console.log(`✓ Conversation ID: ${conversationId}\n`);

  // Step 2: Establish socket connections
  console.log('--- Step 2: Connect Socket.io clients ---');
  const socketPavithra = io('http://localhost:5000', { transports: ['websocket'] });
  const socketRahul = io('http://localhost:5000', { transports: ['websocket'] });
  const socketEve = io('http://localhost:5000', { transports: ['websocket'] });
  const socketUnauth = io('http://localhost:5000', { transports: ['websocket'] });

  await Promise.all([
    new Promise((resolve) => socketPavithra.on('connect', resolve)),
    new Promise((resolve) => socketRahul.on('connect', resolve)),
    new Promise((resolve) => socketEve.on('connect', resolve)),
    new Promise((resolve) => socketUnauth.on('connect', resolve)),
  ]);
  console.log('✓ All 4 sockets connected.');

  // Step 3: Identify sockets
  console.log('--- Step 3: Identify users on sockets ---');
  await new Promise((resolve) => socketPavithra.emit('identify', { userId: pavithra.id }, resolve));
  await new Promise((resolve) => socketRahul.emit('identify', { userId: rahul.id }, resolve));
  await new Promise((resolve) => socketEve.emit('identify', { userId: eve.id }, resolve));
  // socketUnauth intentionally left unauthenticated
  console.log('✓ Identified Pavithra, Rahul, Eve. Kept socketUnauth unauthenticated.\n');

  // Step 4: Join conversation room for Pavithra and Rahul
  await new Promise((resolve) => socketPavithra.emit('join_conversation', { conversationId }, resolve));
  await new Promise((resolve) => socketRahul.emit('join_conversation', { conversationId }, resolve));

  // Collect message_status events on Pavithra's socket
  const pavithraStatuses = [];
  socketPavithra.on('message_status', (data) => {
    console.log(`  [Pavithra Socket Event] message_status received:`, data);
    pavithraStatuses.push(data);
  });

  // Track new messages on Rahul's socket
  const rahulMessages = [];
  socketRahul.on('new_message', (msg) => {
    rahulMessages.push(msg);
  });

  // -------------------------------------------------------------
  // TEST A: Valid recipient marks delivered message as read
  // -------------------------------------------------------------
  console.log('--- Test A: Valid recipient marks delivered message as read ---');
  let testMsgA;
  await new Promise((resolve) => {
    socketPavithra.emit('send_message', {
      senderId: pavithra.id,
      receiverId: rahul.id,
      conversationId,
      content: 'Phase 6.3 Test Message A - Read flow',
    }, (res) => {
      testMsgA = res.data.message;
      resolve();
    });
  });

  await wait(100);
  // Mark delivered first
  await new Promise((resolve) => {
    socketRahul.emit('message_delivered', { messageId: testMsgA.id, receiverId: rahul.id }, resolve);
  });
  await wait(100);

  // Now mark read as recipient (Rahul)
  const ackA = await new Promise((resolve) => {
    socketRahul.emit('message_read', { messageId: testMsgA.id, readerId: rahul.id }, resolve);
  });

  await wait(100);
  const dbMsgA = await Message.findById(testMsgA.id);
  if (dbMsgA.status === 'read' && dbMsgA.readAt && dbMsgA.deliveredAt) {
    console.log(`✓ Test A PASSED: status = "${dbMsgA.status}", readAt = ${dbMsgA.readAt}, deliveredAt = ${dbMsgA.deliveredAt}`);
  } else {
    throw new Error(`Test A FAILED: status=${dbMsgA.status}, readAt=${dbMsgA.readAt}`);
  }

  // Verify Pavithra received status: "read"
  const statusReadEvent = pavithraStatuses.find((s) => s.messageId === testMsgA.id && s.status === 'read');
  if (statusReadEvent && statusReadEvent.readAt) {
    console.log(`✓ Test A PASSED: Sender received real-time "message_status" read event.\n`);
  } else {
    throw new Error(`Test A FAILED: Sender did not receive read status event`);
  }

  // -------------------------------------------------------------
  // TEST B: Sender attempts to mark their own sent message as read
  // -------------------------------------------------------------
  console.log('--- Test B: Sender attempts to mark their own sent message as read ---');
  let testMsgB;
  await new Promise((resolve) => {
    socketPavithra.emit('send_message', {
      senderId: pavithra.id,
      receiverId: rahul.id,
      conversationId,
      content: 'Phase 6.3 Test Message B - Sender cannot read own message',
    }, (res) => {
      testMsgB = res.data.message;
      resolve();
    });
  });

  await wait(100);
  // Pavithra attempts to mark it as read
  const ackB = await new Promise((resolve) => {
    socketPavithra.emit('message_read', { messageId: testMsgB.id, readerId: pavithra.id }, resolve);
  });

  await wait(100);
  const dbMsgB = await Message.findById(testMsgB.id);
  if (dbMsgB.status === 'sent' && !dbMsgB.readAt && ackB && ackB.success === false) {
    console.log(`✓ Test B PASSED: Rejected (${ackB.message}). Database status remains "${dbMsgB.status}", readAt is null.\n`);
  } else {
    throw new Error(`Test B FAILED: DB updated illegally or not rejected: status=${dbMsgB.status}`);
  }

  // -------------------------------------------------------------
  // TEST C: Unauthenticated socket attempts message_read
  // -------------------------------------------------------------
  console.log('--- Test C: Unauthenticated socket attempts message_read ---');
  const ackC = await new Promise((resolve) => {
    socketUnauth.emit('message_read', { messageId: testMsgA.id, readerId: rahul.id }, resolve);
  });
  if (ackC && ackC.success === false) {
    console.log(`✓ Test C PASSED: Safely rejected unauthenticated socket (${ackC.message}). Server remains stable.\n`);
  } else {
    throw new Error(`Test C FAILED: Unauthenticated socket was not safely rejected`);
  }

  // -------------------------------------------------------------
  // TEST D: Invalid message ID
  // -------------------------------------------------------------
  console.log('--- Test D: Invalid message ID ---');
  const ackD1 = await new Promise((resolve) => {
    socketRahul.emit('message_read', { messageId: 'invalid-mongo-id-123', readerId: rahul.id }, resolve);
  });
  const fakeId = new mongoose.Types.ObjectId().toString();
  const ackD2 = await new Promise((resolve) => {
    socketRahul.emit('message_read', { messageId: fakeId, readerId: rahul.id }, resolve);
  });

  if (ackD1 && ackD1.success === false && ackD2 && ackD2.success === false) {
    console.log(`✓ Test D PASSED: Safely rejected malformed ID (${ackD1.message}) and non-existent ID (${ackD2.message}).\n`);
  } else {
    throw new Error(`Test D FAILED: Invalid IDs did not error safely`);
  }

  // -------------------------------------------------------------
  // TEST E: Non-recipient attempts to mark message as read
  // -------------------------------------------------------------
  console.log('--- Test E: Non-recipient attempts to mark message as read ---');
  // Eve attempts to mark testMsgB (sent from Pavithra to Rahul) as read
  const ackE = await new Promise((resolve) => {
    socketEve.emit('message_read', { messageId: testMsgB.id, readerId: eve.id }, resolve);
  });

  await wait(100);
  const dbMsgE = await Message.findById(testMsgB.id);
  if (dbMsgE.status === 'sent' && !dbMsgE.readAt && ackE && ackE.success === false) {
    console.log(`✓ Test E PASSED: Rejected non-recipient (${ackE.message}). Database remains unchanged.\n`);
  } else {
    throw new Error(`Test E FAILED: Non-recipient was able to mark message or did not error`);
  }

  // -------------------------------------------------------------
  // TEST F: Repeated read acknowledgement (Idempotency)
  // -------------------------------------------------------------
  console.log('--- Test F: Repeated read acknowledgement (Idempotency) ---');
  const originalReadAt = dbMsgA.readAt.toISOString();

  // Send repeated read calls
  await Promise.all([
    new Promise((resolve) => socketRahul.emit('message_read', { messageId: testMsgA.id, readerId: rahul.id }, resolve)),
    new Promise((resolve) => socketRahul.emit('message_read', { messageId: testMsgA.id, readerId: rahul.id }, resolve)),
    new Promise((resolve) => socketRahul.emit('message_read', { messageId: testMsgA.id, readerId: rahul.id }, resolve)),
  ]);

  await wait(100);
  const dbMsgF = await Message.findById(testMsgA.id);
  const countDocs = await Message.countDocuments({ _id: testMsgA.id });

  if (
    dbMsgF.status === 'read' &&
    dbMsgF.readAt.toISOString() === originalReadAt &&
    countDocs === 1
  ) {
    console.log(`✓ Test F PASSED: Read remains read, readAt timestamp unchanged (${dbMsgF.readAt}), exactly 1 document in DB.\n`);
  } else {
    throw new Error(`Test F FAILED: Idempotency violated`);
  }

  // -------------------------------------------------------------
  // TEST G: Read cannot downgrade (read -> delivered never occurs)
  // -------------------------------------------------------------
  console.log('--- Test G: Read cannot downgrade (read -> delivered) ---');
  // Try calling message_delivered on testMsgA which is already read
  await new Promise((resolve) => {
    socketRahul.emit('message_delivered', { messageId: testMsgA.id, receiverId: rahul.id }, resolve);
  });

  await wait(100);
  const dbMsgG = await Message.findById(testMsgA.id);
  if (dbMsgG.status === 'read') {
    console.log(`✓ Test G PASSED: Status remains "${dbMsgG.status}". Attempted downgrade read -> delivered was safely blocked.\n`);
  } else {
    throw new Error(`Test G FAILED: Status was downgraded to: ${dbMsgG.status}`);
  }

  // -------------------------------------------------------------
  // SECTION 8 & 10: Two-User Realtime Flow & Full Database Verification
  // -------------------------------------------------------------
  console.log('--- Section 8 & 10: Two-User Realtime Flow & Database Verification ---');
  let realTimeMessage;
  const realtimeStatuses = [];

  const statusSub = (data) => {
    if (realTimeMessage && data.messageId === realTimeMessage.id) {
      realtimeStatuses.push(data);
    }
  };
  socketPavithra.on('message_status', statusSub);

  // 1. Pavithra sends message
  console.log('1. Pavithra sends message...');
  await new Promise((resolve) => {
    socketPavithra.emit('send_message', {
      senderId: pavithra.id,
      receiverId: rahul.id,
      conversationId,
      content: 'Realtime 2-user flow verification: Hello Rahul!',
    }, (res) => {
      realTimeMessage = res.data.message;
      resolve();
    });
  });
  console.log(`   ✓ Message created with ID: ${realTimeMessage.id}`);

  // 2. Rahul receives new_message
  await wait(150);
  const receivedByRahul = rahulMessages.find((m) => m.id === realTimeMessage.id);
  if (!receivedByRahul) {
    throw new Error('Realtime Flow FAILED: Rahul did not receive new_message event');
  }
  console.log(`2. Rahul receives new_message: "${receivedByRahul.content}"`);

  // 3. Rahul marks delivered
  console.log('3. Rahul acknowledges message_delivered...');
  await new Promise((resolve) => {
    socketRahul.emit('message_delivered', { messageId: realTimeMessage.id, receiverId: rahul.id }, resolve);
  });
  await wait(150);
  const deliveredStatus = realtimeStatuses.find((s) => s.status === 'delivered');
  if (!deliveredStatus) {
    throw new Error('Realtime Flow FAILED: Pavithra did not receive delivered status');
  }
  console.log(`   ✓ Pavithra received delivered status (tick ✓ -> ✓✓)`);

  // 4. Rahul opens/views conversation -> emits message_read
  console.log('4. Rahul views conversation and emits message_read...');
  await new Promise((resolve) => {
    socketRahul.emit('message_read', { messageId: realTimeMessage.id, readerId: rahul.id }, resolve);
  });
  await wait(150);

  // 5. Pavithra receives message_status read
  const readStatus = realtimeStatuses.find((s) => s.status === 'read');
  if (!readStatus) {
    throw new Error('Realtime Flow FAILED: Pavithra did not receive read status');
  }
  console.log(`5. Pavithra received read status (tick ✓✓ -> cyan ✓✓) (readAt: ${readStatus.readAt})`);

  // 6. DB verification
  console.log('6. Verifying MongoDB message document...');
  const finalDbDoc = await Message.findById(realTimeMessage.id);
  const totalDocs = await Message.countDocuments({ _id: realTimeMessage.id });

  if (
    finalDbDoc.status === 'read' &&
    finalDbDoc.readAt &&
    finalDbDoc.deliveredAt &&
    finalDbDoc.senderId.toString() === pavithra.id &&
    finalDbDoc.receiverId.toString() === rahul.id &&
    finalDbDoc.conversationId === conversationId &&
    finalDbDoc.content === 'Realtime 2-user flow verification: Hello Rahul!' &&
    totalDocs === 1
  ) {
    console.log('✓ Database verification PASSED:');
    console.log(`  - status:         "${finalDbDoc.status}"`);
    console.log(`  - readAt:         ${finalDbDoc.readAt}`);
    console.log(`  - deliveredAt:    ${finalDbDoc.deliveredAt}`);
    console.log(`  - senderId:       ${finalDbDoc.senderId}`);
    console.log(`  - receiverId:     ${finalDbDoc.receiverId}`);
    console.log(`  - conversationId: "${finalDbDoc.conversationId}"`);
    console.log(`  - content:        "${finalDbDoc.content}"`);
    console.log(`  - doc count:      ${totalDocs}`);
  } else {
    throw new Error('Database verification FAILED');
  }

  // Cleanup sockets & mongo
  socketPavithra.off('message_status', statusSub);
  socketPavithra.disconnect();
  socketRahul.disconnect();
  socketEve.disconnect();
  socketUnauth.disconnect();
  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 6.3 TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runPhase6ReadTests().catch((err) => {
  console.error('\n❌ TEST RUNNER ERROR:', err);
  process.exit(1);
});
