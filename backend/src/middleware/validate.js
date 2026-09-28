const Joi = require('joi');
const ApiError = require('../utils/ApiError');

// Reusable regex pattern for 24-character hex MongoDB ObjectId
const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const userValidationSchema = Joi.object({
  username: Joi.string()
    .trim()
    .min(2)
    .max(30)
    .required()
    .messages({
      'string.base': 'Username must be a string',
      'string.empty': 'Username cannot be empty',
      'string.min': 'Username must be at least 2 characters long',
      'string.max': 'Username cannot exceed 30 characters',
      'any.required': 'Username is required',
    }),
  avatar: Joi.string().uri().allow(null, '').optional(),
});

const messageValidationSchema = Joi.object({
  senderId: Joi.string()
    .trim()
    .regex(objectIdPattern)
    .required()
    .messages({
      'string.pattern.base': 'Invalid senderId format. Must be a valid 24-character hexadecimal MongoDB ID',
      'string.empty': 'senderId is required',
      'any.required': 'senderId is required',
    }),
  receiverId: Joi.string()
    .trim()
    .regex(objectIdPattern)
    .required()
    .messages({
      'string.pattern.base': 'Invalid receiverId format. Must be a valid 24-character hexadecimal MongoDB ID',
      'string.empty': 'receiverId is required',
      'any.required': 'receiverId is required',
    }),
  content: Joi.string()
    .trim()
    .min(1)
    .max(2000)
    .required()
    .messages({
      'string.empty': 'Message content cannot be empty',
      'string.min': 'Message content cannot be empty',
      'string.max': 'Message content cannot exceed 2000 characters',
      'any.required': 'Message content is required',
    }),
}).custom((value, helpers) => {
  if (value.senderId === value.receiverId) {
    return helpers.message('Sender and receiver cannot be identical');
  }
  return value;
});

/**
 * Middleware factory for Joi validation
 * Validates req.body against given schema
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errorDetails = error.details.map((detail) => detail.message).join(', ');
    return next(new ApiError(400, errorDetails));
  }

  // Replace req.body with trimmed/sanitized values
  req.body = value;
  next();
};

module.exports = {
  validate,
  userValidationSchema,
  messageValidationSchema,
};
