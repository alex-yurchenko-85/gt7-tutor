import { useState } from 'react';
import { useLive } from '../../api/live.tsx';
import { errorText } from '../../app/resource.ts';
import { StatusDot } from '../../app/Shell.tsx';
import { voiceStatus } from '../../app/status.ts';
import { clampCorrection, delayCorrectionMs, MAX_CORRECTION_MS, MIN_CORRECTION_MS, setDelayCorrectionMs, setWantsVoice } from '../../voice/device.ts';

function signed(ms: number): string {
  return `${ms > 0 ? '+' : ''}${ms} ms`;
}

export function VoiceSection() {
  const { state, send, player, deviceId } = useLive();
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [correction, setCorrection] = useState(delayCorrectionMs);
  const [movedFromOther, setMovedFromOther] = useState(false);

  const holder = state?.voiceDeviceId ?? null;
  const here = holder === deviceId;
  const status = voiceStatus(state, deviceId);

  const enable = async () => {
    setProblem(null);
    setMessage(null);
    try {
      await player.unlock();
      await player.preload(['voice-check']);
    } catch (error) {
      setProblem(`The browser did not start audio: ${errorText(error)}`);
      return;
    }
    setMovedFromOther(holder !== null && holder !== deviceId);
    setWantsVoice(true);
    send({ type: 'claim-voice', deviceId, ready: player.ready });
  };

  const disable = () => {
    setWantsVoice(false);
    setMovedFromOther(false);
    send({ type: 'release-voice' });
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
    <section className="panel" aria-labelledby="voice-title">
      <h2 id="voice-title">Voice</h2>
      <p className="sub">One device plays the cues. Use the browser on this computer, or a phone with auto-lock turned off during a session.</p>
      <p className="voice-state" role="status">
        <StatusDot status={status} />
        {here
          ? movedFromOther
            ? 'This device plays the voice. The other device no longer plays cues.'
            : 'This device plays the voice.'
          : holder !== null
            ? 'Voice is on another device. This device stays silent.'
            : 'No device plays the voice.'}
      </p>
      {here && !state?.voiceReady ? (
        <p className="notice bad">The browser has not started audio on this device. Select Use this device for voice again.</p>
      ) : null}
      <div className="btn-row" style={{ marginTop: 12 }}>
        {here && state?.voiceReady ? null : (
          <button className="btn inline" type="button" onClick={enable}>
            Use this device for voice
          </button>
        )}
        {here ? (
          <button className="btn inline ghost" type="button" onClick={disable}>
            Turn voice off here
          </button>
        ) : null}
        <button className="btn inline ghost" type="button" onClick={runTest} disabled={!here}>
          Run voice test
        </button>
      </div>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      {message ? <p className="sub">{message}</p> : null}
      {testResult ? (
        <p className="notice" role="status">
          {testResult}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="delay-correction">
          Delay correction <span className="correction-value">{signed(correction)}</span>
        </label>
        <input
          id="delay-correction"
          type="range"
          min={MIN_CORRECTION_MS}
          max={MAX_CORRECTION_MS}
          step={10}
          value={correction}
          onChange={event => changeCorrection(Number(event.target.value))}
        />
        <span className="sub">
          Wireless headphones add delay that the browser does not report. Add it here, and cues start earlier by the same amount. This setting
          belongs to this device.
        </span>
      </div>
    </section>
  );
}
