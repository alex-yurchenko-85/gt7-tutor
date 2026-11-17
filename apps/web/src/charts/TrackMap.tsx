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

const WIDTH = 800;
const PAD = 30;
const MIN_HEIGHT = 220;

type Point = [number, number];

function finitePoints(line: TrackLine): Point[] {
  return line.x.flatMap((x, index) => {
    const z = line.z[index];
    return x === null || z === null || z === undefined ? [] : [[x, z] as Point];
  });
}

function projection(lines: TrackLine[]) {
  const points = lines.flatMap(finitePoints);
  const xs = points.map(point => point[0]);
  const zs = points.map(point => point[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const scale = (WIDTH - 2 * PAD) / Math.max(1, x1 - x0, (z1 - z0) * 1.6);
  const height = Math.max(MIN_HEIGHT, Math.round((z1 - z0) * scale) + 2 * PAD);
  const offsetX = (WIDTH - (x1 - x0) * scale) / 2;
  const offsetY = (height - (z1 - z0) * scale) / 2;
  const project = (x: number, z: number): Point => [Number((offsetX + (x - x0) * scale).toFixed(1)), Number((offsetY + (z - z0) * scale).toFixed(1))];
  return { height, project };
}

export function lineSegments(line: TrackLine, project: (x: number, z: number) => Point): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  line.x.forEach((x, index) => {
    const z = line.z[index];
    if (x === null || z === null || z === undefined) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(project(x, z).join(','));
  });
  if (current.length > 1) segments.push(current.join(' '));
  return segments;
}

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

export function TrackMap({ reference, attempt, marks = [], cursorSM, dark = false, label }: TrackMapProps) {
  const lines = attempt ? [reference, attempt] : [reference];
  if (finitePoints(reference).length < 2) return null;
  const { height, project } = projection(lines);
  const start = pointOn(reference, 0);
  const end = pointOn(reference, (reference.x.length - 1) * reference.gridM);
  const cursorLine = attempt ?? reference;
  const cursor = cursorSM === null || cursorSM === undefined ? null : pointOn(cursorLine, cursorSM);
  const projected = (point: Point | null) => (point ? project(point[0], point[1]) : null);
  const startPoint = projected(start);
  const endPoint = projected(end);
  const cursorPoint = projected(cursor);
  return (
    <svg className={`track-map${dark ? ' dark' : ''}`} viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label}>
      {lineSegments(reference, project).map((points, index) => (
        <polyline key={`r${index}`} className="track-reference" points={points} />
      ))}
      {attempt
        ? lineSegments(attempt, project).map((points, index) => <polyline key={`a${index}`} className="track-attempt" data-segment="attempt" points={points} />)
        : null}
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
      {cursorPoint ? <circle className="track-cursor" cx={cursorPoint[0]} cy={cursorPoint[1]} r={8} /> : null}
    </svg>
  );
}
