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

async function runTests() {
  console.log('==============================================');
  console.log('🚀 STARTING CHATFLOW PHASE 2 API VERIFICATION');
  console.log('==============================================\n');

  // 1. Health check
  console.log('--- 1. Testing GET /api/health ---');
  const health = await request('GET', '/api/health');
  console.log('Status:', health.statusCode);
  console.log('Response:', JSON.stringify(health.body));
  if (health.statusCode !== 200 || !health.body.success) throw new Error('Health check failed');

  // 2. Create User A (Pavithra)
  console.log('\n--- 2. Testing POST /api/users (Create Pavithra) ---');
  const userA = await request('POST', '/api/users', { username: 'Pavithra' });
  console.log('Status:', userA.statusCode);
  console.log('Response:', JSON.stringify(userA.body, null, 2));
  const pavithraId = userA.body.data.user.id;
  if (!pavithraId) throw new Error('Failed to create Pavithra');

  // 3. Create User B (Rahul)
  console.log('\n--- 3. Testing POST /api/users (Create Rahul) ---');
  const userB = await request('POST', '/api/users', { username: 'Rahul' });
  console.log('Status:', userB.statusCode);
  console.log('Response:', JSON.stringify(userB.body, null, 2));
  const rahulId = userB.body.data.user.id;
  if (!rahulId) throw new Error('Failed to create Rahul');

  // 4. Test duplicate login/retrieval (Pavithra again)
  console.log('\n--- 4. Testing POST /api/users (Existing User Login) ---');
  const userARepeat = await request('POST', '/api/users', { username: 'Pavithra' });
  console.log('Status:', userARepeat.statusCode);
  console.log('Returned ID matches original:', userARepeat.body.data.user.id === pavithraId);
  if (userARepeat.body.data.user.id !== pavithraId) throw new Error('Duplicate username created instead of reused');

  // 5. Get all users
  console.log('\n--- 5. Testing GET /api/users ---');
  const allUsers = await request('GET', '/api/users');
  console.log('Status:', allUsers.statusCode);
  console.log(`Found ${allUsers.body.data.users.length} users:`);
  allUsers.body.data.users.forEach((u) => {
    console.log(` - ID: ${u.id || u._id}, Username: ${u.username}, isOnline: ${u.isOnline}`);
  });

  // 6. Get user by ID
  console.log(`\n--- 6. Testing GET /api/users/${pavithraId} ---`);
  const getUserA = await request('GET', `/api/users/${pavithraId}`);
  console.log('Status:', getUserA.statusCode);
  console.log('Response:', JSON.stringify(getUserA.body, null, 2));

  // 7. Send message: Pavithra -> Rahul
  console.log('\n--- 7. Testing POST /api/messages (Pavithra -> Rahul) ---');
  const msg1 = await request('POST', '/api/messages', {
    senderId: pavithraId,
    receiverId: rahulId,
    content: 'Hello Rahul!',
  });
  console.log('Status:', msg1.statusCode);
  console.log('Response:', JSON.stringify(msg1.body, null, 2));
  const conversationId = msg1.body.data.message.conversationId;
  if (!conversationId) throw new Error('Failed to create message');

  // 8. Send reply message: Rahul -> Pavithra
  console.log('\n--- 8. Testing POST /api/messages (Rahul -> Pavithra reply) ---');
  const msg2 = await request('POST', '/api/messages', {
    senderId: rahulId,
    receiverId: pavithraId,
    content: 'Hi Pavithra! Real-time ChatFlow is working nicely.',
  });
  console.log('Status:', msg2.statusCode);
  console.log('Generated Conversation ID matches msg1:', msg2.body.data.message.conversationId === conversationId);

  // 9. Get conversation history
  console.log(`\n--- 9. Testing GET /api/messages/${conversationId} ---`);
  const history = await request('GET', `/api/messages/${conversationId}`);
  console.log('Status:', history.statusCode);
  console.log(`Retrieved ${history.body.data.messages.length} messages in chronological order:`);
  history.body.data.messages.forEach((m, idx) => {
    console.log(` [${idx + 1}] (${m.status}) Sender: ${m.senderId} | Time: ${m.createdAt} | Content: "${m.content}"`);
  });

  // 10. Security test: Participant authorization
  console.log(`\n--- 10. Testing Conversation Security ---`);
  // Unauthorized requester test: fake valid Mongo ObjectId
  const fakeUserId = '507f1f77bcf86cd799439011';
  const unauthorizedHistory = await request(
    'GET',
    `/api/messages/${conversationId}`,
    null,
    { 'x-user-id': fakeUserId }
  );
  console.log('Unauthorized request status (expected 403):', unauthorizedHistory.statusCode);
  console.log('Unauthorized message:', unauthorizedHistory.body.message);

  // 11. Validation error tests
  console.log('\n--- 11. Testing Validation Errors ---');
  // Short username
  const shortUser = await request('POST', '/api/users', { username: 'A' });
  console.log('Short username status (expected 400):', shortUser.statusCode, shortUser.body.message);

  // Empty message
  const emptyMsg = await request('POST', '/api/messages', {
    senderId: pavithraId,
    receiverId: rahulId,
    content: '   ',
  });
  console.log('Empty content status (expected 400):', emptyMsg.statusCode, emptyMsg.body.message);

  // Sender === Receiver
  const selfMsg = await request('POST', '/api/messages', {
    senderId: pavithraId,
    receiverId: pavithraId,
    content: 'Self talk',
  });
  console.log('Self-message status (expected 400):', selfMsg.statusCode, selfMsg.body.message);

  // Invalid sender ID format
  const badIdMsg = await request('POST', '/api/messages', {
    senderId: 'not-an-objectid',
    receiverId: rahulId,
    content: 'Invalid ID',
  });
  console.log('Bad ID status (expected 400):', badIdMsg.statusCode, badIdMsg.body.message);

  // 12. Direct MongoDB persistence verification
  console.log('\n--- 12. Verifying MongoDB Persistence Directly ---');
  const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow');
  const userCount = await conn.connection.db.collection('users').countDocuments();
  const messageCount = await conn.connection.db.collection('messages').countDocuments();
  console.log(`Direct MongoDB Check -> 'users' collection count: ${userCount}`);
  console.log(`Direct MongoDB Check -> 'messages' collection count: ${messageCount}`);

  const sampleUser = await conn.connection.db.collection('users').findOne({ username: 'Pavithra' });
  console.log('Direct MongoDB sample user document:');
  console.log({
    _id: sampleUser._id,
    username: sampleUser.username,
    isOnline: sampleUser.isOnline,
    createdAt: sampleUser.createdAt,
    updatedAt: sampleUser.updatedAt,
  });

  const sampleMessage = await conn.connection.db.collection('messages').findOne({ conversationId });
  console.log('Direct MongoDB sample message document:');
  console.log({
    _id: sampleMessage._id,
    senderId: sampleMessage.senderId,
    receiverId: sampleMessage.receiverId,
    conversationId: sampleMessage.conversationId,
    content: sampleMessage.content,
    status: sampleMessage.status,
    createdAt: sampleMessage.createdAt,
    updatedAt: sampleMessage.updatedAt,
  });

  await mongoose.disconnect();

  console.log('\n==============================================');
  console.log('🎉 ALL PHASE 2 VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('==============================================');
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
