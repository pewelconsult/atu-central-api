// routes/forum.routes.js

const express = require('express');
const { Forum, ForumPost, ForumReply } = require('../models/Forum');
const Activity = require('../models/Activity'); // NEW
const { auth, optionalAuth, adminAuth } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');
const { cache } = require('../config/database');

const router = express.Router();

// ==================== SEARCH & FILTER ROUTES (MUST COME FIRST) ====================

// Search posts
router.get('/search', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      q,
      category,
      author,
      tags,
      page = 1,
      limit = 20
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { status: 'published' };

    if (q) {
      query.$or = [
        { title: new RegExp(q, 'i') },
        { content: new RegExp(q, 'i') },
        { tags: new RegExp(q, 'i') }
      ];
    }

    if (category) {
      const forums = await Forum.find({ category });
      query.forum = { $in: forums.map(f => f._id) };
    }

    if (author) {
      query.author = author;
    }

    if (tags) {
      query.tags = { $in: tags.split(',') };
    }

    const posts = await ForumPost.find(query)
      .populate('author', 'firstName lastName profilePicture')
      .populate('forum', 'title category')
      .sort({ lastActivity: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ForumPost.countDocuments(query);

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Search posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search posts'
    });
  }
});

// Get trending posts
router.get('/trending', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // Calculate trending score based on recent activity, views, likes
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const posts = await ForumPost.find({
      status: 'published',
      createdAt: { $gte: oneDayAgo }
    })
    .populate('author', 'firstName lastName profilePicture')
    .populate('forum', 'title category')
    .sort({ views: -1, likeCount: -1, replyCount: -1 })
    .limit(parseInt(limit));

    res.json({
      success: true,
      data: posts
    });

  } catch (error) {
    console.error('Get trending posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trending posts'
    });
  }
});

// ==================== POST ROUTES (SPECIFIC ROUTES) ====================

// Get single post
router.get('/posts/:id', optionalAuth, async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id)
      .populate('forum', 'title category visibility')
      .populate('author', 'firstName lastName profilePicture title graduationYear')
      .populate('approvedBy', 'firstName lastName');

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Increment views
    await post.incrementViews();

    // Track profile view activity if logged in and not viewing own post - NEW
    if (req.user && post.author._id.toString() !== (req.user._id || req.user.id).toString()) {
      try {
        await Activity.createActivity({
          user: req.user._id || req.user.id,
          type: 'profile_view',
          action: `Viewed ${post.author.firstName} ${post.author.lastName}'s post`,
          description: `viewed a forum post`,
          metadata: {
            targetUser: post.author._id,
            targetPost: post._id
          },
          visibility: 'private',
          points: 0
        });
      } catch (activityError) {
        console.error('Failed to create view activity:', activityError);
      }
    }

    res.json({
      success: true,
      data: post
    });

  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch post'
    });
  }
});

// Update post
router.put('/posts/:id', auth, async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user is author or moderator
    const forum = await Forum.findById(post.forum);
    const isModerator = forum.moderators.some(mod => mod.toString() === req.user._id.toString());
    const isAuthor = post.author.toString() === req.user._id.toString();

    if (!isAuthor && !isModerator && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only edit your own posts'
      });
    }

    Object.assign(post, req.body);
    await post.save();

    res.json({
      success: true,
      message: 'Post updated successfully',
      data: post
    });

  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update post'
    });
  }
});

// Delete post
router.delete('/posts/:id', auth, async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check permissions
    const forum = await Forum.findById(post.forum);
    const isModerator = forum.moderators.some(mod => mod.toString() === req.user._id.toString());
    const isAuthor = post.author.toString() === req.user._id.toString();

    if (!isAuthor && !isModerator && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own posts'
      });
    }

    // Delete all replies
    await ForumReply.deleteMany({ post: req.params.id });

    // Update forum stats
    forum.postCount -= 1;
    await forum.save();

    await post.deleteOne();

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete post'
    });
  }
});

// Like/Unlike post
router.post('/posts/:id/like', auth, async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const userId = req.user._id || req.user.id;
    const hasLiked = post.likes.some(like => like.user.toString() === userId.toString());

    if (hasLiked) {
      await post.removeLike(userId);
    } else {
      await post.addLike(userId);
    }

    res.json({
      success: true,
      message: hasLiked ? 'Post unliked' : 'Post liked',
      data: {
        likeCount: post.likeCount,
        isLiked: !hasLiked
      }
    });

  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like/unlike post'
    });
  }
});

// Vote on poll
router.post('/posts/:id/vote', auth, async (req, res) => {
  try {
    const { optionIndex } = req.body;
    const post = await ForumPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    if (post.type !== 'poll') {
      return res.status(400).json({
        success: false,
        message: 'This post is not a poll'
      });
    }

    await post.addPollVote(req.user._id || req.user.id, optionIndex);

    res.json({
      success: true,
      message: 'Vote recorded successfully',
      data: {
        pollOptions: post.pollOptions,
        totalVotes: post.totalPollVotes
      }
    });

  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to record vote'
    });
  }
});

