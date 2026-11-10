import { pool } from '../src/config/db';
import { query } from '../src/config/db';

/**
 * Esquema SQL para desarrollo y tests (fase 1, off-chain).
 * NOTA: El DDL oficial vive en otro proyecto/rama (instrucción del usuario).
 * Este archivo es solo para validación local del slice E2E.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitante_id TEXT NOT NULL,
  agente_id TEXT NOT NULL,
  producto TEXT NOT NULL,
  cantidad NUMERIC NOT NULL,
  unidad TEXT NOT NULL,
  precio_max NUMERIC,
  plazo_entrega TIMESTAMPTZ,
  ubicacion TEXT,
  categoria TEXT,
  tags TEXT[] DEFAULT '{}',
  perfil_solicitante TEXT CHECK (perfil_solicitante IN ('emprendedor','comercio','pyme','empresa')),
  estado TEXT NOT NULL DEFAULT 'OPEN' CHECK (estado IN ('OPEN','NEGOTIATING','CLOSED','EXPIRED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  oferente_id TEXT NOT NULL,
  agente_oferente_id TEXT,
  precio NUMERIC NOT NULL,
  cantidad NUMERIC NOT NULL,
  condiciones_entrega TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'PENDING' CHECK (estado IN ('PENDING','ACCEPTED','REJECTED','WITHDRAWN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  autor_id TEXT NOT NULL,
  autor_tipo TEXT NOT NULL CHECK (autor_tipo IN ('HUMAN','AGENT')),
  tipo TEXT NOT NULL CHECK (tipo IN ('TEXT','OFFER','COUNTER_OFFER','ACCEPT','REJECT')),
  contenido TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  precio_final NUMERIC NOT NULL,
  condiciones_finales TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'PENDING_ESCROW' CHECK (estado IN ('PENDING_ESCROW','IN_ESCROW','DELIVERED','SETTLED','DISPUTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_tipo TEXT NOT NULL CHECK (actor_tipo IN ('HUMAN','AGENT','SYSTEM')),
  request_id UUID REFERENCES requests(id),
  offer_id UUID REFERENCES offers(id),
  deal_id UUID REFERENCES deals(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_mandates (
  agente_id TEXT PRIMARY KEY,
  negocio_id TEXT NOT NULL,
  gasto_max_por_operacion NUMERIC NOT NULL,
  gasto_max_acumulado NUMERIC NOT NULL,
  gasto_ventana_tiempo INTERVAL NOT NULL,
  rango_precio_aceptable_min NUMERIC,
  rango_precio_aceptable_max NUMERIC,
  plazo_max_entrega INTERVAL,
  whitelist_contrapartes TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_requests_estado ON requests(estado);
CREATE INDEX IF NOT EXISTS idx_requests_categoria ON requests(categoria);
CREATE INDEX IF NOT EXISTS idx_requests_solicitante ON requests(solicitante_id);
CREATE INDEX IF NOT EXISTS idx_requests_agente ON requests(agente_id);
CREATE INDEX IF NOT EXISTS idx_requests_expires_at ON requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_offers_request ON offers(request_id);
CREATE INDEX IF NOT EXISTS idx_offers_estado ON offers(estado);
CREATE INDEX IF NOT EXISTS idx_messages_request ON messages(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deals_request ON deals(request_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_request ON events(request_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);

CREATE OR REPLACE FUNCTION messages_immutable()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM messages
    WHERE id = NEW.id
      AND (NEW.contenido IS DISTINCT FROM OLD.contenido
        OR NEW.tipo IS DISTINCT FROM OLD.tipo
        OR NEW.autor_id IS DISTINCT FROM OLD.autor_id
        OR NEW.autor_tipo IS DISTINCT FROM OLD.autor_tipo)
  ) THEN
    RAISE EXCEPTION 'Message es inmutable: id=%', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_immutable ON messages;
CREATE TRIGGER trg_messages_immutable
BEFORE UPDATE ON messages
FOR EACH ROW EXECUTE FUNCTION messages_immutable();

INSERT INTO agent_mandates (
  agente_id, negocio_id, gasto_max_por_operacion, gasto_max_acumulado,
  gasto_ventana_tiempo, rango_precio_aceptable_min, rango_precio_aceptable_max,
  plazo_max_entrega, whitelist_contrapartes
) VALUES (
  'agente_negocio_1', 'negocio_1', 50000, 200000, '30 days', 1, 100000, '7 days', '{}'
) ON CONFLICT (agente_id) DO NOTHING;
`;

export async function setupDatabase() {
  await query(SCHEMA_SQL);
}

export async function teardownDatabase() {
  await query('TRUNCATE TABLE events, deals, offers, messages, requests, agent_mandates RESTART IDENTITY CASCADE');
  await pool.end();
}
