import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Server } from 'socket.io';

const { Pool } = pg;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_ORIGIN ? process.env.FRONTEND_ORIGIN.split(',').map(x => x.trim()) : true, methods: ['GET', 'POST'] },
});
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ? process.env.FRONTEND_ORIGIN.split(',').map(x => x.trim()) : true }));
app.use(express.json({ limit: '1mb' }));

const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
}) : null;
const memoryRooms = new Map();
const subscriptions = new Map();
const memoryDailyScores = new Map();
async function init() {
  if (pool) await pool.query(`
    CREATE TABLE IF NOT EXISTS qz_rooms (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      status TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS qz_rooms_code_status_idx ON qz_rooms(code, status);
    CREATE TABLE IF NOT EXISTS qz_daily_scores (day TEXT NOT NULL, player_id TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL CHECK (score >= 0 AND score <= 5), updated_at BIGINT NOT NULL, PRIMARY KEY (day, player_id));
    CREATE INDEX IF NOT EXISTS qz_daily_scores_rank_idx ON qz_daily_scores(day, score DESC, updated_at ASC);
  `);
}
async function saveRoom(room) {
  if (pool) {
    await pool.query(
      'INSERT INTO qz_rooms (id, code, status, data, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET code=$2,status=$3,data=$4',
      [room.id, room.code, room.status, JSON.stringify(room), room.created_at]
    );
  } else memoryRooms.set(room.id, room);
  const targets = [...(subscriptions.get(room.id) || [])];
  if (targets.length) io.to(targets).emit('entity.update', { v: 1, type: 'entity.update', payload: { entity_type: 'room', entity_id: room.id, data: room } });
}
async function getRoom(id) {
  if (pool) {
    const result = await pool.query('SELECT data FROM qz_rooms WHERE id=$1', [id]);
    return result.rows[0]?.data || null;
  }
  return memoryRooms.get(id) || null;
}
async function allRooms() {
  if (pool) return (await pool.query('SELECT data FROM qz_rooms ORDER BY created_at DESC LIMIT 500')).rows.map(r => r.data);
  return [...memoryRooms.values()].slice(-500);
}
function fail(res, status, message) { return res.status(status).json({ error: message }); }
function roomResponse(room) { return { room }; }
function cleanName(value) { return typeof value === 'string' ? value.trim().slice(0, 24) : ''; }
function codeFor() { return String(Math.floor(100000 + Math.random() * 900000)); }
async function route(req, res) {
  try {
    const { method, path } = req;
    if (method === 'GET' && path === '/api/_healthcheck') return res.json({ message: 'Success' });
    if (method === 'GET' && path === '/api/daily/leaderboard') {
      const day = String(req.query.day || new Date().toISOString().slice(0, 10));
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) return fail(res, 400, 'Invalid challenge date.');
      let entries;
      if (pool) {
        const result = await pool.query('SELECT name, score, updated_at FROM qz_daily_scores WHERE day=$1 ORDER BY score DESC, updated_at ASC LIMIT 50', [day]);
        entries = result.rows.map(r => ({ name: r.name, score: Number(r.score), updated_at: Number(r.updated_at) }));
      } else {
        entries = [...memoryDailyScores.values()].filter(x => x.day === day).sort((a,b) => b.score-a.score || a.updated_at-b.updated_at).slice(0,50);
      }
      return res.json({ day, entries });
    }
    if (method === 'POST' && path === '/api/daily/score') {
      const day = String(req.body?.day || '');
      const player_id = String(req.body?.player_id || '').trim().slice(0, 100);
      const name = cleanName(req.body?.name).slice(0, 18);
      const score = Number(req.body?.score);
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day) || day !== new Date().toISOString().slice(0,10)) return fail(res, 400, 'Scores can only be submitted for today’s challenge.');
      if (!player_id || !name || !Number.isInteger(score) || score < 0 || score > 5) return fail(res, 400, 'Enter a leaderboard name and a score from 0 to 5.');
      const updated_at = Date.now();
      let best_score = score;
      if (pool) {
        const result = await pool.query('INSERT INTO qz_daily_scores(day, player_id, name, score, updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(day,player_id) DO UPDATE SET name=EXCLUDED.name, score=GREATEST(qz_daily_scores.score,EXCLUDED.score), updated_at=CASE WHEN EXCLUDED.score > qz_daily_scores.score THEN EXCLUDED.updated_at ELSE qz_daily_scores.updated_at END RETURNING score', [day,player_id,name,score,updated_at]);
        best_score = Number(result.rows[0].score);
      } else {
        const key = day + ':' + player_id;
        const prior = memoryDailyScores.get(key);
        best_score = Math.max(prior?.score || 0, score);
        memoryDailyScores.set(key, { day, player_id, name, score: best_score, updated_at: prior && prior.score >= score ? prior.updated_at : updated_at });
      }
      return res.json({ ok: true, best_score });
    }
    if (method === 'GET' && path.startsWith('/api/rooms/')) {
      const id = decodeURIComponent(path.slice('/api/rooms/'.length));
      const room = await getRoom(id);
      return room ? res.json(roomResponse(room)) : fail(res, 404, 'Room not found.');
    }
    if (method === 'POST' && path === '/api/rooms') {
      const host = cleanName(req.body?.host_name);
      const questions = Array.isArray(req.body?.questions) ? req.body.questions.slice(0, 20) : [];
      if (!host || !questions.length) return fail(res, 400, 'Add a host name and at least one question.');
      for (const q of questions) {
        if (!q || typeof q.text !== 'string' || !q.text.trim() || !Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => typeof o !== 'string' || !o.trim()) || !Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) {
          return fail(res, 400, 'Each question needs a prompt, four options and one correct answer.');
        }
        q.text = q.text.trim().slice(0, 240);
        q.options = q.options.map(o => o.trim().slice(0, 120));
        q.seconds = Math.min(60, Math.max(5, Number(q.seconds) || 15));
        q.explanation = String(q.explanation || '').slice(0, 500);
      }
      let code = codeFor();
      const existing = await allRooms();
      for (let attempt = 0; attempt < 10 && existing.some(r => r.code === code && r.status !== 'finished'); attempt++) code = codeFor();
      const room = { id: randomUUID(), code, host_name: host, status: 'lobby', current_index: 0, questions, players: [], answers: {}, question_started_at: 0, created_at: Date.now() };
      await saveRoom(room);
      return res.json(roomResponse(room));
    }
    if (method === 'POST' && path === '/api/rooms/join') {
      const code = String(req.body?.code || '').trim();
      const name = cleanName(req.body?.name);
      if (!/^\d{6}$/.test(code) || !name) return fail(res, 400, 'Enter a valid PIN and player name.');
      const room = (await allRooms()).find(r => r.code === code && r.status === 'lobby');
      if (!room) return fail(res, 404, 'That PIN is invalid or the game has already started.');
      if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return fail(res, 409, 'That name is already taken in this room.');
      const player = { id: 'p_' + randomUUID().replaceAll('-', '').slice(0, 12), room_id: room.id, name, score: 0, joined_at: Date.now() };
      room.players.push(player);
      await saveRoom(room);
      return res.json({ room, player });
    }
    const match = path.match(/^\/api\/rooms\/([^/]+)\/(start|answer|advance)$/);
    if (method === 'POST' && match) {
      const room = await getRoom(decodeURIComponent(match[1]));
      if (!room) return fail(res, 404, 'Room not found.');
      const action = match[2];
      if (action === 'start') {
        if (cleanName(req.body?.host_name) !== room.host_name) return fail(res, 403, 'Only the host can start this game.');
        if (room.status !== 'lobby') return fail(res, 409, 'This game has already started.');
        if (!room.players.length) return fail(res, 400, 'At least one player must join first.');
        room.status = 'question'; room.current_index = 0; room.answers = {}; room.question_started_at = Date.now();
      } else if (action === 'answer') {
        const playerId = String(req.body?.player_id || '');
        const answer = Number(req.body?.answer);
        const player = room.players.find(p => p.id === playerId);
        const question = room.questions[room.current_index];
        if (!player || !Number.isInteger(answer) || answer < 0 || answer > 3) return fail(res, 400, 'Invalid player or answer.');
        if (room.status !== 'question' || !question) return fail(res, 409, 'This question is not accepting answers.');
        if (Date.now() > room.question_started_at + question.seconds * 1000) return fail(res, 409, 'Time is up.');
        if (room.answers[playerId] !== undefined) return fail(res, 409, 'Your answer is already locked.');
        const correct = answer === question.answer;
        const elapsed = Date.now() - room.question_started_at;
        const speedBonus = correct ? Math.max(0, Math.round((1 - elapsed / (question.seconds * 1000)) * 500)) : 0;
        const multiplier = room.current_index === room.questions.length - 1 ? 2 : 1;
        room.answers[playerId] = answer;
        room.players = room.players.map(p => p.id === playerId ? { ...p, score: p.score + (correct ? (1000 + speedBonus) * multiplier : 0), last_answer: answer, answered: true } : p);
      } else {
        if (cleanName(req.body?.host_name) !== room.host_name) return fail(res, 403, 'Only the host can advance the game.');
        if (room.status === 'lobby' || room.status === 'finished') return fail(res, 409, 'The game cannot advance from this state.');
        if (room.status === 'question') {
          room.status = 'results';
          room.last_question_correct = room.questions[room.current_index].answer;
        } else if (room.current_index >= room.questions.length - 1) {
          room.status = 'finished';
        } else {
          room.status = 'question'; room.current_index += 1; room.answers = {}; room.question_started_at = Date.now();
          room.players = room.players.map(p => ({ ...p, answered: false, last_answer: undefined }));
        }
      }
      await saveRoom(room);
      return res.json(roomResponse(room));
    }
    if (method === 'POST' && path === '/api/subscriptions') {
      const { entity_type, entity_id, connection_id } = req.body || {};
      if (!entity_type || !entity_id || !connection_id) return fail(res, 400, 'entity_type, entity_id and connection_id are required.');
      if (entity_type === 'room') {
        if (!subscriptions.has(entity_id)) subscriptions.set(entity_id, new Set());
        subscriptions.get(entity_id).add(connection_id);
      }
      return res.json({ ok: true });
    }
    if (method === 'POST' && path === '/api/subscriptions/remove') {
      const { entity_id, connection_id } = req.body || {};
      subscriptions.get(entity_id)?.delete(connection_id);
      return res.json({ ok: true });
    }
    return fail(res, 404, 'Route not found.');
  } catch (error) {
    console.error(error);
    return fail(res, 500, 'Server error. Please try again.');
  }
}
app.use(route);
io.on('connection', socket => {
  socket.on('disconnect', () => {
    for (const ids of subscriptions.values()) ids.delete(socket.id);
  });
});
const port = Number(process.env.PORT || 10000);
init().then(() => server.listen(port, '0.0.0.0', () => console.log('QZ API listening on ' + port))).catch(error => {
  console.error('Database initialization failed', error);
  process.exit(1);
});
