import { useState, type FormEvent } from 'react';
import { api } from '../../api/client.ts';
import { announceExercisesChanged, rememberExercise } from '../../app/current-exercise.ts';
import { t } from '../../app/i18n.ts';
import { IconButton } from '../../app/IconButton.tsx';
import { errorText } from '../../app/resource.ts';
import { paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';

export function useOpenNewExercise() {
  const { user } = useSession();
  const { navigate } = useRouter();
  return (exerciseId: string, path: string) => {
    rememberExercise(user.id, exerciseId);
    announceExercisesChanged();
    navigate(path);
  };
}

export function OwnExercise() {
  const open = useOpenNewExercise();
  const [family, setFamily] = useState('Time Trial');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !family.trim()) {
      setProblem(t('exercises.home.own-empty'));
      return;
    }
    try {
      const created = await api.createExercise({ family: family.trim(), name: name.trim() });
      open(created.id, paths.exercise(created.id));
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return (
    <form className="own-exercise" onSubmit={create} noValidate>
      <p className="sub">{t('exercises.home.own-text')}</p>
      <div className="field-pair">
        <div className="field">
          <label htmlFor="own-family">{t('exercises.home.activity')}</label>
          <input id="own-family" value={family} onChange={event => setFamily(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="own-name">{t('exercises.home.name')}</label>
          <input id="own-name" value={name} onChange={event => setName(event.target.value)} />
        </div>
        <IconButton icon="check" label={t('exercises.home.create')} type="submit" />
      </div>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
