import { useState } from 'react';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { errorText } from '../../app/resource.ts';
import { StatusDot } from '../../app/Shell.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { voiceStatus } from '../../app/status.ts';
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
  const status = voiceStatus(state, deviceId);
  const playing = here && state?.voiceReady === true;

  const enable = async () => {
    setMessage(null);
    setMovedFromOther(holder !== null && holder !== deviceId);
    await voice.claim();
  };

  const disable = () => {
    setMovedFromOther(false);
    voice.release();
    setMessage('Voice is off on this device. Cues are recorded but not played.');
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
            <span className="voice-state" role="status">
              <StatusDot status={status} />
              {here ? 'This device has the voice, but the browser has not started audio.' : holder !== null ? 'Voice is on another device. This device stays silent.' : 'No device plays the voice.'}
            </span>
          )}
          {here && !state?.voiceReady ? (
            <span className="notice bad">The browser has not started audio on this device. Select Use this device for voice again.</span>
          ) : null}
        </span>
        <div className="pref-control">
          {playing ? (
            <>
              <div className="field-pair">
                <span className="voice-state playing" role="status">
                  <StatusDot status={status} />
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
              <p className="sub">The test appears here when this device plays the voice.</p>
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
          <span className="sub">Wireless headphones add delay that the browser does not report. Cues start earlier by this amount.</span>
          <span className="device-tag">On this device</span>
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
