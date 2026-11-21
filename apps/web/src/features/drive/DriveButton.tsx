import type { ReactNode } from 'react';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { useStartDrive, type DriveStart } from './start-drive.ts';
import './drive-button.css';

export function StartDialog({ drive }: { drive: DriveStart }) {
  if (!drive.asking) return null;
  return (
    <ConfirmDialog
      title={`The training of ${drive.trainingName} is on.`}
      keepLabel="Cancel"
      confirmLabel="Stop and start"
      confirmTone="primary"
      working={drive.busy}
      error={drive.problem}
      onKeep={drive.cancel}
      onConfirm={drive.confirm}
    >
      <p>Stop it and start this exercise?</p>
    </ConfirmDialog>
  );
}

export function StartProblem({ drive, className = 'error' }: { drive: DriveStart; className?: string }) {
  if (!drive.problem || drive.asking) return null;
  return (
    <p className={className} role="alert">
      {drive.problem}
    </p>
  );
}

type DriveActionProps = { exerciseId: string; referenceId: string | null; className: string; children: ReactNode; problemClass?: string };

export function DriveAction({ exerciseId, referenceId, className, children, problemClass }: DriveActionProps) {
  const drive = useStartDrive(exerciseId, referenceId);
  return (
    <>
      <button type="button" className={className} onClick={drive.start} disabled={drive.busy}>
        {children}
      </button>
      <StartProblem drive={drive} {...(problemClass ? { className: problemClass } : {})} />
      <StartDialog drive={drive} />
    </>
  );
}

export function DriveButton({ exerciseId, referenceId }: { exerciseId: string; referenceId: string | null }) {
  return (
    <div className="drive-action">
      <DriveAction exerciseId={exerciseId} referenceId={referenceId} className="btn yellow drive-button">
        Drive
      </DriveAction>
    </div>
  );
}
