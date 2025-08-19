// routes/messaging.routes.js
const express = require('express');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Activity = require('../models/Activity'); // NEW
const { auth } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');
const { socketService } = require('../config/socket');
const { upload } = require('../middleware/upload');

const router = express.Router();

// Get user's chats
router.get('/chats', [auth, validatePagination], async (req, res) => {
  try {
    const userId = req.user._id?.toString() || req.user.id;
    const { page = 1, limit = 20, type, includeArchived = false } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found'
      });
    }

    const chats = await Chat.findUserChats(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      type,
      includeArchived: includeArchived === 'true'
    });

    // Get unread message counts for each chat
    const chatsWithUnread = await Promise.all(
      chats.map(async (chat) => {
        try {
          const unreadCount = await Message.getUnreadCount(chat._id, userId);
          
          // Chat is already a plain object from .lean(), no need for toObject()
          return {
            ...chat,
            unreadCount: unreadCount || 0
          };
        } catch (error) {
          console.error(`Error getting unread count for chat ${chat._id}:`, error);
          // Return chat with 0 unread count if error occurs
          return {
            ...chat,
            unreadCount: 0
          };
        }
      })
    );

    res.json({
      success: true,
      data: {
        chats: chatsWithUnread,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalItems: chatsWithUnread.length
        }
      }
    });

  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Create new chat
router.post('/chats', auth, async (req, res) => {
  try {
    const userId = req.user._id?.toString() || req.user.id;
    const { type = 'direct', name, description, participantIds, isPrivate = true } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found'
      });
    }

    let chat;

    if (type === 'direct') {
      if (!participantIds || participantIds.length !== 1) {
        return res.status(400).json({
          success: false,
          message: 'Direct chat requires exactly one other participant'
        });
      }

      chat = await Chat.createDirectChat(userId, participantIds[0]);
    } else {
      if (!name || !participantIds || participantIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Group chat requires name and participants'
        });
      }

      chat = await Chat.createGroupChat(userId, name, participantIds, {
        description,
        isPrivate,
        type
      });
    }

    // Populate participants after creation
    await chat.populate('participants.user', 'firstName lastName profilePicture isOnline lastSeenAt');

    // Notify participants about new chat via Socket.io
    chat.participants.forEach(participant => {
      if (participant.user._id.toString() !== userId.toString()) {
        socketService.sendNotification(participant.user._id.toString(), {
          type: 'new_chat',
          title: 'New Chat',
          message: `${req.user.firstName} added you to a chat`,
          data: { chatId: chat._id }
        });
      }
    });

    res.status(201).json({
      success: true,
      data: { chat }
    });

  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get chat details
