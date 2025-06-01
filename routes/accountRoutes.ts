import express from 'express';
import { 
  getVendorProfile, 
  updateVendorProfile, 
  uploadVendorLogo, 
  uploadVendorBanner,
  uploadVendorCoverImage,
  updateUserProfile,
  uploadProfileImage,
  deleteVendorAccount,
  upload
} from '../controllers/accountController';

import { authenticate } from '../middleware/auth';
import { checkRole } from '../middleware/roleMiddleware';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Vendor profile routes
router.get('/vendor/profile', checkRole(['VENDOR']), getVendorProfile);
router.put('/vendor/profile', checkRole(['VENDOR']), updateVendorProfile);
router.delete('/vendor/account', checkRole(['VENDOR']), deleteVendorAccount);

// Image upload routes (with multer middleware)
router.post('/vendor/logo', checkRole(['VENDOR']), upload.single('logo'), uploadVendorLogo);
router.post('/vendor/banner', checkRole(['VENDOR']), upload.single('banner'), uploadVendorBanner);
router.post('/vendor/cover', checkRole(['VENDOR']), upload.single('cover'), uploadVendorCoverImage);
router.post('/profile/image', upload.single('profileImage'), uploadProfileImage);

// User profile routes (accessible by any authenticated user)
router.put('/profile', updateUserProfile);

export default router; 