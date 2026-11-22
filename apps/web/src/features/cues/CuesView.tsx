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
import { TrackMap, type TrackMark } from '../../charts/TrackMap.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { formatTime } from '../../app/format.ts';
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
import { notSpokenSummary, notSpokenText, previewClips, previewPositionM } from './preview-timeline.ts';
import { useCuePreviewRun, usePreviewElapsed, type CuePreviewRun } from './use-cue-preview-run.ts';
import './cues.css';
import { clipText, phraseText, t } from '../../app/i18n.ts';
import { Rich } from '../../app/rich-text.tsx';

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
        <span className="offset-label">{t('exercises.cues.timing')}</span>
        <output role="status" aria-label={t('exercises.cues.timing-of', { number })} className={offsetMs === 0 ? 'zero' : undefined}>
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
          aria-label={t('exercises.cues.move', { number })}
          aria-valuetext={text}
          onChange={event => onChange(-Number(event.target.value))}
        />
      </span>
      <span className="offset-ends" aria-hidden="true">
        <span>{t('exercises.cues.earliest')}</span>
        <span>{t('exercises.cues.latest')}</span>
      </span>
    </span>
  );
}

type CueRowProps = {
  cue: ReferenceCue;
  phrase: string;
  number: number;
  muted: boolean;
  offsetMs: number;
  recurring: RecurringDifference[];
  reaction: BrakeReactionSummary | null;
  notSpoken: string | null;
  speaking: boolean;
  onToggle(): void;
  onOffset(next: number): void;
  onHear(): void;
};

function CueRow({ cue, phrase, number, muted, offsetMs, recurring, reaction, notSpoken, speaking, onToggle, onOffset, onHear }: CueRowProps) {
  const flagged = recurring.length > 0 && !muted;
  return (
    <li className={`note${flagged ? ' warn' : ''}${muted ? ' off' : ''}`} aria-label={t('exercises.cues.cue', { number })}>
      <span className="n">{number}</span>
      <span className="distance">
        <Rich k="app.unit.metres" parts={{ value: <b>{Math.round(cue.sM)}</b> }} />
      </span>
      <span className="kind">
        <Glyph kind={cue.kind} />
      </span>
      <span className="phrase">
        <b>{phrase}</b>
        {speaking ? <span className="tag ink">{t('exercises.cues.speaking')}</span> : null}
        {notSpoken !== null ? (
          <span className="tag outline">
            <svg className="dots" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="5" cy="12" r="2.2" />
              <circle cx="12" cy="12" r="2.2" />
              <circle cx="19" cy="12" r="2.2" />
            </svg>
            {t('exercises.cues.not-spoken')}
          </span>
        ) : null}
        {cue.bigStop ? <small>{t('exercises.cues.big-stop')}</small> : null}
        {notSpoken !== null ? <small className="not-spoken">{notSpoken}</small> : null}
        {reaction ? (
          <small className="reaction">
            {t('exercises.cues.reaction', { reaction: reactionText(reaction.medianMs), attempts: attemptsText(reaction.count) })}
          </small>
        ) : null}
        {recurring.map(item => (
          <em key={item.kind}>{recurringText(item)}</em>
        ))}
      </span>
      <span className="target" aria-label={t('exercises.cues.target')}>
        {cue.targetSpeedKph === null ? (
          '–'
        ) : (
          <>
            <Rich k="app.unit.kph" parts={{ value: <b>{cue.targetSpeedKph}</b> }} />
            {cue.kind === 'brake' ? <small>{t('exercises.cues.lowest')}</small> : null}
          </>
        )}
      </span>
      <span className="act">
        <span className="pair">
          <IconButton icon="play" label={t('exercises.cues.hear', { phrase })} onClick={onHear} />
          <IconButton icon={muted ? 'speaker-off' : 'speaker'} label={t(muted ? 'exercises.cues.unmute' : 'exercises.cues.mute', { number })} primary={muted} pressed={muted} onClick={onToggle} />
        </span>
        <OffsetSlider number={number} offsetMs={offsetMs} onChange={onOffset} />
      </span>
    </li>
  );
}

function TurnRow({ corner }: { corner: CornerInfo }) {
  return (
    <li className="note turn" aria-label={t('charts.turn.title', { turn: corner.number })}>
      <span className="n">{t('charts.turn.badge', { turn: corner.number })}</span>
      <span className="distance">
        <Rich k="app.unit.metres" parts={{ value: <b>{Math.round(corner.turnInSM)}</b> }} />
      </span>
      <span className="kind">
        <Glyph kind="turn" />
      </span>
      <span className="phrase">
        <b>{t('charts.turn.title', { turn: corner.number })}</b>
        <small>{t('exercises.cues.turn-in', { turnIn: Math.round(corner.turnInSM), apex: Math.round(corner.apexSM), radius: Math.round(corner.radiusM) })}</small>
      </span>
      <span className="target">
        <Rich k="exercises.cues.apex-speed" parts={{ speed: <b>{Math.round(corner.apexSpeedMps * KPH_PER_MPS)}</b> }} />
      </span>
    </li>
  );
}