// Create reply
router.post('/posts/:postId/replies', auth, async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    if (post.isLocked) {
      return res.status(403).json({
        success: false,
        message: 'This post is locked'
      });
    }

    const replyData = {
      post: req.params.postId,
      author: req.user._id || req.user.id,
      content: req.body.content,
      parentReply: req.body.parentReply,
      attachments: req.body.attachments
    };

    const reply = new ForumReply(replyData);
    await reply.save();

    // Update post stats
    post.replyCount += 1;
    post.lastReply = reply._id;
    post.lastActivity = new Date();
    await post.save();

    // Create activity for forum comment - NEW
    try {
      await Activity.createActivity({
        user: req.user._id || req.user.id,
        type: 'forum_comment',
        action: `Replied to "${post.title}"`,
        description: `commented on a forum post`,
        metadata: {
          targetPost: post._id,
          targetUser: post.author,
          forumId: post.forum,
          replyId: reply._id
        },
        visibility: 'public',
        points: 5
      });
    } catch (activityError) {
      console.error('Failed to create reply activity:', activityError);
    }

    await reply.populate('author', 'firstName lastName profilePicture title');

    res.status(201).json({
      success: true,
      message: 'Reply created successfully',
      data: reply
    });

  } catch (error) {
    console.error('Create reply error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create reply'
    });
  }
});

// ==================== REPLY ROUTES ====================

// Update reply
router.put('/replies/:id', auth, async (req, res) => {
  try {
    const reply = await ForumReply.findById(req.params.id);

    if (!reply) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    // Check if user is author
    if (reply.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only edit your own replies'
      });
    }

    await reply.editContent(req.body.content);

    res.json({
      success: true,
      message: 'Reply updated successfully',
      data: reply
    });

  } catch (error) {
    console.error('Update reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update reply'
    });
  }
});

// Delete reply
router.delete('/replies/:id', auth, async (req, res) => {
  try {
    const reply = await ForumReply.findById(req.params.id);

    if (!reply) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    // Check permissions
    const post = await ForumPost.findById(reply.post);
    const forum = await Forum.findById(post.forum);
    const isModerator = forum.moderators.some(mod => mod.toString() === req.user._id.toString());
    const isAuthor = reply.author.toString() === req.user._id.toString();

    if (!isAuthor && !isModerator && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own replies'
      });
    }

    // Update post reply count
    post.replyCount -= 1;
    await post.save();

    // Soft delete by changing status
    reply.status = 'deleted';
    reply.content = '[This reply has been deleted]';
    await reply.save();

    res.json({
      success: true,
      message: 'Reply deleted successfully'
    });

  } catch (error) {
    console.error('Delete reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete reply'
    });
  }
});

// Like/Unlike reply
router.post('/replies/:id/like', auth, async (req, res) => {
  try {
    const reply = await ForumReply.findById(req.params.id);

    if (!reply) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    const userId = req.user._id || req.user.id;
    const hasLiked = reply.likes.some(like => like.user.toString() === userId.toString());

    if (hasLiked) {
      await reply.removeLike(userId);
    } else {
      await reply.addLike(userId);
    }

    res.json({
      success: true,
      message: hasLiked ? 'Reply unliked' : 'Reply liked',
      data: {
        likeCount: reply.likeCount,
        isLiked: !hasLiked
      }
    });

  } catch (error) {
    console.error('Like reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like/unlike reply'
    });
  }
});

// ==================== FORUM ROUTES ====================

// Get all forums
router.get('/', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      visibility = 'public'
    } = req.query;

    const skip = (page - 1) * limit;
    let query = {};

    // Filter by visibility based on user status
    if (!req.user) {
      query.visibility = 'public';
    } else if (!req.user.isVerified) {
      query.visibility = { $in: ['public', 'alumni_only'] };
    }

    if (category) query.category = category;

    const forums = await Forum.find(query)
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('moderators', 'firstName lastName profilePicture')
      .populate('lastPost', 'title author createdAt')
      .sort({ isPinned: -1, lastActivity: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Forum.countDocuments(query);

    res.json({
      success: true,
      data: {
        forums,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get forums error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch forums'
    });
  }
});

// Create forum (admin only)
router.post('/', [auth, adminAuth], async (req, res) => {
  try {
    const forumData = {
      ...req.body,
      createdBy: req.user._id || req.user.id,
      moderators: [req.user._id || req.user.id] // Creator is first moderator
    };

    const forum = new Forum(forumData);
    await forum.save();

    await forum.populate('createdBy moderators', 'firstName lastName profilePicture');

    res.status(201).json({
      success: true,
      message: 'Forum created successfully',
      data: forum
    });

  } catch (error) {
    console.error('Create forum error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create forum'
    });
  }
});

// Get single forum (MUST COME AFTER ALL SPECIFIC ROUTES)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const forum = await Forum.findById(req.params.id)
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('moderators', 'firstName lastName profilePicture title');

    if (!forum) {
      return res.status(404).json({
        success: false,
        message: 'Forum not found'
      });
    }

    // Check visibility permissions
    if (forum.visibility === 'private' && (!req.user || !forum.moderators.includes(req.user._id))) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this forum'
      });
    }

    res.json({
      success: true,
      data: forum
    });

  } catch (error) {
    console.error('Get forum error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch forum'
    });
  }
});

