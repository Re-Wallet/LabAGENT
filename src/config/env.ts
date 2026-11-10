export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
  DB_USER: process.env.DB_USER || 'labagent',
  DB_PASSWORD: process.env.DB_PASSWORD || 'labagent',
  DB_NAME: process.env.DB_NAME || 'labagent',

  // AgentMandate defaults (off-chain, fase 1)
  AGENTE_ID: process.env.AGENTE_ID || 'agente_negocio_1',
  NEGOCIO_ID: process.env.NEGOCIO_ID || 'negocio_1',
  GASTO_MAX_POR_OPERACION: parseFloat(process.env.GASTO_MAX_POR_OPERACION || '50000'),
  GASTO_MAX_ACUMULADO: parseFloat(process.env.GASTO_MAX_ACUMULADO || '200000'),
  GASTO_VENTANA_TIEMPO_DIAS: parseInt(process.env.GASTO_VENTANA_TIEMPO_DIAS || '30', 10),
  RANGO_PRECIO_MIN: parseFloat(process.env.RANGO_PRECIO_MIN || '1'),
  RANGO_PRECIO_MAX: parseFloat(process.env.RANGO_PRECIO_MAX || '100000'),
  PLAZO_MAX_ENTREGA_DIAS: parseInt(process.env.PLAZO_MAX_ENTREGA_DIAS || '7', 10),
};
