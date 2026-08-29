import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, ServerOptions } from 'socket.io';

/**
 * NestFactory.create() returns a Proxy, so `new IoAdapter(app)` does not
 * satisfy `instanceof NestApplication`. Socket.IO then never mounts on :3001
 * and Express answers GET /socket.io with Cannot GET (404).
 */
export class SocketIoAdapter extends IoAdapter {
  constructor(private readonly app: INestApplication) {
    super(app.getHttpServer());
  }

  createIOServer(_port: number, options?: ServerOptions) {
    return new Server(this.app.getHttpServer(), {
      ...options,
      path: '/socket.io',
      cors: {
        origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
        credentials: true,
      },
    });
  }
}
