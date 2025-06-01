import { logger } from './logger';
import Redis from 'ioredis';

// Create Redis clients for pub/sub
const publisher = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Channel name for events
const EVENTS_CHANNEL = 'app:events';

// Store event handlers
const handlers: Record<string, Array<(data: any) => void>> = {};

// Initialize subscriber
subscriber.subscribe(EVENTS_CHANNEL, (err) => {
  if (err) {
    logger.error(`Failed to subscribe to ${EVENTS_CHANNEL}:`, err);
    return;
  }
  logger.info(`Subscribed to ${EVENTS_CHANNEL} channel`);
});

// Listen for messages
subscriber.on('message', (channel, message) => {
  if (channel === EVENTS_CHANNEL) {
    try {
      const { event, data } = JSON.parse(message);
      
      // Call handlers for this event
      if (handlers[event]) {
        handlers[event].forEach(handler => {
          try {
            handler(data);
          } catch (error) {
            logger.error(`Error in event handler for ${event}:`, error);
          }
        });
      }
    } catch (error) {
      logger.error('Error processing event message:', error);
    }
  }
});

/**
 * Publish an event to the event bus
 * @param event Event name
 * @param data Event data
 */
export const publishEvent = async (event: string, data: any): Promise<void> => {
  try {
    const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    await publisher.publish(EVENTS_CHANNEL, message);
    logger.debug(`Published event ${event}`, { event, data });
  } catch (error) {
    logger.error(`Failed to publish event ${event}:`, error);
    throw error;
  }
};

/**
 * Subscribe to an event
 * @param event Event name
 * @param handler Event handler function
 */
export const subscribeToEvent = (event: string, handler: (data: any) => void): void => {
  if (!handlers[event]) {
    handlers[event] = [];
  }
  handlers[event].push(handler);
  logger.debug(`Subscribed to event ${event}`);
};

/**
 * Unsubscribe from an event
 * @param event Event name
 * @param handler Event handler function to remove
 */
export const unsubscribeFromEvent = (event: string, handler: (data: any) => void): void => {
  if (handlers[event]) {
    handlers[event] = handlers[event].filter(h => h !== handler);
    logger.debug(`Unsubscribed from event ${event}`);
  }
};

// Close connections when the application shuts down
process.on('SIGTERM', () => {
  publisher.quit();
  subscriber.quit();
});

export default {
  publishEvent,
  subscribeToEvent,
  unsubscribeFromEvent
}; 