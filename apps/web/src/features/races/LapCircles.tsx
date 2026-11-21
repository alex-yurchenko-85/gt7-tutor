import type { LiveRaceLap } from '@gt7/contracts';

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

const STATE_WORDS: Record<Circle['state'], string> = { skip: 'not recorded', done: 'done', now: 'this lap', todo: 'to come' };

const KEY: { sign: Sign; text: string }[] = [
  { sign: 'skip', text: 'lap not recorded' },
  { sign: 'done', text: 'lap done' },
  { sign: 'now', text: 'this lap' },
  { sign: 'todo', text: 'lap to come' },
  { sign: 'best', text: 'best lap' },
  { sign: 'pit', text: 'pit stop after this lap' }
];

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
      <ol className="lap-circles" aria-label="Laps">
        {circles.flatMap(circle => [
          <li key={circle.number} className={circleClass(circle.state, circle.best)} aria-label={`Lap ${circle.number}, ${STATE_WORDS[circle.state]}${circle.best ? ', best lap' : ''}`} />,
          ...(circle.pitAfter ? [<li key={`pit-${circle.number}`} className="lap-pit" aria-label={`Pit stop after lap ${circle.number}`} />] : [])
        ])}
      </ol>
      <ul className="lap-key" aria-label="What the circles mean">
        {KEY.filter(line => shown.has(line.sign)).map(line => (
          <li key={line.sign}>
            <i aria-hidden="true">
              <KeySign sign={line.sign} />
            </i>
            {line.text}
          </li>
        ))}
      </ul>
    </>
  );
}
