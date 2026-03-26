import express from 'express';
import pool from '../db';
import authenticateToken from '../middleware/authenticateToken';
import logger from '../logger';

const router = express.Router();

// Get trades for current user
router.get('/', authenticateToken, async (req: any, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM trades WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err: any) {
    logger.error('Failed to fetch trades: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// Create a new trade
router.post('/', authenticateToken, async (req: any, res) => {
  const { asset, trade_type, entry_price, exit_price, lot_size, stop_loss, take_profit, notes, profit_loss, status } = req.body;

  if (!asset || !entry_price || !lot_size) {
    return res.status(400).json({ error: 'Asset, entry price, and lot size are required' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO trades (user_id, asset, trade_type, entry_price, exit_price, lot_size, stop_loss, take_profit, notes, profit_loss, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, asset, trade_type || 'Buy', entry_price, exit_price || null, lot_size, stop_loss || null, take_profit || null, notes || '', profit_loss || 0, status || 'Open']
    );
    const insertResult = result as any;
    
    // Log as trade proof if closed
    if (status === 'Closed' && profit_loss) {
      await pool.query(
        'INSERT INTO trade_proofs (asset, result, amount, note) VALUES (?, ?, ?, ?)',
        [asset, parseFloat(profit_loss) >= 0 ? 'Profit' : 'Loss', Math.abs(parseFloat(profit_loss)), notes || `${trade_type} ${asset}`]
      );
    }

    res.status(201).json({ message: 'Trade logged', id: insertResult.insertId });
  } catch (err: any) {
    logger.error('Failed to create trade: ' + err.message);
    res.status(500).json({ error: 'Failed to log trade' });
  }
});

// Update a trade
router.put('/:id', authenticateToken, async (req: any, res) => {
  const { id } = req.params;
  const { asset, trade_type, entry_price, exit_price, lot_size, stop_loss, take_profit, notes, profit_loss, status } = req.body;

  try {
    const [existing] = await pool.query('SELECT * FROM trades WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if ((existing as any[]).length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    await pool.query(
      `UPDATE trades SET asset = ?, trade_type = ?, entry_price = ?, exit_price = ?, lot_size = ?, stop_loss = ?, take_profit = ?, notes = ?, profit_loss = ?, status = ?
       WHERE id = ? AND user_id = ?`,
      [asset, trade_type, entry_price, exit_price, lot_size, stop_loss, take_profit, notes, profit_loss, status, id, req.user.id]
    );

    res.json({ message: 'Trade updated' });
  } catch (err: any) {
    logger.error('Failed to update trade: ' + err.message);
    res.status(500).json({ error: 'Failed to update trade' });
  }
});

// Delete a trade
router.delete('/:id', authenticateToken, async (req: any, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM trades WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ message: 'Trade deleted' });
  } catch (err: any) {
    logger.error('Failed to delete trade: ' + err.message);
    res.status(500).json({ error: 'Failed to delete trade' });
  }
});

export default router;
