/**
 * Cliente HTTP para la API del Prototype de ReWallet (Solana devnet).
 *
 * El Prototype expone:
 *   POST /api/payment-links   - Crear un payment link (cobro USDC)
 *   GET  /api/payment-links/by-slug/:slug  - Consultar estado de un link
 *   GET  /api/wallet?wallet=<pubkey>  - Consultar wallet y balance
 *
 * Todas las respuestas son JSON. Usa fetch nativo de Node.js 22+.
 */
export interface PrototypeConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface CreatePaymentLinkInput {
  wallet: string;           // Solana public key (base58) del destinatario
  amountUsdc: number;       // Monto en USDC
  concept: string;          // Concepto del cobro
}

export interface CreatePaymentLinkOutput {
  id: number;
  slug: string;
  referencePubkey: string;
  amountUsdc: number | null;
  currency: string;
  concept: string;
  status: string;
  paidAmountUsdc: number;
  paidAt: string | null;
  paidByPubkey: string | null;
  paidTxId: number | null;
  paidTxSignature: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface PaymentLinkStatus {
  id: number;
  slug: string;
  referencePubkey: string;
  amountUsdc: number | null;
  currency: string;
  concept: string;
  status: string;   // active | paid | partial | expired | cancelled
  paidAmountUsdc: number;
  paidAt: string | null;
  paidByPubkey: string | null;
  paidTxSignature: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export class PrototypeClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: PrototypeConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    };
  }

  /**
   * Crea un payment link en el Prototype para cobrar USDC.
   * Se usa cuando se acepta un Deal en LabAGENT.
   */
  async createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkOutput> {
    const res = await fetch(`${this.baseUrl}/api/payment-links`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        wallet: input.wallet,
        amountUsdc: input.amountUsdc,
        concept: input.concept,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Prototype API error (${res.status}): ${text}`
      );
    }

    return (await res.json()) as CreatePaymentLinkOutput;
  }

  /**
   * Consulta el estado de un payment link por su slug.
   * Se usa para sincronizar el estado del Deal.
   */
  async getPaymentLink(slug: string): Promise<PaymentLinkStatus> {
    const res = await fetch(`${this.baseUrl}/api/payment-links/by-slug/${encodeURIComponent(slug)}`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Prototype API error (${res.status}): ${text}`
      );
    }

    return (await res.json()) as PaymentLinkStatus;
  }

  /**
   * Consulta el estado de una wallet de Solana.
   */
  async getWallet(solanaPublicKey: string): Promise<{
    publicKey: string;
    balanceUsdc: number;
    balanceSol: number;
    name: string;
    handle: string;
  } | null> {
    const res = await fetch(
      `${this.baseUrl}/api/wallet?wallet=${encodeURIComponent(solanaPublicKey)}`,
      { method: 'GET', headers: this.headers }
    );

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as any;
  }
}
