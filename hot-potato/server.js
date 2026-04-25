const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();
const ROOM_TTL_MS = 60 * 60 * 1000;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function makeId() {
  return crypto.randomBytes(8).toString('hex');
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room) {
  const base = {
    type: 'state',
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    currentIndex: room.currentIndex,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: !!p.ws,
    })),
  };
  for (const p of room.players) {
    send(p.ws, { ...base, you: p.id });
  }
}

function scheduleCleanup(code) {
  setTimeout(() => {
    const r = rooms.get(code);
    if (!r) return;
    const anyConnected = r.players.some((p) => p.ws);
    if (!anyConnected) rooms.delete(code);
  }, ROOM_TTL_MS);
}

wss.on('connection', (ws) => {
  let myRoom = null;
  let myPlayer = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === 'create_room') {
      const name = (msg.name || 'Player').toString().slice(0, 24).trim() || 'Player';
      const code = makeCode();
      const id = makeId();
      const player = { id, name, ws };
      const room = {
        code,
        hostId: id,
        started: false,
        currentIndex: 0,
        players: [player],
      };
      rooms.set(code, room);
      myRoom = room;
      myPlayer = player;
      broadcast(room);
      return;
    }

    if (msg.type === 'join_room') {
      const code = (msg.code || '').toString().toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        return send(ws, { type: 'error', message: 'Room not found' });
      }

      if (msg.playerId) {
        const existing = room.players.find((p) => p.id === msg.playerId);
        if (existing) {
          if (existing.ws && existing.ws !== ws) {
            try { existing.ws.close(); } catch {}
          }
          existing.ws = ws;
          if (msg.name) {
            const trimmed = msg.name.toString().slice(0, 24).trim();
            if (trimmed) existing.name = trimmed;
          }
          myRoom = room;
          myPlayer = existing;
          broadcast(room);
          return;
        }
      }

      if (room.started) {
        return send(ws, { type: 'error', message: 'Game already started' });
      }
      const name = (msg.name || 'Player').toString().slice(0, 24).trim() || 'Player';
      const id = makeId();
      const player = { id, name, ws };
      room.players.push(player);
      myRoom = room;
      myPlayer = player;
      broadcast(room);
      return;
    }

    if (!myRoom || !myPlayer) return;
    const isHost = myPlayer.id === myRoom.hostId;

    if (msg.type === 'rename') {
      const trimmed = (msg.name || '').toString().slice(0, 24).trim();
      if (trimmed) {
        myPlayer.name = trimmed;
        broadcast(myRoom);
      }
      return;
    }

    if (msg.type === 'start_game' && isHost) {
      if (myRoom.players.length < 2) {
        return send(ws, { type: 'error', message: 'Need at least 2 players' });
      }
      myRoom.started = true;
      myRoom.currentIndex = 0;
      broadcast(myRoom);
      return;
    }

    if (msg.type === 'pass') {
      if (!myRoom.started) return;
      const current = myRoom.players[myRoom.currentIndex];
      if (!current || current.id !== myPlayer.id) return;
      myRoom.currentIndex = (myRoom.currentIndex + 1) % myRoom.players.length;
      broadcast(myRoom);
      return;
    }

    if (msg.type === 'skip' && isHost) {
      if (!myRoom.started || myRoom.players.length === 0) return;
      myRoom.currentIndex = (myRoom.currentIndex + 1) % myRoom.players.length;
      broadcast(myRoom);
      return;
    }

    if (msg.type === 'reset' && isHost) {
      myRoom.started = false;
      myRoom.currentIndex = 0;
      broadcast(myRoom);
      return;
    }
  });

  ws.on('close', () => {
    if (!myRoom || !myPlayer) return;
    if (myPlayer.ws === ws) myPlayer.ws = null;
    const anyConnected = myRoom.players.some((p) => p.ws);
    if (!anyConnected) {
      scheduleCleanup(myRoom.code);
    } else {
      broadcast(myRoom);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hot potato listening on http://localhost:${PORT}`);
});
