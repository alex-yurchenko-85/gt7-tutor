import { describe, expect, it } from 'vitest';
import type { LiveCue, ServerMsg } from '@gt7/contracts';
import { shownOnDrive } from '../src/features/drive/cue-display.ts';
import { VoicePlayer } from '../src/voice/VoicePlayer.ts';
import { audioFetch, cue, FakeAudio, liveState, playerRig, type PlayerRig } from './support.tsx';

const CLIPS_TEXT = 'The voice clips did not load. Reload the page.';

function failingPlayer(fetch: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown>; arrayBuffer: () => Promise<ArrayBuffer> }>) {
  return new VoicePlayer({ createContext: () => new FakeAudio(), fetch, now: () => 0, report: () => undefined });
}

async function readyRig() {
  const rig = playerRig();
  await rig.player.unlock();
  await rig.player.preload(['brake-80', 'throttle-120']);
  return rig;
}

function cueMessage(overrides: Partial<LiveCue> = {}, sentMs = 0): ServerMsg {
  return { type: 'cue', cue: cue(overrides), sentMs };
}

function outcomes(rig: PlayerRig) {
  return rig.reports.map(report => report.type === 'cue-outcome' && [report.cueId, report.outcome]);
}

function syncClocks(rig: PlayerRig, serverMs: number) {
  rig.player.handle({ type: 'ping', id: 1, serverMs }, rig.clock.now);
}

