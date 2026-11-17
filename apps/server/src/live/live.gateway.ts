import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayConnection } from '@nestjs/websockets';
import { clientMsgSchema } from '@gt7/contracts';
import { WebSocket, type RawData } from 'ws';
import { AuthService } from '../auth/auth.service.js';
import { isForeignOrigin } from '../auth/origin.guard.js';
import { sessionTokenOf } from '../auth/session-cookie.js';
import { LiveHub, type LiveClient } from './live-hub.service.js';

export const UNAUTHENTICATED_CLOSE_CODE = 4401;
export const FORBIDDEN_ORIGIN_CLOSE_CODE = 4403;
const MAX_MESSAGE_BYTES = 4096;

function socketClient(socket: WebSocket, userId: string): LiveClient {
  return {
    id: randomUUID(),
    userId,
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
    send(text: string) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('The socket is not open');
      socket.send(text);
    }
  };
}

function parseMessage(data: RawData): unknown {
  const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
  if (text.length > MAX_MESSAGE_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

@WebSocketGateway({ path: '/live' })
export class LiveGateway implements OnGatewayConnection {
  private readonly logger = new Logger(LiveGateway.name);

  constructor(
    private readonly auth: AuthService,
    private readonly hub: LiveHub
  ) {}

  async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    if (isForeignOrigin(request.headers.origin, request.headers.host)) {
      socket.close(FORBIDDEN_ORIGIN_CLOSE_CODE, 'Foreign origin');
      return;
    }
    const early: RawData[] = [];
    const keepEarly = (data: RawData) => early.push(data);
    socket.on('message', keepEarly);
    const user = await this.auth.userForToken(sessionTokenOf(request));
    socket.off('message', keepEarly);
    if (!user) {
      socket.close(UNAUTHENTICATED_CLOSE_CODE, 'Sign in first');
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    const client = socketClient(socket, user.id);
    const receive = (data: RawData) => {
      const parsed = clientMsgSchema.safeParse(parseMessage(data));
      if (parsed.success) this.hub.receive(client, parsed.data);
      else this.logger.debug('Ignored an invalid live message');
    };
    socket.on('message', receive);
    socket.on('close', () => this.hub.detach(client));
    this.hub.attach(client);
    for (const data of early) receive(data);
  }
}
