import { Router } from 'express';
import pool from '../db';
import authenticateToken from '../middleware/authenticateToken';

const router = Router();

router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM portfolios WHERE userId = ?', [req.user.id]);
    const portfolios = rows as any[];
    if (portfolios.length === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    res.json(portfolios[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

export default router;
