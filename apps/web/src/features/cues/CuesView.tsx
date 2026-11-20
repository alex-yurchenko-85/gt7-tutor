import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  CUE_OFFSET_MAX_MS,
  CUE_OFFSET_MIN_MS,
  CUE_OFFSET_STEP_MS,
  KPH_PER_MPS,
  SIDE_CUE_DISTANCES_M,
  type BrakeReactionSummary,
  type CornerInfo,
  type Exercise,
  type RecurringDifference,
  type ReferenceCue,
  type ReferenceTrace
} from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLiveConnection } from '../../api/live.tsx';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { MapDialog, cueItems } from '../../charts/MapDialog.tsx';
import { MapPanel } from '../../charts/MapPanel.tsx';
import { TrackMap } from '../../charts/TrackMap.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { Icon } from '../../app/icons.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { counted } from '../../app/plural.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { useExercise } from '../exercise/use-exercise.ts';
import {
  attemptsText,
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

const SLIDER_MIN = -CUE_OFFSET_MAX_MS;
const SLIDER_MAX = -CUE_OFFSET_MIN_MS;
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
          step={CUE_OFFSET_STEP_MS}
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
        {muted ? (
          <span className="tag ink">
            <Icon name="speaker-off" size={14} />
            Muted
          </span>
        ) : null}
        {cue.bigStop ? <small>Big brake ahead first, about 2 s before this point</small> : null}
        {muted ? <small>The voice does not say this cue, and Drive does not show it.</small> : null}
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
            {cue.kind === 'brake' ? <small>lowest speed</small> : null}
          </>
        )}
      </span>
      <span className="act">
        <span className="pair">
          <IconButton icon="play" label={`Hear ${cue.phrase ?? 'cue'}`} onClick={onHear} disabled={!cue.phrase} />
          <IconButton icon={muted ? 'speaker-off' : 'speaker'} label={`${muted ? 'Unmute' : 'Mute'} cue ${number}`} primary={muted} pressed={muted} onClick={onToggle} />
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
        <b>{Math.round(corner.apexSpeedMps * KPH_PER_MPS)}</b> km/h at the apex
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
          ? 'After a brake phrase, the voice says the lowest speed of the reference in that place, for example “Hard brake. Eighty five”.'
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
      <div className="setting-row">
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
        <label htmlFor="side-cue-distance">Side cue distance</label>
      </div>
      <p className="sub">
        {distanceM === null
          ? 'The voice does not say “More left” or “More right”.'
          : `The voice says “More left” or “More right” when the car stays more than ${distanceM} m from the reference line.`}
      </p>
    </div>
  );
}

type CueData = [ReferenceCue[], ReferenceTrace, RecurringDifference[], CornerInfo[], BrakeReactionSummary[]];

function CueList({ exercise, referenceId }: { exercise: Exercise; referenceId: string }) {
  const { player } = useLiveConnection();
  const wide = useWideLayout();
  const [viewing, setViewing] = useState(false);
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
  const [settings, setSettings] = useState(exercise);
  const { mutedCues: muted, speakTargets, sideCueDistanceM: sideDistanceM, cueOffsetsMs: offsets } = settings;
  const change = (changes: Partial<Exercise>) => setSettings(current => ({ ...current, ...changes }));
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
      change({
        ...(body.mutedCues !== undefined ? { mutedCues: updated.mutedCues } : {}),
        ...(body.speakTargets !== undefined ? { speakTargets: updated.speakTargets } : {}),
        ...(body.sideCueDistanceM !== undefined ? { sideCueDistanceM: updated.sideCueDistanceM } : {}),
        ...(body.cueOffsetsMs !== undefined && pendingOffsets.current === null ? { cueOffsetsMs: updated.cueOffsetsMs } : {})
      });
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
    change({ cueOffsetsMs: next });
    clearTimeout(pendingOffsets.current?.timer);
    const timer = setTimeout(() => {
      pendingOffsets.current = null;
      void save({ cueOffsetsMs: next });
    }, OFFSET_SAVE_DELAY_MS);
    pendingOffsets.current = { timer, offsets: next };
  };
  const changeSpeak = (next: boolean) => {
    change({ speakTargets: next });
    void save({ speakTargets: next });
  };
  const changeSideDistance = (next: number | null) => {
    change({ sideCueDistanceM: next });
    void save({ sideCueDistanceM: next });
  };
  const hear = (cue: ReferenceCue) => {
    const clips = speakTargets && cue.followClip ? [cue.clip, cue.followClip] : [cue.clip];
    player.preview(...clips).catch((error: unknown) => setProblem(`The phrase did not play: ${errorText(error)}`));
  };

  const map = (
    <MapPanel title={`Reference line, ${Math.round(trace.lengthM)} m`} legend={['reference', 'turn', 'cue', 'muted']} notes={['Select a number to mute that cue']} onView={() => setViewing(true)}>
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
      <MapDialog
        open={viewing}
        onClose={() => setViewing(false)}
        title={exercise.name}
        lengthM={trace.lengthM}
        reference={trace}
        corners={corners}
        items={cueItems(cues, cue => muted.includes(cue.key))}
        listTitle="Voice cues"
        listHint="Select a cue to find it on the line."
      />
    </MapPanel>
  );

  return (
    <div className="cols cues-layout">
      {wide ? null : map}
      <div>
        <div className="voice-settings">
          <SpeakTargetsSwitch on={speakTargets} onChange={changeSpeak} />
          <SideCueDistance distanceM={sideDistanceM} onChange={changeSideDistance} />
        </div>
        <p className="sub cues-intro">
          {counted(cues.length, 'cue')} and {counted(corners.length, 'turn')} found in the reference. Distance is from the section start. A muted cue is not spoken, and its
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
          Target speeds round down to 5 km/h. Turns are found from the bend of the reference line; the voice says “Closer to apex” only when you run wide
          before an apex.
        </p>
      </div>
      {wide ? map : null}
    </div>
  );
}

export function CuesView({ exerciseId }: { exerciseId: string }) {
  const exercise = useExercise(exerciseId);
  if (exercise.error) return <LoadProblem error={exercise.error} kind="exercise" />;
  if (!exercise.data) return <p className="sub">Reading the exercise…</p>;
  return (
    <section>
      <ExerciseHeader exercise={exercise.data} />
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
