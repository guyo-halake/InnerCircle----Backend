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
    
    // Portfolio Pools (Admin defined)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS portfolio_pools (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category ENUM('Stocks', 'MMF', 'Forex', 'Crypto') NOT NULL,
        description TEXT,
        current_yield DECIMAL(10,4) DEFAULT 0.00,
        total_staked DECIMAL(18,2) DEFAULT 0.00,
        risk_level VARCHAR(50) DEFAULT 'Moderate',
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

    // Transactions
    await conn.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        type ENUM('Deposit', 'Withdrawal', 'Profit', 'Fee') NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        status ENUM('Pending', 'Completed', 'Failed') NOT NULL,
        mpesaCheckoutId VARCHAR(255),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (userId),
        INDEX (mpesaCheckoutId)
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
