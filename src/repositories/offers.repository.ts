import { query } from '../config/db';
import { emitEvent, inTransaction } from '../events/service';

export type OfferEstado = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';

export interface OfferData {
  id?: string;
  request_id: string;
  oferente_id: string;
  agente_oferente_id?: string | null;
  precio: number;
  cantidad: number;
  condiciones_entrega?: string;
  estado?: OfferEstado;
}

export interface OfferRow extends OfferData {
  id: string;
  created_at: Date;
}

function toOfferRow(row: any): OfferRow {
  return {
    ...row,
    precio: row.precio !== null ? Number(row.precio) : null,
    cantidad: row.cantidad !== null ? Number(row.cantidad) : null,
  };
}

/**
 * Crea una Offer en estado PENDING y emite OfferSubmitted.
 * Cuando se acepta la primera oferta, el Request pasa a NEGOTIATING.
 */
export async function createOffer(data: OfferData): Promise<OfferRow> {
  return inTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO offers (
        request_id, oferente_id, agente_oferente_id, precio, cantidad,
        condiciones_entrega, estado
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, request_id, oferente_id, agente_oferente_id, precio,
                cantidad, condiciones_entrega, estado, created_at`,
      [
        data.request_id,
        data.oferente_id,
        data.agente_oferente_id ?? null,
        data.precio,
        data.cantidad,
        data.condiciones_entrega ?? '',
        'PENDING',
      ]
    );

    const row = res.rows[0];

    // El request pasa a NEGOTIATING cuando recibe la primera oferta
    await client.query(
      `UPDATE requests SET estado = 'NEGOTIATING' WHERE id = $1 AND estado = 'OPEN'`,
      [data.request_id]
    );

    await emitEvent(
      {
        type: 'OfferSubmitted',
        actor_id: data.oferente_id,
        actor_tipo: 'AGENT',
        request_id: data.request_id,
        offer_id: row.id,
        payload: {
          offer_id: row.id,
          request_id: data.request_id,
          oferente_id: data.oferente_id,
          precio: data.precio,
          cantidad: data.cantidad,
          estado: 'PENDING',
        },
      },
      client
    );

    return toOfferRow(row);
  });
}

/**
 * Obtiene todas las ofertas de un request.
 */
export async function listOffersByRequest(request_id: string): Promise<OfferRow[]> {
  const res = await query(
    `SELECT id, request_id, oferente_id, agente_oferente_id, precio, cantidad,
            condiciones_entrega, estado, created_at
     FROM offers WHERE request_id = $1
     ORDER BY created_at ASC`,
    [request_id]
  );
  return res.rows.map(toOfferRow);
}

/**
 * Acepta una oferta: marca ACCEPTED, rechaza las demás PENDING del mismo request.
 * Se llama desde el servicio de cierre de deal (transacción mayor).
 */
export async function acceptOffer(
  offerId: string,
  client: any
): Promise<OfferRow> {
  // Verificar que no exista otra ACCEPTED para este request (unicidad)
  const oferta = await client.query(
    `SELECT id, request_id, oferente_id, estado FROM offers WHERE id = $1`,
    [offerId]
  );
  const row = oferta.rows[0];
  if (!row) throw new Error(`Oferta no encontrada: ${offerId}`);
  if (row.estado !== 'PENDING') {
    throw new Error(`La oferta ${offerId} no está en estado PENDING (actual: ${row.estado})`);
  }

  const yaAceptada = await client.query(
    `SELECT id FROM offers WHERE request_id = $1 AND estado = 'ACCEPTED'`,
    [row.request_id]
  );
  if (yaAceptada.rows.length > 0) {
    throw new Error(`Ya existe una oferta ACCEPTED para el request ${row.request_id}`);
  }

  await client.query(
    `UPDATE offers SET estado = 'ACCEPTED' WHERE id = $1`,
    [offerId]
  );

  // Rechazar las demás ofertas PENDING del mismo request
  await client.query(
    `UPDATE offers SET estado = 'REJECTED' WHERE request_id = $1 AND estado = 'PENDING' AND id <> $2`,
    [row.request_id, offerId]
  );

  const updated = await client.query(
    `SELECT id, request_id, oferente_id, agente_oferente_id, precio, cantidad,
            condiciones_entrega, estado, created_at
     FROM offers WHERE id = $1`,
    [offerId]
  );

  await emitEvent(
    {
      type: 'OfferAccepted',
      actor_id: row.oferente_id, // quien acepta (humano del solicitante)
      actor_tipo: 'HUMAN',
      request_id: row.request_id,
      offer_id: offerId,
      payload: {
        offer_id: offerId,
        request_id: row.request_id,
        oferente_id: row.oferente_id,
        precio: row.precio,
      },
    },
    client
  );

  // Eventos para las ofertas rechazadas
  const rechazadas = await client.query(
    `SELECT id, oferente_id FROM offers WHERE request_id = $1 AND estado = 'REJECTED'`,
    [row.request_id]
  );
  for (const r of rechazadas.rows) {
    await emitEvent(
      {
        type: 'OfferRejected',
        actor_id: 'system',
        actor_tipo: 'SYSTEM',
        request_id: row.request_id,
        offer_id: r.id,
        payload: {
          offer_id: r.id,
          request_id: row.request_id,
          oferente_id: r.oferente_id,
          motivo: 'Otra oferta aceptada',
        },
      },
      client
    );
  }

  return toOfferRow(updated.rows[0]);
}

/**
 * Retira una oferta (WITHDRAWN).
 */
export async function withdrawOffer(offerId: string): Promise<OfferRow | null> {
  const res = await query(
    `UPDATE offers SET estado = 'WITHDRAWN' WHERE id = $1 AND estado = 'PENDING'
     RETURNING id, request_id, oferente_id, agente_oferente_id, precio, cantidad,
               condiciones_entrega, estado, created_at`,
    [offerId]
  );
  return res.rows[0] ? toOfferRow(res.rows[0]) : null;
}
