import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  type ChatMessage,
  type CompetitiveRoomState,
  DIFFICULTY_META,
  type Difficulty,
  type LeaderboardRecord,
  type RoomParticipant,
  generatePuzzle,
} from './shared/puzzle.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'seositesoft21@gmail.com').trim().toLowerCase();
const adminTokens = new Set<string>();

function getCookie(req: express.Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

interface StoreData {
  leaderboard: LeaderboardRecord[];
  chat: ChatMessage[];
}

function loadStore(): StoreData {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      return {
        leaderboard: Array.isArray(parsed.leaderboard) ? parsed.leaderboard : [],
        chat: Array.isArray(parsed.chat) ? parsed.chat : [],
      };
    }
  } catch (err) {
    console.error('Failed to load store.json:', err);
  }
  return { leaderboard: [], chat: [] };
}

function saveStore(data: StoreData): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save store.json:', err);
  }
}

const store = loadStore();

function sanitizeHandle(raw: unknown): string {
  if (typeof raw !== 'string') return 'Player';
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 18);
  return cleaned.length >= 2 ? cleaned : 'Player';
}

function isValidDifficulty(val: unknown): val is Difficulty {
  return val === 'normal' || val === 'hard' || val === 'master' || val === 'heart';
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function randomRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

interface ClientConn {
  clientId: string;
  ws: WebSocket;
  handle: string;
  roomId: string | null;
}

const clients = new Map<string, ClientConn>();
const rooms = new Map<string, CompetitiveRoomState>();
const roomTimers = new Map<string, ReturnType<typeof setTimeout>>();

function ensureGlobalSprintRoom(): CompetitiveRoomState {
  const existing = rooms.get('GLOBAL');
  if (existing) return existing;
  const created: CompetitiveRoomState = {
    roomId: 'GLOBAL',
    name: 'Global Sprint',
    difficulty: 'normal',
    status: 'waiting',
    seed: Math.floor(Math.random() * 1_000_000_000),
    countdownEndsAt: null,
    startedAt: null,
    hostClientId: null,
    participants: [],
  };
  rooms.set('GLOBAL', created);
  return created;
}

ensureGlobalSprintRoom();

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastAll(payload: unknown): void {
  const msg = JSON.stringify(payload);
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

function broadcastRoom(roomId: string, payload: unknown): void {
  const msg = JSON.stringify(payload);
  for (const client of clients.values()) {
    if (client.roomId === roomId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

function getPublicRoomsList() {
  return Array.from(rooms.values()).map((r) => ({
    roomId: r.roomId,
    name: r.name,
    difficulty: r.difficulty,
    status: r.status,
    participantCount: r.participants.length,
  }));
}

function broadcastRoomsList(): void {
  broadcastAll({ type: 'rooms:list', rooms: getPublicRoomsList() });
}

function appendChatMessage(msg: ChatMessage): void {
  store.chat.push(msg);
  if (store.chat.length > 100) {
    store.chat = store.chat.slice(store.chat.length - 100);
  }
  saveStore(store);
  broadcastAll({ type: 'chat:message', message: msg });
}

function addLeaderboardEntry(entry: LeaderboardRecord): { isNewBest: boolean } {
  const previousBest = store.leaderboard
    .filter((r) => r.difficulty === entry.difficulty)
    .sort((a, b) => a.timeMs - b.timeMs)[0];

  const isNewBest = !previousBest || entry.timeMs < previousBest.timeMs;

  store.leaderboard.push(entry);
  store.leaderboard.sort((a, b) => a.timeMs - b.timeMs);
  if (store.leaderboard.length > 300) {
    store.leaderboard = store.leaderboard.slice(0, 300);
  }
  saveStore(store);
  broadcastAll({ type: 'leaderboard:update', leaderboard: store.leaderboard });
  return { isNewBest };
}

function leaveCurrentRoom(client: ClientConn): void {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  const oldRoomId = client.roomId;
  client.roomId = null;

  if (!room) return;
  room.participants = room.participants.filter((p) => p.clientId !== client.clientId);

  if (room.hostClientId === client.clientId) {
    room.hostClientId = room.participants[0]?.clientId ?? null;
  }

  if (room.participants.length === 0 && room.roomId !== 'GLOBAL') {
    const timer = roomTimers.get(oldRoomId);
    if (timer) {
      clearTimeout(timer);
      roomTimers.delete(oldRoomId);
    }
    rooms.delete(oldRoomId);
  } else {
    if (room.participants.length === 0 && room.roomId === 'GLOBAL') {
      const timer = roomTimers.get('GLOBAL');
      if (timer) {
        clearTimeout(timer);
        roomTimers.delete('GLOBAL');
      }
      room.status = 'waiting';
      room.startedAt = null;
      room.countdownEndsAt = null;
    }
    broadcastRoom(oldRoomId, { type: 'room:state', room });
  }
  broadcastRoomsList();
}

function startRoomMatch(room: CompetitiveRoomState): void {
  const existingTimer = roomTimers.get(room.roomId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    roomTimers.delete(room.roomId);
  }

  const newSeed = Math.floor(Math.random() * 1_000_000_000);
  const board = generatePuzzle(room.difficulty, newSeed);
  const totalArrows = board.arrows.length;

  room.seed = newSeed;
  room.status = 'countdown';
  room.countdownEndsAt = Date.now() + 3000;
  room.startedAt = null;
  room.participants = room.participants.map((p) => ({
    ...p,
    arrowsCleared: 0,
    totalArrows,
    heartsLeft: 3,
    mistakes: 0,
    finishedAtMs: null,
    eliminated: false,
  }));

  broadcastRoom(room.roomId, { type: 'room:state', room });
  broadcastRoomsList();

  const timer = setTimeout(() => {
    roomTimers.delete(room.roomId);
    const liveRoom = rooms.get(room.roomId);
    if (!liveRoom || liveRoom.status !== 'countdown') return;
    liveRoom.status = 'playing';
    liveRoom.startedAt = Date.now();
    liveRoom.countdownEndsAt = null;
    broadcastRoom(liveRoom.roomId, { type: 'room:state', room: liveRoom });
    broadcastRoomsList();
  }, 3000);

  roomTimers.set(room.roomId, timer);
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, online: clients.size });
  });

  app.get('/api/admin/status', (req, res) => {
    const token = getCookie(req, 'arrowout_admin');
    res.json({ isAdmin: Boolean(token && adminTokens.has(token)) });
  });

  app.post('/api/admin/login', (req, res) => {
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || email !== ADMIN_EMAIL) {
      res.status(403).json({ isAdmin: false, error: 'Invalid admin email.' });
      return;
    }
    const token = crypto.randomBytes(24).toString('hex');
    adminTokens.add(token);
    res.cookie('arrowout_admin', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ isAdmin: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    const token = getCookie(req, 'arrowout_admin');
    if (token) adminTokens.delete(token);
    res.clearCookie('arrowout_admin', { path: '/' });
    res.json({ isAdmin: false });
  });

  app.get('/api/leaderboard', (_req, res) => {
    res.json({ leaderboard: store.leaderboard });
  });

  app.post('/api/leaderboard', (req, res) => {
    const body = req.body as Partial<LeaderboardRecord>;
    if (
      !isValidDifficulty(body.difficulty) ||
      typeof body.timeMs !== 'number' ||
      !Number.isFinite(body.timeMs) ||
      body.timeMs < 500 ||
      body.timeMs > 3600_000 ||
      typeof body.seed !== 'number' ||
      typeof body.totalArrows !== 'number' ||
      typeof body.heartsLeft !== 'number' ||
      typeof body.mistakes !== 'number'
    ) {
      res.status(400).json({ error: 'Invalid leaderboard payload' });
      return;
    }

    const handle = sanitizeHandle(body.handle);
    const mode = body.mode === 'sprint' ? 'sprint' : 'solo';
    const level =
      typeof body.level === 'number' && Number.isFinite(body.level)
        ? Math.max(1, Math.min(100, Math.floor(body.level)))
        : 1;

    // Verify deterministic board arrow count matches seed, difficulty & level
    const expectedBoard = generatePuzzle(body.difficulty, body.seed, level);
    if (expectedBoard.arrows.length !== body.totalArrows) {
      res.status(400).json({ error: 'Board verification mismatch' });
      return;
    }

    const record: LeaderboardRecord = {
      id: randomId('lb'),
      handle,
      difficulty: body.difficulty,
      level,
      mode,
      timeMs: Math.round(body.timeMs),
      totalArrows: body.totalArrows,
      heartsLeft: Math.max(0, Math.min(3, Math.round(body.heartsLeft))),
      mistakes: Math.max(0, Math.round(body.mistakes)),
      seed: body.seed,
      createdAt: Date.now(),
    };

    const { isNewBest } = addLeaderboardEntry(record);

    if (isNewBest) {
      const secs = (record.timeMs / 1000).toFixed(1);
      appendChatMessage({
        id: randomId('sys'),
        handle: 'Arena',
        text: `${handle} set a new ${DIFFICULTY_META[record.difficulty].label} record of ${secs}s (${record.totalArrows} arrows).`,
        kind: 'system',
        createdAt: Date.now(),
      });
    }

    res.json({ record, isNewBest });
  });

  app.get('/api/chat', (_req, res) => {
    res.json({ messages: store.chat });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getPublicRoomsList() });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const clientId = randomId('usr');
    const client: ClientConn = {
      clientId,
      ws,
      handle: `Player-${clientId.slice(-4).toUpperCase()}`,
      roomId: null,
    };
    clients.set(clientId, client);

    sendJson(ws, {
      type: 'init',
      clientId,
      onlineCount: clients.size,
      chat: store.chat,
      leaderboard: store.leaderboard,
      rooms: getPublicRoomsList(),
    });
    broadcastAll({ type: 'presence:count', onlineCount: clients.size });

    ws.on('message', (raw) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = data.type;

      if (type === 'auth:identify') {
        const nextHandle = sanitizeHandle(data.handle);
        client.handle = nextHandle;
        if (client.roomId) {
          const room = rooms.get(client.roomId);
          if (room) {
            const p = room.participants.find((item) => item.clientId === clientId);
            if (p) {
              p.handle = nextHandle;
              broadcastRoom(room.roomId, { type: 'room:state', room });
            }
          }
        }
        sendJson(ws, { type: 'auth:confirmed', handle: nextHandle });
        return;
      }

      if (type === 'chat:send') {
        if (typeof data.text !== 'string') return;
        const text = data.text.trim().slice(0, 240);
        if (!text) return;
        const msg: ChatMessage = {
          id: randomId('msg'),
          handle: client.handle,
          text,
          kind: 'user',
          createdAt: Date.now(),
        };
        appendChatMessage(msg);
        return;
      }

      if (type === 'room:create') {
        leaveCurrentRoom(client);
        const diff: Difficulty = isValidDifficulty(data.difficulty) ? data.difficulty : 'normal';
        const name =
          typeof data.name === 'string' && data.name.trim()
            ? data.name.trim().slice(0, 28)
            : `${client.handle}'s Room`;
        let code = randomRoomCode();
        while (rooms.has(code)) code = randomRoomCode();

        const board = generatePuzzle(diff, Math.floor(Math.random() * 1_000_000_000));
        const participant: RoomParticipant = {
          clientId,
          handle: client.handle,
          arrowsCleared: 0,
          totalArrows: board.arrows.length,
          heartsLeft: 3,
          mistakes: 0,
          finishedAtMs: null,
          eliminated: false,
        };
        const room: CompetitiveRoomState = {
          roomId: code,
          name,
          difficulty: diff,
          status: 'waiting',
          seed: board.seed,
          countdownEndsAt: null,
          startedAt: null,
          hostClientId: clientId,
          participants: [participant],
        };
        rooms.set(code, room);
        client.roomId = code;
        sendJson(ws, { type: 'room:state', room });
        broadcastRoomsList();
        return;
      }

      if (type === 'room:join') {
        const targetId = typeof data.roomId === 'string' ? data.roomId.trim().toUpperCase() : 'GLOBAL';
        const room = targetId === 'GLOBAL' ? ensureGlobalSprintRoom() : rooms.get(targetId);
        if (!room) {
          sendJson(ws, { type: 'room:error', message: `Room "${targetId}" not found.` });
          return;
        }
        if (client.roomId === room.roomId) {
          sendJson(ws, { type: 'room:state', room });
          return;
        }
        leaveCurrentRoom(client);

        const board = generatePuzzle(room.difficulty, room.seed);
        if (!room.hostClientId) {
          room.hostClientId = clientId;
        }
        const participant: RoomParticipant = {
          clientId,
          handle: client.handle,
          arrowsCleared: 0,
          totalArrows: board.arrows.length,
          heartsLeft: 3,
          mistakes: 0,
          finishedAtMs: null,
          eliminated: false,
        };
        room.participants.push(participant);
        client.roomId = room.roomId;
        broadcastRoom(room.roomId, { type: 'room:state', room });
        broadcastRoomsList();
        return;
      }

      if (type === 'room:leave') {
        leaveCurrentRoom(client);
        sendJson(ws, { type: 'room:left' });
        return;
      }

      if (type === 'room:set_difficulty') {
        if (!client.roomId) return;
        const room = rooms.get(client.roomId);
        if (!room || (room.status !== 'waiting' && room.status !== 'finished')) return;
        if (room.roomId !== 'GLOBAL' && room.hostClientId !== clientId) return;
        if (!isValidDifficulty(data.difficulty)) return;
        room.difficulty = data.difficulty;
        room.seed = Math.floor(Math.random() * 1_000_000_000);
        const board = generatePuzzle(room.difficulty, room.seed);
        room.participants = room.participants.map((p) => ({
          ...p,
          arrowsCleared: 0,
          totalArrows: board.arrows.length,
          heartsLeft: 3,
          mistakes: 0,
          finishedAtMs: null,
          eliminated: false,
        }));
        broadcastRoom(room.roomId, { type: 'room:state', room });
        broadcastRoomsList();
        return;
      }

      if (type === 'room:start') {
        if (!client.roomId) return;
        const room = rooms.get(client.roomId);
        if (!room) return;
        if (room.status === 'countdown' || room.status === 'playing') return;
        if (room.roomId !== 'GLOBAL' && room.hostClientId !== clientId) return;
        startRoomMatch(room);
        return;
      }

      if (type === 'room:progress') {
        if (!client.roomId) return;
        const room = rooms.get(client.roomId);
        if (!room || room.status !== 'playing') return;
        const p = room.participants.find((item) => item.clientId === clientId);
        if (!p || p.finishedAtMs !== null || p.eliminated) return;

        if (typeof data.arrowsCleared === 'number') {
          p.arrowsCleared = Math.max(0, Math.min(p.totalArrows, Math.round(data.arrowsCleared)));
        }
        if (typeof data.heartsLeft === 'number') {
          p.heartsLeft = Math.max(0, Math.min(3, Math.round(data.heartsLeft)));
          if (p.heartsLeft <= 0) {
            p.eliminated = true;
          }
        }
        if (typeof data.mistakes === 'number') {
          p.mistakes = Math.max(0, Math.round(data.mistakes));
        }

        // Check if everyone is done or eliminated
        const everyoneDone =
          room.participants.length > 0 &&
          room.participants.every((item) => item.finishedAtMs !== null || item.eliminated);
        if (everyoneDone) {
          room.status = 'finished';
        }
        broadcastRoom(room.roomId, { type: 'room:state', room });
        return;
      }

      if (type === 'room:finish') {
        if (!client.roomId) return;
        const room = rooms.get(client.roomId);
        if (!room || room.status !== 'playing' || !room.startedAt) return;
        const p = room.participants.find((item) => item.clientId === clientId);
        if (!p || p.finishedAtMs !== null || p.eliminated) return;

        const serverElapsed = Math.max(500, Date.now() - room.startedAt);
        p.arrowsCleared = p.totalArrows;
        p.finishedAtMs = serverElapsed;
        if (typeof data.heartsLeft === 'number') {
          p.heartsLeft = Math.max(1, Math.min(3, Math.round(data.heartsLeft)));
        }
        if (typeof data.mistakes === 'number') {
          p.mistakes = Math.max(0, Math.round(data.mistakes));
        }

        const record: LeaderboardRecord = {
          id: randomId('lb'),
          handle: client.handle,
          difficulty: room.difficulty,
          mode: 'sprint',
          timeMs: serverElapsed,
          totalArrows: p.totalArrows,
          heartsLeft: p.heartsLeft,
          mistakes: p.mistakes,
          seed: room.seed,
          createdAt: Date.now(),
        };
        addLeaderboardEntry(record);

        const rankInRoom =
          room.participants.filter((item) => item.finishedAtMs !== null).length;
        if (rankInRoom === 1) {
          const secs = (serverElapsed / 1000).toFixed(1);
          appendChatMessage({
            id: randomId('sys'),
            handle: 'Arena',
            text: `${client.handle} won ${room.name} (${DIFFICULTY_META[room.difficulty].label}) in ${secs}s.`,
            kind: 'system',
            createdAt: Date.now(),
          });
        }

        const everyoneDone = room.participants.every(
          (item) => item.finishedAtMs !== null || item.eliminated
        );
        if (everyoneDone) {
          room.status = 'finished';
        }
        broadcastRoom(room.roomId, { type: 'room:state', room });
        broadcastRoomsList();
      }
    });

    ws.on('close', () => {
      leaveCurrentRoom(client);
      clients.delete(clientId);
      broadcastAll({ type: 'presence:count', onlineCount: clients.size });
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ArrowOut server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
