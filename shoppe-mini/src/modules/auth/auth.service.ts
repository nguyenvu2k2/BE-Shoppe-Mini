import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserService } from '../user/user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from '../../common/dto/auth/register.dto';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';

type AuthenticatedUser = {
  id: number;
  email: string;
  fullName: string;
  role: { name: string } | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private prisma: PrismaService,
    private readonly jwtService: JwtService,
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