router.get('/chats/:chatId', auth, async (req, res) => {
  try {
    const userId = req.user._id?.toString() || req.user.id;
    const { chatId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found'
      });
    }

    const chat = await Chat.findById(chatId)
      .populate('participants.user', 'firstName lastName profilePicture isOnline lastSeenAt')
      .populate('lastMessage');

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Check if user is participant
    const isParticipant = chat.participants.some(
      p => p.user._id.toString() === userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update last seen
    await chat.updateLastSeen(userId);

    res.json({
      success: true,
      data: { chat }
    });

  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get chat messages
router.get('/chats/:chatId/messages', [auth, validatePagination], async (req, res) => {
  try {
    const userId = req.user._id?.toString() || req.user.id;
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found'
      });
    }

    // Verify user is participant
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    const isParticipant = chat.participants.some(
      p => p.user.toString() === userId.toString() || p.user._id?.toString() === userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const messages = await Message.getChatMessages(chatId, parseInt(page), parseInt(limit));
    const total = await Message.countDocuments({ chatId, isDeleted: false });

    res.json({
      success: true,
      data: {
        messages: messages.reverse(), // Reverse to show oldest first
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Send message via REST API (also works via Socket.io)
router.post('/chats/:chatId/messages', auth, async (req, res) => {
  try {
    const userId = req.user._id?.toString() || req.user.id;
    const { chatId } = req.params;
    const { content, type = 'text', replyTo } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found'
      });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    // Verify user is participant
    const chat = await Chat.findById(chatId)
      .populate('participants.user', 'firstName lastName');

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    const isParticipant = chat.participants.some(
      p => p.user.toString() === userId.toString() || p.user._id?.toString() === userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Create message
    const message = new Message({
      chatId,
      sender: userId,
      content: content.trim(),
      type,
      replyTo
    });

    await message.save();
    await message.populate('sender', 'firstName lastName profilePicture');

    // Update chat's last message and activity
    chat.lastMessage = message._id;
    chat.lastActivity = new Date();
    await chat.save();

    // Create activity for message sent - NEW
    if (chat.type === 'direct') {
      try {
        // Get the other participant
        const otherParticipant = chat.participants.find(
          p => p.user._id.toString() !== userId.toString()
        );

        if (otherParticipant) {
          await Activity.createActivity({
            user: userId,
            type: 'message_sent',
            action: `Sent a message to ${otherParticipant.user.firstName} ${otherParticipant.user.lastName}`,
            description: `sent a message`,
            metadata: {
              targetUser: otherParticipant.user._id,
              chatId: chat._id,
              messageType: type,
              ipAddress: req.ip,
              userAgent: req.get('user-agent')
            },
            visibility: 'private', // Messages are private
            points: 2
          });
        }
      } catch (activityError) {
        console.error('Failed to create message activity:', activityError);
      }
    }

    // Send via Socket.io to all chat participants
    socketService.sendChatMessage(chatId, {
      _id: message._id,
      id: message._id,
      chatId,
      content: message.content,
      type,
      sender: {
        _id: userId,
        id: userId,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        profilePicture: req.user.profilePicture
      },
      createdAt: message.createdAt,
      timestamp: message.createdAt,
      replyTo,
      reactions: [],
      readBy: [{ user: userId, readAt: new Date() }]
    });

    res.status(201).json({
      success: true,
      data: { message }
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Upload file for message
router.post('/chats/:chatId/upload', [auth, upload.single('file')], async (req, res) => {
  try {
    const userId = req.user._id?.toString() || req.user.id;
    const { chatId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Verify user is participant
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    const isParticipant = chat.participants.some(
      p => p.user.toString() === userId.toString() || p.user._id?.toString() === userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/misc/${req.file.filename}`;
    
    // Determine message type based on file type
    let messageType = 'file';
    if (req.file.mimetype.startsWith('image/')) {
      messageType = 'image';
    } else if (req.file.mimetype.startsWith('video/')) {
      messageType = 'video';
    } else if (req.file.mimetype.startsWith('audio/')) {
      messageType = 'audio';
    }

    // Create message with file
    const message = new Message({
      chatId,
      sender: userId,
      content: req.file.originalname,
      type: messageType,
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size
    });

    await message.save();
    await message.populate('sender', 'firstName lastName profilePicture');

    // Update chat
    chat.lastMessage = message._id;
    chat.lastActivity = new Date();
    await chat.save();

    // Send via Socket.io
    socketService.sendChatMessage(chatId, {
      _id: message._id,
      id: message._id,
      chatId,
      content: req.file.originalname,
      type: messageType,
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      sender: {
        _id: userId,
        id: userId,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        profilePicture: req.user.profilePicture
      },
      createdAt: message.createdAt,
      timestamp: message.createdAt,
      reactions: [],
      readBy: [{ user: userId, readAt: new Date() }]
    });

    res.status(201).json({
      success: true,
      data: { 
        message,
        fileUrl
      }
    });

  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Add reaction to message
router.post('/messages/:messageId/reactions', auth, async (req, res) => {
  try {
    const userId = req.user._id?.toString() || req.user.id;
    const { messageId } = req.params;
    const { emoji } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found'
      });
    }

    if (!emoji) {
      return res.status(400).json({
        success: false,
        message: 'Emoji is required'
      });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    await message.addReaction(userId, emoji);

    // Notify via Socket.io
    socketService.sendChatMessage(message.chatId.toString(), {
      type: 'reaction_added',
      messageId,
      userId,
      emoji,
      user: {
        firstName: req.user.firstName,
        lastName: req.user.lastName
      }
    });

    res.json({
      success: true,
      message: 'Reaction added',
      data: {
        messageId,
        emoji
      }
    });

  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Mark messages as read
router.put('/chats/:chatId/read', auth, async (req, res) => {
  try {
    const userId = req.user._id?.toString() || req.user.id;
    const { chatId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found'
      });
    }

    // Verify chat exists and user is participant
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    const isParticipant = chat.participants.some(
      p => p.user.toString() === userId.toString() || p.user._id?.toString() === userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Mark all unread messages as read
    const result = await Message.updateMany(
      {
        chatId,
        'readBy.user': { $ne: userId },
        sender: { $ne: userId }
      },
      {
        $push: { readBy: { user: userId, readAt: new Date() } }
      }
    );

    // Update last seen in chat
    await Chat.findByIdAndUpdate(chatId, {
      $set: { 'participants.$[participant].lastSeenAt': new Date() }
    }, {
      arrayFilters: [{ 'participant.user': userId }]
    });

    res.json({
      success: true,
      message: 'Messages marked as read',
      data: {
        modifiedCount: result.modifiedCount
      }
    });

  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete message (soft delete)
router.delete('/messages/:messageId', auth, async (req, res) => {
  try {
    const userId = req.user._id?.toString() || req.user.id;
    const { messageId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found'
      });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is the sender
    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own messages'
      });
    }

    // Soft delete the message
    await message.softDelete();

    // Notify via Socket.io
    socketService.sendChatMessage(message.chatId.toString(), {
      type: 'message_deleted',
      messageId,
      chatId: message.chatId
    });

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Archive/Unarchive chat
router.put('/chats/:chatId/archive', auth, async (req, res) => {
  try {
    const userId = req.user._id?.toString() || req.user.id;
    const { chatId } = req.params;
    const { archive = true } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID not found'
      });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Check if user is participant
    const isParticipant = chat.participants.some(
      p => p.user.toString() === userId.toString() || p.user._id?.toString() === userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update archive status
    chat.isArchived = archive;
    await chat.save();

    res.json({
      success: true,
      message: archive ? 'Chat archived' : 'Chat unarchived',
      data: { 
        chatId,
        isArchived: archive
      }
    });

  } catch (error) {
    console.error('Archive chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to archive chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;