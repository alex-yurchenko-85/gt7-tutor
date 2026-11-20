import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CuePreview, PreviewCue, PreviewDrop, PreviewDropReason, Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG, activeTimesMs, replayCoach, type CoachTrace, type ReferencePath, type SuppressReason } from '@gt7/core';
import type { Knex } from 'knex';
import { LiveHub } from '../live/live-hub.service.js';
import { ownedExercise, ownedReference } from '../ownership/owned.js';
import { ReferencesService, referenceGrid } from '../references/references.service.js';
import { KNEX } from '../storage/knex.provider.js';
import { phraseDurations } from './phrase-durations.js';

function dropReason(why: SuppressReason): PreviewDropReason {
  if (why === 'cooldown' || why === 'lower-priority') return 'voice-busy';
  if (why === 'too-late' || why === 'missed') return 'too-late';
  if (why === 'already-full') return 'already-done';
  return 'other';
}

function withoutPauses(samples: Sample[]): Sample[] {
  const active = activeTimesMs(samples);
  const baseMs = samples[0]?.receivedMonoMs ?? 0;
  return samples.map((sample, index) => ({ ...sample, playerSession: true, receivedMonoMs: baseMs + active[index]!, clockMs: baseMs + active[index]! }));
}

function timersByRawIndex(samples: Sample[]): Map<number, number> {
  let lastMs = 0;
  return new Map(
    samples.map(sample => {
      if (sample.gameTimerMs >= 0) lastMs = sample.gameTimerMs;
      return [sample.rawIndex, lastMs];
    })
  );
}

function pathTimeAtTimer(path: ReferencePath, timerMs: number): number {
  const points = path.points;
  if (timerMs <= points[0]!.timerMs) return 0;
  const after = points.findIndex(point => point.timerMs >= timerMs);
  if (after < 0) return points.at(-1)!.timeMs;
  const from = points[after - 1]!;
  const to = points[after]!;
  const span = to.timerMs - from.timerMs;
  return span > 0 ? from.timeMs + ((timerMs - from.timerMs) / span) * (to.timeMs - from.timeMs) : to.timeMs;
}

@Injectable()
export class CuePreviewService {
  private readonly phraseMs: (clip: string) => number;

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly references: ReferencesService,
    private readonly hub: LiveHub,
    config: ConfigService
  ) {
    this.phraseMs = phraseDurations(config.getOrThrow<string>('AUDIO_DIR'));
  }

  async preview(userId: string, referenceId: string): Promise<CuePreview> {
    const reference = await ownedReference(this.db, userId, referenceId);
    const exercise = await ownedExercise(this.db, userId, reference.exercise_id);
    const analysis = await this.references.analysisOf(reference);
    const samples = withoutPauses(await this.references.referenceSamples(reference));
    const deviceDelayMs = this.hub.deviceDelayMs(userId);
    const trace = replayCoach(samples, analysis, DEFAULT_CONFIG, {
      deviceDelayMs,
      phraseMs: this.phraseMs,
      mutedKeys: new Set(exercise.muted_cues),
      speakTargets: exercise.speak_targets,
      offsetsMs: new Map(Object.entries(exercise.cue_offsets)),
      sideCueDistanceM: exercise.side_cue_distance_m
    });
    const rowKeys = new Set(analysis.events.map(event => event.key));
    const started = trace.attemptEvents.some(event => event.type === 'started');
    const timerAt = timersByRawIndex(samples);
    const atMs = (rawIndex: number) => Math.round(pathTimeAtTimer(analysis.path, timerAt.get(rawIndex)!) + deviceDelayMs);
    const cues = started ? this.spokenCues(trace, rowKeys, atMs) : [];
    return {
      timeMs: analysis.timeMs,
      gridM: DEFAULT_CONFIG.reviewGridM,
      gridTimeMs: referenceGrid(analysis.path).map(point => Math.round(point.timeMs)),
      cues: cues.map(({ cue }) => cue),
      dropped: started ? this.droppedRows(trace, analysis.events, cues) : []
    };
  }

  private spokenCues(trace: CoachTrace, rowKeys: Set<string>, atMs: (rawIndex: number) => number): { cue: PreviewCue; rawIndex: number }[] {
    return trace.cues.map(cue => {
      return {
        rawIndex: cue.rawIndex,
        cue: {
          key: cue.eventKey,
          rowKey: rowKeys.has(cue.eventKey) ? cue.eventKey : null,
          clip: cue.clip,
          followClip: cue.followClip,
          atMs: atMs(cue.rawIndex)
        }
      };
    });
  }

  private droppedRows(trace: CoachTrace, events: { key: string }[], spoken: { cue: PreviewCue; rawIndex: number }[]): PreviewDrop[] {
    const spokenKeys = new Set(spoken.map(({ cue }) => cue.key));
    return events.flatMap(event => {
      if (spokenKeys.has(event.key)) return [];
      const first = trace.suppressed.find(entry => entry.eventKey === event.key && entry.why !== 'muted');
      if (!first) return [];
      const before = spoken.filter(entry => entry.rawIndex <= first.rawIndex).at(-1);
      return [{ rowKey: event.key, reason: dropReason(first.why), afterRowKey: before?.cue.rowKey ?? null }];
    });
  }
}
