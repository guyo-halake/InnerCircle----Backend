import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const dbHost = process.env.DB_HOST || process.env.MYSQLHOST;
const dbUser = process.env.DB_USER || process.env.MYSQLUSER;
const dbPassword = process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD;
const dbName = process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE;

const pool = mysql.createPool({
  host: dbHost,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export default pool;
