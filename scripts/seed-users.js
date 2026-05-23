const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'innercircle',
  password: 'password123',
  database: 'innercircle',
});

async function main() {
  const conn = await pool.getConnection();
  try {
    const adminPassword = await bcrypt.hash('admin123', 10);
    const investorPassword = await bcrypt.hash('investor123', 10);

    // 1. Seed Admin User
    const [adminCheck] = await conn.query('SELECT id FROM users WHERE email = ?', ['admin@innercircle.com']);
    if (adminCheck.length === 0) {
      const [adminRes] = await conn.query(
        `INSERT INTO users (fullName, firstName, lastName, email, password, role, isVerified) 
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        ['Admin User', 'Admin', 'User', 'admin@innercircle.com', adminPassword, 'Admin', 1]
      );
      const adminId = adminRes.insertId;
      // Setup empty wallets/portfolio for Admin
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [adminId, 'POCKET_HOLD', 0]);
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [adminId, 'POCKET_ALLOCATION', 0]);
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [adminId, 'POCKET_YIELD', 0]);
      await conn.query(
        'INSERT INTO portfolios (userId, totalInvestment, currentValue, netProfit, todayChange, todayChangePercent) VALUES (?, ?, ?, ?, ?, ?)',
        [adminId, 0, 0, 0, 0, 0]
      );
      console.log('Admin user seeded: admin@innercircle.com / admin123');
    } else {
      console.log('Admin user already exists');
    }

    // 2. Seed Investor User
    const [investorCheck] = await conn.query('SELECT id FROM users WHERE email = ?', ['investor@innercircle.com']);
    if (investorCheck.length === 0) {
      const [investorRes] = await conn.query(
        `INSERT INTO users (fullName, firstName, lastName, email, password, role, isVerified) 
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        ['Investor User', 'Investor', 'User', 'investor@innercircle.com', investorPassword, 'Investor', 1]
      );
      const investorId = investorRes.insertId;
      // Setup some default balances and investments for the Investor
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [investorId, 'POCKET_HOLD', 50000]);
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [investorId, 'POCKET_ALLOCATION', 35000]);
      await conn.query('INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)', [investorId, 'POCKET_YIELD', 1200]);
      await conn.query(
        'INSERT INTO portfolios (userId, totalInvestment, currentValue, netProfit, todayChange, todayChangePercent) VALUES (?, ?, ?, ?, ?, ?)',
        [investorId, 85000, 86200, 1200, 150, 0.17]
      );
      console.log('Investor user seeded: investor@innercircle.com / investor123');
    } else {
      console.log('Investor user already exists');
    }

  } catch (err) {
    console.error('Error seeding users:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();
