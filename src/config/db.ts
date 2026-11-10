import { Pool } from 'pg';

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'labagent',
  password: process.env.DB_PASSWORD || 'labagent',
  database: process.env.DB_NAME || 'labagent',
});

pool.on('connect', () => {
  // console.log('Conectado a PostgreSQL');
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

export async function query(text: string, params?: any[]) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  // console.log('Executed query', { text: text.substring(0, 100), duration, rows: res.rowCount });
  return res;
}

export async function getClient() {
  return pool.connect();
}

export async function closePool() {
  await pool.end();
}
