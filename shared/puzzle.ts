export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export type Difficulty = 'normal' | 'hard' | 'master' | 'heart';

export interface GridPoint {
  x: number;
  y: number;
}

export interface ArrowEntity {
  id: string;
  points: GridPoint[]; // tail -> ... -> head
  dir: Direction;
}

export interface PuzzleBoard {
  seed: number;
  difficulty: Difficulty;
  level: number;
  cols: number;
  rows: number;
  activeMask: boolean[][]; // [y][x]
  arrows: ArrowEntity[];
}

export interface LeaderboardRecord {
  id: string;
  handle: string;
  difficulty: Difficulty;
  level?: number;
  mode: 'solo' | 'sprint';
  timeMs: number;
  totalArrows: number;
  heartsLeft: number;
  mistakes: number;
  seed: number;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  handle: string;
  text: string;
  kind: 'user' | 'system';
  createdAt: number;
}

export interface RoomParticipant {
  clientId: string;
  handle: string;
  arrowsCleared: number;
  totalArrows: number;
  heartsLeft: number;
  mistakes: number;
  finishedAtMs: number | null;
  eliminated: boolean;
}

export interface CompetitiveRoomState {
  roomId: string;
  name: string;
  difficulty: Difficulty;
  status: 'waiting' | 'countdown' | 'playing' | 'finished';
  seed: number;
  countdownEndsAt: number | null;
  startedAt: number | null;
  hostClientId: string | null;
  participants: RoomParticipant[];
}

export const DIFFICULTY_META: Record<
  Difficulty,
  { label: string; cols: number; rows: number; minArrows: number }
> = {
  normal: {
    label: 'Normal',
    cols: 8,
    rows: 10,
    minArrows: 18,
  },
  hard: {
    label: 'Hard',
    cols: 11,
    rows: 13,
    minArrows: 34,
  },
  master: {
    label: 'Master',
    cols: 14,
    rows: 16,
    minArrows: 58,
  },
  heart: {
    label: 'Heart',
    cols: 11,
    rows: 10,
    minArrows: 18,
  },
};

export function getLevelConfig(difficulty: Difficulty, level = 1) {
  const safeLevel = Math.max(1, Math.min(100, Math.floor(level)));
  const base = DIFFICULTY_META[difficulty];

  if (difficulty === 'heart') {
    return {
      cols: base.cols,
      rows: base.rows,
      minArrows: Math.min(32, base.minArrows + (safeLevel - 1) * 2),
      longShare: Math.min(0.28, 0.14 + safeLevel * 0.015),
      longMaxLen: Math.min(16, 8 + safeLevel),
      turnBias: Math.min(3.4, 1.8 + safeLevel * 0.15),
    };
  }

  // Aggressive progression: tight spaces, many turns, mixed big & small arrows
  const growth = safeLevel - 1;
  const extraCols = Math.min(10, Math.floor((growth + 1) / 2));
  const extraRows = Math.min(12, Math.floor(growth / 2) + (growth >= 1 ? 1 : 0));

  const cols = Math.min(18, base.cols + extraCols);
  const rows = Math.min(22, base.rows + extraRows);
  const totalCells = cols * rows;

  return {
    cols,
    rows,
    minArrows: Math.max(base.minArrows, Math.floor(totalCells * 0.22)),
    longShare: Math.min(0.32, 0.16 + safeLevel * 0.012),
    longMaxLen: Math.min(36, Math.floor((cols + rows) * (0.7 + Math.min(0.45, safeLevel * 0.025)))),
    turnBias: Math.min(3.8, 1.8 + safeLevel * 0.14),
  };
}

export function dirVector(dir: Direction): GridPoint {
  switch (dir) {
    case 'UP':
      return { x: 0, y: -1 };
    case 'DOWN':
      return { x: 0, y: 1 };
    case 'LEFT':
      return { x: -1, y: 0 };
    case 'RIGHT':
      return { x: 1, y: 0 };
  }
}

