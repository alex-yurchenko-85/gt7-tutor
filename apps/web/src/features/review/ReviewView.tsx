import { memo, useCallback, useMemo, useState } from 'react';
import { WIDE_APEX_M, eventKeyPlace, type AttemptReaction, type AttemptReview, type AttemptSummary, type CornerReview, type ReferenceInfo } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useWideLayout } from '../../app/layout.ts';
import { abortReasonText, formatDateTime, formatDay, formatTime, metres, signedSecondsText } from '../../app/format.ts';
import { rememberedExerciseId } from '../../app/current-exercise.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { useSession } from '../../app/session.tsx';
import { Rich } from '../../app/rich-text.tsx';
import { paths, useRouter } from '../../app/router.tsx';
import { useFrameCursor } from '../../charts/use-frame-cursor.ts';
import { apexPlaceText, apexSpeedText, differenceText, reactionText } from '../cues/cue-format.ts';
import { DeleteAttemptsDialog } from '../attempts/DeleteAttemptsDialog.tsx';
import { DriveButton } from '../drive/DriveButton.tsx';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { loadExercise } from '../exercise/use-exercise.ts';
import { exerciseTitle } from '../exercise/use-exercise-where.ts';
import { CompareCharts, CompareMap, Differences, reviewDifferences, type LineWords } from './line-compare.tsx';
import './review.css';
import { t } from '../../app/i18n.ts';

function referenceName(reference: ReferenceInfo): string {
  const name = reference.origin === 'demo' ? t('exercises.references.demo') : t('exercises.references.own');
  return reference.active ? t('exercises.review.reference-name-active', { name }) : t('exercises.review.reference-name', { name, date: formatDay(reference.createdAt) });
}

