import { query } from '../config/db';

export interface DealPaymentLink {
  id: string;
  deal_id: string;
  slug: string;
  reference_pubkey: string;
  amount_usdc: number | null;
  status: string;
  paid_amount_usdc: number;
  paid_at: string | null;
  paid_by_pubkey: string | null;
  paid_tx_signature: string | null;
  expires_at: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Guarda la asociación entre un Deal y su payment link en el Prototype.
 */
export async function createDealPaymentLink(
  dealId: string,
  slug: string,
  referencePubkey: string,
  amountUsdc: number | null,
  status: string = 'active'
): Promise<DealPaymentLink> {
  const res = await query(
    `INSERT INTO deal_payment_links (
      deal_id, slug, reference_pubkey, amount_usdc, status
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING id, deal_id, slug, reference_pubkey, amount_usdc, status,
              paid_amount_usdc, paid_at, paid_by_pubkey, paid_tx_signature,
              expires_at, created_at, updated_at`,
    [dealId, slug, referencePubkey, amountUsdc, status]
  );
  return res.rows[0];
}

/**
 * Obtiene el payment link asociado a un Deal.
 */
export async function getDealPaymentLink(dealId: string): Promise<DealPaymentLink | null> {
  const res = await query(
    `SELECT id, deal_id, slug, reference_pubkey, amount_usdc, status,
            paid_amount_usdc, paid_at, paid_by_pubkey, paid_tx_signature,
            expires_at, created_at, updated_at
     FROM deal_payment_links WHERE deal_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [dealId]
  );
  return res.rows[0] ?? null;
}

/**
 * Actualiza el estado del payment link tras un pago.
 */
export async function updateDealPaymentLinkStatus(
  dealId: string,
  status: string,
  paidAmountUsdc?: number | null,
  paidByPubkey?: string | null,
  paidTxSignature?: string | null
): Promise<DealPaymentLink | null> {
  const res = await query(
    `UPDATE deal_payment_links
     SET status = $2,
         paid_amount_usdc = COALESCE($3, paid_amount_usdc),
         paid_by_pubkey = COALESCE($4, paid_by_pubkey),
         paid_tx_signature = COALESCE($5, paid_tx_signature),
         paid_at = CASE WHEN $2 = 'paid' AND paid_at IS NULL THEN now() ELSE paid_at END,
         updated_at = now()
     WHERE deal_id = $1
     RETURNING id, deal_id, slug, reference_pubkey, amount_usdc, status,
               paid_amount_usdc, paid_at, paid_by_pubkey, paid_tx_signature,
               expires_at, created_at, updated_at`,
    [dealId, status, paidAmountUsdc ?? null, paidByPubkey ?? null, paidTxSignature ?? null]
  );
  return res.rows[0] ?? null;
}
