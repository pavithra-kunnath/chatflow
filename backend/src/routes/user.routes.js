const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { validate, userValidationSchema } = require('../middleware/validate');

// POST /api/users - Register or login user
router.post('/', validate(userValidationSchema), userController.createOrGetUser);

// GET /api/users - Get all users
router.get('/', userController.getAllUsers);

// GET /api/users/:id - Get user by ID
router.get('/:id', userController.getUserById);

module.exports = router;
