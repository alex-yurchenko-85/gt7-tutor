import type { Exercise } from '@gt7/contracts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import './exercise.css';

const TABS = [
  { name: 'exercise', label: 'Overview', to: (id: string) => paths.exercise(id) },
  { name: 'cues', label: 'Cues', to: (id: string) => paths.cues(id) },
  { name: 'references', label: 'References', to: (id: string) => paths.references(id) },
  { name: 'attempts', label: 'Attempts', to: (id: string) => paths.attempts(id) }
] as const;

export function ExerciseHeader({ exercise, title }: { exercise: Exercise; title?: string }) {
  const { route } = useRouter();
  return (
    <>
      <header className="exercise-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to={paths.exercises()}>Exercises</Link> / {exercise.family}
        </nav>
        <h1>{exercise.name}</h1>
        <nav className="exercise-tabs" aria-label="Exercise">
          {TABS.map(tab => (
            <Link key={tab.name} to={tab.to(exercise.id)} current={route.name === tab.name}>
              {tab.label}
              {tab.name === 'attempts' && exercise.completeAttempts > 0 ? (
                <>
                  {' '}
                  <span className="tab-count">{exercise.completeAttempts}</span>
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
