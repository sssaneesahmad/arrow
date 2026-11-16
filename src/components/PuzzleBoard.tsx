import React, { useEffect, useMemo, useState } from 'react';
import {
  type ArrowEntity,
  type Direction,
  type GridPoint,
  type PuzzleBoard as PuzzleBoardType,
  dirVector,
} from '../../shared/puzzle';

export interface ExitingArrow {
  arrow: ArrowEntity;
  key: string;
  startedAt: number;
}

interface PuzzleBoardProps {
  board: PuzzleBoardType;
  remainingArrows: ArrowEntity[];
  exitingArrows: ExitingArrow[];
  blockedArrowId: string | null;
  blockedCell: GridPoint | null;
  hintArrowId: string | null;
  showGridDots: boolean;
  disabled?: boolean;
  onTapArrow: (arrow: ArrowEntity) => void;
}

export const EXIT_ANIMATION_MS = 420;

interface PxPoint {
  x: number;
  y: number;
}

function toPixelPoints(points: GridPoint[], cellSize: number, pad: number): PxPoint[] {
  return points.map((pt) => ({
    x: pad + pt.x * cellSize + cellSize / 2,
    y: pad + pt.y * cellSize + cellSize / 2,
  }));
}

function buildPixelPathD(pts: PxPoint[]): string {
  if (pts.length === 0) return '';
  return pts
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
    .join(' ');
}

function buildArrowHeadPolygonAt(
  head: PxPoint,
  dir: Direction,
  cellSize: number
): string {
  const dv = dirVector(dir);
  const perpX = -dv.y;
  const perpY = dv.x;

  const tipOffset = cellSize * 0.27;
  const baseOffset = -cellSize * 0.1;
  const halfWidth = cellSize * 0.2;

  const tipX = head.x + dv.x * tipOffset;
  const tipY = head.y + dv.y * tipOffset;
  const baseLeftX = head.x + dv.x * baseOffset + perpX * halfWidth;
  const baseLeftY = head.y + dv.y * baseOffset + perpY * halfWidth;
  const baseRightX = head.x + dv.x * baseOffset - perpX * halfWidth;
  const baseRightY = head.y + dv.y * baseOffset - perpY * halfWidth;

  return `${tipX.toFixed(2)},${tipY.toFixed(2)} ${baseLeftX.toFixed(2)},${baseLeftY.toFixed(2)} ${baseRightX.toFixed(2)},${baseRightY.toFixed(2)}`;
}

/**
 * Slices a continuous polyline track from arc-length `startDist` to `endDist`,
 * allowing a bent snake arrow to unwind around its own corners and straighten
 * smoothly along the head's exit ray.
 */
function sliceTrack(
  track: PxPoint[],
  cumDist: number[],
  startDist: number,
  endDist: number
): PxPoint[] {
  const totalTrackLen = cumDist[cumDist.length - 1];
  const s = Math.max(0, Math.min(totalTrackLen, startDist));
  const e = Math.max(s, Math.min(totalTrackLen, endDist));

  const interpolateAt = (d: number): PxPoint => {
    for (let i = 0; i < cumDist.length - 1; i++) {
      const d0 = cumDist[i];
      const d1 = cumDist[i + 1];
      if (d >= d0 && d <= d1) {
        const segLen = d1 - d0;
        if (segLen <= 1e-6) return track[i];
        const ratio = (d - d0) / segLen;
        return {
          x: track[i].x + (track[i + 1].x - track[i].x) * ratio,
          y: track[i].y + (track[i + 1].y - track[i].y) * ratio,
        };
      }
    }
    return track[track.length - 1];
  };

  const result: PxPoint[] = [interpolateAt(s)];
  for (let i = 1; i < track.length - 1; i++) {
    if (cumDist[i] > s && cumDist[i] < e) {
      result.push(track[i]);
    }
  }
  result.push(interpolateAt(e));
  return result;
}

