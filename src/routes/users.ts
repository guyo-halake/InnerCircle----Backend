import { Router } from 'express';
import pool from '../db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import authenticateToken from '../middleware/authenticateToken';

const router = Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, fullName, email, phone, country, currency, createdAt FROM users');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

router.post('/register', async (req, res) => {
  const { fullName, email, password, phone, firstName, lastName, aliasPhoneWhatsApp, aliasPhoneTelegram, role } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const [existingUser] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (Array.isArray(existingUser) && existingUser.length > 0) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      'INSERT INTO users (fullName, firstName, lastName, email, password, phone, aliasPhoneWhatsApp, aliasPhoneTelegram, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [fullName, firstName, lastName, email, hashedPassword, phone, aliasPhoneWhatsApp, aliasPhoneTelegram, role || 'Investor']
    );

    const insertResult = result as any;
    const newUserId = insertResult.insertId;

    // Create the three "Pockects" (Wallets) for the investor
    await pool.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [newUserId, 'POCKET_HOLD', 0]);
    await pool.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [newUserId, 'POCKET_ALLOCATION', 0]);
    await pool.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [newUserId, 'POCKET_YIELD', 0]);

    // Create a default portfolio for the new user
    await pool.query(
      'INSERT INTO portfolios (userId, totalInvestment, currentValue, netProfit, todayChange, todayChangePercent) VALUES (?, ?, ?, ?, ?, ?)',
      [newUserId, 0, 0, 0, 0, 0]
    );

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    const users = rows as any[];
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET!, { expiresIn: '1h' });

    // Exclude password from the user object being returned
    const { password: _, ...userWithoutPassword } = user;

    res.json({ token, user: userWithoutPassword });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
});

import upload from '../middleware/upload';

router.post('/avatar', authenticateToken, upload.single('avatar'), async (req: any, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const avatarUrl = `/uploads/${req.file.filename}`;

  try {
    await pool.query('UPDATE users SET avatarUrl = ? WHERE id = ?', [avatarUrl, req.user.id]);
    res.json({ message: 'Avatar uploaded successfully', avatarUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

router.get('/me', authenticateToken, async (req: any, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = (rows as any)[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Fetch user wallets (Pockets)
    const [wallets] = await pool.query('SELECT type, balance FROM wallets WHERE userId = ?', [req.user.id]);
    
    const { password: _, ...userWithoutPassword } = user;
    res.json({ ...userWithoutPassword, wallets });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

router.put('/:id', authenticateToken, async (req: any, res) => {
  const { fullName, phone, country } = req.body;
  const { id } = req.params;

  if (parseInt(id) !== req.user.id) {
    return res.status(403).json({ error: "You can only update your own profile" });
  }

  try {
    await pool.query(
      'UPDATE users SET fullName = ?, phone = ?, country = ? WHERE id = ?',
      [fullName, phone, country, id]
    );

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    const user = (rows as any)[0];
    const { password: _, ...userWithoutPassword } = user;

    res.json({ message: 'Profile updated successfully', user: userWithoutPassword });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/:id/strategy', authenticateToken, async (req: any, res) => {
  const { investmentStrategy } = req.body;
  const { id } = req.params;

  if (parseInt(id) !== req.user.id) {
    return res.status(403).json({ error: "You can only update your own profile" });
  }

  try {
    await pool.query(
      'UPDATE users SET investmentStrategy = ? WHERE id = ?',
      [investmentStrategy, id]
    );

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    const user = (rows as any)[0];
    const { password: _, ...userWithoutPassword } = user;

    res.json({ message: 'Strategy updated successfully', user: userWithoutPassword });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update strategy' });
  }
});

export default router;
