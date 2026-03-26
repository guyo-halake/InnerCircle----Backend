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

// Admin: Get Summary Stats
router.get('/summary', authenticateToken, isAdmin, async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT 
        (SELECT SUM(currentValue) FROM portfolios) as totalAUM,
        (SELECT COUNT(*) FROM users) as totalUsers,
        (SELECT SUM(amount) FROM transactions WHERE type = 'Profit' AND createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as monthlyProfit
    `);
    
    const data = (stats as any)[0];
    res.json({
      totalAUM: data.totalAUM || 0,
      totalUsers: data.totalUsers || 0,
      monthlyProfit: data.monthlyProfit || 0
    });
  } catch (err: any) {
    logger.error('Failed to fetch admin summary: ' + err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Import MT5 Trades and Distribute Profit
router.post('/import-trades', authenticateToken, isAdmin, async (req, res) => {
  const { csvData } = req.body; 
  
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
    const totalAUM = Number((stats as any)[0].totalAUM) || 1;

    // 2. Get all portfolios with value > 0 to distribute profit
    const [portfolios] = await pool.query('SELECT userId, currentValue FROM portfolios WHERE currentValue > 0');
    const portfolioList = portfolios as any[];

    for (const portfolio of portfolioList) {
      const userProfit = totalProfit * (Number(portfolio.currentValue) / totalAUM);
      
      // Update individual portfolio
      await pool.query(`
        UPDATE portfolios 
        SET 
          currentValue = currentValue + ?,
          netProfit = netProfit + ?,
          todayChange = ?
        WHERE userId = ?
      `, [userProfit, userProfit, userProfit, portfolio.userId]);

      // Log transaction
      await pool.query(
        'INSERT INTO transactions (userId, type, amount, status) VALUES (?, ?, ?, ?)',
        [portfolio.userId, 'Profit', userProfit, 'Completed']
      );
    }

    res.json({ message: `Trades synced. Today's profit: ${totalProfit} distributed among ${portfolioList.length} investors.` });
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