const Corners = memo(function Corners({ corners }: { corners: CornerReview[] }) {
  if (corners.length === 0) return null;
  return (
    <section className="corners">
      <h2>{t('exercises.review.corners')}</h2>
      <p className="sub">{t('exercises.review.corners-text')}</p>
      <ol className="corner-list">
        {corners.map(corner => {
          const outside = corner.outsideM !== null && corner.outsideM > WIDE_APEX_M;
          return (
            <li key={corner.number} className={outside ? 'wide' : undefined}>
              <b>{t('charts.turn.title', { turn: corner.number })}</b>
              <span>
                <span className="place">{apexPlaceText(corner.outsideM)}</span>
                <small>{t('exercises.review.apex', { place: metres(corner.apexSM), speed: apexSpeedText(corner) })}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
});

const Reactions = memo(function Reactions({ reactions }: { reactions: AttemptReaction[] }) {
  if (reactions.length === 0) return null;
  return (
    <section className="reactions">
      <h2>{t('exercises.review.reaction')}</h2>
      <ul>
        {reactions.map(reaction => (
          <li key={reaction.eventKey}>
            {t('exercises.review.reaction-item', { place: metres(eventKeyPlace(reaction.eventKey) ?? 0), reaction: reactionText(reaction.reactionMs) })}
          </li>
        ))}
      </ul>
      <p className="sub">{t('exercises.review.reaction-text')}</p>
    </section>
  );
});

function AttemptFacts({ attempt }: { attempt: AttemptSummary }) {
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const promotable = attempt.completion === 'complete';
  const promote = async () => {
    setProblem(null);
    try {
      await api.promoteAttempt(attempt.id);
      setMessage(t('exercises.review.promoted'));
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return (
    <div className="facts">
      <div className="kv">
        <span>{t('exercises.review.source')}</span>
        <b>{t('exercises.review.frames', { first: attempt.first, last: attempt.last })}</b>
      </div>
      {promotable ? (
        <button className="btn ghost" type="button" onClick={() => void promote()}>
          {t('exercises.review.promote')}
        </button>
      ) : (
        <p className="sub">{t('exercises.review.not-promotable')}</p>
      )}
      <DeleteThisAttempt attempt={attempt} />
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      {message ? (
        <p className="sub" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function reviewWords(): LineWords {
  return {
    referenceLegend: t('exercises.review.reference-legend'),
    youLegend: t('exercises.review.you-legend'),
    timeLabel: t('exercises.review.time-label'),
    mapTitle: t('exercises.review.map-title'),
    mapNotes: [t('exercises.review.map-note')],
    dialogLine: t('exercises.review.dialog-line'),
    boxOrder: ['ref', 'you'],
    boxRow: (line, value) => t(line === 'ref' ? 'exercises.review.box-reference' : 'exercises.review.box-you', { value }),
    metres,
    describe: differenceText
  };
}

type ReviewBodyProps = { title: string; attempt: AttemptSummary; review: AttemptReview; references: ReferenceInfo[]; sideCueDistanceM: number | null; activeReferenceId: string | null };

function ReviewBody({ title, attempt, review, references, sideCueDistanceM, activeReferenceId }: ReviewBodyProps) {
  const wide = useWideLayout();
  const { navigate } = useRouter();
  const [cursorSM, setCursorNow, scrub] = useFrameCursor();
  const [selected, setSelected] = useState<number | null>(null);
  const select = useCallback(
    (index: number) => {
      setSelected(index);
      setCursorNow(review.findings[index]!.sM);
    },
    [review.findings, setCursorNow]
  );
  const switchReference = (referenceId: string) => navigate(paths.review(attempt.id, referenceId === attempt.referenceId ? undefined : referenceId));
  const words = useMemo(reviewWords, []);
  const differencesWords = useMemo(reviewDifferences, []);
  const map = <CompareMap title={title} review={review} words={words} sideCueDistanceM={sideCueDistanceM} scaleSwitch cursorSM={cursorSM} selected={selected} onSelect={select} />;
  const charts = <CompareCharts review={review} words={words} side sideCueDistanceM={sideCueDistanceM} cursorSM={cursorSM} onCursor={setCursorNow} onScrub={scrub} />;
  const differences = (
    <>
      <Differences findings={review.findings} losses={review.turnLosses} selected={selected} words={differencesWords} onSelect={select} />
      <Corners corners={review.corners} />
      <Reactions reactions={review.reactions} />
    </>
  );
  const chooser = (
    <div className="field">
      <label htmlFor="compare-with">{t('exercises.review.compare-with')}</label>
      <select id="compare-with" value={review.referenceId} onChange={event => switchReference(event.target.value)}>
        {references.map(reference => (
          <option key={reference.id} value={reference.id}>
            {reference.id === attempt.referenceId ? t('exercises.review.reference-used', { name: referenceName(reference) }) : referenceName(reference)}
          </option>
        ))}
      </select>
    </div>
  );
  const facts = <AttemptFacts attempt={attempt} />;
  const drive = <DriveButton exerciseId={attempt.exerciseId} referenceId={activeReferenceId} />;
  if (!wide) {
    return (
      <div className="review-phone">
        {drive}
        {map}
        {differences}
        {chooser}
        {charts}
        {facts}
      </div>
    );
  }
  return (
    <div className="wide">
      <div>
        {map}
        {charts}
      </div>
      <div className="review-side">
        {drive}
        {differences}
        {chooser}
        {facts}
      </div>
    </div>
  );
}

function ledeText(attempt: AttemptSummary, complete: boolean): string {
  const date = formatDateTime(attempt.startedAt);
  if (complete) return t('exercises.review.lede-complete', { date });
  return attempt.reason ? t('exercises.review.lede-not-finished-reason', { date, reason: abortReasonText(attempt.reason) }) : t('exercises.review.lede-not-finished', { date });
}

function Gap({ ms }: { ms: number }) {
  return <b className={ms > 0 ? 'review-gap slower' : 'review-gap'}>{signedSecondsText(ms)}</b>;
}

function GapLine({ toBestMs, toReferenceMs }: { toBestMs: number | null; toReferenceMs: number }) {
  return (
    <p className="review-gaps">
      {toBestMs !== null && toBestMs > 0 ? (
        <Rich k="exercises.review.gap-line" parts={{ best: <Gap ms={toBestMs} />, reference: <Gap ms={toReferenceMs} /> }} />
      ) : (
        <Rich k="exercises.review.gap-reference" parts={{ reference: <Gap ms={toReferenceMs} /> }} />
      )}
    </p>
  );
}

function AttemptHeading({ attempt, review }: { attempt: AttemptSummary; review: AttemptReview | null }) {
  const complete = attempt.completion === 'complete';
  const gapMs = complete && review ? attempt.timeMs - review.referenceTimeMs : null;
  const time = complete ? formatTime(attempt.timeMs) : t('exercises.review.no-time');
  return (
    <div className="review-title">
      <div className="review-title-text">
        <h2>
          {t('exercises.review.title', { number: attempt.number, time })}
        </h2>
        {gapMs === null ? null : <GapLine toBestMs={attempt.gapToBestMs} toReferenceMs={gapMs} />}
        <p className="lede">
          {ledeText(attempt, complete)}
        </p>
      </div>
    </div>
  );
}

function DeleteThisAttempt({ attempt }: { attempt: AttemptSummary }) {
  const { navigate } = useRouter();
  const [confirming, setConfirming] = useState(false);
  const list = useResource(() => (confirming ? api.attempts(attempt.exerciseId) : Promise.resolve(null)), [attempt.exerciseId, confirming]);
  return (
    <>
      <button className="btn danger" type="button" onClick={() => setConfirming(true)}>
        {t('exercises.review.delete')}
      </button>
      {confirming ? (
        <DeleteAttemptsDialog
          selected={[attempt]}
          all={list.data ? list.data.days.flatMap(day => day.attempts) : null}
          onKeep={() => setConfirming(false)}
          onDeleted={() => navigate(paths.attempts(attempt.exerciseId))}
        />
      ) : null}
    </>
  );
}

export function ReviewView({ attemptId }: { attemptId: string }) {
  const { search } = useRouter();
  const referenceId = search.get('reference') ?? undefined;
  const attempt = useResource(() => api.attempt(attemptId), [attemptId]);
  const review = useResource(() => api.review(attemptId, referenceId), [attemptId, referenceId]);
  const exerciseId = attempt.data?.exerciseId;
  const references = useResource(() => (exerciseId ? api.references(exerciseId) : Promise.resolve([])), [exerciseId]);
  const exercise = useResource(() => (exerciseId ? loadExercise(exerciseId) : Promise.resolve(null)), [exerciseId]);
  const { user } = useSession();
  const error = attempt.error ?? review.error;
  const remembered = rememberedExerciseId(user.id);
  if (error) return <LoadProblem error={error} kind="attempt" {...(remembered ? { exerciseId: remembered } : {})} />;
  if (!attempt.data) return <p className="sub">{t('exercises.summary.reading')}</p>;
  const data = attempt.data;
  return (
    <section>
      {exercise.data ? <ExerciseHeader exercise={exercise.data} current="attempts" /> : null}
      <AttemptHeading attempt={data} review={review.data ?? null} />
      {review.data && !exercise.loading ? <ReviewBody key={review.data.referenceId} title={exercise.data ? exerciseTitle(exercise.data).title : t('exercises.review.fallback-title', { number: data.number })} attempt={data} review={review.data} references={references.data ?? []} sideCueDistanceM={exercise.data?.sideCueDistanceM ?? null} activeReferenceId={exercise.data?.activeReferenceId ?? null} /> : <p className="sub">{t('exercises.review.comparing')}</p>}
    </section>
  );
}
