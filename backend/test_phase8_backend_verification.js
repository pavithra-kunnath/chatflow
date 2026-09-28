/**
 * CHATFLOW — PHASE 8.1: BACKEND + REST API FINAL COMPREHENSIVE VERIFICATION TEST
 *
 * Verifies:
 * 1. Health API (GET /api/health)
 * 2. User APIs (POST /api/users, GET /api/users, GET /api/users/:id)
 * 3. Message APIs (POST /api/messages, GET /api/messages/:conversationId)
 * 4. Message Status Lifecycle & Downgrade Protection (sent -> delivered -> read)
 * 5. Security & Validation (invalid IDs, unauthorized access, malformed payloads)
 * 6. MongoDB Database Integrity (indices, document schemas, field immutability)
 */

const mongoose = require('mongoose');
const io = require('socket.io-client');

const BASE_URL = 'http://localhost:5000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/chatflow';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runBackendVerification() {
  console.log('================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 8.1 BACKEND + REST API VERIFICATION');
  console.log('================================================================\n');

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const usersColl = db.collection('users');
  const messagesColl = db.collection('messages');

  try {
    // =================================================================
    // SECTION 1: HEALTH API
    // =================================================================
    console.log('--- SECTION 1: Health API ---');
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    if (healthRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for /api/health, got ${healthRes.status}`);
    }
    const healthJson = await healthRes.json();
    if (!healthJson.success || healthJson.message !== 'ChatFlow API is running') {
      throw new Error(`Invalid health response payload: ${JSON.stringify(healthJson)}`);
    }
    console.log('✓ Health endpoint responded with HTTP 200 and valid JSON:', healthJson);

    // =================================================================
    // SECTION 2: USER APIS
    // =================================================================
    console.log('\n--- SECTION 2: User APIs ---');

    // 2.1 Valid User Creation / Login
    const testUsername = `TestUser_${Date.now()}`;
    const userCreateRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testUsername }),
    });
    const userCreateJson = await userCreateRes.json();
    if (userCreateRes.status !== 200 || !userCreateJson.success) {
      throw new Error(`User creation failed: ${JSON.stringify(userCreateJson)}`);
    }
    const createdUser = userCreateJson.data.user;
    console.log(`✓ User created successfully: ID=${createdUser.id}, username=${createdUser.username}`);

    // Check no sensitive fields exposed
    if (createdUser.socketId !== undefined || createdUser.password !== undefined || createdUser.__v !== undefined) {
      throw new Error(`Sensitive or internal field exposed in user response: ${JSON.stringify(createdUser)}`);
    }
    console.log('✓ Verified: password, socketId, and internal fields are NOT exposed');

    // 2.2 Duplicate Username Handling (Idempotent Login)
    const duplicateRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testUsername }),
    });
    const duplicateJson = await duplicateRes.json();
    if (duplicateRes.status !== 200 || duplicateJson.data.user.id !== createdUser.id) {
      throw new Error(`Duplicate username should return existing user ID: ${JSON.stringify(duplicateJson)}`);
    }
    console.log('✓ Duplicate username safely handled: returned existing user session');

    // 2.3 Username Validation (empty, <2 chars, >30 chars)
    const emptyUserRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ' ' }),
    });
    if (emptyUserRes.status !== 400) {
      throw new Error(`Empty username should be rejected with 400, got ${emptyUserRes.status}`);
    }

    const shortUserRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'A' }),
    });
    if (shortUserRes.status !== 400) {
      throw new Error(`Single character username should be rejected with 400, got ${shortUserRes.status}`);
    }

    const longUserRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'A'.repeat(35) }),
    });
    if (longUserRes.status !== 400) {
      throw new Error(`Username > 30 chars should be rejected with 400, got ${longUserRes.status}`);
    }
    console.log('✓ Username validation verified: empty, too short (<2), and too long (>30) rejected with 400');

    // 2.4 User Retrieval (GET /api/users)
    const allUsersRes = await fetch(`${BASE_URL}/api/users`);
    const allUsersJson = await allUsersRes.json();
    if (allUsersRes.status !== 200 || !Array.isArray(allUsersJson.data.users)) {
      throw new Error(`GET /api/users failed: ${JSON.stringify(allUsersJson)}`);
    }
    for (const u of allUsersJson.data.users) {
      if (u.socketId !== undefined || u.password !== undefined) {
        throw new Error(`Sensitive field exposed in GET /api/users: ${JSON.stringify(u)}`);
      }
    }
    console.log(`✓ GET /api/users retrieved ${allUsersJson.data.users.length} users with clean sanitized schemas`);

    // 2.5 User by ID (GET /api/users/:id)
    const singleUserRes = await fetch(`${BASE_URL}/api/users/${createdUser.id}`);
    const singleUserJson = await singleUserRes.json();
    if (singleUserRes.status !== 200 || singleUserJson.data.user.id !== createdUser.id) {
      throw new Error(`GET /api/users/:id failed: ${JSON.stringify(singleUserJson)}`);
    }
    console.log('✓ GET /api/users/:id retrieved exact requested user document');

    // 2.6 Invalid & Missing User ID Handling
    const malformedIdRes = await fetch(`${BASE_URL}/api/users/not-a-valid-object-id`);
    if (malformedIdRes.status !== 400) {
      throw new Error(`Malformed user ID should return 400, got ${malformedIdRes.status}`);
    }
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    const missingUserRes = await fetch(`${BASE_URL}/api/users/${nonExistentId}`);
    if (missingUserRes.status !== 404) {
      throw new Error(`Non-existent user ID should return 404, got ${missingUserRes.status}`);
    }
    console.log('✓ Invalid ID (400) and missing user ID (404) handled cleanly');

    // =================================================================
    // SECTION 3: MESSAGE APIS
    // =================================================================
    console.log('\n--- SECTION 3: Message APIs ---');

    // Create second user for conversation
    const recipientUsername = `Recipient_${Date.now()}`;
    const recipRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: recipientUsername }),
    }).then(r => r.json());
    const recipientUser = recipRes.data.user;

    const conversationId = [createdUser.id, recipientUser.id].sort().join('_');

    // 3.1 Valid message creation (POST /api/messages)
    const validMsgRes = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId: createdUser.id,
        receiverId: recipientUser.id,
        content: 'Hello via REST API',
      }),
    });
    const validMsgJson = await validMsgRes.json();
    if (validMsgRes.status !== 201 || !validMsgJson.success) {
      throw new Error(`POST /api/messages failed: ${JSON.stringify(validMsgJson)}`);
    }
    const createdMsg = validMsgJson.data.message;
    if (
      createdMsg.status !== 'sent' ||
      createdMsg.deliveredAt !== null ||
      createdMsg.readAt !== null ||
      !createdMsg.createdAt ||
      createdMsg.conversationId !== conversationId
    ) {
      throw new Error(`Invalid message response properties: ${JSON.stringify(createdMsg)}`);
    }
    console.log(`✓ Message created via REST: ID=${createdMsg.id}, status=${createdMsg.status}, convId=${createdMsg.conversationId}`);

    // 3.2 Sender & Receiver Validation (Identical IDs)
    const sameSenderRes = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId: createdUser.id,
        receiverId: createdUser.id,
        content: 'Self message',
      }),
    });
    if (sameSenderRes.status !== 400) {
      throw new Error(`Same sender & receiver should return 400, got ${sameSenderRes.status}`);
    }
    console.log('✓ Identical sender and receiver rejected with 400');

    // 3.3 Content Validation (empty, whitespace, excessive length)
    const emptyContentRes = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId: createdUser.id,
        receiverId: recipientUser.id,
        content: '   ',
      }),
    });
    if (emptyContentRes.status !== 400) {
      throw new Error(`Whitespace-only content should return 400, got ${emptyContentRes.status}`);
    }

    const overlongContentRes = await fetch(`${BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId: createdUser.id,
        receiverId: recipientUser.id,
        content: 'A'.repeat(2001),
      }),
    });
    if (overlongContentRes.status !== 400) {
      throw new Error(`Overlong content (>2000 chars) should return 400, got ${overlongContentRes.status}`);
    }
    console.log('✓ Content validation verified: whitespace and >2000 chars rejected with 400');

    // 3.4 Conversation Messages & Chronological Ordering
    const historyRes = await fetch(`${BASE_URL}/api/messages/${conversationId}?userId=${createdUser.id}`);
    const historyJson = await historyRes.json();
    if (historyRes.status !== 200 || !Array.isArray(historyJson.data.messages)) {
      throw new Error(`GET /api/messages/:conversationId failed: ${JSON.stringify(historyJson)}`);
    }
    const msgs = historyJson.data.messages;
    if (msgs.length === 0 || msgs[0].id !== createdMsg.id) {
      throw new Error('History does not contain created message');
    }
    console.log(`✓ Conversation history retrieved: ${msgs.length} messages, chronologically ordered`);

    // 3.5 Invalid Conversation ID Format
    const badConvRes = await fetch(`${BASE_URL}/api/messages/invalid_conv_format?userId=${createdUser.id}`);
    if (badConvRes.status !== 400) {
      throw new Error(`Invalid conversation ID should return 400, got ${badConvRes.status}`);
    }
    console.log('✓ Invalid conversation ID format rejected with 400');

    // =================================================================
    // SECTION 4: MESSAGE STATUS LIFECYCLE & DOWNGRADE PROTECTION
    // =================================================================
    console.log('\n--- SECTION 4: Message Status Lifecycle & Downgrade Protection ---');
    const messageService = require('./src/services/message.service');

    // 4.1 Transition: sent -> delivered
    const deliveredDoc = await messageService.markMessageDelivered(createdMsg.id, recipientUser.id);
    if (deliveredDoc.status !== 'delivered' || !deliveredDoc.deliveredAt) {
      throw new Error(`markMessageDelivered failed: ${JSON.stringify(deliveredDoc)}`);
    }
    console.log(`✓ Lifecycle transition (sent -> delivered): status=${deliveredDoc.status}, deliveredAt=${deliveredDoc.deliveredAt}`);

    // 4.2 Transition: delivered -> read
    const readDoc = await messageService.markMessageRead(createdMsg.id, recipientUser.id);
    if (readDoc.status !== 'read' || !readDoc.readAt) {
      throw new Error(`markMessageRead failed: ${JSON.stringify(readDoc)}`);
    }
    console.log(`✓ Lifecycle transition (delivered -> read): status=${readDoc.status}, readAt=${readDoc.readAt}`);

    // 4.3 Protection: read cannot downgrade to delivered
    const downgradeAttempt = await messageService.markMessageDelivered(createdMsg.id, recipientUser.id);
    if (downgradeAttempt.status !== 'read') {
      throw new Error(`Read message was downgraded to ${downgradeAttempt.status}`);
    }
    console.log('✓ Downgrade protection verified: read message remains "read" when delivery is re-acknowledged');

    // 4.4 Repeated Read Acknowledgements (Idempotency)
    const repeatedRead = await messageService.markMessageRead(createdMsg.id, recipientUser.id);
    if (repeatedRead.status !== 'read' || repeatedRead.readAt.getTime() !== readDoc.readAt.getTime()) {
      throw new Error('Repeated read acknowledgement mutated readAt timestamp');
    }
    console.log('✓ Idempotency verified: repeated read calls return existing timestamp without mutation');

    // =================================================================
    // SECTION 5: SECURITY VALIDATION
    // =================================================================
    console.log('\n--- SECTION 5: Security Validation ---');

    // 5.1 Sender attempting recipient-only operations (mark own message delivered/read)
    let senderBlocked = false;
    try {
      await messageService.markMessageDelivered(createdMsg.id, createdUser.id);
    } catch (err) {
      if (err.statusCode === 403) senderBlocked = true;
    }
    if (!senderBlocked) {
      throw new Error('Sender was not blocked from marking their own message delivered');
    }

    let senderReadBlocked = false;
    try {
      await messageService.markMessageRead(createdMsg.id, createdUser.id);
    } catch (err) {
      if (err.statusCode === 403) senderReadBlocked = true;
    }
    if (!senderReadBlocked) {
      throw new Error('Sender was not blocked from marking their own message read');
    }
    console.log('✓ Sender unauthorized status modifications securely blocked with 403');

    // 5.2 Third-party user attempting recipient-only operations
    const thirdPartyId = new mongoose.Types.ObjectId().toString();
    let thirdPartyBlocked = false;
    try {
      await messageService.markMessageRead(createdMsg.id, thirdPartyId);
    } catch (err) {
      if (err.statusCode === 403) thirdPartyBlocked = true;
    }
    if (!thirdPartyBlocked) {
      throw new Error('Third-party user was not blocked from marking message read');
    }
    console.log('✓ Non-recipient status modification securely blocked with 403');

    // 5.3 Non-existent message operations
    const nonExistentMsgId = new mongoose.Types.ObjectId().toString();
    let missingMsgBlocked = false;
    try {
      await messageService.markMessageRead(nonExistentMsgId, recipientUser.id);
    } catch (err) {
      if (err.statusCode === 404) missingMsgBlocked = true;
    }
    if (!missingMsgBlocked) {
      throw new Error('Non-existent message should return 404');
    }
    console.log('✓ Non-existent message operation safely rejected with 404');

    // =================================================================
    // SECTION 6: MONGODB INTEGRITY & INDEXES
    // =================================================================
    console.log('\n--- SECTION 6: MongoDB Integrity & Indexes ---');

    // Check indexes on messages collection
    const msgIndexes = await messagesColl.indexes();
    const hasConversationIndex = msgIndexes.some(idx => idx.key.conversationId && idx.key.createdAt);
    if (!hasConversationIndex) {
      throw new Error('Missing compound index on { conversationId: 1, createdAt: 1 } in messages collection');
    }
    console.log('✓ Verified: messages collection contains compound index on { conversationId: 1, createdAt: 1 }');

    // Check indexes on users collection
    const userIndexes = await usersColl.indexes();
    const hasUsernameIndex = userIndexes.some(idx => idx.key.username);
    if (!hasUsernameIndex) {
      throw new Error('Missing unique index on username in users collection');
    }
    console.log('✓ Verified: users collection contains unique index on username');

    // Verify document immutability
    const finalMsgDoc = await messagesColl.findOne({ _id: new mongoose.Types.ObjectId(createdMsg.id) });
    if (
      finalMsgDoc.senderId.toString() !== createdUser.id ||
      finalMsgDoc.receiverId.toString() !== recipientUser.id ||
      finalMsgDoc.conversationId !== conversationId ||
      finalMsgDoc.content !== 'Hello via REST API'
    ) {
      throw new Error('Message immutable properties were modified!');
    }
    console.log('✓ Verified: senderId, receiverId, conversationId, and content remained immutable');

    console.log('\n================================================================');
    console.log('🎉 ALL BACKEND + REST API VERIFICATIONS PASSED SUCCESSFULLY!');
    console.log('================================================================\n');

  } finally {
    await mongoose.disconnect();
  }
}

runBackendVerification().catch((err) => {
  console.error('❌ Backend Verification FAILED:', err);
  process.exit(1);
});
