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
    
    // Get Ranking
    const [rankRows]: any = await pool.query(`
      SELECT COUNT(*) as totalUsers, 
      (SELECT COUNT(*) + 1 FROM portfolios p2 WHERE p2.netProfit > p1.netProfit) as rank
      FROM portfolios p1 WHERE p1.userId = ?
    `, [req.user.id]);
    
    const ranking = rankRows[0] || { totalUsers: 1, rank: 1 };
    const percentile = Math.max(1, Math.round((1 - (ranking.rank / (ranking.totalUsers || 1))) * 100));

    // Get Active Pools
    const [poolRows] = await pool.query(`
      SELECT upi.*, pp.name, pp.category, pp.current_yield 
      FROM user_pool_investments upi
      JOIN portfolio_pools pp ON upi.pool_id = pp.id
      WHERE upi.user_id = ?
    `, [req.user.id]);

    // Get Ledger
    const [ledgerRows] = await pool.query(`
      SELECT type as action, amount, createdAt as date, status, id
      FROM transactions 
      WHERE userId = ? 
      ORDER BY createdAt DESC 
      LIMIT 20
    `, [req.user.id]);

    res.json({
      ...portfolios[0],
      rank: ranking.rank,
      totalUsers: ranking.totalUsers,
      percentile: percentile,
      poolInvestments: poolRows,
      historyLedger: ledgerRows
    });
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

router.get('/allocation', authenticateToken, async (req: any, res) => {
  try {
    const [rows]: any = await pool.query(`
      SELECT pp.category as name, SUM(upi.current_value) as value
      FROM user_pool_investments upi
      JOIN portfolio_pools pp ON upi.pool_id = pp.id
      WHERE upi.user_id = ?
      GROUP BY pp.category
    `, [req.user.id]);
    
    // Assign colors for each category
    const colors: Record<string, string> = {
      'Stocks': '#3B82F6',
      'MMF': '#10B981',
      'Forex': '#FACC15',
      'Crypto': '#F97316'
    };

    const data = rows.map((row: any) => ({
      name: row.name,
      value: parseFloat(row.value),
      color: colors[row.name] || '#8884d8'
    }));

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch allocation' });
  }
});

router.get('/history-ledger', authenticateToken, async (req: any, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, type as action, amount, status, createdAt as date FROM transactions WHERE userId = ? ORDER BY createdAt DESC LIMIT 50',
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

router.get('/peers', authenticateToken, async (req: any, res) => {
  try {
    const [rows]: any = await pool.query(`
      SELECT u.fullName as name, t.type as action, t.createdAt as date, t.amount
      FROM transactions t
      JOIN users u ON t.userId = u.id
      WHERE t.userId != ? AND t.status = 'Approved'
      ORDER BY t.createdAt DESC
      LIMIT 10
    `, [req.user.id]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch peer activity' });
  }
});

router.post('/invest', authenticateToken, async (req: any, res) => {
  const { amount, poolId } = req.body;
  
  if (!amount || amount <= 0 || !poolId) {
    return res.status(400).json({ error: 'Invalid amount or pool ID' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Check POCKET_HOLD balance
    const [holdResult]: any = await connection.query(
      'SELECT balance FROM wallets WHERE userId = ? AND type = ?',
      [req.user.id, 'POCKET_HOLD']
    );

    if (!holdResult.length || holdResult[0].balance < amount) {
      throw new Error('Insufficient funds in Pocket Hold');
    }

    // 2. Deduct from POCKET_HOLD
    await connection.query(
      'UPDATE wallets SET balance = balance - ? WHERE userId = ? AND type = ?',
      [amount, req.user.id, 'POCKET_HOLD']
    );

    // 3. Add to POCKET_ALLOCATION
    await connection.query(
      'UPDATE wallets SET balance = balance + ? WHERE userId = ? AND type = ?',
      [amount, req.user.id, 'POCKET_ALLOCATION']
    );

    // 4. Update/Create user_pool_investments
    const [existingInv]: any = await connection.query(
      'SELECT * FROM user_pool_investments WHERE user_id = ? AND pool_id = ?',
      [req.user.id, poolId]
    );

    if (existingInv.length > 0) {
      await connection.query(
        'UPDATE user_pool_investments SET staked_amount = staked_amount + ?, current_value = current_value + ? WHERE id = ?',
        [amount, amount, existingInv[0].id]
      );
    } else {
      await connection.query(
        'INSERT INTO user_pool_investments (user_id, pool_id, staked_amount, current_value) VALUES (?, ?, ?, ?)',
        [req.user.id, poolId, amount, amount]
      );
    }

    // 5. Update pool total_staked
    await connection.query(
      'UPDATE portfolio_pools SET total_staked = total_staked + ? WHERE id = ?',
      [amount, poolId]
    );

    // 6. Record Transaction
    await connection.query(
      'INSERT INTO transactions (userId, type, amount, status) VALUES (?, ?, ?, ?)',
      [req.user.id, 'Allocation', amount, 'Completed']
    );

    await connection.commit();
    res.json({ message: 'Investment allocation successful.' });
  } catch (err: any) {
    await connection.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    connection.release();
  }
});
export default router;