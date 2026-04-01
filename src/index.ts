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

    conn.release();
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Database initialization failed:', err);
  }
};

initDb();

const app = express();
const server = http.createServer(app);
initSocket(server);

const port = process.env.PORT || 5000;

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests from web app, mobile app (null origin), and configured origin
    const allowed = [process.env.CORS_ORIGIN || 'http://localhost:3000', 'http://localhost:8081', 'http://localhost:19006'];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in dev
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

app.get('/', (req, res) => {
  res.send('InnerCircle Backend is running!');
});

server.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
