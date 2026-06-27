import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const compareMock = bcrypt.compare as unknown as jest.MockedFunction<
  (data: string | Buffer, encrypted: string) => Promise<boolean>
>;
const hashMock = bcrypt.hash as unknown as jest.MockedFunction<
  (data: string | Buffer, saltOrRounds: string | number) => Promise<string>
>;

describe('AuthService', () => {
  let service: AuthService;

  const prisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const jwtService = {
    signAsync: jest.fn(),
  };

  const activeUser = {
    id: 'user-id',
    email: 'developer@nexusdev.ai',
    fullName: 'Nexus Developer',
    passwordHash: 'password-hash',
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date('2026-06-27T00:00:00.000Z'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('creates a directly addressable refresh token during login', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUser);
    prisma.session.create.mockResolvedValue({ id: 'session-id' });
    jwtService.signAsync.mockResolvedValue('access-token');
    compareMock.mockResolvedValue(true);
    hashMock.mockResolvedValue('refresh-token-hash');

    const result = await service.login({
      email: 'Developer@NexusDev.ai',
      password: 'Password123',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'developer@nexusdev.ai' },
    });
    const [createSessionInput] = prisma.session.create.mock.calls[0] as [
      {
        data: {
          userId: string;
          refreshTokenHash: string;
          expiresAt: Date;
        };
        select: { id: boolean };
      },
    ];
    expect(createSessionInput.data.userId).toBe(activeUser.id);
    expect(createSessionInput.data.refreshTokenHash).toBe('refresh-token-hash');
    expect(createSessionInput.data.expiresAt).toBeInstanceOf(Date);
    expect(createSessionInput.select).toEqual({ id: true });
    expect(result.refreshToken).toMatch(/^session-id\.[A-Za-z0-9_-]+$/);
    expect(result.accessToken).toBe('access-token');
  });

  it('rejects login for a suspended user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      status: 'SUSPENDED',
    });

    await expect(
      service.login({
        email: activeUser.email,
        password: 'Password123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('rotates a refresh token after one indexed session lookup', async () => {
    const session = {
      id: 'session-id',
      userId: activeUser.id,
      refreshTokenHash: 'current-refresh-token-hash',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: activeUser,
    };

    prisma.session.findUnique.mockResolvedValue(session);
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    jwtService.signAsync.mockResolvedValue('new-access-token');
    compareMock.mockResolvedValue(true);
    hashMock.mockResolvedValue('next-refresh-token-hash');

    const result = await service.refreshToken({
      refreshToken: 'session-id.current-secret',
    });

    expect(prisma.session.findUnique).toHaveBeenCalledWith({
      where: { id: 'session-id' },
      include: { user: true },
    });
    const [rotationInput] = prisma.session.updateMany.mock.calls[0] as [
      {
        where: {
          id: string;
          refreshTokenHash: string;
          revokedAt: null;
        };
        data: { refreshTokenHash: string; expiresAt: Date };
      },
    ];
    expect(rotationInput.where).toEqual(
      expect.objectContaining({
        id: 'session-id',
        refreshTokenHash: 'current-refresh-token-hash',
        revokedAt: null,
      }),
    );
    expect(rotationInput.data.refreshTokenHash).toBe('next-refresh-token-hash');
    expect(rotationInput.data.expiresAt).toBeInstanceOf(Date);
    expect(result.accessToken).toBe('new-access-token');
    expect(result.refreshToken).toMatch(/^session-id\.[A-Za-z0-9_-]+$/);
    expect(result.refreshToken).not.toBe('session-id.current-secret');
  });

  it('revokes the matching session during logout', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'session-id',
      refreshTokenHash: 'refresh-token-hash',
      revokedAt: null,
    });
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    compareMock.mockResolvedValue(true);

    await expect(
      service.logout({ refreshToken: 'session-id.current-secret' }),
    ).resolves.toEqual({ message: 'Logged out successfully' });

    const [logoutInput] = prisma.session.updateMany.mock.calls[0] as [
      {
        where: {
          id: string;
          refreshTokenHash: string;
          revokedAt: null;
        };
        data: { revokedAt: Date };
      },
    ];
    expect(logoutInput.where).toEqual({
      id: 'session-id',
      refreshTokenHash: 'refresh-token-hash',
      revokedAt: null,
    });
    expect(logoutInput.data.revokedAt).toBeInstanceOf(Date);
  });

  it('rejects malformed refresh tokens without querying the database', async () => {
    await expect(
      service.refreshToken({ refreshToken: 'not-a-valid-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });
});
