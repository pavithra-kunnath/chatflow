/**
 * Centralized Global Error Handler
 * Standardizes error responses across all REST API endpoints.
 * Returns: { "success": false, "message": "..." }
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Handle Mongoose CastError (e.g. invalid ObjectId format)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // Handle Mongoose duplicate key error (E11000)
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `Duplicate value entered for ${field}: ${err.keyValue ? err.keyValue[field] : ''}. Please choose another.`;
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((val) => val.message)
      .join(', ');
  }

  // Avoid logging routine client 4xx errors as server crashes
  if (statusCode >= 500) {
    console.error('[Server Error]', err);
  }

  res.status(statusCode).json({
    success: false,
    message,
  });
};

module.exports = errorHandler;
