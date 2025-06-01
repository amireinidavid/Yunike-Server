/**
 * Redis Connection Check Utility
 * 
 * This script can be run independently to verify if Redis is running and accessible.
 * Run with: node checkRedis.js
 */

const { createClient } = require('redis');

// Redis configuration (use environment variable if available)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function checkRedisConnection() {
  console.log(`Attempting to connect to Redis at ${REDIS_URL}...`);
  
  const client = createClient({
    url: REDIS_URL
  });

  client.on('error', (err) => {
    console.error('Redis connection error:', err);
  });

  try {
    await client.connect();
    
    if (client.isOpen) {
      console.log('✅ Successfully connected to Redis!');
      
      // Test set and get operations
      const testKey = 'redis_test_key';
      const testValue = 'Connection test successful at ' + new Date().toISOString();
      
      await client.set(testKey, testValue);
      console.log('✅ Test key set successfully');
      
      const retrievedValue = await client.get(testKey);
      console.log(`✅ Test key retrieved successfully: ${retrievedValue}`);
      
      await client.del(testKey);
      console.log('✅ Test key deleted successfully');
      
      console.log('\n✅ Redis is running properly and ready for use! ✅\n');
    } else {
      console.error('❌ Failed to open Redis connection');
    }
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    
    console.log('\n⚠️ Troubleshooting Tips ⚠️');
    console.log('1. Make sure Redis server is installed and running:');
    console.log('   - On Windows: Check Redis service or Redis server in Task Manager');
    console.log('   - On Linux/Mac: Run `redis-cli ping` (should return PONG)');
    console.log('2. If using Docker, verify the Redis container is running:');
    console.log('   `docker ps | grep redis`');
    console.log('3. Check your REDIS_URL environment variable if you\'re using a custom configuration');
    console.log('4. Check if Redis port (default 6379) is blocked by firewall\n');
  } finally {
    if (client.isOpen) {
      await client.quit();
      console.log('Redis connection closed');
    }
    process.exit(0);
  }
}

// Run the check
checkRedisConnection(); 