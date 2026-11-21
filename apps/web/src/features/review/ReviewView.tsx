import { memo, useCallback, useMemo, useState } from 'react';
import { WIDE_APEX_M, eventKeyPlace, type AttemptReaction, type AttemptReview, type AttemptSummary, type CornerReview, type ReferenceInfo } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { SIDE_FACTOR } from '../../charts/geometry.ts';
import { useWideLayout } from '../../app/layout.ts';
import { abortReasonText, formatDateTime, formatDay, formatTime, metres, signedSeconds } from '../../app/format.ts';
import { rememberedExerciseId } from '../../app/current-exercise.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { useSession } from '../../app/session.tsx';
import { paths, useRouter } from '../../app/router.tsx';
import { useFrameCursor } from '../../charts/use-frame-cursor.ts';
import { apexPlaceText, apexSpeedText, differenceText, reactionText } from '../cues/cue-format.ts';
import { DeleteAttemptsDialog } from '../attempts/DeleteAttemptsDialog.tsx';
import { DriveButton } from '../drive/DriveButton.tsx';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { CompareCharts, CompareMap, Differences, REVIEW_DIFFERENCES, type LineWords } from './line-compare.tsx';
import './review.css';

function referenceName(reference: ReferenceInfo): string {
  return `${reference.origin === 'demo' ? 'Demonstration' : 'Your attempt'}, ${formatDay(reference.createdAt)}${reference.active ? ', active' : ''}`;
}

const Corners = memo(function Corners({ corners }: { corners: CornerReview[] }) {
  if (corners.length === 0) return null;
  return (
    <section aria-labelledby="corners-title" className="corners">
      <h2 id="corners-title">Corners</h2>
      <p className="sub">Your line at each apex, measured from the reference line. Inside and outside follow the bend of the reference.</p>
      <ol className="corner-list">
        {corners.map(corner => {
          const outside = corner.outsideM !== null && corner.outsideM > WIDE_APEX_M;
          return (
            <li key={corner.number} className={outside ? 'wide' : undefined}>
              <b>Turn {corner.number}</b>
              <span>
                <span className="place">{apexPlaceText(corner.outsideM)}</span>
                <small>
                  Apex {metres(corner.apexSM)}. {apexSpeedText(corner)}
                </small>
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
    <section aria-labelledby="reaction-title" className="reactions">
      <h2 id="reaction-title">Brake reaction</h2>
      <ul>
        {reactions.map(reaction => (
          <li key={reaction.eventKey}>
            {metres(eventKeyPlace(reaction.eventKey) ?? 0)}: you started to brake {reactionText(reaction.reactionMs)}
          </li>
        ))}
      </ul>
      <p className="sub">Measured from the start of the spoken phrase to brake pressure above 10%. Move a cue in the cue list if it comes too late.</p>
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
      setMessage('This attempt is now the active reference. The demonstration stays in the reference history.');
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return (
    <div className="facts">
      <div className="kv">
        <span>Source</span>
        <b>
          frames {attempt.first}–{attempt.last}
        </b>
      </div>
      {promotable ? (
        <button className="btn ghost" type="button" onClick={() => void promote()}>
          Use this attempt as a reference
        </button>
      ) : (
        <p className="sub">Only a complete attempt can become a reference.</p>
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

const MAP_LABEL = 'Map of the reference line and your line';

function reviewWords(title: string): LineWords {
  return {
    referenceName: 'reference',
    youName: 'you',
    referenceLegend: 'reference line',
    youLegend: 'you',
    timeLabel: 'Time lost to the reference, s',
    mapTitle: 'Your line',
    mapLabel: MAP_LABEL,
    mapNotes: ['A gap in your line is a place without a match'],
    sideLabel: `The side distance of your line is drawn ${SIDE_FACTOR} times larger.`,
    sideNote: `Your line is drawn ${SIDE_FACTOR} times farther from the reference line than it was, so that a difference of 1 m shows. The labels give the true distance at the largest point of each turn.`,
    dialogLabel: `Reference line and your line of ${title}`,
    dialogHint: 'Select a difference to find it on your line.',
    dialogLine: 'Reference line',
    hint: 'Move the pointer or a finger across a chart, or focus a chart and use the arrow keys. The map point shows the same place.',
    cursorText: (cursorSM, lengthM) => `Cursor at ${Math.round(cursorSM)} m of ${Math.round(lengthM)} m`,
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
  const words = useMemo(() => reviewWords(title), [title]);
  const map = <CompareMap title={title} review={review} words={words} sideCueDistanceM={sideCueDistanceM} scaleSwitch cursorSM={cursorSM} selected={selected} onSelect={select} />;
  const charts = <CompareCharts review={review} words={words} side sideCueDistanceM={sideCueDistanceM} cursorSM={cursorSM} onCursor={setCursorNow} onScrub={scrub} />;
  const differences = (
    <>
      <Differences findings={review.findings} losses={review.turnLosses} selected={selected} words={REVIEW_DIFFERENCES} onSelect={select} />
      <Corners corners={review.corners} />
      <Reactions reactions={review.reactions} />
    </>
  );
  const chooser = (
    <div className="field">
      <label htmlFor="compare-with">Compare with</label>
      <select id="compare-with" value={review.referenceId} onChange={event => switchReference(event.target.value)}>
        {references.map(reference => (
          <option key={reference.id} value={reference.id}>
            {referenceName(reference)}
            {reference.id === attempt.referenceId ? ' (used for this attempt)' : ''}
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

function AttemptHeading({ attempt, review }: { attempt: AttemptSummary; review: AttemptReview | null }) {
  const complete = attempt.completion === 'complete';
  const gapMs = complete && review ? attempt.timeMs - review.referenceTimeMs : null;
  const time = complete ? formatTime(attempt.timeMs) : 'No time';
  return (
    <div className="review-title">
      <div className="review-title-text">
        <h2>
          Attempt {attempt.number} · {time}
          {gapMs === null ? null : (
            <>
              {' '}
              <span className={gapMs > 0 ? 'review-gap slower' : 'review-gap'}>{signedSeconds(gapMs)} s</span>
            </>
          )}
        </h2>
        <p className="lede">
          {formatDateTime(attempt.startedAt)}.{' '}
          {complete ? 'Times from the game.' : `The attempt did not finish${attempt.reason ? ` (${abortReasonText(attempt.reason)})` : ''}.`}
          {gapMs === null ? '' : ' Gap to the compared reference.'}
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
        Delete attempt
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
  const exercise = useResource(() => (exerciseId ? api.exercise(exerciseId) : Promise.resolve(null)), [exerciseId]);
  const { user } = useSession();
  const error = attempt.error ?? review.error;
  const remembered = rememberedExerciseId(user.id);
  if (error) return <LoadProblem error={error} kind="attempt" {...(remembered ? { exerciseId: remembered } : {})} />;
  if (!attempt.data) return <p className="sub">Reading the attempt…</p>;
  const data = attempt.data;
  return (
    <section>
      {exercise.data ? <ExerciseHeader exercise={exercise.data} current="attempts" /> : null}
      <AttemptHeading attempt={data} review={review.data ?? null} />
      {review.data && !exercise.loading ? <ReviewBody key={review.data.referenceId} title={exercise.data?.name ?? `Attempt ${data.number}`} attempt={data} review={review.data} references={references.data ?? []} sideCueDistanceM={exercise.data?.sideCueDistanceM ?? null} activeReferenceId={exercise.data?.activeReferenceId ?? null} /> : <p className="sub">Comparing with the reference…</p>}
    </section>
  );
}
