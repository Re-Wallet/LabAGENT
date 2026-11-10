import {
  Keypair,
  Server,
  TransactionBuilder,
  Networks,
  Address,
  ScVal,
  xdr,
  scValToNative,
  nativeToScVal,
} from '@stellar/stellar-sdk';

/**
 * Cliente para interactuar con el contrato de escrow de ReWallet en Stellar Soroban.
 *
 * Contrato desplegado en testnet:
 *   CAR4Z3CHDEYMMR6J6XMOWHRTWA45YDFAGGQXR7O76HAKM3ERJG33M47D
 *
 * USDC SAC:
 *   CBPYDMY3MU6CDAY2QVPUV735Q7IT5BEG33IDJEDZUBP4A5IXSOAAAA62
 */

export interface EscrowContractConfig {
  contractId: string;
  usdcSacId: string;
  rpcUrl: string;
  networkPassphrase: string;
  adminSecretKey: string;
}

export interface DealData {
  dealId: number | bigint;
  comprador: string;
  vendedor: string;
  monto: number | bigint; // USDC en unidades base (7 decimales)
  estado: 'PENDING_ESCROW' | 'IN_ESCROW' | 'DELIVERED' | 'SETTLED' | 'DISPUTED';
  creadoEn: number;
}

export interface CreateDealInput {
  comprador: string;
  vendedor: string;
  monto: number | bigint;
  dealId?: number | bigint;
}

export class EscrowContractClient {
  private contractId: string;
  private usdcSacId: string;
  private server: Server;
  private networkPassphrase: string;
  private adminKeypair: Keypair;

  constructor(config: EscrowContractConfig) {
    this.contractId = config.contractId;
    this.usdcSacId = config.usdcSacId;
    this.server = new Server(config.rpcUrl, { allowHttp: true });
    this.networkPassphrase = config.networkPassphrase;
    this.adminKeypair = Keypair.fromSecret(config.adminSecretKey);
  }

  /**
   * Construye y firma una transacción para llamar al contrato.
   */
  private async buildAndSignTransaction(
    operations: Array<(builder: TransactionBuilder) => TransactionBuilder>,
    sourceKeypair: Keypair
  ): Promise<string> {
    const account = await this.server.getAccount(sourceKeypair.publicKey());

    const transaction = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperations(operations.map((op) => op(transaction)))
      .setTimeout(300)
      .build();

    transaction.sign(sourceKeypair);
    return transaction.toXDR();
  }

  /**
   * Envía una transacción firmada y espera su confirmación.
   */
  private async sendTransaction(xdr: string): Promise<any> {
    const response = await this.server.submitTransaction(xdr);
    return response;
  }

  /**
   * Deposita USDC en el escrow para un nuevo Deal.
   * Transición: crea Deal en PENDING_ESCROW y bloquea los fondos.
   */
  async depositar(input: CreateDealInput): Promise<{
    dealId: bigint;
    transactionHash: string;
  }> {
    const dealId = input.dealId ?? BigInt(Date.now());
    const comprador = Keypair.fromSecret(input.comprador);

    // Primero, el comprador necesita dar autorización al contrato para gastar su USDC
    // Esto se hace mediante una autorización de la SAC

    const tx = await this.buildAndSignTransaction(
      [
        // Llamar a depositar en el contrato de escrow
        (builder) =>
          builder.invokeContractFunction(
            this.contractId,
            'depositar',
            [
              nativeToScVal(BigInt(dealId), { type: 'u64' }),
              nativeToScVal(Address.fromString(input.comprador)),
              nativeToScVal(Address.fromString(input.vendedor)),
              nativeToScVal(BigInt(input.monto), { type: 'i128' }),
              nativeToScVal(
                BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60), // deadline: 7 días
                { type: 'u64' }
              ),
            ]
          ),
      ],
      this.adminKeypair
    );

    const result = await this.sendTransaction(tx);

