import { query } from '../config/db';
import { emitEvent, inTransaction } from '../events/service';
import { updateDealPaymentLinkStatus } from '../repositories/deal-payment-links.repository';
import { getDealPaymentLink } from '../repositories/deal-payment-links.repository';
import { updateRequestEstado } from '../repositories/requests.repository';
import { PrototypeClient } from '../services/prototype-client';

export type DealPaymentEstado = 'PENDING_ESCROW' | 'IN_ESCROW' | 'DELIVERED' | 'SETTLED' | 'DISPUTED';

/**
 * Mapea el estado de un payment link del Prototype al estado del Deal en LabAGENT.
 *
 * Prototype: active | paid | partial | expired | cancelled
 * LabAGENT: PENDING_ESCROW | IN_ESCROW | DELIVERED | SETTLED | DISPUTED
 */
function mapPaymentLinkStatusToDeal(
  plStatus: string
): DealPaymentEstado | null {
  switch (plStatus) {
    case 'active':
      return 'PENDING_ESCROW';
    case 'paid':
      return 'IN_ESCROW';
    case 'partial':
      return 'IN_ESCROW'; // pago parcial, sigue en escrow pendiente
    case 'expired':
      return 'DISPUTED';
    case 'cancelled':
      return 'DISPUTED';
    default:
      return null;
  }
}

/**
 * Sincroniza el estado de un Deal consultando el payment link del Prototype.
 *
 * Flujo:
 *  1. Obtiene el deal_payment_link asociado al deal
 *  2. Consulta el estado del payment link en el Prototype
 *  3. Si cambió, actualiza deal_payment_links y el estado del Deal
 *  4. Emite eventos de transición
 */
export async function sincronizarEstadoDeal(
  dealId: string,
  prototypeClient: PrototypeClient
): Promise<{
  dealEstado: DealPaymentEstado;
  plEstado: string;
  cambio: boolean;
}> {
  const pl = await getDealPaymentLink(dealId);
  if (!pl) {
    throw new Error(`No hay payment link asociado al deal ${dealId}`);
  }

  const plRemoto = await prototypeClient.getPaymentLink(pl.slug);
  const nuevoEstado = mapPaymentLinkStatusToDeal(plRemoto.status);
  const cambio = nuevoEstado !== (pl.status as DealPaymentEstado);

  if (!cambio && nuevoEstado === pl.status) {
    return {
      dealEstado: pl.status as DealPaymentEstado,
      plEstado: plRemoto.status,
      cambio: false,
    };
  }

  return inTransaction(async (client) => {
    // Actualizar deal_payment_links
    await updateDealPaymentLinkStatus(
      dealId,
      plRemoto.status,
      plRemoto.paidAmountUsdc,
      plRemoto.paidByPubkey,
      plRemoto.paidTxSignature
    );

    // Obtener el deal para saber el request_id
    const { getDealById } = await import('../repositories/deals.repository');
    const deal = await getDealById(dealId);
    if (!deal) {
      throw new Error(`Deal no encontrado: ${dealId}`);
    }

    // Actualizar estado del Deal
    const estadoAnterior = deal.estado as DealPaymentEstado;
    const res = await client.query(
      `UPDATE deals SET estado = $1, updated_at = now() WHERE id = $2
       RETURNING id, request_id, estado`,
      [nuevoEstado, dealId]
    );
    const dealActualizado = res.rows[0];

    // Emitir evento de transición
    await emitEvent(
      {
        type: 'DealEstadoCambiado',
        actor_id: 'system',
        actor_tipo: 'SYSTEM',
        request_id: deal.request_id,
        deal_id: dealId,
        payload: {
          deal_id: dealId,
          request_id: deal.request_id,
          estado_anterior: estadoAnterior,
          estado_nuevo: nuevoEstado,
          payment_link_status: plRemoto.status,
          slug: pl.slug,
        },
      },
      client
    );

    // Si el deal pasó a DELIVERED o SETTLED, no tocamos el request (ya está CLOSED)
    // Si pasó a DISPUTED, podríamos reabrir el request (decisión de negocio futura)

    return {
      dealEstado: nuevoEstado,
      plEstado: plRemoto.status,
      cambio: true,
    };
  });
}
