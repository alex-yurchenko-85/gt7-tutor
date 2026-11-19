import { errorText } from './resource.ts';
import { isNotFound } from './ids.ts';
import { Link, paths } from './router.tsx';

export type NotFoundKind = 'page' | 'attempt' | 'exercise';

type Copy = { kicker: string; title: string; reason: string };

const COPY: Record<NotFoundKind, Copy> = {
  page: {
    kicker: 'PAGE NOT FOUND',
    title: 'This page does not exist',
    reason: 'The address does not match a page of GT7 Tutor. Check the link, or start from Exercises.'
  },
  attempt: {
    kicker: 'ATTEMPT NOT FOUND',
    title: 'This attempt is not here',
    reason: 'It was deleted, it belongs to another profile, or the link is old.'
  },
  exercise: {
    kicker: 'EXERCISE NOT FOUND',
    title: 'This exercise is not here',
    reason: 'The link is old or incomplete, or the exercise belongs to another profile. Select it again in the catalogue.'
  }
};

function SecondAction({ kind, exerciseId }: { kind: NotFoundKind; exerciseId: string | undefined }) {
  if (kind === 'exercise') {
    return (
      <Link to={paths.addExercise()} className="btn inline ghost">
        Open Add exercise
      </Link>
    );
  }
  if (kind === 'attempt' && exerciseId) {
    return (
      <Link to={paths.attempts(exerciseId)} className="btn inline ghost">
        All attempts
      </Link>
    );
  }
  return null;
}

export function NotFound({ kind, exerciseId }: { kind: NotFoundKind; exerciseId?: string }) {
  const copy = COPY[kind];
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <svg className="not-found-mark" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M4 18c2-6 5-9 8-9s5 2 6 5" />
        <path d="M15 14l3 0 0-3" />
        <circle cx="12" cy="20" r="1" />
      </svg>
      <p className="not-found-kicker">{copy.kicker}</p>
      <h1 id="not-found-title">{copy.title}</h1>
      <p className="lede">{copy.reason}</p>
      <div className="btn-row">
        <Link to={paths.exercises()} className="btn inline">
          Open Exercises
        </Link>
        <SecondAction kind={kind} exerciseId={exerciseId} />
      </div>
      <p className="sub not-found-address">
        Address: <code>{window.location.pathname}</code>
      </p>
    </section>
  );
}

export function LoadProblem({ error, kind, exerciseId }: { error: Error; kind: NotFoundKind; exerciseId?: string }) {
  if (isNotFound(error)) return <NotFound kind={kind} {...(exerciseId ? { exerciseId } : {})} />;
  return <p className="error">{errorText(error)}</p>;
}
