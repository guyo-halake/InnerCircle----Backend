import { Router } from 'express';
import pool from '../db';
import authenticateToken from '../middleware/authenticateToken';

const router = Router();

router.get('/', authenticateToken, async (req: any, res) => {
  try {
    let [rows] = await pool.query('SELECT * FROM portfolios WHERE userId = ?', [req.user.id]);
    let portfolios = rows as any[];
    
    if (portfolios.length === 0) {
      // Auto-create a default portfolio if none exists
      await pool.query(
        'INSERT INTO portfolios (userId, totalInvestment, currentValue, netProfit, todayChange, todayChangePercent) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user.id, 0.00, 0.00, 0.00, 0.00, 0.00]
      );
      
      // Re-query to get the new portfolio
      const [newRows] = await pool.query('SELECT * FROM portfolios WHERE userId = ?', [req.user.id]);
      portfolios = newRows as any[];
    }
    
    res.json(portfolios[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

router.get('/proofs', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM trade_proofs ORDER BY created_at DESC LIMIT 10');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch proofs' });
  }
});

export default router;
