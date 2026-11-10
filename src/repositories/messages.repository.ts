import { query, getClient } from '../config/db';
import { emitEvent, inTransaction } from '../events/service';

export type MensajeTipo = 'TEXT' | 'OFFER' | 'COUNTER_OFFER' | 'ACCEPT' | 'REJECT';
export type AutorTipo = 'HUMAN' | 'AGENT';

export interface MessageData {
  id?: string;
  request_id: string;
  autor_id: string;
  autor_tipo: AutorTipo;
  tipo: MensajeTipo;
  contenido: string;
}

export interface MessageRow extends MessageData {
  id: string;
  created_at: Date;
}

/**
 * Crea un Message (inmutable) y emite MessageSent.
 * Inmutabilidad garantizada también por trigger de BD (I4).
 */
export async function createMessage(data: MessageData): Promise<MessageRow> {
  return inTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO messages (
        request_id, autor_id, autor_tipo, tipo, contenido
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, request_id, autor_id, autor_tipo, tipo, contenido, created_at`,
      [
        data.request_id,
        data.autor_id,
        data.autor_tipo,
        data.tipo,
        data.contenido,
      ]
    );

    const row = res.rows[0];

    await emitEvent(
      {
        type: 'MessageSent',
        actor_id: data.autor_id,
        actor_tipo: data.autor_tipo,
        request_id: data.request_id,
        payload: {
          message_id: row.id,
          request_id: data.request_id,
          autor_id: data.autor_id,
          autor_tipo: data.autor_tipo,
          tipo: data.tipo,
        },
      },
      client
    );

    return row;
  });
}

/**
 * Obtiene todos los mensajes de un request (sala de negociación).
 */
export async function listMessagesByRequest(request_id: string): Promise<MessageRow[]> {
  const res = await query(
    `SELECT id, request_id, autor_id, autor_tipo, tipo, contenido, created_at
     FROM messages WHERE request_id = $1
     ORDER BY created_at ASC`,
    [request_id]
  );
  return res.rows;
}
