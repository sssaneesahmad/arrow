import React, { useState } from 'react';
import { Play, Plus, Users, DoorOpen } from 'lucide-react';
import {
  type CompetitiveRoomState,
  DIFFICULTY_META,
  type Difficulty,
  formatTimeMs,
} from '../../shared/puzzle';

export interface PublicRoomSummary {
  roomId: string;
  name: string;
  difficulty: Difficulty;
  status: 'waiting' | 'countdown' | 'playing' | 'finished';
  participantCount: number;
}

interface CompetitiveArenaProps {
  room: CompetitiveRoomState | null;
  publicRooms: PublicRoomSummary[];
  clientId: string | null;
  connected: boolean;
  onJoinRoom: (roomId: string) => void;
  onCreateRoom: (difficulty: Difficulty, name: string) => void;
  onLeaveRoom: () => void;
  onSetDifficulty: (difficulty: Difficulty) => void;
  onStartMatch: () => void;
}

export const CompetitiveArena: React.FC<CompetitiveArenaProps> = ({
  room,
  publicRooms,
  clientId,
  connected,
  onJoinRoom,
  onCreateRoom,
  onLeaveRoom,
  onSetDifficulty,
  onStartMatch,
}) => {
  const [joinCode, setJoinCode] = useState('');
  const [createDiff, setCreateDiff] = useState<Difficulty>('normal');

  if (!room) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Live Competitive Sessions</h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Race other players simultaneously on the same seeded arrow board with a synchronized server timer.
            </p>
          </div>

          <button
            type="button"
            disabled={!connected}
            onClick={() => onJoinRoom('GLOBAL')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4" />
            Join Global Sprint
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
          {/* Create a custom room */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold text-slate-700 block">Create Private Match</span>
            <div className="flex items-center gap-2">
              <select
                value={createDiff}
                onChange={(e) => setCreateDiff(e.target.value as Difficulty)}
                className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              >
                {(['normal', 'hard', 'master', 'heart'] as const).map((d) => (
                  <option key={d} value={d}>
                    {DIFFICULTY_META[d].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!connected}
                onClick={() => onCreateRoom(createDiff, '')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Create Room
              </button>
            </div>
          </div>

          {/* Join by Room Code */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold text-slate-700 block">Join by Room Code</span>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (joinCode.trim()) onJoinRoom(joinCode.trim());
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={8}
                placeholder="e.g. A7K2"
                className="flex-1 min-w-0 px-3 py-2 text-sm font-mono uppercase bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!connected || !joinCode.trim()}
                className="px-3.5 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Join
              </button>
            </form>
          </div>
        </div>

        {/* Open rooms directory */}
        {publicRooms.length > 0 && (
          <div className="pt-4 border-t border-slate-200">
            <span className="text-xs font-semibold text-slate-700 block mb-2.5">
              Active Lobbies
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {publicRooms.map((r) => (
                <button
                  key={r.roomId}
                  type="button"
                  onClick={() => onJoinRoom(r.roomId)}
                  className="flex items-center justify-between p-3 text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{r.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {DIFFICULTY_META[r.difficulty].label} · Code {r.roomId} ·{' '}
                      {r.status === 'playing'
                        ? 'In Progress'
                        : r.status === 'countdown'
                          ? 'Starting'
                          : 'Waiting'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-mono text-slate-600 shrink-0 ml-3">
                    <Users className="w-3.5 h-3.5" />
                    {r.participantCount}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const isHost = room.roomId === 'GLOBAL' || room.hostClientId === clientId;
  const canConfigure = room.status === 'waiting' || room.status === 'finished';

  const sortedParticipants = [...room.participants].sort((a, b) => {
    if (a.finishedAtMs !== null && b.finishedAtMs !== null) {
      return a.finishedAtMs - b.finishedAtMs;
    }
    if (a.finishedAtMs !== null) return -1;
    if (b.finishedAtMs !== null) return 1;
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    return b.arrowsCleared - a.arrowsCleared;
  });

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">{room.name}</h2>
            <span className="text-xs font-mono text-slate-500">Code: {room.roomId}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {DIFFICULTY_META[room.difficulty].label} · {room.participants.length} player
            {room.participants.length === 1 ? '' : 's'} ·{' '}
            {room.status === 'waiting'
              ? 'Ready to start'
              : room.status === 'countdown'
                ? 'Countdown active'
                : room.status === 'playing'
                  ? 'Race in progress'
                  : 'Round complete'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canConfigure && isHost && (
            <>
              <select
                value={room.difficulty}
                onChange={(e) => onSetDifficulty(e.target.value as Difficulty)}
                aria-label="Room difficulty"
                className="px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              >
                {(['normal', 'hard', 'master', 'heart'] as const).map((d) => (
                  <option key={d} value={d}>
                    {DIFFICULTY_META[d].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onStartMatch}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
                {room.status === 'finished' ? 'Next Round' : 'Start Race'}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onLeaveRoom}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <DoorOpen className="w-3.5 h-3.5" />
            Leave
          </button>
        </div>
      </div>

      {/* Live participant progress */}
      <div className="space-y-2 pt-3 border-t border-slate-200">
        {sortedParticipants.map((p, idx) => {
          const pct = p.totalArrows > 0 ? Math.round((p.arrowsCleared / p.totalArrows) * 100) : 0;
          const isMe = p.clientId === clientId;

          return (
            <div key={p.clientId} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-slate-400 w-4">{idx + 1}.</span>
                  <span className={`font-semibold truncate ${isMe ? 'text-blue-600' : 'text-slate-800'}`}>
                    {p.handle}
                  </span>
                  <span className="text-slate-400 font-mono">{p.heartsLeft}/3 ♥</span>
                </div>
                <div className="font-mono text-slate-700 tabular-nums shrink-0">
                  {p.finishedAtMs !== null ? (
                    <span className="text-emerald-600 font-semibold">
                      Cleared · {formatTimeMs(p.finishedAtMs)}
                    </span>
                  ) : p.eliminated ? (
                    <span className="text-red-600 font-medium">Out of hearts</span>
                  ) : (
                    <span>
                      {p.arrowsCleared}/{p.totalArrows} ({pct}%)
                    </span>
                  )}
                </div>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${
                    p.finishedAtMs !== null
                      ? 'bg-emerald-500'
                      : p.eliminated
                        ? 'bg-red-400'
                        : isMe
                          ? 'bg-blue-600'
                          : 'bg-slate-700'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
