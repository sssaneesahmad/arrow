import React, { useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import {
  DIFFICULTY_META,
  type Difficulty,
  type LeaderboardRecord,
  formatTimeMs,
} from '../../shared/puzzle';

interface LeaderboardPanelProps {
  records: LeaderboardRecord[];
  currentHandle: string;
  compact?: boolean;
}

export const LeaderboardPanel: React.FC<LeaderboardPanelProps> = ({
  records,
  currentHandle,
  compact = false,
}) => {
  const [diffFilter, setDiffFilter] = useState<Difficulty | 'all'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'solo' | 'sprint'>('all');

  const filtered = useMemo(() => {
    return records
      .filter((r) => (diffFilter === 'all' ? true : r.difficulty === diffFilter))
      .filter((r) => (modeFilter === 'all' ? true : r.mode === modeFilter))
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, compact ? 15 : 50);
  }, [records, diffFilter, modeFilter, compact]);

  return (
    <div className="flex flex-col h-full">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['all', 'normal', 'hard', 'master', 'heart'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setDiffFilter(key)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                diffFilter === key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {key === 'all' ? 'All' : DIFFICULTY_META[key].label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['all', 'solo', 'sprint'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModeFilter(m)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                modeFilter === m
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {m === 'all' ? 'All Modes' : m === 'solo' ? 'Solo' : 'Live Sprint'}
            </button>
          ))}
        </div>
      </div>

      {/* Leaderboard table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Trophy className="w-7 h-7 text-slate-300 mb-2" />
          <p className="text-sm font-medium text-slate-700">No clears recorded yet</p>
          <p className="text-xs text-slate-500 mt-1">
            Clear a puzzle board to post the first official time.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2 pr-3 w-10">#</th>
                <th className="py-2 pr-3">Player</th>
                <th className="py-2 pr-3">Board</th>
                <th className="py-2 pr-3 text-right">Hearts</th>
                <th className="py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((row, idx) => {
                const isSelf = row.handle.toLowerCase() === currentHandle.toLowerCase();
                return (
                  <tr
                    key={row.id}
                    className={isSelf ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'}
                  >
                    <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-slate-500 tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-slate-900 max-w-[140px] truncate">
                      {row.handle}
                      {isSelf && (
                        <span className="ml-1.5 text-xs font-normal text-blue-600">(You)</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-slate-500 whitespace-nowrap">
                      {DIFFICULTY_META[row.difficulty].label}
                      {row.level ? ` Lvl ${row.level}` : ''} · {row.totalArrows} lines ·{' '}
                      {row.mode === 'sprint' ? 'Sprint' : 'Solo'}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                      {row.heartsLeft}/3
                    </td>
                    <td className="py-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatTimeMs(row.timeMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
