import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import { logger } from '../utils/logger';

class RealtimeService {
  private io: SocketIOServer | null = null;
  private vendorRooms: Map<string, string[]> = new Map(); // Map of vendorId to socket ids
  
  /**
   * Initialize Socket.IO server
   */
  initialize(server: http.Server): void {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? ['https://yunike.com', 'https://vendor.yunike.com', 'https://admin.yunike.com'] 
          : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'],
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    this.io.on('connection', (socket) => {
      logger.info(`Socket connected: ${socket.id}`);

      // Handle vendor authentication
      socket.on('vendor:auth', (vendorId: string, token: string) => {
        // In production, verify the token before adding to room
        // For now, we'll just add them to the vendor room
        socket.join(`vendor:${vendorId}`);
        
        // Track this socket for the vendor
        if (!this.vendorRooms.has(vendorId)) {
          this.vendorRooms.set(vendorId, []);
        }
        this.vendorRooms.get(vendorId)?.push(socket.id);
        
        logger.info(`Vendor ${vendorId} authenticated on socket ${socket.id}`);
        
        // Send confirmation
        socket.emit('vendor:connected', { vendorId });
      });

      // Handle client authentication
      socket.on('client:auth', (userId: string, token: string) => {
        // In production, verify the token
        socket.join(`user:${userId}`);
        logger.info(`User ${userId} authenticated on socket ${socket.id}`);
        
        // Send confirmation
        socket.emit('client:connected', { userId });
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
        
        // Remove from vendor rooms tracking
        this.vendorRooms.forEach((socketIds, vendorId) => {
          const index = socketIds.indexOf(socket.id);
          if (index !== -1) {
            socketIds.splice(index, 1);
            logger.info(`Removed socket ${socket.id} from vendor ${vendorId}`);
          }
        });
      });
    });

    logger.info('Socket.IO server initialized');
  }

  /**
   * Send inventory update notification to vendor
   */
  notifyInventoryUpdate(vendorId: string, productData: any): void {
    if (!this.io) {
      logger.warn('Socket.IO not initialized');
      return;
    }

    // Send to vendor room
    this.io.to(`vendor:${vendorId}`).emit('inventory:update', {
      type: 'inventory_update',
      data: productData
    });

    logger.info(`Sent inventory update notification to vendor ${vendorId}`);
  }

  /**
   * Send low inventory alert to vendor
   */
  notifyLowInventory(vendorId: string, productData: any): void {
    if (!this.io) {
      logger.warn('Socket.IO not initialized');
      return;
    }

    // Send to vendor room
    this.io.to(`vendor:${vendorId}`).emit('inventory:low', {
      type: 'low_inventory',
      data: productData,
      timestamp: new Date().toISOString()
    });

    logger.info(`Sent low inventory alert to vendor ${vendorId} for product ${productData.id}`);
  }

  /**
   * Send order notification to vendor
   */
  notifyNewOrder(vendorId: string, orderData: any): void {
    if (!this.io) {
      logger.warn('Socket.IO not initialized');
      return;
    }

    // Send to vendor room
    this.io.to(`vendor:${vendorId}`).emit('order:new', {
      type: 'new_order',
      data: orderData
    });

    logger.info(`Sent new order notification to vendor ${vendorId}`);
  }

  /**
   * Get active vendor connections count
   */
  getVendorConnectionsCount(vendorId: string): number {
    return this.vendorRooms.get(vendorId)?.length || 0;
  }

  /**
   * Check if vendor is online
   */
  isVendorOnline(vendorId: string): boolean {
    return this.getVendorConnectionsCount(vendorId) > 0;
  }
}

// Export singleton instance
export const realtimeService = new RealtimeService();
export default realtimeService; 