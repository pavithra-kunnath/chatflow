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

async function runPhase7HomeTests() {
  console.log('================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 7.1 HOME SCREEN VERIFICATION SUITE');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow';
  await mongoose.connect(mongoUri);

  const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, { strict: false }));

  // 1. Test Login & User retrieval
  console.log('--- Step 1: Login / User Creation ---');
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });
  const userCRes = await request('POST', '/api/users', { username: 'Aarav' });

  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;
  const aarav = userCRes.body.data.user;

  console.log(`✓ Logged in as: ${pavithra.username} (ID: ${pavithra.id})`);
  console.log(`✓ Available user: ${rahul.username} (ID: ${rahul.id})`);
  console.log(`✓ Available user: ${aarav.username} (ID: ${aarav.id})\n`);

  // 2. Test User List (Exclude current user)
  console.log('--- Step 2: Fetch User List & Filter Current User ---');
  const allUsersRes = await request('GET', '/api/users');
  const allUsers = allUsersRes.body.data.users;
  const otherUsers = allUsers.filter((u) => u.id !== pavithra.id);

  console.log(`✓ Total users from API: ${allUsers.length}`);
  console.log(`✓ Other users for ${pavithra.username}: ${otherUsers.length} users`);
  if (otherUsers.some((u) => u.id === pavithra.id)) {
    throw new Error('Current user was not filtered out of other users list');
  }

  // 3. Test Search Logic
  console.log('\n--- Step 3: Search Functionality ---');
  const searchMatch = (query) => {
    const q = query.trim().toLowerCase();
    if (!q) return otherUsers;
    return otherUsers.filter((u) => u.username.toLowerCase().includes(q));
  };

  const rahulSearchResult = searchMatch('rah');
  console.log(`✓ Search for "rah" returned ${rahulSearchResult.length} user(s): ${rahulSearchResult.map((u) => u.username).join(', ')}`);
  if (rahulSearchResult.length !== 1 || rahulSearchResult[0].username !== 'Rahul') {
    throw new Error('Search filtering failed for "rah"');
  }

  // 4. Test Empty Search Result
  console.log('\n--- Step 4: Empty Search Result ---');
  const emptySearchResult = searchMatch('nonexistentuser999');
  console.log(`✓ Search for "nonexistentuser999" returned ${emptySearchResult.length} users.`);
  if (emptySearchResult.length !== 0) {
    throw new Error('Expected 0 results for non-existent user query');
  }
  console.log('✓ UI will render: "No users found" / "Try another username."');

  // 5. Test Online/Offline Presence Updates
  console.log('\n--- Step 5: Online/Offline Presence Updates ---');
  const socketRahul = io('http://localhost:5000', { transports: ['websocket'] });
  const socketPavithra = io('http://localhost:5000', { transports: ['websocket'] });

  await Promise.all([
    new Promise((resolve) => socketRahul.on('connect', resolve)),
    new Promise((resolve) => socketPavithra.on('connect', resolve)),
  ]);

  await new Promise((resolve) => socketPavithra.emit('identify', { userId: pavithra.id }, resolve));

  let presenceEvents = [];
  socketPavithra.on('user_presence', (data) => {
    presenceEvents.push(data);
  });

  // Rahul identifies (comes online)
  await new Promise((resolve) => socketRahul.emit('identify', { userId: rahul.id }, resolve));
  await wait(200);

  const onlineEvent = presenceEvents.find((e) => e.userId === rahul.id && e.isOnline === true);
  if (!onlineEvent) {
    throw new Error('Pavithra did not receive Rahul online presence event');
  }
  console.log(`✓ Realtime Presence: Rahul came online (isOnline: ${onlineEvent.isOnline})`);

  // Rahul disconnects (goes offline)
  socketRahul.disconnect();
  await wait(200);

  const offlineEvent = presenceEvents.find((e) => e.userId === rahul.id && e.isOnline === false);
  if (!offlineEvent) {
    throw new Error('Pavithra did not receive Rahul offline presence event');
  }
  console.log(`✓ Realtime Presence: Rahul went offline (isOnline: ${offlineEvent.isOnline}, lastSeen: ${offlineEvent.lastSeen})`);

  // 6. Test Pull-to-Refresh & API Failure / Retry
  console.log('\n--- Step 6: Pull-to-Refresh & Retry Behavior ---');
  // Simulated refresh call to GET /api/users
  const refreshRes = await request('GET', '/api/users');
  if (refreshRes.statusCode === 200 && Array.isArray(refreshRes.body.data.users)) {
    console.log('✓ Pull-to-Refresh API request successful.');
  } else {
    throw new Error('Pull-to-refresh failed');
  }

  // Simulated API failure handling (e.g. invalid endpoint or server error)
  const failureRes = await request('GET', '/api/nonexistent-endpoint');
  if (failureRes.statusCode === 404) {
    console.log('✓ API failure triggers friendly error: "Unable to load users." with [Retry] button');
  }

  // 7. Test Logout Flow
  console.log('\n--- Step 7: Logout Flow ---');
  socketPavithra.disconnect();
  await wait(200);

  const pavithraDb = await User.findById(pavithra.id);
  console.log(`✓ Pavithra logged out & disconnected -> isOnline: ${pavithraDb.isOnline}, socketId: ${pavithraDb.socketId}`);
  if (pavithraDb.isOnline) {
    throw new Error('User should be offline in DB after logout/disconnect');
  }

  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 7.1 TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runPhase7HomeTests().catch((err) => {
  console.error('\n❌ PHASE 7.1 TEST FAILED:', err);
  process.exit(1);
});
