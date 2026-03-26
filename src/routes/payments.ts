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

    res.json({ message: 'STK Push sent to your phone.', result: response.data });
  } catch (err: any) {
    logger.error('STK Push failed: ' + err.message);
    res.status(500).json({ error: 'Payment request failed' });
  }
});

// Route: M-Pesa Callback (For real automated balance updating)
router.post('/callback', async (req, res) => {
  const callbackData = req.body.Body.stkCallback;
  if (callbackData.ResultCode === 0) {
    // Payment Successful
    const amount = callbackData.CallbackMetadata.Item.find((i: any) => i.Name === 'Amount').Value;
    const phone = callbackData.CallbackMetadata.Item.find((i: any) => i.Name === 'PhoneNumber').Value;
    
    // In a real app, you'd match this phone to a user and update their portfolio balance
    logger.info(`Payment received: ${amount} from ${phone}`);
  }
  res.sendStatus(200);
});

export default router;
