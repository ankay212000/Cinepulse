import { closeTunnel } from './tunnel.js';

/**
 * In-Memory Watch Party Rooms Registry
 * Maps roomId -> RoomSession
 */
const activeRooms = new Map();

/**
 * Generates a random 10-character Room ID Token
 */
function generateRoomId() {
  return 'room_' + Math.random().toString(36).substring(2, 10);
}

/**
 * Creates a new Watch Party Room
 */
export function createRoom({ infoHash, magnet, fileIndex, movieTitle, hostNickname, publicUrl, localUrl, currentTime, isPaused }) {
  const roomId = generateRoomId();

  const room = {
    roomId,
    infoHash,
    magnet: magnet || (infoHash ? `magnet:?xt=urn:btih:${infoHash}` : null),
    fileIndex,
    movieTitle: movieTitle || 'Movie Stream',
    hostNickname: hostNickname || 'Host',
    publicUrl,
    localUrl,
    createdAt: Date.now(),
    playbackState: {
      currentTime: typeof currentTime === 'number' ? currentTime : 0,
      isPaused: typeof isPaused === 'boolean' ? isPaused : false,
      lastUpdated: Date.now()
    },
    members: new Map(),
    chatMessages: [
      {
        id: 'sys-welcome',
        sender: 'CineChat',
        text: '🍿 Pass the popcorn! Drop your hot takes & movie reactions live in CineChat!',
        timestamp: Date.now(),
        isSystem: true
      }
    ],
    sseClients: new Set()
  };

  // Add Host to room members
  room.members.set(room.hostNickname, {
    nickname: room.hostNickname,
    isHost: true,
    joinedAt: Date.now()
  });

  activeRooms.set(roomId, room);
  console.log(`[Room Engine] Watch Party Room Created: ${roomId} by ${hostNickname} (Movie: ${room.movieTitle})`);
  return room;
}

/**
 * Gets a Watch Party Room by ID
 */
export function getRoom(roomId) {
  return activeRooms.get(roomId);
}

/**
 * Join an existing Watch Party Room
 */
export function joinRoom(roomId, nickname) {
  const room = activeRooms.get(roomId);
  if (!room) return null;

  const sanitizedNickname = (nickname || 'Guest').trim().substring(0, 20);

  if (!room.members.has(sanitizedNickname)) {
    room.members.set(sanitizedNickname, {
      nickname: sanitizedNickname,
      isHost: false,
      joinedAt: Date.now()
    });

    // Add system notification message to room chat
    const sysMsg = {
      id: 'sys-' + Date.now(),
      sender: 'CineChat',
      text: `${sanitizedNickname} joined the Watch Party! 🍿`,
      timestamp: Date.now(),
      isSystem: true
    };
    sendRoomChatMessage(roomId, sysMsg);
  }

  // Broadcast updated room members list to all SSE clients in the room
  broadcastToRoom(roomId, 'member-update', Array.from(room.members.values()));

  return room;
}

/**
 * Sync Video Playback State (Play, Pause, Seek)
 */
export function syncPlayback(roomId, { action, currentTime, isPaused }) {
  const room = activeRooms.get(roomId);
  if (!room) return null;

  room.playbackState = {
    currentTime: typeof currentTime === 'number' ? currentTime : room.playbackState.currentTime,
    isPaused: typeof isPaused === 'boolean' ? isPaused : room.playbackState.isPaused,
    lastUpdated: Date.now()
  };

  console.log(`[Room Sync] Room ${roomId} Action: ${action} | Time: ${currentTime}s | Paused: ${isPaused}`);

  // Broadcast playback sync command to all guests in the room
  broadcastToRoom(roomId, 'playback-sync', {
    action,
    currentTime: room.playbackState.currentTime,
    isPaused: room.playbackState.isPaused,
    timestamp: room.playbackState.lastUpdated
  });

  return room.playbackState;
}

/**
 * Send a CineChat message scoped strictly to this Room ID
 */
