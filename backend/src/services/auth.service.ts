import { Response } from 'express';
import jwt, { JwtPayload as BaseJwtPayload, Secret, SignOptions } from 'jsonwebtoken';
import { config } from '../config/config';
import { UserRecord } from './database.service';

export type TokenKind = 'access' | 'refresh';

export interface AuthTokenPayload extends BaseJwtPayload {
  userId: number;
  chatId: string;
  role: 'admin' | 'user';
  tokenType: TokenKind;
}

const parseDurationToMs = (value: string): number => {
  const match = /^([0-9]+)(ms|s|m|h|d)?$/i.exec(value.trim());
  if (!match) {
    // Default to minutes if parsing fails
    return 15 * 60 * 1000;
  }

  const amount = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();

  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    default:
      return amount * 1000;
  }
};

const accessSecret: Secret = config.auth.jwtAccessSecret;
const refreshSecret: Secret = config.auth.jwtRefreshSecret;

const createToken = (user: UserRecord, tokenType: TokenKind): string => {
  const payload: AuthTokenPayload = {
    userId: user.id!,
    chatId: user.telegram_chat_id,
    role: user.role,
    tokenType,
  };

  if (tokenType === 'access') {
    return jwt.sign(payload, accessSecret, {
      expiresIn: config.auth.accessTokenTtl as SignOptions['expiresIn'],
    });
  }

  return jwt.sign(payload, refreshSecret, {
    expiresIn: config.auth.refreshTokenTtl as SignOptions['expiresIn'],
  });
};

export const createAccessToken = (user: UserRecord): string => createToken(user, 'access');
export const createRefreshToken = (user: UserRecord): string => createToken(user, 'refresh');

export const verifyAccessToken = (token: string): AuthTokenPayload => {
  const payload = jwt.verify(token, accessSecret) as AuthTokenPayload;
  if (payload.tokenType !== 'access') {
    throw new Error('Invalid token type');
  }
  return payload;
};

export const verifyRefreshToken = (token: string): AuthTokenPayload => {
  const payload = jwt.verify(token, refreshSecret) as AuthTokenPayload;
  if (payload.tokenType !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return payload;
};

const getCookieOptions = (maxAgeMs: number) => ({
  httpOnly: true as const,
  secure: config.auth.secureCookies,
  sameSite: (config.auth.secureCookies ? 'none' : 'lax') as 'none' | 'lax',
  domain: config.auth.cookieDomain,
  path: '/',
  maxAge: maxAgeMs,
});

export const setAuthCookies = (res: Response, accessToken: string, refreshToken: string): void => {
  const accessMaxAge = parseDurationToMs(config.auth.accessTokenTtl);
  const refreshMaxAge = parseDurationToMs(config.auth.refreshTokenTtl);

  res.cookie(
    config.auth.accessCookieName,
    accessToken,
    getCookieOptions(accessMaxAge)
  );

  res.cookie(
    config.auth.refreshCookieName,
    refreshToken,
    getCookieOptions(refreshMaxAge)
  );
};

export const clearAuthCookies = (res: Response): void => {
  const options = getCookieOptions(0);
  res.cookie(config.auth.accessCookieName, '', { ...options, maxAge: 0 });
  res.cookie(config.auth.refreshCookieName, '', { ...options, maxAge: 0 });
};

export const issueAuthTokens = (res: Response, user: UserRecord): { accessToken: string; refreshToken: string } => {
  const accessToken = createAccessToken(user);
  const refreshToken = createRefreshToken(user);
  setAuthCookies(res, accessToken, refreshToken);
  return { accessToken, refreshToken };
};

export const buildUserResponse = (user: UserRecord) => ({
  id: user.id,
  chatId: user.telegram_chat_id,
  displayName: user.display_name || user.telegram_chat_id,
  role: user.role,
  status: user.status || 'active',
  isAdmin: user.role === 'admin',
  lastLoginAt: user.last_login_at || null,
});
