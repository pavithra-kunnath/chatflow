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

async function runPhase7ChatTests() {
  console.log('================================================================');
  console.log('⚡ STARTING CHATFLOW PHASE 7.2 CHAT SCREEN & INPUT TESTS');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatflow';
  await mongoose.connect(mongoUri);

  const Message = mongoose.models.Message || mongoose.model('Message', new mongoose.Schema({}, { strict: false }));

  // 1. Setup Pavithra & Rahul
  const userARes = await request('POST', '/api/users', { username: 'Pavithra' });
  const userBRes = await request('POST', '/api/users', { username: 'Rahul' });
  const pavithra = userARes.body.data.user;
  const rahul = userBRes.body.data.user;

  const conversationId = [pavithra.id, rahul.id].sort().join('_');
  console.log(`✓ Conversation ID: ${conversationId}`);

  // 2. Open chat & verify history loading
  console.log('\n--- Step 1: Open Chat & Fetch Message History ---');
  const historyRes = await request('GET', `/api/messages/${conversationId}?userId=${pavithra.id}`);
  if (historyRes.statusCode !== 200 || !Array.isArray(historyRes.body.data.messages)) {
    throw new Error('Failed to load message history from REST');
  }
  console.log(`✓ Successfully loaded history: ${historyRes.body.data.messages.length} messages found`);

  // 3. Connect sockets and join room
  console.log('\n--- Step 2: Connect Sockets & Join Conversation Room ---');
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
  console.log('✓ Both sockets connected and joined conversation.');

  // 4. Test Typing Indicators
  console.log('\n--- Step 3: Typing Indicators ---');
  let rahulReceivedTyping = null;
  socketRahul.on('user_typing', (data) => {
    rahulReceivedTyping = data;
  });

  socketPavithra.emit('typing_start', { conversationId, userId: pavithra.id });
  await wait(150);
  if (rahulReceivedTyping && rahulReceivedTyping.isTyping === true && rahulReceivedTyping.userId === pavithra.id) {
    console.log(`✓ Typing Start verified: "${pavithra.username} is typing..."`);
  } else {
    throw new Error('Typing start event failed');
  }

  socketPavithra.emit('typing_stop', { conversationId, userId: pavithra.id });
  await wait(150);
  if (rahulReceivedTyping && rahulReceivedTyping.isTyping === false) {
    console.log('✓ Typing Stop verified.');
  } else {
    throw new Error('Typing stop event failed');
  }

  // 5. Test Sending & Receiving Normal Message with full status ticks (✓ -> ✓✓ -> cyan ✓✓)
  console.log('\n--- Step 4: Send & Receive with Status Lifecycle (✓ -> ✓✓ -> cyan ✓✓) ---');
  const pavithraStatuses = [];
  socketPavithra.on('message_status', (st) => pavithraStatuses.push(st));

  let rahulReceivedMsg = null;
  socketRahul.on('new_message', (msg) => {
    if (msg.conversationId === conversationId && msg.receiverId === rahul.id) {
      rahulReceivedMsg = msg;
    }
  });

  const sendRes = await new Promise((resolve) => {
    socketPavithra.emit('send_message', {
      senderId: pavithra.id,
      receiverId: rahul.id,
      conversationId,
      content: 'Phase 7.2 UI Polish message',
    }, resolve);
  });
  const normalMsg = sendRes.data.message;
  console.log(`✓ Sent message ID: ${normalMsg.id} -> Status: "${normalMsg.status}" [✓]`);

  await wait(150);
  if (!rahulReceivedMsg || rahulReceivedMsg.id !== normalMsg.id) {
    throw new Error('Rahul did not receive the real-time message');
  }

  // Rahul acknowledges delivery
  socketRahul.emit('message_delivered', { messageId: normalMsg.id, receiverId: rahul.id });
  await wait(150);

  const deliveredSt = pavithraStatuses.find((s) => s.messageId === normalMsg.id && s.status === 'delivered');
  if (!deliveredSt) throw new Error('Delivered status not received');
  console.log(`✓ Delivered status received: "${deliveredSt.status}" [✓✓]`);

  // Rahul views conversation -> acknowledges read
  socketRahul.emit('message_read', { messageId: normalMsg.id, readerId: rahul.id });
  await wait(150);

  const readSt = pavithraStatuses.find((s) => s.messageId === normalMsg.id && s.status === 'read');
  if (!readSt) throw new Error('Read status not received');
  console.log(`✓ Read status received: "${readSt.status}" [cyan ✓✓]`);

  // 6. Test Long Multiline Message
  console.log('\n--- Step 5: Long & Multiline Message Wrapping Test ---');
  const longContent = 'Line 1: This is a very long message designed to test multiline text wrapping and bubble width constraints in ChatFlow.\nLine 2: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\nLine 3: End of long multiline test message.';

  const longSendRes = await new Promise((resolve) => {
    socketPavithra.emit('send_message', {
      senderId: pavithra.id,
      receiverId: rahul.id,
      conversationId,
      content: longContent,
    }, resolve);
  });
  const longMsg = longSendRes.data.message;
  console.log(`✓ Long multiline message sent (ID: ${longMsg.id}, length: ${longMsg.content.length} chars)`);

  const longDbMsg = await Message.findById(longMsg.id);
  if (longDbMsg.content === longContent) {
    console.log('✓ Long message preserved with all newlines intact in MongoDB.');
  } else {
    throw new Error('Long message content corrupted');
  }

  // 7. Test Empty & Whitespace-only input validation
  console.log('\n--- Step 6: Empty & Whitespace Message Validation ---');
  const emptyRes = await new Promise((resolve) => {
    socketPavithra.emit('send_message', {
      senderId: pavithra.id,
      receiverId: rahul.id,
      conversationId,
      content: '   \n  \t  ',
    }, resolve);
  });

  if (emptyRes && emptyRes.success === false) {
    console.log(`✓ Whitespace-only message safely rejected: "${emptyRes.message}"`);
  } else {
    throw new Error('Empty whitespace message was not rejected');
  }

  // 8. Test Send Failure Handling (Invalid receiver / disconnected target)
  console.log('\n--- Step 7: Send Failure Handling ---');
  const fakeId = new mongoose.Types.ObjectId().toString();
  const failRes = await new Promise((resolve) => {
    socketPavithra.emit('send_message', {
      senderId: pavithra.id,
      receiverId: fakeId,
      conversationId: `${pavithra.id}_${fakeId}`,
      content: 'Should fail gracefully',
    }, resolve);
  });

  if (failRes && failRes.success === false) {
    console.log(`✓ Invalid receiver send safely rejected: "${failRes.message}". No message created.`);
  } else {
    throw new Error('Invalid receiver was not rejected');
  }

  // Cleanup
  socketPavithra.disconnect();
  socketRahul.disconnect();
  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 7.2 CHAT SCREEN TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runPhase7ChatTests().catch((err) => {
  console.error('\n❌ PHASE 7.2 TEST FAILED:', err);
  process.exit(1);
});
