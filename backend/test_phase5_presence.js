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

async function testPhase5Presence() {
  console.log('========================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 5.1 PRESENCE BACKEND TESTS');
  console.log('========================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow';
  const conn = await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB directly for state verification.');

  // 1. Create or fetch test users: Pavithra & Rahul
  console.log('\n--- Step 1: Ensure Pavithra & Rahul exist via REST ---');
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });

  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;

  console.log(`Pavithra ID: ${pavithra.id}`);
  console.log(`Rahul ID: ${rahul.id}`);

  // 2. Connect Rahul socket (observer socket for presence events)
  console.log('\n--- Step 2: Connect Rahul socket to observe presence events ---');
  const socketRahul = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((resolve) => socketRahul.on('connect', resolve));
  await new Promise((resolve) => socketRahul.emit('identify', { userId: rahul.id }, resolve));
  console.log(`Rahul connected and identified on socket ${socketRahul.id}`);

  const rahulReceivedPresence = [];
  socketRahul.on('user_presence', (payload) => {
    console.log(`[Observer - Rahul] Received user_presence:`, payload);
    rahulReceivedPresence.push(payload);
  });

  // 3. User Online Test: Connect Pavithra
  console.log('\n--- Step 3: Test User Online (Connect Pavithra) ---');
  rahulReceivedPresence.length = 0; // Clear events

  const socketPavithra1 = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((resolve) => socketPavithra1.on('connect', resolve));
  console.log(`Pavithra Socket 1 connected: ${socketPavithra1.id}`);

  const identifyResponse = await new Promise((resolve) => {
    socketPavithra1.emit('identify', { userId: pavithra.id }, resolve);
  });
  console.log('Pavithra identify callback response:', identifyResponse);

  // Verify response does not leak socketId
  if (identifyResponse.user && identifyResponse.user.socketId) {
    throw new Error('identify callback leaked socketId!');
  }

  // Wait briefly for event propagation and DB write
  await new Promise((r) => setTimeout(r, 300));

  // Verify MongoDB: isOnline = true, socketId exists
  const pavithraDbOnline = await conn.connection.db
    .collection('users')
    .findOne({ _id: new mongoose.Types.ObjectId(pavithra.id) });

  console.log('MongoDB Pavithra state after identify:', {
    isOnline: pavithraDbOnline.isOnline,
    socketId: pavithraDbOnline.socketId,
    lastSeen: pavithraDbOnline.lastSeen,
  });

  if (pavithraDbOnline.isOnline !== true) {
    throw new Error(`Expected isOnline === true, got ${pavithraDbOnline.isOnline}`);
  }
  if (!pavithraDbOnline.socketId || pavithraDbOnline.socketId !== socketPavithra1.id) {
    throw new Error(`Expected socketId === ${socketPavithra1.id}, got ${pavithraDbOnline.socketId}`);
  }

  // Verify observer received user_presence event
  const onlineEvent = rahulReceivedPresence.find(
    (e) => e.userId === pavithra.id && e.isOnline === true
  );
  if (!onlineEvent) {
    throw new Error('Rahul socket did not receive online user_presence event for Pavithra!');
  }
  if (onlineEvent.socketId !== undefined) {
    throw new Error('user_presence event leaked socketId!');
  }
  console.log('✅ Online state verified in MongoDB and realtime user_presence event verified!');

  // 4. User Offline Test: Disconnect Pavithra
  console.log('\n--- Step 4: Test User Offline (Disconnect Pavithra) ---');
  rahulReceivedPresence.length = 0;

  socketPavithra1.disconnect();
  console.log('Disconnected Pavithra Socket 1. Waiting for disconnect cleanup...');
  await new Promise((r) => setTimeout(r, 600));

  const pavithraDbOffline = await conn.connection.db
    .collection('users')
    .findOne({ _id: new mongoose.Types.ObjectId(pavithra.id) });

  console.log('MongoDB Pavithra state after disconnect:', {
    isOnline: pavithraDbOffline.isOnline,
    socketId: pavithraDbOffline.socketId,
    lastSeen: pavithraDbOffline.lastSeen,
  });

  if (pavithraDbOffline.isOnline !== false) {
    throw new Error(`Expected isOnline === false, got ${pavithraDbOffline.isOnline}`);
  }
  if (pavithraDbOffline.socketId !== null) {
    throw new Error(`Expected socketId === null, got ${pavithraDbOffline.socketId}`);
  }
  if (!pavithraDbOffline.lastSeen) {
    throw new Error('Expected lastSeen timestamp to be updated on disconnect');
  }

  const offlineEvent = rahulReceivedPresence.find(
    (e) => e.userId === pavithra.id && e.isOnline === false
  );
  if (!offlineEvent) {
    throw new Error('Rahul socket did not receive offline user_presence event for Pavithra!');
  }
  if (offlineEvent.socketId !== undefined) {
    throw new Error('user_presence offline event leaked socketId!');
  }
  console.log('✅ Offline state verified in MongoDB and realtime offline user_presence event verified!');

  // 5. User Reconnects Test
  console.log('\n--- Step 5: Test User Reconnects (Pavithra reconnects with new socket) ---');
  rahulReceivedPresence.length = 0;

  const socketPavithra2 = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((resolve) => socketPavithra2.on('connect', resolve));
  console.log(`Pavithra reconnected on Socket 2: ${socketPavithra2.id}`);

  await new Promise((resolve) => {
    socketPavithra2.emit('identify', { userId: pavithra.id }, resolve);
  });

  await new Promise((r) => setTimeout(r, 300));

  const pavithraDbReconnected = await conn.connection.db
    .collection('users')
    .findOne({ _id: new mongoose.Types.ObjectId(pavithra.id) });

  console.log('MongoDB Pavithra state after reconnect:', {
    isOnline: pavithraDbReconnected.isOnline,
    socketId: pavithraDbReconnected.socketId,
    lastSeen: pavithraDbReconnected.lastSeen,
  });

  if (pavithraDbReconnected.isOnline !== true) {
    throw new Error(`Expected isOnline === true on reconnect, got ${pavithraDbReconnected.isOnline}`);
  }
  if (!pavithraDbReconnected.socketId || pavithraDbReconnected.socketId !== socketPavithra2.id) {
    throw new Error(`Expected socketId === ${socketPavithra2.id}, got ${pavithraDbReconnected.socketId}`);
  }

  const reconnectEvent = rahulReceivedPresence.find(
    (e) => e.userId === pavithra.id && e.isOnline === true
  );
  if (!reconnectEvent) {
    throw new Error('Rahul socket did not receive reconnected user_presence event for Pavithra!');
  }
  console.log('✅ Reconnection verified in MongoDB and realtime user_presence broadcast!');

  // 6. Multiple Socket Safety Test
  console.log('\n--- Step 6: Test Multiple Socket Safety (Active socket vs old socket) ---');
  // Pavithra now opens another session (e.g. 2nd tab/device)
  const socketPavithra3 = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((resolve) => socketPavithra3.on('connect', resolve));
  console.log(`Pavithra opens Socket 3 (2nd tab): ${socketPavithra3.id}`);

  await new Promise((resolve) => {
    socketPavithra3.emit('identify', { userId: pavithra.id }, resolve);
  });
  await new Promise((r) => setTimeout(r, 300));

  // Current active socket in MongoDB should now be Socket 3
  let pavithraDbMulti = await conn.connection.db
    .collection('users')
    .findOne({ _id: new mongoose.Types.ObjectId(pavithra.id) });
  if (pavithraDbMulti.socketId !== socketPavithra3.id) {
    throw new Error(`Expected active socketId in DB to be Socket 3 (${socketPavithra3.id})`);
  }
  console.log(`Active socket updated in DB to Socket 3: ${pavithraDbMulti.socketId}`);

  // Now the OLD socket (Socket 2) disconnects
  console.log('Disconnecting old Socket 2 (while Socket 3 is still active)...');
  socketPavithra2.disconnect();
  await new Promise((r) => setTimeout(r, 600));

  // Verify Pavithra is STILL online and socketId is STILL Socket 3!
  pavithraDbMulti = await conn.connection.db
    .collection('users')
    .findOne({ _id: new mongoose.Types.ObjectId(pavithra.id) });
  console.log('MongoDB state after old Socket 2 disconnected:', {
    isOnline: pavithraDbMulti.isOnline,
    socketId: pavithraDbMulti.socketId,
  });

  if (pavithraDbMulti.isOnline !== true || pavithraDbMulti.socketId !== socketPavithra3.id) {
    throw new Error('Old socket disconnect incorrectly marked user offline or cleared active socketId!');
  }
  console.log('✅ Multiple socket safety verified: user remained online when older socket disconnected!');

  // Finally, disconnect the active socket (Socket 3)
  console.log('Now disconnecting active Socket 3...');
  socketPavithra3.disconnect();
  await new Promise((r) => setTimeout(r, 600));

  pavithraDbMulti = await conn.connection.db
    .collection('users')
    .findOne({ _id: new mongoose.Types.ObjectId(pavithra.id) });
  console.log('MongoDB state after active Socket 3 disconnected:', {
    isOnline: pavithraDbMulti.isOnline,
    socketId: pavithraDbMulti.socketId,
  });

  if (pavithraDbMulti.isOnline !== false || pavithraDbMulti.socketId !== null) {
    throw new Error('Active socket disconnect did not mark user offline!');
  }
  console.log('✅ Active socket disconnect cleanly marked user offline!');

  // Cleanup
  socketRahul.disconnect();
  await mongoose.disconnect();

  console.log('\n========================================================');
  console.log('🎉 ALL PHASE 5.1 PRESENCE TESTS PASSED SUCCESSFULLY!');
  console.log('========================================================\n');
}

testPhase5Presence().catch((err) => {
  console.error('\n❌ Phase 5.1 Presence Test Failed:', err);
  process.exit(1);
});
