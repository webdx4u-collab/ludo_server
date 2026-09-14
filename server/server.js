/**
 * Real-time WebSocket Relay Server for Flutter Ludo Game
 * Deployable on Render, Railway, Heroku, AWS, DigitalOcean, or any VPS.
 */

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// In-Memory active rooms: Map<roomCode, { state, clients: Map<playerId, ws> }>
const rooms = new Map();

// Helper to normalize room code (e.g. "944375" -> "LUDO-944375")
function normalizeRoomCode(code) {
  if (!code) return '';
  let clean = String(code).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!clean.startsWith('LUDO-') && /^\d+$/.test(clean)) {
    clean = `LUDO-${clean}`;
  }
  return clean;
}

// HTTP server for health checks, room inspection & WebSocket upgrade
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/rooms') {
    const activeRooms = [];
    for (const [code, roomObj] of rooms.entries()) {
      activeRooms.push({
        roomCode: code,
        status: roomObj.state.status,
        playerCount: roomObj.state.players.length,
        maxPlayers: roomObj.state.maxPlayers,
        players: roomObj.state.players.map((p) => ({ id: p.id, name: p.name, color: p.color, isReady: p.isReady })),
      });
    }
    res.writeHead(200);
    res.end(JSON.stringify({ activeRoomsCount: rooms.size, rooms: activeRooms }));
    return;
  }

  res.writeHead(200);
  res.end(JSON.stringify({
    status: 'ok',
    service: 'Royal Ludo Multiplayer WebSocket Server',
    activeRooms: rooms.size,
  }));
});

