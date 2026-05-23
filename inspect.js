const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'innercircle',
    password: process.env.DB_PASSWORD || 'password123',
    database: process.env.DB_NAME || 'innercircle'
  });

  try {
    console.log('--- USERS ---');
    const [users] = await connection.query('SELECT id, fullName, email, role, isVerified FROM users');
    console.log(users);

    console.log('--- WALLETS ---');
    const [wallets] = await connection.query('SELECT userId, type, balance FROM wallets');
    console.log(wallets);

    console.log('--- POOLS ---');
    const [pools] = await connection.query('SELECT id, name, total_staked FROM portfolio_pools');
    console.log(pools);

    console.log('--- PORTFOLIOS ---');
    const [portfolios] = await connection.query('SELECT userId, totalInvestment, currentValue, netProfit FROM portfolios');
    console.log(portfolios);

    console.log('--- TRANSACTIONS ---');
    const [txs] = await connection.query('SELECT id, userId, type, amount, status FROM transactions');
    console.log(txs);

  } catch (err) {
    console.error(err);
  } finally {
    await connection.end();
  }
}

main();
