import { Kafka, Producer, Consumer, KafkaMessage } from 'kafkajs';
import { logger } from '../utils/logger';
import { realtimeService } from './realtimeService';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from './emailService';

const prisma = new PrismaClient();

// Kafka topics
export enum KafkaTopic {
  INVENTORY_UPDATED = 'inventory-updated',
  INVENTORY_LOW = 'inventory-low',
  ORDER_CREATED = 'order-created',
  ORDER_UPDATED = 'order-updated',
  PRODUCT_CREATED = 'product-created',
  PRODUCT_UPDATED = 'product-updated',
  PRODUCT_DELETED = 'product-deleted'
}

// Event types
export interface InventoryEvent {
  productId: string;
  vendorId: string;
  quantity: number;
  previousQuantity: number;
  orderId?: string;
  reason?: string;
  timestamp: string;
  lowStockThreshold?: number;
}

export interface OrderEvent {
  orderId: string;
  vendorId: string;
  userId: string;
  orderItems: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    price: number;
  }>;
  totalAmount: number;
  status: string;
  timestamp: string;
}

export interface ProductEvent {
  productId: string;
  vendorId: string;
  name: string;
  action: 'created' | 'updated' | 'deleted';
  timestamp: string;
}

class KafkaService {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Map<string, Consumer> = new Map();
  private isProducerConnected = false;
  private isInitialized = false;
  
