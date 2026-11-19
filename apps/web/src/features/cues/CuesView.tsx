import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  SIDE_CUE_DISTANCES_M,
  type BrakeReactionSummary,
  type CornerInfo,
  type Exercise,
  type RecurringDifference,
  type ReferenceCue,
  type ReferenceTrace
} from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLive } from '../../api/live.tsx';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { TrackMap } from '../../charts/TrackMap.tsx';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { useExercise } from '../exercise/use-exercise.ts';
import {
  attemptsText,
  clipOf,
  followClipOf,
  OFFSET_MAX_MS,
  OFFSET_MIN_MS,
  OFFSET_STEP_MS,
  offsetText,
  reactionText,
  recurringText
} from './cue-format.ts';
import './cues.css';

const OFFSET_SAVE_DELAY_MS = 500;

type PendingOffsets = { timer: ReturnType<typeof setTimeout>; offsets: Record<string, number> };

type GlyphKind = ReferenceCue['kind'] | 'turn';

const GLYPHS: Record<GlyphKind, string> = {
  brake: 'M6 8h20M6 15h20M6 22h20',
  throttle: 'M16 27V5M7 14l9-9 9 9',
  'ease-off': 'M4 18q6-12 12 0t12 0',
  turn: 'M5 27V17q0-11 11-11h11'
};

function Glyph({ kind }: { kind: GlyphKind }) {
  return (
    <svg className="glyph" viewBox="0 0 32 30" aria-hidden="true">
      <path d={GLYPHS[kind]} />
    </svg>
  );
}

const SLIDER_MIN = -OFFSET_MAX_MS;
const SLIDER_MAX = -OFFSET_MIN_MS;
const ZERO_SHARE = -SLIDER_MIN / (SLIDER_MAX - SLIDER_MIN);

type OffsetSliderProps = { number: number; offsetMs: number; onChange(next: number): void };

function shareOf(sliderValue: number): number {
  return (sliderValue - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN);
}

function OffsetSlider({ number, offsetMs, onChange }: OffsetSliderProps) {
  const text = offsetText(offsetMs);
  const valueShare = shareOf(-offsetMs);
  const range = { '--from': Math.min(ZERO_SHARE, valueShare), '--to': Math.max(ZERO_SHARE, valueShare) } as CSSProperties;
  return (
    <span className="offset">
      <span className="offset-head">
        <span className="offset-label">Timing</span>
        <output role="status" aria-label={`Timing of cue ${number}`} className={offsetMs === 0 ? 'zero' : undefined}>
          {text}
        </output>
      </span>
      <span className="offset-track" style={{ '--zero-share': ZERO_SHARE } as CSSProperties}>
        <input
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={OFFSET_STEP_MS}
          value={-offsetMs}
          style={range}
          aria-label={`Move cue ${number} earlier or later`}
          aria-valuetext={text}
          onChange={event => onChange(-Number(event.target.value))}
        />
      </span>
      <span className="offset-ends" aria-hidden="true">
        <span>1 s earlier</span>
        <span>0.5 s later</span>
      </span>
    </span>
  );
}

type CueRowProps = {
  cue: ReferenceCue;
  number: number;
  muted: boolean;
  offsetMs: number;
  recurring: RecurringDifference[];
  reaction: BrakeReactionSummary | null;
  onToggle(): void;
  onOffset(next: number): void;
  onHear(): void;
};

function CueRow({ cue, number, muted, offsetMs, recurring, reaction, onToggle, onOffset, onHear }: CueRowProps) {
  const flagged = recurring.length > 0 && !muted;
  return (
    <li className={`note${flagged ? ' warn' : ''}${muted ? ' off' : ''}`} aria-label={`Cue ${number}`}>
      <span className="n">{number}</span>
      <span className="distance">
        <b>{Math.round(cue.sM)}</b> m
      </span>
      <span className="kind">
        <Glyph kind={cue.kind} />
      </span>
      <span className="phrase">
        <b>{cue.phrase ?? 'No voice cue'}</b>
        {cue.bigStop ? <small>Big stop first, about 2 s before this point</small> : null}
        {muted ? <small>Muted. Still recorded as a suppressed cue.</small> : null}
        {reaction ? (
          <small className="reaction">
            You start to brake {reactionText(reaction.medianMs)} here ({attemptsText(reaction.count)})
          </small>
        ) : null}
        {recurring.map(item => (
          <em key={item.kind}>{recurringText(item)}</em>
        ))}
      </span>
      <span className="target" aria-label="Target speed">
        {cue.targetSpeedKph === null ? (
          '–'
        ) : (
          <>
            <b>{cue.targetSpeedKph}</b> km/h
          </>
        )}
      </span>
      <span className="act">
        <span className="pair">
          <button type="button" onClick={onHear} disabled={!cue.phrase} aria-label={`Hear ${cue.phrase ?? 'cue'}`}>
            Hear
          </button>
          <button type="button" aria-pressed={muted} onClick={onToggle}>
            {muted ? 'Unmute' : 'Mute'}
          </button>
        </span>
        <OffsetSlider number={number} offsetMs={offsetMs} onChange={onOffset} />
      </span>
    </li>
  );
}

