import { createSocket, type Socket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPTURE_CONFIG, UdpSource, type Datagram } from '../src/index.ts';
import { eventually } from '../../../tools/testing/eventually.ts';

const sockets: Socket[] = [];
const sources: UdpSource[] = [];

afterEach(async () => {
  await Promise.all(sources.splice(0).map(source => source.stop()));
  for (const socket of sockets.splice(0)) socket.close();
});

function bindFakeConsole(onHeartbeat: (socket: Socket, port: number) => void, letter = 'C'): Promise<number> {
  const socket = createSocket('udp4');
  sockets.push(socket);
  socket.on('message', (message, peer) => {
    if (message.toString() === letter) onHeartbeat(socket, peer.port);
  });
  return new Promise(resolve => socket.bind(0, '127.0.0.1', () => resolve(socket.address().port)));
}

function track(source: UdpSource): UdpSource {
  sources.push(source);
  return source;
}

describe('UdpSource', () => {
  it('udp_source_receives_from_fake_console', async () => {
    let answered = false;
    const consolePort = await bindFakeConsole((socket, port) => {
      if (answered) return;
      answered = true;
      socket.send(Buffer.from([1, 2, 3]), port, '127.0.0.1');
      setTimeout(() => socket.send(Buffer.from([4, 5, 6]), port, '127.0.0.1'), 5);
    });
    const received: Datagram[] = [];
    const source = track(new UdpSource({ ps5Ip: '127.0.0.1', bindPort: 0, heartbeatPort: consolePort, heartbeatMs: 50 }));
    await source.start(datagram => received.push(datagram));
    await eventually(() => received.length >= 2);
    expect(received.map(d => [...d.payload])).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(received[1]!.receivedMonoMs).toBeGreaterThan(received[0]!.receivedMonoMs);
    expect(received[0]!.peerIp).toBe('127.0.0.1');
  });

  it('heartbeat_asks_for_format_c', async () => {
    let answered = false;
    const consolePort = await bindFakeConsole((socket, port) => {
      if (answered) return;
      answered = true;
      socket.send(Buffer.alloc(368), port, '127.0.0.1');
    });
    const received: Datagram[] = [];
    const source = track(new UdpSource({ ps5Ip: '127.0.0.1', bindPort: 0, heartbeatPort: consolePort, heartbeatMs: 50 }));
    await source.start(datagram => received.push(datagram));
    await eventually(() => received.length > 0);
    expect(received[0]!.payload.byteLength).toBe(368);
  });

  it('receive_port_is_33740', () => {
    expect(CAPTURE_CONFIG.udp.receivePort).toBe(33740);
  });

  it('busy_port_names_the_port', async () => {
    const first = track(new UdpSource({ ps5Ip: '127.0.0.1', bindPort: 0, heartbeatPort: 9, heartbeatMs: 1000 }));
    await first.start(() => {});
    const port = first.boundPort()!;
    const second = track(new UdpSource({ ps5Ip: '127.0.0.1', bindPort: port, heartbeatPort: 9, heartbeatMs: 1000 }));
    await expect(second.start(() => {})).rejects.toThrow(`UDP port ${port}`);
  });

  it('foreign_peer_is_ignored', async () => {
    const received: Datagram[] = [];
    const source = track(new UdpSource({ ps5Ip: '192.0.2.1', bindPort: 0, heartbeatPort: 9, heartbeatMs: 1000 }));
    await source.start(datagram => received.push(datagram));
    const sender = createSocket('udp4');
    sockets.push(sender);
    await new Promise<void>(resolve => sender.send(Buffer.from([9]), source.boundPort()!, '127.0.0.1', () => resolve()));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(received).toEqual([]);
    expect(source.foreignDatagrams).toBe(1);
  });
});
