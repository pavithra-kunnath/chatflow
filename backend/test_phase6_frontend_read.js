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

async function testFrontendReadStatus() {
  console.log('========================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 6.3 FRONTEND READ STATUS INTEGRATION TEST');
  console.log('========================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow';
  await mongoose.connect(mongoUri);

  const Message = mongoose.model('Message', new mongoose.Schema({}, { strict: false }));

  // 1. Fetch users
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });
  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;

  const conversationId = [pavithra.id, rahul.id].sort().join('_');

  // 2. Setup simulated frontend state for Pavithra
  let pavithraMessagesState = [];
  const setPavithraMessages = (updater) => {
    if (typeof updater === 'function') {
      pavithraMessagesState = updater(pavithraMessagesState);
    } else {
      pavithraMessagesState = updater;
    }
  };

  // 3. Connect Sockets
  const socketPavithra = io('http://localhost:5000', { transports: ['websocket'] });
  const socketRahul = io('http://localhost:5000', { transports: ['websocket'] });

  await Promise.all([
    new Promise((resolve) => socketPavithra.on('connect', resolve)),
    new Promise((resolve) => socketRahul.on('connect', resolve)),
  ]);

  await new Promise((resolve) => socketPavithra.emit('identify', { userId: pavithra.id }, resolve));
  await new Promise((resolve) => socketRahul.emit('identify', { userId: rahul.id }, resolve));

  await new Promise((resolve) => socketPavithra.emit('join_conversation', { conversationId }, resolve));
  await new Promise((resolve) => socketRahul.emit('join_conversation', { conversationId }, resolve));

  // Simulated ChatScreen handleStatus on Pavithra's side
  socketPavithra.on('message_status', (data) => {
    if (!data || !data.messageId) return;
    if (data.conversationId && data.conversationId !== conversationId) return;

    if (data.status === 'read') {
      setPavithraMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId
            ? { ...m, status: 'read', readAt: data.readAt || new Date().toISOString() }
            : m
        )
      );
    } else if (data.status === 'delivered') {
      setPavithraMessages((prev) =>
        prev.map((m) => {
          if (m.id !== data.messageId) return m;
          if (m.status === 'read') return m;
          return { ...m, status: 'delivered', deliveredAt: data.deliveredAt || new Date().toISOString() };
        })
      );
    }
  });

  // Simulated ChatScreen on Rahul's side: receiving incoming message while viewing chat
  socketRahul.on('new_message', (msg) => {
    if (msg.conversationId === conversationId && msg.receiverId === rahul.id) {
      // ChatScreen automatically marks delivered and read when active
      socketRahul.emit('message_delivered', { messageId: msg.id, receiverId: rahul.id });
      socketRahul.emit('message_read', { messageId: msg.id, readerId: rahul.id });
    }
  });

  // Step 1: Pavithra sends message
  console.log('--- Step 1: Pavithra sends message ---');
  let sentMsg;
  await new Promise((resolve) => {
    socketPavithra.emit('send_message', {
      senderId: pavithra.id,
      receiverId: rahul.id,
      conversationId,
      content: 'Hello read status test',
    }, (res) => {
      sentMsg = res.data.message;
      setPavithraMessages((prev) => [...prev, sentMsg]);
      resolve();
    });
  });

  const initialBubble = pavithraMessagesState.find((m) => m.id === sentMsg.id);
  const initialTick = initialBubble.status === 'read' ? '✓✓' : initialBubble.status === 'delivered' ? '✓✓' : '✓';
  console.log(`Pavithra immediate UI: "${initialBubble.content}" -> Status: ${initialBubble.status} [${initialTick}]`);
  if (initialTick !== '✓') {
    throw new Error('Initial tick should be ✓');
  }

  // Step 2: Rahul receives and automatically emits message_delivered and message_read
  await wait(250);

  const updatedBubble = pavithraMessagesState.find((m) => m.id === sentMsg.id);
  const updatedTick = updatedBubble.status === 'read' ? '✓✓ (cyan)' : updatedBubble.status === 'delivered' ? '✓✓' : '✓';
  console.log(`Pavithra updated UI: "${updatedBubble.content}" -> Status: ${updatedBubble.status} [${updatedTick}]`);

  if (updatedBubble.status === 'read' && updatedBubble.readAt) {
    console.log('✅ UI successfully transitioned from ✓ to ✓✓ (cyan) without page refresh!');
  } else {
    throw new Error(`UI did not transition to read state. Current status: ${updatedBubble.status}`);
  }

  // Step 3: Verify no duplicates in UI
  if (pavithraMessagesState.filter((m) => m.id === sentMsg.id).length === 1) {
    console.log('✅ Duplicate check PASSED: Exactly 1 message bubble in state.');
  } else {
    throw new Error('Duplicate message bubbles found in UI state');
  }

  // Step 4: Verify MongoDB state
  const dbDoc = await Message.findById(sentMsg.id);
  if (dbDoc.status === 'read' && dbDoc.readAt && dbDoc.deliveredAt) {
    console.log(`✅ MongoDB record verified: status="read", readAt=${dbDoc.readAt}`);
  } else {
    throw new Error('MongoDB record did not match expected read state');
  }

  socketPavithra.disconnect();
  socketRahul.disconnect();
  await mongoose.disconnect();

  console.log('\n========================================================================');
  console.log('🎉 PHASE 6.3 FRONTEND READ STATUS INTEGRATION TEST PASSED!');
  console.log('========================================================================\n');
}

testFrontendReadStatus().catch((err) => {
  console.error('\n❌ TEST RUNNER ERROR:', err);
  process.exit(1);
});