function TurnRow({ corner }: { corner: CornerInfo }) {
  return (
    <li className="note turn" aria-label={`Turn ${corner.number}`}>
      <span className="n">T{corner.number}</span>
      <span className="distance">
        <b>{Math.round(corner.turnInSM)}</b> m
      </span>
      <span className="kind">
        <Glyph kind="turn" />
      </span>
      <span className="phrase">
        <b>Turn {corner.number}</b>
        <small>
          Turn-in {Math.round(corner.turnInSM)} m. Apex {Math.round(corner.apexSM)} m. Radius {Math.round(corner.radiusM)} m. Not spoken.
        </small>
      </span>
      <span className="target">
        <b>{Math.round(corner.apexSpeedKph)}</b> km/h at the apex
      </span>
    </li>
  );
}

type Row = { sM: number; cue: ReferenceCue; number: number } | { sM: number; corner: CornerInfo };

function roadbookRows(cues: ReferenceCue[], corners: CornerInfo[]): Row[] {
  const rows: Row[] = [
    ...cues.map((cue, index) => ({ sM: cue.sM, cue, number: index + 1 })),
    ...corners.map(corner => ({ sM: corner.turnInSM, corner }))
  ];
  return rows.sort((a, b) => a.sM - b.sM);
}

function withoutZeros(offsets: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(offsets).filter(([, value]) => value !== 0));
}

type SpeakSwitchProps = { on: boolean; onChange(next: boolean): void };

function SpeakTargetsSwitch({ on, onChange }: SpeakSwitchProps) {
  return (
    <div className="speak-switch">
      <button type="button" role="switch" aria-checked={on} aria-label="Speak target speeds" onClick={() => onChange(!on)}>
        <span className="track" aria-hidden="true">
          <span className="knob" />
        </span>
        <span>Speak target speeds</span>
      </button>
      <p className="sub">
        {on
          ? 'The voice says the number after a brake phrase, for example “Hard brake. Eighty five”.'
          : 'The voice says the action only. The screen still shows the target speeds.'}
      </p>
    </div>
  );
}

const SIDE_CUES_OFF = 'off';

type SideDistanceProps = { distanceM: number | null; onChange(next: number | null): void };

function SideCueDistance({ distanceM, onChange }: SideDistanceProps) {
  return (
    <div className="side-distance">
      <label htmlFor="side-cue-distance">Side cue distance</label>
      <select
        id="side-cue-distance"
        className="input"
        value={distanceM === null ? SIDE_CUES_OFF : String(distanceM)}
        onChange={event => onChange(event.target.value === SIDE_CUES_OFF ? null : Number(event.target.value))}
      >
        <option value={SIDE_CUES_OFF}>Off</option>
        {SIDE_CUE_DISTANCES_M.map(value => (
          <option key={value} value={String(value)}>
            {value} m
          </option>
        ))}
      </select>
      <p className="sub">
        {distanceM === null
          ? 'The voice does not say “Keep left” or “Keep right”.'
          : `The voice says “Keep left” or “Keep right” when the car stays more than ${distanceM} m from the reference line.`}
      </p>
    </div>
  );
}

type CueData = [ReferenceCue[], ReferenceTrace, RecurringDifference[], CornerInfo[], BrakeReactionSummary[]];

