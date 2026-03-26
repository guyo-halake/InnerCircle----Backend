import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { initSocket } from './socket';
import userRoutes from './routes/users';
import portfolioRoutes from './routes/portfolios';
import logger from './logger';

dotenv.config();

// Validate required environment variables
const requiredEnv = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
requiredEnv.forEach(env => {
  if (!process.env[env]) {
    console.error(`Missing required environment variable: ${env}`);
    process.exit(1);
  }
});

const app = express();
const server = http.createServer(app);
initSocket(server);

const port = process.env.PORT || 5000;

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

app.use('/uploads', express.static('src/uploads'));

app.use('/api/users', userRoutes);
app.use('/api/portfolio', portfolioRoutes);

app.get('/', (req, res) => {
  res.send('InnerCircle Backend is running!');
});

server.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
