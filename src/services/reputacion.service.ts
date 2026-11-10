import { query } from '../config/db';

/**
 * Métricas de reputación básica off-chain por agente_id.
 *
 * Nota: sin escrow, los deals se quedan en PENDING_ESCROW y no hay
 * eventos de liquidación (DELIVERED, SETTLED, DISPUTED), por lo que
 * la traza aún no refleja confiabilidad económica real. Estas métricas
 * son un prototipo de señal para validar antes de anclar on-chain.
 *
 * Eventos usados (todos ya emitidos en fase 1):
 *   - RequestCreated (actor = agente del solicitante)
 *   - OfferSubmitted (actor = oferente o su agente)
 *   - OfferAccepted (actor = humano que acepta)
 *   - DealCreated (actor = SYSTEM)
 *   - MessageSent (actor = humano o agente)
 *   - RequestCancelled (actor = humano)
 */
export interface ReputacionAgente {
  agente_id: string;

  // Volumen de actividad
  requests_publicados: number;
  ofertas_enviadas: number;
  ofertas_aceptadas: number;
  deals_creados: number;
  solicitudes_canceladas: number;
  mensajes_enviados: number;

  // Tiempos
  tiempo_medio_respuesta_segundos: number | null; // oferta → aceptación

  // Tasas
  tasa_respuesta: number | null; // ofertas_aceptadas / ofertas_enviadas
  tasa_cancelacion: number | null; // canceladas / requests_publicados
  conversion_request_a_deal: number | null; // deals_creados / requests_publicados
}

/**
 * Calcula la reputación off-chain de un agente a partir de los eventos
 * almacenados en la tabla `events`.
 *
 * Como no hay escrow todavía, no hay eventos DELIVERED/SETTLED/DISPUTED,
 * por lo que los scores son señales de comportamiento, no de confiabilidad
 * económica.
 */
export async function calcularReputacionAgente(
  agente_id: string
): Promise<ReputacionAgente> {
  // 1) Requests publicados por este agente
  const requestsRes = await query(
    `SELECT id, timestamp FROM events
     WHERE type = 'RequestCreated' AND actor_id = $1
     ORDER BY timestamp ASC`,
    [agente_id]
  );
  const requests_publicados = requestsRes.rows.length;
  const requestIds = requestsRes.rows.map((r: any) => r.id);

  // 2) Ofertas enviadas por este agente
  const ofertasRes = await query(
    `SELECT id, request_id, timestamp, payload FROM events
     WHERE type = 'OfferSubmitted' AND actor_id = $1
     ORDER BY timestamp ASC`,
    [agente_id]
  );
  const ofertas_enviadas = ofertasRes.rows.length;

  // 3) Ofertas aceptadas por este actor
  const aceptadasRes = await query(
    `SELECT id, request_id, timestamp FROM events
     WHERE type = 'OfferAccepted' AND actor_id = $1`,
    [agente_id]
  );
  const ofertas_aceptadas = aceptadasRes.rows.length;

  // 4) Deals creados vinculados a requests publicados por este agente
  let deals_creados = 0;
  if (requestIds.length > 0) {
    // Usamos IN con un subquery en lugar de ANY para evitar problemas de tipo
    const dealRes = await query(
      `SELECT COUNT(DISTINCT request_id) as cnt FROM events
       WHERE type = 'DealCreated'
         AND request_id::text = ANY($1::text[])`,
      [requestIds]
    );
    deals_creados = Number(dealRes.rows[0]?.cnt) || 0;
  }

  // 5) Solicitudes canceladas por este agente
  const canceladasRes = await query(
    `SELECT id FROM events
     WHERE type = 'RequestCancelled' AND actor_id = $1`,
    [agente_id]
  );
  const solicitudes_canceladas = canceladasRes.rows.length;

  // 6) Mensajes enviados por este agente
  const mensajesRes = await query(
    `SELECT id FROM events
     WHERE type = 'MessageSent' AND actor_id = $1`,
    [agente_id]
  );
  const mensajes_enviados = mensajesRes.rows.length;

  // 7) Tiempo medio respuesta: oferta → aceptación
  let tiempo_medio_respuesta_segundos: number | null = null;
  if (ofertas_enviadas > 0 && ofertas_aceptadas > 0) {
    const tiempos: number[] = [];
    for (const oferta of ofertasRes.rows) {
      const request_id = (oferta.payload && typeof oferta.payload === 'object'
        ? (oferta.payload as any).request_id
        : oferta.request_id) || oferta.request_id;
      const aceptacion = await query(
        `SELECT timestamp FROM events
         WHERE type = 'OfferAccepted' AND request_id = $1
         ORDER BY timestamp ASC
         LIMIT 1`,
        [request_id]
      );
      if (aceptacion.rows.length > 0) {
        const tOferta = new Date(oferta.timestamp).getTime();
        const tAcept = new Date(aceptacion.rows[0].timestamp).getTime();
        tiempos.push((tAcept - tOferta) / 1000);
      }
    }
    if (tiempos.length > 0) {
      tiempo_medio_respuesta_segundos =
        tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
    }
  }

  // 8) Tasas
  const tasa_respuesta =
    ofertas_enviadas > 0 ? ofertas_aceptadas / ofertas_enviadas : null;
  const tasa_cancelacion =
    requests_publicados > 0
      ? solicitudes_canceladas / requests_publicados
      : null;
  const conversion_request_a_deal =
    requests_publicados > 0 ? deals_creados / requests_publicados : null;

  return {
    agente_id,
    requests_publicados,
    ofertas_enviadas,
    ofertas_aceptadas,
    deals_creados,
    solicitudes_canceladas,
    mensajes_enviados,
    tiempo_medio_respuesta_segundos,
    tasa_respuesta,
    tasa_cancelacion,
    conversion_request_a_deal,
  };
}

/**
 * Obtiene reputación de múltiples agentes (ranking simple).
 */
export async function listarReputaciones(
  agente_ids: string[]
): Promise<ReputacionAgente[]> {
  const resultados: ReputacionAgente[] = [];
  for (const id of agente_ids) {
    resultados.push(await calcularReputacionAgente(id));
  }
  return resultados;
}