function CueList({ exercise, referenceId }: { exercise: Exercise; referenceId: string }) {
  const { player } = useLive();
  const data = useResource(
    (): Promise<CueData> =>
      Promise.all([
        api.referenceCues(referenceId),
        api.referenceTrace(referenceId),
        api.recurring(exercise.id),
        api.referenceCorners(referenceId),
        api.reactions(exercise.id)
      ]),
    [referenceId, exercise.id]
  );
  const [muted, setMuted] = useState<string[]>(exercise.mutedCues);
  const [speakTargets, setSpeakTargets] = useState(exercise.speakTargets);
  const [sideDistanceM, setSideDistanceM] = useState(exercise.sideCueDistanceM);
  const [offsets, setOffsets] = useState<Record<string, number>>(exercise.cueOffsetsMs);
  const [problem, setProblem] = useState<string | null>(null);
  const pendingOffsets = useRef<PendingOffsets | null>(null);
  useEffect(
    () => () => {
      const pending = pendingOffsets.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      void api.updateExercise(exercise.id, { cueOffsetsMs: pending.offsets }).catch(() => undefined);
    },
    [exercise.id]
  );

  if (data.error) return <p className="error">{errorText(data.error)}</p>;
  if (!data.data) return <p className="sub">Reading the cues…</p>;
  const [cues, trace, recurring, corners, reactions] = data.data;

  const save = async (body: Parameters<typeof api.updateExercise>[1]) => {
    setProblem(null);
    try {
      const updated = await api.updateExercise(exercise.id, body);
      if (body.mutedCues !== undefined) setMuted(updated.mutedCues);
      if (body.speakTargets !== undefined) setSpeakTargets(updated.speakTargets);
      if (body.sideCueDistanceM !== undefined) setSideDistanceM(updated.sideCueDistanceM);
      if (body.cueOffsetsMs !== undefined && pendingOffsets.current === null) setOffsets(updated.cueOffsetsMs);
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  const toggle = (key: string) => {
    const next = muted.includes(key) ? muted.filter(item => item !== key) : [...muted, key];
    void save({ mutedCues: next });
  };
  const changeOffset = (key: string, value: number) => {
    const next = withoutZeros({ ...offsets, [key]: value });
    setOffsets(next);
    clearTimeout(pendingOffsets.current?.timer);
    const timer = setTimeout(() => {
      pendingOffsets.current = null;
      void save({ cueOffsetsMs: next });
    }, OFFSET_SAVE_DELAY_MS);
    pendingOffsets.current = { timer, offsets: next };
  };
  const changeSpeak = (next: boolean) => {
    setSpeakTargets(next);
    void save({ speakTargets: next });
  };
  const changeSideDistance = (next: number | null) => {
    setSideDistanceM(next);
    void save({ sideCueDistanceM: next });
  };
  const hear = (cue: ReferenceCue) => {
    const follow = followClipOf(cue, speakTargets);
    const clips = follow ? [clipOf(cue), follow] : [clipOf(cue)];
    player.preview(...clips).catch((error: unknown) => setProblem(`The phrase did not play: ${errorText(error)}`));
  };

  return (
    <div className="cols cues-layout">
      <div>
        <div className="voice-settings">
          <SpeakTargetsSwitch on={speakTargets} onChange={changeSpeak} />
          <SideCueDistance distanceM={sideDistanceM} onChange={changeSideDistance} />
        </div>
        <p className="sub cues-intro">
          {cues.length} cues and {corners.length} turns found in the reference. Distance is from the section start. A muted cue is not spoken, and its
          decision is still recorded. Timing moves one cue earlier or later in steps of 0.1 s.
        </p>
        {problem ? (
          <p className="error" role="alert">
            {problem}
          </p>
        ) : null}
        <ol className="roadbook">
          {roadbookRows(cues, corners).map(row =>
            'cue' in row ? (
              <CueRow
                key={row.cue.key}
                cue={row.cue}
                number={row.number}
                muted={muted.includes(row.cue.key)}
                offsetMs={offsets[row.cue.key] ?? 0}
                recurring={recurring.filter(item => item.eventKey === row.cue.key)}
                reaction={reactions.find(item => item.eventKey === row.cue.key) ?? null}
                onToggle={() => toggle(row.cue.key)}
                onOffset={value => changeOffset(row.cue.key, value)}
                onHear={() => hear(row.cue)}
              />
            ) : (
              <TurnRow key={`turn-${row.corner.number}`} corner={row.corner} />
            )
          )}
        </ol>
        <p className="sub" style={{ marginTop: 12 }}>
          Yellow rows mark places where a difference from the reference repeats in your recent attempts.
          Target speeds round down to 5 km/h. Turns are found from the bend of the reference line; the voice says “Tighter” only when you run wide
          before an apex.
        </p>
      </div>
      <div>
        <div className="plot">
          <TrackMap
            label="Reference line with the voice cues and the turns. Select a number to mute or unmute that cue"
            reference={trace}
            marks={[
              ...cornerMarks(corners),
              ...cues.map((cue, index) => ({
                sM: cue.sM,
                label: String(index + 1),
                muted: muted.includes(cue.key),
                title: `${muted.includes(cue.key) ? 'Unmute' : 'Mute'} cue ${index + 1}`,
                onSelect: () => toggle(cue.key)
              }))
            ]}
          />
        </div>
        <div className="legend">
          <span>
            <i className="ref" />
            reference line
          </span>
          <span>
            <i className="apex" />
            apex of a turn
          </span>
          <span>
            <i className="turn-in" />
            turn-in
          </span>
          <span>Select a number on the map to mute that cue</span>
          <span>Map orientation is not confirmed</span>
        </div>
      </div>
    </div>
  );
}

export function CuesView({ exerciseId }: { exerciseId: string }) {
  const exercise = useExercise(exerciseId);
  if (exercise.error) return <LoadProblem error={exercise.error} kind="exercise" />;
  if (!exercise.data) return <p className="sub">Reading the exercise…</p>;
  return (
    <section>
      <ExerciseHeader exercise={exercise.data} title="What the voice will say" />
      {exercise.data.activeReferenceId ? (
        <CueList exercise={exercise.data} referenceId={exercise.data.activeReferenceId} />
      ) : (
        <div className="panel">
          <p className="lede">The cues come from the reference. This exercise has no reference yet.</p>
          <Link to={paths.record(exercise.data.id)} className="btn inline">
            Record the reference
          </Link>
        </div>
      )}
    </section>
  );
}
