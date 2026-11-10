import { query } from '../config/db';
import { emitEvent, inTransaction } from '../events/service';

export type DealEstado = 'PENDING_ESCROW' | 'IN_ESCROW' | 'DELIVERED' | 'SETTLED' | 'DISPUTED';

export interface DealData {
  id?: string;
  request_id: string;
  offer_id: string;
  precio_final: number;
  condiciones_finales?: string;
  estado?: DealEstado;
}

export interface DealRow extends DealData {
  id: string;
  created_at: Date;
}

function toDealRow(row: any): DealRow {
  return {
    ...row,
    precio_final: row.precio_final !== null ? Number(row.precio_final) : null,
  };
}

/**
 * Crea un Deal en estado PENDING_ESCROW y emite DealCreated.
 * Se llama dentro de la transacción de cierre del deal.
 */
export async function createDeal(
  data: DealData,
  client: any
): Promise<DealRow> {
  const res = await client.query(
    `INSERT INTO deals (
      request_id, offer_id, precio_final, condiciones_finales, estado
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING id, request_id, offer_id, precio_final, condiciones_finales,
              estado, created_at`,
    [
      data.request_id,
      data.offer_id,
      data.precio_final,
      data.condiciones_finales ?? '',
      'PENDING_ESCROW',
    ]
  );

  const row = res.rows[0];

  await emitEvent(
    {
      type: 'DealCreated',
      actor_id: 'system',
      actor_tipo: 'SYSTEM',
      request_id: data.request_id,
      offer_id: data.offer_id,
      deal_id: row.id,
      payload: {
        deal_id: row.id,
        request_id: data.request_id,
        offer_id: data.offer_id,
        precio_final: data.precio_final,
        estado: 'PENDING_ESCROW',
      },
    },
    client
  );

  return toDealRow(row);
}

/**
 * Obtiene un Deal por id.
 */
export async function getDealById(id: string): Promise<DealRow | null> {
  const res = await query(
    `SELECT id, request_id, offer_id, precio_final, condiciones_finales,
            estado, created_at
     FROM deals WHERE id = $1`,
    [id]
  );
  return res.rows[0] ? toDealRow(res.rows[0]) : null;
}

/**
 * Obtiene el Deal asociado a un request.
 */
export async function getDealByRequest(request_id: string): Promise<DealRow | null> {
  const res = await query(
    `SELECT id, request_id, offer_id, precio_final, condiciones_finales,
            estado, created_at
     FROM deals WHERE request_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [request_id]
  );
  return res.rows[0] ? toDealRow(res.rows[0]) : null;
}
