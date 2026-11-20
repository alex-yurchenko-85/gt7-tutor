import type { Exercise } from '@gt7/contracts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useExerciseWhere } from './use-exercise-where.ts';
import './exercise.css';

type Tab = 'exercise' | 'cues' | 'references' | 'attempts';

const TABS = [
  { name: 'exercise', label: 'Overview', to: (id: string) => paths.exercise(id) },
  { name: 'cues', label: 'Cues', to: (id: string) => paths.cues(id) },
  { name: 'references', label: 'References', to: (id: string) => paths.references(id) },
  { name: 'attempts', label: 'Attempts', to: (id: string) => paths.attempts(id) }
] as const;

export function ExerciseHeader({ exercise, title, current }: { exercise: Exercise; title?: string; current?: Tab }) {
  const { route } = useRouter();
  const where = useExerciseWhere(exercise);
  const active = current ?? route.name;
  return (
    <>
      <header className="exercise-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to={paths.exercises()}>Exercises</Link> / {exercise.name}
        </nav>
        <h1>{exercise.name}</h1>
        <p className="exercise-where sub">{where}</p>
        <nav className="exercise-tabs" aria-label="Exercise">
          {TABS.map(tab => (
            <Link key={tab.name} to={tab.to(exercise.id)} current={active === tab.name}>
              {tab.label}
              {tab.name === 'attempts' && exercise.attemptCount > 0 ? (
                <>
                  {' '}
                  <span className="tab-count">{exercise.attemptCount}</span>
                </>
              ) : null}
            </Link>
          ))}
        </nav>
      </header>
      {title ? <h2 className="section-title">{title}</h2> : null}
    </>
  );
}
