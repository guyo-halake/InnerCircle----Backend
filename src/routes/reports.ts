import express from 'express';
import pool from '../db';
import authenticateToken from '../middleware/authenticateToken';
import logger from '../logger';

const router = express.Router();

// Get reports for current user
router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, 
       (SELECT COUNT(*) FROM report_trades rt WHERE rt.report_id = r.id) as trade_count
       FROM reports r WHERE r.user_id = ? ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err: any) {
    logger.error('Failed to fetch reports: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Create a report
router.post('/', authenticateToken, async (req: any, res) => {
  const { title, summary, trade_ids } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO reports (user_id, title, summary, status) VALUES (?, ?, ?, ?)',
      [req.user.id, title, summary || '', 'Sent']
    );
    const reportId = (result as any).insertId;

    // Link trades to report
    if (trade_ids && trade_ids.length > 0) {
      const values = trade_ids.map((tid: number) => [reportId, tid]);
      await pool.query(
        'INSERT INTO report_trades (report_id, trade_id) VALUES ?',
        [values]
      );
    }

    res.status(201).json({ id: reportId, message: 'Report sent' });
  } catch (err: any) {
    logger.error('Failed to create report: ' + err.message);
    res.status(500).json({ error: 'Failed to send report' });
  }
});

export default router;
