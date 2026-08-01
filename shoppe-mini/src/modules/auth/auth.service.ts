import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserService } from '../user/user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from '../../common/dto/auth/register.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) { }

  //Register a new user
  async register(registerDto: RegisterDto) {
    const { email, passwordHash, fullName } = registerDto;

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

    const hashPassword = await bcrypt.hash(passwordHash as string, 10);

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

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role?.name ?? 'CUSTOMER',
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '1h',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d'
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
