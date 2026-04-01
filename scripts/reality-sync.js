const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function sync() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'innercircle'
  });

  console.log('--- STARTING REALITY SYNC ---');

  try {
    // 1. Update Users Table Schema
    console.log('Syncing users table schema...');
    
    const tables = await connection.query("SHOW TABLES LIKE 'users'");
    if (tables[0].length === 0) {
      await connection.query(`
        CREATE TABLE users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          fullName VARCHAR(255) NOT NULL,
          lastName VARCHAR(255),
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          phone VARCHAR(20),
          avatarUrl VARCHAR(255),
          role ENUM('Admin', 'Developer', 'Investor') DEFAULT 'Investor',
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      // Check existing columns and add if missing
      const [columns] = await connection.query("SHOW COLUMNS FROM users");
      const columnNames = columns.map(c => c.Field);

      const addCol = async (name, def) => {
        if (!columnNames.includes(name)) {
          console.log(`Adding column ${name}...`);
          await connection.query(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
        }
      };

      await addCol('fullName', 'VARCHAR(255) NOT NULL AFTER id');
      await addCol('lastName', 'VARCHAR(255) AFTER fullName');
      await addCol('phone', 'VARCHAR(20) AFTER password');
      await addCol('avatarUrl', 'VARCHAR(255) AFTER phone');
      await addCol('role', "ENUM('Admin', 'Developer', 'Investor') DEFAULT 'Investor' AFTER avatarUrl");
      await addCol('bankName', 'VARCHAR(255)');
      await addCol('bankAccountName', 'VARCHAR(255)');
      await addCol('bankAccountNumber', 'VARCHAR(255)');
      await addCol('mpesaNumber', 'VARCHAR(20)');
      await addCol('cryptoAddress', 'VARCHAR(255)');
    }

    // 2. Ensure System Financials Table (Inner Circle Institutional Accounts)
    console.log('Syncing system_financials table...');
    await connection.query(`
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

    // Clear and re-populate institutional details to ensure "Reality"
    await connection.query("DELETE FROM system_financials");
    await connection.query(`
      INSERT INTO system_financials (name, category, accountName, accountNumber, paybill, logoUrl) VALUES
      ('Equity Bank', 'Bank', 'INNER CIRCLE VENTURES LTD', '1234567890123', NULL, 'https://upload.wikimedia.org/wikipedia/commons/a/a2/Equity_Bank_Logo.png'),
      ('KCB Bank', 'Bank', 'INNER CIRCLE LIMITED', '0987654321', NULL, 'https://upload.wikimedia.org/wikipedia/en/2/2a/KCB_Bank_Kenya_Logo.png'),
      ('M-Pesa STK', 'Mobile', 'Inner Circle', NULL, '542542', 'https://upload.wikimedia.org/wikipedia/commons/1/15/M-PESA_LOGO-01.svg'),
      ('Binance Pay', 'Crypto', 'InnerCircle_Operations', '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', NULL, 'https://upload.wikimedia.org/wikipedia/commons/5/57/Binance_Logo.svg'),
      ('PayPal Institutional', 'PayPal', 'treasury@innercircle.com', NULL, NULL, 'https://upload.wikimedia.org/wikipedia/commons/b/b5/PayPal.svg')
    `);

    // 3. Ensure User Payment Details (For Investors' own accounts)
    console.log('Syncing user_payment_plans table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_payment_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        provider VARCHAR(100) NOT NULL,
        accountName VARCHAR(255),
        accountNumber VARCHAR(255),
        isDefault TINYINT(1) DEFAULT 0,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 4. Ensure Wallets Table (Institutional 3-Pocket System)
    console.log('Syncing wallets table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        type ENUM('POCKET_HOLD', 'POCKET_ALLOCATION', 'POCKET_YIELD') NOT NULL,
        balance DECIMAL(20, 2) DEFAULT 0.00,
        currency VARCHAR(10) DEFAULT 'KSh',
        lastUpdated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (userId),
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // 5. Seed Real Entities
    console.log('Seeding real identities...');
    const seedUsers = [
      { fullName: 'Guy Halake', lastName: 'Halake', email: 'guyoh@innercircle.com', phone: '0712345678', role: 'Admin', initialHold: 5000000 },
      { fullName: 'Sarah Kamau', lastName: 'Kamau', email: 'sarah.k@investor.com', phone: '0722001122', role: 'Investor', initialHold: 1200000 },
      { fullName: 'David Mutua', lastName: 'Mutua', email: 'david.m@institutional.co.ke', phone: '0733445566', role: 'Investor', initialHold: 8500000 },
      { fullName: 'Linda Otieno', lastName: 'Otieno', email: 'linda.o@alpha.com', phone: '0744778899', role: 'Investor', initialHold: 450000 }
    ];

    for (const u of seedUsers) {
      // Use email as unique identifier
      const [existing] = await connection.query("SELECT id FROM users WHERE email = ?", [u.email]);
      let userId;
      if (existing.length === 0) {
        const [result] = await connection.query(
          "INSERT INTO users (fullName, lastName, email, password, phone, role) VALUES (?, ?, ?, ?, ?, ?)",
          [u.fullName, u.lastName, u.email, 'password123', u.phone, u.role]
        );
        userId = result.insertId;
      } else {
        userId = existing[0].id;
        await connection.query("UPDATE users SET fullName = ?, lastName = ?, phone = ?, role = ? WHERE id = ?", 
          [u.fullName, u.lastName, u.phone, u.role, userId]);
      }

      // Ensure 3 Pockets exist for each user
      const pockets = ['POCKET_HOLD', 'POCKET_ALLOCATION', 'POCKET_YIELD'];
      for (const p of pockets) {
        const [wallet] = await connection.query("SELECT id FROM wallets WHERE userId = ? AND type = ?", [userId, p]);
        let initialBal = (p === 'POCKET_HOLD') ? u.initialHold : 0;
        if (wallet.length === 0) {
          await connection.query("INSERT INTO wallets (userId, type, balance) VALUES (?, ?, ?)", [userId, p, initialBal]);
        } else {
          await connection.query("UPDATE wallets SET balance = ? WHERE userId = ? AND type = ?", [initialBal, userId, p]);
        }
      }
    }

    // 6. Seed Realistic Transaction History
    console.log('Syncing transaction history schema...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT,
        amount DECIMAL(20,2),
        type VARCHAR(50),
        status VARCHAR(50),
        description TEXT,
        approvedBy INT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure description column exists if table existed
    const [tCols] = await connection.query("SHOW COLUMNS FROM transactions");
    const tColNames = tCols.map(c => c.Field);
    if (!tColNames.includes('description')) {
      await connection.query("ALTER TABLE transactions ADD COLUMN description TEXT AFTER status");
    }
    
    // Clear old transactions for these users to keep it fresh
    await connection.query("DELETE FROM transactions");

    const [sarah] = await connection.query("SELECT id FROM users WHERE email = 'sarah.k@investor.com'");
    const [david] = await connection.query("SELECT id FROM users WHERE email = 'david.m@institutional.co.ke'");
    const [admin] = await connection.query("SELECT id FROM users WHERE role = 'Admin' LIMIT 1");

    if (sarah.length > 0 && david.length > 0 && admin.length > 0) {
      const adminId = admin[0].id;
      const tData = [
        { userId: sarah[0].id, amount: 500000, type: 'Deposit', status: 'Approved', desc: 'Initial Institutional Funding', approver: adminId },
        { userId: sarah[0].id, amount: 20000, type: 'Yield distribution', status: 'Approved', desc: 'Monthly ROI - March', approver: adminId },
        { userId: david[0].id, amount: 8500000, type: 'Deposit', status: 'Approved', desc: 'Institutional Asset Transfer', approver: adminId },
        { userId: david[0].id, amount: 150000, type: 'Withdrawal', status: 'Pending', desc: 'Operational Capital Withdrawal', approver: null }
      ];

      for (const t of tData) {
        await connection.query(
          "INSERT INTO transactions (userId, amount, type, status, description, approvedBy) VALUES (?, ?, ?, ?, ?, ?)",
          [t.userId, t.amount, t.type, t.status, t.desc, t.approver]
        );
      }
    }

    console.log('--- REALITY SYNC COMPLETE ---');
    process.exit(0);
  } catch (error) {
    console.error('SYNC ERROR:', error);
    process.exit(1);
  }
}

sync();
