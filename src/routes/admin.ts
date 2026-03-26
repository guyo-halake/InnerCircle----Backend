import express from 'express';
import pool from '../db';
import authenticateToken, { isAdmin } from '../middleware/authenticateToken';
import logger from '../logger';
import { parse } from 'csv-parse/sync';

const router = express.Router();

// Admin: Create a new Portfolio Pool
router.post('/pools', authenticateToken, isAdmin, async (req, res) => {
  const { name, category, description, initial_yield, risk_level } = req.body;

  if (!name || !category) {
    return res.status(400).json({ error: 'Name and category are required' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO portfolio_pools (name, category, description, current_yield, risk_level) VALUES (?, ?, ?, ?, ?)',
      [name, category, description, initial_yield || 0.0, risk_level || 'Moderate']
    );
    res.status(201).json({ message: 'Pool created successfully', poolId: (result as any).insertId });
  } catch (err: any) {
    logger.error('Failed to create pool: ' + err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Update a Portfolio Pool
router.put('/pools/:id', authenticateToken, isAdmin, async (req, res) => {
  const { name, category, description, current_yield, risk_level } = req.body;
  const { id } = req.params;

  try {
    await pool.query(
      'UPDATE portfolio_pools SET name = ?, category = ?, description = ?, current_yield = ?, risk_level = ? WHERE id = ?',
      [name, category, description, current_yield, risk_level, id]
    );
    res.json({ message: 'Pool updated successfully' });
  } catch (err: any) {
    logger.error('Failed to update pool: ' + err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Drop (Delete) a Portfolio Pool
router.delete('/pools/:id', authenticateToken, isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('DELETE FROM portfolio_pools WHERE id = ?', [id]);
    res.json({ message: 'Pool dropped successfully' });
  } catch (err: any) {
    logger.error('Failed to drop pool: ' + err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Import MT5 Trades and Distribute Profit
router.post('/import-trades', authenticateToken, isAdmin, async (req, res) => {
  const { csvData } = req.body; // In a real app we'd use multer but for this prototype string is fine
  
  if (!csvData) return res.status(400).json({ error: 'No data' });

  try {
    const records = parse(csvData, { columns: true, skip_empty_lines: true });
    let totalProfit = 0;

    for (const record of records as any[]) {
      const profit = parseFloat(record.Profit);
      if (isNaN(profit)) continue;
      totalProfit += profit;

      // Log trade for the Proof Gallery
      await pool.query(
        'INSERT INTO trade_proofs (asset, result, amount, note) VALUES (?, ?, ?, ?)',
        [record.Symbol || 'Forex', profit >= 0 ? 'Profit' : 'Loss', Math.abs(profit), 'Imported from MT5']
      );
    }

    // Proportional Money Distribution
    // 1. Get total AUM
    const [stats] = await pool.query('SELECT SUM(currentValue) as totalAUM FROM portfolios');
    const totalAUM = (stats as any)[0].totalAUM || 1;

    // 2. Update each user's portfolio
    // Formula: new_value = old_value + (totalProfit * (old_value / totalAUM))
    await pool.query(`
      UPDATE portfolios 
      SET 
        currentValue = currentValue + (? * (currentValue / ?)),
        netProfit = netProfit + (? * (currentValue / ?)),
        todayChange = ? * (currentValue / ?)
      WHERE currentValue > 0
    `, [totalProfit, totalAUM, totalProfit, totalAUM, totalProfit, totalAUM]);

    res.json({ message: `Trades synced. Today's profit: ${totalProfit} distributed.` });
  } catch (err: any) {
    logger.error('Failed to import trades: ' + err.message);
    res.status(500).json({ error: 'Import failed' });
  }
});

// Admin: Publish a Manual Trade
router.post('/manual-trade', authenticateToken, isAdmin, async (req, res) => {
  const { asset, result, amount, note } = req.body;
  try {
    await pool.query(
      'INSERT INTO trade_proofs (asset, result, amount, note) VALUES (?, ?, ?, ?)',
      [asset, result, amount || 0, note || '']
    );
    res.status(201).json({ message: 'Trade published successfully' });
  } catch (err: any) {
    logger.error('Failed to publish manual trade: ' + err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Get all pools with stats
router.get('/pools', authenticateToken, isAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM portfolio_pools');
    res.json(rows);
  } catch (err: any) {
    logger.error('Failed to fetch pools: ' + err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
