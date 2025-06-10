import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';

// Routes
import authRoutes from './routes/authRoutes';
import accountRoutes from './routes/accountRoutes';
import productRoutes from './routes/productRoutes';
import customerAccountRoutes from './routes/customerAccountRoute';
import stripeRoutes from './routes/stripeRoutes';
import checkoutRoutes from './routes/checkoutRoutes';

// Services
import { redisClient } from './services/redisService';
import { realtimeService } from './services/realtimeService';
import { kafkaService } from './services/kafkaService';
import cartRoutes from './routes/cartRoutes';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5001;

// Create HTTP server (needed for Socket.IO)
const server = http.createServer(app);

// Initialize Prisma client
const prisma = new PrismaClient();

// Middleware
// Security headers
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yunike.com', 'https://vendor.yunike.com', 'https://admin.yunike.com'] 
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Request logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Parse JSON requests - increase limit for base64 images
app.use(express.json({ limit: '50mb' }));

// Parse URL-encoded requests - increase limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Parse cookies
app.use(cookieParser());

// Compress responses
app.use(compression());

// Static files
app.use('/static', express.static(path.join(__dirname, 'public')));

// Rate limiting to prevent abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again after 15 minutes',
});

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// Root route - Server status page
app.get('/', (_req: Request, res: Response) => {
  const serverInfo = {
    name: 'Yunike API Server',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: Math.floor(process.uptime()) + ' seconds',
    timestamp: new Date().toISOString()
  };
  
  // Send HTML response
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Yunike Server Status</title>
      <style>
        body {
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f5f5f5;
          color: #333;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .container {
          background: white;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          padding: 2rem;
          width: 90%;
          max-width: 600px;
          text-align: center;
        }
        .status {
          display: inline-block;
          background: #4ade80;
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 9999px;
          font-weight: 600;
          margin-bottom: 1.5rem;
        }
        h1 {
          margin: 0;
          font-size: 2rem;
          margin-bottom: 0.5rem;
          color: #111;
        }
        p {
          margin: 0.5rem 0;
          color: #666;
        }
        .info {
          text-align: left;
          margin-top: 2rem;
          padding: 1rem;
          background: #f9f9f9;
          border-radius: 6px;
        }
        .info p {
          display: flex;
          justify-content: space-between;
          margin: 0.5rem 0;
        }
        .info p span:first-child {
          font-weight: 500;
          color: #333;
        }
        .footer {
          margin-top: 2rem;
          font-size: 0.875rem;
          color: #888;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="status">ONLINE</div>
        <h1>${serverInfo.name}</h1>
        <p>API server is running and ready to accept requests</p>
        
        <div class="info">
          <p><span>Status:</span> <span>✅ Operational</span></p>
          <p><span>Environment:</span> <span>${serverInfo.environment}</span></p>
          <p><span>Version:</span> <span>${serverInfo.version}</span></p>
          <p><span>Uptime:</span> <span>${serverInfo.uptime}</span></p>
          <p><span>Last Updated:</span> <span>${new Date().toLocaleTimeString()}</span></p>
        </div>
        
        <div class="footer">
          <p>For more detailed health information, visit <a href="/health">/health</a></p>
          <p>© ${new Date().getFullYear()} Yunike</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
  // Check Redis connection
  const redisStatus = await redisClient.isHealthy();
  
  // Check database connection
  let dbStatus = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = true;
  } catch (error) {
    console.error('Database health check failed:', error);
  }
  
  const healthy = redisStatus && dbStatus;
  
  res.status(healthy ? 200 : 503).json({ 
    status: healthy ? 'OK' : 'Service Degraded',
    services: {
      database: dbStatus ? 'healthy' : 'unhealthy',
      redis: redisStatus ? 'healthy' : 'unhealthy'
    },
    timestamp: new Date().toISOString() 
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customer', customerAccountRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/checkout', checkoutRoutes);

// Special middleware for Stripe webhook
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Error handling middleware
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error(`Error: ${err.message}`);
  console.error(err.stack);
  
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  res.status(statusCode).json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: 'Resource not found' });
});

// Check services on startup
const checkServices = async () => {
  try {
    // Check Redis connection
    const redisStatus = await redisClient.isHealthy();
    if (redisStatus) {
      console.log('✅ Redis connection verified');
    } else {
      console.error('❌ Redis connection failed - OTP functions may not work properly');
    }
    
    // Check database connection
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('✅ Database connection verified');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
    }
  } catch (error) {
    console.error('Error during service checks:', error);
  }
};

// Initialize Socket.IO
realtimeService.initialize(server);

// Start server
const serverInstance = server.listen(PORT, async () => {
  console.log(`Yunike 🚀 Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`- Server status page: http://localhost:${PORT}`);
  console.log(`- Server health check: http://localhost:${PORT}/health`);
  
  await checkServices();
  
  // Initialize Kafka service (async)
  kafkaService.initialize().then(() => {
    console.log('✅ Kafka service initialized');
  }).catch(error => {
    console.warn('⚠️ Kafka service initialization failed - some messaging features may be unavailable:', error);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  serverInstance.close(async () => {
    console.log('HTTP server closed');
    // Close all services
    await Promise.all([
      prisma.$disconnect(),
      kafkaService.close()
    ]);
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Log to error monitoring service here if needed
  process.exit(1);
});

// Handle promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log to error monitoring service here if needed
});

export { app, prisma };
