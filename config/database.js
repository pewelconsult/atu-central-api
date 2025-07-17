const mongoose = require('mongoose');
const { createClient } = require('redis');

// MongoDB connection with updated options for newer versions
const connectMongoDB = async () => {
  try {
    // Updated options for newer MongoDB driver
    const options = {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      family: 4 // Use IPv4, skip trying IPv6
    };

    await mongoose.connect(process.env.MONGODB_URI, options);
    console.log('🍃 Connected to MongoDB');
    
    // Log connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
    });
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.log('💡 Make sure MongoDB is running on your system');
    console.log('💡 You can install MongoDB locally or use MongoDB Atlas (cloud)');
    
    // Don't throw error in development - let server run without DB for now
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
};

// Redis connection with better error handling
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  retry_strategy: (options) => {
    if (options.error && options.error.code === 'ECONNREFUSED') {
      console.error('Redis connection refused');
      return new Error('Redis connection refused');
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      console.error('Redis retry time exhausted');
      return new Error('Redis retry time exhausted');
    }
    if (options.attempt > 10) {
      console.error('Redis connection attempts exceeded');
      return undefined;
    }
    // Reconnect after
    return Math.min(options.attempt * 100, 3000);
  }
});

redis.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redis.on('connect', () => {
  console.log('📡 Connected to Redis');
});

redis.on('ready', () => {
  console.log('📡 Redis client ready');
});

redis.on('reconnecting', () => {
  console.log('📡 Redis client reconnecting');
});

const connectRedis = async () => {
  try {
    await redis.connect();
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message);
    console.log('💡 Make sure Redis is running on your system');
    console.log('💡 You can install Redis locally or use Redis Cloud');
    
    // Don't throw error in development - let server run without Redis for now
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
};

// Enhanced cache helper functions with better error handling
const cache = {
  async get(key) {
    try {
      if (!redis.isReady) {
        console.log('Redis not ready, skipping cache get');
        return null;
      }
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  },
  
  async set(key, value, expirationInSeconds = 3600) {
    try {
      if (!redis.isReady) {
        console.log('Redis not ready, skipping cache set');
        return false;
      }
      await redis.setEx(key, expirationInSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  },
  
  async del(key) {
    try {
      if (!redis.isReady) {
        console.log('Redis not ready, skipping cache delete');
        return false;
      }
      await redis.del(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  },
  
  async flush() {
    try {
      if (!redis.isReady) {
        console.log('Redis not ready, skipping cache flush');
        return false;
      }
      await redis.flushAll();
      return true;
    } catch (error) {
      console.error('Cache flush error:', error);
      return false;
    }
  }
};

module.exports = {
  connectMongoDB,
  connectRedis,
  cache,
  redis
};