type Row = { sM: number; cue: ReferenceCue; number: number } | { sM: number; corner: CornerInfo };

function spokenClips(cue: ReferenceCue, speakTargets: boolean): string[] {
  return speakTargets && cue.followClip ? [cue.clip, cue.followClip] : [cue.clip];
}

function phraseOfKey(cues: ReferenceCue[], key: string, speakTargets: boolean): string | null {
  const cue = cues.find(item => item.key === key);
  return cue ? phraseText(spokenClips(cue, speakTargets)) : null;
}

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
      <button type="button" role="switch" aria-checked={on} aria-label={t('exercises.cues.speak-targets')} onClick={() => onChange(!on)}>
        <span className="track" aria-hidden="true">
          <span className="knob" />
        </span>
        <span>{t('exercises.cues.speak-targets')}</span>
      </button>
      <p className="sub">
        {on
          ? t('exercises.cues.speak-on', { example: phraseText(['hard-brake', 'speed-85']) })
          : t('exercises.cues.speak-off')}
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
          <option value={SIDE_CUES_OFF}>{t('exercises.cues.side-off')}</option>
          {SIDE_CUE_DISTANCES_M.map(value => (
            <option key={value} value={String(value)}>
              {t('app.unit.metres', { value })}
            </option>
          ))}
        </select>
        <label htmlFor="side-cue-distance">{t('exercises.cues.side-distance')}</label>
      </div>
      <p className="sub">
        {distanceM === null
          ? t('exercises.cues.side-none', { left: clipText('keep-left'), right: clipText('keep-right') })
          : t('exercises.cues.side-on', { left: clipText('keep-left'), right: clipText('keep-right'), distance: distanceM })}
      </p>
    </div>
  );
}

type PreviewStatusProps = { run: CuePreviewRun; phraseOf(key: string): string | null; numberOf(key: string): number | null };

function PreviewStatus({ run, phraseOf, numberOf }: PreviewStatusProps) {
  const elapsedMs = usePreviewElapsed(run);
  if (!run.preview) return <p className="sub preview-note">{t('exercises.cues.preview-note')}</p>;
  const { timeMs } = run.preview;
  const share = timeMs > 0 ? Math.min(1, elapsedMs / timeMs) : 0;
  const key = run.speaking?.rowKey ?? null;
  const phrase = key === null ? null : phraseOf(key);
  return (
    <div className="preview-run">
      <span className="preview-bar" aria-hidden="true">
        <i style={{ width: `${share * 100}%` }} />
      </span>
      <span className="preview-time">{t('exercises.cues.preview-time', { elapsed: formatTime(elapsedMs, 1), total: formatTime(timeMs, 1) })}</span>
      {key !== null && phrase !== null ? (
        <p className="preview-now">
          <span>{t('exercises.cues.voice-says')}</span> <b>{phrase}</b> {t('exercises.cues.cue-number', { number: numberOf(key) ?? '' })}
        </p>
      ) : null}
    </div>
  );
}

type PreviewMapProps = { run: CuePreviewRun; label: string; reference: ReferenceTrace; marks: TrackMark[] };