function vectorToDir(dx: number, dy: number): Direction {
  if (dx === 1) return 'RIGHT';
  if (dx === -1) return 'LEFT';
  if (dy === 1) return 'DOWN';
  return 'UP';
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildMask(difficulty: Difficulty, cols: number, rows: number): boolean[][] {
  const mask: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(true));
  if (difficulty !== 'heart') return mask;

  const heartRows = [
    '..XXX.XXX..',
    '.XXXXXXXXX.',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    'XXXXXXXXXXX',
    '.XXXXXXXXX.',
    '..XXXXXXX..',
    '...XXXXX...',
    '....XXX....',
    '.....X.....',
  ];
  for (let y = 0; y < rows; y++) {
    const rowStr = heartRows[y] || '';
    for (let x = 0; x < cols; x++) {
      mask[y][x] = rowStr[x] === 'X';
    }
  }
  return mask;
}

export function isArrowFree(
  arrow: ArrowEntity,
  remainingArrows: ArrowEntity[],
  cols: number,
  rows: number
): { free: boolean; blockedAt?: GridPoint } {
  const occupied = new Map<string, string>();
  for (const a of remainingArrows) {
    if (a.id === arrow.id) continue;
    for (const pt of a.points) {
      occupied.set(cellKey(pt.x, pt.y), a.id);
    }
  }

  const head = arrow.points[arrow.points.length - 1];
  const dv = dirVector(arrow.dir);
  let cx = head.x + dv.x;
  let cy = head.y + dv.y;

  while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
    if (occupied.has(cellKey(cx, cy))) {
      return { free: false, blockedAt: { x: cx, y: cy } };
    }
    cx += dv.x;
    cy += dv.y;
  }

  return { free: true };
}

export function findHintArrow(
  remainingArrows: ArrowEntity[],
  cols: number,
  rows: number
): ArrowEntity | null {
  for (const arrow of remainingArrows) {
    if (isArrowFree(arrow, remainingArrows, cols, rows).free) {
      return arrow;
    }
  }
  return null;
}

export function verifyBoardSolvable(board: PuzzleBoard): boolean {
  let remaining = [...board.arrows];
  while (remaining.length > 0) {
    const idx = remaining.findIndex((a) => isArrowFree(a, remaining, board.cols, board.rows).free);
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return true;
}

function isRayClearOfSet(
  head: GridPoint,
  dir: Direction,
  selfPoints: GridPoint[],
  occupiedByOthers: Set<string>,
  cols: number,
  rows: number
): boolean {
  const selfSet = new Set(selfPoints.map((p) => cellKey(p.x, p.y)));
  const dv = dirVector(dir);
  let cx = head.x + dv.x;
  let cy = head.y + dv.y;
  while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
    const k = cellKey(cx, cy);
    if (selfSet.has(k) || occupiedByOthers.has(k)) {
      return false;
    }
    cx += dv.x;
    cy += dv.y;
  }
  return true;
}

