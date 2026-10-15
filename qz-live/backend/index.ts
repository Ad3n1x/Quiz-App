import { router, json, error, db } from '@appdeploy/sdk';
import {
  notifySubscribers,
  realtimeSubscriptionRoutes,
} from './realtime-subscribers';

type Question = {
  text: string;
  options: string[];
  answer: number;
  seconds: number;
  explanation: string;
};
type Player = {
  id: string;
  room_id: string;
  name: string;
  score: number;
  joined_at: number;
  last_answer?: number;
  answered?: boolean;
};
type Room = {
  id: string;
  code: string;
  host_name: string;
  status: 'lobby' | 'question' | 'results' | 'finished';
  current_index: number;
  questions: Question[];
  players: Player[];
  answers: Record<string, number>;
  question_started_at: number;
  created_at: number;
  last_question_correct?: number;
};
const safeRoom = (r: Room) => ({
  ...r,
  questions: r.questions.map((q, i) => ({ ...q, answer: q.answer })),
});
const roomById = async (id: string): Promise<Room | null> => {
  const [r] = await db.get<Room>('qz_rooms', [id]);
  return r ? { ...r, id } : null;
};
const publicRoom = (r: Room) => ({
  ...r,
  questions: r.questions.map(q => ({ ...q, answer: q.answer })),
});
const persistRoom = async (r: Room) => {
  const [ok] = await db.update('qz_rooms', [
    { id: r.id, record: r as unknown as Record<string, unknown> },
  ]);
  if (!ok) throw new Error('Could not save room state.');
  await notifySubscribers('room', r.id, publicRoom(r));
};
const roomResponse = (r: Room) => json({ room: publicRoom(r) });
const codeFor = () => String(Math.floor(100000 + Math.random() * 900000));
const cleanName = (n: unknown) =>
  typeof n === 'string' ? n.trim().slice(0, 24) : '';
