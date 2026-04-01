import express from 'express';
import pool from '../db';
import authenticateToken, { isAdmin } from '../middleware/authenticateToken';
import logger from '../logger';
import { parse } from 'csv-parse/sync';
import { getIo } from '../socket';

const router = express.Router();

// Admin: Get all portfolio pools
router.get('/pools', authenticateToken, isAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM portfolio_pools ORDER BY created_at DESC');
    res.json(rows);
  } catch (err: any) {
    logger.error('Failed to fetch pools: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch pools' });
  }
});

// Admin: Get all investors
router.get('/investors', authenticateToken, isAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, fullName, email, phone, country, isVerified, createdAt
       FROM users
       WHERE role = 'Investor'
       ORDER BY createdAt DESC`
    );
    res.json(rows);
  } catch (err: any) {
    logger.error('Failed to fetch investors: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch investors' });
  }
});

// Admin: Verify or unverify investor
router.put('/investors/:id/verification', authenticateToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { isVerified } = req.body;

  if (typeof isVerified !== 'boolean') {
    return res.status(400).json({ error: 'isVerified must be a boolean' });
  }

  try {
    await pool.query('UPDATE users SET isVerified = ? WHERE id = ? AND role = ?', [isVerified ? 1 : 0, id, 'Investor']);
    res.json({ message: 'Investor verification updated' });
  } catch (err: any) {
    logger.error('Failed to update investor verification: ' + err.message);
    res.status(500).json({ error: 'Failed to update investor verification' });
  }
});

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
        (SELECT balance FROM wallets WHERE type = 'SYSTEM_AGGREGATE') as totalAUM,
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

// Admin: Manage IC-Wallet (SYSTEM_AGGREGATE)
router.get('/wallet', authenticateToken, isAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM wallets WHERE type = ?', ['SYSTEM_AGGREGATE']);
    res.json((rows as any)[0]);
  } catch (err: any) {
    res.status(500).json({ error: 'Wallet fetch failed' });
  }
});

router.post('/wallet/transaction', authenticateToken, isAdmin, async (req, res) => {
  const { type, amount, note } = req.body; // type: 'Deposit' | 'Withdrawal'
  
  try {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    const modifier = type === 'Deposit' ? 1 : -1;
    await connection.query('UPDATE wallets SET balance = balance + ? WHERE type = ?', [amount * modifier, 'SYSTEM_AGGREGATE']);
    
    await connection.commit();
    connection.release();
    
    res.json({ message: 'Institutional transaction completed.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Transaction failed' });
  }
});

// Admin: Import MT5 Trades and Distribute Profit to Pockets
router.post('/import-trades', authenticateToken, isAdmin, async (req, res) => {
  const { csvData, poolId } = req.body; 
  
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
        [record.Symbol || 'Forex', profit >= 0 ? 'Profit' : 'Loss', Math.abs(profit), 'Imported from MT5 Terminal']
      );
    }

    // Money Distribution to POCKET_YIELD
    const [stats] = await pool.query('SELECT SUM(staked_amount) as poolAUM FROM user_pool_investments WHERE pool_id = ?', [poolId]);
    const poolAUM = Number((stats as any)[0].poolAUM) || 1;

    const [investments] = await pool.query('SELECT userId, staked_amount FROM user_pool_investments WHERE pool_id = ?', [poolId]);
    const investorList = investments as any[];

    for (const inv of investorList) {
      const userProfit = totalProfit * (Number(inv.staked_amount) / poolAUM);
      
      // Update POCKET_YIELD
      await pool.query('UPDATE wallets SET balance = balance + ? WHERE userId = ? AND type = ?', [userProfit, inv.userId, 'POCKET_YIELD']);
      
      // Update Summary Portfolio
      await pool.query(`
        UPDATE portfolios SET currentValue = currentValue + ?, netProfit = netProfit + ?, todayChange = ? WHERE userId = ?
      `, [userProfit, userProfit, userProfit, inv.userId]);

      await pool.query('INSERT INTO transactions (userId, type, amount, status) VALUES (?, ?, ?, ?)', [inv.userId, 'Profit', userProfit, 'Completed']);
    }

    res.json({ message: `Yield Distributed: ${totalProfit} KSh among ${investorList.length} pool members.` });
  } catch (err: any) {
    logger.error('Failed to distribute yield: ' + err.message);
    res.status(500).json({ error: 'Distribution failed' });
  }
});

// Admin: Parse WhatsApp Style Logs (Text Message Ingestion)
router.post('/parse-logs', authenticateToken, isAdmin, async (req, res) => {
  const { text } = req.body;
  // Example pattern: "GOLD Buy @ 2030.50 Close @ 2045.00 Profit 1450"
  const profitMatch = text.match(/Profit\s+([\d.]+)/i);
  if (profitMatch) {
    const profit = parseFloat(profitMatch[1]);
    res.json({ detectedProfit: profit, asset: 'Detected Asset' });
  } else {
    res.status(400).json({ error: 'No profit data detected in text log' });
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

// Admin: Get all Pending Transactions
router.get('/transactions/pending', authenticateToken, isAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, u.fullName as investorName, u.email as investorEmail
      FROM transactions t
      JOIN users u ON t.userId = u.id
      WHERE t.status = 'Pending'
      ORDER BY t.createdAt DESC
    `);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch pending transactions' });
  }
});

