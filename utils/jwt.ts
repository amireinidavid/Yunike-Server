import jwt, { SignOptions } from 'jsonwebtoken';
import { User } from '@prisma/client';

// JWT configurations
const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-key-yunike';
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret-key-yunike';
const ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '30m';
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '15d';
const EXTENDED_REFRESH_TOKEN_EXPIRY = process.env.JWT_EXTENDED_REFRESH_EXPIRY || '30d';

/**
 * Generate both access and refresh tokens for a user
 * @param user User object
 * @param rememberMe Whether to extend refresh token expiry
 * @returns Object containing access and refresh tokens
 */
export const generateTokens = async (user: User, rememberMe = false) => {
  // Create JWT payload with minimal data
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role
  };

  // Generate access token (short-lived)
  const accessToken = jwt.sign(
    payload,
    Buffer.from(ACCESS_TOKEN_SECRET, 'utf-8'),
    { expiresIn: ACCESS_TOKEN_EXPIRY } as SignOptions
  );

  // Generate refresh token (long-lived)
  const refreshToken = jwt.sign(
    { userId: user.id },
    Buffer.from(REFRESH_TOKEN_SECRET, 'utf-8'),
    { 
      expiresIn: rememberMe ? EXTENDED_REFRESH_TOKEN_EXPIRY : REFRESH_TOKEN_EXPIRY 
    } as SignOptions
  );

  return {
    accessToken,
    refreshToken
  };
};

/**
 * Verify an access token
 * @param token JWT access token
 * @returns Decoded token payload
 */
export const verifyAccessToken = async (token: string) => {
  try {
    const decoded = jwt.verify(token, Buffer.from(ACCESS_TOKEN_SECRET, 'utf-8')) as jwt.JwtPayload & {
      userId: string;
      email: string;
      role: string;
    };
    return decoded;
  } catch (error) {
    throw new Error(
      (error as Error).name === 'TokenExpiredError'
        ? 'Access token has expired'
        : 'Invalid access token'
    );
  }
};

/**
 * Verify a refresh token
 * @param token JWT refresh token
 * @returns Decoded token payload
 */
export const verifyRefreshToken = async (token: string) => {
  try {
    const decoded = jwt.verify(token, Buffer.from(REFRESH_TOKEN_SECRET, 'utf-8')) as jwt.JwtPayload & {
      userId: string;
    };
    return decoded;
  } catch (error) {
    throw new Error(
      (error as Error).name === 'TokenExpiredError'
        ? 'Refresh token has expired'
        : 'Invalid refresh token'
    );
  }
}; 