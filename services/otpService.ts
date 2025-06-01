import { redisClient } from './redisService';
import { generateOTP, OTPValidationResult, OTP_SETTINGS } from '../utils/auth';

/**
 * OTP purpose types
 */
export enum OTPPurpose {
  LOGIN = 'login',
  REGISTER = 'register',
  PASSWORD_RESET = 'password_reset'
}

// Development mode - if enabled, always return the same OTP for testing
const DEVELOPMENT_MODE = process.env.NODE_ENV === 'development';
const DEVELOPMENT_OTP = '123456';

/**
 * Generate and store OTP for a user
 * @param userId User ID or email
 * @param purpose Purpose of the OTP
 * @returns Generated OTP
 */
export const generateAndStoreOTP = async (
  userId: string,
  purpose: OTPPurpose
): Promise<string> => {
  // In development mode, always use the same OTP for easier testing
  const otp = DEVELOPMENT_MODE ? DEVELOPMENT_OTP : generateOTP(6);
  const key = `otp:${purpose}:${userId}`;
  const attemptsKey = `otp:attempts:${userId}:${purpose}`;
  
  try {
    // Store OTP with expiry
    await redisClient.set(key, otp, 'EX', OTP_SETTINGS.EXPIRY_SECONDS);
    
    // Initialize attempts counter if it doesn't exist
    const attemptsExist = await redisClient.exists(attemptsKey);
    if (!attemptsExist) {
      await redisClient.set(attemptsKey, '0', 'EX', OTP_SETTINGS.EXPIRY_SECONDS * 2);
    }
    
    if (DEVELOPMENT_MODE) {
      console.log(`🔑 DEV MODE: Generated OTP for ${userId} (${purpose}): ${otp}`);
    }
    
    return otp;
  } catch (error) {
    console.error('Error storing OTP in Redis:', error);
    
    // In case of Redis failure, still return the OTP so email can be sent
    // but log a warning that verification might not work
    console.warn('⚠️ OTP generated but not stored in Redis. Verification may fail.');
    
    if (DEVELOPMENT_MODE) {
      console.log(`🔑 DEV MODE FALLBACK: Using development OTP: ${otp}`);
    }
    
    return otp;
  }
};

/**
 * Verify OTP provided by user
 * @param userId User ID or email
 * @param purpose Purpose of the OTP
 * @param providedOTP OTP provided by user
 * @returns Validation result
 */
export const verifyOTP = async (
  userId: string,
  purpose: OTPPurpose,
  providedOTP: string
): Promise<OTPValidationResult> => {
  // In development mode with special OTP, always validate successfully
  if (DEVELOPMENT_MODE && providedOTP === DEVELOPMENT_OTP) {
    console.log(`🔑 DEV MODE: Automatically validating development OTP for ${userId}`);
    return OTPValidationResult.VALID;
  }
  
  const key = `otp:${purpose}:${userId}`;
  const attemptsKey = `otp:attempts:${userId}:${purpose}`;
  const blockedKey = `otp:blocked:${userId}`;
  
  try {
    // Check if user is blocked
    const isBlocked = await redisClient.exists(blockedKey);
    if (isBlocked) {
      return OTPValidationResult.MAX_ATTEMPTS_REACHED;
    }
    
    // Get stored OTP
    const storedOTP = await redisClient.get(key);
    
    // Increment attempts counter
    const attempts = await redisClient.incr(attemptsKey);
    
    // If max attempts reached, block the user
    if (attempts >= OTP_SETTINGS.MAX_ATTEMPTS) {
      await redisClient.set(
        blockedKey, 
        '1', 
        'EX', 
        OTP_SETTINGS.BLOCK_DURATION_SECONDS
      );
      return OTPValidationResult.MAX_ATTEMPTS_REACHED;
    }
    
    // If OTP doesn't exist or has expired
    if (!storedOTP) {
      return OTPValidationResult.EXPIRED;
    }
    
    // Check if OTP matches
    if (storedOTP !== providedOTP) {
      return OTPValidationResult.INVALID;
    }
    
    // If valid, clear the OTP and attempts
    await redisClient.del(key);
    await redisClient.del(attemptsKey);
    
    return OTPValidationResult.VALID;
  } catch (error) {
    console.error('Error verifying OTP:', error);
    
    // In development mode with Redis failure, still allow the correct OTP
    if (DEVELOPMENT_MODE && providedOTP === DEVELOPMENT_OTP) {
      console.log(`🔑 DEV MODE FALLBACK: Allowing development OTP despite Redis error`);
      return OTPValidationResult.VALID;
    }
    
    // For production, default to INVALID on Redis errors
    return OTPValidationResult.INVALID;
  }
};

/**
 * Check if user is blocked from OTP verification
 * @param userId User ID or email
 * @returns Whether user is blocked
 */
export const isUserBlocked = async (userId: string): Promise<boolean> => {
  try {
    const blockedKey = `otp:blocked:${userId}`;
    return await redisClient.exists(blockedKey) === 1;
  } catch (error) {
    console.error('Error checking if user is blocked:', error);
    return false; // Default to not blocked on Redis errors
  }
};

/**
 * Get remaining time for user block in seconds
 * @param userId User ID or email
 * @returns Remaining time in seconds or 0 if not blocked
 */
export const getBlockTimeRemaining = async (userId: string): Promise<number> => {
  try {
    const blockedKey = `otp:blocked:${userId}`;
    return await redisClient.ttl(blockedKey);
  } catch (error) {
    console.error('Error getting block time remaining:', error);
    return 0; // Default to 0 on Redis errors
  }
};

/**
 * Get remaining attempts for OTP verification
 * @param userId User ID or email
 * @param purpose Purpose of the OTP
 * @returns Number of remaining attempts
 */
export const getRemainingAttempts = async (
  userId: string,
  purpose: OTPPurpose
): Promise<number> => {
  try {
    const attemptsKey = `otp:attempts:${userId}:${purpose}`;
    const attempts = await redisClient.get(attemptsKey);
    
    if (!attempts) {
      return OTP_SETTINGS.MAX_ATTEMPTS;
    }
    
    return Math.max(0, OTP_SETTINGS.MAX_ATTEMPTS - parseInt(attempts, 10));
  } catch (error) {
    console.error('Error getting remaining attempts:', error);
    return OTP_SETTINGS.MAX_ATTEMPTS; // Default to max attempts on Redis errors
  }
}; 