function PreviewMap({ run, label, reference, marks }: PreviewMapProps) {
  const elapsedMs = usePreviewElapsed(run);
  return <TrackMap label={label} reference={reference} cursorSM={run.preview ? previewPositionM(run.preview, elapsedMs) : null} marks={marks} />;
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
  const preview = useResource(() => api.cuePreview(referenceId), [referenceId]);
  const run = useCuePreviewRun(player);
  const [settings, setSettings] = useState(exercise);
  const { mutedCues: muted, speakTargets, sideCueDistanceM: sideDistanceM, cueOffsetsMs: offsets } = settings;
  const change = (changes: Partial<Exercise>) => setSettings(current => ({ ...current, ...changes }));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
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
  if (!data.data) return <p className="sub">{t('exercises.cues.reading')}</p>;
  const [cues, trace, recurring, corners, reactions] = data.data;

  const save = async (body: Parameters<typeof api.updateExercise>[1], reloadPreview = true) => {
    setProblem(null);
    setSaving(count => count + 1);
    try {
      const updated = await api.updateExercise(exercise.id, body);
      change({
        ...(body.mutedCues !== undefined ? { mutedCues: updated.mutedCues } : {}),
        ...(body.speakTargets !== undefined ? { speakTargets: updated.speakTargets } : {}),
        ...(body.sideCueDistanceM !== undefined ? { sideCueDistanceM: updated.sideCueDistanceM } : {}),
        ...(body.cueOffsetsMs !== undefined && pendingOffsets.current === null ? { cueOffsetsMs: updated.cueOffsetsMs } : {})
      });
      if (reloadPreview) preview.reload();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSaving(count => count - 1);
    }
  };
  const stopRun = () => {
    if (run.preview) run.stop();
  };
  const flushOffsets = async (): Promise<boolean> => {
    const pending = pendingOffsets.current;
    if (!pending) return false;
    clearTimeout(pending.timer);
    pendingOffsets.current = null;
    await save({ cueOffsetsMs: pending.offsets }, false);
    return true;
  };
  const startPreview = async () => {
    void player.unlock().catch(() => undefined);
    const flushed = await flushOffsets();
    const fresh = flushed ? await api.cuePreview(referenceId).catch(() => null) : preview.data;
    if (flushed) {
      if (fresh) preview.replace(fresh);
      else preview.reload();
    }
    if (!fresh) return;
    await player.preload(previewClips(fresh)).catch(() => undefined);
    run.start(fresh);
  };
  const toggle = (key: string) => {
    stopRun();
    const next = muted.includes(key) ? muted.filter(item => item !== key) : [...muted, key];
    void save({ mutedCues: next });
  };
  const changeOffset = (key: string, value: number) => {
    stopRun();
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
    stopRun();
    change({ speakTargets: next });
    void save({ speakTargets: next });
  };
  const changeSideDistance = (next: number | null) => {
    stopRun();
    change({ sideCueDistanceM: next });
    void save({ sideCueDistanceM: next });
  };
  const dropped = (preview.data?.dropped ?? []).filter(drop => !muted.includes(drop.rowKey));
  const numberOf = (key: string): number | null => {
    const index = cues.findIndex(cue => cue.key === key);
    return index < 0 ? null : index + 1;
  };
  const notSpoken = new Map(dropped.map(drop => [drop.rowKey, notSpokenText(drop, numberOf)]));
  const hear = (cue: ReferenceCue) => {
    player.preview(...spokenClips(cue, speakTargets)).catch((error: unknown) => setProblem(t('exercises.cues.play-failed', { reason: errorText(error) })));
  };

  const map = (
    <MapPanel title={t('exercises.cues.map-title', { metres: Math.round(trace.lengthM) })} legend={['reference', 'turn', 'cue', 'muted', 'not-spoken']}
      viewIcon={!wide}
      actions={
        run.preview ? (
          <IconButton icon="stop" label={t('exercises.cues.stop-preview')} primary onClick={run.stop} />
        ) : (
          <IconButton icon="play" label={t('exercises.cues.start-preview')} onClick={() => void startPreview()} disabled={!preview.data || preview.loading || saving > 0} />
        )
      }
      below={<PreviewStatus run={run} phraseOf={key => phraseOfKey(cues, key, speakTargets)} numberOf={numberOf} />} notes={[t('exercises.cues.map-note')]} onView={() => setViewing(true)}>
      <PreviewMap
        run={run}
        label={t('exercises.cues.map-label')}
        reference={trace}
        marks={[
          ...cornerMarks(corners),
          ...cues.map((cue, index) => ({
            sM: cue.sM,
            label: String(index + 1),
            muted: muted.includes(cue.key),
            notSpoken: notSpoken.has(cue.key),
            speaking: run.speaking?.rowKey === cue.key,
            title: t(muted.includes(cue.key) ? 'exercises.cues.unmute' : 'exercises.cues.mute', { number: index + 1 }),
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
        listTitle={t('exercises.cues.list-title')}
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
          {t('exercises.cues.intro', { cues: t('common.count.cue', { count: cues.length }), turns: t('common.count.turn', { count: corners.length }) })}
          {dropped.length > 0 ? ` ${notSpokenSummary(dropped.length)}` : null}
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
                phrase={phraseText(spokenClips(row.cue, speakTargets))}
                number={row.number}
                muted={muted.includes(row.cue.key)}
                offsetMs={offsets[row.cue.key] ?? 0}
                recurring={recurring.filter(item => item.eventKey === row.cue.key)}
                reaction={reactions.find(item => item.eventKey === row.cue.key) ?? null}
                speaking={run.speaking?.rowKey === row.cue.key}
                notSpoken={notSpoken.get(row.cue.key) ?? null}
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
          {t('exercises.cues.footer', { tighter: clipText('tighter') })}
        </p>
      </div>
      {wide ? map : null}
    </div>
  );
}

export function CuesView({ exerciseId }: { exerciseId: string }) {
  const exercise = useExercise(exerciseId);
  if (exercise.error) return <LoadProblem error={exercise.error} kind="exercise" />;
  if (!exercise.data) return <p className="sub">{t('exercises.reading-exercise')}</p>;
  return (
    <section>
      <ExerciseHeader exercise={exercise.data} />
      {exercise.data.activeReferenceId ? (
        <CueList exercise={exercise.data} referenceId={exercise.data.activeReferenceId} />
      ) : (
        <div className="panel">
          <p className="lede">{t('exercises.cues.no-reference')}</p>
          <Link to={paths.record(exercise.data.id)} className="btn inline">
            {t('exercises.cues.record')}
          </Link>
        </div>
      )}
    </section>
  );
}
