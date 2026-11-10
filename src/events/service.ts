import { getClient, query } from '../config/db';

export type EventType =
  | 'RequestCreated'
  | 'OfferSubmitted'
  | 'OfferAccepted'
  | 'DealCreated'
  | 'MessageSent'
  | 'RequestCancelled'
  | 'RequestExpired'
  | 'OfferRejected'
  | 'RequestClosed';

export type ActorTipo = 'HUMAN' | 'AGENT' | 'SYSTEM';

export interface CreateEventInput {
  type: EventType;
  actor_id: string;
  actor_tipo: ActorTipo;
  request_id?: string | null;
  offer_id?: string | null;
  deal_id?: string | null;
  payload: Record<string, unknown>;
}

/**
 * Inserta un evento de trazabilidad.
 * Debe llamarse siempre dentro de la misma transacción que el cambio de estado.
 * Nunca se emite un evento sin que el estado se haya escrito (y viceversa).
 */
export async function emitEvent(input: CreateEventInput, client?: any) {
  const exec = client || (await getClient());
  try {
    const res = await exec.query(
      `INSERT INTO events (type, actor_id, actor_tipo, request_id, offer_id, deal_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, timestamp`,
      [
        input.type,
        input.actor_id,
        input.actor_tipo,
        input.request_id ?? null,
        input.offer_id ?? null,
        input.deal_id ?? null,
        JSON.stringify(input.payload),
      ]
    );
    return res.rows[0];
  } finally {
    if (!client) {
      exec.release();
    }
  }
}

/**
 * Ejecuta una función dentro de una transacción de base de datos.
 * Garantiza que: transición de estado + evento = una sola transacción atómica.
 * Si cualquiera de los dos falla, se hace rollback de todo.
 */
export async function inTransaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
