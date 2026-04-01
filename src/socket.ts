import { Server } from 'socket.io';
import http from 'http';
import pool from './db';

let ioInstance: Server;

export const initSocket = (server: http.Server) => {
  const io = new Server(server, {
    cors: {
      origin: ['http://localhost:3000', 'http://localhost:8081', 'http://localhost:19006'],
      methods: ['GET', 'POST'],
    },
  });

  ioInstance = io;

  io.on('connection', (socket) => {
    console.log('a user connected');

    const interval = setInterval(async () => {
      try {
        const [portfolios] = await pool.query('SELECT * FROM portfolios');
        const portfolioList = portfolios as any[];

        for (const portfolio of portfolioList) {
          const movement = (Math.random() - 0.45) * 500;
          const currentValue = parseFloat(portfolio.currentValue);
          const totalInvestment = parseFloat(portfolio.totalInvestment);
          const todayChange = parseFloat(portfolio.todayChange);

          const newValue = currentValue + movement;
          const newProfit = newValue - totalInvestment;
          const newTodayChange = todayChange + movement;
          
          const previousValue = newValue - newTodayChange;
          const newTodayChangePercent = previousValue !== 0 ? (newTodayChange / previousValue) * 100 : 0;

          await pool.query(
            'UPDATE portfolios SET currentValue = ?, netProfit = ?, todayChange = ?, todayChangePercent = ? WHERE id = ?',
            [newValue, newProfit, newTodayChange, newTodayChangePercent, portfolio.id]
          );

          const [updatedPortfolios] = await pool.query('SELECT * FROM portfolios WHERE id = ?', [portfolio.id]);
          const updatedPortfolio = (updatedPortfolios as any)[0];

          io.to(`user-${portfolio.userId}`).emit('portfolioUpdate', updatedPortfolio);
        }
      } catch (error) {
        console.error('Error updating portfolios:', error);
      }
    }, 3000);

    socket.on('join', (userId) => {
      socket.join(`user-${userId}`);
    });

    socket.on('disconnect', () => {
      console.log('user disconnected');
      clearInterval(interval);
    });
  });
};
export const getIo = () => ioInstance;
