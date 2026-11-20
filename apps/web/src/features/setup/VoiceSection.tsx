import { useState } from 'react';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { errorText } from '../../app/resource.ts';
import { IconButton } from '../../app/IconButton.tsx';
import { clampCorrection, delayCorrectionMs, MAX_CORRECTION_MS, MIN_CORRECTION_MS, setDelayCorrectionMs } from '../../voice/device.ts';
import { useVoiceClaim } from '../../voice/use-voice-claim.ts';

function signed(ms: number): string {
  return `${ms > 0 ? '+' : ''}${ms} ms`;
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
    setMessage('The voice is off on this device. The Drive screen still shows the cues.');
  };

  const runTest = async () => {
    setTestResult(null);
    try {
      const result = await player.test();
      setTestResult(
        `You should hear “Voice check”. The browser reports an output delay of ${result.reportedLatencyMs} ms. This is not a measurement: wireless headphones can add delay that the browser does not know. If the voice sounds late, raise the delay correction.`
      );
    } catch (error) {
      setTestResult(`The test did not play: ${errorText(error)}`);
    }
  };

  const changeCorrection = (value: number) => {
    const clamped = clampCorrection(value);
    setCorrection(clamped);
    setDelayCorrectionMs(clamped);
  };

  return (
    <section className="panel setup-section" id="setup-voice" aria-labelledby="voice-title">
      <h2 id="voice-title">Voice</h2>
      <p className="sub">One device plays the cues: this device, or another one with GT7 Tutor open. A phone must stay unlocked during an attempt.</p>
      <div className="pref">
        <span className="pref-text">
          <span>Voice device</span>
          {playing ? null : (
            <span className={`voice-state${here ? ' error' : ''}`} role="status">
              {here
                ? 'The browser did not start the sound on this device. Select Use this device for voice again.'
                : holder !== null
                  ? 'Another device plays the voice. This device stays silent.'
                  : 'No device plays the voice.'}
            </span>
          )}
        </span>
        <div className="pref-control">
          {playing ? (
            <>
              <div className="field-pair">
                <span className="voice-state playing" role="status">
                  {movedFromOther ? 'This device plays the voice. The other device no longer plays cues.' : 'This device plays the voice.'}
                </span>
                <IconButton icon="speaker" label="Test" onClick={() => void runTest()} />
              </div>
              <button className="btn ghost" type="button" onClick={disable}>
                Turn voice off here
              </button>
            </>
          ) : (
            <>
              <button className="btn" type="button" onClick={enable}>
                Use this device for voice
              </button>
              {here ? (
                <button className="btn ghost" type="button" onClick={disable}>
                  Turn voice off here
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
          <label htmlFor="delay-correction">Delay correction for wireless headphones</label>
          <span className="sub">Wireless headphones add delay that the browser does not report. Cues start earlier by this amount on this device.</span>
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