export function sendRoomChatMessage(roomId, message) {
  const room = activeRooms.get(roomId);
  if (!room) return null;

  const msgObj = {
    id: message.id || 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    sender: message.sender || 'Guest',
    text: message.text || '',
    timestamp: message.timestamp || Date.now(),
    isSystem: !!message.isSystem
  };

  room.chatMessages.push(msgObj);
  if (room.chatMessages.length > 100) room.chatMessages.shift(); // keep last 100

  // Broadcast chat message strictly to room clients
  broadcastToRoom(roomId, 'chat-message', msgObj);

  return msgObj;
}

/**
 * Register SSE Client for a Room
 */
export function registerRoomSseClient(roomId, res) {
  const room = activeRooms.get(roomId);
  if (!room) return false;

  room.sseClients.add(res);

  // Send initial room state event
  res.write(`event: room-state\ndata: ${JSON.stringify({
    roomId: room.roomId,
    infoHash: room.infoHash,
    magnet: room.magnet,
    fileIndex: room.fileIndex,
    movieTitle: room.movieTitle,
    hostNickname: room.hostNickname,
    playbackState: room.playbackState,
    members: Array.from(room.members.values()),
    chatMessages: room.chatMessages
  })}\n\n`);

  // Heartbeat ping interval to keep Serveo / SSH HTTP2 tunnels alive
  const heartbeatTimer = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch (e) {
      clearInterval(heartbeatTimer);
    }
  }, 10000);

  res.on('close', () => {
    clearInterval(heartbeatTimer);
    if (room.sseClients) room.sseClients.delete(res);
  });

  return true;
}

/**
 * Broadcast SSE Event to all clients connected to a Room
 */
function broadcastToRoom(roomId, eventName, data) {
  const room = activeRooms.get(roomId);
  if (!room || !room.sseClients) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of room.sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      room.sseClients.delete(client);
    }
  }
}

/**
 * Update Host Nickname in Room and broadcast update
 */
export function updateRoomHostNickname(roomId, hostNickname) {
  const room = activeRooms.get(roomId);
  if (!room) return false;

  room.hostNickname = hostNickname;
  broadcastToRoom(roomId, 'room-state', {
    roomId: room.roomId,
    infoHash: room.infoHash,
    magnet: room.magnet,
    fileIndex: room.fileIndex,
    movieTitle: room.movieTitle,
    hostNickname: room.hostNickname,
    playbackState: room.playbackState,
    members: Array.from(room.members.values()),
    chatMessages: room.chatMessages
  });
  return true;
}

/**
 * Handle Guest Leaving Room
 */
export function leaveRoom(roomId, nickname) {
  const room = activeRooms.get(roomId);
  if (!room || !nickname) return false;

  if (room.members.has(nickname)) {
    room.members.delete(nickname);

    // Add System Chat Message for Leave
    const sysMsg = {
      id: 'sys-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      sender: 'System',
      text: `👋 ${nickname} left the Watch Party`,
      timestamp: Date.now(),
      isSystem: true
    };
    room.chatMessages.push(sysMsg);

    // Broadcast system message & updated members list
    broadcastToRoom(roomId, 'chat-message', sysMsg);
    broadcastToRoom(roomId, 'member-update', Array.from(room.members.values()));
    return true;
  }
  return false;
}

/**
 * Destroy a Watch Party Room and close tunnel
 */
export async function destroyRoom(roomId) {
  const room = activeRooms.get(roomId);
  if (!room) return;

  const hostName = room.hostNickname || 'Host';

  // Broadcast room-destroyed event to all connected guest browsers
  broadcastToRoom(roomId, 'room-destroyed', { 
    message: `Watch Party room was ended by Host ${hostName} 🍿`,
    hostNickname: hostName
  });

  // 1000ms flush delay to allow SSE event payload to transmit over tunnel before SSH process kill
  await new Promise(resolve => setTimeout(resolve, 1000));

  activeRooms.delete(roomId);
  await closeTunnel();
  console.log(`[Room Engine] Watch Party Room ${roomId} Destroyed by Host ${hostName}.`);
}
