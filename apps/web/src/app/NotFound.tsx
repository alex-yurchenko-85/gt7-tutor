import type { MessageKey } from '@gt7/contracts';
import { t } from './i18n.ts';
import { errorText } from './resource.ts';
import { isNotFound } from './ids.ts';
import { Link, paths } from './router.tsx';

export type NotFoundKind = 'page' | 'attempt' | 'exercise' | 'race';

type Copy = { kicker: MessageKey; title: MessageKey; reason: MessageKey };

const COPY: Record<NotFoundKind, Copy> = {
  page: { kicker: 'app.not-found.page.kicker', title: 'app.not-found.page.title', reason: 'app.not-found.page.reason' },
  attempt: { kicker: 'app.not-found.attempt.kicker', title: 'app.not-found.attempt.title', reason: 'app.not-found.attempt.reason' },
  race: { kicker: 'app.not-found.race.kicker', title: 'app.not-found.race.title', reason: 'app.not-found.race.reason' },
  exercise: { kicker: 'app.not-found.exercise.kicker', title: 'app.not-found.exercise.title', reason: 'app.not-found.exercise.reason' }
};

function SecondAction({ kind, exerciseId }: { kind: NotFoundKind; exerciseId: string | undefined }) {
  if (kind === 'race') {
    return (
      <Link to={paths.races()} className="btn inline ghost">
        {t('app.not-found.open-races')}
      </Link>
    );
  }
  if (kind === 'exercise') {
    return (
      <Link to={paths.addExercise()} className="btn inline ghost">
        {t('app.not-found.open-add-exercise')}
      </Link>
    );
  }
  if (kind === 'attempt' && exerciseId) {
    return (
      <Link to={paths.attempts(exerciseId)} className="btn inline ghost">
        {t('app.not-found.all-attempts')}
      </Link>
    );
  }
  return null;
}

export function NotFound({ kind, exerciseId }: { kind: NotFoundKind; exerciseId?: string }) {
  const copy = COPY[kind];
  return (
    <section className="not-found">
      <svg className="not-found-mark" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 18c2-6 5-9 8-9s5 2 6 5" />
        <path d="M15 14l3 0 0-3" />
        <circle cx="12" cy="20" r="1" />
      </svg>
      <p className="not-found-kicker">{t(copy.kicker)}</p>
      <h1>{t(copy.title)}</h1>
      <p className="lede">{t(copy.reason)}</p>
      <div className="btn-row">
        <Link to={paths.exercises()} className="btn inline">
          {t('app.not-found.open-exercises')}
        </Link>
        <SecondAction kind={kind} exerciseId={exerciseId} />
      </div>
      <p className="sub not-found-address">
        {t('app.not-found.address')} <code>{window.location.pathname}</code>
      </p>
    </section>
  );
}

export function LoadProblem({ error, kind, exerciseId }: { error: Error; kind: NotFoundKind; exerciseId?: string }) {
  if (isNotFound(error)) return <NotFound kind={kind} {...(exerciseId ? { exerciseId } : {})} />;
  return <p className="error">{errorText(error)}</p>;
}