// Admin: Approve or Reject a Transaction
router.put('/transactions/:id', authenticateToken, isAdmin, async (req: any, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'Approved' | 'Rejected' | 'Unsuccessful'

  if (!['Approved', 'Rejected', 'Unsuccessful'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Get transaction details
    const [rows]: any = await connection.query('SELECT * FROM transactions WHERE id = ?', [id]);
    if (rows.length === 0) throw new Error('Transaction not found');
    const tx = rows[0];

    if (tx.status !== 'Pending') throw new Error('Transaction already processed');

    // 2. Update Transaction
    await connection.query(
      'UPDATE transactions SET status = ?, processedBy = ? WHERE id = ?',
      [status, req.user.id, id]
    );

    // 3. If Approved, update balances
    if (status === 'Approved') {
      const modifier = tx.type === 'Deposit' ? 1 : -1;
      const amount = Number(tx.amount);

      // Update Investor POCKET_HOLD
      await connection.query(
        'UPDATE wallets SET balance = balance + ? WHERE userId = ? AND type = ?',
        [amount * modifier, tx.userId, 'POCKET_HOLD']
      );

      // Update SYSTEM_AGGREGATE (IC-Wallet)
      await connection.query(
        'UPDATE wallets SET balance = balance + ? WHERE type = ?',
        [amount * modifier, 'SYSTEM_AGGREGATE']
      );

      // Update Portfolio totalInvestment/currentValue if Deposit
      if (tx.type === 'Deposit') {
        await connection.query(
          'UPDATE portfolios SET totalInvestment = totalInvestment + ?, currentValue = currentValue + ? WHERE userId = ?',
          [amount, amount, tx.userId]
        );
      }
    }

    await connection.commit();

    // Trigger Real-time Update
    const io = getIo();
    if (io) {
      // Notify transaction status
      io.to(`user-${tx.userId}`).emit('transactionUpdate', { id, status });
      
      // Fetch and Notify current portfolio state
      const [portfolios]: any = await connection.query('SELECT * FROM portfolios WHERE userId = ?', [tx.userId]);
      if (portfolios.length > 0) {
        io.to(`user-${tx.userId}`).emit('portfolioUpdate', portfolios[0]);
      }
    }

    res.json({ message: `Transaction ${status.toLowerCase()} successfully.` });
  } catch (err: any) {
    await connection.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// Admin: Manage System Financials (Bank Accounts, etc)
router.post('/financials', authenticateToken, isAdmin, async (req, res) => {
  const { name, category, accountName, accountNumber, paybill, logoUrl } = req.body;
  try {
    await pool.query(
      'INSERT INTO system_financials (name, category, accountName, accountNumber, paybill, logoUrl) VALUES (?, ?, ?, ?, ?, ?)',
      [name, category, accountName, accountNumber, paybill, logoUrl]
    );
    res.json({ message: 'Financial asset registered.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to register financial asset' });
  }
});

export default router;
