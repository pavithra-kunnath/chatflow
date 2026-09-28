const mongoose = require('mongoose');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

/**
 * Creates a new user or retrieves an existing one by username.
 * Automatically marks the user as online upon login/retrieval.
 *
 * @param {Object} userData - { username, avatar }
 * @returns {Promise<Object>} user document
 */
const createOrGetUser = async ({ username, avatar = null }) => {
  const trimmedUsername = username.trim();

  // Check if user already exists (case-insensitive search, exact match)
  let user = await User.findOne({
    username: { $regex: new RegExp(`^${trimmedUsername}$`, 'i') },
  });

  if (user) {
    // Existing user: mark online
    user.isOnline = true;
    if (avatar && !user.avatar) {
      user.avatar = avatar;
    }
    await user.save();
    return user;
  }

  // Create new user
  user = await User.create({
    username: trimmedUsername,
    avatar: avatar || null,
    isOnline: true,
  });

  return user;
};

/**
 * Retrieves all registered users.
 *
 * @returns {Promise<Array>} List of sanitized users
 */
const getAllUsers = async () => {
  const users = await User.find()
    .sort({ username: 1 })
    .select('-__v');
  return users;
};

/**
 * Retrieves a user by their MongoDB ObjectId.
 *
 * @param {string} id - 24-character hexadecimal ObjectId
 * @returns {Promise<Object>} User document
 */
const getUserById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid user ID format');
  }

  const user = await User.findById(id).select('-__v');
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return user;
};

module.exports = {
  createOrGetUser,
  getAllUsers,
  getUserById,
};
