import { useState } from 'react';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { errorText } from '../../app/resource.ts';
import { IconButton } from '../../app/IconButton.tsx';
import { clampCorrection, delayCorrectionMs, MAX_CORRECTION_MS, MIN_CORRECTION_MS, setDelayCorrectionMs } from '../../voice/device.ts';
import { useVoiceClaim } from '../../voice/use-voice-claim.ts';
import { clipText, t } from '../../app/i18n.ts';

function signed(ms: number): string {
  return t('setup.voice.correction-value', { value: `${ms > 0 ? '+' : ''}${ms}` });
}

export function VoiceSection() {
  const { player, deviceId } = useLiveConnection();
  const { state } = useLiveState(snapshot => snapshot);
  const voice = useVoiceClaim();
  const [message, setMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [correction, setCorrection] = useState(delayCorrectionMs);
  const [movedFromOther, setMovedFromOther] = useState(false);

  const holder = state?.voiceDeviceId ?? null;
  const here = voice.here;
  const playing = here && state?.voiceReady === true;

  const enable = async () => {
    setMessage(null);
    setMovedFromOther(holder !== null && holder !== deviceId);
    await voice.claim();
  };

  const disable = () => {
    setMovedFromOther(false);
    voice.release();
    setMessage(t('setup.voice.off-here'));
  };

  const runTest = async () => {
    setTestResult(null);
    try {
      const result = await player.test();
      setTestResult(
        t('setup.voice.test-result', { phrase: clipText('voice-check'), delay: result.reportedLatencyMs })
      );
    } catch (error) {
      setTestResult(t('setup.voice.test-failed', { reason: errorText(error) }));
    }
  };

  const changeCorrection = (value: number) => {
    const clamped = clampCorrection(value);
    setCorrection(clamped);
    setDelayCorrectionMs(clamped);
  };

  return (
    <section className="panel setup-section" id="setup-voice">
      <h2>{t('setup.voice.title')}</h2>
      <p className="sub">{t('setup.voice.text')}</p>
      <div className="pref">
        <span className="pref-text">
          <span>{t('setup.voice.device')}</span>
          {playing ? null : (
            <span className={`voice-state${here ? ' error' : ''}`} role="status">
              {here
                ? t('setup.voice.not-started')
                : holder !== null
                  ? t('setup.voice.elsewhere')
                  : t('setup.voice.none')}
            </span>
          )}
        </span>
        <div className="pref-control">
          {playing ? (
            <>
              <div className="field-pair">
                <span className="voice-state playing" role="status">
                  {movedFromOther ? t('setup.voice.moved') : t('setup.voice.here')}
                </span>
                <IconButton icon="speaker" label={t('setup.voice.test')} onClick={() => void runTest()} />
              </div>
              <button className="btn ghost" type="button" onClick={disable}>
                {t('setup.voice.turn-off')}
              </button>
            </>
          ) : (
            <>
              <button className="btn" type="button" onClick={enable}>
                {t('setup.voice.use')}
              </button>
              {here ? (
                <button className="btn ghost" type="button" onClick={disable}>
                  {t('setup.voice.turn-off')}
                </button>
              ) : null}
            </>
          )}
          {voice.problem ? (
            <p className="error" role="alert">
              {voice.problem}
            </p>
          ) : null}
          {message ? <p className="sub">{message}</p> : null}
          {testResult ? (
            <p className="notice" role="status">
              {testResult}
            </p>
          ) : null}
        </div>
      </div>
      <div className="pref">
        <span className="pref-text">
          <label htmlFor="delay-correction">{t('setup.voice.correction')}</label>
          <span className="sub">{t('setup.voice.correction-text')}</span>
        </span>
        <div className="pref-control">
          <span className="correction-value">{signed(correction)}</span>
          <input
            id="delay-correction"
            type="range"
            min={MIN_CORRECTION_MS}
            max={MAX_CORRECTION_MS}
            step={10}
            value={correction}
            onChange={event => changeCorrection(Number(event.target.value))}
          />
        </div>
      </div>
    </section>
  );
}
