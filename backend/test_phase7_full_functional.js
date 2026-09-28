/**
 * CHATFLOW — PHASE 7.5: FULL FUNCTIONAL TEST SUITE
 *
 * Verifies the complete end-to-end user lifecycle:
 * Login -> Home -> Search user -> Open Chat -> Load history ->
 * Send message -> Receive message -> Delivered -> Read -> Typing ->
 * Disconnect -> Reconnect -> Send again -> Logout
 */

const io = require('socket.io-client');
const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:5000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/chatflow';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runFullFunctionalTest() {
  console.log('================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 7.5 FULL FUNCTIONAL TEST');
  console.log('================================================================\n');

  await mongoose.connect(MONGO_URI);
  const Message = mongoose.connection.collection('messages');
  const User = mongoose.connection.collection('users');

  try {
    // -------------------------------------------------------------
    // Step 1: Login (REST API)
    // -------------------------------------------------------------
    console.log('--- Step 1: Login ---');
    const pavithraRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Pavithra' }),
    }).then((r) => r.json());

    const rahulRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Rahul' }),
    }).then((r) => r.json());

    const pavithra = pavithraRes.data.user;
    const rahul = rahulRes.data.user;
    console.log(`✓ Login success: Pavithra (${pavithra.id}), Rahul (${rahul.id})`);

    // -------------------------------------------------------------
    // Step 2: Home (Fetch all users)
    // -------------------------------------------------------------
    console.log('\n--- Step 2: Home (Fetch users) ---');
    const usersRes = await fetch(`${BASE_URL}/api/users`).then((r) => r.json());
    const allUsers = usersRes.data.users;
    if (!Array.isArray(allUsers) || allUsers.length < 2) {
      throw new Error('Failed to retrieve user list on Home');
    }
    console.log(`✓ Home retrieved ${allUsers.length} total registered users`);

    // -------------------------------------------------------------
    // Step 3: Search user
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Search user ---');
    const searchQuery = 'rahul';
    const searchResults = allUsers.filter(u => u.username.toLowerCase().includes(searchQuery));
    if (searchResults.length === 0 || searchResults[0].id !== rahul.id) {
      throw new Error(`Search failed: expected Rahul, got ${JSON.stringify(searchResults)}`);
    }
    console.log(`✓ Search for "${searchQuery}" accurately matched: ${searchResults[0].username}`);

    // -------------------------------------------------------------
    // Step 4: Open Chat (Socket setup & join room)
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Open Chat ---');
    const conversationId = [pavithra.id, rahul.id].sort().join('_');

    const socketPavithra = io(BASE_URL, { transports: ['websocket'], forceNew: true });
    const socketRahul = io(BASE_URL, { transports: ['websocket'], forceNew: true });

    await Promise.all([
      new Promise(resolve => socketPavithra.on('connect', resolve)),
      new Promise(resolve => socketRahul.on('connect', resolve)),
    ]);

    await new Promise(resolve => socketPavithra.emit('identify', { userId: pavithra.id }, resolve));
    await new Promise(resolve => socketRahul.emit('identify', { userId: rahul.id }, resolve));

    await new Promise(resolve => socketPavithra.emit('join_conversation', { conversationId }, resolve));
    await new Promise(resolve => socketRahul.emit('join_conversation', { conversationId }, resolve));
    console.log(`✓ Both sockets connected and joined conversation room: ${conversationId}`);

    // -------------------------------------------------------------
    // Step 5: Load history (REST API)
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Load history ---');
    const historyRes = await fetch(`${BASE_URL}/api/messages/${conversationId}?userId=${pavithra.id}`).then((r) => r.json());
    const existingMessages = historyRes.data.messages;
    console.log(`✓ Retrieved persistent conversation history: ${existingMessages.length} messages`);

    // -------------------------------------------------------------
    // Step 6 & 7: Send & Receive message (Socket.io)
    // -------------------------------------------------------------
    console.log('\n--- Step 6: Send message ---');
    const testContent = `Full Functional Test ${Date.now()}`;
    let sentMessageId = null;

    let rahulReceivedMessage = null;
    const receivePromise = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.content === testContent) {
          socketRahul.off('new_message', handler);
          rahulReceivedMessage = msg;
          resolve(msg);
        }
      };
      socketRahul.on('new_message', handler);
    });

    const sendRes = await new Promise((resolve) => {
      socketPavithra.emit('send_message', {
        senderId: pavithra.id,
        receiverId: rahul.id,
        conversationId,
        content: testContent,
      }, resolve);
    });

    if (!sendRes.success || !sendRes.data.message.id) {
      throw new Error(`Failed to send message: ${JSON.stringify(sendRes)}`);
    }
    sentMessageId = sendRes.data.message.id;
    console.log(`✓ Message sent by Pavithra: ID=${sentMessageId}, status=${sendRes.data.message.status} [✓]`);

    console.log('\n--- Step 7: Receive message ---');
    await receivePromise;
    console.log(`✓ Rahul received real-time new_message: "${rahulReceivedMessage.content}"`);

    // -------------------------------------------------------------
    // Step 8: Delivered (Rahul acknowledges delivery)
    // -------------------------------------------------------------
    console.log('\n--- Step 8: Delivered ---');
    const deliveredStatusPromise = new Promise((resolve) => {
      const handler = (statusPayload) => {
        if (statusPayload.messageId === sentMessageId && statusPayload.status === 'delivered') {
          socketPavithra.off('message_status', handler);
          resolve(statusPayload);
        }
      };
      socketPavithra.on('message_status', handler);
    });

    socketRahul.emit('message_delivered', { messageId: sentMessageId, receiverId: rahul.id });
    const deliveredPayload = await deliveredStatusPromise;
    console.log(`✓ Pavithra received delivered status update: status=${deliveredPayload.status} [✓✓]`);

    // -------------------------------------------------------------
    // Step 9: Read (Rahul acknowledges read)
    // -------------------------------------------------------------
    console.log('\n--- Step 9: Read ---');
    const readStatusPromise = new Promise((resolve) => {
      const handler = (statusPayload) => {
        if (statusPayload.messageId === sentMessageId && statusPayload.status === 'read') {
          socketPavithra.off('message_status', handler);
          resolve(statusPayload);
        }
      };
      socketPavithra.on('message_status', handler);
    });

    socketRahul.emit('message_read', { messageId: sentMessageId, readerId: rahul.id });
    const readPayload = await readStatusPromise;
    console.log(`✓ Pavithra received read status update: status=${readPayload.status} [cyan ✓✓] (readAt: ${readPayload.readAt})`);

    // Verify DB
    const dbDoc = await Message.findOne({ _id: new mongoose.Types.ObjectId(sentMessageId) });
    if (dbDoc.status !== 'read' || !dbDoc.deliveredAt || !dbDoc.readAt) {
      throw new Error(`DB verification failed for message: ${JSON.stringify(dbDoc)}`);
    }
    console.log('✓ Database verification confirmed: status="read", deliveredAt != null, readAt != null');

    // -------------------------------------------------------------
    // Step 10: Typing indicators
    // -------------------------------------------------------------
    console.log('\n--- Step 10: Typing ---');
    const typingStartPromise = new Promise((resolve) => {
      const handler = (data) => {
        if (data.userId === rahul.id && data.isTyping === true) {
          socketPavithra.off('user_typing', handler);
          resolve(data);
        }
      };
      socketPavithra.on('user_typing', handler);
    });

    socketRahul.emit('typing_start', { conversationId, userId: rahul.id });
    await typingStartPromise;
    console.log('✓ Pavithra received typing start from Rahul: "Rahul is typing..."');

    const typingStopPromise = new Promise((resolve) => {
      const handler = (data) => {
        if (data.userId === rahul.id && data.isTyping === false) {
          socketPavithra.off('user_typing', handler);
          resolve(data);
        }
      };
      socketPavithra.on('user_typing', handler);
    });

    socketRahul.emit('typing_stop', { conversationId, userId: rahul.id });
    await typingStopPromise;
    console.log('✓ Pavithra received typing stop from Rahul');

    // -------------------------------------------------------------
    // Step 11: Disconnect
    // -------------------------------------------------------------
    console.log('\n--- Step 11: Disconnect ---');
    socketRahul.disconnect();
    await wait(300);

    const rahulOffline = await User.findOne({ _id: new mongoose.Types.ObjectId(rahul.id) });
    if (rahulOffline.isOnline !== false) {
      throw new Error('Rahul was not marked offline after socket disconnect');
    }
    console.log('✓ Rahul disconnected and marked offline in DB');

    // -------------------------------------------------------------
    // Step 12: Reconnect
    // -------------------------------------------------------------
    console.log('\n--- Step 12: Reconnect ---');
    socketRahul.connect();
    await new Promise((resolve) => socketRahul.on('connect', resolve));
    await new Promise((resolve) => socketRahul.emit('identify', { userId: rahul.id }, resolve));
    await new Promise((resolve) => socketRahul.emit('join_conversation', { conversationId }, resolve));

    const rahulOnline = await User.findOne({ _id: new mongoose.Types.ObjectId(rahul.id) });
    if (rahulOnline.isOnline !== true) {
      throw new Error('Rahul was not marked online after reconnect');
    }
    console.log('✓ Rahul reconnected, re-identified, and marked online in DB');

    // -------------------------------------------------------------
    // Step 13: Send again post-reconnect
    // -------------------------------------------------------------
    console.log('\n--- Step 13: Send again ---');
    const postReconnectContent = 'Message after reconnect from Rahul';
    let postReconnectMsgId = null;

    const pavithraPostRecvPromise = new Promise((resolve) => {
      socketPavithra.on('new_message', (msg) => {
        if (msg.content === postReconnectContent) {
          resolve(msg);
        }
      });
    });

    const rahulSendRes = await new Promise((resolve) => {
      socketRahul.emit('send_message', {
        senderId: rahul.id,
        receiverId: pavithra.id,
        conversationId,
        content: postReconnectContent,
      }, resolve);
    });

    postReconnectMsgId = rahulSendRes.data.message.id;
    console.log(`✓ Rahul sent post-reconnect message: ID=${postReconnectMsgId}`);

    const pavithraReceivedMsg = await pavithraPostRecvPromise;
    console.log(`✓ Pavithra received post-reconnect message: "${pavithraReceivedMsg.content}"`);

    // Pavithra acknowledges delivered and read
    socketPavithra.emit('message_delivered', { messageId: postReconnectMsgId, receiverId: pavithra.id });
    socketPavithra.emit('message_read', { messageId: postReconnectMsgId, readerId: pavithra.id });
    await wait(300);

    const postDoc = await Message.findOne({ _id: new mongoose.Types.ObjectId(postReconnectMsgId) });
    if (postDoc.status !== 'read') {
      throw new Error(`Post-reconnect message not marked read: ${JSON.stringify(postDoc)}`);
    }
    console.log('✓ Post-reconnect message marked delivered and read in MongoDB');

    // -------------------------------------------------------------
    // Step 14: Logout
    // -------------------------------------------------------------
    console.log('\n--- Step 14: Logout ---');
    socketPavithra.disconnect();
    socketRahul.disconnect();
    await wait(300);

    const [finalPavithra, finalRahul] = await Promise.all([
      User.findOne({ _id: new mongoose.Types.ObjectId(pavithra.id) }),
      User.findOne({ _id: new mongoose.Types.ObjectId(rahul.id) }),
    ]);

    if (finalPavithra.isOnline !== false || finalRahul.isOnline !== false) {
      throw new Error('One or both users still marked online after logout');
    }
    console.log('✓ Logout completed: all sockets disconnected and users offline');

    console.log('\n================================================================');
    console.log('🎉 ALL 14 STEPS OF FULL FUNCTIONAL TEST PASSED SUCCESSFULLY!');
    console.log('================================================================\n');

  } finally {
    await mongoose.disconnect();
  }
}

runFullFunctionalTest().catch((err) => {
  console.error('❌ Full Functional Test FAILED:', err);
  process.exit(1);
});
