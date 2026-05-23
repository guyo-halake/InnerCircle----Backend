import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db';
import authenticateToken, { isAdmin } from '../middleware/authenticateToken';
import { sendTransactionEmail, sendCustomEmail } from '../services/emailService';
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
      `SELECT u.id, u.fullName, u.email, u.phone, u.country, u.isVerified, u.createdAt,
              COALESCE(p.totalInvestment, 0.00) as totalInvestment,
              COALESCE(p.currentValue, 0.00) as balance
       FROM users u
       LEFT JOIN portfolios p ON u.id = p.userId
       WHERE u.role = 'Investor'
       ORDER BY u.createdAt DESC`
    );
    res.json(rows);
  } catch (err: any) {
    logger.error('Failed to fetch investors: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch investors' });
  }
});

// Admin: Get team members (non-investor users)
router.get('/team', authenticateToken, isAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.fullName, u.email, u.phone, u.role, u.createdAt, u.managed_pool_id,
              p.name as poolName,
              COALESCE(
                (SELECT SUM(t.amount) FROM transactions t WHERE t.userId = u.id AND t.type = 'Profit' AND t.status = 'Approved'),
                0
              ) as totalGrowth
       FROM users u
       LEFT JOIN portfolio_pools p ON u.managed_pool_id = p.id
       WHERE u.role != 'Investor'
       ORDER BY u.createdAt ASC`
    );
    res.json(rows);
  } catch (err: any) {
    logger.error('Failed to fetch team: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

// Admin: Assign managed pool to a team member
router.put('/team/:id/pool', authenticateToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { managed_pool_id } = req.body;
  try {
    await pool.query(
      'UPDATE users SET managed_pool_id = ? WHERE id = ? AND role != "Investor"',
      [managed_pool_id || null, id]
    );
    res.json({ message: 'Team member pool assignment updated successfully' });
  } catch (err: any) {
    logger.error('Failed to update team member pool: ' + err.message);
    res.status(500).json({ error: 'Failed to update team member pool' });
  }
});


// Admin: Delete an investor
router.delete('/investors/:id', authenticateToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    await connection.query('DELETE FROM wallets WHERE userId = ?', [id]);
    await connection.query('DELETE FROM portfolios WHERE userId = ?', [id]);
    await connection.query('DELETE FROM user_pool_investments WHERE user_id = ?', [id]);
    await connection.query('DELETE FROM transactions WHERE userId = ?', [id]);
    await connection.query('DELETE FROM users WHERE id = ? AND role = ?', [id, 'Investor']);

    await connection.commit();
    connection.release();

    res.json({ message: 'Investor and all associated records deleted successfully.' });
  } catch (err: any) {
    logger.error('Failed to delete investor: ' + err.message);
    res.status(500).json({ error: 'Failed to delete investor' });
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
        (SELECT COALESCE(SUM(balance), 0) FROM wallets WHERE type IN ('POCKET_HOLD', 'POCKET_ALLOCATION', 'POCKET_YIELD')) as totalAUM,
        (SELECT COUNT(*) FROM users WHERE role = 'Investor') as totalUsers,
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'Profit' AND status = 'Approved' AND createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as monthlyProfit
    `);
    
    const data = (stats as any)[0];
    res.json({
      totalAUM: parseFloat(data.totalAUM || 0),
      totalUsers: parseInt(data.totalUsers || 0),
      monthlyProfit: parseFloat(data.monthlyProfit || 0)
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

    // 1. Get transaction details with user info for emailing
    const [rows]: any = await connection.query(`
      SELECT t.*, u.fullName as investorName, u.email as investorEmail 
      FROM transactions t 
      JOIN users u ON t.userId = u.id 
      WHERE t.id = ?
    `, [id]);
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

    // Send Email Notification
    if (['Approved', 'Rejected'].includes(status) && ['Deposit', 'Withdrawal'].includes(tx.type)) {
      sendTransactionEmail({
        to: tx.investorEmail,
        investorName: tx.investorName,
        type: tx.type as 'Deposit' | 'Withdrawal',
        status: status as 'Approved' | 'Rejected',
        amount: Number(tx.amount)
      }).catch(err => logger.error(`Failed to send tx email: ${err.message}`));
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

// Admin: Get all transaction history logs
router.get('/transactions/all', authenticateToken, isAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, u.fullName as investorName, u.email as investorEmail
      FROM transactions t
      JOIN users u ON t.userId = u.id
      ORDER BY t.createdAt DESC
    `);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch transaction log history' });
  }
});

// Admin: Get settings
router.get('/settings', authenticateToken, isAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings');
    const settings: Record<string, string> = {};
    (rows as any[]).forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Admin: Update settings
router.post('/settings', authenticateToken, isAdmin, async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Invalid settings body' });
  }

  try {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    for (const [key, value] of Object.entries(updates)) {
      await connection.query(
        'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
        [key, String(value), String(value)]
      );
    }

    await connection.commit();
    connection.release();

    const io = getIo();
    if (io) {
      io.emit('systemSettingsUpdate', updates);
    }

    res.json({ message: 'Settings updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update settings: ' + error.message });
  }
});

import jwt from 'jsonwebtoken';

// Admin: Quick Action (Approve/Reject from Email Link)
router.get('/quick-action', async (req: any, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send('<h1>Invalid Link</h1><p>No token provided.</p>');
  }

  try {
    const decoded: any = jwt.verify(String(token), process.env.JWT_SECRET!);
    const { id, action } = decoded;

    if (!['Approved', 'Rejected'].includes(action)) {
      return res.status(400).send('<h1>Invalid Action</h1>');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows]: any = await connection.query(`
        SELECT t.*, u.fullName as investorName, u.email as investorEmail 
        FROM transactions t 
        JOIN users u ON t.userId = u.id 
        WHERE t.id = ?
      `, [id]);

      if (rows.length === 0) throw new Error('Transaction not found');
      const tx = rows[0];

      if (tx.status !== 'Pending') {
        return res.send(`
          <div style="font-family:sans-serif;text-align:center;padding:50px;">
            <h1 style="color:#555;">Already Processed</h1>
            <p>This transaction (ID #${id}) is currently marked as <strong>${tx.status}</strong>.</p>
          </div>
        `);
      }

      // Update Transaction
      // Processed by system via email (processedBy = null or some system admin id)
      await connection.query(
        'UPDATE transactions SET status = ? WHERE id = ?',
        [action, id]
      );

      // If Approved, update balances
      if (action === 'Approved') {
        const modifier = tx.type === 'Deposit' ? 1 : -1;
        const amount = Number(tx.amount);

        await connection.query(
          'UPDATE wallets SET balance = balance + ? WHERE userId = ? AND type = ?',
          [amount * modifier, tx.userId, 'POCKET_HOLD']
        );

        await connection.query(
          'UPDATE wallets SET balance = balance + ? WHERE type = ?',
          [amount * modifier, 'SYSTEM_AGGREGATE']
        );

        if (tx.type === 'Deposit') {
          await connection.query(
            'UPDATE portfolios SET totalInvestment = totalInvestment + ?, currentValue = currentValue + ? WHERE userId = ?',
            [amount, amount, tx.userId]
          );
        }
      }

      await connection.commit();

      // Trigger socket & emails
      const io = getIo();
      if (io) {
        io.to(`user-${tx.userId}`).emit('transactionUpdate', { id, status: action });
        const [portfolios]: any = await connection.query('SELECT * FROM portfolios WHERE userId = ?', [tx.userId]);
        if (portfolios.length > 0) {
          io.to(`user-${tx.userId}`).emit('portfolioUpdate', portfolios[0]);
        }
      }

      if (['Deposit', 'Withdrawal'].includes(tx.type)) {
        sendTransactionEmail({
          to: tx.investorEmail,
          investorName: tx.investorName,
          type: tx.type as 'Deposit' | 'Withdrawal',
          status: action as 'Approved' | 'Rejected',
          amount: Number(tx.amount)
        }).catch(err => logger.error(`Failed to send tx email: ${err.message}`));
      }

      res.send(`
        <div style="font-family:sans-serif;text-align:center;padding:50px;">
          <h1 style="color:${action === 'Approved' ? '#10b981' : '#ef4444'};">Successfully ${action}</h1>
          <p>Transaction #${id} for ${tx.investorName} has been processed.</p>
          <p>The investor has been notified.</p>
        </div>
      `);

    } catch (err: any) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err: any) {
    logger.error('Quick action failed: ' + err.message);
    res.status(400).send('<h1>Link Expired or Invalid</h1><p>Please log in to the admin dashboard to process this request.</p>');
  }
});

// Admin: Get detailed investor info, wallets, logs, and growth history
router.get('/investors/:id/detail', authenticateToken, isAdmin, async (req: any, res) => {
  const { id } = req.params;
  try {
    const [userRows]: any = await pool.query(
      'SELECT id, fullName, email, phone, country, isVerified, createdAt FROM users WHERE id = ? AND role = "Investor"',
      [id]
    );
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    const investor = userRows[0];

    const [walletRows]: any = await pool.query(
      'SELECT type, balance FROM wallets WHERE userId = ?',
      [id]
    );

    const [txRows]: any = await pool.query(
      'SELECT id, type, amount, status, createdAt FROM transactions WHERE userId = ? ORDER BY createdAt DESC',
      [id]
    );

    let [historyRows]: any = await pool.query(
      'SELECT value, recorded_at as date FROM portfolio_history WHERE userId = ? ORDER BY recorded_at ASC',
      [id]
    );

    // Calculate fallback if history is empty
    if (historyRows.length === 0) {
      const [portfolioRows]: any = await pool.query(
        'SELECT currentValue FROM portfolios WHERE userId = ?',
        [id]
      );
      const currentValue = portfolioRows.length > 0 ? parseFloat(portfolioRows[0].currentValue) : 0.00;
      
      const now = new Date();
      for (let i = 14; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(now.getDate() - i);
        const dateString = date.toISOString().split('T')[0];

        // Simulate a smooth, compounding growth up to the current value
        const factor = 1 - (i * 0.004);
        const val = currentValue * factor;

        historyRows.push({
          value: parseFloat(Math.max(0, val).toFixed(2)),
          date: dateString
        });
      }
    }

    res.json({
      investor,
      wallets: walletRows,
      transactions: txRows,
      growthHistory: historyRows
    });
  } catch (err: any) {
    logger.error('Failed to fetch investor details: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch investor details' });
  }
});

// Admin: Send custom email to an investor
router.post('/send-email', authenticateToken, isAdmin, async (req: any, res) => {
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'To, subject, and body are required' });
  }

  try {
    await sendCustomEmail({ to, subject, body });
    res.json({ message: 'Email sent successfully' });
  } catch (err: any) {
    logger.error('Failed to send custom email: ' + err.message);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Admin: Get allowed roles dynamically from database schema
router.get('/roles', authenticateToken, isAdmin, async (_req, res) => {
  try {
    const [rows]: any = await pool.query(`
      SELECT COLUMN_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME = 'role'
    `);
    
    if (rows.length === 0) {
      return res.json(['Investor', 'Admin', 'Developer']);
    }

    const columnType = rows[0].COLUMN_TYPE;
    const match = columnType.match(/enum\((.*)\)/);
    if (match) {
      const roles = match[1].split(',').map((val: string) => val.replace(/'/g, '').trim());
      return res.json(roles);
    }

    res.json(['Investor', 'Admin', 'Developer']);
  } catch (err: any) {
    logger.error('Failed to fetch user roles: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch user roles' });
  }
});

// Admin: Add a new user with any role
router.post('/users', authenticateToken, isAdmin, async (req: any, res) => {
  const { fullName, email, password, phone, role } = req.body;

  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ error: 'Missing required fields: fullName, email, password, and role are required.' });
  }

  try {
    const [existingUser] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (Array.isArray(existingUser) && existingUser.length > 0) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      'INSERT INTO users (fullName, email, password, phone, role) VALUES (?, ?, ?, ?, ?)',
      [fullName, email, hashedPassword, phone || null, role]
    );

    const insertResult = result as any;
    const newUserId = insertResult.insertId;

    // Create the three pockets (Wallets)
    await pool.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [newUserId, 'POCKET_HOLD', 0]);
    await pool.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [newUserId, 'POCKET_ALLOCATION', 0]);
    await pool.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [newUserId, 'POCKET_YIELD', 0]);

    // Create default portfolio
    await pool.query(
      'INSERT INTO portfolios (userId, totalInvestment, currentValue, netProfit, todayChange, todayChangePercent) VALUES (?, ?, ?, ?, ?, ?)',
      [newUserId, 0, 0, 0, 0, 0]
    );

    res.status(201).json({ message: 'User registered successfully by admin' });
  } catch (error: any) {
    logger.error('Failed to create user by admin: ' + error.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

export default router;
