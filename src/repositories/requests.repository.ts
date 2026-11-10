import { query, getClient } from '../config/db';
import { emitEvent, inTransaction } from '../events/service';

export type RequestEstado = 'OPEN' | 'NEGOTIATING' | 'CLOSED' | 'EXPIRED' | 'CANCELLED';

export interface RequestData {
  id?: string;
  solicitante_id: string;
  agente_id: string;
  producto: string;
  cantidad: number;
  unidad: string;
  precio_max?: number | null;
  plazo_entrega?: Date | null;
  ubicacion?: string | null;
  categoria?: string | null;
  tags?: string[];
  perfil_solicitante?: string | null;
  estado?: RequestEstado;
  expires_at: Date;
}

export interface RequestRow extends RequestData {
  id: string;
  created_at: Date;
}

/**
 * Crea un Request en estado OPEN y emite RequestCreated.
 * Todo en una sola transacción: write state + emit event.
 */
export async function createRequest(data: RequestData): Promise<RequestRow> {
  return inTransaction(async (client) => {
    const expiresAt = data.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const res = await client.query(
      `INSERT INTO requests (
        solicitante_id, agente_id, producto, cantidad, unidad, precio_max,
        plazo_entrega, ubicacion, categoria, tags, perfil_solicitante,
        estado, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, solicitante_id, agente_id, producto, cantidad, unidad,
                precio_max, plazo_entrega, ubicacion, categoria, tags,
                perfil_solicitante, estado, created_at, expires_at`,
      [
        data.solicitante_id,
        data.agente_id,
        data.producto,
        data.cantidad,
        data.unidad,
        data.precio_max ?? null,
        data.plazo_entrega ?? null,
        data.ubicacion ?? null,
        data.categoria ?? null,
        data.tags ?? [],
        data.perfil_solicitante ?? null,
        'OPEN',
        expiresAt,
      ]
    );

    const row = res.rows[0];

    await emitEvent(
      {
        type: 'RequestCreated',
        actor_id: data.agente_id,
        actor_tipo: 'AGENT',
        request_id: row.id,
        payload: {
          request_id: row.id,
          solicitante_id: data.solicitante_id,
          agente_id: data.agente_id,
          producto: data.producto,
          cantidad: data.cantidad,
          unidad: data.unidad,
          precio_max: data.precio_max ?? null,
          estado: 'OPEN',
        },
      },
      client
    );

    return row;
  });
}

/**
 * Obtiene un Request por id con sus ofertas y mensajes (sala de negociación).
 */
export async function getRequestById(id: string): Promise<RequestRow | null> {
  const res = await query(
    `SELECT id, solicitante_id, agente_id, producto, cantidad, unidad, precio_max,
            plazo_entrega, ubicacion, categoria, tags, perfil_solicitante,
            estado, created_at, expires_at
     FROM requests WHERE id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

/**
 * Lista Requests con filtros opcionales (estado, categoría, agente).
 * Default: solo OPEN (tablero).
 */
export async function listRequests({
  estado = 'OPEN',
  categoria,
  agente_id,
  limit = 50,
  offset = 0,
}: {
  estado?: string;
  categoria?: string;
  agente_id?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<RequestRow[]> {
  const params: any[] = [];
  let where = 'WHERE 1=1';

  if (estado) {
    params.push(estado);
    where += ` AND estado = $${params.length}`;
  }
  if (categoria) {
    params.push(categoria);
    where += ` AND categoria = $${params.length}`;
  }
  if (agente_id) {
    params.push(agente_id);
    where += ` AND agente_id = $${params.length}`;
  }

  params.push(limit, offset);
  const res = await query(
    `SELECT id, solicitante_id, agente_id, producto, cantidad, unidad, precio_max,
            plazo_entrega, ubicacion, categoria, tags, perfil_solicitante,
            estado, created_at, expires_at
     FROM requests ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return res.rows;
}

/**
 * Actualiza el estado de un Request.
 * Si se proporciona un client, se usa dentro de la transacción activa.
 */
export async function updateRequestEstado(
  id: string,
  estado: RequestEstado,
  client?: any
): Promise<RequestRow | null> {
  const exec = client || { query: (text: string, params?: any[]) => query(text, params) };
  const res = await exec.query(
    `UPDATE requests SET estado = $1 WHERE id = $2
     RETURNING id, solicitante_id, agente_id, producto, cantidad, unidad,
               precio_max, plazo_entrega, ubicacion, categoria, tags,
               perfil_solicitante, estado, created_at, expires_at`,
    [estado, id]
  );
  return res.rows[0] ?? null;
}

/**
 * Marca un Request como EXPIRED (pasó expires_at sin cierre).
 */
export async function expireRequest(id: string): Promise<RequestRow | null> {
  return updateRequestEstado(id, 'EXPIRED');
}
