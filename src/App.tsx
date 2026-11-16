import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Hash,
  Heart,
  Lightbulb,
  RotateCcw,
  Shuffle,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  type ArrowEntity,
  type ChatMessage,
  type CompetitiveRoomState,
  DIFFICULTY_META,
  type Difficulty,
  type GridPoint,
  type LeaderboardRecord,
  type PuzzleBoard as PuzzleBoardType,
  findHintArrow,
  formatTimeMs,
  generatePuzzle,
  isArrowFree,
} from '../shared/puzzle';
import { CompetitiveArena, type PublicRoomSummary } from './components/CompetitiveArena';
import { GlobalChatPanel } from './components/GlobalChatPanel';
import { LeaderboardPanel } from './components/LeaderboardPanel';
import {
  EXIT_ANIMATION_MS,
  type ExitingArrow,
  PuzzleBoard,
} from './components/PuzzleBoard';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { playBlockedSound, playSlideSound, playWinSound } from './utils/sound';

type NavTab = 'solo' | 'arena' | 'leaderboard';
type SideTab = 'chat' | 'leaderboard';
type PlayStatus = 'READY' | 'PLAYING' | 'WON' | 'GAME_OVER';

const HANDLE_STORAGE_KEY = 'arrowout_player_handle';

function getInitialHandle(): string {
  try {
    const saved = localStorage.getItem(HANDLE_STORAGE_KEY);
    if (saved && saved.trim().length >= 2) return saved.trim().slice(0, 18);
  } catch {
    // ignore storage errors
  }
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `Player-${suffix}`;
}

