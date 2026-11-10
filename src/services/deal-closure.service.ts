import { inTransaction, emitEvent } from '../events/service';
import { acceptOffer } from '../repositories/offers.repository';
import { createDeal } from '../repositories/deals.repository';
import { updateRequestEstado } from '../repositories/requests.repository';
import { getDealByRequest } from '../repositories/deals.repository';
import { EscrowClient } from './escrow-client.service';
import { env } from '../config/env';

/**
 * Cliente de escrow Soroban (inicializado solo si hay contrato configurado).
 * Si no hay SOROBAN_CONTRACT_ID, se opera solo off-chain.
 */
const escrowClient =
  env.SOROBAN_CONTRACT_ID && env.SOROBAN_SAC_ID && env.SOROBAN_ADMIN_SECRET_KEY
    ? new EscrowClient({
        contractId: env.SOROBAN_CONTRACT_ID,
        usdcSacId: env.SOROBAN_SAC_ID,
        rpcUrl: env.SOROBAN_RPC_URL,
        networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE,
        adminSecretKey: env.SOROBAN_ADMIN_SECRET_KEY,
      })
    : null;

export interface CierreDealResult {
  offer: any;
  deal: any;
  request: any;
  contractDealId?: bigint;
  contractTxHash?: string;
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
 * Si hay contrato Soroban configurado:
 *  f) Depositar USDC en el contrato (crear Deal en PENDING_ESCROW on-chain)
 *
 * Si falla cualquier paso → rollback completo (excepto el contrato, que se registra pero no falla la transacción).
 */
export async function cerrarDeal(
  offerId: string,
  actorId: string
): Promise<CierreDealResult> {
  return inTransaction(async (client) => {
    // a) Aceptar oferta (rechaza las demás PENDING automáticamente)
    const offer = await acceptOffer(offerId, client);

    // b) Crear Deal en PENDING_ESCROW (off-chain)
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

    // f) Si hay contrato Soroban configurado, crear Deal en el contrato
    let contractDealId: bigint | undefined;
    let contractTxHash: string | undefined;

    if (escrowClient) {
      try {
        // El actor_id es quien acepta la oferta (comprador)
        // El oferente_id es el vendedor
        const result = await escrowClient.depositar({
          comprador: actorId,
          vendedor: offer.oferente_id,
          monto: Number(offer.precio),
        });
        contractDealId = result.dealId;
        contractTxHash = result.transactionHash;

        // Emitir evento de depósito en contrato
        await emitEvent(
          {
            type: 'DealDepositedOnChain',
            actor_id: actorId,
            actor_tipo: 'HUMAN',
            request_id: offer.request_id,
            deal_id: deal.id,
            payload: {
              contract_deal_id: result.dealId.toString(),
              transaction_hash: result.transactionHash,
              monto: offer.precio,
              comprador: actorId,
              vendedor: offer.oferente_id,
            },
          },
          client
        );
      } catch (err) {
        // No fallar toda la transacción si el contrato falla
        // Se registra el error pero el Deal se creó off-chain correctamente
        await emitEvent(
          {
            type: 'DealDepositFailed',
            actor_id: actorId,
            actor_tipo: 'HUMAN',
            request_id: offer.request_id,
            deal_id: deal.id,
            payload: {
              deal_id: deal.id,
              error: err instanceof Error ? err.message : 'Error desconocido',
              monto: offer.precio,
            },
          },
          client
        );
      }
    }

    return { offer, deal, request, contractDealId, contractTxHash };
  });
}

export async function obtenerDealDelRequest(requestId: string) {
  return getDealByRequest(requestId);
}
