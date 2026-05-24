import { Server } from 'socket.io';
import http from 'http';
import pool from './db';

let ioInstance: Server;

export const initSocket = (server: http.Server) => {
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const allowed = [
          process.env.CORS_ORIGIN,
          'http://localhost:3000',
          'http://localhost:8081',
          'http://localhost:19006'
        ].filter(Boolean) as string[];

        const isVercelPreview = origin.endsWith('.vercel.app');
        const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');

        if (allowed.includes(origin) || isVercelPreview || isLocalhost) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ['GET', 'POST'],
      credentials: true
    },
  });

  ioInstance = io;

  io.on('connection', (socket) => {
    console.log('a user connected');

    socket.on('join', (userId) => {
      socket.join(`user-${userId}`);
    });

    socket.on('disconnect', () => {
      console.log('user disconnected');
    });
  });
};
export const getIo = () => ioInstance;
