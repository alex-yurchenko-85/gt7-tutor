import { memo, useMemo } from 'react';
import { WIDTH, finitePoints, lineSegments, projection, type Point } from './geometry.ts';
import './charts.css';

export type TrackLine = { gridM: number; x: (number | null)[]; z: (number | null)[] };

export type TrackMark = {
  sM: number;
  kind?: 'cue' | 'turn-in' | 'apex';
  title: string;
  label?: string;
  selected?: boolean;
  muted?: boolean;
  onAttempt?: boolean;
  onSelect?: () => void;
};

type TrackMapProps = {
  reference: TrackLine;
  attempt?: TrackLine | null;
  marks?: TrackMark[];
  cursorSM?: number | null;
  dark?: boolean;
  label: string;
};

function pointOn(line: TrackLine, sM: number): Point | null {
  const last = line.x.length - 1;
  const target = Math.max(0, Math.min(last, Math.round(sM / line.gridM)));
  for (let distance = 0; distance <= last; distance++) {
    for (const index of [target - distance, target + distance]) {
      const x = line.x[index];
      const z = line.z[index];
      if (x !== null && x !== undefined && z !== null && z !== undefined) return [x, z];
    }
  }
  return null;
}

const NO_MARKS: TrackMark[] = [];

const TICK_HALF_PX = 9;
const APEX_OFFSET_PX = 30;
const APEX_RADIUS_PX = 12;

type Normal = { x: number; y: number; nx: number; ny: number };

function normalAt(reference: TrackLine, sM: number, project: (x: number, z: number) => Point): Normal | null {
  const here = pointOn(reference, sM);
  const ahead = pointOn(reference, sM + reference.gridM * 2);
  if (!here || !ahead) return null;
  const [x, y] = project(here[0], here[1]);
  const [ax, ay] = project(ahead[0], ahead[1]);
  const length = Math.hypot(ax - x, ay - y) || 1;
  return { x, y, nx: -(ay - y) / length, ny: (ax - x) / length };
}

type MarkProps = { mark: TrackMark; reference: TrackLine; project: (x: number, z: number) => Point };

function TurnInTick({ mark, reference, project }: MarkProps) {
  const at = normalAt(reference, mark.sM, project);
  if (!at) return null;
  const dx = at.nx * TICK_HALF_PX;
  const dy = at.ny * TICK_HALF_PX;
  return (
    <g className="track-mark turn-in">
      <title>{mark.title}</title>
      <line x1={at.x - dx} y1={at.y - dy} x2={at.x + dx} y2={at.y + dy} />
    </g>
  );
}

function ApexMark({ mark, reference, project }: MarkProps) {
  const at = normalAt(reference, mark.sM, project);
  if (!at) return null;
  const cx = at.x - at.nx * APEX_OFFSET_PX;
  const cy = at.y - at.ny * APEX_OFFSET_PX;
  return (
    <g className="track-mark apex">
      <title>{mark.title}</title>
      <line className="leader" x1={at.x} y1={at.y} x2={cx} y2={cy} />
      <circle className="dot" cx={at.x} cy={at.y} r={4} />
      <circle cx={cx} cy={cy} r={APEX_RADIUS_PX} />
      <text x={cx} y={cy + 4} textAnchor="middle">
        {mark.label}
      </text>
    </g>
  );
}

type Geometry = {
  height: number;
  project: (x: number, z: number) => Point;
  referenceSegments: string[];
  attemptSegments: string[] | null;
  startPoint: Point | null;
  endPoint: Point | null;
};

function geometryOf(reference: TrackLine, attempt: TrackLine | null | undefined): Geometry | null {
  if (finitePoints(reference).length < 2) return null;
  const { height, project } = projection(attempt ? [reference, attempt] : [reference]);
  const projected = (point: Point | null) => (point ? project(point[0], point[1]) : null);
  return {
    height,
    project,
    referenceSegments: lineSegments(reference, project),
    attemptSegments: attempt ? lineSegments(attempt, project) : null,
    startPoint: projected(pointOn(reference, 0)),
    endPoint: projected(pointOn(reference, (reference.x.length - 1) * reference.gridM))
  };
}

const LinesLayer = memo(function LinesLayer({ geometry }: { geometry: Geometry }) {
  const { referenceSegments, attemptSegments, startPoint, endPoint } = geometry;
  return (
    <>
      {referenceSegments.map((points, index) => (
        <polyline key={`r${index}`} className="track-reference" points={points} />
      ))}
      {attemptSegments ? attemptSegments.map((points, index) => <polyline key={`a${index}`} className="track-attempt" data-segment="attempt" points={points} />) : null}
      {startPoint ? (
        <text className="track-label" x={startPoint[0]} y={startPoint[1] - 16} textAnchor="end">
          start
        </text>
      ) : null}
      {endPoint ? (
        <text className="track-label" x={endPoint[0]} y={endPoint[1] - 16}>
          finish
        </text>
      ) : null}
    </>
  );
});

type MarksLayerProps = { marks: TrackMark[]; reference: TrackLine; attempt: TrackLine | null | undefined; project: (x: number, z: number) => Point };

const MarksLayer = memo(function MarksLayer({ marks, reference, attempt, project }: MarksLayerProps) {
  const projected = (point: Point | null) => (point ? project(point[0], point[1]) : null);
  return (
    <>
      {marks.map((mark, index) => {
        if (mark.kind === 'turn-in') return <TurnInTick key={index} mark={mark} reference={reference} project={project} />;
        if (mark.kind === 'apex') return <ApexMark key={index} mark={mark} reference={reference} project={project} />;
        const at = projected(pointOn(mark.onAttempt && attempt ? attempt : reference, mark.sM));
        if (!at) return null;
        const radius = mark.label ? 13 : mark.selected ? 10 : 7;
        const className = `track-mark${mark.selected ? ' selected' : ''}${mark.muted ? ' muted' : ''}${mark.onAttempt ? ' on-attempt' : ''}`;
        const content = (
          <>
            <title>{mark.title}</title>
            <circle cx={at[0]} cy={at[1]} r={radius} />
            {mark.label ? (
              <text x={at[0]} y={at[1] + 5} textAnchor="middle">
                {mark.label}
              </text>
            ) : null}
          </>
        );
        return mark.onSelect ? (
          <g
            key={index}
            className={className}
            role="button"
            tabIndex={0}
            aria-label={mark.title}
            onClick={mark.onSelect}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                mark.onSelect?.();
              }
            }}
          >
            {content}
          </g>
        ) : (
          <g key={index} className={className}>
            {content}
          </g>
        );
      })}
    </>
  );
});

export function TrackMap({ reference, attempt, marks = NO_MARKS, cursorSM, dark = false, label }: TrackMapProps) {
  const geometry = useMemo(() => geometryOf(reference, attempt), [reference, attempt]);
  if (!geometry) return null;
  const { height, project } = geometry;
  const cursorLine = attempt ?? reference;
  const cursor = cursorSM === null || cursorSM === undefined ? null : pointOn(cursorLine, cursorSM);
  const cursorPoint = cursor ? project(cursor[0], cursor[1]) : null;
  return (
    <svg className={`track-map${dark ? ' dark' : ''}`} viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label}>
      <LinesLayer geometry={geometry} />
      <MarksLayer marks={marks} reference={reference} attempt={attempt} project={project} />
      {cursorPoint ? <circle className="track-cursor" cx={cursorPoint[0]} cy={cursorPoint[1]} r={8} /> : null}
    </svg>
  );
}
