import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { WIDTH, clamp, finitePoints, lineSegments, projection, rounded, zoneIndexes, type Point } from './geometry.ts';
import { Icon } from '../app/icons.tsx';
import { placeCallout, type Box } from './callout-place.ts';
import './charts.css';

export type TrackLine = { gridM: number; x: (number | null)[]; z: (number | null)[] };

export type TrackMark = {
  sM: number;
  kind?: 'turn';
  toSM?: number;
  title: string;
  label?: string;
  selected?: boolean;
  muted?: boolean;
  notSpoken?: boolean;
  speaking?: boolean;
  onAttempt?: boolean;
  onSelect?: () => void;
  variant?: 'off-all' | 'off-part' | 'place';
  beside?: boolean;
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
  plain?: boolean;
  lapLine?: boolean;
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

const CUE_RADIUS_PX = 13;
const TURN_LABEL_OFFSETS_PX = [24, 40, 56];
const TURN_LABEL_RADIUS_PX = 14;
const SPREAD_GAP_PX = 28;
const SPREAD_OFFSET_PX = 30;
const PLACE_RADIUS_PX = 11;
const END_LABEL_OFFSETS_PX = [24, 44, 64];
const END_LABEL_HALF_PX = 24;
const END_LABEL_SIDE_PX = 40;
const LAP_LINE_LABEL_OFFSETS_PX: [number, number][] = [
  [0, END_LABEL_SIDE_PX],
  [0, -END_LABEL_SIDE_PX],
  [0, 2 * END_LABEL_SIDE_PX],
  [0, -2 * END_LABEL_SIDE_PX]
];
const START_BAR_HALF_PX = 11;
const ARROW_SIDE_PX = 22;
const ARROW_LENGTH_PX = 34;
const ARROW_HEAD_PX = 9;
const FINISH_HALF_PX = 15;
const FINISH_DEPTH_PX = 10;
const FINISH_CELLS = 6;
const DIRECTION_SPAN_PX = 6;
const BADGE_RADIUS_PX = 8;
const BADGE_ICON_PX = 12;

type Project = (x: number, z: number) => Point;

function normalAt(reference: TrackLine, sM: number, project: Project): Point | null {
  const here = pointOn(reference, sM);
  const ahead = pointOn(reference, sM + reference.gridM * 2);
  if (!here || !ahead) return null;
  const [x, y] = project(here[0], here[1]);
  const [ax, ay] = project(ahead[0], ahead[1]);
  const length = Math.hypot(ax - x, ay - y) || 1;
  return [-(ay - y) / length, (ax - x) / length];
}

type Circle = { at: Point; r: number };

function inside([x, y]: Point, margin: number, height: number): Point {
  return [rounded(clamp(x, margin, WIDTH - margin)), rounded(clamp(y, margin, height - margin))];
}

function firstClear(spots: Point[], r: number, taken: Circle[]): Point {
  return spots.find(spot => taken.every(circle => Math.hypot(circle.at[0] - spot[0], circle.at[1] - spot[1]) >= circle.r + r)) ?? spots[0]!;
}

function markRadius(mark: TrackMark): number {
  if (mark.variant === 'place') return PLACE_RADIUS_PX;
  return mark.label ? CUE_RADIUS_PX : mark.selected ? 10 : 7;
}

type Geometry = {
  height: number;
  project: Project;
  referenceSegments: string[];
  attemptSegments: string[] | null;
  farSegments: string[];
  startPoint: Point | null;
  endPoint: Point | null;
  startDirection: Point | null;
  endDirection: Point | null;
};

function directionAway(points: Point[]): Point | null {
  const [from] = points;
  if (!from) return null;
  const to = points.find(point => Math.hypot(point[0] - from[0], point[1] - from[1]) >= DIRECTION_SPAN_PX);
  if (!to) return null;
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
}

function geometryOf(reference: TrackLine, attempt: TrackLine | null | undefined, far: TrackLine | null | undefined): Geometry | null {
  const finite = finitePoints(reference);
  if (finite.length < 2) return null;
  const { height, project } = projection(attempt ? [reference, attempt] : [reference]);
  const line = finite.map(([x, z]) => project(x, z));
  const fromEnd = directionAway([...line].reverse());
  return {
    height,
    project,
    referenceSegments: lineSegments(reference, project),
    attemptSegments: attempt ? lineSegments(attempt, project) : null,
    farSegments: far ? lineSegments(far, project) : [],
    startPoint: line[0]!,
    endPoint: line.at(-1)!,
    startDirection: directionAway(line),
    endDirection: fromEnd ? [-fromEnd[0], -fromEnd[1]] : null
  };
}

type Placed = { anchor: Point; centre: Point; spread: boolean };
type TurnPlace = { key: number; segments: string[]; label: { text: string; at: Point } | null };
type Ends = { start: Point | null; finish: Point | null };
type Layout = { placed: (Placed | null)[]; turns: TurnPlace[]; ends: Ends; taken: Circle[] };

const NO_LAYOUT: Layout = { placed: [], turns: [], ends: { start: null, finish: null }, taken: [] };

function placeMarks(marks: TrackMark[], reference: TrackLine, attempt: TrackLine | null | undefined, { project, height }: Geometry): (Placed | null)[] {
  const placed: (Placed | null)[] = marks.map(mark => {
    if (mark.kind === 'turn') return null;
    const point = pointOn(mark.onAttempt && attempt ? attempt : reference, mark.sM);
    if (!point) return null;
    const anchor = project(point[0], point[1]);
    return { anchor, centre: anchor, spread: false };
  });
  const spread = (cluster: number[]) => {
    if (cluster.length < 2) return;
    cluster.forEach((index, order) => {
      const normal = normalAt(reference, marks[index]!.sM, project);
      const { anchor } = placed[index]!;
      if (!normal) return;
      const distance = (order % 2 === 0 ? -1 : 1) * (SPREAD_OFFSET_PX + Math.floor(order / 2) * SPREAD_GAP_PX);
      placed[index] = { anchor, centre: inside([anchor[0] + normal[0] * distance, anchor[1] + normal[1] * distance], CUE_RADIUS_PX + 2, height), spread: true };
    });
  };
  const labelled = marks.flatMap((mark, index) => (placed[index] && mark.label ? [index] : [])).sort((a, b) => marks[a]!.sM - marks[b]!.sM);
  let cluster: number[] = [];
  for (const index of labelled) {
    const last = cluster.at(-1);
    if (last !== undefined) {
      const [ax, ay] = placed[last]!.anchor;
      const [bx, by] = placed[index]!.anchor;
      if (Math.hypot(bx - ax, by - ay) >= SPREAD_GAP_PX) {
        spread(cluster);
        cluster = [];
      }
    }
    cluster.push(index);
  }
  spread(cluster);
  marks.forEach((mark, index) => {
    const place = placed[index];
    if (!mark.beside || !place || place.spread) return;
    const normal = normalAt(reference, mark.sM, project);
    if (!normal) return;
    const { anchor } = place;
    placed[index] = { anchor, centre: inside([anchor[0] - normal[0] * SPREAD_OFFSET_PX, anchor[1] - normal[1] * SPREAD_OFFSET_PX], CUE_RADIUS_PX + 2, height), spread: true };
  });
  return placed;
}

function placeTurns(marks: TrackMark[], reference: TrackLine, { project, height }: Geometry, taken: Circle[]): TurnPlace[] {
  return marks.flatMap((mark, key): TurnPlace[] => {
    if (mark.kind !== 'turn' || mark.toSM === undefined) return [];
    const [first, last] = zoneIndexes(mark.sM, mark.toSM, reference.gridM, reference.x.length);
    const zone: TrackLine = { gridM: reference.gridM, x: reference.x.slice(first, last + 1), z: reference.z.slice(first, last + 1) };
    const segments = lineSegments(zone, project);
    const points = finitePoints(zone).map(([x, z]) => project(x, z));
    if (segments.length === 0) return [];
    if (!mark.label) return [{ key, segments, label: null }];
    const middle = points[Math.floor(points.length / 2)]!;
    const chord: Point = [(points[0]![0] + points.at(-1)![0]) / 2, (points[0]![1] + points.at(-1)![1]) / 2];
    const bend = Math.hypot(middle[0] - chord[0], middle[1] - chord[1]);
    const normal = normalAt(reference, (mark.sM + mark.toSM) / 2, project);
    const outward: Point = bend >= 1 ? [(middle[0] - chord[0]) / bend, (middle[1] - chord[1]) / bend] : normal ? [-normal[0], -normal[1]] : [0, -1];
    const spots = TURN_LABEL_OFFSETS_PX.map(offset => inside([middle[0] + outward[0] * offset, middle[1] + outward[1] * offset], TURN_LABEL_RADIUS_PX + 2, height));
    const at = firstClear(spots, TURN_LABEL_RADIUS_PX, taken);
    taken.push({ at, r: TURN_LABEL_RADIUS_PX });
    return [{ key, segments, label: { text: mark.label, at } }];
  });
}

function placeEnds(geometry: Geometry, taken: Circle[], lapLine: boolean): Ends {
  const place = (point: Point | null, direction: Point | null, sign: 1 | -1, offsets: [number, number][]): Point | null => {
    if (!point || !direction) return null;
    const spot = ([along, across]: [number, number]): Point =>
      inside([point[0] + sign * direction[0] * along - direction[1] * across, point[1] + sign * direction[1] * along + direction[0] * across], END_LABEL_HALF_PX, geometry.height);
    const at = firstClear(offsets.map(spot), END_LABEL_HALF_PX, taken);
    taken.push({ at, r: END_LABEL_HALF_PX });
    return at;
  };
  if (lapLine) return { start: place(geometry.startPoint, geometry.startDirection, 1, LAP_LINE_LABEL_OFFSETS_PX), finish: null };
  const beyond: [number, number][] = [...END_LABEL_OFFSETS_PX.map((offset): [number, number] => [offset, 0]), [0, END_LABEL_SIDE_PX], [0, -END_LABEL_SIDE_PX]];
  return { start: place(geometry.startPoint, geometry.startDirection, -1, beyond), finish: place(geometry.endPoint, geometry.endDirection, 1, beyond) };
}

function layoutOf(marks: TrackMark[], reference: TrackLine, attempt: TrackLine | null | undefined, geometry: Geometry, lapLine: boolean): Layout {
  const placed = placeMarks(marks, reference, attempt, geometry);
  const taken: Circle[] = placed.flatMap((place, index) => (place ? [{ at: place.centre, r: markRadius(marks[index]!) }] : []));
  const turns = placeTurns(marks, reference, geometry, taken);
  const ends = placeEnds(geometry, taken, lapLine);
  return { placed, turns, ends, taken };
}

type StartShape = { barFrom: Point; barTo: Point; tail: Point; tip: Point; heads: [Point, Point] };

function startShape(at: Point, [dx, dy]: Point): StartShape {
  const nx = -dy;
  const ny = dx;
  const tail: Point = [at[0] + nx * ARROW_SIDE_PX, at[1] + ny * ARROW_SIDE_PX];
  const tip: Point = [tail[0] + dx * ARROW_LENGTH_PX, tail[1] + dy * ARROW_LENGTH_PX];
  const head = (side: 1 | -1): Point => [rounded(tip[0] - dx * ARROW_HEAD_PX + side * nx * 6), rounded(tip[1] - dy * ARROW_HEAD_PX + side * ny * 6)];
  return {
    barFrom: [rounded(at[0] - nx * START_BAR_HALF_PX), rounded(at[1] - ny * START_BAR_HALF_PX)],
    barTo: [rounded(at[0] + nx * START_BAR_HALF_PX), rounded(at[1] + ny * START_BAR_HALF_PX)],
    tail: [rounded(tail[0]), rounded(tail[1])],
    tip: [rounded(tip[0]), rounded(tip[1])],
    heads: [head(1), head(-1)]
  };
}

function StartMark({ shape }: { shape: StartShape }) {
  const { barFrom, barTo, tail, tip, heads } = shape;
  return (
    <>
      <line className="track-start" x1={barFrom[0]} y1={barFrom[1]} x2={barTo[0]} y2={barTo[1]} />
      <g className="track-direction" aria-hidden="true">
        <line x1={tail[0]} y1={tail[1]} x2={tip[0]} y2={tip[1]} />
        <polyline points={[heads[0], tip, heads[1]].map(point => point.join(',')).join(' ')} />
      </g>
    </>
  );
}

function FinishMark({ at, direction }: { at: Point; direction: Point }) {
  const angle = rounded((Math.atan2(direction[0], -direction[1]) * 180) / Math.PI);
  const size = (2 * FINISH_HALF_PX) / FINISH_CELLS;
  const cells = [0, 1].flatMap(row =>
    Array.from({ length: FINISH_CELLS }, (_, column) => (
      <rect
        key={`${row}-${column}`}
        className={(row + column) % 2 === 0 ? 'on' : 'off'}
        x={-FINISH_HALF_PX + column * size}
        y={-FINISH_DEPTH_PX / 2 + (row * FINISH_DEPTH_PX) / 2}
        width={size}
        height={FINISH_DEPTH_PX / 2}
      />
    ))
  );
  return (
    <g className="track-finish" transform={`translate(${at[0]} ${at[1]}) rotate(${angle})`} aria-hidden="true">
      {cells}
      <rect className="frame" x={-FINISH_HALF_PX} y={-FINISH_DEPTH_PX / 2} width={2 * FINISH_HALF_PX} height={FINISH_DEPTH_PX} />
    </g>
  );
}

const EndsLayer = memo(function EndsLayer({ geometry, ends, lapLine }: { geometry: Geometry; ends: Ends; lapLine: boolean }) {
  const { startPoint, endPoint, startDirection, endDirection } = geometry;
  if (lapLine) {
    if (!startPoint || !startDirection) return null;
    const { barFrom, barTo } = startShape(startPoint, startDirection);
    return (
      <>
        <line className="track-start" x1={barFrom[0]} y1={barFrom[1]} x2={barTo[0]} y2={barTo[1]} />
        {ends.start ? (
          <text className="track-label" x={ends.start[0]} y={ends.start[1]} textAnchor="middle" dominantBaseline="central">
            lap line
          </text>
        ) : null}
      </>
    );
  }
  const labels: [string, Point | null][] = [
    ['start', ends.start],
    ['finish', ends.finish]
  ];
  return (
    <>
      {startPoint && startDirection ? <StartMark shape={startShape(startPoint, startDirection)} /> : null}
      {endPoint && endDirection ? <FinishMark at={endPoint} direction={endDirection} /> : null}
      {labels.map(([text, at]) =>
        at ? (
          <text key={text} className="track-label" x={at[0]} y={at[1]} textAnchor="middle" dominantBaseline="central">
            {text}
          </text>
        ) : null
      )}
    </>
  );
});

const TurnsLayer = memo(function TurnsLayer({ turns }: { turns: TurnPlace[] }) {
  return <>{turns.flatMap(turn => turn.segments.map((points, index) => <polyline key={`${turn.key}-${index}`} className="track-turn" points={points} />))}</>;
});

const TurnLabelsLayer = memo(function TurnLabelsLayer({ turns }: { turns: TurnPlace[] }) {
  return (
    <>
      {turns.map(({ key, label }) =>
        label ? (
          <text key={key} className="track-turn-label" x={label.at[0]} y={label.at[1]} textAnchor="middle" dominantBaseline="central">
            {label.text}
          </text>
        ) : null
      )}
    </>
  );
});

const LinesLayer = memo(function LinesLayer({ geometry }: { geometry: Geometry }) {
  const { referenceSegments, attemptSegments, farSegments } = geometry;
  return (
    <>
      {referenceSegments.map((points, index) => (
        <polyline key={`r${index}`} className="track-reference" points={points} />
      ))}
      {attemptSegments ? attemptSegments.map((points, index) => <polyline key={`a${index}`} className="track-attempt" data-segment="attempt" points={points} />) : null}
      {farSegments.map((points, index) => (
        <polyline key={`f${index}`} className="track-far" points={points} />
      ))}
    </>
  );
});

function NotSpokenBadge({ x, y }: { x: number; y: number }) {
  const dot = BADGE_RADIUS_PX / 4;
  return (
    <g className="not-spoken-badge" transform={`translate(${x} ${y})`} aria-hidden="true">
      <circle r={BADGE_RADIUS_PX} />
      {[-2.4, 0, 2.4].map(step => (
        <circle key={step} className="pip" cx={step * dot} cy={0} r={dot * 0.8} />
      ))}
    </g>
  );
}

function MuteBadge({ x, y }: { x: number; y: number }) {
  return (
    <g className="mute-badge" transform={`translate(${x} ${y})`} aria-hidden="true">
      <circle r={BADGE_RADIUS_PX} />
      <g transform={`translate(${-BADGE_ICON_PX / 2} ${-BADGE_ICON_PX / 2})`}>
        <Icon name="speaker-off" size={BADGE_ICON_PX} />
      </g>
    </g>
  );
}

const MarksLayer = memo(function MarksLayer({ marks, placed }: { marks: TrackMark[]; placed: (Placed | null)[] }) {
  return (
    <>
      {marks.map((mark, index) => {
        const place = placed[index];
        if (!place) return null;
        const [cx, cy] = place.centre;
        const radius = markRadius(mark);
        const className = `track-mark${mark.selected ? ' selected' : ''}${mark.muted ? ' muted' : ''}${mark.speaking ? ' speaking' : ''}${mark.onAttempt ? ' on-attempt' : ''}${mark.variant ? ` ${mark.variant}` : ''}`;
        const content = (
          <>
            <title>{mark.title}</title>
            {place.spread ? (
              <>
                <line className="leader" x1={place.anchor[0]} y1={place.anchor[1]} x2={cx} y2={cy} />
                <circle className="dot" cx={place.anchor[0]} cy={place.anchor[1]} r={3.5} />
              </>
            ) : null}
            <circle className="marker" cx={cx} cy={cy} r={radius} />
            {mark.label ? (
              <text x={cx} y={cy + 5} textAnchor="middle">
                {mark.label}
              </text>
            ) : null}
            {mark.muted && mark.label ? <MuteBadge x={rounded(cx + radius * 0.75)} y={rounded(cy - radius * 0.75)} /> : null}
            {mark.notSpoken && mark.label ? <NotSpokenBadge x={rounded(cx + radius * 0.75)} y={rounded(cy - radius * 0.75)} /> : null}
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
const RING_STEPS = 8;

function ring([x, y]: Point, radius: number): Point[] {
  return [[x, y], ...Array.from({ length: RING_STEPS }, (_, index) => [x + radius * Math.cos((index * 2 * Math.PI) / RING_STEPS), y + radius * Math.sin((index * 2 * Math.PI) / RING_STEPS)] as Point)];
}

function startPoints({ startPoint, startDirection }: Geometry): Point[] {
  if (!startPoint || !startDirection) return [];
  const { barFrom, barTo, tail, tip } = startShape(startPoint, startDirection);
  return [barFrom, barTo, tail, [(tail[0] + tip[0]) / 2, (tail[1] + tip[1]) / 2], tip];
}

function obstaclesOf(geometry: Geometry, reference: TrackLine, attempt: TrackLine | null | undefined, taken: Circle[]): Point[] {
  const projectAll = (line: TrackLine) => finitePoints(line).map(([x, z]) => geometry.project(x, z));
  return [...projectAll(reference), ...(attempt ? projectAll(attempt) : []), ...startPoints(geometry), ...taken.flatMap(circle => ring(circle.at, circle.r))];
}

type CalloutsLayerProps = { callouts: TrackCallout[]; reference: TrackLine; line: TrackLine; obstacles: Point[]; project: Project; height: number; scale: number };

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
          normal,
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

export function TrackMap({ reference, attempt, far, callouts = NO_CALLOUTS, marks = NO_MARKS, cursorSM, dark = false, plain = false, lapLine = false, label }: TrackMapProps) {
  const geometry = useMemo(() => geometryOf(reference, attempt, far), [reference, attempt, far]);
  const svg = useRef<SVGSVGElement>(null);
  const calloutScale = useUnitsPerPixel(svg, geometry?.height ?? 1, callouts.length > 0);
  const layout = useMemo(() => (geometry ? layoutOf(marks, reference, attempt, geometry, lapLine) : NO_LAYOUT), [geometry, marks, reference, attempt, lapLine]);
  const obstacles = useMemo(() => (geometry && callouts.length > 0 ? obstaclesOf(geometry, reference, attempt, layout.taken) : NO_POINTS), [geometry, callouts, reference, attempt, layout]);
  if (!geometry) return null;
  const { height, project } = geometry;
  const cursorLine = attempt ?? reference;
  const cursor = cursorSM === null || cursorSM === undefined ? null : pointOn(cursorLine, cursorSM);
  const cursorPoint = cursor ? project(cursor[0], cursor[1]) : null;
  return (
    <svg ref={svg} className={`track-map${dark ? ' dark' : ''}${plain ? ' plain' : ''}`} viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label}>
      <TurnsLayer turns={layout.turns} />
      <LinesLayer geometry={geometry} />
      <EndsLayer geometry={geometry} ends={layout.ends} lapLine={lapLine} />
      <TurnLabelsLayer turns={layout.turns} />
      <MarksLayer marks={marks} placed={layout.placed} />
      <CalloutsLayer callouts={callouts} reference={reference} line={cursorLine} obstacles={obstacles} project={project} height={height} scale={calloutScale} />
      {cursorPoint ? <circle className="track-cursor" cx={cursorPoint[0]} cy={cursorPoint[1]} r={8} /> : null}
    </svg>
  );
}
