import { inTransaction, emitEvent } from '../events/service';
import { acceptOffer } from '../repositories/offers.repository';
import { createDeal } from '../repositories/deals.repository';
import { updateRequestEstado } from '../repositories/requests.repository';
import { getDealByRequest } from '../repositories/deals.repository';

export interface CierreDealResult {
  offer: any;
  deal: any;
  request: any;
}

/**
 * Cierre transaccional del Deal (Sección 9.5 del research).
 *
 * Todo en UNA sola transacción de BD:
 *  a) Marcar Offer = ACCEPTED
 *  b) Crear Deal en PENDING_ESCROW
 *  c) Marcar Request = CLOSED
 *  d) Otras Offers PENDING → REJECTED
 *  e) Emitir eventos: OfferAccepted, DealCreated, RequestClosed, OfferRejected x n
 *
 * Si falla cualquier paso → rollback completo.
 */
export async function cerrarDeal(
  offerId: string,
  actorId: string
): Promise<CierreDealResult> {
  return inTransaction(async (client) => {
    // a) Aceptar oferta (rechaza las demás PENDING automáticamente)
    const offer = await acceptOffer(offerId, client);

    // b) Crear Deal en PENDING_ESCROW
    const deal = await createDeal(
      {
        request_id: offer.request_id,
        offer_id: offer.id,
        precio_final: offer.precio,
        condiciones_finales: offer.condiciones_entrega,
      },
      client
    );

    // c) Marcar Request = CLOSED (dentro de la misma transacción)
    const request = await updateRequestEstado(offer.request_id, 'CLOSED', client);
    if (!request) {
      throw new Error(`Request no encontrado: ${offer.request_id}`);
    }

    // d) (ya hecho dentro de acceptOffer: las demás PENDING → REJECTED)

    // e) Emitir RequestClosed
    await emitEvent(
      {
        type: 'RequestClosed',
        actor_id: actorId,
        actor_tipo: 'HUMAN',
        request_id: request.id,
        deal_id: deal.id,
        payload: {
          request_id: request.id,
          deal_id: deal.id,
          precio_final: deal.precio_final,
          estado: 'CLOSED',
        },
      },
      client
    );

    return { offer, deal, request };
  });
}

export async function obtenerDealDelRequest(requestId: string) {
  return getDealByRequest(requestId);
}
