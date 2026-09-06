const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { verifyToken } = require('../middleware/verifyToken');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');

const router = express.Router();
const SALT_ROUNDS = 12;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'username already taken' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    // Registration always creates 'operator' — never let a client self-grant admin.
    const user = await User.create({ username, passwordHash, role: 'operator' });

    return res.status(201).json({ id: user._id, username: user.username, role: user.role });
  } catch (err) {
    console.error('[auth/register]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'invalid credentials' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'invalid credentials' });

    const token = jwt.sign(
      { sub: user._id.toString(), username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: JWT_EXPIRY }
    );
    return res.json({ token, expiresIn: JWT_EXPIRY });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

router.get('/me', verifyToken, (req, res) => res.json({ user: req.user }));

module.exports = router;
