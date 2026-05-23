const axios = require('axios');
const mysql = require('mysql2/promise');

const API_URL = 'http://localhost:5000';

async function runTest() {
  console.log('--- STARTING PAYMENT WORKFLOW INTEGRATION TEST ---');
  
  // 1. Database Connection to check balances directly
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'innercircle',
    password: 'password123',
    database: 'innercircle'
  });

  try {
    // 2. Fetch initial investor wallet balance
    const [initialWallets] = await connection.query(
      'SELECT type, balance FROM wallets WHERE userId = ?',
      [2] // ID 2 is the seeded investor
    );
    const initialHold = Number(initialWallets.find(w => w.type === 'POCKET_HOLD')?.balance || 0);
    console.log(`Initial Pocket Hold Balance: KSh ${initialHold}`);

    // 3. Login as Investor
    console.log('\nLogging in as investor...');
    const investorLoginRes = await axios.post(`${API_URL}/api/users/login`, {
      email: 'investor@innercircle.com',
      password: 'investor123'
    });
    const investorToken = investorLoginRes.data.token;
    console.log('Investor logged in successfully.');

    // 4. Submit Manual Deposit Request
    console.log('\nSubmitting manual deposit request of KSh 20,000...');
    const depositRes = await axios.post(`${API_URL}/api/payments/deposit-request`, {
      amount: 20000,
      method: 'Manual',
      methodDetails: {
        referenceCode: 'QND5X9Y2P0',
        smsMessage: 'Confirmed. KSh 20,000.00 received. Ref Code: QND5X9Y2P0.',
        screenshotUrl: ''
      }
    }, {
      headers: { Authorization: `Bearer ${investorToken}` }
    });
    
    const transactionId = depositRes.data.transactionId;
    console.log(`Deposit request submitted. Transaction ID: ${transactionId}`);

    // 5. Verify Pending Transaction in Database
    const [txRows] = await connection.query(
      'SELECT * FROM transactions WHERE id = ?',
      [transactionId]
    );
    if (txRows.length === 0 || txRows[0].status !== 'Pending') {
      throw new Error('Transaction was not logged as Pending in database.');
    }
    console.log('Confirmed: Transaction is logged as Pending in DB.');

    // 6. Login as Admin
    console.log('\nLogging in as admin...');
    const adminLoginRes = await axios.post(`${API_URL}/api/users/login`, {
      email: 'admin@innercircle.com',
      password: 'admin123'
    });
    const adminToken = adminLoginRes.data.token;
    console.log('Admin logged in successfully.');

    // 7. Get Pending Transactions List (Admin API)
    console.log('\nFetching pending transactions list via Admin API...');
    const pendingListRes = await axios.get(`${API_URL}/api/admin/transactions/pending`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    
    const hasTx = pendingListRes.data.some(tx => tx.id === transactionId);
    if (!hasTx) {
      throw new Error('Pending deposit was not found in Admin queue.');
    }
    console.log('Confirmed: Pending deposit is visible in Admin queue.');

    // 8. Approve the Deposit
    console.log(`\nApproving deposit transaction ID: ${transactionId}...`);
    await axios.put(`${API_URL}/api/admin/transactions/${transactionId}`, {
      status: 'Approved'
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('Deposit approved by Admin.');

    // 9. Verify Balance Increase in Database
    const [afterDepositWallets] = await connection.query(
      'SELECT type, balance FROM wallets WHERE userId = ?',
      [2]
    );
    const postDepositHold = Number(afterDepositWallets.find(w => w.type === 'POCKET_HOLD')?.balance || 0);
    console.log(`Pocket Hold Balance after Deposit: KSh ${postDepositHold}`);
    if (postDepositHold !== initialHold + 20000) {
      throw new Error(`Balance mismatch! Expected KSh ${initialHold + 20000}, but got KSh ${postDepositHold}`);
    }
    console.log('Confirmed: Investor Pocket Hold balance increased by KSh 20,000 successfully.');

    // 10. Submit Withdrawal Request (Investor)
    console.log('\nSubmitting withdrawal request of KSh 10,000...');
    const withdrawRes = await axios.post(`${API_URL}/api/payments/withdrawal-request`, {
      amount: 10000,
      method: 'M-Pesa',
      methodDetails: { phoneNumber: '254711433902' }
    }, {
      headers: { Authorization: `Bearer ${investorToken}` }
    });
    
    const withdrawalId = withdrawRes.data.transactionId;
    console.log(`Withdrawal request submitted. Transaction ID: ${withdrawalId}`);

    // 11. Approve Withdrawal Payout (Admin)
    console.log(`\nApproving withdrawal transaction ID: ${withdrawalId}...`);
    await axios.put(`${API_URL}/api/admin/transactions/${withdrawalId}`, {
      status: 'Approved'
    }, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('Withdrawal approved by Admin.');

    // 12. Verify Balance Decrease in Database
    const [finalWallets] = await connection.query(
      'SELECT type, balance FROM wallets WHERE userId = ?',
      [2]
    );
    const finalHold = Number(finalWallets.find(w => w.type === 'POCKET_HOLD')?.balance || 0);
    console.log(`Final Pocket Hold Balance: KSh ${finalHold}`);
    if (finalHold !== postDepositHold - 10000) {
      throw new Error(`Balance mismatch! Expected KSh ${postDepositHold - 10000}, but got KSh ${finalHold}`);
    }
    console.log('Confirmed: Investor Pocket Hold balance decreased by KSh 10,000 successfully.');

    console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESS-STATES SECURELY!');

  } catch (err) {
    console.error('\n❌ INTEGRATION TEST FAILED:', err.message || err);
  } finally {
    await connection.end();
  }
}

runTest();
