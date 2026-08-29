import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../../common/auth/jwt-payload.type';
import { PrismaService } from '../../prisma/prisma.service';

@WebSocketGateway({
  path: '/socket.io',
  cors: {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    const raw = client.handshake.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('accessToken='))
      ?.slice('accessToken='.length);

    const token = raw ? decodeURIComponent(raw) : undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }

    const decoded = this.verifyToken(token);
    if (!decoded?.sub) {
      client.disconnect(true);
      return;
    }

    const user = await this.prisma.user.findFirst({
      where: { id: decoded.sub, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      client.disconnect(true);
      return;
    }

    client.data.userId = user.id;
    await client.join('user:' + user.id);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket ${client.id} disconnected`);
  }

  private verifyToken(token: string): JwtPayload | null {
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      return null;
    }
  }
}
