import { describe, expect, it } from 'vitest';
import type { CuePreview, PreviewCue, PreviewDrop } from '@gt7/contracts';
import { cuesDue, notSpokenSummary, notSpokenText, previewClips, previewPositionM } from '../src/features/cues/preview-timeline.ts';

const preview: CuePreview = { timeMs: 2500, gridM: 10, gridTimeMs: [0, 1000, 1500, 2500], cues: [], dropped: [] };

function cue(atMs: number): PreviewCue {
  return { key: `brake@${atMs}`, rowKey: `brake@${atMs}`, clip: 'hard-brake', followClip: null, atMs };
}

function drop(reason: PreviewDrop['reason'], afterRowKey: string | null = null): PreviewDrop {
  return { rowKey: 'throttle@568', reason, afterRowKey };
}

function clean(text: string): string {
  expect(text).not.toMatch(/mistake|timer/i);
  return text;
}

describe('preview timeline', () => {
  it('position_is_linear_between_grid_points', () => {
    expect(previewPositionM(preview, 500)).toBe(5);
    expect(previewPositionM(preview, 1250)).toBe(15);
    expect(previewPositionM(preview, -10)).toBe(0);
    expect(previewPositionM(preview, 9000)).toBe(30);
  });

  it('cues_due_takes_the_half_open_window', () => {
    expect(cuesDue({ ...preview, cues: [cue(100), cue(200), cue(300)] }, 100, 300).map(item => item.atMs)).toEqual([200, 300]);
  });

  it('not_spoken_text_names_the_cue_before', () => {
    expect(clean(notSpokenText(drop('voice-busy', 'ease-off@564'), () => 3))).toBe(
      'The voice still says cue 3 here. Mute cue 3 or this cue, or move cue 3 earlier.'
    );
  });

  it('not_spoken_text_without_a_cue_before', () => {
    expect(clean(notSpokenText(drop('voice-busy'), () => null))).toBe('The voice still says another phrase here.');
    expect(clean(notSpokenText(drop('voice-busy', 'big-stop@291'), () => null))).toBe('The voice still says another phrase here.');
  });

  it('not_spoken_text_for_each_other_reason', () => {
    expect(clean(notSpokenText(drop('too-late'), () => null))).toBe('There is no time to say this cue here on the reference line.');
    expect(clean(notSpokenText(drop('already-done'), () => null))).toBe('The car of the reference already does this here, so the voice does not say it.');
    expect(clean(notSpokenText(drop('other'), () => null))).toBe('The voice does not say this cue on the reference line.');
  });

  it('not_spoken_summary_counts_the_cues', () => {
    expect(clean(notSpokenSummary(1))).toBe('1 cue is not spoken on the reference line.');
    expect(clean(notSpokenSummary(2))).toBe('2 cues are not spoken on the reference line.');
  });

  it('preview_clips_lists_each_clip_once_in_order', () => {
    const cues: PreviewCue[] = [
      { key: 'big-stop@291', rowKey: null, clip: 'big-stop', followClip: null, atMs: 100 },
      { key: 'brake@291', rowKey: 'brake@291', clip: 'hard-brake', followClip: 'speed-85', atMs: 200 },
      { key: 'throttle@411', rowKey: 'throttle@411', clip: 'full-throttle', followClip: null, atMs: 300 }
    ];
    expect(previewClips({ ...preview, cues })).toEqual(['big-stop', 'hard-brake', 'speed-85', 'full-throttle']);
  });
});
