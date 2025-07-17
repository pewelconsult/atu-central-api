// app.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

// Import configurations (check if they exist first)
let swaggerConfig;
try {
  swaggerConfig = require('./config/swagger');
} catch (error) {
  console.log('⚠️ Swagger config not found, skipping API documentation');
  swaggerConfig = null;
}

// Import database config
const { connectMongoDB, connectRedis } = require('./config/database');

// Import routes
const apiRoutes = require('./routes/index.routes');

// Check if new routes exist
let notificationRoutes, searchRoutes;
try {
  notificationRoutes = require('./routes/notifications.routes');
} catch (error) {
  console.log('⚠️ Notification routes not found, skipping');
  notificationRoutes = null;
}

try {
  searchRoutes = require('./routes/search.routes');
} catch (error) {
  console.log('⚠️ Search routes not found, skipping');
  searchRoutes = null;
}

const app = express();

// Trust proxy for rate limiting and IP detection
app.set('trust proxy', 1);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5173', // Vite dev server
      'https://atu-alumni.edu.gh',
      process.env.FRONTEND_URL
    ].filter(Boolean);

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Serve static files for uploads (create directory if it doesn't exist)
const uploadsPath = path.join(__dirname, 'uploads');
try {
  const fs = require('fs');
  if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
    console.log('📁 Created uploads directory');
  }
  app.use('/uploads', express.static(uploadsPath));
  console.log('📤 Static file serving enabled for uploads');
} catch (error) {
  console.log('⚠️ Could not set up uploads directory:', error.message);
}

// API Documentation with Swagger (if available)
if (swaggerConfig) {
  app.use('/api-docs', swaggerConfig.serve, swaggerConfig.setup);
  app.get('/docs', (req, res) => {
    res.redirect('/api-docs');
  });
  console.log('📚 API documentation available at /api-docs');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    database: {
      mongodb: 'connected', // You can make this dynamic
      redis: 'connected'
    },
    features: {
      fileUploads: 'enabled',
      notifications: notificationRoutes ? 'enabled' : 'disabled',
      search: searchRoutes ? 'enabled' : 'disabled',
      emailService: process.env.SMTP_HOST ? 'enabled' : 'disabled',
      rateLimiting: process.env.NODE_ENV === 'development' ? 'disabled' : 'enabled',
      apiDocs: swaggerConfig ? 'enabled' : 'disabled'
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'ATU Alumni Database API',
    version: '1.0.0',
    status: 'Running',
    documentation: swaggerConfig ? '/api-docs' : 'Not available',
    health: '/health',
    api: '/api'
  });
});

console.log('📁 Loading API routes...');

// Mount API routes
app.use('/api', apiRoutes);

// Mount optional routes if they exist
if (notificationRoutes) {
  app.use('/api/notifications', notificationRoutes);
  console.log('🔔 Notification routes loaded');
}

if (searchRoutes) {
  app.use('/api/search', searchRoutes);
  console.log('🔍 Search routes loaded');
}

console.log('✅ API routes loaded successfully');

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Global error:', err);
  
  // CORS error
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'CORS error: Origin not allowed'
    });
  }

  // Multer errors (file upload)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File too large. Maximum size is 5MB.'
    });
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      success: false,
      message: 'Too many files. Maximum is 5 files.'
    });
  }

  // MongoDB duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(400).json({
      success: false,
      message: `Duplicate ${field}. This ${field} already exists.`
    });
  }

  // Validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Default server error
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    availableEndpoints: {
      api: '/api',
      documentation: swaggerConfig ? '/api-docs' : 'Not available',
      health: '/health'
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    console.log('🔌 Connecting to databases...');
    
    // Connect to MongoDB
    await connectMongoDB();
    
    // Connect to Redis (if available)
    try {
      await connectRedis();
    } catch (redisError) {
      console.log('⚠️ Redis connection failed, continuing without cache:', redisError.message);
    }
    
    const server = app.listen(PORT, () => {
      console.log(`🚀 ATU Alumni API server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      
      if (swaggerConfig) {
        console.log(`📚 API docs: http://localhost:${PORT}/api-docs`);
      }
      
      console.log(`🔐 Auth endpoints: http://localhost:${PORT}/api/auth`);
      console.log(`👥 Alumni endpoints: http://localhost:${PORT}/api/alumni`);
      console.log(`📅 Event endpoints: http://localhost:${PORT}/api/events`);
      console.log(`💼 Job endpoints: http://localhost:${PORT}/api/jobs`);
      console.log(`📋 Survey endpoints: http://localhost:${PORT}/api/surveys`);
      console.log(`📤 Upload endpoints: http://localhost:${PORT}/api/uploads`);
      
      if (notificationRoutes) {
        console.log(`🔔 Notification endpoints: http://localhost:${PORT}/api/notifications`);
      }
      
      if (searchRoutes) {
        console.log(`🔍 Search endpoints: http://localhost:${PORT}/api/search`);
      }
      
      console.log(`⚙️ Admin endpoints: http://localhost:${PORT}/api/admin`);
      
      // Feature status
      console.log('\n🎯 Feature Status:');
      console.log(`📧 Email Service: ${process.env.SMTP_HOST ? '✅ Configured' : '⚠️ Not configured'}`);
      console.log(`🛡️ Rate Limiting: ${process.env.NODE_ENV === 'development' ? '⚠️ Disabled (Dev)' : '✅ Enabled'}`);
      console.log(`📤 File Uploads: ✅ Enabled`);
      console.log(`🔔 Notifications: ${notificationRoutes ? '✅ Enabled' : '⚠️ Routes not found'}`);
      console.log(`🔍 Advanced Search: ${searchRoutes ? '✅ Enabled' : '⚠️ Routes not found'}`);
      console.log(`📖 API Documentation: ${swaggerConfig ? '✅ Available at /api-docs' : '⚠️ Config not found'}`);
      
      console.log('\n🎉 Server started successfully!');
    });

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      console.log(`\n📴 Received ${signal}. Shutting down gracefully...`);
      
      server.close(() => {
        console.log('✅ HTTP server closed');
        process.exit(0);
      });

      // Force close after 30 seconds
      setTimeout(() => {
        console.log('⚠️ Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();