/**
 * Real-time WebSocket Relay Server for Flutter Ludo Game
 * Deployable on Render, Railway, Heroku, AWS, DigitalOcean, or any VPS.
 */

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// Create HTTP server for health checks & WebSocket upgrade
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'Royal Ludo Multiplayer Server' }));
});

const wss = new WebSocketServer({ server });

// In-Memory active rooms: Map<roomCode, { state, clients: Map<playerId, ws> }>
const rooms = new Map();

wss.on('connection', (ws) => {
  let currentRoomCode = null;
  let currentPlayerId = null;

  console.log('[+] Client connected');

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { type, senderId, data } = msg;

      switch (type) {
        case 'createRoom': {
          const { roomCode, maxPlayers, playerName } = data;
          const cleanCode = (roomCode || '').trim().toUpperCase();
          currentRoomCode = cleanCode;
          currentPlayerId = senderId;

          const hostPlayer = {
            id: senderId,
            name: playerName,
            color: 'red',
            isHost: true,
            isBot: false,
            isReady: true,
          };

          const roomState = {
            roomCode: cleanCode,
            maxPlayers: maxPlayers || 4,
            players: [hostPlayer],
            status: 'waiting',
            hostId: senderId,
          };

          const clientsMap = new Map();
          clientsMap.set(senderId, ws);

          rooms.set(cleanCode, {
            state: roomState,
            clients: clientsMap,
          });

          console.log(`[Room Created] ${cleanCode} by ${playerName} (${senderId})`);

          ws.send(JSON.stringify({
            type: 'roomUpdate',
            senderId: 'server',
            data: roomState,
          }));
          break;
        }

        case 'join': {
          let { roomCode, name } = data;
          let cleanCode = (roomCode || '').trim().toUpperCase();
          if (!cleanCode.startsWith('LUDO-') && /^\d+$/.test(cleanCode)) {
            cleanCode = `LUDO-${cleanCode}`;
          }
          const roomObj = rooms.get(cleanCode);

          if (!roomObj) {
            ws.send(JSON.stringify({
              type: 'error',
              senderId: 'server',
              data: { message: `Room "${cleanCode}" not found.` },
            }));
            return;
          }

          if (roomObj.state.players.length >= roomObj.state.maxPlayers) {
            ws.send(JSON.stringify({
              type: 'error',
              senderId: 'server',
              data: { message: `Room "${cleanCode}" is already full.` },
            }));
            return;
          }

          currentRoomCode = cleanCode;
          currentPlayerId = senderId;

          const allColors = ['red', 'green', 'yellow', 'blue'];
          const usedColors = new Set(roomObj.state.players.map((p) => p.color));
          const availableColor = allColors.find((c) => !usedColors.has(c)) || 'green';

          const newPlayer = {
            id: senderId,
            name: name || `Player ${roomObj.state.players.length + 1}`,
            color: availableColor,
            isHost: false,
            isBot: false,
            isReady: false,
          };

          roomObj.state.players.push(newPlayer);
          roomObj.clients.set(senderId, ws);

          console.log(`[Player Joined] ${name} (${senderId}) joined ${cleanCode}`);

          broadcastToRoom(cleanCode, {
            type: 'roomUpdate',
            senderId: 'server',
            data: roomObj.state,
          });
          break;
        }

        case 'toggleReady': {
          if (!currentRoomCode) return;
          const roomObj = rooms.get(currentRoomCode);
          if (!roomObj) return;

          const p = roomObj.state.players.find((player) => player.id === senderId);
          if (p) {
            p.isReady = !p.isReady;
            broadcastToRoom(currentRoomCode, {
              type: 'roomUpdate',
              senderId: 'server',
              data: roomObj.state,
            });
          }
          break;
        }

        case 'addBot': {
          if (!currentRoomCode) return;
          const roomObj = rooms.get(currentRoomCode);
          if (!roomObj || roomObj.state.players.length >= roomObj.state.maxPlayers) return;

          const allColors = ['red', 'green', 'yellow', 'blue'];
          const usedColors = new Set(roomObj.state.players.map((p) => p.color));
          const availableColor = allColors.find((c) => !usedColors.has(c)) || 'green';

          const botPlayer = {
            id: `bot_${Date.now()}`,
            name: `Bot (${availableColor.toUpperCase()})`,
            color: availableColor,
            isHost: false,
            isBot: true,
            isReady: true,
          };

          roomObj.state.players.push(botPlayer);
          broadcastToRoom(currentRoomCode, {
            type: 'roomUpdate',
            senderId: 'server',
            data: roomObj.state,
          });
          break;
        }

        case 'startGame': {
          if (!currentRoomCode) return;
          const roomObj = rooms.get(currentRoomCode);
          if (!roomObj) return;

          roomObj.state.status = 'playing';
          console.log(`[Game Started] Room ${currentRoomCode}`);

          broadcastToRoom(currentRoomCode, {
            type: 'startGame',
            senderId: senderId,
            data: roomObj.state,
          });
          break;
        }

        // Gameplay actions: Rebroadcast to all other players in the room
        case 'diceRoll':
        case 'tokenMove':
        case 'emote': {
          if (!currentRoomCode) return;
          broadcastToRoom(currentRoomCode, msg, senderId);
          break;
        }

        case 'leave': {
          handleDisconnect(currentRoomCode, currentPlayerId);
          currentRoomCode = null;
          currentPlayerId = null;
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[-] Client disconnected');
    if (currentRoomCode && currentPlayerId) {
      handleDisconnect(currentRoomCode, currentPlayerId);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket Error:', err);
  });
});

function broadcastToRoom(roomCode, messageObj, excludeSenderId = null) {
  const roomObj = rooms.get(roomCode);
  if (!roomObj) return;

  const serialized = JSON.stringify(messageObj);

  for (const [playerId, clientSocket] of roomObj.clients.entries()) {
    if (excludeSenderId && playerId === excludeSenderId) continue;
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(serialized);
    }
  }
}

function handleDisconnect(roomCode, playerId) {
  const roomObj = rooms.get(roomCode);
  if (!roomObj) return;

  roomObj.clients.delete(playerId);

  // If host leaves or room is empty, remove room
  if (roomObj.state.hostId === playerId || roomObj.clients.size === 0) {
    console.log(`[Room Closed] ${roomCode}`);
    rooms.delete(roomCode);
    return;
  }

  // Remove player or mark as disconnected
  roomObj.state.players = roomObj.state.players.filter((p) => p.id !== playerId);

  broadcastToRoom(roomCode, {
    type: 'roomUpdate',
    senderId: 'server',
    data: roomObj.state,
  });
}

server.listen(PORT, () => {
  console.log(`🚀 Royal Ludo WebSocket Server is running on port ${PORT}`);
});
