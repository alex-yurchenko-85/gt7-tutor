import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { MessageKey } from '@gt7/contracts';
import { WIDTH, clamp, finitePoints, lineSegments, projection, rounded, zoneIndexes, type Point } from './geometry.ts';
import { Icon } from '../app/icons.tsx';
import './charts.css';
import { t } from '../app/i18n.ts';

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
  variant?: 'off-all' | 'off-part' | 'place' | 'join' | 'badge';
  beside?: boolean;
};

export type TrackSegment = { fromM: number; toM: number; colour: 'a' | 'b' | 'c' | 'd'; dashed?: boolean };

export type TrackPeak = { turn: number; sM: number; title: string; detail: string };

type TrackMapProps = {
  reference: TrackLine;
  attempt?: TrackLine | null;
  far?: TrackLine | null;
  peaks?: TrackPeak[];
  marks?: TrackMark[];
  segments?: TrackSegment[];
  cursorSM?: number | null;
  dark?: boolean;
  plain?: boolean;
  lapLine?: boolean;
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
const NO_PEAKS: TrackPeak[] = [];
const NO_SEGMENTS: TrackSegment[] = [];

const CUE_RADIUS_PX = 13;
const TURN_LABEL_OFFSETS_PX = [24, 40, 56];
const TURN_LABEL_RADIUS_PX = 14;
const SPREAD_GAP_PX = 28;
const SPREAD_OFFSET_PX = 30;
const PLACE_RADIUS_PX = 11;
const JOIN_RADIUS_PX = 8;
const BADGE_HALF_WIDTH_PX = 24;
const BADGE_HALF_HEIGHT_PX = 17;
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
  if (mark.variant === 'join') return JOIN_RADIUS_PX;
  if (mark.variant === 'badge') return BADGE_HALF_WIDTH_PX;
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
type Layout = { placed: (Placed | null)[]; turns: TurnPlace[]; ends: Ends };

const NO_LAYOUT: Layout = { placed: [], turns: [], ends: { start: null, finish: null } };

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
  return { placed, turns, ends };
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
      <g className="track-direction">
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
    <g className="track-finish" transform={`translate(${at[0]} ${at[1]}) rotate(${angle})`}>
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
            {t('charts.map.lap-line')}
          </text>
        ) : null}
      </>
    );
  }
  const labels: [MessageKey, Point | null][] = [
    ['charts.map.start', ends.start],
    ['charts.map.finish', ends.finish]
  ];
  return (
    <>
      {startPoint && startDirection ? <StartMark shape={startShape(startPoint, startDirection)} /> : null}
      {endPoint && endDirection ? <FinishMark at={endPoint} direction={endDirection} /> : null}
      {labels.map(([text, at]) =>
        at ? (
          <text key={text} className="track-label" x={at[0]} y={at[1]} textAnchor="middle" dominantBaseline="central">
            {t(text)}
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

type ColouredPart = { key: string; colour: TrackSegment['colour']; dashed: boolean; points: string };

function colouredParts(reference: TrackLine, segments: TrackSegment[], project: Project): ColouredPart[] {
  return segments.flatMap((segment, index) => {
    const [first, last] = zoneIndexes(segment.fromM, segment.toM, reference.gridM, reference.x.length);
    const end = Math.min(reference.x.length - 1, last + 1);
    const part: TrackLine = { gridM: reference.gridM, x: reference.x.slice(first, end + 1), z: reference.z.slice(first, end + 1) };
    return lineSegments(part, project).map((points, piece) => ({ key: `${index}-${piece}`, colour: segment.colour, dashed: segment.dashed ?? false, points }));
  });
}

const LinesLayer = memo(function LinesLayer({ geometry, parts }: { geometry: Geometry; parts: ColouredPart[] }) {
  const { referenceSegments, attemptSegments, farSegments } = geometry;
  return (
    <>
      {referenceSegments.map((points, index) => (
        <polyline key={`r${index}`} className="track-reference" points={points} />
      ))}
      {parts.map(part => (
        <polyline key={`s${part.key}`} className="track-segment" data-colour={part.colour} data-dashed={part.dashed ? 'dashed' : undefined} points={part.points} />
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
    <g className="not-spoken-badge" transform={`translate(${x} ${y})`}>
      <circle r={BADGE_RADIUS_PX} />
      {[-2.4, 0, 2.4].map(step => (
        <circle key={step} className="pip" cx={step * dot} cy={0} r={dot * 0.8} />
      ))}
    </g>
  );
}

function MuteBadge({ x, y }: { x: number; y: number }) {
  return (
    <g className="mute-badge" transform={`translate(${x} ${y})`}>
      <circle r={BADGE_RADIUS_PX} />
      <g transform={`translate(${-BADGE_ICON_PX / 2} ${-BADGE_ICON_PX / 2})`}>
        <Icon name="speaker-off" size={BADGE_ICON_PX} />
      </g>
    </g>
  );
}

function hitRadii(marks: TrackMark[], placed: (Placed | null)[], scale: number, peakAts: Point[]): number[] {
  const radii = marks.map(markRadius);
  const reach = MARK_HIT_PX * scale;
  const ring = PEAK_RING_PX * scale;
  const hits = [...radii];
  marks.forEach((mark, index) => {
    const own = placed[index];
    if (!own || !mark.onSelect) return;
    let room = reach;
    placed.forEach((other, otherIndex) => {
      if (!other || otherIndex === index) return;
      const distance = Math.hypot(own.centre[0] - other.centre[0], own.centre[1] - other.centre[1]);
      room = Math.min(room, marks[otherIndex]!.onSelect ? distance / 2 : distance - radii[otherIndex]!);
    });
    for (const at of peakAts) room = Math.min(room, Math.hypot(own.centre[0] - at[0], own.centre[1] - at[1]) - ring);
    hits[index] = Math.max(radii[index]!, room);
  });
  return hits;
}

const MarksLayer = memo(function MarksLayer({ marks, placed, scale, peakAts }: { marks: TrackMark[]; placed: (Placed | null)[]; scale: number; peakAts: Point[] }) {
  const hits = hitRadii(marks, placed, scale, peakAts);
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
            {mark.onSelect ? <circle className="mark-hit" cx={cx} cy={cy} r={rounded(hits[index]!)} /> : null}
            {place.spread ? (
              <>
                <line className="leader" x1={place.anchor[0]} y1={place.anchor[1]} x2={cx} y2={cy} />
                <circle className="dot" cx={place.anchor[0]} cy={place.anchor[1]} r={3.5} />
              </>
            ) : null}
            {mark.variant === 'badge' ? (
              <rect className="marker" x={cx - BADGE_HALF_WIDTH_PX} y={cy - BADGE_HALF_HEIGHT_PX} width={2 * BADGE_HALF_WIDTH_PX} height={2 * BADGE_HALF_HEIGHT_PX} />
            ) : (
              <circle className="marker" cx={cx} cy={cy} r={radius} />
            )}
            {mark.label ? (
              <text x={cx} y={cy + (mark.variant === 'badge' ? 8 : 5)} textAnchor="middle">
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

const MARK_HIT_PX = 22;

const PEAK_DOT_PX = 6;
const PEAK_RING_PX = 12;
const PEAK_HIT_PX = 22;
const TIP_GAP_PX = 14;
const TIP_PAD_PX = 10;
const TIP_TITLE_PX = 17;
const TIP_DETAIL_PX = 14;
const TIP_LINE_GAP_PX = 5;
const TIP_TITLE_CHAR = 0.5;
const TIP_DETAIL_CHAR = 0.52;

type TipBox = { x: number; y: number; width: number; height: number };

function tipBox([x, y]: Point, peak: TrackPeak, scale: number, height: number, textWidth: number | null): TipBox {
  const width = (textWidth ?? Math.max(peak.title.length * TIP_TITLE_CHAR * TIP_TITLE_PX, peak.detail.length * TIP_DETAIL_CHAR * TIP_DETAIL_PX) * scale) + 2 * TIP_PAD_PX * scale;
  const boxHeight = (TIP_TITLE_PX + TIP_LINE_GAP_PX + TIP_DETAIL_PX + 2 * TIP_PAD_PX) * scale;
  const gap = TIP_GAP_PX * scale;
  const left = x + gap + width > WIDTH ? x - gap - width : x + gap;
  const top = y + gap + boxHeight > height ? y - gap - boxHeight : y + gap;
  return { x: clamp(left, 0, Math.max(0, WIDTH - width)), y: clamp(top, 0, Math.max(0, height - boxHeight)), width, height: boxHeight };
}

type PeakPlace = { peak: TrackPeak; at: Point };

function measured(texts: (SVGTextElement | null)[]): number | null {
  const widths = texts.map(text => (text && typeof text.getComputedTextLength === 'function' ? text.getComputedTextLength() : 0));
  const widest = Math.max(...widths);
  return widest > 0 ? widest : null;
}

function PeakTip({ place, scale, height }: { place: PeakPlace; scale: number; height: number }) {
  const title = useRef<SVGTextElement>(null);
  const detail = useRef<SVGTextElement>(null);
  const [textWidth, setTextWidth] = useState<number | null>(null);
  useLayoutEffect(() => setTextWidth(measured([title.current, detail.current])), [place.peak.title, place.peak.detail, scale]);
  const box = tipBox(place.at, place.peak, scale, height, textWidth);
  const pad = TIP_PAD_PX * scale;
  return (
    <g className="peak-tip">
      <rect x={box.x} y={box.y} width={box.width} height={box.height} />
      <text ref={title} className="peak-title" x={box.x + pad} y={box.y + pad + TIP_TITLE_PX * 0.8 * scale} style={{ fontSize: TIP_TITLE_PX * scale }}>
        {place.peak.title}
      </text>
      <text ref={detail} className="peak-detail" x={box.x + pad} y={box.y + pad + (TIP_TITLE_PX + TIP_LINE_GAP_PX + TIP_DETAIL_PX * 0.8) * scale} style={{ fontSize: TIP_DETAIL_PX * scale }}>
        {place.peak.detail}
      </text>
    </g>
  );
}

type PeakHide = 'hover' | 'focus' | 'tip' | 'all';

type PeaksLayerProps = { places: PeakPlace[]; shown: number | null; ring: number | null; scale: number; onShow(turn: number | null, how: 'hover' | 'focus' | 'touch'): void; onHide(how: PeakHide): void };

const PeaksLayer = memo(function PeaksLayer({ places, shown, ring, scale, onShow, onHide }: PeaksLayerProps) {
  const pointer = useRef<string | null>(null);
  return (
    <>
      {places.map(({ peak, at }) => (
        <g
          key={peak.turn}
          className={`track-peak${shown === peak.turn ? ' shown' : ''}`}
          data-turn={peak.turn}
          role="button"
          tabIndex={0}
          onPointerEnter={event => {
            if (event.pointerType !== 'touch') onShow(peak.turn, 'hover');
          }}
          onPointerLeave={event => {
            if (event.pointerType !== 'touch') onHide('hover');
          }}
          onFocus={() => {
            if (pointer.current !== 'mouse') onShow(peak.turn, 'focus');
          }}
          onBlur={() => onHide('focus')}
          onPointerDown={event => {
            pointer.current = event.pointerType;
          }}
          onClick={() => {
            if (pointer.current !== 'mouse') onShow(peak.turn, 'touch');
            pointer.current = null;
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') onHide('tip');
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onShow(peak.turn, 'touch');
            }
          }}
        >
          <circle className="peak-hit" cx={at[0]} cy={at[1]} r={PEAK_HIT_PX * scale} />
          {shown === peak.turn || ring === peak.turn ? <circle className="peak-ring" cx={at[0]} cy={at[1]} r={PEAK_RING_PX * scale} /> : null}
          <circle className="peak-dot" cx={at[0]} cy={at[1]} r={PEAK_DOT_PX * scale} />
        </g>
      ))}
    </>
  );
});

type PeakState = { hover: number | null; focus: number | null; touch: number | null; ring: number | null };

function peakNear(element: SVGSVGElement, places: PeakPlace[], height: number, clientX: number, clientY: number): number | null {
  const box = element.getBoundingClientRect();
  const pixels = Math.min(box.width / WIDTH, box.height / height);
  if (!(pixels > 0)) return null;
  const x = (clientX - box.left - (box.width - WIDTH * pixels) / 2) / pixels;
  const y = (clientY - box.top - (box.height - height * pixels) / 2) / pixels;
  const reach = PEAK_HIT_PX / pixels;
  let best: PeakPlace | null = null;
  let bestDistance = reach;
  for (const place of places) {
    const distance = Math.hypot(place.at[0] - x, place.at[1] - y);
    if (distance <= bestDistance) {
      best = place;
      bestDistance = distance;
    }
  }
  return best?.peak.turn ?? null;
}

const NO_PEAK: PeakState = { hover: null, focus: null, touch: null, ring: null };

function samePeak(state: PeakState, next: PeakState): PeakState {
  return state.hover === next.hover && state.focus === next.focus && state.touch === next.touch && state.ring === next.ring ? state : next;
}

function showPeak(state: PeakState, turn: number | null, how: 'hover' | 'focus' | 'touch'): PeakState {
  if (how === 'touch') return { ...state, hover: null, touch: turn };
  if (how === 'focus') return { ...state, focus: turn, ring: turn };
  return { ...state, hover: turn };
}

function hidePeak(state: PeakState, how: PeakHide): PeakState {
  if (how === 'all') return NO_PEAK;
  if (how === 'tip') return { ...NO_PEAK, ring: state.ring };
  if (how === 'focus') return { ...state, focus: null, touch: null, ring: null };
  return { ...state, hover: null };
}

function shownPeak(state: PeakState): number | null {
  return state.hover ?? state.touch ?? state.focus;
}

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

export function TrackMap({ reference, attempt, far, peaks = NO_PEAKS, marks = NO_MARKS, segments = NO_SEGMENTS, cursorSM, dark = false, plain = false, lapLine = false }: TrackMapProps) {
  const geometry = useMemo(() => geometryOf(reference, attempt, far), [reference, attempt, far]);
  const svg = useRef<SVGSVGElement>(null);
  const scale = useUnitsPerPixel(svg, geometry?.height ?? 1, peaks.length > 0 || marks.some(mark => mark.onSelect));
  const layout = useMemo(() => (geometry ? layoutOf(marks, reference, attempt, geometry, lapLine) : NO_LAYOUT), [geometry, marks, reference, attempt, lapLine]);
  const parts = useMemo(() => (geometry ? colouredParts(reference, segments, geometry.project) : []), [geometry, reference, segments]);
  const [peakState, setPeakState] = useState<PeakState>(NO_PEAK);
  const cursorLine = attempt ?? reference;
  const places = useMemo(() => {
    if (!geometry) return [];
    return peaks.flatMap(peak => {
      const point = pointOn(cursorLine, peak.sM);
      return point ? [{ peak, at: geometry.project(point[0], point[1]) }] : [];
    });
  }, [geometry, peaks, cursorLine]);
  const peakAts = useMemo(() => places.map(place => place.at), [places]);
  const [peaksSeen, setPeaksSeen] = useState(peaks);
  if (peaksSeen !== peaks) {
    setPeaksSeen(peaks);
    setPeakState(NO_PEAK);
  }
  const onShow = useMemo(() => (turn: number | null, how: 'hover' | 'focus' | 'touch') => setPeakState(state => samePeak(state, showPeak(state, turn, how))), []);
  const onHide = useMemo(() => (how: PeakHide) => setPeakState(state => samePeak(state, hidePeak(state, how))), []);
  if (!geometry) return null;
  const { height, project } = geometry;
  const cursor = cursorSM === null || cursorSM === undefined ? null : pointOn(cursorLine, cursorSM);
  const cursorPoint = cursor ? project(cursor[0], cursor[1]) : null;
  const shown = shownPeak(peakState);
  const shownPlace = shown === null ? null : (places.find(place => place.peak.turn === shown) ?? null);
  const near = (event: PointerEvent<SVGSVGElement>) => peakNear(event.currentTarget, places, height, event.clientX, event.clientY);
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target instanceof Element && event.target.closest('[role="button"]')) return;
    const turn = event.pointerType === 'mouse' ? null : near(event);
    if (turn === null) onHide('all');
    else onShow(turn, 'touch');
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch') return;
    const turn = near(event);
    if (turn !== null) onShow(turn, 'hover');
    else if (peakState.hover !== null && !(event.target instanceof Element && event.target.closest('.track-peak'))) onHide('hover');
  };
  return (
    <svg
      ref={svg}
      className={`track-map${dark ? ' dark' : ''}${plain ? ' plain' : ''}`}
      viewBox={`0 0 ${WIDTH} ${height}`}
      onPointerDown={places.length > 0 ? onPointerDown : undefined}
      onPointerMove={places.length > 0 ? onPointerMove : undefined}
      onPointerLeave={places.length > 0 ? () => onHide('hover') : undefined}
    >
      <TurnsLayer turns={layout.turns} />
      <LinesLayer geometry={geometry} parts={parts} />
      <EndsLayer geometry={geometry} ends={layout.ends} lapLine={lapLine} />
      <TurnLabelsLayer turns={layout.turns} />
      <PeaksLayer places={places} shown={shown} ring={peakState.ring} scale={scale} onShow={onShow} onHide={onHide} />
      <MarksLayer marks={marks} placed={layout.placed} scale={scale} peakAts={peakAts} />
      {cursorPoint ? <circle className="track-cursor" cx={cursorPoint[0]} cy={cursorPoint[1]} r={8} /> : null}
      {shownPlace ? <PeakTip place={shownPlace} scale={scale} height={height} /> : null}
    </svg>
  );
}
