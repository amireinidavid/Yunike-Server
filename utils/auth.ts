import bcrypt from 'bcryptjs';
import crypto from 'crypto';

/**
 * Hash a password with bcrypt
 * @param password Plain text password
 * @returns Hashed password
 */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(12); // Higher cost for better security
  return bcrypt.hash(password, salt);
};

/**
 * Compare a plain text password with a hashed password
 * @param password Plain text password
 * @param hashedPassword Hashed password
 * @returns Boolean indicating if passwords match
 */
export const comparePassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};

/**
 * Validate password strength
 * At least 8 characters, one uppercase, one lowercase, one number, one special character
 * @param password Password to validate
 * @returns Boolean indicating if password meets requirements
 */
export const validatePassword = (password: string): boolean => {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  return (
    password.length >= minLength &&
    hasUpperCase &&
    hasLowerCase &&
    hasNumbers &&
    hasSpecialChar
  );
};

/**
 * Generate a verification code for email verification
 * @returns 6-digit verification code
 */
export const createVerificationCode = (): string => {
  // Generate a random 6-digit code
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Generate a secure random token
 * @param bytes Number of bytes to generate
 * @returns Random hex string
 */
export const generateSecureToken = (bytes = 32): string => {
  return crypto.randomBytes(bytes).toString('hex');
};

/**
 * Generate a hash from a token
 * @param token Token to hash
 * @returns Hashed token
 */
export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Check if token is expired
 * @param expiryDate Token expiry date
 * @returns Boolean indicating if token is expired
 */
export const isTokenExpired = (expiryDate: Date): boolean => {
  return expiryDate.getTime() < Date.now();
};

/**
 * Generate a random referral code
 * @returns Referral code
 */
export const generateReferralCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusable characters
  let code = '';
  
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return code;
};

/**
 * Parse user agent to get device info
 * @param userAgent User agent string
 * @returns Object with device info
 */
export const parseUserAgent = (userAgent: string) => {
  let device = 'Unknown';
  let browser = 'Unknown';
  let os = 'Unknown';

  if (!userAgent) return { device, browser, os };

  // Simple parsing - would use a library in production
  if (userAgent.match(/Android/i)) {
    device = 'Mobile';
    os = 'Android';
  } else if (userAgent.match(/iPhone|iPad|iPod/i)) {
    device = userAgent.match(/iPhone/i) ? 'Mobile' : 'Tablet';
    os = 'iOS';
  } else if (userAgent.match(/Windows Phone/i)) {
    device = 'Mobile';
    os = 'Windows Phone';
  } else if (userAgent.match(/Windows/i)) {
    device = 'Desktop';
    os = 'Windows';
  } else if (userAgent.match(/Macintosh/i)) {
    device = 'Desktop';
    os = 'MacOS';
  } else if (userAgent.match(/Linux/i)) {
    device = 'Desktop';
    os = 'Linux';
  }

  if (userAgent.match(/Chrome/i) && !userAgent.match(/Edg/i)) {
    browser = 'Chrome';
  } else if (userAgent.match(/Firefox/i)) {
    browser = 'Firefox';
  } else if (userAgent.match(/Safari/i) && !userAgent.match(/Chrome/i)) {
    browser = 'Safari';
  } else if (userAgent.match(/Edg/i)) {
    browser = 'Edge';
  } else if (userAgent.match(/MSIE|Trident/i)) {
    browser = 'Internet Explorer';
  }

  return { device, browser, os };
};

/**
 * Generate a random OTP
 * @param length Length of the OTP (default: 6)
 * @returns OTP code
 */
export const generateOTP = (length = 6): string => {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
};

/**
 * OTP validation result type
 */
export enum OTPValidationResult {
  VALID = 'valid',
  INVALID = 'invalid',
  EXPIRED = 'expired',
  MAX_ATTEMPTS_REACHED = 'max_attempts_reached'
}

/**
 * OTP Settings
 */
export const OTP_SETTINGS = {
  EXPIRY_SECONDS: 10 * 60, // 10 minutes
  MAX_ATTEMPTS: 5,
  BLOCK_DURATION_SECONDS: 60 * 60 // 1 hour
}; 