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
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

app.use('/uploads', express.static('src/uploads'));

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);

app.get('/', (req, res) => {
  res.send('InnerCircle Backend is running!');
});

server.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
