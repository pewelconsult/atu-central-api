// utils/authHelpers.js

const isOwnerOrAdmin = (resource, userId, userRole) => {
  const resourceOwnerId = resource.owner || resource.organizer || resource.postedBy || resource.createdBy;
  return resourceOwnerId?.toString() === userId.toString() || userRole === 'admin';
};

const hasModeratorAccess = (forum, userId, userRole) => {
  return userRole === 'admin' || forum.moderators.some(mod => mod.toString() === userId.toString());
};

module.exports = {
  isOwnerOrAdmin,
  hasModeratorAccess
};