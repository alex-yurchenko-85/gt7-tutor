import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CuePreview, PreviewCue, PreviewDrop, PreviewDropReason } from '@gt7/contracts';
import { DEFAULT_CONFIG, replayCoach, type CoachTrace, type SuppressReason } from '@gt7/core';
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

function eventKeyOf(cueId: string): string {
  return cueId.slice(cueId.indexOf(':') + 1);
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
    const samples = (await this.references.referenceSamples(reference)).map(sample => ({ ...sample, playerSession: true }));
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
    const startRawIndex = trace.attemptEvents.find(event => event.type === 'started')?.rawIndex ?? null;
    const startMonoMs = samples.find(sample => sample.rawIndex === startRawIndex)?.receivedMonoMs ?? null;
    const cues = startMonoMs === null ? [] : this.spokenCues(trace, rowKeys, startMonoMs, deviceDelayMs);
    return {
      timeMs: analysis.timeMs,
      gridM: DEFAULT_CONFIG.reviewGridM,
      gridTimeMs: referenceGrid(analysis.path).map(point => Math.round(point.timeMs)),
      cues: cues.map(({ cue }) => cue),
      dropped: startMonoMs === null ? [] : this.droppedRows(trace, analysis.events, cues)
    };
  }

  private spokenCues(trace: CoachTrace, rowKeys: Set<string>, startMonoMs: number, deviceDelayMs: number): { cue: PreviewCue; rawIndex: number }[] {
    return trace.cues.map(cue => {
      const key = eventKeyOf(cue.id);
      return {
        rawIndex: cue.rawIndex,
        cue: {
          key,
          rowKey: rowKeys.has(key) ? key : null,
          clip: cue.clip,
          followClip: cue.followClip,
          atMs: Math.round(cue.decidedMonoMs - startMonoMs + deviceDelayMs)
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