export function generatePuzzle(difficulty: Difficulty, seed: number, level = 1): PuzzleBoard {
  const safeLevel = Math.max(1, Math.min(100, Math.floor(level)));
  const cfg = getLevelConfig(difficulty, safeLevel);
  const { cols, rows, minArrows, longShare, longMaxLen, turnBias } = cfg;
  const activeMask = buildMask(difficulty, cols, rows);
  const allDirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

  let bestBoard: PuzzleBoard | null = null;

  for (let attempt = 0; attempt < 6; attempt++) {
    const rng = createRng(seed + attempt * 7919 + safeLevel * 131);
    const visited = new Set<string>();
    const polylines: GridPoint[][] = [];

    const isAvail = (x: number, y: number) =>
      x >= 0 && x < cols && y >= 0 && y < rows && activeMask[y][x] && !visited.has(cellKey(x, y));

    const countOpenNeighbors = (x: number, y: number): number => {
      let open = 0;
      for (const d of allDirs) {
        const dv = dirVector(d);
        if (isAvail(x + dv.x, y + dv.y)) open++;
      }
      return open;
    };

    const countWallsAndOccupied = (x: number, y: number): number => {
      let count = 0;
      for (const d of allDirs) {
        const dv = dirVector(d);
        const nx = x + dv.x;
        const ny = y + dv.y;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows || !activeMask[ny][nx] || visited.has(cellKey(nx, ny))) {
          count++;
        }
      }
      return count;
    };

    const growLine = (
      start: GridPoint,
      targetLen: number,
      wallHugWeight: number,
      straightWeight: number,
      turnWeight: number
    ) => {
      const line: GridPoint[] = [start];
      visited.add(cellKey(start.x, start.y));
      let prevDx = 0;
      let prevDy = 0;
      let runLen = 0;

      while (line.length < targetLen) {
        const cur = line[line.length - 1];
        const choices: Array<{ pt: GridPoint; dx: number; dy: number; score: number }> = [];

        for (const d of allDirs) {
          const dv = dirVector(d);
          const nx = cur.x + dv.x;
          const ny = cur.y + dv.y;
          if (!isAvail(nx, ny)) continue;

          const isStraight = dv.x === prevDx && dv.y === prevDy;
          // Encourage frequent 90-degree turns after short runs (2-4 cells) to create zig-zags & U-bends
          const bendBoost = !isStraight && runLen >= 2 ? turnWeight * 1.35 : 0;
          const moveScore = isStraight ? straightWeight / (1 + runLen * 0.35) : turnWeight + bendBoost;
          // Warnsdorff-like tight packing: slightly favor cells with fewer remaining open neighbors to prevent isolated holes
          const openN = countOpenNeighbors(nx, ny);
          const tightPackBonus = (4 - openN) * 0.9;
          const hug = countWallsAndOccupied(nx, ny);

          const score =
            moveScore +
            hug * wallHugWeight +
            tightPackBonus +
            rng() * 0.85;

          choices.push({ pt: { x: nx, y: ny }, dx: dv.x, dy: dv.y, score });
        }

        if (choices.length === 0) break;
        choices.sort((a, b) => b.score - a.score);
        const chosen = choices[0];
        if (chosen.dx === prevDx && chosen.dy === prevDy) {
          runLen++;
        } else {
          runLen = 1;
        }
        line.push(chosen.pt);
        visited.add(cellKey(chosen.pt.x, chosen.pt.y));
        prevDx = chosen.dx;
        prevDy = chosen.dy;
      }

      if (line.length >= 2) {
        polylines.push(line);
      } else {
        visited.delete(cellKey(start.x, start.y));
      }
    };

    const allCells: GridPoint[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (activeMask[y][x]) allCells.push({ x, y });
      }
    }

    // Phase A: Carve outer perimeter barriers & deep multi-turn snakes
    const edgeFirst = [...allCells].sort((a, b) => {
      const da = Math.min(a.x, cols - 1 - a.x, a.y, rows - 1 - a.y);
      const db = Math.min(b.x, cols - 1 - b.x, b.y, rows - 1 - b.y);
      if (da !== db) return da - db;
      return rng() - 0.5;
    });

    const totalActive = allCells.length;
    const longCellBudget = Math.floor(totalActive * longShare);
    let usedByLong = 0;

    for (const start of edgeFirst) {
      if (usedByLong >= longCellBudget) break;
      if (!isAvail(start.x, start.y)) continue;
      const len = Math.max(9, Math.floor(longMaxLen * (0.55 + rng() * 0.45)));
      const beforeCount = visited.size;
      growLine(start, len, 1.5, 3.0, turnBias * 0.85);
      usedByLong += visited.size - beforeCount;
    }

    // Phase B: Pack remaining cells tightly with zig-zag medium snakes & tiny 2-3 cell arrows
    const shuffled = [...allCells];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    for (const start of shuffled) {
      if (!isAvail(start.x, start.y)) continue;
      const roll = rng();
      const targetLen =
        roll < 0.52
          ? 2 + Math.floor(rng() * 2) // compact 2-3 cell arrows
          : roll < 0.88
            ? 4 + Math.floor(rng() * 4) // zig-zag 4-7 cell arrows
            : 8 + Math.floor(rng() * 5); // 8-12 cell winding arrows
      growLine(start, targetLen, 1.1, 1.1, turnBias);
    }

    // Phase B2: Absorb any remaining 2-cell pairs left adjacent after Phase B
    for (const start of allCells) {
      if (!isAvail(start.x, start.y)) continue;
      growLine(start, 4, 1.2, 1.0, turnBias);
    }

    // Phase C: Peel polylines outside-in; prefer hiding/trapping inward paths behind outer ones
    const pool: GridPoint[][] = polylines.map((p) => [...p]);
    const peeledArrows: ArrowEntity[] = [];
    let idCounter = 0;

    while (pool.length > 0) {
      const cellOwner = new Map<string, number>();
      for (let i = 0; i < pool.length; i++) {
        for (const pt of pool[i]) {
          cellOwner.set(cellKey(pt.x, pt.y), i);
        }
      }

      const freeCandidates: Array<{
        index: number;
        points: GridPoint[];
        dir: Direction;
        rayDist: number;
      }> = [];

      const rayLength = (head: GridPoint, dir: Direction): number => {
        if (dir === 'RIGHT') return cols - 1 - head.x;
        if (dir === 'LEFT') return head.x;
        if (dir === 'DOWN') return rows - 1 - head.y;
        return head.y;
      };

      for (let i = 0; i < pool.length; i++) {
        const pts = pool[i];
        if (pts.length < 2) continue;

        const othersOccupied = new Set<string>();
        for (const [k, ownerIdx] of cellOwner.entries()) {
          if (ownerIdx !== i) othersOccupied.add(k);
        }

        const headA = pts[pts.length - 1];
        const neckA = pts[pts.length - 2];
        const dirA = vectorToDir(headA.x - neckA.x, headA.y - neckA.y);
        const freeA = isRayClearOfSet(headA, dirA, pts, othersOccupied, cols, rows);

        const headB = pts[0];
        const neckB = pts[1];
        const dirB = vectorToDir(headB.x - neckB.x, headB.y - neckB.y);
        const freeB = isRayClearOfSet(headB, dirB, pts, othersOccupied, cols, rows);

        if (freeA && freeB) {
          // Choose the orientation that points deeper across the board (more intricate exit)
          const rA = rayLength(headA, dirA);
          const rB = rayLength(headB, dirB);
          if (rA >= rB) {
            freeCandidates.push({ index: i, points: pts, dir: dirA, rayDist: rA });
          } else {
            freeCandidates.push({ index: i, points: [...pts].reverse(), dir: dirB, rayDist: rB });
          }
        } else if (freeA) {
          freeCandidates.push({ index: i, points: pts, dir: dirA, rayDist: rayLength(headA, dirA) });
        } else if (freeB) {
          freeCandidates.push({ index: i, points: [...pts].reverse(), dir: dirB, rayDist: rayLength(headB, dirB) });
        }
      }

      if (freeCandidates.length > 0) {
        const pick = freeCandidates[Math.floor(rng() * freeCandidates.length)];
        peeledArrows.push({
          id: `a-${idCounter++}`,
          points: pick.points,
          dir: pick.dir,
        });
        pool.splice(pick.index, 1);
      } else {
        // Break mutual cycle by splitting longest line (>=6) or trimming shortest >=3 line
        let splitIdx = -1;
        let maxLen = 0;
        for (let i = 0; i < pool.length; i++) {
          if (pool[i].length >= 6 && pool[i].length > maxLen) {
            maxLen = pool[i].length;
            splitIdx = i;
          }
        }
        if (splitIdx !== -1) {
          const line = pool[splitIdx];
          const mid = Math.floor(line.length / 2);
          const leftHalf = line.slice(0, mid);
          const rightHalf = line.slice(mid);
          pool.splice(splitIdx, 1);
          if (leftHalf.length >= 2) pool.push(leftHalf);
          if (rightHalf.length >= 2) pool.push(rightHalf);
        } else {
          let trimIdx = -1;
          let minTrimLen = Infinity;
          for (let i = 0; i < pool.length; i++) {
            if (pool[i].length >= 3 && pool[i].length < minTrimLen) {
              minTrimLen = pool[i].length;
              trimIdx = i;
            }
          }
          if (trimIdx !== -1) {
            pool[trimIdx] = pool[trimIdx].slice(0, -1);
          } else {
            let minIdx = 0;
            for (let i = 1; i < pool.length; i++) {
              if (pool[i].length < pool[minIdx].length) minIdx = i;
            }
            pool.splice(minIdx, 1);
          }
        }
      }
    }

    // Phase D: Pack extra 2-3 cell arrows into any leftover empty pockets (prepended so they peel first)
    const finalOccupied = new Set<string>();
    for (const a of peeledArrows) {
      for (const p of a.points) finalOccupied.add(cellKey(p.x, p.y));
    }

    for (const start of shuffled) {
      const sk = cellKey(start.x, start.y);
      if (!activeMask[start.y][start.x] || finalOccupied.has(sk)) continue;

      for (const dir of allDirs) {
        const dv = dirVector(dir);
        const neck = { x: start.x - dv.x, y: start.y - dv.y };
        if (
          neck.x < 0 ||
          neck.x >= cols ||
          neck.y < 0 ||
          neck.y >= rows ||
          !activeMask[neck.y][neck.x] ||
          finalOccupied.has(cellKey(neck.x, neck.y))
        ) {
          continue;
        }
        const pts = [neck, start];
        if (isRayClearOfSet(start, dir, pts, finalOccupied, cols, rows)) {
          // Try extending tail 1 extra cell if available
          const tailExtOptions: GridPoint[] = [];
          for (const d2 of allDirs) {
            const dv2 = dirVector(d2);
            const tx = neck.x + dv2.x;
            const ty = neck.y + dv2.y;
            if (
              tx >= 0 &&
              tx < cols &&
              ty >= 0 &&
              ty < rows &&
              activeMask[ty][tx] &&
              !finalOccupied.has(cellKey(tx, ty)) &&
              !(tx === start.x && ty === start.y)
            ) {
              // Ensure tail extension doesn't sit on own exit ray
              const candidatePts = [{ x: tx, y: ty }, neck, start];
              if (isRayClearOfSet(start, dir, candidatePts, finalOccupied, cols, rows)) {
                tailExtOptions.push({ x: tx, y: ty });
              }
            }
          }
          const finalPts =
            tailExtOptions.length > 0
              ? [tailExtOptions[Math.floor(rng() * tailExtOptions.length)], neck, start]
              : pts;

          peeledArrows.unshift({
            id: `a-${idCounter++}`,
            points: finalPts,
            dir,
          });
          for (const fp of finalPts) finalOccupied.add(cellKey(fp.x, fp.y));
          break;
        }
      }
    }

    const candidateBoard: PuzzleBoard = {
      seed,
      difficulty,
      level: safeLevel,
      cols,
      rows,
      activeMask,
      arrows: peeledArrows,
    };

    if (!bestBoard || candidateBoard.arrows.length > bestBoard.arrows.length) {
      bestBoard = candidateBoard;
    }

    if (candidateBoard.arrows.length >= minArrows && verifyBoardSolvable(candidateBoard)) {
      return candidateBoard;
    }
  }

  return bestBoard!;
}

export function formatTimeMs(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((safe % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}
