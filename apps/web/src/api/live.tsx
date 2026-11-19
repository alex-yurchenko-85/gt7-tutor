import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MAX_OUTPUT_LATENCY_MS, UNAUTHENTICATED_CLOSE_CODE, type ClientMsg, type LiveState, type ServerMsg } from '@gt7/contracts';
import { browserVoicePlayer, type VoicePlayer } from '../voice/VoicePlayer.ts';
import { api } from './client.ts';
import { useSession } from '../app/session.tsx';
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

export type LiveConnection = {
  send(message: ClientMsg): void;
  player: VoicePlayer;
  deviceId: string;
};

export type LiveSnapshot = { state: LiveState | null; connected: boolean };

class LiveStore {
  private snapshot: LiveSnapshot = { state: null, connected: false };
  private readonly listeners = new Set<() => void>();

  get = (): LiveSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(change: Partial<LiveSnapshot>): void {
    const next = { ...this.snapshot, ...change };
    if (next.state === this.snapshot.state && next.connected === this.snapshot.connected) return;
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }
}

const LiveConnectionContext = createContext<LiveConnection | null>(null);
const LiveStateContext = createContext<LiveStore | null>(null);

const OPEN = 1;
const RECONNECT_MS = 1000;

function liveUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/live`;
}

const browserSocket: SocketFactory = url => new WebSocket(url) as unknown as LiveSocket;

function reportedLatencyMs(player: VoicePlayer): number {
  return Math.min(MAX_OUTPUT_LATENCY_MS, Math.max(0, player.outputLatencyMs() + delayCorrectionMs()));
}

function useArmedClips(deviceId: string, player: VoicePlayer): void {
  const referenceId = useLiveState(({ state }) => (state?.voiceDeviceId === deviceId && state.trainingMode === 'guided' ? state.referenceId : null));
  useEffect(() => {
    if (!referenceId) return;
    api
      .referenceClips(referenceId)
      .then(clips => player.preload(clips))
      .catch(() => undefined);
  }, [referenceId, player]);
}

export function LiveProvider({ children, socketFactory = browserSocket, player: givenPlayer }: { children: ReactNode; socketFactory?: SocketFactory; player?: VoicePlayer }) {
  const [store] = useState(() => new LiveStore());
  const socketRef = useRef<LiveSocket | null>(null);
  const send = useCallback((message: ClientMsg) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(message));
  }, []);
  const player = useMemo(() => givenPlayer ?? browserVoicePlayer(message => send(message)), [givenPlayer, send]);
  const deviceId = useMemo(() => voiceDeviceId(), []);
  const { ended } = useSession();

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      const socket = socketFactory(liveUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'state-rate', perSecond: stateRate() }));
        store.update({ connected: true });
      };
      socket.onclose = event => {
        if (socketRef.current === socket) socketRef.current = null;
        store.update({ connected: false });
        player.stop();
        if (stopped) return;
        if (event.code === UNAUTHENTICATED_CLOSE_CODE) ended();
        else timer = setTimeout(connect, RECONNECT_MS);
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
          store.update({ state: message.state });
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
  }, [socketFactory, player, deviceId, ended, store]);

  const connection = useMemo<LiveConnection>(() => ({ send, player, deviceId }), [send, player, deviceId]);
  return (
    <LiveConnectionContext.Provider value={connection}>
      <LiveStateContext.Provider value={store}>
        <ArmedClips deviceId={deviceId} player={player} />
        {children}
      </LiveStateContext.Provider>
    </LiveConnectionContext.Provider>
  );
}

function ArmedClips({ deviceId, player }: { deviceId: string; player: VoicePlayer }) {
  useArmedClips(deviceId, player);
  return null;
}

export function useLiveConnection(): LiveConnection {
  const connection = useContext(LiveConnectionContext);
  if (!connection) throw new Error('useLiveConnection needs a LiveProvider');
  return connection;
}

function sameSelection(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.is(left[key], right[key]));
}

export function useLiveState<T>(select: (snapshot: LiveSnapshot) => T): T {
  const store = useContext(LiveStateContext);
  if (!store) throw new Error('useLiveState needs a LiveProvider');
  const last = useRef<{ snapshot: LiveSnapshot; select: typeof select; value: T } | null>(null);
  const read = (): T => {
    const snapshot = store.get();
    const previous = last.current;
    if (previous && previous.snapshot === snapshot && previous.select === select) return previous.value;
    const picked = select(snapshot);
    const value = previous && sameSelection(previous.value, picked) ? previous.value : picked;
    last.current = { snapshot, select, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, read, read);
}