describe('voice player', () => {
  it('play_loaded_plays_only_clips_that_are_loaded_and_at_once', async () => {
    const { player, audio } = playerRig();
    expect(player.playLoaded('hard-brake', 'speed-85')).toBe(false);
    expect(audio.played()).toHaveLength(0);
    await player.preload(['hard-brake', 'speed-85']);
    expect(player.playLoaded('hard-brake', 'speed-85')).toBe(true);
    expect(audio.played()).toHaveLength(2);
  });

  it('voice_player_drops_expired_cue', async () => {
    const rig = await readyRig();
    rig.player.handle(cueMessage({ ttlMs: 150 }), rig.clock.now - 151);
    expect(rig.audio.played()).toHaveLength(0);
    expect(rig.reports).toEqual([{ type: 'cue-outcome', cueId: 'cue-1', outcome: 'expired', startDelayMs: null }]);
  });

  it('cue_delivered_late_by_the_network_expires', async () => {
    const rig = await readyRig();
    syncClocks(rig, 500);
    rig.clock.now += 3000;
    rig.player.handle(cueMessage({ id: 'stalled', ttlMs: 210 }, 1000));
    rig.player.handle(cueMessage({ id: 'fresh', ttlMs: 210 }, 3480));
    expect(outcomes(rig)).toEqual([
      ['stalled', 'expired'],
      ['fresh', 'played']
    ]);
  });

  it('voice_player_drops_old_generation', async () => {
    const rig = await readyRig();
    rig.player.handle({ type: 'state', state: liveState({ generation: 8 }) });
    rig.player.handle(cueMessage({ id: 'new', generation: 8 }));
    rig.player.handle(cueMessage({ id: 'old', generation: 7 }));
    expect(rig.audio.played()).toHaveLength(1);
    expect(outcomes(rig)).toEqual([
      ['new', 'played'],
      ['old', 'cancelled']
    ]);
  });

  it('cues_after_a_pause_in_the_same_attempt_still_play', async () => {
    const rig = await readyRig();
    rig.player.handle(cueMessage({ id: 'before-pause', generation: 5 }));
    rig.player.handle({ type: 'cancel', generation: 5 });
    rig.player.handle(cueMessage({ id: 'after-resume', generation: 5 }));
    expect(outcomes(rig)).toEqual([
      ['before-pause', 'played'],
      ['after-resume', 'played']
    ]);
  });

  it('cancel_stops_current_clip', async () => {
    const rig = await readyRig();
    rig.player.handle(cueMessage({ generation: 5 }));
    const [playing] = rig.audio.played();
    expect(playing!.stopped).toBe(0);
    rig.player.handle({ type: 'cancel', generation: 4 });
    expect(playing!.stopped).toBe(0);
    rig.player.handle({ type: 'cancel', generation: 5 });
    expect(playing!.stopped).toBe(1);
  });

  it('voice_player_reports_played_with_start_delay', async () => {
    const rig = await readyRig();
    rig.player.handle(cueMessage({ id: 'played', clip: 'throttle-120' }), rig.clock.now - 12);
    const [playing] = rig.audio.played();
    expect(playing!.buffer).toEqual({ decoded: expect.any(Number), duration: expect.any(Number) });
    expect(rig.reports).toEqual([{ type: 'cue-outcome', cueId: 'played', outcome: 'played', startDelayMs: 12 + 25 }]);
  });

  it('cue_without_unlocked_audio_fails', async () => {
    const rig = playerRig();
    await rig.player.preload(['brake-80']);
    rig.player.handle(cueMessage());
    expect(rig.reports).toEqual([{ type: 'cue-outcome', cueId: 'cue-1', outcome: 'failed', startDelayMs: null }]);
  });

  it('voice_test_returns_the_latency_the_browser_reports', async () => {
    const rig = playerRig();
    expect(await rig.player.test()).toEqual({ reportedLatencyMs: 25 });
  });

  it('voice_player_plays_follow_clip_right_after_the_action', async () => {
    const rig = playerRig();
    await rig.player.unlock();
    await rig.player.preload(['hard-brake', 'speed-85']);
    rig.player.handle(cueMessage({ id: 'hard', clip: 'hard-brake', followClip: 'speed-85' }), rig.clock.now - 12);
    const [action, number] = rig.audio.played();
    expect(rig.audio.played()).toHaveLength(2);
    const actionDuration = (action!.buffer as { duration: number }).duration;
    expect(action!.startedAt).toBe(0);
    expect(number!.startedAt).toBeCloseTo(rig.audio.currentTime + actionDuration, 9);
    expect(rig.reports).toEqual([{ type: 'cue-outcome', cueId: 'hard', outcome: 'played', startDelayMs: 12 + 25 }]);
    rig.player.handle({ type: 'cancel', generation: 5 });
    expect(action!.stopped).toBe(1);
    expect(number!.stopped).toBe(1);
  });

  it('follow_clip_that_is_not_loaded_fails_the_cue', async () => {
    const rig = await readyRig();
    rig.player.handle(cueMessage({ id: 'missing', clip: 'brake-80', followClip: 'speed-85' }));
    expect(rig.audio.played()).toHaveLength(0);
    expect(outcomes(rig)).toEqual([['missing', 'failed']]);
  });

  it('an_unknown_clip_shows_the_one_clips_text', async () => {
    const rig = playerRig();
    await expect(rig.player.preload(['no-such-clip'])).rejects.toThrow(CLIPS_TEXT);
  });

  it('a_clip_that_does_not_download_shows_the_one_clips_text', async () => {
    const ok = audioFetch();
    const player = failingPlayer(async url => (url.endsWith('manifest.json') ? ok(url) : { ok: false, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }));
    await expect(player.preload(['brake-80'])).rejects.toThrow(CLIPS_TEXT);
  });

  it('a_clip_list_that_does_not_download_shows_the_one_clips_text', async () => {
    const player = failingPlayer(async () => ({ ok: false, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }));
    await expect(player.preload(['brake-80'])).rejects.toThrow(CLIPS_TEXT);
  });

  it('plays_the_english_clips_from_the_english_folder', async () => {
    const urls: string[] = [];
    const ok = audioFetch();
    const player = failingPlayer(async url => {
      urls.push(url);
      return ok(url);
    });
    await player.preload(['hard-brake']);
    expect(urls).toEqual(['/audio/en/manifest.json', '/audio/en/clips/hard-brake.wav']);
  });

  it('takes_a_clip_of_the_language_and_the_english_clip_where_the_language_has_none', async () => {
    const urls: string[] = [];
    const ru = { schemaVersion: 1, clips: { 'hard-brake': { file: 'clips/hard-brake.wav', durationMs: 900 } } };
    const english = audioFetch();
    const player = new VoicePlayer({
      createContext: () => new FakeAudio(),
      now: () => 0,
      report: () => undefined,
      language: 'ru',
      fetch: async url => {
        urls.push(url);
        return url === '/audio/ru/manifest.json' ? { ok: true, json: async () => ru, arrayBuffer: async () => new ArrayBuffer(0) } : english(url);
      }
    });
    await player.preload(['hard-brake', 'speed-85']);
    expect(urls.filter(url => url.endsWith('.wav')).sort()).toEqual(['/audio/en/clips/speed-85.wav', '/audio/ru/clips/hard-brake.wav']);
  });

  it('a_language_without_clips_keeps_the_english_voice', async () => {
    const urls: string[] = [];
    const english = audioFetch();
    const player = new VoicePlayer({
      createContext: () => new FakeAudio(),
      now: () => 0,
      report: () => undefined,
      language: 'ru',
      fetch: async url => {
        urls.push(url);
        return url.startsWith('/audio/ru/') ? { ok: false, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) } : english(url);
      }
    });
    await player.preload(['hard-brake']);
    expect(urls.filter(url => url.endsWith('.wav'))).toEqual(['/audio/en/clips/hard-brake.wav']);
  });

  it('a_rejected_download_shows_the_one_clips_text', async () => {
    const offline = failingPlayer(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(offline.preload(['brake-80'])).rejects.toThrow(CLIPS_TEXT);
    const ok = audioFetch();
    const clipOffline = failingPlayer(async url => {
      if (url.endsWith('manifest.json')) return ok(url);
      throw new TypeError('Failed to fetch');
    });
    await expect(clipOffline.preload(['brake-80'])).rejects.toThrow(CLIPS_TEXT);
  });
});
