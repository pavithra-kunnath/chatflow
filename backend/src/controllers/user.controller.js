const userService = require('../services/user.service');

/**
 * Controller: Register or login a user by username
 * POST /api/users
 */
const createOrGetUser = async (req, res, next) => {
  try {
    const { username, avatar } = req.body;
    const user = await userService.createOrGetUser({ username, avatar });

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id || user._id.toString(),
          username: user.username,
          avatar: user.avatar,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller: Get all registered users
 * GET /api/users
 */
const getAllUsers = async (req, res, next) => {
  try {
    const users = await userService.getAllUsers();

    res.status(200).json({
      success: true,
      data: {
        users,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Controller: Get a user by ID
 * GET /api/users/:id
 */
const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await userService.getUserById(id);

    res.status(200).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrGetUser,
  getAllUsers,
  getUserById,
};
