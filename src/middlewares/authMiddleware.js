const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.*)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }

  const token = match[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // attach userId (or id) to request object
    req.userId = payload.userId || payload.id || payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware; 