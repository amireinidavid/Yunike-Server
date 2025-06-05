import { Router } from 'express';
import {
  register,
  verifyRegistrationOTP,
  resendRegistrationOTP,
  login,
  verifyLoginOTP,
  resendLoginOTP,
  logout,
  refreshToken,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  getProfile,
  updateProfile,
  googleAuth,
  getSessions,
  revokeSession,
  revokeAllSessions,
  registerVendor,
  getCsrfToken,
  adminLogin,
  createVendorProfile,
  createCustomerProfile
} from '../controllers/authController';
import { authenticate, ipRateLimit } from '../middleware/auth';

const router = Router();

// Authentication - Registration
router.post('/register', ipRateLimit(10, 60 * 60 * 1000), register);
router.post('/register/verify-otp', ipRateLimit(5, 60 * 60 * 1000), verifyRegistrationOTP);
router.post('/register/resend-otp', ipRateLimit(3, 60 * 60 * 1000), resendRegistrationOTP);

// Authentication - Login
router.post('/login', ipRateLimit(20, 60 * 60 * 1000), login);
router.post('/login/verify-otp', ipRateLimit(5, 60 * 60 * 1000), verifyLoginOTP);
router.post('/login/resend-otp', ipRateLimit(3, 60 * 60 * 1000), resendLoginOTP);

router.post('/admin/login', ipRateLimit(10, 60 * 60 * 1000), adminLogin);
router.post('/logout', logout);
router.post('/refresh-token', refreshToken);

// Email verification
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);

// Password management
router.post('/forgot-password', ipRateLimit(5, 60 * 60 * 1000), forgotPassword);
router.post('/reset-password', ipRateLimit(5, 60 * 60 * 1000), resetPassword);
router.post('/change-password', authenticate, changePassword);

// User profile
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);

// OAuth
router.post('/google', googleAuth);

// Session management
router.get('/sessions', authenticate, getSessions);
router.delete('/sessions/:sessionId', authenticate, revokeSession);
router.delete('/sessions', authenticate, revokeAllSessions);

// Vendor registration
router.post('/vendor/create-profile', authenticate, createVendorProfile);
router.post('/customer/create-profile', authenticate, createCustomerProfile);

// CSRF protection
router.get('/csrf-token', getCsrfToken);

export default router;
