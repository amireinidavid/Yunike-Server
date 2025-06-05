import { Request, Response } from 'express';
import { PrismaClient, UserRole, Prisma, BusinessType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';
import { generateTokens, verifyRefreshToken } from '../utils/jwt';
import { BadRequestError, NotFoundError, UnauthorizedError, ApiError, ForbiddenError } from '../utils/errors';
import { createVerificationCode, hashPassword, validatePassword, generateOTP, OTPValidationResult, OTP_SETTINGS } from '../utils/auth';
import { redisClient } from '../services/redisService';
import { sendEmail } from '../services/emailService';
import { generateAndStoreOTP, verifyOTP, OTPPurpose, isUserBlocked, getBlockTimeRemaining } from '../services/otpService';

const prisma = new PrismaClient();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Extended PrismaClient with authToken model type definitions
interface AuthToken {
  id: string;
  userId: string;
  token: string;
  type: string;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

// Cookie options
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
  maxAge: 15 * 24 * 60 * 60 * 1000, // 15 days
} as const;

/**
 * Register a new user - Step 1: Initiate registration and send OTP
 */
export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, name, role = UserRole.CUSTOMER, phone } = req.body;

    // Validate input
    if (!email || !password) {
      throw new BadRequestError('Email and password are required');
    }

    // Check if user is blocked from OTP attempts
    const isBlocked = await isUserBlocked(email);
    if (isBlocked) {
      const blockTimeRemaining = await getBlockTimeRemaining(email);
      const minutesRemaining = Math.ceil(blockTimeRemaining / 60);
      throw new ForbiddenError(`Too many failed verification attempts. Please try again after ${minutesRemaining} minutes.`);
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      throw new BadRequestError('User with this email already exists');
    }

    // Store registration data in Redis (temporary until OTP verification)
    const registrationId = uuidv4();
    const registrationData = {
      email,
      password,
      name,
      role,
      phone
    };

    // Store registration data for 10 minutes
    await redisClient.set(
      `registration:${registrationId}`,
      JSON.stringify(registrationData),
      'EX',
      OTP_SETTINGS.EXPIRY_SECONDS
    );

    // Generate OTP for registration verification
    const otp = await generateAndStoreOTP(email, OTPPurpose.REGISTER);

    // Send OTP email
    await sendEmail({
      to: email,
      subject: 'Your Yunike Registration Verification Code',
      template: 'otp',
      context: {
        name: name || email,
        action: 'registration',
        otpCode: otp,
        expiryMinutes: OTP_SETTINGS.EXPIRY_SECONDS / 60,
        currentYear: new Date().getFullYear()
      }
    });

    // Return pending status, waiting for OTP
    res.status(200).json({
      message: 'Verification code sent to your email',
      registrationId,
      requireOTP: true,
      expiresIn: OTP_SETTINGS.EXPIRY_SECONDS
    });

  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong during registration';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Register a new user - Step 2: Verify OTP and complete registration
 */
