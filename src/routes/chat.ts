import express from 'express';
import pool from '../db';
import authenticateToken from '../middleware/authenticateToken';
import logger from '../logger';

const router = express.Router();

// Get messages for a channel
router.get('/messages/:channelId', authenticateToken, async (req: any, res) => {
  const { channelId } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;

  try {
    const [rows] = await pool.query(
      `SELECT m.*, u.fullName as sender_name 
       FROM chat_messages m 
       LEFT JOIN users u ON m.user_id = u.id
       WHERE m.channel_id = ? 
       ORDER BY m.created_at DESC LIMIT ?`,
      [channelId, limit]
    );
    res.json(rows);
  } catch (err: any) {
    logger.error('Failed to fetch messages: ' + err.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send a message
router.post('/messages/:channelId', authenticateToken, async (req: any, res) => {
  const { channelId } = req.params;
  const { content, attached_trade_id } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO chat_messages (channel_id, user_id, content, attached_trade_id) VALUES (?, ?, ?, ?)',
      [channelId, req.user.id, content, attached_trade_id || null]
    );

    const msgId = (result as any).insertId;

    // Fetch the full message with sender name
    const [msgs] = await pool.query(
      `SELECT m.*, u.fullName as sender_name 
       FROM chat_messages m 
       LEFT JOIN users u ON m.user_id = u.id
       WHERE m.id = ?`,
      [msgId]
    );
    const newMsg = (msgs as any[])[0];

    res.status(201).json(newMsg);
  } catch (err: any) {
    logger.error('Failed to send message: ' + err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
