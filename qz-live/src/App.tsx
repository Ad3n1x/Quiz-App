import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ws } from '@appdeploy/client';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Crown,
  Gamepad2,
  LoaderCircle,
  Plus,
  Radio,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';

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
const starter: Question[] = [
  {
    text: 'Which city is Nigeria’s capital?',
    options: ['Lagos', 'Abuja', 'Kano', 'Ibadan'],
    answer: 1,
    seconds: 15,
    explanation: 'Abuja became Nigeria’s capital in 1991.',
  },
  {
    text: 'What is the chemical symbol for gold?',
    options: ['Go', 'Gd', 'Au', 'Ag'],
    answer: 2,
    seconds: 15,
    explanation: 'Au comes from the Latin word aurum.',
  },
  {
    text: 'Which planet is known as the Red Planet?',
    options: ['Venus', 'Mars', 'Jupiter', 'Mercury'],
    answer: 1,
    seconds: 15,
    explanation: 'Iron-rich dust gives Mars its reddish appearance.',
  },
  {
    text: 'What is 12 × 8?',
    options: ['86', '92', '96', '108'],
    answer: 2,
    seconds: 15,
    explanation: '12 multiplied by 8 equals 96.',
  },
  {
    text: 'Which ocean borders Nigeria to the south?',
    options: [
      'Indian Ocean',
      'Pacific Ocean',
      'Arctic Ocean',
      'Atlantic Ocean',
    ],
    answer: 3,
    seconds: 15,
    explanation:
      'Nigeria’s southern coastline borders the Gulf of Guinea in the Atlantic Ocean.',
  },
];
const colors = ['#a3ff68', '#72d6ff', '#ffbf69', '#d7a4ff'];
const errText = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Please try again.';
function App() {
  const [view, setView] = useState<'home' | 'host' | 'join' | 'room'>('home');
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [customQuestions, setCustomQuestions] = useState<Question[]>(starter);
  const connRef = useRef<ReturnType<typeof ws.connect> | null>(null);
  const roomRef = useRef<Room | null>(null);
  const playerRef = useRef('');
  const isHostRef = useRef(false);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  useEffect(() => {
    playerRef.current = playerId;
  }, [playerId]);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);
  const syncRoom = useCallback(async (id: string) => {
    const res = await api.get('/api/rooms/' + encodeURIComponent(id));
    setRoom(res.data.room);
  }, []);
  const connectRoom = useCallback(async (r: Room) => {
    if (!connRef.current) {
      const conn = ws.connect();
      connRef.current = conn;
      conn.onMessage((msg: any) => {
        if (
          msg?.type !== 'entity.update' ||
          msg?.payload?.entity_type !== 'room'
        )
          return;
        const update = msg.payload.data as Room;
        if (roomRef.current?.id === update.id) setRoom(update);
      });
      conn.onError(() =>
        setErrorMsg(
          'Live connection interrupted. Rejoin the room if updates stop.'
        )
      );
      await conn.ready;
    }
    const connection_id = connRef.current?.connectionId;
    if (connection_id)
      await api.post('/api/subscriptions', {
        entity_type: 'room',
        entity_id: r.id,
        connection_id,
      });
  }, []);
  useEffect(
    () => () => {
      connRef.current?.disconnect();
    },
    []
  );
  useEffect(() => {
    if (!room || !isHost || room.status !== 'question') return;
    const q = room.questions[room.current_index];
    if (!q) return;
    const remaining = Math.max(
      0,
      q.seconds * 1000 - (Date.now() - room.question_started_at)
    );
    const timer = window.setTimeout(() => {
      api
        .post('/api/rooms/' + room.id + '/advance', { host_name: name })
        .then(res => setRoom(res.data.room))
        .catch(e => setErrorMsg(errText(e)));
    }, remaining + 100);
    return () => window.clearTimeout(timer);
  }, [room, isHost, name]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErrorMsg('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setErrorMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const hostGame = () =>
    run(async () => {
      if (!name.trim()) throw new Error('Enter a host name first.');
      if (
        customQuestions.some(
          q =>
            !q.text.trim() ||
            q.options.length !== 4 ||
            q.options.some(o => !o.trim())
        )
      )
        throw new Error('Every question needs a prompt and four options.');
      const res = await api.post('/api/rooms', {
        host_name: name.trim(),
        questions: customQuestions,
      });
      const r = res.data.room as Room;
      setRoom(r);
      setIsHost(true);
      setPlayerId('');
      setView('room');
      await connectRoom(r);
      setNotice('Room created. Share the PIN so everyone can join.');
    });
  const joinGame = () =>
    run(async () => {
      if (!name.trim() || !/^\d{6}$/.test(pin.trim()))
        throw new Error('Enter your name and the 6-digit game PIN.');
      const res = await api.post('/api/rooms/join', {
        code: pin.trim(),
        name: name.trim(),
      });
      const r = res.data.room as Room;
      setRoom(r);
      setPlayerId(res.data.player.id);
      setIsHost(false);
      setView('room');
      await connectRoom(r);
      setNotice(
        'You’re in! Keep this screen open while the host runs the game.'
      );
    });
  const start = () =>
    room &&
    run(async () => {
      const res = await api.post('/api/rooms/' + room.id + '/start', {
        host_name: name,
      });
      setRoom(res.data.room);
    });
  const answer = (idx: number) =>
    room &&
    playerId &&
    selected === null &&
    run(async () => {
      setSelected(idx);
      const res = await api.post('/api/rooms/' + room.id + '/answer', {
        player_id: playerId,
        answer: idx,
      });
      setRoom(res.data.room);
    });
  const next = () =>
    room &&
    run(async () => {
      const res = await api.post('/api/rooms/' + room.id + '/advance', {
        host_name: name,
      });
      setRoom(res.data.room);
    });
  const resetHome = () => {
    setView('home');
    setRoom(null);
    setPlayerId('');
    setIsHost(false);
    setSelected(null);
    setErrorMsg('');
    setNotice('');
  };
  useEffect(() => {
    setSelected(null);
  }, [room?.current_index, room?.status]);
  const current = room?.questions[room.current_index];
  const leaderboard = [...(room?.players || [])].sort(
    (a, b) => b.score - a.score || a.joined_at - b.joined_at
  );
  const answeredCount = Object.keys(room?.answers || {}).length;
  const timeLeft =
    current && room
      ? Math.max(
          0,
          Math.ceil(
            (current.seconds * 1000 - (Date.now() - room.question_started_at)) /
              1000
          )
        )
      : 0;
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  const remaining =
    current && room?.status === 'question'
      ? Math.max(
          0,
          Math.ceil(
            (current.seconds * 1000 - (clock - room.question_started_at)) / 1000
          )
        )
      : timeLeft;
  const copyPin = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice('PIN copied. Send it to your players.');
    } catch {
      setNotice('Game PIN: ' + room.code);
    }
  };
  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand" onClick={resetHome}>
          <span className="brand-mark">
            <Zap size={19} />
          </span>
          <span>
            QZ<span className="muted"> LIVE</span>
          </span>
        </button>
        <span className="live-pill">
          <i /> LIVE QUIZ ROOMS
        </span>
      </header>
      <section className="hero">
        <div className="eyebrow">
          <span className="eyebrow-line" /> GROUP CHAT ENERGY. SCOREBOARD PRESSURE.
        </div>
        <h1>
          Bring the
          <br />
          <em>receipts.</em>
        </h1>
        <p className="intro">
          Settle the group-chat debates with a live quiz. Call your crew, back your answers, and survive the Clutch Round when the points double. This is QZ: where confidence meets the scoreboard.
        </p>
        {errorMsg && <div className="alert error">{errorMsg}</div>}
        {notice && <div className="alert success">{notice}</div>}
        {view === 'home' && (
          <div className="home-grid">
            <button
              className="action-card primary"
              onClick={() => {
                setView('host');
                setErrorMsg('');
              }}
            >
              <span className="card-icon">
                <Radio />
              </span>
              <span className="card-copy">
                <strong>Host a live game</strong>
                <small>Create a room and run the quiz</small>
              </span>
              <ArrowRight />
            </button>
            <button
              className="action-card"
              onClick={() => {
                setView('join');
                setErrorMsg('');
              }}
            >
              <span className="card-icon blue">
                <Gamepad2 />
              </span>
              <span className="card-copy">
                <strong>Join with a PIN</strong>
                <small>Jump into a friend’s room</small>
              </span>
              <ArrowRight />
            </button>
            <div className="feature-strip">
              <span>
                <Users size={17} /> Crew vs crew
              </span>
              <span>
                <Zap size={17} /> Clutch Round: 2× points
              </span>
              <span>
                <Trophy size={17} /> Bragging-rights board
              </span>
            </div>
          </div>
        )}
        {view === 'host' && (
          <div className="panel">
            <button className="back" onClick={() => setView('home')}>
              <ArrowLeft size={16} /> Back
            </button>
            <h2>Set up your room</h2>
            <p className="panel-sub">
              Choose a host name and launch a ready-to-play five-question quiz.
            </p>
            <label>HOST NAME</label>
            <input
              value={name}
              maxLength={24}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Quiz Master"
            />
            <div className="question-editor">
              <div className="editor-head">
                <strong>Question set</strong>
                <span>{customQuestions.length} questions</span>
              </div>
              <p>
                Starter quiz: general knowledge, science and maths. You can edit
                it before launching.
              </p>
              {customQuestions.map((q, i) => (
                <details key={i} className="edit-question">
                  <summary>
                    Q{i + 1}. {q.text}
                  </summary>
                  <div className="edit-fields">
                    <input
                      value={q.text}
                      aria-label={'Question ' + (i + 1)}
                      onChange={e =>
                        setCustomQuestions(old =>
                          old.map((x, j) =>
                            j === i ? { ...x, text: e.target.value } : x
                          )
                        )
                      }
                    />
                    {q.options.map((o, j) => (
                      <div className="option-edit" key={j}>
                        <span>{String.fromCharCode(65 + j)}</span>
                        <input
                          value={o}
                          aria-label={
                            'Question ' + (i + 1) + ' option ' + (j + 1)
                          }
                          onChange={e =>
                            setCustomQuestions(old =>
                              old.map((x, k) =>
                                k === i
                                  ? {
                                      ...x,
                                      options: x.options.map((v, l) =>
                                        l === j ? e.target.value : v
                                      ),
                                    }
                                  : x
                              )
                            )
                          }
                        />
                        <label className="correct">
                          <input
                            type="radio"
                            checked={q.answer === j}
                            onChange={() =>
                              setCustomQuestions(old =>
                                old.map((x, k) =>
                                  k === i ? { ...x, answer: j } : x
                                )
                              )
                            }
                          />{' '}
                          Correct
                        </label>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
              <button
                className="text-button"
                onClick={() =>
                  setCustomQuestions(old => [
                    ...old,
                    {
                      text: 'New question',
                      options: ['Option A', 'Option B', 'Option C', 'Option D'],
                      answer: 0,
                      seconds: 15,
                      explanation: 'Review the correct answer.',
                    },
                  ])
                }
              >
                <Plus size={16} /> Add question
              </button>
            </div>
            <button
              className="btn btn-primary wide"
              disabled={busy}
              onClick={hostGame}
            >
              {busy ? <LoaderCircle className="spin" /> : <Radio size={17} />}{' '}
              Create game room
            </button>
          </div>
        )}
        {view === 'join' && (
          <div className="panel compact">
            <button className="back" onClick={() => setView('home')}>
              <ArrowLeft size={16} /> Back
            </button>
            <h2>Ready to play?</h2>
            <p className="panel-sub">Ask the host for their six-digit PIN.</p>
            <label>YOUR NAME</label>
            <input
              value={name}
              maxLength={24}
              onChange={e => setName(e.target.value)}
              placeholder="Pick a player name"
            />
            <label>GAME PIN</label>
            <input
              value={pin}
              inputMode="numeric"
              maxLength={6}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
            <button
              className="btn btn-primary wide"
              disabled={busy}
              onClick={joinGame}
            >
              {busy ? (
                <LoaderCircle className="spin" />
              ) : (
                <Gamepad2 size={17} />
              )}{' '}
              Join game
            </button>
          </div>
        )}
        {view === 'room' && room && (
          <div className="room-wrap">
            <div className="room-head">
              <button className="back" onClick={resetHome}>
                <ArrowLeft size={16} /> Leave room
              </button>
              <span className={'status ' + room.status}>
                {room.status === 'lobby'
                  ? 'WAITING ROOM'
                  : room.status === 'question'
                    ? 'QUESTION LIVE'
                    : room.status === 'results'
                      ? 'ROUND RESULTS'
                      : 'GAME FINISHED'}
              </span>
            </div>
            {room.status === 'lobby' && (
              <>
                <div className="pin-card">
                  <div>
                    <small>GAME PIN</small>
                    <strong>{room.code}</strong>
                    <span>Share this code with your players</span>
                  </div>
                  <button className="copy" onClick={copyPin}>
                    <Copy size={17} /> Copy PIN
                  </button>
                </div>
                <div className="players-card">
                  <div className="section-head">
                    <h3>
                      <Users size={18} /> Players in the room
                    </h3>
                    <span>{room.players.length}</span>
                  </div>
                  {room.players.length === 0 ? (
                    <p className="empty">
                      You’re first in. Share the PIN and watch your lobby fill
                      up.
                    </p>
                  ) : (
                    <div className="player-chips">
                      {room.players.map((p, i) => (
                        <span
                          key={p.id}
                          style={
                            {
                              '--chip': colors[i % colors.length],
                            } as React.CSSProperties
                          }
                        >
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {isHost ? (
                    <button
                      className="btn btn-primary wide"
                      disabled={busy || room.players.length === 0}
                      onClick={start}
                    >
                      Start game <ArrowRight size={17} />
                    </button>
                  ) : (
                    <div className="waiting">
                      <LoaderCircle size={17} className="spin" /> Waiting for
                      host to start…
                    </div>
                  )}
                </div>
              </>
            )}
            {room.status === 'question' && current && (
              <div className="game-card">
                <div className="question-meta">
                  <span>
                    {room.current_index === room.questions.length - 1 ? 'CLUTCH ROUND · 2× POINTS' : 'ROUND ' + (room.current_index + 1) + ' / ' + room.questions.length}
                  </span>
                  <span className={'timer ' + (remaining <= 5 ? 'urgent' : '')}>
                    {remaining}s
                  </span>
                </div>
                <div className="timer-track">
                  <span
                    style={{ width: (remaining / current.seconds) * 100 + '%' }}
                  />
                </div>
                <h2 className="question-title">{current.text}</h2>
                <div className="answer-grid">
                  {current.options.map((o, i) => (
                    <button
                      key={i}
                      className={
                        'answer-option ' + (selected === i ? 'chosen' : '')
                      }
                      style={{ '--answer': colors[i] } as React.CSSProperties}
                      disabled={!!playerId && selected !== null}
                      onClick={() => answer(i)}
                    >
                      <span>{String.fromCharCode(65 + i)}</span>
                      {o}
                      {selected === i && <Check size={18} />}
                    </button>
                  ))}
                </div>
                {playerId && (
                  <div className="answer-status">
                    {selected !== null
                      ? 'Answer locked in. Watch the leaderboard!'
                      : 'Choose your answer before time runs out.'}
                  </div>
                )}
                {isHost && (
                  <div className="host-progress">
                    <span>
                      {answeredCount} / {room.players.length} players answered
                    </span>
                    <button
                      className="btn btn-primary"
                      onClick={next}
                      disabled={busy}
                    >
                      End question <ArrowRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {(room.status === 'results' || room.status === 'finished') && (
              <div className="results-card">
                <div className="results-icon">
                  <Trophy size={28} />
                </div>
                <h2>
                  {room.status === 'finished'
                    ? 'That’s a wrap!'
                    : 'Round complete'}
                </h2>
                <p>
                  {room.status === 'finished'
                    ? 'Final standings are in. Nice game.'
                    : 'Here’s how the room is doing so far.'}
                </p>
                {current && room.status === 'results' && (
                  <div className="correct-reveal">
                    <span>Correct answer</span>
                    <strong>{current.options[current.answer]}</strong>
                    <small>{current.explanation}</small>
                  </div>
                )}
                <div className="leaderboard">
                  <div className="section-head">
                    <h3>
                      <Trophy size={18} /> Leaderboard
                    </h3>
                    <span>{leaderboard.length} players</span>
                  </div>
                  {leaderboard.map((p, i) => (
                    <div className="leader-row" key={p.id}>
                      <span className={'rank rank-' + i}>
                        {i === 0 ? (
                          <Crown size={16} />
                        ) : (
                          String(i + 1).padStart(2, '0')
                        )}
                      </span>
                      <strong>
                        {p.name}
                        {p.id === playerId ? ' (you)' : ''}
                      </strong>
                      <span className="points">{p.score} pts</span>
                    </div>
                  ))}
                </div>
                {isHost && room.status !== 'finished' && (
                  <button
                    className="btn btn-primary wide"
                    disabled={busy}
                    onClick={next}
                  >
                    {room.current_index === room.questions.length - 1
                      ? 'Finish game'
                      : 'Next question'}{' '}
                    <ArrowRight size={17} />
                  </button>
                )}
                <button className="text-button" onClick={copyPin}>
                  <Copy size={16} /> Copy room PIN
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      <footer>
        <span>
          QZ LIVE <span className="muted">/ PLAY TOGETHER</span>
        </span>
        <span>
          Made for curious minds <span className="heart">✳</span>
        </span>
      </footer>
    </main>
  );
}
export default App;
