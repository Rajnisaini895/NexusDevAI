import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

const REFRESH_TOKEN_TTL_DAYS = 7;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const email = registerDto.email.toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email,
        fullName: registerDto.fullName,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      message: 'User registered successfully',
      user,
    };
  }

  async login(loginDto: LoginDto) {
    const email = loginDto.email.toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.status !== 'ACTIVE' || user.deletedAt !== null) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const refreshTokenSecret = this.createRefreshTokenSecret();
    const refreshTokenHash = await bcrypt.hash(refreshTokenSecret, 12);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        expiresAt: this.createRefreshTokenExpiry(),
      },
      select: { id: true },
    });

    const accessToken = await this.createAccessToken(user.id, user.email);

    return {
      message: 'Login successful',
      accessToken,
      refreshToken: this.formatRefreshToken(session.id, refreshTokenSecret),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        createdAt: user.createdAt,
      },
    };
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { sessionId, secret } = this.parseRefreshToken(
      refreshTokenDto.refreshToken,
    );

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: true,
      },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const isMatch = await bcrypt.compare(secret, session.refreshTokenHash);

    if (!isMatch) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (session.revokedAt) {
      await this.prisma.session.updateMany({
        where: {
          userId: session.userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE' ||
      session.user.deletedAt !== null
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const nextSecret = this.createRefreshTokenSecret();
    const nextSecretHash = await bcrypt.hash(nextSecret, 12);

    const rotation = await this.prisma.session.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: session.refreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        refreshTokenHash: nextSecretHash,
        expiresAt: this.createRefreshTokenExpiry(),
      },
    });

    if (rotation.count !== 1) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const accessToken = await this.createAccessToken(
      session.user.id,
      session.user.email,
    );

    return {
      message: 'Token refreshed successfully',
      accessToken,
      refreshToken: this.formatRefreshToken(session.id, nextSecret),
    };
  }

  async logout(logoutDto: LogoutDto) {
    const { sessionId, secret } = this.parseRefreshToken(
      logoutDto.refreshToken,
    );

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const isMatch = await bcrypt.compare(secret, session.refreshTokenHash);

    if (!isMatch) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!session.revokedAt) {
      await this.prisma.session.updateMany({
        where: {
          id: session.id,
          refreshTokenHash: session.refreshTokenHash,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    }

    return { message: 'Logged out successfully' };
  }

  private createAccessToken(userId: string, email: string) {
    return this.jwtService.signAsync({ sub: userId, email });
  }

  private createRefreshTokenSecret() {
    return randomBytes(32).toString('base64url');
  }

  private createRefreshTokenExpiry() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
    return expiresAt;
  }

  private formatRefreshToken(sessionId: string, secret: string) {
    return `${sessionId}.${secret}`;
  }

  private parseRefreshToken(refreshToken: string) {
    const separatorIndex = refreshToken.indexOf('.');

    if (
      separatorIndex <= 0 ||
      separatorIndex === refreshToken.length - 1 ||
      refreshToken.indexOf('.', separatorIndex + 1) !== -1
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      sessionId: refreshToken.slice(0, separatorIndex),
      secret: refreshToken.slice(separatorIndex + 1),
    };
  }
}