export const PuzzleBoard: React.FC<PuzzleBoardProps> = ({
  board,
  remainingArrows,
  exitingArrows,
  blockedArrowId,
  blockedCell,
  hintArrowId,
  showGridDots,
  disabled = false,
  onTapArrow,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [animNow, setAnimNow] = useState<number>(() => performance.now());

  // Run 60fps animation frame clock only while arrows are exiting
  useEffect(() => {
    if (exitingArrows.length === 0) return;
    let rafId = 0;
    const tick = () => {
      setAnimNow(performance.now());
      rafId = requestAnimationFrame(tick);
    };
    setAnimNow(performance.now());
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [exitingArrows.length]);

  const cellSize = useMemo(() => {
    const maxDim = Math.max(board.cols, board.rows);
    return Math.max(20, Math.min(46, Math.floor(500 / maxDim)));
  }, [board.cols, board.rows]);

  const pad = Math.round(cellSize * 0.72);
  const svgWidth = board.cols * cellSize + pad * 2;
  const svgHeight = board.rows * cellSize + pad * 2;
  const strokeW = Math.max(2.2, Number((cellSize * 0.1).toFixed(2)));

  const dots = useMemo(() => {
    const list: Array<{ x: number; y: number; key: string }> = [];
    for (let y = 0; y < board.rows; y++) {
      for (let x = 0; x < board.cols; x++) {
        if (!board.activeMask[y]?.[x]) continue;
        list.push({
          x: pad + x * cellSize + cellSize / 2,
          y: pad + y * cellSize + cellSize / 2,
          key: `${x}-${y}`,
        });
      }
    }
    return list;
  }, [board, cellSize, pad]);

  return (
    <div className="relative flex items-center justify-center w-full select-none overflow-hidden">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full max-w-[580px] max-h-[580px] h-auto overflow-visible touch-manipulation"
        role="img"
        aria-label={`Arrow puzzle board with ${remainingArrows.length} lines remaining`}
      >
        {/* Grid vertex dots */}
        {showGridDots &&
          dots.map((dot) => (
            <circle
              key={dot.key}
              cx={dot.x}
              cy={dot.y}
              r={Math.max(1.6, cellSize * 0.055)}
              fill="#CBD5E1"
            />
          ))}

        {/* Remaining arrows */}
        {remainingArrows.map((arrow) => {
          const isBlocked = blockedArrowId === arrow.id;
          const isHint = hintArrowId === arrow.id;
          const isHovered = hoveredId === arrow.id && !disabled;

          const strokeColor = isBlocked
            ? '#EF4444'
            : isHint
              ? '#1D7AFC'
              : isHovered
                ? '#1D7AFC'
                : '#0F172A';

          const pxPts = toPixelPoints(arrow.points, cellSize, pad);
          const pathD = buildPixelPathD(pxPts);
          const headPx = pxPts[pxPts.length - 1];
          const headPoly = buildArrowHeadPolygonAt(headPx, arrow.dir, cellSize);

          return (
            <g
              key={arrow.id}
              onClick={() => {
                if (!disabled) onTapArrow(arrow);
              }}
              onPointerEnter={() => setHoveredId(arrow.id)}
              onPointerLeave={() => setHoveredId((prev) => (prev === arrow.id ? null : prev))}
              className={`${disabled ? 'cursor-default' : 'cursor-pointer'} ${
                isBlocked ? 'animate-arrow-shake' : ''
              } ${isHint ? 'animate-hint-pulse' : ''}`}
            >
              {isHint && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="#93C5FD"
                  strokeWidth={strokeW * 2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.55}
                />
              )}

              <path
                d={pathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeW}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-colors duration-150"
              />

              <polygon
                points={headPoly}
                fill={strokeColor}
                stroke={strokeColor}
                strokeWidth={1.3}
                strokeLinejoin="round"
                className="transition-colors duration-150"
              />

              <path
                d={pathD}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(22, cellSize * 0.72)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {/* Snake-style path-following exiting arrows */}
        {exitingArrows.map(({ arrow, key, startedAt }) => {
          const rawT = Math.min(1, Math.max(0, (animNow - startedAt) / EXIT_ANIMATION_MS));
          // Smooth brisk ease-out curve so arrows launch immediately and glide off-screen
          const eased = 1 - Math.pow(1 - rawT, 1.75);

          const basePts = toPixelPoints(arrow.points, cellSize, pad);
          const headPx = basePts[basePts.length - 1];
          const dv = dirVector(arrow.dir);

          // Exact distance from head to past the canvas boundary along exit direction
          let distToEdge = svgWidth;
          if (arrow.dir === 'RIGHT') distToEdge = svgWidth - headPx.x + cellSize * 2.5;
          else if (arrow.dir === 'LEFT') distToEdge = headPx.x + cellSize * 2.5;
          else if (arrow.dir === 'DOWN') distToEdge = svgHeight - headPx.y + cellSize * 2.5;
          else distToEdge = headPx.y + cellSize * 2.5;

          // Build cumulative arc lengths of the original bent snake
          let bodyLen = 0;
          const cumDist: number[] = [0];
          for (let i = 1; i < basePts.length; i++) {
            const dx = basePts[i].x - basePts[i - 1].x;
            const dy = basePts[i].y - basePts[i - 1].y;
            bodyLen += Math.hypot(dx, dy);
            cumDist.push(bodyLen);
          }

          // Extend straight past the edge so the snake fully unwinds into a straight line
          const extension = distToEdge + bodyLen + cellSize * 2;
          const fullTrack: PxPoint[] = [
            ...basePts,
            {
              x: headPx.x + dv.x * extension,
              y: headPx.y + dv.y * extension,
            },
          ];
          cumDist.push(bodyLen + extension);

          const travelOffset = eased * (distToEdge + bodyLen + cellSize);
          const slicedPts = sliceTrack(fullTrack, cumDist, travelOffset, travelOffset + bodyLen);
          const slicedHead = slicedPts[slicedPts.length - 1];
          const slicedPathD = buildPixelPathD(slicedPts);
          const slicedHeadPoly = buildArrowHeadPolygonAt(slicedHead, arrow.dir, cellSize);
          const fadeOpacity = rawT > 0.78 ? Math.max(0, 1 - (rawT - 0.78) / 0.22) : 1;

          return (
            <g
              key={key}
              opacity={fadeOpacity}
              pointerEvents="none"
            >
              <path
                d={slicedPathD}
                fill="none"
                stroke="#1D7AFC"
                strokeWidth={strokeW * 1.05}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polygon
                points={slicedHeadPoly}
                fill="#1D7AFC"
                stroke="#1D7AFC"
                strokeWidth={1.3}
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {/* Blocking cell collision ping */}
        {blockedCell && (
          <circle
            cx={pad + blockedCell.x * cellSize + cellSize / 2}
            cy={pad + blockedCell.y * cellSize + cellSize / 2}
            r={cellSize * 0.28}
            fill="#EF4444"
            opacity={0.28}
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
  );
};