    return {
      dealId: BigInt(dealId),
      transactionHash: result.hash,
    };
  }

  /**
   * Reclama entrega (vendedor indica que entregó).
   * Transición: PENDING_ESCROW → IN_ESCROW
   */
  async reclamarEntrega(
    dealId: number | bigint,
    vendedorSecretKey: string,
    pruebaEntrega: string = ''
  ): Promise<{ transactionHash: string }> {
    const vendedorKeypair = Keypair.fromSecret(vendedorSecretKey);

    const tx = await this.buildAndSignTransaction(
      [
        (builder) =>
          builder.invokeContractFunction(
            this.contractId,
            'reclamar_entrega',
            [
              nativeToScVal(BigInt(dealId), { type: 'u64' }),
              nativeToScVal(Buffer.from(pruebaEntrega), { type: 'bytes' }),
            ]
          ),
      ],
      vendedorKeypair
    );

    const result = await this.sendTransaction(tx);

    return { transactionHash: result.hash };
  }

  /**
   * Confirma entrega (comprador confirma recepción).
   * Transición: IN_ESCROW → DELIVERED
   */
  async confirmarEntrega(
    dealId: number | bigint,
    compradorSecretKey: string
  ): Promise<{ transactionHash: string }> {
    const compradorKeypair = Keypair.fromSecret(compradorSecretKey);

    const tx = await this.buildAndSignTransaction(
      [
        (builder) =>
          builder.invokeContractFunction(
            this.contractId,
            'confirmar_entrega',
            [nativeToScVal(BigInt(dealId), { type: 'u64' })]
          ),
      ],
      compradorKeypair
    );

    const result = await this.sendTransaction(tx);

    return { transactionHash: result.hash };
  }

  /**
   * Libera fondos al vendedor (comprador aprueba).
   * Transición: DELIVERED → SETTLED
   */
  async liberar(
    dealId: number | bigint,
    compradorSecretKey: string
  ): Promise<{ transactionHash: string; vendedor: string; monto: bigint }> {
    const compradorKeypair = Keypair.fromSecret(compradorSecretKey);

    const tx = await this.buildAndSignTransaction(
      [
        (builder) =>
          builder.invokeContractFunction(
            this.contractId,
            'liberar',
            [nativeToScVal(BigInt(dealId), { type: 'u64' })]
          ),
      ],
      compradorKeypair
    );

    const result = await this.sendTransaction(tx);

    return {
      transactionHash: result.hash,
      vendedor: '', // Se obtendría del evento
      monto: BigInt(0),
    };
  }

  /**
   * Reembolsa fondos al comprador.
   * Transición: PENDING_ESCROW/IN_ESCROW/DELIVERED → DISPUTED
   */
  async reembolsar(
    dealId: number | bigint,
    compradorSecretKey: string
  ): Promise<{ transactionHash: string }> {
    const compradorKeypair = Keypair.fromSecret(compradorSecretKey);

    const tx = await this.buildAndSignTransaction(
      [
        (builder) =>
          builder.invokeContractFunction(
            this.contractId,
            'reembolsar',
            [nativeToScVal(BigInt(dealId), { type: 'u64' })]
          ),
      ],
      compradorKeypair
    );

    const result = await this.sendTransaction(tx);

    return { transactionHash: result.hash };
  }

  /**
   * Obtiene el estado actual de un Deal desde el contrato.
   */
  async obtenerDeal(dealId: number | bigint): Promise<DealData | null> {
    try {
      const result = await this.server.callContractFunction(
        this.contractId,
        'get_deal',
        [nativeToScVal(BigInt(dealId), { type: 'u64' })]
      );

      const deal = scValToNative(result);

      return {
        dealId: BigInt(deal.deal_id),
        comprador: deal.comprador,
        vendedor: deal.vendedor,
        monto: BigInt(deal.monto.toString()),
        estado: deal.estado as DealData['estado'],
        creadoEn: Number(deal.creado_en),
      };
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Obtiene la configuración del contrato.
   */
  async obtenerConfig(): Promise<{
    admin: string;
    usdcSac: string;
    settleGraceSeconds: bigint;
    paused: boolean;
  }> {
    const result = await this.server.callContractFunction(
      this.contractId,
      'get_config',
      []
    );

    const config = scValToNative(result);

    return {
      admin: config.admin,
      usdcSac: config.usdc_sac,
      settleGraceSeconds: BigInt(config.settle_grace_seconds.toString()),
      paused: config.paused,
    };
  }

  /**
   * Pausa el contrato (solo admin).
   */
  async pausar(): Promise<{ transactionHash: string }> {
    const tx = await this.buildAndSignTransaction(
      [(builder) => builder.invokeContractFunction(this.contractId, 'pausar', [])],
      this.adminKeypair
    );

    const result = await this.sendTransaction(tx);

    return { transactionHash: result.hash };
  }

  /**
   * Reanuda el contrato (solo admin).
   */
  async reanudar(): Promise<{ transactionHash: string }> {
    const tx = await this.buildAndSignTransaction(
      [(builder) => builder.invokeContractFunction(this.contractId, 'unpausar', [])],
      this.adminKeypair
    );

    const result = await this.sendTransaction(tx);

    return { transactionHash: result.hash };
  }

  /**
   * Rota la clave admin (solo admin actual).
   */
  async rotarAdmin(nuevoAdmin: string): Promise<{ transactionHash: string }> {
    const tx = await this.buildAndSignTransaction(
      [
        (builder) =>
          builder.invokeContractFunction(
            this.contractId,
            'set_admin',
            [nativeToScVal(Address.fromString(nuevoAdmin))]
          ),
      ],
      this.adminKeypair
    );

    const result = await this.sendTransaction(tx);

    return { transactionHash: result.hash };
  }
}
