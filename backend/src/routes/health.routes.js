const express = require('express');
const router = express.Router();

// GET /api/health
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ChatFlow API is running'
  });
});

module.exports = router;
