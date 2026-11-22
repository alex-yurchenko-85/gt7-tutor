import type { LiveRaceLap } from '@gt7/contracts';
import { t } from '../../app/i18n.ts';

type LapCirclesProps = {
  lapsInRace: number;
  firstRecordedLap: number | null;
  laps: LiveRaceLap[];
  lap: number;
  bestLap: number | null;
  running: boolean;
};

type Sign = 'skip' | 'done' | 'now' | 'todo' | 'best' | 'pit';

type Circle = { number: number; state: 'skip' | 'done' | 'now' | 'todo'; best: boolean; pitAfter: boolean };

const SIGNS: Sign[] = ['skip', 'done', 'now', 'todo', 'best', 'pit'];

function circlesOf({ lapsInRace, firstRecordedLap, laps, lap, bestLap, running }: LapCirclesProps): Circle[] {
  return Array.from({ length: lapsInRace }, (_, index) => {
    const number = index + 1;
    const recorded = laps.find(item => item.number === number) ?? null;
    const skip = recorded === null && firstRecordedLap !== null && number < firstRecordedLap;
    const state = recorded ? 'done' : skip ? 'skip' : running && number === lap ? 'now' : 'todo';
    return { number, state, best: recorded !== null && bestLap === number, pitAfter: recorded?.pitAfter ?? false };
  });
}

function circleClass(state: Circle['state'], best: boolean): string {
  return ['lap-circle', state === 'todo' ? '' : state, best ? 'best' : ''].filter(Boolean).join(' ');
}

function KeySign({ sign }: { sign: Sign }) {
  if (sign === 'pit') return <span className="lap-pit" />;
  if (sign === 'best') return <span className={circleClass('done', true)} />;
  return <span className={circleClass(sign, false)} />;
}

export function LapCircles(props: LapCirclesProps) {
  const circles = circlesOf(props);
  const shown = new Set<Sign>(circles.flatMap(circle => [circle.state, ...(circle.best ? ['best' as const] : []), ...(circle.pitAfter ? ['pit' as const] : [])]));
  return (
    <>
      <ol className="lap-circles">
        {circles.flatMap(circle => [
          <li key={circle.number} className={circleClass(circle.state, circle.best)} />,
          ...(circle.pitAfter ? [<li key={`pit-${circle.number}`} className="lap-pit" />] : [])
        ])}
      </ol>
      <ul className="lap-key">
        {SIGNS.filter(sign => shown.has(sign)).map(sign => (
          <li key={sign}>
            <i>
              <KeySign sign={sign} />
            </i>
            {t(`races.circles.key-${sign}`)}
          </li>
        ))}
      </ul>
    </>
  );
}
