import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { WIDTH, finitePoints, lineSegments, projection, type Point } from './geometry.ts';
import { placeCallout, type Box } from './callout-place.ts';
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

export type TrackCallout = { turn: number; sM: number; side: 1 | -1; title: string; detail: string };

type TrackMapProps = {
  reference: TrackLine;
  attempt?: TrackLine | null;
  far?: TrackLine | null;
  callouts?: TrackCallout[];
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
const NO_CALLOUTS: TrackCallout[] = [];
const NO_POINTS: Point[] = [];

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
  farSegments: string[];
  startPoint: Point | null;
  endPoint: Point | null;
};

function geometryOf(reference: TrackLine, attempt: TrackLine | null | undefined, far: TrackLine | null | undefined): Geometry | null {
  if (finitePoints(reference).length < 2) return null;
  const { height, project } = projection(attempt ? [reference, attempt] : [reference]);
  const projected = (point: Point | null) => (point ? project(point[0], point[1]) : null);
  return {
    height,
    project,
    referenceSegments: lineSegments(reference, project),
    attemptSegments: attempt ? lineSegments(attempt, project) : null,
    farSegments: far ? lineSegments(far, project) : [],
    startPoint: projected(pointOn(reference, 0)),
    endPoint: projected(pointOn(reference, (reference.x.length - 1) * reference.gridM))
  };
}

