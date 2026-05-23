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

    socket.on('join', (userId) => {
      socket.join(`user-${userId}`);
    });

    socket.on('disconnect', () => {
      console.log('user disconnected');
    });
  });
};
export const getIo = () => ioInstance;
