import { Router } from 'express';
import { 
  getCustomerProfile,
  updateUserProfile,
  uploadProfileImage,
  getCustomerOrders,
  getOrderDetails,
  getCustomerAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  deleteCustomerAccount
} from '../controllers/customerAccountController';
import { authenticate } from '../middleware/auth';
import { upload } from '../controllers/customerAccountController';

const router = Router();

// Protect all routes with authentication
router.use(authenticate);

// Profile routes
router.get('/profile', getCustomerProfile);
router.put('/profile', updateUserProfile);
router.post('/profile/image', upload.single('image'), uploadProfileImage);
router.delete('/profile', deleteCustomerAccount);

// Order routes
router.get('/orders', getCustomerOrders);
router.get('/orders/:id', getOrderDetails);

// Address routes
router.get('/addresses', getCustomerAddresses);
router.post('/addresses', addAddress);
router.put('/addresses/:id', updateAddress);
router.delete('/addresses/:id', deleteAddress);

// Wishlist routes
router.get('/wishlist', getWishlist);
router.post('/wishlist', addToWishlist);
router.delete('/wishlist/:productId', removeFromWishlist);

export default router;