  constructor() {
    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    
    this.kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || 'yunike-marketplace',
      brokers,
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });
  }
  
  /**
   * Initialize Kafka producer and consumers
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      // Initialize producer
      this.producer = this.kafka.producer();
      await this.producer.connect();
      this.isProducerConnected = true;
      logger.info('Kafka producer connected');
      
      // Initialize consumers
      await this.setupConsumers();
      
      this.isInitialized = true;
      logger.info('Kafka service initialized');
    } catch (error) {
      logger.error('Failed to initialize Kafka service:', error);
      // Don't throw, allow the app to continue without Kafka
      // In production, you might want to implement a retry mechanism
    }
  }
  
  /**
   * Set up Kafka consumers for various topics
   */
  private async setupConsumers(): Promise<void> {
    try {
      // Inventory updated consumer
      const inventoryConsumer = this.kafka.consumer({ 
        groupId: 'inventory-group',
        sessionTimeout: 30000
      });
      
      await inventoryConsumer.connect();
      await inventoryConsumer.subscribe({ topic: KafkaTopic.INVENTORY_UPDATED, fromBeginning: false });
      await inventoryConsumer.subscribe({ topic: KafkaTopic.INVENTORY_LOW, fromBeginning: false });
      
      await inventoryConsumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            if (!message.value) return;
            
            const event = JSON.parse(message.value.toString()) as InventoryEvent;
            logger.info(`Processing ${topic} event for product ${event.productId}`);
            
            // Update product in database (just to be sure)
            const product = await prisma.product.findUnique({
              where: { id: event.productId },
              include: { vendor: true }
            });
            
            if (!product) {
              logger.warn(`Product ${event.productId} not found for inventory event`);
              return;
            }
            
            // Handle different topics
            switch (topic) {
              case KafkaTopic.INVENTORY_UPDATED:
                // Send real-time notification to vendor
                realtimeService.notifyInventoryUpdate(event.vendorId, {
                  id: product.id,
                  name: product.name,
                  inventory: event.quantity,
                  previousInventory: event.previousQuantity,
                  reason: event.reason || 'Manual update',
                  timestamp: event.timestamp
                });
                break;
                
              case KafkaTopic.INVENTORY_LOW:
                // Send real-time notification to vendor
                realtimeService.notifyLowInventory(event.vendorId, {
                  id: product.id,
                  name: product.name,
                  inventory: event.quantity,
                  lowStockThreshold: event.lowStockThreshold,
                  timestamp: event.timestamp
                });
                
                // Also send email notification
                if (product.vendor?.contactEmail) {
                  await sendEmail({
                    to: product.vendor.contactEmail,
                    subject: `Low Inventory Alert: ${product.name}`,
                    template: 'low-inventory-alert',
                    context: {
                      vendorName: product.vendor.storeName,
                      productName: product.name,
                      productId: product.id,
                      currentStock: event.quantity,
                      threshold: event.lowStockThreshold,
                      dashboardUrl: `${process.env.VENDOR_FRONTEND_URL}/dashboard/products/${product.id}`
                    }
                  });
                }
                break;
            }
          } catch (error) {
            logger.error('Error processing inventory event:', error);
          }
        }
      });
      
      this.consumers.set('inventory', inventoryConsumer);
      logger.info('Inventory consumer initialized');
      
      // Order created consumer
      const orderConsumer = this.kafka.consumer({ 
        groupId: 'order-group',
        sessionTimeout: 30000
      });
      
      await orderConsumer.connect();
      await orderConsumer.subscribe({ topic: KafkaTopic.ORDER_CREATED, fromBeginning: false });
      
      await orderConsumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            if (!message.value) return;
            
            const event = JSON.parse(message.value.toString()) as OrderEvent;
            logger.info(`Processing ${topic} event for order ${event.orderId}`);
            
            // Send real-time notification to vendor
            realtimeService.notifyNewOrder(event.vendorId, {
              id: event.orderId,
              items: event.orderItems,
              totalAmount: event.totalAmount,
              status: event.status,
              timestamp: event.timestamp
            });
            
            // Could also send email notification here
          } catch (error) {
            logger.error('Error processing order event:', error);
          }
        }
      });
      
      this.consumers.set('order', orderConsumer);
      logger.info('Order consumer initialized');
    } catch (error) {
      logger.error('Error setting up Kafka consumers:', error);
      throw error;
    }
  }
  
  /**
   * Publish an inventory update event
   */
  async publishInventoryUpdate(data: InventoryEvent): Promise<void> {
    await this.publishEvent(KafkaTopic.INVENTORY_UPDATED, data);
    
    // Also check if inventory is below threshold and publish low inventory event
    const product = await prisma.product.findUnique({
      where: { id: data.productId },
      select: { lowStockThreshold: true }
    });
    
    const threshold = product?.lowStockThreshold || 5; // Default threshold
    
    if (data.quantity <= threshold) {
      await this.publishEvent(KafkaTopic.INVENTORY_LOW, {
        ...data,
        lowStockThreshold: threshold
      });
    }
  }
  
  /**
   * Publish an order created event
   */
  async publishOrderCreated(data: OrderEvent): Promise<void> {
    await this.publishEvent(KafkaTopic.ORDER_CREATED, data);
  }
  
  /**
   * Publish an order updated event
   */
  async publishOrderUpdated(data: OrderEvent): Promise<void> {
    await this.publishEvent(KafkaTopic.ORDER_UPDATED, data);
  }
  
  /**
   * Generic method to publish an event to a Kafka topic
   */
  private async publishEvent(topic: KafkaTopic, data: any): Promise<void> {
    if (!this.isProducerConnected || !this.producer) {
      logger.warn(`Cannot publish to ${topic}: Kafka producer not connected`);
      return;
    }
    
    try {
      await this.producer.send({
        topic,
        messages: [
          { 
            value: JSON.stringify({
              ...data,
              timestamp: data.timestamp || new Date().toISOString()
            })
          }
        ]
      });
      
      logger.debug(`Published event to ${topic}`);
    } catch (error) {
      logger.error(`Error publishing to ${topic}:`, error);
      // In production, you might want to store failed messages for retry
    }
  }
  
  /**
   * Close all Kafka connections
   */
  async close(): Promise<void> {
    try {
      if (this.producer) {
        await this.producer.disconnect();
        this.isProducerConnected = false;
      }
      
      for (const [name, consumer] of this.consumers.entries()) {
        await consumer.disconnect();
        logger.info(`Kafka consumer ${name} disconnected`);
      }
      
      this.consumers.clear();
      this.isInitialized = false;
      
      logger.info('Kafka service closed');
    } catch (error) {
      logger.error('Error closing Kafka connections:', error);
    }
  }
}

// Export singleton instance
export const kafkaService = new KafkaService();
export default kafkaService; 