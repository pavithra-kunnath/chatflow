# ChatFlow — Real-Time Messaging Application

ChatFlow is a production-ready real-time 1-on-1 messaging platform built with **React Native (Expo + TypeScript)**, **Node.js + Express**, **Socket.io**, and **MongoDB**.

---

## 📁 Project Structure

```text
ChatFlow/
├── backend/
│   ├── src/
│   │   ├── config/          # MongoDB connection (Mongoose)
│   │   ├── controllers/     # Express route controllers
│   │   ├── middleware/      # Error handlers & Joi validation schemas
│   │   ├── models/          # Mongoose schemas (User, Message)
│   │   ├── routes/          # REST API endpoints (/api/health, /api/users, /api/messages)
│   │   ├── services/        # Business logic services (user, message)
│   │   ├── sockets/         # Socket.io connection, presence, typing & status handlers
│   │   ├── utils/           # Conversation ID & error helpers
│   │   ├── app.js           # Express app & middleware configuration
│   │   └── server.js        # Server entry point with HTTP & Socket.io
│   ├── .env.example
│   ├── .gitignore
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/      # Reusable UI components (MessageBubble, MessageInput, UserListItem)
│   │   ├── screens/         # Screens (SplashScreen, LoginScreen, HomeScreen, ChatScreen)
│   │   ├── services/        # Axios API client & singleton Socket.io client
│   │   ├── navigation/      # React Navigation native stack
│   │   ├── types/           # TypeScript interfaces & types
│   │   └── utils/           # Conversation ID, date formatting, storage helpers
│   ├── App.tsx              # Root component & navigation container
│   ├── .env.example
│   ├── .gitignore
│   └── package.json
├── docker-compose.yml       # MongoDB & Mongo Express containers
├── .gitignore               # Root gitignore
└── README.md
```

---

## 🛠️ Technology Stack

- **Frontend**: React Native, Expo SDK 57, TypeScript, React Navigation, Axios, Socket.io-client, AsyncStorage.
- **Backend**: Node.js, Express, Socket.io, Mongoose, Joi, CORS, Dotenv.
- **Database**: MongoDB (Local service or Dockerized container).

---

## 🏗️ Architecture & Features

### 1. REST APIs
- `GET /api/health` — Service health probe.
- `POST /api/users` — User login/registration with username validation (2–30 chars).
- `GET /api/users` — Directory of registered users (sanitized, excludes `socketId` and internal fields).
- `GET /api/users/:id` — Single user profile.
- `POST /api/messages` — Fallback/REST message dispatch.
- `GET /api/messages/:conversationId` — Chronological conversation message history with participant authorization.

### 2. Socket.io Real-Time Engine
- **Lifecycle & Gateway**: Sockets authenticate via `identify` event, associate user IDs, and join private 1-on-1 rooms (`join_conversation`).
- **Presence**: Real-time user status (`isOnline`, `lastSeen`) with multi-socket safety (closing one tab does not drop presence if another tab is active).
- **Typing Indicators**: Ephemeral `typing_start` / `typing_stop` broadcasts with ~1-second inactivity debounce. Strictly zero database writes.
- **Message Status Lifecycle**:
  $$\text{sent } (\checkmark) \longrightarrow \text{delivered } (\checkmark\checkmark) \longrightarrow \text{read } (\text{cyan } \checkmark\checkmark)$$
  - Outgoing messages display status indicators; incoming messages do not.
  - Senders receive instant `message_status` updates without page reloads.
  - Race conditions prevented using atomic MongoDB updates (`findOneAndUpdate({ _id: messageId, status: 'sent' })`), guaranteeing read status can never be downgraded.

### 3. Database Persistence
- **User Schema**: Unique index on `username`, hidden `socketId` (`select: false`), timestamp tracking.
- **Message Schema**: Compound index on `{ conversationId: 1, createdAt: 1 }` for high-performance chronological queries. Immutable sender, receiver, and conversation mappings.

---

## 🚀 Setup & Installation

### 1. Database (MongoDB)

#### Option A: Docker Compose
```bash
docker compose up -d
```
- MongoDB runs on: `mongodb://localhost:27017/chatflow`
- Mongo Express Web UI: `http://localhost:8082`

#### Option B: Local Windows Service
Verify MongoDB is running:
```powershell
Get-Service -Name MongoDB
```

---

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
npm install
npm start
```
Verify the server starts on `http://localhost:5000` and health check responds:
```bash
curl http://localhost:5000/api/health
```

---

### 3. Frontend Setup

```bash
cd frontend
cp .env.example .env
npm install
npm start
```

#### Physical Phone Testing via Expo Go
When running on physical phones, update `frontend/.env` with your computer's LAN IPv4 address (e.g., `10.112.208.30`):
```env
EXPO_PUBLIC_API_URL=http://10.112.208.30:5000/api
EXPO_PUBLIC_SOCKET_URL=http://10.112.208.30:5000
```
Ensure your computer and mobile device are connected to the same Wi-Fi network.

---

## 🧪 Testing & Verification

Run the automated test suite from the `backend/` directory:

```bash
cd backend

# Core Real-Time Messaging & Presence
node test_phase4_realtime.js
node test_phase5_presence.js
node test_phase5_typing.js

# Message Status (Sent -> Delivered -> Read)
node test_phase6_delivered.js
node test_phase6_frontend_delivered.js
node test_phase6_read.js
node test_phase6_frontend_read.js
node test_phase6_complete.js

# Reconnection & Complete Functional User Journey
node test_phase7_reconnect.js
node test_phase7_full_functional.js

# Backend REST API, Security & E2E Edge Cases
node test_phase8_backend_verification.js
node test_phase8_frontend_integration.js
node test_phase8_e2e_edge_cases.js
```

### TypeScript Validation
```bash
cd frontend
npx tsc --noEmit
# Expected output: 0 errors
```

---

## 💡 Assumptions & Design Decisions

1. **Authentication**: Uses a simplified, username-based login flow without passwords, ideal for quick testing across multiple users and browser tabs.
2. **Session Persistence**: Stored locally in AsyncStorage (`@chatflow_user`). On reload, splash screen automatically navigates authenticated users to the Home screen. Corrupted storage data is cleanly purged and routed to Login.
3. **Network Failure & Offline Experience**: When the backend server disconnects, Home and Chat display non-intrusive offline badges without crashing. Unsent messages remain preserved in the input text area for effortless retry upon reconnect.
