// middleware/rateLimiter.js
// Rate limiting disabled for development

// Create mock middleware that does nothing
const createMockLimiter = (name) => {
  return (req, res, next) => {
    // Just log and continue - no rate limiting
    console.log(`📊 Rate limiter (${name}) - DISABLED for development`);
    next();
  };
};

// Export mock limiters that don't actually limit
const generalLimiter = createMockLimiter('general');
const authLimiter = createMockLimiter('auth');
const apiLimiter = createMockLimiter('api');
const uploadLimiter = createMockLimiter('upload');

console.log('⚠️ RATE LIMITING DISABLED - Development Mode');
console.log('💡 Re-enable rate limiting in production!');

module.exports = {
  generalLimiter,
  authLimiter,
  apiLimiter,
  uploadLimiter
};