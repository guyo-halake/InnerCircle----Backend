import pool from '../db';
import logger from '../logger';

/**
 * Perform the actual database logging of active investor portfolio valuations.
 */
async function logDailyPortfolioValuations() {
  try {
    logger.info('Running scheduled portfolio valuation logging...');
    
    // Insert or update today's current portfolio valuation for all investors
    const [result] = await pool.query(`
      INSERT INTO portfolio_history (userId, value, recorded_at)
      SELECT u.id, COALESCE(p.currentValue, 0.00), CURRENT_DATE()
      FROM users u
      LEFT JOIN portfolios p ON u.id = p.userId
      WHERE u.role = 'Investor'
      ON DUPLICATE KEY UPDATE value = VALUES(value)
    `);

    logger.info('Daily portfolio valuation logging completed successfully.');
  } catch (err: any) {
    logger.error('Failed to log daily portfolio valuations: ' + err.message);
  }
}

/**
 * Start the daily scheduler.
 * Performs a startup check/run for today, then schedules a nightly run at 00:00 midnight.
 */
export const initPortfolioScheduler = async () => {
  logger.info('Initializing portfolio scheduler...');

  // 1. Startup check: Run once on boot to ensure today has at least one entry
  try {
    const [existingToday]: any = await pool.query(
      'SELECT id FROM portfolio_history WHERE recorded_at = CURRENT_DATE() LIMIT 1'
    );
    if (existingToday.length === 0) {
      logger.info('No portfolio history entries found for today. Running initial logging...');
      await logDailyPortfolioValuations();
    } else {
      logger.info('Today\'s portfolio history entries already exist.');
    }
  } catch (err: any) {
    logger.error('Error during startup portfolio scheduler check: ' + err.message);
  }

  // 2. Schedule nightly run at 00:00:05
  const scheduleNextMidnight = () => {
    const now = new Date();
    const nextMidnight = new Date(now);
    
    // Set to next calendar day at 00:00:05
    nextMidnight.setDate(now.getDate() + 1);
    nextMidnight.setHours(0, 0, 5, 0);

    const msUntilMidnight = nextMidnight.getTime() - now.getTime();
    logger.info(`Next nightly portfolio sync scheduled in ${(msUntilMidnight / 1000 / 60 / 60).toFixed(2)} hours (at ${nextMidnight.toISOString()})`);

    setTimeout(async () => {
      await logDailyPortfolioValuations();
      // After first midnight run, schedule next run
      scheduleNextMidnight();
    }, msUntilMidnight);
  };

  scheduleNextMidnight();
};
