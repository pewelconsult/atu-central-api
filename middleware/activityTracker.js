// middleware/activityTracker.js
const Activity = require('../models/Activity');

// Middleware to automatically track certain activities
const trackActivity = (type, actionGenerator, descriptionGenerator, points = 0) => {
  return async (req, res, next) => {
    // Store the original res.json function
    const originalJson = res.json.bind(res);

    // Override res.json to track activity after successful response
    res.json = function(data) {
      // Only track if the response indicates success
      if (data && data.success) {
        const userId = req.user?._id;
        
        if (userId) {
          // Generate action and description based on request data
          const action = typeof actionGenerator === 'function' ? actionGenerator(req, data) : actionGenerator;
          const description = typeof descriptionGenerator === 'function' ? descriptionGenerator(req, data) : descriptionGenerator;
          
          // Create activity asynchronously (don't wait for it)
          Activity.createActivity({
            user: userId,
            type,
            action,
            description,
            metadata: {
              ipAddress: req.ip,
              userAgent: req.get('user-agent')
            },
            visibility: 'public',
            points
          }).catch(err => {
            console.error('Failed to track activity:', err);
          });
        }
      }
      
      // Call the original res.json
      return originalJson(data);
    };

    next();
  };
};

module.exports = { trackActivity };