import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from '../../common/dto/auth/register.dto';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { MailService } from '../mail/mail.service';

const PASSWORD_RESET_MESSAGE =
  'If that email is registered, you will receive a password reset link shortly.';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d

type AuthenticatedUser = {
  id: number;
  email: string;
  fullName: string;
  role: { name: string } | null;
};

export type SessionMeta = {
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  //Register a new user
  async register(registerDto: RegisterDto) {
    const { email, password, fullName } = registerDto;

    const role = await this.prisma.role.findFirst({
      where: { name: 'CUSTOMER' },
    });

    if (!role) {
      throw new Error('Role CUSTOMER not found');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: email as string },
    });

    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    const hashPassword = await bcrypt.hash(password as string, 10);

    const user = await this.prisma.user.create({
      data: {
        email: email as string,
        passwordHash: hashPassword,
        fullName: fullName as string,
        role: {
          connect: { id: role.id },
        },
      },
    });

    const { passwordHash: _passwordHash, ...result } = user;
    void _passwordHash;
    return result;
  }

  async validateUser(email: string | undefined, password: string | undefined) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user?.passwordHash) {
      return new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const { passwordHash: _passwordHash, ...result } = user;
    void _passwordHash;
    return result;
  }

  // Sign in a user and return a JWT token
  async signIn(
    signDto: { id: number; email: string; role: number },
    meta?: SessionMeta,
  ) {
    const user = await this.userService.findByEmail(signDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user, meta);
  }

  // Find or create a user from a Google profile, then issue tokens for them
  async validateGoogleUser(code: string, redirectUri: string) {
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri,
    );

    const { tokens } = await client.getToken(code);
    const idToken = tokens.id_token;
    if (!idToken) {
      throw new UnauthorizedException('Invalid Google token');
    }

    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new UnauthorizedException('Google account has no email');
    }

    const googleId = payload.sub;
    const email = payload.email;
    const avatar = payload.picture;
    const fullName = payload.name || email;

    const byGoogleId = await this.prisma.user.findUnique({
      where: { googleId },
      include: { role: true },
    });

    if (byGoogleId) {
      return byGoogleId;
    }

    const byEmail = await this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    if (byEmail) {
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId,
          avatar: byEmail.avatar ?? avatar,
          fullName: byEmail.fullName ?? fullName,
        },
        include: { role: true },
      });
    }

    const role = await this.prisma.role.findFirst({
      where: { name: 'CUSTOMER' },
    });

    if (!role) {
      throw new Error('Role CUSTOMER not found');
    }

    return this.prisma.user.create({
      data: {
        email,
        googleId,
        avatar,
        fullName,
        role: { connect: { id: role.id } },
      },
      include: {
        role: true,
      },
    });
  }

  signInWithUser(user: AuthenticatedUser, meta?: SessionMeta) {
    return this.issueTokens(user, meta);
  }

  /**
   * Rotate refresh token: revoke the current DB row, issue a new pair,
   * and point the same Session at the new refresh token.
   */
  async refresh(plainRefreshToken: string, meta?: SessionMeta) {
    let jwtPayload: { sub: number };
    try {
      jwtPayload = this.jwtService.verify<{ sub: number }>(plainRefreshToken);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    const tokenHash = this.hashToken(plainRefreshToken);

    const stored = await this.prisma.refreshToken.findFirst({
      where: {
        token: tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { session: true },
    });

    if (!stored || stored.userId !== jwtPayload.sub) {
      throw new UnauthorizedException('Invalid or revoked refresh token');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: stored.userId, deletedAt: null },
      include: { role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.issueTokens(
      {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role ? { name: user.role.name } : null,
      },
      meta,
      {
        sessionId: stored.session?.id,
        revokeRefreshTokenId: stored.id,
      },
    );
  }

  private async issueTokens(
    user: AuthenticatedUser,
    meta?: SessionMeta,
    rotation?: { sessionId?: number; revokeRefreshTokenId?: number },
  ) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role?.name ?? 'CUSTOMER',
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '1h',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      if (rotation?.revokeRefreshTokenId) {
        const revoked = await tx.refreshToken.updateMany({
          where: { id: rotation.revokeRefreshTokenId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        // Concurrent refresh already consumed this token.
        if (revoked.count === 0) {
          throw new UnauthorizedException('Invalid or revoked refresh token');
        }
      }

      const created = await tx.refreshToken.create({
        data: {
          token: this.hashToken(refreshToken),
          userId: user.id,
          expiresAt: refreshExpiresAt,
        },
      });

      if (rotation?.sessionId) {
        await tx.session.update({
          where: { id: rotation.sessionId },
          data: {
            refreshTokenId: created.id,
            lastActiveAt: new Date(),
            expiresAt: refreshExpiresAt,
            ...(meta?.ipAddress !== undefined && { ipAddress: meta.ipAddress }),
            ...(meta?.userAgent !== undefined && { userAgent: meta.userAgent }),
          },
        });
      } else {
        await tx.session.create({
          data: {
            userId: user.id,
            refreshTokenId: created.id,
            ipAddress: meta?.ipAddress,
            userAgent: meta?.userAgent,
            expiresAt: refreshExpiresAt,
          },
        });
      }
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role?.name ?? 'USER',
      },
    };
  }

  verifyToken(token: string) {
    try {
      return this.jwtService.verify<{ sub: number }>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  findUserById(id: number) {
    return this.prisma.user.findUnique({
      where: { id: id },
    });
  }

  async getPermissionsForUser(userId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        role: {
          select: {
            name: true,
            rolePermissions: {
              select: {
                permission: { select: { name: true, description: true } },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    return {
      role: user.role.name,
      permissions: user.role.rolePermissions.map((rp) => ({
        name: rp.permission.name,
        description: rp.permission.description,
      })),
    };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      this.logger.debug(`Forgot password: no user for ${email}`);
      return { message: PASSWORD_RESET_MESSAGE };
    }

    if (!user.passwordHash) {
      this.logger.debug(
        `Forgot password: ${email} has no local password (Google-only account) — email not sent`,
      );
      return { message: PASSWORD_RESET_MESSAGE };
    }

    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(plainToken).digest('hex');
    const expiryMinutes = Number(
      this.configService.get('PASSWORD_RESET_EXPIRY_MINUTES') ?? 30,
    );

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
      },
    });

    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const resetUrl = new URL('/reset-password', frontendUrl);
    resetUrl.searchParams.set('token', plainToken);

    await this.mailService.sendPasswordResetEmail(user.email, resetUrl.toString());

    return { message: PASSWORD_RESET_MESSAGE };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const resetToken = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { userId: resetToken.userId, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
    ]);

    return {
      message: 'Password reset successfully. You can sign in with your new password.',
    };
  }

  /**
   * Revoke the refresh token (and expire its session) for the current device.
   * Idempotent if the cookie is already missing/invalid.
   */
  async signOut(plainRefreshToken?: string) {
    if (!plainRefreshToken) {
      return { message: 'Signed out successfully' };
    }

    const tokenHash = this.hashToken(plainRefreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { token: tokenHash, revokedAt: null },
      include: { session: true },
    });

    if (!stored) {
      return { message: 'Signed out successfully' };
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: now },
      });

      if (stored.session) {
        await tx.session.update({
          where: { id: stored.session.id },
          data: { expiresAt: now },
        });
      }
    });

    return { message: 'Signed out successfully' };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
