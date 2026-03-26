import { Router } from 'express';
import pool from '../db';
import authenticateToken from '../middleware/authenticateToken';

const router = Router();

router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM transactions WHERE userId = ? ORDER BY createdAt DESC LIMIT 10', [req.user.id]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
