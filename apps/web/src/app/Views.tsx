import { AttemptsView } from '../features/attempts/AttemptsView.tsx';
import { AddExerciseView } from '../features/catalogue/AddExerciseView.tsx';
import { CuesView } from '../features/cues/CuesView.tsx';
import { DriveView } from '../features/drive/DriveView.tsx';
import { ExerciseOverview } from '../features/exercise/ExerciseOverview.tsx';
import { ExercisesHome } from '../features/exercises/ExercisesHome.tsx';
import { RecordView } from '../features/reference-recording/RecordView.tsx';
import { ReferencesView } from '../features/references/ReferencesView.tsx';
import { ReviewView } from '../features/review/ReviewView.tsx';
import { SetupView } from '../features/setup/SetupView.tsx';
import { isUuid } from './ids.ts';
import { NotFound } from './NotFound.tsx';
import { useRouter, type Route } from './router.tsx';

function badId(route: Route): 'exercise' | 'attempt' | null {
  if ('exerciseId' in route && !isUuid(route.exerciseId)) return 'exercise';
  if ('attemptId' in route && !isUuid(route.attemptId)) return 'attempt';
  return null;
}

export function Views() {
  const { route } = useRouter();
  const bad = badId(route);
  if (bad) return <NotFound kind={bad} />;
  switch (route.name) {
    case 'setup':
    case 'delete-history':
      return <SetupView />;
    case 'exercises':
      return <ExercisesHome />;
    case 'exercise':
      return <ExerciseOverview key={route.exerciseId} exerciseId={route.exerciseId} />;
    case 'add-exercise':
      return <AddExerciseView />;
    case 'cues':
      return <CuesView key={route.exerciseId} exerciseId={route.exerciseId} />;
    case 'references':
      return <ReferencesView key={route.exerciseId} exerciseId={route.exerciseId} />;
    case 'record':
      return <RecordView key={route.exerciseId} exerciseId={route.exerciseId} />;
    case 'drive':
      return <DriveView />;
    case 'attempts':
      return <AttemptsView key={route.exerciseId} exerciseId={route.exerciseId} />;
    case 'review':
      return <ReviewView key={route.attemptId} attemptId={route.attemptId} />;
    case 'not-found':
      return <NotFound kind="page" />;
  }
}
