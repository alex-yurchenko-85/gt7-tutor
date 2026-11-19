import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClientMsg, LiveState, ServerMsg } from '@gt7/contracts';
import { clipsForCues } from '../voice/clips.ts';
import { browserVoicePlayer, type VoicePlayer } from '../voice/VoicePlayer.ts';
import { api } from './client.ts';
import { SessionContext } from '../app/session.tsx';
import { stateRate } from '../app/state-rate.ts';
import { delayCorrectionMs, setWantsVoice, voiceDeviceId, wantsVoice } from '../voice/device.ts';

export type LiveSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
};

export type SocketFactory = (url: string) => LiveSocket;

export type Live = {
  state: LiveState | null;
  connected: boolean;
  send(message: ClientMsg): void;
  player: VoicePlayer;
  deviceId: string;
};

const LiveContext = createContext<Live | null>(null);

const OPEN = 1;
const RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;
const UNAUTHENTICATED_CLOSE_CODE = 4401;
const MAX_OUTPUT_LATENCY_MS = 2000;

function liveUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/live`;
}

const browserSocket: SocketFactory = url => new WebSocket(url) as unknown as LiveSocket;

function reportedLatencyMs(player: VoicePlayer): number {
  return Math.min(MAX_OUTPUT_LATENCY_MS, Math.max(0, player.outputLatencyMs() + delayCorrectionMs()));
}

function useArmedClips(state: LiveState | null, deviceId: string, player: VoicePlayer): void {
  const referenceId = state?.voiceDeviceId === deviceId && state.trainingMode === 'guided' ? state.referenceId : null;
  useEffect(() => {
    if (!referenceId) return;
    Promise.all([api.referenceCues(referenceId), api.referenceCorners(referenceId)])
      .then(([cues, corners]) => player.preload(clipsForCues(cues, corners.length)))
      .catch(() => undefined);
  }, [referenceId, player]);
}

export function LiveProvider({ children, socketFactory = browserSocket, player: givenPlayer }: { children: ReactNode; socketFactory?: SocketFactory; player?: VoicePlayer }) {
  const [state, setState] = useState<LiveState | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<LiveSocket | null>(null);
  const send = useCallback((message: ClientMsg) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(message));
  }, []);
  const player = useMemo(() => givenPlayer ?? browserVoicePlayer(message => send(message)), [givenPlayer, send]);
  const deviceId = useMemo(() => voiceDeviceId(), []);
  const session = useContext(SessionContext);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delayMs = RECONNECT_MS;
    const connect = () => {
      const socket = socketFactory(liveUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        delayMs = RECONNECT_MS;
        socket.send(JSON.stringify({ type: 'state-rate', perSecond: stateRate() }));
        setConnected(true);
      };
      socket.onclose = event => {
        if (socketRef.current === socket) socketRef.current = null;
        setConnected(false);
        player.stop();
        if (stopped) return;
        if (event.code === UNAUTHENTICATED_CLOSE_CODE) sessionRef.current?.ended();
        timer = setTimeout(connect, delayMs);
        delayMs = Math.min(delayMs * 2, MAX_RECONNECT_MS);
      };
      socket.onmessage = event => {
        const receivedAt = performance.now();
        const message = JSON.parse(String(event.data)) as ServerMsg;
        player.handle(message, receivedAt);
        if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', id: message.id, outputLatencyMs: reportedLatencyMs(player) }));
          return;
        }
        if (message.type === 'state') {
          setState(message.state);
          const holder = message.state.voiceDeviceId;
          if (holder !== null && holder !== deviceId) setWantsVoice(false);
          if (holder === null && wantsVoice()) socket.send(JSON.stringify({ type: 'claim-voice', deviceId, ready: player.ready }));
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [socketFactory, player, deviceId]);

  useArmedClips(state, deviceId, player);

  const value = useMemo<Live>(() => ({ state, connected, send, player, deviceId }), [state, connected, send, player, deviceId]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  const live = useContext(LiveContext);
  if (!live) throw new Error('useLive needs a LiveProvider');
  return live;
}