const routes = {
  'GET /api/rooms/:id': [
    async ({ params }: any) => {
      const r = await roomById(params.id);
      return r ? roomResponse(r) : error('Room not found.', 404);
    },
  ],
  'POST /api/rooms': [
    async ({ body }: any) => {
      const input = body as { host_name?: unknown; questions?: Question[] };
      const host = cleanName(input?.host_name);
      const questions = Array.isArray(input?.questions)
        ? input.questions.slice(0, 30)
        : [];
      if (!host || questions.length < 1)
        return error('Add a host name and at least one question.', 400);
      for (const q of questions) {
        if (
          !q ||
          typeof q.text !== 'string' ||
          !q.text.trim() ||
          !Array.isArray(q.options) ||
          q.options.length !== 4 ||
          q.options.some(o => typeof o !== 'string' || !o.trim()) ||
          !Number.isInteger(q.answer) ||
          q.answer < 0 ||
          q.answer > 3
        )
          return error(
            'Each question needs a prompt, four options and one correct answer.',
            400
          );
        q.text = q.text.trim().slice(0, 240);
        q.options = q.options.map(o => o.trim().slice(0, 120));
        q.seconds = Math.min(60, Math.max(5, Number(q.seconds) || 15));
        q.explanation = String(q.explanation || '').slice(0, 500);
      }
      let code = codeFor();
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await db.list<Room>('qz_rooms', { limit: 500 });
        if (
          !existing.items.some(x => x.code === code && x.status !== 'finished')
        )
          break;
        code = codeFor();
      }
      const record = {
        code,
        host_name: host,
        status: 'lobby' as const,
        current_index: 0,
        questions,
        players: [],
        answers: {},
        question_started_at: 0,
        created_at: Date.now(),
      };
      const [id] = await db.add('qz_rooms', [record]);
      if (!id) return error('Could not create room. Please try again.', 500);
      return roomResponse({ ...record, id });
    },
  ],
  'POST /api/rooms/join': [
    async ({ body }: any) => {
      const input = body as { code?: unknown; name?: unknown };
      const code = String(input?.code || '').trim();
      const name = cleanName(input?.name);
      if (!/^\d{6}$/.test(code) || !name)
        return error('Enter a valid PIN and player name.', 400);
      const found = await db.list<Room>('qz_rooms', { limit: 500 });
      const r = found.items.find(x => x.code === code && x.status === 'lobby');
      if (!r)
        return error(
          'That PIN is invalid or the game has already started.',
          404
        );
      if (r.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
        return error('That name is already taken in this room.', 409);
      const playerId = 'p_' + Math.random().toString(36).slice(2, 12);
      const player: Player = {
        id: playerId,
        room_id: r.id,
        name,
        score: 0,
        joined_at: Date.now(),
      };
      const updated = { ...r, players: [...r.players, player] };
      await persistRoom(updated);
      return json({ room: publicRoom(updated), player });
    },
  ],
  'POST /api/rooms/:id/start': [
    async ({ params, body }: any) => {
      const r = await roomById(params.id);
      if (!r) return error('Room not found.', 404);
      if (cleanName(body?.host_name) !== r.host_name)
        return error('Only the host can start this game.', 403);
      if (r.status !== 'lobby')
        return error('This game has already started.', 409);
      if (!r.players.length)
        return error('At least one player must join first.', 400);
      const updated: Room = {
        ...r,
        status: 'question',
        current_index: 0,
        answers: {},
        question_started_at: Date.now(),
      };
      await persistRoom(updated);
      return roomResponse(updated);
    },
  ],
  'POST /api/rooms/:id/answer': [
    async ({ params, body }: any) => {
      const r = await roomById(params.id);
      if (!r) return error('Room not found.', 404);
      const playerId = String(body?.player_id || '');
      const answer = Number(body?.answer);
      const player = r.players.find(p => p.id === playerId);
      const q = r.questions[r.current_index];
      if (!player || !Number.isInteger(answer) || answer < 0 || answer > 3)
        return error('Invalid player or answer.', 400);
      if (r.status !== 'question' || !q)
        return error('This question is not accepting answers.', 409);
      if (Date.now() > r.question_started_at + q.seconds * 1000)
        return error('Time is up.', 409);
      if (r.answers[playerId] !== undefined)
        return error('Your answer is already locked.', 409);
      const correct = answer === q.answer;
      const elapsed = Date.now() - r.question_started_at;
      const speedBonus = correct
        ? Math.max(0, Math.round((1 - elapsed / (q.seconds * 1000)) * 500))
        : 0;
      // QZ signature mechanic: the final question is the Clutch Round, worth double points.
      const clutchMultiplier = r.current_index === r.questions.length - 1 ? 2 : 1;
      const updated: Room = {
        ...r,
        answers: { ...r.answers, [playerId]: answer },
        players: r.players.map(p =>
          p.id === playerId
            ? {
                ...p,
                score: p.score + (correct ? (1000 + speedBonus) * clutchMultiplier : 0),
                last_answer: answer,
                answered: true,
              }
            : p
        ),
      };
      await persistRoom(updated);
      return roomResponse(updated);
    },
  ],
  'POST /api/rooms/:id/advance': [
    async ({ params, body }: any) => {
      const r = await roomById(params.id);
      if (!r) return error('Room not found.', 404);
      if (cleanName(body?.host_name) !== r.host_name)
        return error('Only the host can advance the game.', 403);
      if (r.status === 'lobby' || r.status === 'finished')
        return error('The game cannot advance from this state.', 409);
      if (r.status === 'question') {
        const updated: Room = {
          ...r,
          status: 'results',
          last_question_correct: r.questions[r.current_index].answer,
        };
        await persistRoom(updated);
        return roomResponse(updated);
      }
      if (r.current_index >= r.questions.length - 1) {
        const updated: Room = { ...r, status: 'finished' };
        await persistRoom(updated);
        return roomResponse(updated);
      }
      const updated: Room = {
        ...r,
        status: 'question',
        current_index: r.current_index + 1,
        answers: {},
        question_started_at: Date.now(),
        players: r.players.map(p => ({
          ...p,
          answered: false,
          last_answer: undefined,
        })),
      };
      await persistRoom(updated);
      return roomResponse(updated);
    },
  ],
  ...realtimeSubscriptionRoutes,
};
export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  ...routes,
});