// Update forum (admin or moderator)
router.put('/:id', auth, async (req, res) => {
  try {
    const forum = await Forum.findById(req.params.id);

    if (!forum) {
      return res.status(404).json({
        success: false,
        message: 'Forum not found'
      });
    }

    // Check if user is admin or moderator
    const isModerator = forum.moderators.some(mod => mod.toString() === req.user._id.toString());
    if (!req.user.role === 'admin' && !isModerator) {
      return res.status(403).json({
        success: false,
        message: 'Only admins and moderators can update forums'
      });
    }

    Object.assign(forum, req.body);
    await forum.save();

    res.json({
      success: true,
      message: 'Forum updated successfully',
      data: forum
    });

  } catch (error) {
    console.error('Update forum error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update forum'
    });
  }
});

// Delete forum (admin only)
router.delete('/:id', [auth, adminAuth], async (req, res) => {
  try {
    const forum = await Forum.findById(req.params.id);

    if (!forum) {
      return res.status(404).json({
        success: false,
        message: 'Forum not found'
      });
    }

    // Check if forum has posts
    const postCount = await ForumPost.countDocuments({ forum: req.params.id });
    if (postCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete forum with existing posts'
      });
    }

    await forum.deleteOne();

    res.json({
      success: true,
      message: 'Forum deleted successfully'
    });

  } catch (error) {
    console.error('Delete forum error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete forum'
    });
  }
});

// Get forum posts
router.get('/:forumId/posts', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = 'lastActivity',
      type,
      search
    } = req.query;

    const options = { 
      page: parseInt(page), 
      limit: parseInt(limit), 
      sortBy, 
      type 
    };

    const posts = await ForumPost.getForumPosts(req.params.forumId, options);
    const total = await ForumPost.countDocuments({ 
      forum: req.params.forumId, 
      status: 'published' 
    });

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get forum posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts'
    });
  }
});

// Create post
router.post('/:forumId/posts', auth, async (req, res) => {
  try {
    const forum = await Forum.findById(req.params.forumId);

    if (!forum) {
      return res.status(404).json({
        success: false,
        message: 'Forum not found'
      });
    }

    if (!forum.allowPosts) {
      return res.status(403).json({
        success: false,
        message: 'Posts are not allowed in this forum'
      });
    }

    if (forum.isLocked) {
      return res.status(403).json({
        success: false,
        message: 'This forum is locked'
      });
    }

    const postData = {
      ...req.body,
      forum: req.params.forumId,
      author: req.user._id || req.user.id,
      status: forum.requireApproval ? 'pending_approval' : 'published',
      isApproved: !forum.requireApproval
    };

    const post = new ForumPost(postData);
    await post.save();

    // Update forum stats
    if (!forum.requireApproval) {
      forum.postCount += 1;
      forum.lastPost = post._id;
      forum.lastActivity = new Date();
      await forum.save();
    }

    // Create activity for forum post - NEW
    if (!forum.requireApproval) {
      try {
        await Activity.createActivity({
          user: req.user._id || req.user.id,
          type: 'forum_post',
          action: `Created post: ${post.title}`,
          description: `posted <strong>${post.title}</strong> in ${forum.title}`,
          metadata: {
            targetPost: post._id,
            forumId: forum._id,
            forumTitle: forum.title,
            postType: post.type
          },
          visibility: 'public',
          points: 10
        });
      } catch (activityError) {
        console.error('Failed to create post activity:', activityError);
      }
    }

    await post.populate('author', 'firstName lastName profilePicture title graduationYear');

    res.status(201).json({
      success: true,
      message: forum.requireApproval 
        ? 'Post created and pending approval' 
        : 'Post created successfully',
      data: post
    });

  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create post'
    });
  }
});

// Get post replies (duplicate route - keeping for compatibility)
router.get('/posts/:postId/replies', [optionalAuth, validatePagination], async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      includeNested = true
    } = req.query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      includeNested: includeNested === 'true'
    };

    const replies = await ForumReply.getPostReplies(req.params.postId, options);
    
    // Convert to plain objects and get nested replies if requested
    const repliesWithNested = [];
    
    if (options.includeNested) {
      for (let reply of replies) {
        // Convert Mongoose document to plain object
        const replyObj = reply.toObject();
        
        // Get nested replies for this reply
        const nestedReplies = await ForumReply.find({ 
          parentReply: reply._id, 
          status: 'published' 
        })
        .populate('author', 'firstName lastName profilePicture title')
        .sort({ createdAt: 1 });
        
        // Add nested replies to the reply object
        replyObj.nestedReplies = nestedReplies;
        repliesWithNested.push(replyObj);
      }
    } else {
      // If not including nested, just convert to plain objects
      repliesWithNested.push(...replies.map(r => r.toObject()));
    }

    const total = await ForumReply.countDocuments({ 
      post: req.params.postId, 
      status: 'published',
      parentReply: null 
    });

    res.json({
      success: true,
      data: {
        replies: repliesWithNested,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get replies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch replies'
    });
  }
});

module.exports = router;