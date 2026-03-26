import express from 'express';
import axios from 'axios';
import pool from '../db';
import authenticateToken from '../middleware/authenticateToken';
import logger from '../logger';

const router = express.Router();

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || 'your_key';
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || 'your_secret';
const SHORTCODE = process.env.MPESA_SHORTCODE || '174379';
const PASSKEY = process.env.MPESA_PASSKEY || 'your_passkey';

// Helper: Get M-Pesa OAuth Token
const getAccessToken = async () => {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  try {
    const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${auth}` }
    });
    return response.data.access_token;
  } catch (err: any) {
    logger.error('M-Pesa auth failed: ' + err.message);
    throw new Error('M-Pesa authentication failed');
  }
};

// Route: STK Push (Deposit)
router.post('/stk-push', authenticateToken, async (req: any, res) => {
  const { amount, phoneNumber } = req.body;
  if (!amount || !phoneNumber) return res.status(400).json({ error: 'Amount and phone required' });

  try {
    const token = await getAccessToken();
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

    const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: SHORTCODE,
      PhoneNumber: phoneNumber,
      CallBackURL: `${process.env.API_URL}/api/payments/callback`,
      AccountReference: 'InnerCircle Investment',
      TransactionDesc: 'Deposit to InnerCircle Portfolio'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const { CheckoutRequestID } = response.data;

    // Store a pending transaction
    await pool.query(
      'INSERT INTO transactions (userId, type, amount, status, mpesaCheckoutId) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'Deposit', amount, 'Pending', CheckoutRequestID]
    );

    res.json({ message: 'STK Push sent to your phone.', result: response.data, checkoutRequestId: CheckoutRequestID });
  } catch (err: any) {
    logger.error('STK Push failed: ' + err.message);
    res.status(500).json({ error: 'Payment request failed' });
  }
});

// Route: M-Pesa Callback (For real automated balance updating)
router.post('/callback', async (req: any, res) => {
  try {
    const callbackData = req.body.Body.stkCallback;
    const checkoutRequestId = callbackData.CheckoutRequestID;
    const resultCode = callbackData.ResultCode;

    if (resultCode === 0) {
      // Payment Successful
      const metadataItems = callbackData.CallbackMetadata.Item;
      const amount = metadataItems.find((i: any) => i.Name === 'Amount').Value;
      const mpesaReceipt = metadataItems.find((i: any) => i.Name === 'MpesaReceiptNumber').Value;
      
      logger.info(`Payment Successful: ${amount} for CheckoutID: ${checkoutRequestId}, Receipt: ${mpesaReceipt}`);

      // 1. Get the userId for this transaction
      const [transactions] = await pool.query('SELECT * FROM transactions WHERE mpesaCheckoutId = ?', [checkoutRequestId]);
      const txList = transactions as any[];
      
      if (txList.length > 0) {
        const userId = txList[0].userId;

        // 2. Update Transaction Status
        await pool.query(
          'UPDATE transactions SET status = ? WHERE mpesaCheckoutId = ?',
          ['Completed', checkoutRequestId]
        );

        // 3. Update Portfolio
        // We increase both totalInvestment and currentValue
        await pool.query(
          'UPDATE portfolios SET totalInvestment = totalInvestment + ?, currentValue = currentValue + ? WHERE userId = ?',
          [amount, amount, userId]
        );

        logger.info(`Portfolio updated for user ${userId} with +${amount}`);
      } else {
        logger.error(`No transaction found for CheckoutID: ${checkoutRequestId}`);
      }
    } else {
      // Payment Failed
      logger.warn(`Payment failed or cancelled for CheckoutID: ${checkoutRequestId}. ResultCode: ${resultCode}`);
      await pool.query(
        'UPDATE transactions SET status = ? WHERE mpesaCheckoutId = ?',
        ['Failed', checkoutRequestId]
      );
    }
  } catch (err: any) {
    logger.error('Error in M-Pesa Callback: ' + err.message);
  }
  
  res.sendStatus(200);
});

export default router;
