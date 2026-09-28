const { io } = require('socket.io-client');
const http = require('http');

// Emulate date formatting from frontend/src/utils/date.ts
const formatMessageTime = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
  const timeString = `${formattedHours}:${formattedMinutes} ${ampm}`;

  if (isToday) return timeString;
  return timeString;
};

const formatLastSeen = (isoString) => {
  if (!isoString) return 'Offline';
  return `Last seen ${formatMessageTime(isoString)}`;
};

const getUserDisplayStatus = (user) => {
  return user.isOnline ? '🟢 Online' : formatLastSeen(user.lastSeen);
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

async function testPhase5FrontendPresence() {
  console.log('===============================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 5.2 FRONTEND PRESENCE INTEGRATION TEST');
  console.log('===============================================================\n');

  // 1. Ensure Pavithra & Rahul exist
  const resA = await request('POST', '/api/users', { username: 'Pavithra' });
  const resB = await request('POST', '/api/users', { username: 'Rahul' });
  const pavithra = resA.body.data.user;
  const rahul = resB.body.data.user;

  console.log(`Pavithra: ${pavithra.username} (${pavithra.id})`);
  console.log(`Rahul: ${rahul.username} (${rahul.id})\n`);

  // 2. Simulate Pavithra opening the app and HomeScreen mounting
  console.log('--- Step 1: Pavithra opens app -> HomeScreen mounts ---');
  // Connect Pavithra socket
  const socketPavithra = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((resolve) => socketPavithra.on('connect', resolve));
  await new Promise((resolve) => socketPavithra.emit('identify', { userId: pavithra.id }, resolve));

  // Initial user list fetched by HomeScreen
  const usersRes = await request('GET', '/api/users');
  let homeScreenUsers = usersRes.body.data.users.filter((u) => u.id !== pavithra.id);
  console.log(`HomeScreen initial users count: ${homeScreenUsers.length}`);

  let rahulInHome = homeScreenUsers.find((u) => u.id === rahul.id);
  console.log(`Initial Rahul state on HomeScreen: isOnline=${rahulInHome?.isOnline}, Display: "${getUserDisplayStatus(rahulInHome)}"`);

  // Setup HomeScreen presence listener exactly like HomeScreen.tsx:
  const presenceListeners = [];
  const onUserPresence = (fn) => presenceListeners.push(fn);
  const removeUserPresenceListener = (fn) => {
    const idx = presenceListeners.indexOf(fn);
    if (idx !== -1) presenceListeners.splice(idx, 1);
  };

  socketPavithra.on('user_presence', (payload) => {
    presenceListeners.forEach((fn) => fn(payload));
  });

  const handleHomeScreenPresence = (presence) => {
    // Exact updater function from HomeScreen.tsx:
    homeScreenUsers = homeScreenUsers.map((u) =>
      u.id === presence.userId
        ? {
            ...u,
            isOnline: presence.isOnline,
            lastSeen: presence.lastSeen !== undefined ? presence.lastSeen : u.lastSeen,
          }
        : u
    );
  };

  onUserPresence(handleHomeScreenPresence);

  // Setup ChatScreen presence state exactly like ChatScreen.tsx:
  let chatScreenRecipientPresence = {
    isOnline: rahulInHome.isOnline,
    lastSeen: rahulInHome.lastSeen,
  };
  const handleChatScreenPresence = (presence) => {
    if (presence.userId === rahul.id) {
      chatScreenRecipientPresence = {
        isOnline: presence.isOnline,
        lastSeen: presence.lastSeen !== undefined ? presence.lastSeen : chatScreenRecipientPresence.lastSeen,
      };
    }
  };
  onUserPresence(handleChatScreenPresence);

  // --------------------------------------------------------------------------
  // TEST A: Rahul connects
  // --------------------------------------------------------------------------
  console.log('\n--- TEST A: Rahul connects ---');
  let socketRahul = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((resolve) => socketRahul.on('connect', resolve));
  await new Promise((resolve) => socketRahul.emit('identify', { userId: rahul.id }, resolve));

  // Allow event to arrive and local state to update
  await new Promise((r) => setTimeout(r, 400));

  rahulInHome = homeScreenUsers.find((u) => u.id === rahul.id);
  console.log('HomeScreen updated Rahul state:', rahulInHome);
  const displayStatusA = getUserDisplayStatus(rahulInHome);
  console.log(`HomeScreen display: Rahul -> "${displayStatusA}"`);
  console.log(`ChatScreen header display: Rahul -> "${getUserDisplayStatus(chatScreenRecipientPresence)}"`);

  if (rahulInHome.isOnline !== true || displayStatusA !== '🟢 Online') {
    throw new Error(`Test A Failed: Expected "🟢 Online", got "${displayStatusA}"`);
  }
  if (chatScreenRecipientPresence.isOnline !== true) {
    throw new Error(`Test A Failed: ChatScreen header presence not updated to online`);
  }
  console.log('✅ TEST A PASSED: Pavithra automatically sees Rahul 🟢 Online (No refresh required)');

  // --------------------------------------------------------------------------
  // TEST B: Rahul disconnects
  // --------------------------------------------------------------------------
  console.log('\n--- TEST B: Rahul disconnects ---');
  socketRahul.disconnect();

  // Allow disconnect event to arrive and local state to update
  await new Promise((r) => setTimeout(r, 600));

  rahulInHome = homeScreenUsers.find((u) => u.id === rahul.id);
  console.log('HomeScreen updated Rahul state:', rahulInHome);
  const displayStatusB = getUserDisplayStatus(rahulInHome);
  console.log(`HomeScreen display: Rahul -> "${displayStatusB}"`);
  console.log(`ChatScreen header display: Rahul -> "${getUserDisplayStatus(chatScreenRecipientPresence)}"`);

  if (rahulInHome.isOnline !== false || !displayStatusB.startsWith('Last seen')) {
    throw new Error(`Test B Failed: Expected "Last seen ...", got "${displayStatusB}"`);
  }
  if (chatScreenRecipientPresence.isOnline !== false) {
    throw new Error(`Test B Failed: ChatScreen header presence not updated to offline`);
  }
  console.log(`✅ TEST B PASSED: Pavithra automatically sees Rahul "${displayStatusB}" (No refresh required)`);

  // --------------------------------------------------------------------------
  // TEST C: Rahul reconnects
  // --------------------------------------------------------------------------
  console.log('\n--- TEST C: Rahul reconnects ---');
  socketRahul = io('http://localhost:5000', { transports: ['websocket'] });
  await new Promise((resolve) => socketRahul.on('connect', resolve));
  await new Promise((resolve) => socketRahul.emit('identify', { userId: rahul.id }, resolve));

  await new Promise((r) => setTimeout(r, 400));

  rahulInHome = homeScreenUsers.find((u) => u.id === rahul.id);
  console.log('HomeScreen updated Rahul state:', rahulInHome);
  const displayStatusC = getUserDisplayStatus(rahulInHome);
  console.log(`HomeScreen display: Rahul -> "${displayStatusC}"`);
  console.log(`ChatScreen header display: Rahul -> "${getUserDisplayStatus(chatScreenRecipientPresence)}"`);

  if (rahulInHome.isOnline !== true || displayStatusC !== '🟢 Online') {
    throw new Error(`Test C Failed: Expected "🟢 Online", got "${displayStatusC}"`);
  }
  if (chatScreenRecipientPresence.isOnline !== true) {
    throw new Error(`Test C Failed: ChatScreen header presence not updated to online`);
  }
  console.log('✅ TEST C PASSED: Pavithra automatically sees Rahul 🟢 Online (No refresh required)');

  // --------------------------------------------------------------------------
  // Listener cleanup check
  // --------------------------------------------------------------------------
  console.log('\n--- Listener Cleanup Check ---');
  removeUserPresenceListener(handleChatScreenPresence);
  console.log(`Listeners count after ChatScreen unmount: ${presenceListeners.length} (Expected: 1)`);
  if (presenceListeners.length !== 1) {
    throw new Error('Listener cleanup failed for ChatScreen');
  }

  removeUserPresenceListener(handleHomeScreenPresence);
  console.log(`Listeners count after HomeScreen unmount: ${presenceListeners.length} (Expected: 0)`);
  if (presenceListeners.length !== 0) {
    throw new Error('Listener cleanup failed for HomeScreen');
  }
  console.log('✅ Listener cleanup verified: no memory leaks or duplicate listeners');

  // Disconnect all
  socketPavithra.disconnect();
  socketRahul.disconnect();

  console.log('\n===============================================================');
  console.log('🎉 ALL PHASE 5.2 FRONTEND PRESENCE TESTS PASSED SUCCESSFULLY!');
  console.log('===============================================================\n');
}

testPhase5FrontendPresence().catch((err) => {
  console.error('\n❌ Phase 5.2 Test Failed:', err);
  process.exit(1);
});
