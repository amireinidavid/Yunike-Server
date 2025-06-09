import express from 'express';
import cartController, { addItemToCart, clearCart, getCart, initializeCart, removeCartItem, updateCartItem, validateCart } from '../controllers/cartController';
import { authenticate, optionalAuth } from '../middleware/auth';

const router = express.Router();

/**
 * @swagger
 * /cart:
 *   post:
 *     summary: Initialize a new cart or get existing one
 *     description: Creates a new cart for guest or authenticated user, or returns an existing one
 *     tags: [Cart]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               guestId:
 *                 type: string
 *                 description: Optional guest ID for guest carts
 *     responses:
 *       201:
 *         description: Cart initialized successfully
 *       400:
 *         description: Invalid input
 */
router.post('/initialize', optionalAuth, initializeCart);

/**
 * @swagger
 * /cart/{cartId}:
 *   get:
 *     summary: Get cart by ID
 *     description: Returns cart details including items, prices, and promotions
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cart details
 *       404:
 *         description: Cart not found
 */
router.get('/:cartId', optionalAuth, getCart);

/**
 * @swagger
 * /cart/user:
 *   get:
 *     summary: Get cart for authenticated user
 *     description: Returns the active cart for the current authenticated user
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart details
 *       401:
 *         description: Unauthorized
 */
router.get('/user', authenticate, (req: any, res: any) => {
  // Pass through to getCart with userId from auth
  req.params = {};
  getCart(req, res);
});

/**
 * @swagger
 * /cart/guest/{guestId}:
 *   get:
 *     summary: Get cart for guest
 *     description: Returns the active cart for a guest user
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: guestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cart details
 *       404:
 *         description: Cart not found
 */
router.get('/guest/:guestId', getCart);

/**
 * @swagger
 * /cart/{cartId}/items:
 *   post:
 *     summary: Add item to cart
 *     description: Adds a product to the cart
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *               - quantity
 *             properties:
 *               productId:
 *                 type: string
 *               variantId:
 *                 type: string
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Item added to cart
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Cart not found
 */
router.post('/:cartId/items', optionalAuth, addItemToCart);

/**
 * @swagger
 * /cart/{cartId}/items/{itemId}:
 *   put:
 *     summary: Update cart item
 *     description: Updates the quantity of an item in the cart
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 0
 *               guestId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item updated
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Cart or item not found
 */
router.put('/:cartId/items/:itemId', optionalAuth, updateCartItem);

/**
 * @swagger
 * /cart/{cartId}/items/{itemId}:
 *   delete:
 *     summary: Remove item from cart
 *     description: Removes an item from the cart
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Item removed
 *       404:
 *         description: Cart or item not found
 */
router.delete('/:cartId/items/:itemId', optionalAuth, removeCartItem);

/**
 * @swagger
 * /cart/{cartId}/clear:
 *   post:
 *     summary: Clear cart
 *     description: Removes all items from the cart
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cart cleared
 *       404:
 *         description: Cart not found
 */
router.post('/:cartId/clear', optionalAuth, clearCart);

/**
 * @swagger
 * /cart/{cartId}/promo:
 *   post:
 *     summary: Apply promo code
 *     description: Applies a promotion code to the cart
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - promoCode
 *             properties:
 *               promoCode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Promo code applied
 *       400:
 *         description: Invalid promo code
 *       404:
 *         description: Cart not found
 */
// router.post('/:cartId/promo', optionalAuth, cartController.applyPromoCode);

/**
 * @swagger
 * /cart/{cartId}/promo:
 *   delete:
 *     summary: Remove promo code
 *     description: Removes the promotion code from the cart
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Promo code removed
 *       404:
 *         description: Cart not found
 */
// router.delete('/:cartId/promo', optionalAuth, cartController.removePromoCode);

/**
 * @swagger
 * /cart/{cartId}/validate:
 *   get:
 *     summary: Validate cart
 *     description: Validates cart items and promotions before checkout
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: cartId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cart validation results
 *       404:
 *         description: Cart not found
 */
router.get('/:cartId/validate', optionalAuth, validateCart);

export default router; 