import { BadRequestException, Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
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

type AuthenticatedUser = {
  id: number;
  email: string;
  fullName: string;
  role: { name: string } | null;
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
  ) { }

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
      return new UnauthorizedException("Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const { passwordHash: _passwordHash, ...result } = user;
    void _passwordHash;
    return result;
  }

  // Sign in a user and return a JWT token
  async signIn(signDto: { id: number, email: string, role: number }) {
    const user = await this.userService.findByEmail(signDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user);
  }

  // Find or create a user from a Google profile, then issue tokens for them
  async validateGoogleUser(code: string, redirectUri: string) {
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
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
    })

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
        data: { googleId, avatar: byEmail.avatar ?? avatar, fullName: byEmail.fullName ?? fullName },
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
        role: true
      }
    })
  }

  signInWithUser(user: AuthenticatedUser) {
    return this.issueTokens(user);
  }

  private issueTokens(user: AuthenticatedUser) {
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
    } catch { throw new UnauthorizedException('Invalid token'); }
  }

  findUserById(id: number) {
    return this.prisma.user.findUnique({
      where: { id: id },
    })
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

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: 'Password reset successfully. You can sign in with your new password.' };
  }

  signOut() {
    return {
      message: 'Signed out successfully',
    };
  }

  private generateToken(payload: Record<string, unknown>) {
    const base64Header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url',
    );
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = Buffer.from(`${base64Header}.${base64Payload}.dev-signature`).toString(
      'base64url',
    );
    return `${base64Header}.${base64Payload}.${signature}`;
  }
}
