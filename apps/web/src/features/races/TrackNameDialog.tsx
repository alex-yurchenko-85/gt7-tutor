import { useId, useState } from 'react';
import type { RaceSummary } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { RadioGroup } from '../../app/RadioGroup.tsx';
import { errorText } from '../../app/resource.ts';
import { t } from '../../app/i18n.ts';

const MAX_CANDIDATES = 5;
const MAX_NAME = 80;

type TrackNameDialogProps = { race: RaceSummary; onKeep(): void; onSaved(summary: RaceSummary): void };

export function TrackNameDialog({ race, onKeep, onSaved }: TrackNameDialogProps) {
  const candidates = race.trackCandidates.slice(0, MAX_CANDIDATES);
  const another = candidates.length;
  const known = race.trackName === null ? -1 : candidates.indexOf(race.trackName);
  const [choice, setChoice] = useState(known >= 0 ? known : race.trackName !== null || candidates.length === 0 ? another : 0);
  const [typed, setTyped] = useState(known < 0 && race.trackName !== null ? race.trackName : '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const fieldId = useId();
  const name = (choice === another ? typed : candidates[choice]!).trim();

  const save = async () => {
    setWorking(true);
    setError(null);
    try {
      onSaved(await api.renameRace(race.id, name));
    } catch (failure) {
      setError(errorText(failure));
      setWorking(false);
    }
  };

  return (
    <ConfirmDialog
      title={t('races.name.title')}
      role="dialog"
      confirmTone="primary"
      keepLabel={t('common.cancel')}
      confirmLabel={t('races.name.save')}
      working={working}
      confirmDisabled={name.length === 0}
      error={error}
      onKeep={onKeep}
      onConfirm={save}
    >
      <p id={labelId}>{t('races.name.track')}</p>
      <RadioGroup<number>
        className="track-choices"
        labelledBy={labelId}
        value={choice}
        onChange={setChoice}
        options={[...candidates.map((candidate, index) => ({ value: index, content: candidate })), { value: another, content: t('races.name.another') }]}
      />
      {choice === another ? (
        <>
          <label className="confirm-field" htmlFor={fieldId}>
            {t('races.name.another')}
          </label>
          <input id={fieldId} className="confirm-input" type="text" maxLength={MAX_NAME} autoComplete="off" value={typed} onChange={event => setTyped(event.target.value)} />
        </>
      ) : null}
    </ConfirmDialog>
  );
}
