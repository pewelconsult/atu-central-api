// config/socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:4200', // Angular dev server
        'http://localhost:5173',
        process.env.FRONTEND_URL
      ].filter(Boolean),
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Authentication middleware for Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Handle different possible field names in the JWT token
      const userId = decoded.userId || decoded.id || decoded._id;
      
      if (!userId) {
        return next(new Error('Authentication error: Invalid token structure'));
      }
      
      const user = await User.findById(userId).select('-password');
      
      if (!user || !user.isActive) {
        return next(new Error('Authentication error: Invalid user'));
      }

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      console.error('Socket authentication error:', error.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // Handle connections
  io.on('connection', (socket) => {
    console.log(`🔌 User connected: ${socket.user.firstName} ${socket.user.lastName} (${socket.userId})`);

    // Join user to their personal room
    socket.join(`user:${socket.userId}`);
    
    // Update user online status
    updateUserOnlineStatus(socket.userId, true);

    // Handle joining chat rooms
    socket.on('join_chat', (data) => {
      const { chatId } = data;
      socket.join(`chat:${chatId}`);
      console.log(`👥 User ${socket.userId} joined chat: ${chatId}`);
      
      // Notify others in the chat
      socket.to(`chat:${chatId}`).emit('user_joined_chat', {
        userId: socket.userId,
        user: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
          profilePicture: socket.user.profilePicture
        }
      });
    });

    // Handle leaving chat rooms
    socket.on('leave_chat', (data) => {
      const { chatId } = data;
      socket.leave(`chat:${chatId}`);
      console.log(`👋 User ${socket.userId} left chat: ${chatId}`);
      
      // Notify others in the chat
      socket.to(`chat:${chatId}`).emit('user_left_chat', {
        userId: socket.userId
      });
    });

    // Handle joining forum discussions
    socket.on('join_forum', (forumId) => {
      socket.join(`forum:${forumId}`);
      console.log(`📋 User ${socket.userId} joined forum: ${forumId}`);
    });

    // Handle leaving forum discussions
    socket.on('leave_forum', (forumId) => {
      socket.leave(`forum:${forumId}`);
      console.log(`📋 User ${socket.userId} left forum: ${forumId}`);
    });

    // Handle sending messages
    socket.on('send_message', async (data) => {
      try {
        const { chatId, content, type = 'text' } = data;
        
        // Save message to database
        const Message = require('../models/Message');
        const message = new Message({
          chatId,
          sender: socket.userId,
          content,
          type
        });
        
        await message.save();
        await message.populate('sender', 'firstName lastName profilePicture');

        // Update chat's last message
        const Chat = require('../models/Chat');
        await Chat.findByIdAndUpdate(chatId, {
          lastMessage: message._id,
          lastActivity: new Date()
        });

        // Emit to all users in the chat
        io.to(`chat:${chatId}`).emit('new_message', {
          id: message._id,
          chatId,
          content,
          type,
          sender: {
            id: socket.userId,
            firstName: socket.user.firstName,
            lastName: socket.user.lastName,
            profilePicture: socket.user.profilePicture
          },
          timestamp: message.createdAt
        });

        console.log(`💬 Message sent in chat ${chatId} by ${socket.userId}`);
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('message_error', { error: 'Failed to send message' });
      }
    });

    // Handle forum posts
    socket.on('forum_post', async (data) => {
      try {
        const { forumId, content, title, type = 'post' } = data;
        
        // Save forum post to database
        const ForumPost = require('../models/Forum').ForumPost;
        const post = new ForumPost({
          forum: forumId,
          author: socket.userId,
          title,
          content,
          type
        });
        
        await post.save();
        await post.populate('author', 'firstName lastName profilePicture');

        // Emit to all users in the forum
        io.to(`forum:${forumId}`).emit('new_forum_post', {
          id: post._id,
          forumId,
          title,
          content,
          type,
          author: {
            id: socket.userId,
            firstName: socket.user.firstName,
            lastName: socket.user.lastName,
            profilePicture: socket.user.profilePicture
          },
          timestamp: post.createdAt
        });

        console.log(`📝 Forum post created in ${forumId} by ${socket.userId}`);
      } catch (error) {
        console.error('Forum post error:', error);
        socket.emit('forum_error', { error: 'Failed to create post' });
      }
    });

    // Handle typing indicators for chats
    socket.on('typing', (data) => {
      const { chatId, isTyping } = data;
      socket.to(`chat:${chatId}`).emit('user_typing', {
        userId: socket.userId,
        chatId,
        isTyping,
        user: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName
        }
      });
    });

    // Alternative typing events for compatibility
    socket.on('typing_start', (chatId) => {
      socket.to(`chat:${chatId}`).emit('user_typing', {
        userId: socket.userId,
        chatId,
        isTyping: true,
        user: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName
        }
      });
    });

    socket.on('typing_stop', (chatId) => {
      socket.to(`chat:${chatId}`).emit('user_typing', {
        userId: socket.userId,
        chatId,
        isTyping: false,
        user: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName
        }
      });
    });

    // Handle real-time notifications
    socket.on('mark_notification_read', (notificationId) => {
      markNotificationAsRead(notificationId, socket.userId);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`🔌 User disconnected: ${socket.user.firstName} ${socket.user.lastName} (${socket.userId})`);
      
      // Update user offline status
      updateUserOnlineStatus(socket.userId, false);
      
      // Leave all rooms
      socket.rooms.forEach(room => {
        if (room.startsWith('chat:')) {
          socket.to(room).emit('user_left_chat', { userId: socket.userId });
        }
      });
    });

    // Handle connection errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  console.log('🚀 Socket.io initialized successfully');
  return io;
};

// Helper functions
const updateUserOnlineStatus = async (userId, isOnline) => {
  try {
    await User.findByIdAndUpdate(userId, {
      isOnline,
      lastSeenAt: new Date()
    });
  } catch (error) {
    console.error('Update online status error:', error);
  }
};

const markNotificationAsRead = async (notificationId, userId) => {
  try {
    const Notification = require('../models/Notification');
    await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { isRead: true, readAt: new Date() }
    );
  } catch (error) {
    console.error('Mark notification read error:', error);
  }
};

// Socket.io service for sending events from other parts of the app
const socketService = {
  // Send notification to a specific user
  sendNotification: (userId, notification) => {
    if (io) {
      io.to(`user:${userId}`).emit('new_notification', notification);
    }
  },

  // Send message to a chat
  sendChatMessage: (chatId, message) => {
    if (io) {
      io.to(`chat:${chatId}`).emit('new_message', message);
    }
  },

  // Send forum update
  sendForumUpdate: (forumId, update) => {
    if (io) {
      io.to(`forum:${forumId}`).emit('forum_update', update);
    }
  },

  // Broadcast to all users
  broadcast: (event, data) => {
    if (io) {
      io.emit(event, data);
    }
  },

  // Send to specific users
  sendToUsers: (userIds, event, data) => {
    if (io) {
      userIds.forEach(userId => {
        io.to(`user:${userId}`).emit(event, data);
      });
    }
  },

  // Get online users count
  getOnlineUsersCount: () => {
    return io ? io.engine.clientsCount : 0;
  },

  // Get users in a specific room
  getUsersInRoom: async (room) => {
    if (!io) return [];
    const sockets = await io.in(room).fetchSockets();
    return sockets.map(socket => ({
      userId: socket.userId,
      user: socket.user
    }));
  }
};

module.exports = {
  initializeSocket,
  socketService,
  getIO: () => io
};