const wss = new WebSocketServer({ server });

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
          const cleanCode = normalizeRoomCode(roomCode);
          currentRoomCode = cleanCode;
          currentPlayerId = senderId;

          const hostPlayer = {
            id: senderId,
            name: playerName || 'Host Player',
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

          console.log(`[Room Created] ${cleanCode} by "${playerName}" (${senderId}). Total rooms: ${rooms.size}`);

          ws.send(JSON.stringify({
            type: 'roomUpdate',
            senderId: 'server',
            data: roomState,
          }));
          break;
        }

        case 'quickMatch': {
          const { maxPlayers, playerName } = data;
          const targetMax = parseInt(maxPlayers) || 2;
          console.log(`[Quick Match Request] from "${playerName}" (${senderId}) for ${targetMax} players`);

          // 1. Search for an open waiting matchmaking room for this player count
          let matchedRoomCode = null;
          let matchedRoomObj = null;

          for (const [code, roomObj] of rooms.entries()) {
            if (
              roomObj.state.status === 'waiting' &&
              roomObj.state.maxPlayers === targetMax &&
              roomObj.state.players.length < targetMax &&
              !roomObj.state.players.some((p) => p.id === senderId)
            ) {
              matchedRoomCode = code;
              matchedRoomObj = roomObj;
              break;
            }
          }

          if (matchedRoomObj) {
            // Join existing waiting room
            currentRoomCode = matchedRoomCode;
            currentPlayerId = senderId;

            const allColors = targetMax === 2
              ? ['red', 'yellow']
              : (targetMax === 3
                  ? ['red', 'green', 'yellow']
                  : ['red', 'green', 'yellow', 'blue']);
            const usedColors = new Set(matchedRoomObj.state.players.map((p) => p.color));
            const availableColor = allColors.find((c) => !usedColors.has(c)) || (targetMax === 2 ? 'yellow' : 'green');

            const newPlayer = {
              id: senderId,
              name: playerName || `Player ${matchedRoomObj.state.players.length + 1}`,
              color: availableColor,
              isHost: false,
              isBot: false,
              isReady: true,
            };

            matchedRoomObj.state.players.push(newPlayer);
            matchedRoomObj.clients.set(senderId, ws);

            console.log(`[Quick Match Success] "${playerName}" joined room "${matchedRoomCode}" (${matchedRoomObj.state.players.length}/${targetMax})`);

            broadcastToRoom(matchedRoomCode, {
              type: 'roomUpdate',
              senderId: 'server',
              data: matchedRoomObj.state,
            });

            // If room is now full, auto-start game
            if (matchedRoomObj.state.players.length >= targetMax) {
              matchedRoomObj.state.status = 'playing';
              console.log(`[Auto Start Game] Matchmaking room "${matchedRoomCode}" is full! Starting game.`);
              setTimeout(() => {
                broadcastToRoom(matchedRoomCode, {
                  type: 'startGame',
                  senderId: 'server',
                  data: matchedRoomObj.state,
                });
              }, 600);
            }
          } else {
            // Create a new public matchmaking room
            const newCode = `MATCH-${targetMax}P-${Math.floor(1000 + Math.random() * 9000)}`;
            currentRoomCode = newCode;
            currentPlayerId = senderId;

            const hostPlayer = {
              id: senderId,
              name: playerName || 'Player 1',
              color: 'red',
              isHost: true,
              isBot: false,
              isReady: true,
            };

            const roomState = {
              roomCode: newCode,
              maxPlayers: targetMax,
              players: [hostPlayer],
              status: 'waiting',
              hostId: senderId,
            };

            const clientsMap = new Map();
            clientsMap.set(senderId, ws);

            rooms.set(newCode, {
              state: roomState,
              clients: clientsMap,
            });

            console.log(`[Quick Match Queue Created] ${newCode} waiting for ${targetMax - 1} more players.`);

            ws.send(JSON.stringify({
              type: 'roomUpdate',
              senderId: 'server',
              data: roomState,
            }));
          }
          break;
        }

        case 'join': {
          const { roomCode, name } = data;
          const cleanCode = normalizeRoomCode(roomCode);
          console.log(`[Join Attempt] Request to join "${cleanCode}" by "${name}" (${senderId})`);

          const roomObj = rooms.get(cleanCode);

          if (!roomObj) {
            console.log(`[Join Failed] Room "${cleanCode}" not found. Active rooms: [${Array.from(rooms.keys()).join(', ')}]`);
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

          const allColors = roomObj.state.maxPlayers === 2
            ? ['red', 'yellow']
            : (roomObj.state.maxPlayers === 3
                ? ['red', 'green', 'yellow']
                : ['red', 'green', 'yellow', 'blue']);
          const usedColors = new Set(roomObj.state.players.map((p) => p.color));
          const availableColor = allColors.find((c) => !usedColors.has(c)) || (roomObj.state.maxPlayers === 2 ? 'yellow' : 'green');

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

          console.log(`[Player Joined] "${name}" joined "${cleanCode}". Current players: ${roomObj.state.players.length}/${roomObj.state.maxPlayers}`);

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

          const allColors = roomObj.state.maxPlayers === 2
            ? ['red', 'yellow']
            : (roomObj.state.maxPlayers === 3
                ? ['red', 'green', 'yellow']
                : ['red', 'green', 'yellow', 'blue']);
          const usedColors = new Set(roomObj.state.players.map((p) => p.color));
          const availableColor = allColors.find((c) => !usedColors.has(c)) || (roomObj.state.maxPlayers === 2 ? 'yellow' : 'green');

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
        case 'emote':
        case 'playerStatus':
        case 'playerAutoMove':
        case 'playerForfeited': {
          if (!currentRoomCode) return;
          broadcastToRoom(currentRoomCode, msg, senderId);
          break;
        }

        case 'gameStateSync': {
          if (!currentRoomCode) return;
          const roomObj = rooms.get(currentRoomCode);
          if (roomObj && data) {
            roomObj.latestGameState = data;
          }
          broadcastToRoom(currentRoomCode, msg, senderId);
          break;
        }

        case 'requestStateSync': {
          if (!currentRoomCode) return;
          const roomObj = rooms.get(currentRoomCode);
          if (roomObj && roomObj.latestGameState) {
            ws.send(JSON.stringify({
              type: 'gameStateSync',
              senderId: 'server',
              data: roomObj.latestGameState,
            }));
          }
          // Also fetch live authoritative state from active master in the room
          broadcastToRoom(currentRoomCode, msg, senderId);
          break;
        }

        case 'reconnect': {
          const { roomCode, playerId, playerName } = data;
          const cleanCode = normalizeRoomCode(roomCode);
          console.log(`[Reconnect Request] Player "${playerId}" attempting to reconnect to "${cleanCode}"`);

          const roomObj = rooms.get(cleanCode);
          if (!roomObj) {
            ws.send(JSON.stringify({
              type: 'error',
              senderId: 'server',
              data: { message: `Room "${cleanCode}" no longer active.` },
            }));
            return;
          }

          currentRoomCode = cleanCode;
          currentPlayerId = playerId || senderId;

          // Re-attach websocket client
          roomObj.clients.set(currentPlayerId, ws);
          if (roomObj.cleanupTimeout) {
            clearTimeout(roomObj.cleanupTimeout);
            roomObj.cleanupTimeout = null;
          }

          console.log(`[Reconnect Success] Player "${currentPlayerId}" reconnected to "${cleanCode}"`);

          // 1. Send current room state back to reconnected client
          ws.send(JSON.stringify({
            type: 'roomUpdate',
            senderId: 'server',
            data: roomObj.state,
          }));

          // 2. If game is in progress and server has latest game state, send it immediately
          if (roomObj.latestGameState) {
            ws.send(JSON.stringify({
              type: 'gameStateSync',
              senderId: 'server',
              data: roomObj.latestGameState,
            }));
          }

          // 3. Ask the active master player in the room for a live authoritative game state snapshot
          if (roomObj.state.status === 'playing') {
            broadcastToRoom(cleanCode, {
              type: 'requestStateSync',
              senderId: 'server',
              data: { playerId: currentPlayerId, roomCode: cleanCode },
            }, currentPlayerId);
          }

          // 4. Notify other players that player is active again
          broadcastToRoom(cleanCode, {
            type: 'playerStatus',
            senderId: currentPlayerId,
            data: {
              playerId: currentPlayerId,
              playerName: playerName,
              isAway: false,
              reason: 'reconnected',
            },
          }, currentPlayerId);
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

  console.log(`[-] Player ${playerId} socket disconnected from ${roomCode}`);
  roomObj.clients.delete(playerId);

  // If game is currently playing:
  // Do NOT immediately purge player or end the match!
  // Instead, notify room that player is disconnected / away so the 5-move auto-play clock continues
  // and the player can reconnect when they bring the app back to foreground.
  if (roomObj.state.status === 'playing') {
    broadcastToRoom(roomCode, {
      type: 'playerStatus',
      senderId: playerId,
      data: {
        playerId: playerId,
        isAway: true,
        reason: 'disconnected',
      },
    });

    // If ALL clients disconnected, schedule cleanup after 5 minutes
    let openClients = 0;
    for (const client of roomObj.clients.values()) {
      if (client.readyState === WebSocket.OPEN) openClients++;
    }
    if (openClients === 0) {
      if (!roomObj.cleanupTimeout) {
        roomObj.cleanupTimeout = setTimeout(() => {
          if (rooms.has(roomCode)) {
            let stillOpen = 0;
            const cur = rooms.get(roomCode);
            if (cur) {
              for (const c of cur.clients.values()) {
                if (c.readyState === WebSocket.OPEN) stillOpen++;
              }
              if (stillOpen === 0) {
                console.log(`[Room Cleaned Up after inactivity] ${roomCode}`);
                rooms.delete(roomCode);
              }
            }
          }
        }, 300000); // 5 minutes grace period
      }
    }
    return;
  }

  // If match was in 'waiting' / lobby status, handle standard leave:
  broadcastToRoom(roomCode, {
    type: 'playerLeft',
    senderId: playerId,
    data: {
      playerId: playerId,
      roomCode: roomCode,
    },
  });

  roomObj.state.players = roomObj.state.players.filter((p) => p.id !== playerId);

  if (roomObj.clients.size === 0 || roomObj.state.players.length === 0) {
    console.log(`[Room Closed] ${roomCode}`);
    rooms.delete(roomCode);
    return;
  }

  if (roomObj.state.hostId === playerId && roomObj.state.players.length > 0) {
    roomObj.state.hostId = roomObj.state.players[0].id;
    roomObj.state.players[0].isHost = true;
    console.log(`[Host Transferred] ${roomCode} new host is ${roomObj.state.players[0].name}`);
  }

  broadcastToRoom(roomCode, {
    type: 'roomUpdate',
    senderId: 'server',
    data: roomObj.state,
  });
}

server.listen(PORT, () => {
  console.log(`🚀 Royal Ludo WebSocket Server is running on port ${PORT}`);
});