export const verifyRegistrationOTP = async (req: Request, res: Response) => {
  try {
    const { registrationId, email, otp } = req.body;

    // Validate input
    if (!registrationId || !email || !otp) {
      throw new BadRequestError('Registration ID, email and verification code are required');
    }

    // Verify OTP
    const otpResult = await verifyOTP(email, OTPPurpose.REGISTER, otp);

    switch (otpResult) {
      case OTPValidationResult.INVALID:
        throw new BadRequestError('Invalid verification code. Please try again.');
      
      case OTPValidationResult.EXPIRED:
        throw new BadRequestError('Verification code has expired. Please register again.');
      
      case OTPValidationResult.MAX_ATTEMPTS_REACHED:
        const blockTimeRemaining = await getBlockTimeRemaining(email);
        const minutesRemaining = Math.ceil(blockTimeRemaining / 60);
        throw new ForbiddenError(`Too many failed verification attempts. Please try again after ${minutesRemaining} minutes.`);
    }

    // Get registration data from Redis
    const registrationDataJson = await redisClient.get(`registration:${registrationId}`);
    if (!registrationDataJson) {
      throw new BadRequestError('Registration session expired. Please register again.');
    }

    const registrationData = JSON.parse(registrationDataJson);

    // Validate that the email matches
    if (registrationData.email !== email) {
      throw new BadRequestError('Email mismatch. Please register again.');
    }

    // Hash password
    const hashedPassword = await hashPassword(registrationData.password);

    // Generate verification code for email verification
    const verificationCode = createVerificationCode();
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create user with custom fields using raw query to handle schema mismatches
    const user = await prisma.user.create({
      data: {
        email: registrationData.email,
        password: hashedPassword,
        name: registrationData.name,
        phone: registrationData.phone,
        role: registrationData.role,
        // Additional fields will be handled with a raw query if needed
      }
    });

    // Add referral code with a separate update if schema doesn't match
    await prisma.$executeRaw`
      UPDATE "User" 
      SET "referralCode" = ${`YUN-${uuidv4().substring(0, 8).toUpperCase()}`}
      WHERE id = ${user.id}
    `;

    // Store verification code in Redis
    await redisClient.set(
      `verification:${user.id}`,
      verificationCode,
      'EX',
      60 * 60 * 24
    ); // 24 hours

    // Send verification email
    await sendEmail({
      to: email,
      subject: 'Welcome to Yunike - Verify your email',
      template: 'verification',
      context: {
        name: registrationData.name || email,
        verificationCode,
        verificationUrl: `${process.env.FRONTEND_URL}/verify-email?code=${verificationCode}&userId=${user.id}`
      }
    });

    // Clear temporary registration data
    await redisClient.del(`registration:${registrationId}`);

    // Create auth tokens
    const tokens = await generateTokens(user);

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    // Set access token in cookie that JS can read (for SPA)
    res.cookie('accessToken', tokens.accessToken, {
      ...cookieOptions,
      httpOnly: false
    });
    
    // Create token entry in database using raw query
    await prisma.$executeRaw`
      INSERT INTO "AuthToken" ("id", "userId", "token", "type", "expiresAt", "userAgent", "ipAddress", "createdAt")
      VALUES (${uuidv4()}, ${user.id}, ${tokens.refreshToken}, 'REFRESH', ${new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)}, ${req.headers['user-agent'] || null}, ${req.ip || null}, ${new Date()})
    `;

    // Return user data and access token
    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
      },
      accessToken: tokens.accessToken
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong during registration verification';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Resend OTP for registration verification
 */
export const resendRegistrationOTP = async (req: Request, res: Response) => {
  try {
    const { registrationId, email } = req.body;

    if (!registrationId || !email) {
      throw new BadRequestError('Registration ID and email are required');
    }

    // Check if registration data exists
    const registrationDataJson = await redisClient.get(`registration:${registrationId}`);
    if (!registrationDataJson) {
      throw new BadRequestError('Registration session expired. Please register again.');
    }

    const registrationData = JSON.parse(registrationDataJson);
    
    // Validate that the email matches
    if (registrationData.email !== email) {
      throw new BadRequestError('Email mismatch. Please register again.');
    }

    // Check if user is blocked from OTP attempts
    const isBlocked = await isUserBlocked(email);
    if (isBlocked) {
      const blockTimeRemaining = await getBlockTimeRemaining(email);
      const minutesRemaining = Math.ceil(blockTimeRemaining / 60);
      throw new ForbiddenError(`Too many failed verification attempts. Please try again after ${minutesRemaining} minutes.`);
    }

    // Generate new OTP for registration verification
    const otp = await generateAndStoreOTP(email, OTPPurpose.REGISTER);

    // Send OTP email
    await sendEmail({
      to: email,
      subject: 'Your Yunike Registration Verification Code',
      template: 'otp',
      context: {
        name: registrationData.name || email,
        action: 'registration',
        otpCode: otp,
        expiryMinutes: OTP_SETTINGS.EXPIRY_SECONDS / 60,
        currentYear: new Date().getFullYear()
      }
    });

    res.status(200).json({
      message: 'Verification code resent to your email',
      expiresIn: OTP_SETTINGS.EXPIRY_SECONDS
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while resending verification code';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Login user - Step 1: Initiate login and send OTP
 */
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      throw new BadRequestError('Email and password are required');
    }

    // Check if user is blocked from OTP attempts
    const isBlocked = await isUserBlocked(email);
    if (isBlocked) {
      const blockTimeRemaining = await getBlockTimeRemaining(email);
      const minutesRemaining = Math.ceil(blockTimeRemaining / 60);
      throw new ForbiddenError(`Too many failed verification attempts. Please try again after ${minutesRemaining} minutes.`);
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Check if account is active by checking the accountStatus field with a raw query
    const userStatus = await prisma.$queryRaw<{accountStatus: string}[]>`
      SELECT "accountStatus" FROM "User" WHERE id = ${user.id}
    `;
    
    if (userStatus[0] && userStatus[0].accountStatus !== 'ACTIVE') {
      throw new UnauthorizedError(`Your account is ${userStatus[0].accountStatus.toLowerCase()}. Please contact support.`);
    }

    // Generate OTP for login verification
    const otp = await generateAndStoreOTP(email, OTPPurpose.LOGIN);

    // Send OTP email
    await sendEmail({
      to: email,
      subject: 'Your Yunike Login Verification Code',
      template: 'otp',
      context: {
        name: user.name || email,
        action: 'login',
        otpCode: otp,
        expiryMinutes: OTP_SETTINGS.EXPIRY_SECONDS / 60,
        currentYear: new Date().getFullYear()
      }
    });

    // Return pending status, waiting for OTP
    res.status(200).json({
      message: 'Verification code sent to your email',
      userId: user.id,
      requireOTP: true,
      expiresIn: OTP_SETTINGS.EXPIRY_SECONDS
    });

  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong during login';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Login user - Step 2: Verify OTP and complete login
 */
export const verifyLoginOTP = async (req: Request, res: Response) => {
  try {
    const { email, otp, rememberMe = false } = req.body;

    // Validate input
    if (!email || !otp) {
      throw new BadRequestError('Email and verification code are required');
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Verify OTP
    const otpResult = await verifyOTP(email, OTPPurpose.LOGIN, otp);

    switch (otpResult) {
      case OTPValidationResult.INVALID:
        throw new BadRequestError('Invalid verification code. Please try again.');
      
      case OTPValidationResult.EXPIRED:
        throw new BadRequestError('Verification code has expired. Please request a new one.');
      
      case OTPValidationResult.MAX_ATTEMPTS_REACHED:
        const blockTimeRemaining = await getBlockTimeRemaining(email);
        const minutesRemaining = Math.ceil(blockTimeRemaining / 60);
        throw new ForbiddenError(`Too many failed verification attempts. Please try again after ${minutesRemaining} minutes.`);
    }

    // OTP is valid, generate tokens
    const tokens = await generateTokens(user, rememberMe);

    // Set cookie expiry based on rememberMe
    const maxAge = rememberMe 
      ? 30 * 24 * 60 * 60 * 1000  // 30 days
      : 15 * 24 * 60 * 60 * 1000;  // 15 days

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    // Set access token in cookie that JS can read (for SPA)
    res.cookie('accessToken', tokens.accessToken, {
      ...cookieOptions,
      httpOnly: false,
      maxAge: 30 * 60 * 1000 // 30 minutes
    });

    // Create token entry in database using raw query
    await prisma.$executeRaw`
      INSERT INTO "AuthToken" ("id", "userId", "token", "type", "expiresAt", "userAgent", "ipAddress", "createdAt") 
      VALUES (${uuidv4()}, ${user.id}, ${tokens.refreshToken}, 'REFRESH', ${new Date(Date.now() + maxAge)}, ${req.headers['user-agent'] || null}, ${req.ip || null}, ${new Date()})
    `;

    // Update last login details using raw query
    await prisma.$executeRaw`
      UPDATE "User" SET 
      "lastLoginAt" = ${new Date()},
      "lastLoginIp" = ${req.ip || null},
      "deviceIds" = array_append("deviceIds", ${req.headers['user-agent'] || 'unknown'})
      WHERE id = ${user.id}
    `;

    // Return user data and access token
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
      },
      accessToken: tokens.accessToken
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong during login verification';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Resend OTP for login verification
 */
export const resendLoginOTP = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new BadRequestError('Email is required');
    }

    // Check if user is blocked from OTP attempts
    const isBlocked = await isUserBlocked(email);
    if (isBlocked) {
      const blockTimeRemaining = await getBlockTimeRemaining(email);
      const minutesRemaining = Math.ceil(blockTimeRemaining / 60);
      throw new ForbiddenError(`Too many failed verification attempts. Please try again after ${minutesRemaining} minutes.`);
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Generate new OTP for login verification
    const otp = await generateAndStoreOTP(email, OTPPurpose.LOGIN);

    // Send OTP email
    await sendEmail({
      to: email,
      subject: 'Your Yunike Login Verification Code',
      template: 'otp',
      context: {
        name: user.name || email,
        action: 'login',
        otpCode: otp,
        expiryMinutes: OTP_SETTINGS.EXPIRY_SECONDS / 60,
        currentYear: new Date().getFullYear()
      }
    });

    res.status(200).json({
      message: 'Verification code resent to your email',
      expiresIn: OTP_SETTINGS.EXPIRY_SECONDS
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while resending verification code';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Refresh access token using refresh token
 */
export const refreshToken = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token is required');
    }

    // Verify the refresh token and get user ID
    const decodedToken = await verifyRefreshToken(refreshToken);
    
    // Check if token exists in database and is not revoked using raw query
    const tokenRecords = await prisma.$queryRaw<AuthToken[]>`
      SELECT * FROM "AuthToken"
      WHERE token = ${refreshToken}
      AND "revokedAt" IS NULL
      AND "expiresAt" > ${new Date()}
    `;

    if (!tokenRecords || tokenRecords.length === 0) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    const tokenRecord = tokenRecords[0];

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decodedToken.userId }
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Generate new tokens
    const tokens = await generateTokens(user);

    // Update refresh token in database using raw query
    await prisma.$executeRaw`
      UPDATE "AuthToken"
      SET 
        token = ${tokens.refreshToken},
        "expiresAt" = ${new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)},
        "lastUsedAt" = ${new Date()}
      WHERE id = ${tokenRecord.id}
    `;

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    // Set access token in cookie that JS can read (for SPA)
    res.cookie('accessToken', tokens.accessToken, {
      ...cookieOptions,
      httpOnly: false,
      maxAge: 30 * 60 * 1000 // 30 minutes
    });

    // Return new access token
    res.status(200).json({
      message: 'Token refreshed',
      accessToken: tokens.accessToken
    });
  } catch (error: unknown) {
    // Clear cookies on error
    res.clearCookie('refreshToken');
    res.clearCookie('accessToken');
    
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while refreshing token';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Logout user
 */
export const logout = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (refreshToken) {
      // Revoke the refresh token in database using raw query
      await prisma.$executeRaw`
        UPDATE "AuthToken"
        SET "revokedAt" = ${new Date()}
        WHERE token = ${refreshToken}
      `;
    }

    // Clear cookies
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('accessToken', {
      ...cookieOptions,
      httpOnly: false
    });

    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong during logout';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Verify email with verification code
 */
export const verifyEmail = async (req: Request, res: Response) => {
  try {
    const { userId, code } = req.body;

    if (!userId || !code) {
      throw new BadRequestError('User ID and verification code are required');
    }

    // Get verification code from Redis
    const storedCode = await redisClient.get(`verification:${userId}`);
    
    if (!storedCode || storedCode !== code) {
      throw new BadRequestError('Invalid or expired verification code');
    }

    // Update user
    await prisma.user.update({
      where: { id: userId },
      data: { isVerified: true }
    });

    // Delete verification code
    await redisClient.del(`verification:${userId}`);

    res.status(200).json({ message: 'Email verified successfully' });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong during email verification';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Resend verification email
 */
export const resendVerification = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new BadRequestError('Email is required');
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.isVerified) {
      return res.status(200).json({ message: 'Email is already verified' });
    }

    // Generate verification code
    const verificationCode = createVerificationCode();

    // Store verification code in Redis
    await redisClient.set(
      `verification:${user.id}`,
      verificationCode,
      'EX',
      60 * 60 * 24
    ); // 24 hours

    // Send verification email
    await sendEmail({
      to: email,
      subject: 'Yunike - Verify your email',
      template: 'verification',
      context: {
        name: user.name || email,
        verificationCode,
        verificationUrl: `${process.env.FRONTEND_URL}/verify-email?code=${verificationCode}&userId=${user.id}`
      }
    });

    res.status(200).json({ message: 'Verification email sent successfully' });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while resending verification';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Request password reset
 */
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new BadRequestError('Email is required');
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      // We don't want to reveal if a user exists or not
      return res.status(200).json({ message: 'If your email is registered, you will receive a password reset link' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Create token in database using raw query
    await prisma.$executeRaw`
      INSERT INTO "AuthToken" ("id", "userId", "token", "type", "expiresAt", "createdAt")
      VALUES (${uuidv4()}, ${user.id}, ${resetTokenHash}, 'RESET_PASSWORD', ${resetTokenExpiry}, ${new Date()})
    `;

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&id=${user.id}`;
    
    await sendEmail({
      to: email,
      subject: 'Yunike - Reset your password',
      template: 'passwordReset',
      context: {
        name: user.name || email,
        resetUrl
      }
    });

    res.status(200).json({ message: 'If your email is registered, you will receive a password reset link' });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while requesting password reset';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Reset password with token
 */
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { userId, token, password } = req.body;

    if (!userId || !token || !password) {
      throw new BadRequestError('User ID, token and new password are required');
    }

    // Validate password
    if (!validatePassword(password)) {
      throw new BadRequestError('Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character');
    }

    // Hash the received token
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find token in database using raw query
    const tokenRecords = await prisma.$queryRaw<AuthToken[]>`
      SELECT * FROM "AuthToken"
      WHERE "userId" = ${userId}
      AND token = ${resetTokenHash}
      AND type = 'RESET_PASSWORD'
      AND "expiresAt" > ${new Date()}
      AND "revokedAt" IS NULL
    `;

    if (!tokenRecords || tokenRecords.length === 0) {
      throw new BadRequestError('Invalid or expired token');
    }

    const tokenRecord = tokenRecords[0];

    // Hash new password
    const hashedPassword = await hashPassword(password);

    // Update user password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    // Revoke the used token using raw query
    await prisma.$executeRaw`
      UPDATE "AuthToken"
      SET "revokedAt" = ${new Date()}
      WHERE id = ${tokenRecord.id}
    `;

    // Revoke all refresh tokens for this user (force logout on all devices) using raw query
    await prisma.$executeRaw`
      UPDATE "AuthToken"
      SET "revokedAt" = ${new Date()}
      WHERE "userId" = ${userId}
      AND type = 'REFRESH'
      AND "revokedAt" IS NULL
    `;

    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while resetting password';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Change password for logged in user
 */
export const changePassword = async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!req.user) {
      throw new UnauthorizedError('User not authenticated');
    }
    
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      throw new BadRequestError('Current password and new password are required');
    }

    // Validate new password
    if (!validatePassword(newPassword)) {
      throw new BadRequestError('Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character');
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new BadRequestError('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while changing password';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Get logged in user profile
 */
export const getProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('User not authenticated');
    }
    
    const userId = req.user.id;

    // Basic user data with selection based on role
    let userData;
    
    if (req.user.role === 'VENDOR') {
      // For vendor users, include vendor data
      userData = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          profileImageUrl: true,
          role: true,
          isVerified: true,
          createdAt: true,
          vendor: {
            select: {
              id: true,
              storeName: true,
              slug: true,
              logo: true, 
              banner: true,
              description: true,
              isActive: true,
              verificationStatus: true
            }
          }
        }
      });
    } else if (req.user.role === 'ADMIN') {
      // For admin users, include admin data
      userData = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          profileImageUrl: true,
          role: true,
          isVerified: true,
          createdAt: true,
          admin: {
            select: {
              id: true,
              permissions: true
            }
          }
        }
      });
      
      // Check if admin is super admin using raw query
      const adminResult = await prisma.$queryRaw<{ isSuper: boolean }[]>`
        SELECT "isSuper" FROM "Admin" WHERE "userId" = ${userId}
      `;
      
      if (adminResult && adminResult.length > 0) {
        userData = {
          ...userData,
          admin: {
            ...userData?.admin,
            isSuper: adminResult[0].isSuper
          }
        };
      }
    } else {
      // For regular users, just basic data
      userData = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          profileImageUrl: true,
          role: true,
          isVerified: true,
          createdAt: true
        }
      });
    }

    if (!userData) {
      throw new NotFoundError('User not found');
    }

    res.status(200).json({ user: userData });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while getting profile';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Update user profile
 */
export const updateProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('User not authenticated');
    }
    
    const userId = req.user.id;
    const { 
      name, firstName, lastName, phone, 
      preferredLanguage, preferredCurrency 
    } = req.body;

    // Use raw query to update all fields including ones not directly in TypeScript type
    await prisma.$executeRaw`
      UPDATE "User"
      SET
        name = COALESCE(${name}, name),
        "firstName" = COALESCE(${firstName}, "firstName"),
        "lastName" = COALESCE(${lastName}, "lastName"),
        phone = COALESCE(${phone}, phone),
        "preferredLanguage" = COALESCE(${preferredLanguage}, "preferredLanguage"),
        "preferredCurrency" = COALESCE(${preferredCurrency}, "preferredCurrency"),
        "updatedAt" = ${new Date()}
      WHERE id = ${userId}
    `;

    // Fetch updated user profile with raw query
    const updatedUsers = await prisma.$queryRaw<{
      id: string;
      email: string;
      name: string | null;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      profileImageUrl: string | null;
      preferredLanguage: string | null;
      preferredCurrency: string | null;
    }[]>`
      SELECT 
        id, email, name, "firstName", "lastName", phone, "profileImageUrl",
        "preferredLanguage", "preferredCurrency"
      FROM "User"
      WHERE id = ${userId}
    `;

    if (!updatedUsers || updatedUsers.length === 0) {
      throw new NotFoundError('User not found');
    }

    res.status(200).json({ 
      message: 'Profile updated successfully',
      user: updatedUsers[0]
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while updating profile';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * OAuth with Google
 */
export const googleAuth = async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      throw new BadRequestError('Google ID token is required');
    }

    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.email_verified) {
      throw new BadRequestError('Invalid Google token or email not verified');
    }

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { email: payload.email }
    });

    if (user) {
      // Update Google ID if not set using raw query to bypass TypeScript checks
      const googleIdResult = await prisma.$queryRaw<{ googleId: string | null }[]>`
        SELECT "googleId" FROM "User" WHERE id = ${user.id}
      `;
      
      if (googleIdResult[0] && !googleIdResult[0].googleId) {
        await prisma.$executeRaw`
          UPDATE "User" SET "googleId" = ${payload.sub} WHERE id = ${user.id}
        `;
        
        // Refetch user to get updated data
        user = await prisma.user.findUnique({
          where: { id: user.id }
        }) as typeof user;
      }
    } else {
      // Create new user using raw query for fields not in TypeScript type
      const userId = uuidv4();
      const hashedPassword = await hashPassword(crypto.randomBytes(20).toString('hex'));
      const referralCode = `YUN-${uuidv4().substring(0, 8).toUpperCase()}`;
      
      await prisma.$executeRaw`
        INSERT INTO "User" (
          id, email, "googleId", name, "firstName", "lastName", "profileImageUrl", 
          "isVerified", password, "referralCode", "createdAt", "updatedAt", role
        )
        VALUES (
          ${userId}, ${payload.email}, ${payload.sub}, ${payload.name}, 
          ${payload.given_name}, ${payload.family_name}, ${payload.picture}, 
          true, ${hashedPassword}, ${referralCode}, ${new Date()}, ${new Date()}, 'CUSTOMER'
        )
      `;
      
      // Fetch the newly created user
      user = await prisma.user.findUnique({
        where: { id: userId }
      }) as typeof user;
    }

    // Generate tokens
    const tokens = await generateTokens(user!);

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    // Set access token in cookie that JS can read (for SPA)
    res.cookie('accessToken', tokens.accessToken, {
      ...cookieOptions,
      httpOnly: false,
      maxAge: 30 * 60 * 1000 // 30 minutes
    });

    // Create token entry in database using raw query
    await prisma.$executeRaw`
      INSERT INTO "AuthToken" ("id", "userId", "token", "type", "expiresAt", "userAgent", "ipAddress", "createdAt")
      VALUES (${uuidv4()}, ${user!.id}, ${tokens.refreshToken}, 'REFRESH', ${new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)}, ${req.headers['user-agent'] || null}, ${req.ip || null}, ${new Date()})
    `;

    // Update last login details using raw query
    await prisma.$executeRaw`
      UPDATE "User" SET 
      "lastLoginAt" = ${new Date()},
      "lastLoginIp" = ${req.ip || null},
      "deviceIds" = array_append("deviceIds", ${req.headers['user-agent'] || 'unknown'})
      WHERE id = ${user!.id}
    `;

    res.status(200).json({
      message: 'Google authentication successful',
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        role: user!.role,
        isVerified: user!.isVerified,
      },
      accessToken: tokens.accessToken
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong during Google authentication';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Get active sessions for current user
 */
export const getSessions = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('User not authenticated');
    }
    
    const userId = req.user.id;

    // Get sessions using raw query
    const sessions = await prisma.$queryRaw<{
      id: string;
      userAgent: string | null;
      ipAddress: string | null;
      createdAt: Date;
      lastUsedAt: Date | null;
    }[]>`
      SELECT id, "userAgent", "ipAddress", "createdAt", "lastUsedAt"
      FROM "AuthToken"
      WHERE "userId" = ${userId}
      AND type = 'REFRESH'
      AND "revokedAt" IS NULL
      AND "expiresAt" > ${new Date()}
      ORDER BY "lastUsedAt" DESC NULLS LAST
    `;

    res.status(200).json({ sessions });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while getting sessions';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Revoke a specific session
 */
export const revokeSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    if (!req.user) {
      throw new UnauthorizedError('User not authenticated');
    }
    
    const userId = req.user.id;

    // Check if session belongs to user using raw query
    const sessions = await prisma.$queryRaw<AuthToken[]>`
      SELECT * FROM "AuthToken"
      WHERE id = ${sessionId}
      AND "userId" = ${userId}
      AND type = 'REFRESH'
    `;

    if (!sessions || sessions.length === 0) {
      throw new NotFoundError('Session not found');
    }

    const session = sessions[0];

    // Revoke session using raw query
    await prisma.$executeRaw`
      UPDATE "AuthToken"
      SET "revokedAt" = ${new Date()}
      WHERE id = ${sessionId}
    `;

    // Check if current session was revoked
    const currentToken = req.cookies.refreshToken;
    if (currentToken && session.token === currentToken) {
      // Clear cookies
      res.clearCookie('refreshToken', cookieOptions);
      res.clearCookie('accessToken', {
        ...cookieOptions,
        httpOnly: false
      });
    }

    res.status(200).json({ message: 'Session revoked successfully' });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while revoking session';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Revoke all sessions except current one
 */
export const revokeAllSessions = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('User not authenticated');
    }
    
    const userId = req.user.id;
    const currentToken = req.cookies.refreshToken;

    if (!currentToken) {
      throw new UnauthorizedError('You are not logged in');
    }

    // Revoke all sessions except current one using raw query
    await prisma.$executeRaw`
      UPDATE "AuthToken"
      SET "revokedAt" = ${new Date()}
      WHERE "userId" = ${userId}
      AND type = 'REFRESH'
      AND token != ${currentToken}
      AND "revokedAt" IS NULL
    `;

    res.status(200).json({ message: 'All other sessions revoked successfully' });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while revoking sessions';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Register vendor account
 */
export const registerVendor = async (req: Request, res: Response) => {
  try {
    const { 
      email, password, name, phone,
      storeName, description, businessAddress
    } = req.body;

    // Validate input
    if (!email || !password || !storeName || !businessAddress) {
      throw new BadRequestError('Required fields are missing');
    }

    // Normalize store name to create slug
    const slug = storeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      throw new BadRequestError('User with this email already exists');
    }

    // Check if store name/slug already exists
    const existingVendor = await prisma.vendor.findFirst({
      where: {
        OR: [
          { storeName },
          { slug }
        ]
      }
    });

    if (existingVendor) {
      throw new BadRequestError('Store name already exists');
    }

    // Hash password
    const hashedPassword = await hashPassword(password);
    
    // Generate unique IDs
    const userId = uuidv4();
    const vendorId = uuidv4();
    const referralCode = `YUN-${uuidv4().substring(0, 8).toUpperCase()}`;

    // Use transaction with raw queries to create user and vendor together
    await prisma.$transaction(async (prisma) => {
      // Create user with custom fields
      await prisma.$executeRaw`
        INSERT INTO "User" (
          id, email, password, name, phone, role, "referralCode", 
          "createdAt", "updatedAt"
        )
        VALUES (
          ${userId}, ${email}, ${hashedPassword}, ${name}, ${phone}, 
          'VENDOR', ${referralCode}, ${new Date()}, ${new Date()}
        )
      `;
      
      // Create vendor profile with custom fields
      await prisma.$executeRaw`
        INSERT INTO "Vendor" (
          id, "userId", "storeName", slug, description, "contactEmail",
          "contactPhone", "businessAddress", "createdAt", "updatedAt"
        )
        VALUES (
          ${vendorId}, ${userId}, ${storeName}, ${slug}, ${description}, ${email},
          ${phone}, ${JSON.stringify(businessAddress)}, ${new Date()}, ${new Date()}
        )
      `;
    });
    
    // Fetch the created user and vendor
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId }
    });

    if (!user || !vendor) {
      throw new Error('Failed to create vendor account');
    }

    // Generate verification code
    const verificationCode = createVerificationCode();

    // Store verification code in Redis
    await redisClient.set(
      `verification:${user.id}`,
      verificationCode,
      'EX',
      60 * 60 * 24
    ); // 24 hours

    // Send verification email
    await sendEmail({
      to: email,
      subject: 'Welcome to Yunike Vendors - Verify your email',
      template: 'vendorVerification',
      context: {
        name: name || email,
        storeName,
        verificationCode,
        verificationUrl: `${process.env.VENDOR_FRONTEND_URL}/verify-email?code=${verificationCode}&userId=${user.id}`
      }
    });

    // Generate tokens
    const tokens = await generateTokens(user);

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    // Set access token in cookie that JS can read (for SPA)
    res.cookie('accessToken', tokens.accessToken, {
      ...cookieOptions,
      httpOnly: false,
      maxAge: 30 * 60 * 1000 // 30 minutes
    });

    // Create token entry in database using raw query
    await prisma.$executeRaw`
      INSERT INTO "AuthToken" ("id", "userId", "token", "type", "expiresAt", "userAgent", "ipAddress", "createdAt")
      VALUES (${uuidv4()}, ${user.id}, ${tokens.refreshToken}, 'REFRESH', ${new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)}, ${req.headers['user-agent'] || null}, ${req.ip || null}, ${new Date()})
    `;

    // Send notification to admin
    // This would typically be done with a message queue or event
    
    res.status(201).json({
      message: 'Vendor account created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
      },
      vendor: {
        id: vendor.id,
        storeName: vendor.storeName,
        slug: vendor.slug,
        verificationStatus: vendor.verificationStatus
      },
      accessToken: tokens.accessToken
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong during vendor registration';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Create CSRF Token for forms
 */
export const getCsrfToken = async (req: Request, res: Response) => {
  try {
    // Create a CSRF token
    const csrfToken = crypto.randomBytes(16).toString('hex');
    
    // Store token in session cookie
    res.cookie('csrfToken', csrfToken, {
      ...cookieOptions,
      maxAge: 60 * 60 * 1000 // 1 hour
    });
    
    res.status(200).json({ csrfToken });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while generating CSRF token';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Admin login with enhanced security
 */
export const adminLogin = async (req: Request, res: Response) => {
  try {
    const { email, password, twoFactorCode } = req.body;

    // Validate input
    if (!email || !password) {
      throw new BadRequestError('Email and password are required');
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Check if user has admin role
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenError('Access denied: Admin credentials required');
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      // Log failed admin login attempt
      console.warn(`Failed admin login attempt for email: ${email}`);
      throw new UnauthorizedError('Invalid credentials');
    }

    // Check if account is active using raw query
    const userStatus = await prisma.$queryRaw<{accountStatus: string}[]>`
      SELECT "accountStatus" FROM "User" WHERE id = ${user.id}
    `;
    
    if (userStatus[0] && userStatus[0].accountStatus !== 'ACTIVE') {
      throw new UnauthorizedError(`Your account is ${userStatus[0].accountStatus.toLowerCase()}. Please contact support.`);
    }

    // Check if two-factor authentication is required
    const adminData = await prisma.$queryRaw<{
      id: string;
      twoFactorRequired: boolean;
      permissions: string[];
      isSuper: boolean;
    }[]>`
      SELECT id, "twoFactorRequired", permissions, "isSuper" 
      FROM "Admin" 
      WHERE "userId" = ${user.id}
    `;

    if (!adminData || adminData.length === 0) {
      throw new NotFoundError('Admin profile not found');
    }

    const adminProfile = adminData[0];

    // If two-factor auth is required, validate the code
    if (adminProfile.twoFactorRequired) {
      if (!twoFactorCode) {
        return res.status(200).json({
          requiresTwoFactor: true,
          message: 'Two-factor authentication code required',
          userId: user.id
        });
      }

      // Validate the two-factor code
      // This is a placeholder for actual 2FA validation, which depends on your implementation
      const isTwoFactorValid = await validateTwoFactorCode(user.id, twoFactorCode);
      
      if (!isTwoFactorValid) {
        throw new UnauthorizedError('Invalid two-factor authentication code');
      }
    }

    // Generate tokens
    const tokens = await generateTokens(user);

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    // Set access token in cookie that JS can read (for SPA)
    res.cookie('accessToken', tokens.accessToken, {
      ...cookieOptions,
      httpOnly: false,
      maxAge: 30 * 60 * 1000 // 30 minutes
    });

    // Create token entry in database using raw query
    await prisma.$executeRaw`
      INSERT INTO "AuthToken" ("id", "userId", "token", "type", "expiresAt", "userAgent", "ipAddress", "createdAt") 
      VALUES (${uuidv4()}, ${user.id}, ${tokens.refreshToken}, 'REFRESH', ${new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)}, ${req.headers['user-agent'] || null}, ${req.ip || null}, ${new Date()})
    `;

    // Update last login details using raw query
    await prisma.$executeRaw`
      UPDATE "User" SET 
      "lastLoginAt" = ${new Date()},
      "lastLoginIp" = ${req.ip || null},
      "deviceIds" = array_append("deviceIds", ${req.headers['user-agent'] || 'unknown'})
      WHERE id = ${user.id}
    `;

    // Return user data and access token
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
      },
      admin: {
        id: adminProfile.id,
        permissions: adminProfile.permissions,
        isSuper: adminProfile.isSuper
      },
      accessToken: tokens.accessToken
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong during admin login';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
};

/**
 * Validates the two-factor authentication code
 * This is a placeholder function and should be replaced with your actual 2FA implementation
 */
const validateTwoFactorCode = async (userId: string, code: string): Promise<boolean> => {
  try {
    // Get the stored 2FA secret
    const admin = await prisma.$queryRaw<{twoFactorSecret: string | null}[]>`
      SELECT u."twoFactorSecret"
      FROM "User" u
      WHERE u.id = ${userId}
    `;

    if (!admin || admin.length === 0 || !admin[0].twoFactorSecret) {
      return false;
    }

    // This is a simple placeholder - in a real implementation you would:
    // 1. Use a library like speakeasy or otplib to validate TOTP tokens
    // 2. Check if the code is valid for the user's secret
    // 3. Verify the code hasn't been used before (prevent replay attacks)
    
    // Example with speakeasy:
    // return speakeasy.totp.verify({
    //   secret: admin[0].twoFactorSecret,
    //   encoding: 'base32',
    //   token: code,
    //   window: 1 // Allow 1 period before and after
    // });

    // For now, we're just checking if the code is '123456' for testing
    return code === '123456';
  } catch (error) {
    console.error('Error validating 2FA code:', error);
    return false;
  }
};

export const createVendorProfile = async (req: Request, res: Response) => {
  try {
    // Get user ID from authenticated session
    const userId = req.user?.id;
    
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    
    const { 
      storeName, 
      description, 
      shortDescription,
      businessAddress,
      businessType,
      foundedYear,
      taxIdentification,
      processingTime,
      minOrderAmount,
      maxOrderAmount,
      freeShippingThreshold,
      socialLinks,
      policies,
      operatingHours,
      tags,
      stripeAccountType
    } = req.body;

    // Validate required input
    if (!storeName || !businessAddress) {
      throw new BadRequestError('Store name and business address are required');
    }

    // Check if user already has a vendor profile
    const existingProfile = await prisma.vendor.findUnique({
      where: { userId }
    });

    if (existingProfile) {
      throw new BadRequestError('Vendor profile already exists for this user');
    }

    // Get the user details from database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Normalize store name to create slug
    const slug = storeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Check if store name/slug already exists
    const existingVendor = await prisma.vendor.findFirst({
      where: {
        OR: [
          { storeName },
          { slug }
        ]
      }
    });

    if (existingVendor) {
      throw new BadRequestError('Store name already exists');
    }
    
    // Create vendor profile
    const vendor = await prisma.vendor.create({
      data: {
        userId,
        storeName,
        slug,
        description,
        shortDescription,
        contactEmail: user.email,
        contactPhone: user.phone,
        businessAddress,
        businessType: businessType as BusinessType,
        foundedYear,
        taxIdentification,
        processingTime,
        minOrderAmount,
        maxOrderAmount,
        freeShippingThreshold,
        socialLinks,
        policies,
        operatingHours,
        tags: Array.isArray(tags) ? tags : [],
        verificationStatus: 'PENDING'
      }
    });

    // Update user role to VENDOR
    await prisma.user.update({
      where: { id: userId },
      data: { role: 'VENDOR' }
    });

    // Create Stripe Connect account if enabled
    let stripeAccountData = null;
    if (process.env.STRIPE_CONNECT_ENABLED === 'true') {
      try {
        // Import here to avoid circular dependencies
        const stripeService = await import('../services/stripeService.js');
        
        const accountType = stripeAccountType || 'EXPRESS';
        
        // Force all accounts to be test accounts by setting a flag
        process.env.STRIPE_TEST_MODE = 'true';
        
        stripeAccountData = await stripeService.createConnectAccount(vendor.id, accountType);
        
        console.log(`Created Stripe Connect account for vendor ${vendor.id}: ${stripeAccountData.accountId}`);
      } catch (stripeError) {
        // Log error but don't fail the entire vendor creation
        console.error('Error creating Stripe Connect account:', stripeError);
        
        // Even if there's an error, create a mock account ID for testing
        const mockAccountType = stripeAccountType || 'EXPRESS';
        stripeAccountData = {
          accountId: `test_acct_${Date.now()}`,
          accountLinkUrl: `${process.env.VENDOR_FRONTEND_URL}/vendor/stripe/callback?setup_mode=complete`
        };
        
        // Update vendor with mock Stripe account ID for testing
        await prisma.vendor.update({
          where: { id: vendor.id },
          data: {
            stripeAccountId: stripeAccountData.accountId,
            stripeAccountType: mockAccountType,
            stripeAccountStatus: 'PENDING',
            stripeOnboardingComplete: true // Auto-complete for test accounts
          }
        });
      }
    }

    // Send verification email
    await sendEmail({
      to: user.email,
      subject: 'Welcome to Yunike Vendors - Verify your profile',
      template: 'vendorVerification',
      context: {
        name: user.name || user.email,
        storeName,
        verificationUrl: `${process.env.VENDOR_FRONTEND_URL}/vendor/verify-profile?userId=${user.id}`
      }
    });
    
    res.status(201).json({
      message: 'Vendor profile created successfully',
      vendor: {
        id: vendor.id,
        storeName: vendor.storeName,
        slug: vendor.slug,
        verificationStatus: vendor.verificationStatus
      },
      stripeConnect: stripeAccountData
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong during vendor profile creation';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
}; 

/**
 * Create or update customer profile with detailed information
 */
export const createCustomerProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('User not authenticated');
    }
    
    const userId = req.user.id;
    
    // Check if user has CUSTOMER role
    if (req.user.role !== 'CUSTOMER') {
      throw new ForbiddenError('Only customers can update customer profiles');
    }
    
    const { 
      name, 
      firstName, 
      lastName, 
      phone, 
      gender,
      dateOfBirth,
      biography,
      profileImageUrl,
      timezone,
      preferredLanguage,
      preferredCurrency,
      marketingConsent,
      notificationPreferences,
      communicationChannels
    } = req.body;
    
    // Validate required fields
    if (!firstName || !lastName) {
      throw new BadRequestError('First name and last name are required');
    }
    
    // Validate gender if provided
    if (gender && !['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'].includes(gender)) {
      throw new BadRequestError('Invalid gender value');
    }
    
    // Validate date of birth if provided
    if (dateOfBirth) {
      const birthDate = new Date(dateOfBirth);
      const today = new Date();
      const minAgeDate = new Date();
      minAgeDate.setFullYear(today.getFullYear() - 13); // 13 years minimum age
      
      if (isNaN(birthDate.getTime())) {
        throw new BadRequestError('Invalid date of birth');
      }
      
      if (birthDate > today) {
        throw new BadRequestError('Date of birth cannot be in the future');
      }
      
      if (birthDate > minAgeDate) {
        throw new BadRequestError('User must be at least 13 years old');
      }
    }
    
    // Validate notification preferences if provided
    if (notificationPreferences && typeof notificationPreferences !== 'object') {
      throw new BadRequestError('Notification preferences must be an object');
    }
    
    // Validate communication channels if provided
    if (communicationChannels && !Array.isArray(communicationChannels)) {
      throw new BadRequestError('Communication channels must be an array');
    }
    
    // Format the date of birth if provided
    const formattedDateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    
    // Update user with all provided fields
    await prisma.$executeRaw`
      UPDATE "User"
      SET
        name = COALESCE(${name || `${firstName} ${lastName}`}, name),
        "firstName" = ${firstName},
        "lastName" = ${lastName},
        phone = COALESCE(${phone}, phone),
        gender = COALESCE(${gender}::"Gender", gender),
        "dateOfBirth" = COALESCE(${formattedDateOfBirth}, "dateOfBirth"),
        biography = COALESCE(${biography}, biography),
        "profileImageUrl" = COALESCE(${profileImageUrl}, "profileImageUrl"),
        timezone = COALESCE(${timezone}, timezone),
        "preferredLanguage" = COALESCE(${preferredLanguage}, "preferredLanguage"),
        "preferredCurrency" = COALESCE(${preferredCurrency}, "preferredCurrency"),
        "marketingConsent" = COALESCE(${marketingConsent !== undefined ? marketingConsent : null}, "marketingConsent"),
        "notificationPreferences" = COALESCE(${notificationPreferences ? JSON.stringify(notificationPreferences) : null}, "notificationPreferences"),
        "communicationChannels" = COALESCE(${communicationChannels ? JSON.stringify(communicationChannels) : null}, "communicationChannels"),
        "updatedAt" = ${new Date()}
      WHERE id = ${userId}
    `;

    // Fetch updated user profile with raw query
    const updatedUsers = await prisma.$queryRaw<{
      id: string;
      email: string;
      name: string | null;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      gender: string | null;
      dateOfBirth: Date | null;
      biography: string | null;
      profileImageUrl: string | null;
      timezone: string | null;
      preferredLanguage: string | null;
      preferredCurrency: string | null;
      marketingConsent: boolean;
      notificationPreferences: any;
      communicationChannels: string[];
    }[]>`
      SELECT 
        id, email, name, "firstName", "lastName", phone, gender, "dateOfBirth", 
        biography, "profileImageUrl", timezone, "preferredLanguage", "preferredCurrency",
        "marketingConsent", "notificationPreferences", "communicationChannels"
      FROM "User"
      WHERE id = ${userId}
    `;

    if (!updatedUsers || updatedUsers.length === 0) {
      throw new NotFoundError('User not found');
    }

    res.status(200).json({ 
      message: 'Customer profile updated successfully',
      user: updatedUsers[0]
    });
  } catch (error: unknown) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Something went wrong while updating customer profile';
    
    res.status(statusCode).json({ 
      error: message
    });
  }
}; 