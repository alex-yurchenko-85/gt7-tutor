import { AttemptsView } from '../features/attempts/AttemptsView.tsx';
import { CatalogueView } from '../features/catalogue/CatalogueView.tsx';
import { CuesView } from '../features/cues/CuesView.tsx';
import { DriveView } from '../features/drive/DriveView.tsx';
import { NowView } from '../features/now/NowView.tsx';
import { ProgressView } from '../features/progress/ProgressView.tsx';
import { RecordView } from '../features/reference-recording/RecordView.tsx';
import { ReferencesView } from '../features/references/ReferencesView.tsx';
import { ReviewView } from '../features/review/ReviewView.tsx';
import { SetupView } from '../features/setup/SetupView.tsx';
import { Link, paths, useRouter } from './router.tsx';

function NotFound() {
  return (
    <section>
      <h1>This page does not exist</h1>
      <p className="lede">The address does not match a view of GT7 Tutor.</p>
      <Link to={paths.now()} className="btn inline">
        Open Now
      </Link>
    </section>
  );
}

export function Views() {
  const { route } = useRouter();
  switch (route.name) {
    case 'setup':
      return <SetupView />;
    case 'now':
      return <NowView />;
    case 'catalogue':
      return <CatalogueView />;
    case 'cues':
      return <CuesView key={route.exerciseId} exerciseId={route.exerciseId} />;
    case 'references':
      return <ReferencesView key={route.exerciseId} exerciseId={route.exerciseId} />;
    case 'record':
      return <RecordView key={route.exerciseId} exerciseId={route.exerciseId} />;
    case 'drive':
      return <DriveView />;
    case 'progress':
      return <ProgressView />;
    case 'attempts':
      return <AttemptsView key={route.exerciseId} exerciseId={route.exerciseId} />;
    case 'review':
      return <ReviewView key={route.attemptId} attemptId={route.attemptId} />;
    case 'not-found':
      return <NotFound />;
  }
}
