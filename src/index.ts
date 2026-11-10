import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { pool } from './config/db';
import { env } from './config/env';

import requestRoutes from './routes/requests';
import { obtenerReputacion } from './controllers/requests.controller';

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.use('/requests', requestRoutes);

// GET /reputacion/:agenteId — reputación básica off-chain por agente
app.get('/reputacion/:agenteId', obtenerReputacion);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'disconnected' });
  }
});

if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`LabAGENT mercado interno corriendo en http://localhost:${env.PORT}`);
  });
}

export default app;
