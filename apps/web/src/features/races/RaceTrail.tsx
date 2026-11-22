import { useCallback, useEffect, useRef } from 'react';
import { useLiveListener } from '../../api/live.tsx';
import { t } from '../../app/i18n.ts';
import { keepTrailPoint, trailBounds, trailCoversLap, trailFit, trailSegments, withPoint, type TrailBounds, type TrailPoint } from './race-trail.ts';

const SIZE = 400;
const PAD = 24;
const CAR_PX = 7;
const GLOW_PX = 15;
const SVG_NS = 'http://www.w3.org/2000/svg';

function nextFrame(draw: () => void): () => void {
  if (typeof window.requestAnimationFrame === 'function') {
    const id = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(id);
  }
  const id = window.setTimeout(draw, 16);
  return () => window.clearTimeout(id);
}

export function RaceTrail({ fadeMs }: { fadeMs: number | null }) {
  const fit = useRef<SVGGElement>(null);
  const lines = useRef<SVGGElement>(null);
  const car = useRef<SVGCircleElement>(null);
  const glow = useRef<SVGCircleElement>(null);
  const points = useRef<TrailPoint[]>([]);
  const fixedBounds = useRef<TrailBounds | null>(null);
  const fade = useRef(fadeMs);
  const cancel = useRef<(() => void) | null>(null);

  const draw = useCallback(() => {
    cancel.current = null;
    const list = points.current;
    const last = list.at(-1);
    if (fixedBounds.current === null && trailCoversLap(list, fade.current)) fixedBounds.current = trailBounds(list);
    if (fixedBounds.current !== null && last) fixedBounds.current = withPoint(fixedBounds.current, last);
    const bounds = fixedBounds.current ?? trailBounds(list);
    if (!last || !bounds || !fit.current || !lines.current || !car.current || !glow.current) return;
    const placed = trailFit(bounds, SIZE, SIZE, PAD);
    fit.current.style.transform = `translate(${placed.tx}px, ${placed.ty}px) scale(${placed.scale})`;
    const paths = trailSegments(list, last.tMs, fade.current).map(segment => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', segment.d);
      path.setAttribute('opacity', String(segment.opacity));
      path.setAttribute('class', 'race-trail-line');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      return path;
    });
    lines.current.replaceChildren(...paths);
    for (const [circle, px] of [
      [car.current, CAR_PX],
      [glow.current, GLOW_PX]
    ] as const) {
      circle.setAttribute('cx', String(last.x));
      circle.setAttribute('cy', String(last.z));
      circle.setAttribute('r', String(px / placed.scale));
    }
  }, []);

  const schedule = useCallback(() => {
    cancel.current ??= nextFrame(draw);
  }, [draw]);

  useLiveListener(({ state }) => {
    const race = state?.race;
    if (!race || (race.phase !== 'lap' && race.phase !== 'joined' && race.phase !== 'grid')) return;
    if (race.phase === 'grid') {
      points.current = [{ x: race.x, z: race.z, tMs: performance.now() }];
      schedule();
      return;
    }
    const next = keepTrailPoint(points.current, { x: race.x, z: race.z, tMs: performance.now() }, fade.current);
    if (!next) return;
    points.current = next;
    schedule();
  });

  useEffect(() => {
    fade.current = fadeMs;
    schedule();
  }, [fadeMs, schedule]);

  useEffect(() => () => cancel.current?.(), []);

  return (
    <svg className="race-trail" viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <g ref={fit} className="race-trail-fit">
        <g ref={lines} />
        <circle ref={glow} className="race-trail-glow" r="0" />
        <circle ref={car} className="race-trail-car" r="0" />
      </g>
    </svg>
  );
}
