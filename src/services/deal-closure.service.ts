import { inTransaction, emitEvent } from '../events/service';
import { acceptOffer } from '../repositories/offers.repository';
import { createDeal } from '../repositories/deals.repository';
import { updateRequestEstado } from '../repositories/requests.repository';
import { getDealByRequest } from '../repositories/deals.repository';
import { createDealPaymentLink } from '../repositories/deal-payment-links.repository';
import { getWalletMapping } from '../repositories/wallet-mapping.repository';
import { PrototypeClient } from '../services/prototype-client';

export interface CierreDealResult {
  offer: any;
  deal: any;
  request: any;
  paymentLink?: any;
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
 * Si hay Prototype configurado y el vendedor tiene wallet de Solana:
 *  f) Crear payment link en el Prototype para el monto del deal
 *  g) Guardar deal_payment_link vinculado
 *
 * Si falla cualquier paso → rollback completo.
 */
export async function cerrarDeal(
  offerId: string,
  actorId: string,
  prototypeClient?: PrototypeClient
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

    // f) Crear payment link en el Prototype si está configurado
    let paymentLink: any = undefined;
    if (prototypeClient) {
      // Buscar wallet del vendedor (oferente_id)
      const vendedorMapping = await getWalletMapping(offer.oferente_id);
      if (vendedorMapping) {
        const concepto = `Deal ${deal.id}: ${request.producto} - ${offer.cantidad} ${offer.unidad}`;
        const link = await prototypeClient.createPaymentLink({
          wallet: vendedorMapping.solana_public_key,
          amountUsdc: Number(offer.precio),
          concept: concepto,
        });

        // g) Guardar deal_payment_link vinculado
        await createDealPaymentLink(
          deal.id,
          link.slug,
          link.referencePubkey,
          link.amountUsdc ?? null,
          link.status
        );

        paymentLink = {
          slug: link.slug,
          referencePubkey: link.referencePubkey,
          amountUsdc: link.amountUsdc,
          status: link.status,
          url: `${prototypeClient.baseUrl}/pay?slug=${link.slug}`,
        };
      }
    }

    return { offer, deal, request, paymentLink };
  });
}

export async function obtenerDealDelRequest(requestId: string) {
  return getDealByRequest(requestId);
}