const LinesLayer = memo(function LinesLayer({ geometry }: { geometry: Geometry }) {
  const { referenceSegments, attemptSegments, farSegments, startPoint, endPoint } = geometry;
  return (
    <>
      {referenceSegments.map((points, index) => (
        <polyline key={`r${index}`} className="track-reference" points={points} />
      ))}
      {attemptSegments ? attemptSegments.map((points, index) => <polyline key={`a${index}`} className="track-attempt" data-segment="attempt" points={points} />) : null}
      {farSegments.map((points, index) => (
        <polyline key={`f${index}`} className="track-far" points={points} />
      ))}
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

const CALLOUT_WIDTH = 150;
const CALLOUT_HEIGHT = 44;
const CALLOUT_LEADER = 70;
const CALLOUT_MARGIN = 4;
const CALLOUT_CLEARANCE = 6;
const CALLOUT_DOT_PX = 7;
const LABEL_WIDTH = 48;
const RING_STEPS = 8;

function ring([x, y]: Point, radius: number): Point[] {
  return [[x, y], ...Array.from({ length: RING_STEPS }, (_, index) => [x + radius * Math.cos((index * 2 * Math.PI) / RING_STEPS), y + radius * Math.sin((index * 2 * Math.PI) / RING_STEPS)] as Point)];
}

function labelPoints(point: Point | null, toLeft: boolean): Point[] {
  if (!point) return [];
  return Array.from({ length: 7 }, (_, index) => [point[0] + (toLeft ? -1 : 1) * (index * LABEL_WIDTH) / 6, point[1] - 21] as Point);
}

type ObstacleInput = { geometry: Geometry; reference: TrackLine; attempt: TrackLine | null | undefined; marks: TrackMark[] };

function obstaclesOf({ geometry, reference, attempt, marks }: ObstacleInput): Point[] {
  const { project } = geometry;
  const projectAll = (line: TrackLine) => finitePoints(line).map(([x, z]) => project(x, z));
  const markPoints = marks.flatMap(mark => {
    const at = normalAt(reference, mark.sM, project);
    if (!at) return [];
    if (mark.kind === 'turn-in') return [[at.x - at.nx * TICK_HALF_PX, at.y - at.ny * TICK_HALF_PX] as Point, [at.x + at.nx * TICK_HALF_PX, at.y + at.ny * TICK_HALF_PX] as Point];
    if (mark.kind === 'apex') return ring([at.x - at.nx * APEX_OFFSET_PX, at.y - at.ny * APEX_OFFSET_PX], APEX_RADIUS_PX);
    const point = pointOn(mark.onAttempt && attempt ? attempt : reference, mark.sM);
    return point ? ring(project(point[0], point[1]), mark.label ? 13 : 10) : [];
  });
  return [
    ...projectAll(reference),
    ...(attempt ? projectAll(attempt) : []),
    ...labelPoints(geometry.startPoint, true),
    ...labelPoints(geometry.endPoint, false),
    ...markPoints
  ];
}

type CalloutsLayerProps = { callouts: TrackCallout[]; reference: TrackLine; line: TrackLine; obstacles: Point[]; project: (x: number, z: number) => Point; height: number; scale: number };

const CalloutsLayer = memo(function CalloutsLayer({ callouts, reference, line, obstacles, project, height, scale }: CalloutsLayerProps) {
  const width = CALLOUT_WIDTH * scale;
  const boxHeight = CALLOUT_HEIGHT * scale;
  const taken: Box[] = [];
  return (
    <>
      {callouts.map(callout => {
        const point = pointOn(line, callout.sM);
        const normal = normalAt(reference, callout.sM, project);
        if (!point || !normal) return null;
        const anchor = project(point[0], point[1]);
        const { box, end } = placeCallout({
          anchor,
          normal: [normal.nx, normal.ny],
          side: callout.side,
          width,
          height: boxHeight,
          leader: CALLOUT_LEADER * scale,
          bounds: { width: WIDTH, height },
          margin: CALLOUT_MARGIN * scale,
          clearance: CALLOUT_CLEARANCE * scale,
          obstacles,
          taken
        });
        taken.push(box);
        const padX = 10 * scale;
        return (
          <g key={callout.turn} className="track-callout">
            <line className="callout-leader" x1={anchor[0]} y1={anchor[1]} x2={end[0]} y2={end[1]} />
            <rect x={box.x} y={box.y} width={width} height={boxHeight} />
            <text className="callout-title" x={box.x + padX} y={box.y + 19 * scale} style={{ fontSize: 17 * scale }}>
              {callout.title}
            </text>
            <text className="callout-detail" x={box.x + padX} y={box.y + 37 * scale} style={{ fontSize: 13 * scale }}>
              {callout.detail}
            </text>
            <circle className="callout-dot" cx={anchor[0]} cy={anchor[1]} r={CALLOUT_DOT_PX * scale} />
          </g>
        );
      })}
    </>
  );
});

function useUnitsPerPixel(svg: RefObject<SVGSVGElement | null>, height: number, active: boolean): number {
  const [units, setUnits] = useState(1);
  useEffect(() => {
    const element = svg.current;
    if (!active || !element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const pixels = Math.min(box.width / WIDTH, box.height / height);
      if (pixels > 0) setUnits(1 / pixels);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [svg, height, active]);
  return units;
}

export function TrackMap({ reference, attempt, far, callouts = NO_CALLOUTS, marks = NO_MARKS, cursorSM, dark = false, label }: TrackMapProps) {
  const geometry = useMemo(() => geometryOf(reference, attempt, far), [reference, attempt, far]);
  const svg = useRef<SVGSVGElement>(null);
  const calloutScale = useUnitsPerPixel(svg, geometry?.height ?? 1, callouts.length > 0);
  const obstacles = useMemo(() => (geometry && callouts.length > 0 ? obstaclesOf({ geometry, reference, attempt, marks }) : NO_POINTS), [geometry, callouts, reference, attempt, marks]);
  if (!geometry) return null;
  const { height, project } = geometry;
  const cursorLine = attempt ?? reference;
  const cursor = cursorSM === null || cursorSM === undefined ? null : pointOn(cursorLine, cursorSM);
  const cursorPoint = cursor ? project(cursor[0], cursor[1]) : null;
  return (
    <svg ref={svg} className={`track-map${dark ? ' dark' : ''}`} viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label}>
      <LinesLayer geometry={geometry} />
      <MarksLayer marks={marks} reference={reference} attempt={attempt} project={project} />
      <CalloutsLayer callouts={callouts} reference={reference} line={cursorLine} obstacles={obstacles} project={project} height={height} scale={calloutScale} />
      {cursorPoint ? <circle className="track-cursor" cx={cursorPoint[0]} cy={cursorPoint[1]} r={8} /> : null}
    </svg>
  );
}