export default function App() {
  const [navTab, setNavTab] = useState<NavTab>('solo');
  const [sideTab, setSideTab] = useState<SideTab>('chat');

  // Player identity
  const [handle, setHandle] = useState<string>(getInitialHandle);
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleDraft, setHandleDraft] = useState(handle);

  // Admin-only state (level jumper hidden from normal players)
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);

  // Realtime WS state
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRecord[]>([]);
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [currentRoom, setCurrentRoom] = useState<CompetitiveRoomState | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [unreadChat, setUnreadChat] = useState(0);

  // Audio & board preferences
  const [muted, setMuted] = useState(false);
  const [showGridDots, setShowGridDots] = useState(true);

  // Solo / Active board state
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 1_000_000_000));
  const [levelNumber, setLevelNumber] = useState(1);

  const board: PuzzleBoardType = useMemo(() => {
    if (navTab === 'arena' && currentRoom) {
      return generatePuzzle(currentRoom.difficulty, currentRoom.seed, 1);
    }
    return generatePuzzle(difficulty, seed, levelNumber);
  }, [navTab, currentRoom?.difficulty, currentRoom?.seed, difficulty, seed, levelNumber]);

  const [remainingArrows, setRemainingArrows] = useState<ArrowEntity[]>(board.arrows);
  const [exitingArrows, setExitingArrows] = useState<ExitingArrow[]>([]);
  const [hearts, setHearts] = useState(3);
  const [mistakes, setMistakes] = useState(0);
  const [combo, setCombo] = useState(0);
  const [hintsLeft, setHintsLeft] = useState(2);
  const [hintArrowId, setHintArrowId] = useState<string | null>(null);
  const [blockedArrowId, setBlockedArrowId] = useState<string | null>(null);
  const [blockedCell, setBlockedCell] = useState<GridPoint | null>(null);

  const [playStatus, setPlayStatus] = useState<PlayStatus>('READY');
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const [lastRecordNotice, setLastRecordNotice] = useState<string | null>(null);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);

  // Sync board reset when seed/difficulty/level or room seed changes
  const boardSignature = `${navTab === 'arena' && currentRoom ? `room-${currentRoom.roomId}-${currentRoom.seed}-${currentRoom.difficulty}` : `solo-${seed}-${difficulty}-${levelNumber}`}`;

  useEffect(() => {
    setRemainingArrows(board.arrows);
    setExitingArrows([]);
    setHearts(3);
    setMistakes(0);
    setCombo(0);
    setHintsLeft(navTab === 'arena' ? 1 : 2);
    setHintArrowId(null);
    setBlockedArrowId(null);
    setBlockedCell(null);
    setElapsedMs(0);
    startedAtRef.current = null;
    setLastRecordNotice(null);
    setPlayStatus(navTab === 'arena' ? 'PLAYING' : 'READY');
  }, [boardSignature]);

  // Check admin session on load
  useEffect(() => {
    fetch('/api/admin/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { isAdmin?: boolean } | null) => {
        if (data?.isAdmin) setIsAdmin(true);
      })
      .catch(() => {});
  }, []);

  // WebSocket connection + reconnection loop
  const handleRef = useRef(handle);
  handleRef.current = handle;
  const sideTabRef = useRef(sideTab);
  sideTabRef.current = sideTab;

  useEffect(() => {
    let closedByUnmount = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (closedByUnmount) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
        ws.send(JSON.stringify({ type: 'auth:identify', handle: handleRef.current }));
      };

      ws.onmessage = (evt) => {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(String(evt.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (data.type === 'init') {
          if (typeof data.clientId === 'string') setClientId(data.clientId);
          if (typeof data.onlineCount === 'number') setOnlineCount(data.onlineCount);
          if (Array.isArray(data.chat)) setChatMessages(data.chat as ChatMessage[]);
          if (Array.isArray(data.leaderboard)) setLeaderboard(data.leaderboard as LeaderboardRecord[]);
          if (Array.isArray(data.rooms)) setPublicRooms(data.rooms as PublicRoomSummary[]);
        } else if (data.type === 'presence:count') {
          if (typeof data.onlineCount === 'number') setOnlineCount(data.onlineCount);
        } else if (data.type === 'chat:message') {
          const msg = data.message as ChatMessage;
          setChatMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg].slice(-100);
          });
          if (sideTabRef.current !== 'chat') {
            setUnreadChat((c) => c + 1);
          }
        } else if (data.type === 'leaderboard:update') {
          if (Array.isArray(data.leaderboard)) {
            setLeaderboard(data.leaderboard as LeaderboardRecord[]);
          }
        } else if (data.type === 'rooms:list') {
          if (Array.isArray(data.rooms)) {
            setPublicRooms(data.rooms as PublicRoomSummary[]);
          }
        } else if (data.type === 'room:state') {
          setRoomError(null);
          const room = data.room as CompetitiveRoomState;
          setCurrentRoom(room);
        } else if (data.type === 'room:left') {
          setCurrentRoom(null);
        } else if (data.type === 'room:error') {
          if (typeof data.message === 'string') {
            setRoomError(data.message);
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByUnmount) {
          const delay = Math.min(8000, 800 * Math.pow(1.6, attempt++));
          reconnectTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      closedByUnmount = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  // Countdown tick for competitive rooms
  useEffect(() => {
    if (navTab !== 'arena' || !currentRoom || currentRoom.status !== 'countdown' || !currentRoom.countdownEndsAt) {
      setCountdownSec(null);
      return;
    }
    const update = () => {
      const diff = (currentRoom.countdownEndsAt ?? 0) - Date.now();
      if (diff <= 0) {
        setCountdownSec(null);
      } else {
        setCountdownSec(Math.ceil(diff / 1000));
      }
    };
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [navTab, currentRoom?.status, currentRoom?.countdownEndsAt]);

  // Synchronize competitive room server start timestamp
  useEffect(() => {
    if (navTab === 'arena' && currentRoom?.status === 'playing' && currentRoom.startedAt) {
      startedAtRef.current = currentRoom.startedAt;
    }
  }, [navTab, currentRoom?.status, currentRoom?.startedAt]);

  // High-precision game timer
  useEffect(() => {
    const isArenaRunning =
      navTab === 'arena' &&
      currentRoom?.status === 'playing' &&
      playStatus === 'PLAYING';
    const isSoloRunning = navTab === 'solo' && playStatus === 'PLAYING';

    if (!isArenaRunning && !isSoloRunning) return;

    const id = setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(Math.max(0, Date.now() - startedAtRef.current));
      }
    }, 50);

    return () => clearInterval(id);
  }, [navTab, currentRoom?.status, playStatus]);

  const sendWs = useCallback((payload: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const submitSoloWin = useCallback(
    async (finalTimeMs: number, finalHearts: number, finalMistakes: number) => {
      try {
        const res = await fetch('/api/leaderboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handle,
            difficulty,
            level: levelNumber,
            mode: 'solo',
            timeMs: finalTimeMs,
            totalArrows: board.arrows.length,
            heartsLeft: finalHearts,
            mistakes: finalMistakes,
            seed: board.seed,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { isNewBest?: boolean };
          if (data.isNewBest) {
            setLastRecordNotice(`New ${DIFFICULTY_META[difficulty].label} Leaderboard Record!`);
          } else {
            setLastRecordNotice('Time posted to Global Leaderboard');
          }
        }
      } catch {
        // ignore network error cleanly
      }
    },
    [handle, difficulty, levelNumber, board.arrows.length, board.seed]
  );

  const handleTapArrow = useCallback(
    (arrow: ArrowEntity) => {
      if (playStatus === 'WON' || playStatus === 'GAME_OVER') return;
      if (navTab === 'arena' && (!currentRoom || currentRoom.status !== 'playing')) return;

      // Start solo timer on first tap
      let effectiveStart = startedAtRef.current;
      if (navTab === 'solo' && playStatus === 'READY') {
        effectiveStart = Date.now();
        startedAtRef.current = effectiveStart;
        setPlayStatus('PLAYING');
      }

      const check = isArrowFree(arrow, remainingArrows, board.cols, board.rows);

      if (check.free) {
        const nextRemaining = remainingArrows.filter((a) => a.id !== arrow.id);
        const nextCombo = combo + 1;
        setRemainingArrows(nextRemaining);
        setCombo(nextCombo);
        setHintArrowId((prev) => (prev === arrow.id ? null : prev));

        const exitKey = `${arrow.id}-${Date.now()}`;
        const nowTs = performance.now();
        setExitingArrows((prev) => [...prev, { arrow, key: exitKey, startedAt: nowTs }]);
        setTimeout(() => {
          setExitingArrows((prev) => prev.filter((item) => item.key !== exitKey));
        }, EXIT_ANIMATION_MS + 40);

        const clearedCount = board.arrows.length - nextRemaining.length;

        if (nextRemaining.length === 0) {
          playWinSound(muted);
          const finalMs = effectiveStart ? Math.max(500, Date.now() - effectiveStart) : elapsedMs;
          setElapsedMs(finalMs);
          setPlayStatus('WON');

          if (navTab === 'arena' && currentRoom) {
            sendWs({
              type: 'room:finish',
              heartsLeft: hearts,
              mistakes,
            });
            setLastRecordNotice('Finished! Time recorded to Live Sprint Leaderboard.');
          } else {
            submitSoloWin(finalMs, hearts, mistakes);
          }
        } else {
          playSlideSound(muted, nextCombo);
          if (navTab === 'arena' && currentRoom) {
            sendWs({
              type: 'room:progress',
              arrowsCleared: clearedCount,
              heartsLeft: hearts,
              mistakes,
            });
          }
        }
      } else {
        // Blocked!
        playBlockedSound(muted);
        const nextHearts = Math.max(0, hearts - 1);
        const nextMistakes = mistakes + 1;
        setHearts(nextHearts);
        setMistakes(nextMistakes);
        setCombo(0);
        setBlockedArrowId(arrow.id);
        setBlockedCell(check.blockedAt ?? null);

        setTimeout(() => {
          setBlockedArrowId((prev) => (prev === arrow.id ? null : prev));
          setBlockedCell(null);
        }, 320);

        if (nextHearts <= 0) {
          setPlayStatus('GAME_OVER');
        }

        if (navTab === 'arena' && currentRoom) {
          sendWs({
            type: 'room:progress',
            arrowsCleared: board.arrows.length - remainingArrows.length,
            heartsLeft: nextHearts,
            mistakes: nextMistakes,
          });
        }
      }
    },
    [
      playStatus,
      navTab,
      currentRoom,
      remainingArrows,
      board.cols,
      board.rows,
      board.arrows.length,
      combo,
      muted,
      elapsedMs,
      hearts,
      mistakes,
      sendWs,
      submitSoloWin,
    ]
  );

  const handleUseHint = useCallback(() => {
    if (hintsLeft <= 0 || playStatus === 'WON' || playStatus === 'GAME_OVER') return;
    if (navTab === 'arena' && (!currentRoom || currentRoom.status !== 'playing')) return;
    const freeArrow = findHintArrow(remainingArrows, board.cols, board.rows);
    if (freeArrow) {
      setHintArrowId(freeArrow.id);
      setHintsLeft((h) => h - 1);
    }
  }, [hintsLeft, playStatus, navTab, currentRoom, remainingArrows, board.cols, board.rows]);

  const handleResetSolo = useCallback(() => {
    setRemainingArrows(board.arrows);
    setExitingArrows([]);
    setHearts(3);
    setMistakes(0);
    setCombo(0);
    setHintsLeft(2);
    setHintArrowId(null);
    setBlockedArrowId(null);
    setBlockedCell(null);
    setElapsedMs(0);
    startedAtRef.current = null;
    setLastRecordNotice(null);
    setPlayStatus('READY');
  }, [board.arrows]);

  const handleSelectDifficulty = useCallback((nextDiff: Difficulty) => {
    setDifficulty(nextDiff);
    setLevelNumber(1);
    setSeed(Math.floor(Math.random() * 1_000_000_000));
  }, []);

  const handleNewSoloPuzzle = useCallback((advanceLevel = false) => {
    if (advanceLevel) {
      setLevelNumber((n) => n + 1);
    }
    setSeed(Math.floor(Math.random() * 1_000_000_000));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        handleUseHint();
      } else if (e.key === 'g' || e.key === 'G') {
        setShowGridDots((v) => !v);
      } else if ((e.key === 'r' || e.key === 'R') && navTab === 'solo') {
        handleResetSolo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUseHint, handleResetSolo, navTab]);

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = handleDraft.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 18);
    if (cleaned.length >= 2) {
      setHandle(cleaned);
      setHandleDraft(cleaned);
      try {
        localStorage.setItem(HANDLE_STORAGE_KEY, cleaned);
      } catch {
        // ignore
      }
      sendWs({ type: 'auth:identify', handle: cleaned });
    }
    setEditingHandle(false);
  };

  const boardLocked =
    navTab === 'arena' && (!currentRoom || currentRoom.status !== 'playing');

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line brand wordmark */}
          <button
            type="button"
            onClick={() => setNavTab('solo')}
            className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            ArrowOut
          </button>

          {/* Zone 2: Clean single-line navigation links */}
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setNavTab('solo')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                navTab === 'solo'
                  ? 'border-blue-600 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Solo Play
            </button>
            <button
              type="button"
              onClick={() => setNavTab('arena')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                navTab === 'arena'
                  ? 'border-blue-600 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Live Arena
            </button>
            <button
              type="button"
              onClick={() => setNavTab('leaderboard')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                navTab === 'leaderboard'
                  ? 'border-blue-600 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Leaderboard
            </button>
          </nav>

          {/* Zone 3: Primary player handle action */}
          <div className="flex items-center shrink-0">
            {editingHandle ? (
              <form onSubmit={handleSaveName} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={handleDraft}
                  onChange={(e) => setHandleDraft(e.target.value)}
                  maxLength={18}
                  autoFocus
                  aria-label="Player handle"
                  className="w-32 sm:w-36 px-2.5 py-1 text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                >
                  Save
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setHandleDraft(handle);
                  setEditingHandle(true);
                }}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {handle}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 py-6">
        {navTab === 'leaderboard' ? (
          <section className="bg-white border border-slate-200 rounded-xl p-6 max-w-4xl mx-auto space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Global Leaderboard</h1>
                <p className="text-sm text-slate-600 mt-1">
                  Fastest verified board clears across Solo Time Trials and Live Competitive Sprints.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {leaderboard.length} recorded clears
              </span>
            </div>
            <LeaderboardPanel records={leaderboard} currentHandle={handle} />
          </section>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left / Center Dominant Focal Anchor: Puzzle Arena */}
            <div className="lg:col-span-8 space-y-4">
              {navTab === 'arena' && (
                <>
                  {roomError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium px-4 py-2.5 rounded-lg">
                      {roomError}
                    </div>
                  )}
                  <CompetitiveArena
                    room={currentRoom}
                    publicRooms={publicRooms}
                    clientId={clientId}
                    connected={wsConnected}
                    onJoinRoom={(roomId) => sendWs({ type: 'room:join', roomId })}
                    onCreateRoom={(diff, name) =>
                      sendWs({ type: 'room:create', difficulty: diff, name })
                    }
                    onLeaveRoom={() => sendWs({ type: 'room:leave' })}
                    onSetDifficulty={(diff) =>
                      sendWs({ type: 'room:set_difficulty', difficulty: diff })
                    }
                    onStartMatch={() => sendWs({ type: 'room:start' })}
                  />
                </>
              )}

              {/* Puzzle Board Container */}
              <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
                {/* Compact HUD Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
                  <div className="flex items-center gap-3">
                    {navTab === 'solo' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                          {(['normal', 'hard', 'master', 'heart'] as const).map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => handleSelectDifficulty(d)}
                              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                difficulty === d
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {DIFFICULTY_META[d].label}
                            </button>
                          ))}
                        </div>

                        {isAdmin && (
                          <select
                            aria-label="Select level"
                            value={levelNumber}
                            onChange={(e) => {
                              const nextLvl = Number(e.target.value) || 1;
                              setLevelNumber(nextLvl);
                              setSeed(Math.floor(Math.random() * 1_000_000_000));
                            }}
                            className="px-2.5 py-1.5 text-xs font-mono font-medium bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
                          >
                            {[1, 2, 3, 4, 5, 8, 10, 12, 15, 20, 25, 30].includes(levelNumber)
                              ? [1, 2, 3, 4, 5, 8, 10, 12, 15, 20, 25, 30].map((lvl) => (
                                  <option key={lvl} value={lvl}>
                                    Level {lvl}
                                  </option>
                                ))
                              : [1, 2, 3, 4, 5, 8, 10, 12, 15, 20, 25, 30, levelNumber]
                                  .sort((a, b) => a - b)
                                  .map((lvl) => (
                                    <option key={lvl} value={lvl}>
                                      Level {lvl}
                                    </option>
                                  ))}
                          </select>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm font-semibold text-slate-900">
                        {currentRoom
                          ? `${DIFFICULTY_META[currentRoom.difficulty].label} Sprint`
                          : 'Competitive Board'}
                      </span>
                    )}

                    <span className="text-xs font-mono text-slate-500 tabular-nums hidden sm:inline">
                      {navTab === 'solo' ? `Level ${levelNumber} · ` : ''}
                      {board.cols}×{board.rows} · {remainingArrows.length}/{board.arrows.length} lines
                    </span>
                  </div>

                  {/* Hearts & Timer */}
                  <div className="flex items-center gap-4">
                    <div
                      className="flex items-center gap-1"
                      aria-label={`${hearts} of 3 hearts remaining`}
                    >
                      {[0, 1, 2].map((i) => (
                        <Heart
                          key={i}
                          className={`w-4 h-4 transition-colors ${
                            i < hearts
                              ? 'fill-red-500 text-red-500'
                              : 'fill-slate-200 text-slate-200'
                          }`}
                        />
                      ))}
                      <span className="text-xs font-mono text-slate-500 ml-1 tabular-nums">
                        {hearts}/3
                      </span>
                    </div>

                    <div className="text-lg font-mono font-bold text-slate-900 tabular-nums w-20 text-right">
                      {formatTimeMs(elapsedMs)}
                    </div>

                    <button
                      type="button"
                      onClick={() => setMuted((m) => !m)}
                      aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
                      className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Mobile line counter */}
                <div className="flex items-center justify-between pt-3 sm:hidden text-xs text-slate-500 font-mono tabular-nums">
                  <span>
                    {navTab === 'solo' ? `Level ${levelNumber} (${board.cols}×${board.rows}) · ` : ''}
                    {remainingArrows.length}/{board.arrows.length} lines
                  </span>
                  {combo > 2 && <span className="text-blue-600 font-semibold">{combo}x streak</span>}
                </div>

                {/* Interactive SVG Board */}
                <div className="relative py-5 sm:py-7 min-h-[380px] flex items-center justify-center">
                  <PuzzleBoard
                    board={board}
                    remainingArrows={remainingArrows}
                    exitingArrows={exitingArrows}
                    blockedArrowId={blockedArrowId}
                    blockedCell={blockedCell}
                    hintArrowId={hintArrowId}
                    showGridDots={showGridDots}
                    disabled={boardLocked || playStatus === 'WON' || playStatus === 'GAME_OVER'}
                    onTapArrow={handleTapArrow}
                  />

                  {/* Arena Waiting Overlay */}
                  {navTab === 'arena' && (!currentRoom || currentRoom.status === 'waiting') && (
                    <div className="absolute inset-0 bg-white/85 backdrop-blur-[2px] flex flex-col items-center justify-center text-center p-6 rounded-lg">
                      <ArrowUpRight className="w-8 h-8 text-blue-600 mb-2" />
                      <h3 className="text-lg font-bold text-slate-900">
                        {currentRoom ? 'Waiting for Race Start' : 'Join a Competitive Session'}
                      </h3>
                      <p className="text-sm text-slate-600 max-w-sm mt-1">
                        {currentRoom
                          ? 'Everyone in this room will receive the exact same arrow puzzle when the race begins.'
                          : 'Join Global Sprint or create a private room above to race other players in real time.'}
                      </p>
                      {!currentRoom && (
                        <button
                          type="button"
                          disabled={!wsConnected}
                          onClick={() => sendWs({ type: 'room:join', roomId: 'GLOBAL' })}
                          className="mt-4 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                        >
                          Join Global Sprint
                        </button>
                      )}
                    </div>
                  )}

                  {/* Arena Countdown Overlay */}
                  {navTab === 'arena' && currentRoom?.status === 'countdown' && countdownSec !== null && (
                    <div className="absolute inset-0 bg-white/85 backdrop-blur-[2px] flex flex-col items-center justify-center text-center p-6 rounded-lg">
                      <span className="text-xs font-semibold text-slate-500">Get Ready</span>
                      <div className="font-display text-6xl font-extrabold text-blue-600 mt-1 tabular-nums">
                        {countdownSec}
                      </div>
                    </div>
                  )}

                  {/* Win / Game Over Overlay */}
                  {(playStatus === 'WON' || playStatus === 'GAME_OVER') && (
                    <div className="absolute inset-0 bg-white/92 backdrop-blur-xs flex flex-col items-center justify-center text-center p-6 rounded-lg">
                      <h3 className="text-2xl font-bold text-slate-900">
                        {playStatus === 'WON' ? 'Board Cleared!' : 'Out of Hearts'}
                      </h3>
                      <p className="text-sm text-slate-600 mt-1">
                        {playStatus === 'WON'
                          ? `Cleared all ${board.arrows.length} lines in ${formatTimeMs(elapsedMs)} with ${hearts}/3 hearts.`
                          : `${remainingArrows.length} of ${board.arrows.length} lines remained when you ran out of hearts.`}
                      </p>
                      {lastRecordNotice && (
                        <p className="text-xs font-semibold text-blue-600 mt-2">
                          {lastRecordNotice}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-5">
                        {navTab === 'solo' ? (
                          <>
                            <button
                              type="button"
                              onClick={handleResetSolo}
                              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Retry Board
                            </button>
                            <button
                              type="button"
                              onClick={() => handleNewSoloPuzzle(playStatus === 'WON')}
                              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              {playStatus === 'WON' ? `Next Level (Level ${levelNumber + 1})` : 'Play Again'}
                            </button>
                          </>
                        ) : (
                          currentRoom &&
                          (currentRoom.roomId === 'GLOBAL' ||
                            currentRoom.hostClientId === clientId) &&
                          currentRoom.status === 'finished' && (
                            <button
                              type="button"
                              onClick={() => sendWs({ type: 'room:start' })}
                              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Start Next Round
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Board Utility Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
                  <p className="text-xs text-slate-500">
                    Tap any arrow whose forward path to the edge is unobstructed.
                  </p>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleUseHint}
                      disabled={
                        hintsLeft <= 0 ||
                        boardLocked ||
                        playStatus === 'WON' ||
                        playStatus === 'GAME_OVER'
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Lightbulb className="w-3.5 h-3.5" />
                      Hint ({hintsLeft})
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowGridDots((v) => !v)}
                      aria-pressed={showGridDots}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        showGridDots
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <Hash className="w-3.5 h-3.5" />
                      Grid
                    </button>

                    {navTab === 'solo' && (
                      <>
                        <button
                          type="button"
                          onClick={handleResetSolo}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNewSoloPuzzle()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                          New Board
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {/* Right Sidebar: Global Chat & Live Leaderboard */}
            <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setSideTab('chat');
                    setUnreadChat(0);
                  }}
                  className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    sideTab === 'chat'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Global Chat{unreadChat > 0 ? ` (${unreadChat})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setSideTab('leaderboard')}
                  className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    sideTab === 'leaderboard'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Top Times
                </button>
              </div>

              {sideTab === 'chat' ? (
                <GlobalChatPanel
                  messages={chatMessages}
                  currentHandle={handle}
                  onlineCount={onlineCount}
                  connected={wsConnected}
                  onSendMessage={(text) => sendWs({ type: 'chat:send', text })}
                />
              ) : (
                <LeaderboardPanel
                  records={leaderboard}
                  currentHandle={handle}
                  compact
                />
              )}
            </aside>
          </div>
        )}
      </main>

      <footer className="max-w-[1360px] w-full mx-auto px-4 sm:px-6 py-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>ArrowOut · Competitive Arrow Escape</span>
        <div className="flex items-center gap-4">
          <PWAInstallButton />
          {isAdmin ? (
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
                setIsAdmin(false);
              }}
              className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
            >
              Admin Active · Sign Out
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdminError(null);
                setAdminEmailInput('');
                setShowAdminModal(true);
              }}
              className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
            >
              Admin
            </button>
          )}
        </div>
      </footer>

      <OfflineIndicator />

      {showAdminModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Admin Verification</h2>
              <button
                type="button"
                onClick={() => setShowAdminModal(false)}
                className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Sign in with your administrator email to access level selection controls.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setAdminError(null);
                try {
                  const res = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: adminEmailInput }),
                  });
                  if (!res.ok) {
                    setAdminError('Email does not match administrator account.');
                    return;
                  }
                  setIsAdmin(true);
                  setShowAdminModal(false);
                } catch {
                  setAdminError('Unable to verify right now.');
                }
              }}
              className="space-y-3"
            >
              <input
                type="email"
                required
                value={adminEmailInput}
                onChange={(e) => setAdminEmailInput(e.target.value)}
                placeholder="Admin email"
                autoFocus
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
              {adminError && <p className="text-xs text-red-600">{adminError}</p>}
              <button
                type="submit"
                className="w-full py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                Unlock Admin Controls
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
