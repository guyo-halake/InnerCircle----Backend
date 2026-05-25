import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { initSocket } from './socket';
import userRoutes from './routes/users';
import portfolioRoutes from './routes/portfolios';
import adminRoutes from './routes/admin';
import paymentRoutes from './routes/payments';
import tradeRoutes from './routes/trades';
import reportRoutes from './routes/reports';
import chatRoutes from './routes/chat';
import logger from './logger';
import pool from './db';
import { initPortfolioScheduler } from './services/portfolioScheduler';
import bcrypt from 'bcryptjs';

dotenv.config();

const initDb = async () => {
  try {
    const conn = await pool.getConnection();
    
    // Users with roles and extended KYC
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fullName VARCHAR(255) NOT NULL,
        firstName VARCHAR(100),
        lastName VARCHAR(100),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        aliasPhoneWhatsApp VARCHAR(20),
        aliasPhoneTelegram VARCHAR(20),
        country VARCHAR(100),
        currency VARCHAR(10) DEFAULT 'KSh',
        role ENUM('Investor', 'Admin', 'Developer') DEFAULT 'Investor',
        avatarUrl VARCHAR(255),
        investmentStrategy TEXT,
        isVerified TINYINT(1) DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Wallets: IC-Wallet (System) and Investor Pockets
    await conn.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT,
        type ENUM('SYSTEM_AGGREGATE', 'POCKET_HOLD', 'POCKET_ALLOCATION', 'POCKET_YIELD') NOT NULL,
        balance DECIMAL(18,2) DEFAULT 0.00,
        currency VARCHAR(10) DEFAULT 'KSh',
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (userId),
        INDEX (type)
      )
    `);

    // User Payment Preferences
    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_payment_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        method ENUM('M-Pesa', 'Bank', 'Card', 'Manual') NOT NULL,
        isDefault TINYINT(1) DEFAULT 0,
        details TEXT,
        INDEX (userId)
      )
    `);

    // Portfolio Pools (Admin managed)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS portfolio_pools (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category ENUM('Stocks', 'MMF', 'Forex', 'Crypto') NOT NULL,
        description TEXT,
        current_yield DECIMAL(10,4) DEFAULT 0.00,
        total_staked DECIMAL(18,2) DEFAULT 0.00,
        risk_level VARCHAR(50) DEFAULT 'Moderate',
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User Investments in specific pools
    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_pool_investments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        pool_id INT NOT NULL,
        staked_amount DECIMAL(18,2) NOT NULL,
        current_value DECIMAL(18,2) NOT NULL,
        compounding TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (pool_id)
      )
    `);

    // Portfolio Summary
    await conn.query(`
      CREATE TABLE IF NOT EXISTS portfolios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        totalInvestment DECIMAL(18,2) DEFAULT 0.00,
        currentValue DECIMAL(18,2) DEFAULT 0.00,
        netProfit DECIMAL(18,2) DEFAULT 0.00,
        todayChange DECIMAL(18,2) DEFAULT 0.00,
        todayChangePercent DECIMAL(5,2) DEFAULT 0.00,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (userId)
      )
    `);

    // Portfolio History for Charting
    await conn.query(`
      CREATE TABLE IF NOT EXISTS portfolio_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        value DECIMAL(18,2) NOT NULL,
        recorded_at DATE NOT NULL,
        INDEX (userId),
        UNIQUE KEY (userId, recorded_at)
      )
    `);

    // Trade Proofs (Daily logs and screenshots)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS trade_proofs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        asset VARCHAR(100),
        result ENUM('Profit', 'Loss') DEFAULT 'Profit',
        amount DECIMAL(18,2) DEFAULT 0.00,
        note TEXT,
        image_url VARCHAR(255),
        file_path VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        type ENUM('Deposit', 'Withdrawal', 'Profit', 'Fee', 'Allocation', 'Reinvestment') NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        status ENUM('Pending', 'Approved', 'Rejected', 'Unsuccessful') DEFAULT 'Pending',
        mpesaCheckoutId VARCHAR(255),
        methodDetails TEXT,
        description TEXT,
        processedBy INT,
        approvedBy INT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (userId),
        INDEX (status)
      )
    `);

    // System Financials (Admin configures these)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS system_financials (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        category ENUM('Bank', 'Mobile', 'Crypto', 'PayPal') NOT NULL,
        accountName VARCHAR(255),
        accountNumber VARCHAR(255),
        paybill VARCHAR(50),
        logoUrl VARCHAR(255),
        isActive TINYINT(1) DEFAULT 1,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Trader Trades
    await conn.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        asset VARCHAR(100) NOT NULL,
        trade_type ENUM('Buy', 'Sell') NOT NULL DEFAULT 'Buy',
        entry_price DECIMAL(18,6) NOT NULL,
        exit_price DECIMAL(18,6),
        lot_size DECIMAL(10,4) NOT NULL,
        stop_loss DECIMAL(18,6),
        take_profit DECIMAL(18,6),
        profit_loss DECIMAL(18,2) DEFAULT 0.00,
        status ENUM('Open', 'Closed') DEFAULT 'Open',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (user_id)
      )
    `);

    // Reports
    await conn.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        summary TEXT,
        status ENUM('Sent', 'Viewed', 'Acknowledged') DEFAULT 'Sent',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id)
      )
    `);

    // Report linked trades
    await conn.query(`
      CREATE TABLE IF NOT EXISTS report_trades (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        trade_id INT NOT NULL,
        INDEX (report_id),
        INDEX (trade_id)
      )
    `);

    // Chat Messages
    await conn.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        channel_id VARCHAR(50) NOT NULL,
        user_id INT NOT NULL,
        content TEXT NOT NULL,
        attached_trade_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (channel_id),
        INDEX (user_id)
      )
    `);
    
    // Ensure IC-Wallet exists (SYSTEM_AGGREGATE)
    const [systemWallet] = await conn.query('SELECT * FROM wallets WHERE type = ?', ['SYSTEM_AGGREGATE']);
    if ((systemWallet as any[]).length === 0) {
      await conn.query('INSERT INTO wallets (type, balance, currency) VALUES (?, ?, ?)', ['SYSTEM_AGGREGATE', 0, 'KSh']);
    }

    // System Settings Table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Insert default values if they don't exist
    const defaultSettings = [
      { key: 'maintenance_mode', value: 'false' },
      { key: 'disallow_logins', value: 'false' },
      { key: 'paybill_number', value: '880100' },
      { key: 'account_number', value: '339025' },
      { key: 'support_email', value: 'p3lcodes@gmail.com' },
      { key: 'app_version', value: '1.1.0' },
      { key: 'primary_theme', value: 'zinc' }
    ];

    for (const setting of defaultSettings) {
      const [existing] = await conn.query('SELECT * FROM system_settings WHERE setting_key = ?', [setting.key]);
      if ((existing as any[]).length === 0) {
        await conn.query('INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)', [setting.key, setting.value]);
      }
    }

    // Check and add managed_pool_id column to users table if missing
    const [cols]: any = await conn.query("SHOW COLUMNS FROM users LIKE 'managed_pool_id'");
    if (cols.length === 0) {
      await conn.query('ALTER TABLE users ADD COLUMN managed_pool_id INT NULL');
      console.log('Added managed_pool_id column to users table.');
    }

    // Reset corrupted portfolios to reflect real wallet balances
    await conn.query(`
      UPDATE portfolios p
      JOIN (
        SELECT userId, SUM(balance) as realVal
        FROM wallets
        WHERE type IN ('POCKET_HOLD', 'POCKET_ALLOCATION', 'POCKET_YIELD')
        GROUP BY userId
      ) w ON p.userId = w.userId
      SET p.currentValue = w.realVal,
          p.netProfit = w.realVal - p.totalInvestment,
          p.todayChange = 0.00,
          p.todayChangePercent = 0.00
    `);
    // Ensure default admin@innercircle.com exists
    const [existingAdmin] = await conn.query('SELECT * FROM users WHERE email = ?', ['admin@innercircle.com']);
    let adminId: number;
    if ((existingAdmin as any[]).length === 0) {
      const adminPassword = await bcrypt.hash('admin123', 10);
      const [res] = await conn.query(
        `INSERT INTO users (fullName, firstName, lastName, email, password, role, isVerified) 
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        ['Admin User', 'Admin', 'User', 'admin@innercircle.com', adminPassword, 'Admin', 1]
      );
      adminId = (res as any).insertId;
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [adminId, 'POCKET_HOLD', 0]);
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [adminId, 'POCKET_ALLOCATION', 0]);
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [adminId, 'POCKET_YIELD', 0]);
      await conn.query(
        'INSERT INTO portfolios (userId, totalInvestment, currentValue, netProfit, todayChange, todayChangePercent) VALUES (?, ?, ?, ?, ?, ?)',
        [adminId, 0, 0, 0, 0, 0]
      );
      console.log('Automatically seeded default Admin user: admin@innercircle.com / admin123');
    }

    // Ensure new admin josephwanjohi508@gmail.com exists
    const [existingWanjohi] = await conn.query('SELECT * FROM users WHERE email = ?', ['josephwanjohi508@gmail.com']);
    let wanjohiId: number;
    const wanjohiPasswordHash = await bcrypt.hash('joseph1010', 10);
    if ((existingWanjohi as any[]).length === 0) {
      const [res] = await conn.query(
        `INSERT INTO users (fullName, firstName, lastName, email, password, role, isVerified) 
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        ['Joseph Wanjohi', 'Joseph', 'Wanjohi', 'josephwanjohi508@gmail.com', wanjohiPasswordHash, 'Admin', 1]
      );
      wanjohiId = (res as any).insertId;
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [wanjohiId, 'POCKET_HOLD', 0]);
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [wanjohiId, 'POCKET_ALLOCATION', 0]);
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [wanjohiId, 'POCKET_YIELD', 0]);
      await conn.query(
        'INSERT INTO portfolios (userId, totalInvestment, currentValue, netProfit, todayChange, todayChangePercent) VALUES (?, ?, ?, ?, ?, ?)',
        [wanjohiId, 0, 0, 0, 0, 0]
      );
      console.log('Automatically seeded new Admin user: josephwanjohi508@gmail.com');
    } else {
      wanjohiId = (existingWanjohi as any[])[0].id;
      await conn.query(
        'UPDATE users SET fullName = ?, password = ?, role = ?, isVerified = 1 WHERE id = ?',
        ['Joseph Wanjohi', wanjohiPasswordHash, 'Admin', wanjohiId]
      );
    }

    // Ensure guyohalakeofficial@gmail.com exists as Investor with proper data
    const [existingGuyo] = await conn.query('SELECT * FROM users WHERE email = ?', ['guyohalakeofficial@gmail.com']);
    let guyoId: number;
    const guyoPasswordHash = await bcrypt.hash('guyesa1010', 10);
    if ((existingGuyo as any[]).length === 0) {
      const [res] = await conn.query(
        `INSERT INTO users (fullName, firstName, lastName, email, password, role, country, isVerified) 
         VALUES (?, ?, ?, ?, ?, 'Investor', ?, 1);`,
        ['Guyo Halake', 'Guyo', 'Halake', 'guyohalakeofficial@gmail.com', guyoPasswordHash, 'Kenya']
      );
      guyoId = (res as any).insertId;
      console.log('Automatically seeded Investor user: guyohalakeofficial@gmail.com');
    } else {
      guyoId = (existingGuyo as any[])[0].id;
      await conn.query(
        'UPDATE users SET fullName = ?, password = ?, role = ?, country = ?, isVerified = 1 WHERE id = ?',
        ['Guyo Halake', guyoPasswordHash, 'Investor', 'Kenya', guyoId]
      );
    }

    // Ensure Guyo Halake has wallets, portfolio and transaction logs
    const [guyoWallets] = await conn.query('SELECT * FROM wallets WHERE userId = ?', [guyoId]);
    if ((guyoWallets as any[]).length === 0) {
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [guyoId, 'POCKET_HOLD', 250000.00]);
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [guyoId, 'POCKET_ALLOCATION', 1000000.00]);
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [guyoId, 'POCKET_YIELD', 15200.00]);
      
      await conn.query(
        `INSERT INTO portfolios (userId, totalInvestment, currentValue, netProfit, todayChange, todayChangePercent) 
         VALUES (?, ?, ?, ?, ?, ?);`,
        [guyoId, 1200000.00, 1265200.00, 65200.00, 480.00, 0.04]
      );

      const txs = [
        { type: 'Deposit', amount: 1200000.00, status: 'Approved', desc: 'Capital deposit via Bank wire', date: '2026-05-10 10:00:00' },
        { type: 'Allocation', amount: 1000000.00, status: 'Approved', desc: 'Asset allocation to Stocks, Forex, and MMF pools', date: '2026-05-11 14:30:00' },
        { type: 'Profit', amount: 15200.00, status: 'Approved', desc: 'Weekly compounding trading pool yield', date: '2026-05-18 18:00:00' },
        { type: 'Withdrawal', amount: 50000.00, status: 'Approved', desc: 'Withdrawal to M-Pesa account', date: '2026-05-20 09:15:00' },
        { type: 'Deposit', amount: 100000.00, status: 'Pending', desc: 'New deposit request via M-Pesa', date: '2026-05-24 11:00:00' }
      ];

      for (const tx of txs) {
        await conn.query(
          `INSERT INTO transactions (userId, type, amount, status, description, createdAt) 
           VALUES (?, ?, ?, ?, ?, ?);`,
          [guyoId, tx.type, tx.amount, tx.status, tx.desc, tx.date]
        );
      }
    }

    // Delete any fake test accounts (Emily Davis, Sara Rashid, Joseph Gitari, Razak Guyo, etc.)
    const emailsToKeep = ['admin@innercircle.com', 'josephwanjohi508@gmail.com', 'guyohalakeofficial@gmail.com'];
    const [allUsersRows] = await conn.query('SELECT id, email FROM users');
    const idsToDelete = (allUsersRows as any[])
      .filter(u => !emailsToKeep.includes(u.email))
      .map(u => u.id);

    if (idsToDelete.length > 0) {
      await conn.query('DELETE FROM wallets WHERE userId IN (?)', [idsToDelete]);
      await conn.query('DELETE FROM portfolios WHERE userId IN (?)', [idsToDelete]);
      await conn.query('DELETE FROM user_pool_investments WHERE user_id IN (?)', [idsToDelete]);
      await conn.query('DELETE FROM transactions WHERE userId IN (?)', [idsToDelete]);
      await conn.query('DELETE FROM users WHERE id IN (?)', [idsToDelete]);
      console.log('Successfully cleaned up dummy test users.');
    }

    // Automatically seed default pools if none exist
    const [pools] = await conn.query('SELECT * FROM portfolio_pools');
    if ((pools as any[]).length === 0) {
      await conn.query(
        `INSERT INTO portfolio_pools (name, category, description, current_yield, total_staked, risk_level, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?),
                (?, ?, ?, ?, ?, ?, ?),
                (?, ?, ?, ?, ?, ?, ?);`,
        [
          'Global Equities Index Pool', 'Stocks', 'Managed diversified equities targeting steady growth with medium-term risk.', 0.1254, 1250000.00, 'Moderate', 1,
          'Alpha Forex Trading Pool', 'Forex', 'High-frequency algorithmic currency pairs trading optimizing for maximum return yield.', 0.1842, 840000.00, 'High', 1,
          'Secure Money Market Fund', 'MMF', 'Low-volatility capital preservation pool allocating into high-yield government paper and treasury bills.', 0.0985, 3200000.00, 'Low', 1
        ]
      );
      console.log('Automatically seeded default portfolio pools.');
    }

    conn.release();
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Database initialization failed:', err);
  }
};

initDb().then(() => {
  initPortfolioScheduler();
});

const app = express();
const server = http.createServer(app);
initSocket(server);

const port = process.env.PORT || 5000;

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    const allowed = [
      process.env.CORS_ORIGIN,
      'http://localhost:3000',
      'http://localhost:8081',
      'http://localhost:19006'
    ].filter(Boolean) as string[];

    const isVercelPreview = origin.endsWith('.vercel.app');
    const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');

    if (allowed.includes(origin) || isVercelPreview || isLocalhost) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

app.use('/uploads', express.static('src/uploads'));

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/chat', chatRoutes);

// Global Error Handler & Forwarder to Python SRE Command Center
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(err.stack || err.message);
  
  fetch('http://127.0.0.1:8000/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      level: 'ERROR',
      message: `[${req.method} ${req.url}] ` + (err.message || err),
      source: 'node-backend'
    })
  }).catch(() => {}); // ignore if Python SRE is down
  
  // Also trigger a critical email alert
  fetch('http://127.0.0.1:8000/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: `Backend Crash on ${req.method} ${req.url}`,
      message: err.stack || err.message,
      critical: true
    })
  }).catch(() => {});
  
  res.status(500).json({ error: 'Internal Server Error' });
});

app.get('/', (req, res) => {
  res.send('InnerCircle Backend is running!');
});

server.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
