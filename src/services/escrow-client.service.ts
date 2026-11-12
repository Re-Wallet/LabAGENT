import {
  Keypair,
  Address,
  nativeToScVal,
  scValToNative,
  StrKey,
  rpc,
  Contract,
  TransactionBuilder,
  Networks,
} from '@stellar/stellar-sdk';
import {
  signAndSend,
  importWalletPrivateKey,
  listWallets,
  createPolicy,
  createApiKey,
} from '@open-wallet-standard/core';

/**
 * Cliente para interactuar con el contrato de escrow de ReWallet en Stellar Soroban.
 *
 * Contrato desplegado en testnet:
 *   CAR4Z3CHDEYMMR6J6XMOWHRTWA45YDFAGGQXR7O76HAKM3ERJG33M47D
 *
 * USDC de Circle (testnet):
 *   SAC (Stellar Asset Contract): CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
 *   Issuer (activo clásico):        GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
 *   Decimales: 7
 *
 * Firma de transacciones vía Open Wallet Standard (OWS):
 *   - Las claves privadas se importan en el vault local de OWS (cifrado en reposo).
 *   - OWS aplica políticas (AgentMandate) antes de firmar.
 *   - OWS firma el XDR de la transacción y lo envía a Horizon/Soroban RPC.
 *
 * Nota: El contrato desplegado actualmente tiene un usdc_sac distinto en su
 * storage. Para usar USDC de Circle, el contrato debe apuntar al SAC de Circle
 * (redeployar o invocar set_admin/set_usdc_sac si el contrato lo soporta).
 */

export interface EscrowContractConfig {
  contractId: string;
  usdcSacId?: string;         // default: USDC de Circle testnet SAC
  rpcUrl: string;
  networkPassphrase: string;
  adminSecretKey: string;
  owsVaultPath?: string;      // Ruta al vault de OWS (default: ./.ows-vault)
  owsPassphrase?: string;     // Passphrase para descifrar el vault de OWS (default: '')
  owsApiToken?: string;       // Token de API key de OWS (modo agent, aplica políticas)
  owsPolicyScriptPath?: string; // Path al script ejecutable de política (default: scripts/ows-agent-mandate-policy.sh)
}

/**
 * USDC de Circle en Stellar testnet (valores canónicos de Circle).
 */
export const USDC_CIRCLE_TESTNET = {
  sac: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  decimals: 7,
} as const;

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

export interface PolicyContext {
  chain_id: string;
  wallet_id: string;
  tx_hex: string;
}

export class EscrowContractClient {
  private contractId: string;
  private usdcSacId: string;
  private server: rpc.Server;
  private networkPassphrase: string;
  private owsVaultPath: string;
  private owsPassphrase: string;
  private adminSecretKey: string;
  private rpcUrl: string;
  private owsApiToken: string | null;
  private owsPolicyScriptPath: string;

  constructor(config: EscrowContractConfig) {
    this.contractId = config.contractId;
    // Por defecto usa el SAC de USDC de Circle en testnet.
    // Si el contrato desplegado usa otro SAC, pasarlo explícitamente en la config.
    this.usdcSacId = config.usdcSacId ?? USDC_CIRCLE_TESTNET.sac;
    this.server = new rpc.Server(config.rpcUrl, { allowHttp: true });
    this.networkPassphrase = config.networkPassphrase;
    this.owsVaultPath = config.owsVaultPath ?? './.ows-vault';
    this.owsPassphrase = config.owsPassphrase ?? '';
    this.adminSecretKey = config.adminSecretKey;
    this.rpcUrl = config.rpcUrl;
    this.owsApiToken = config.owsApiToken ?? null;
    this.owsPolicyScriptPath = config.owsPolicyScriptPath ?? './scripts/ows-agent-mandate-policy.sh';
    // La clave admin se importa en OWS bajo demanda en la primera operación que la use
  }

  /**
   * Configura la política de AgentMandate en OWS para esta wallet admin.
   *   1. Registra el script ejecutable de política (ows-agent-mandate-policy.sh)
   *   2. Importa la clave admin en el vault de OWS (si aún no está)
   *   3. Crea un API key vinculado a la wallet admin y a la política
   *
   * Después de llamar a este método, las operaciones de este cliente usarán
   * el token de API key (modo agent) y OWS aplicará las políticas antes de firmar.
   */
  async setupPolicy(mandatePath?: string): Promise<string> {
    const mandatePathResolved = mandatePath ?? './.ows-mandate.json';

    // 1. Registrar la política ejecutable en OWS
    const policyJson = JSON.stringify({
      id: `owspolicy_${this.contractId}`,
      name: `AgentMandate policy for ${this.contractId}`,
      version: 1,
      created_at: new Date().toISOString(),
      rules: [
        { type: 'allowed_chains', chain_ids: ['stellar:testnet'] },
      ],
      executable: this.owsPolicyScriptPath,
      action: 'deny',
    });

    createPolicy(policyJson, this.owsVaultPath);

    // 2. Asegurar que la clave admin esté en el vault de OWS
    const walletName = this.ensureWallet(this.adminSecretKey);

    // 3. Crear API key vinculado a la wallet admin y a la política
    const keyResult = createApiKey(
      `escrow_agent_${this.contractId}`,
      [walletName],
      [`owspolicy_${this.contractId}`],
      this.owsPassphrase,
      null, // expires_at
      this.owsVaultPath
    );

    this.owsApiToken = keyResult.token;
    return this.owsApiToken;
  }

  /**
   * Devuelve el credencial a usar para firmar: token de API key (modo agent)
   * o passphrase (modo owner).
   */
  private getSignCredential(): string {
    return this.owsApiToken ?? this.owsPassphrase;
  }

  /**
   * Asegura que existe una wallet en OWS para la clave secreta de Stellar dada.
   * Devuelve el nombre de la wallet en OWS.
   * La clave privada se cifra en reposo dentro del vault de OWS.
   */
  private ensureWallet(secretKey: string): string {
    const walletName = `escrow_${Buffer.from(secretKey.slice(-8)).toString('hex')}`;
    try {
      const wallets = listWallets(this.owsVaultPath);
      const exists = wallets.some(
        (w) => w.id === walletName || w.name === walletName
      );
      if (exists) {
        return walletName;
      }
    } catch {
      // El vault puede no existir aún; se crea al importar la clave
    }
    // Decodificar StrKey secreta de Stellar a 32 bytes de clave privada ed25519
    const secretKeyBytes = StrKey.decodeEd25519SecretSeed(secretKey);
    const secretKeyHex = Buffer.from(secretKeyBytes).toString('hex');
    importWalletPrivateKey(
      walletName,
      secretKeyHex,
      this.owsPassphrase,
      this.owsVaultPath,
      undefined, // chain (se infiere por ed25519_key)
      undefined, // secp256k1_key
      secretKeyHex // ed25519_key → Stellar usa Ed25519
    );
    return walletName;
  }

  /**
   * Construye un TransactionBuilder sin firmar con las operaciones dadas.
   */
  private async buildUnsignedTxBuilder(
    operations: Array<(builder: TransactionBuilder) => void>,
    sourcePublicKey: string
  ): Promise<TransactionBuilder> {
    const account = await this.server.getAccount(sourcePublicKey);

    const builder = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    });

    operations.forEach((op) => op(builder));

    return builder;
  }

  /**
   * Firma y envía una transacción vía OWS.
   * Construye el XDR sin firmar, lo firma con OWS (policy-gated) y lo broadcast a Horizon.
   */
  private async signAndBroadcastViaOws(
    operations: Array<(builder: TransactionBuilder) => void>,
    sourceSecretKey: string
  ): Promise<string> {
    const sourceKeypair = Keypair.fromSecret(sourceSecretKey);
    const sourcePublicKey = sourceKeypair.publicKey();

    const builder = await this.buildUnsignedTxBuilder(
      operations,
      sourcePublicKey
    );
    const transaction = builder.build();
    const unsignedXdrBase64 = transaction.toXDR();
    const unsignedXdrHex = Buffer.from(unsignedXdrBase64, 'base64').toString('hex');

    const walletName = this.ensureWallet(sourceSecretKey);

    const credential = this.getSignCredential();

    const result = signAndSend(
      walletName,
      'stellar:testnet',
      unsignedXdrHex,
      credential,
      undefined, // index
      this.rpcUrl, // Horizon / Soroban RPC URL
      this.owsVaultPath
    );

    return result.txHash;
  }

  /**
   * Ejecuta una llamada de solo lectura al contrato (simulación, sin firma).
   * Devuelve el valor de retorno scVal nativo.
   */
  private async simulateReadOnly(
    operations: Array<(builder: TransactionBuilder) => void>,
    sourcePublicKey: string
  ): Promise<any> {
    const builder = await this.buildUnsignedTxBuilder(
      operations,
      sourcePublicKey
    );
    const transaction = builder.build();
    const result = await this.server.simulateTransaction(transaction);
    // El resultado de simulateTransaction contiene los return values en result.results[0].returnValue
    return result;
  }

  /**
   * Deposita USDC en el escrow para un nuevo Deal.
   * Transición: crea Deal en PENDING_ESCROW y bloquea los fondos.
   * Firma vía OWS con la clave admin.
   */
  async depositar(input: CreateDealInput): Promise<{
    dealId: bigint;
    transactionHash: string;
  }> {
    const dealId = input.dealId ?? BigInt(Date.now());

    const txHash = await this.signAndBroadcastViaOws(
      [
        (builder) => {
          const contract = new Contract(this.contractId);
          const call = contract.call(
            'depositar',
            nativeToScVal(BigInt(dealId), { type: 'u64' }),
            nativeToScVal(Address.fromString(input.comprador)),
            nativeToScVal(Address.fromString(input.vendedor)),
            nativeToScVal(BigInt(input.monto), { type: 'i128' }),
            nativeToScVal(
              BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60), // deadline: 7 días
              { type: 'u64' }
            )
          );
          builder.addOperation({ body: call.body } as any);
        },
      ],
      this.adminSecretKey
    );

    return {
      dealId: BigInt(dealId),
      transactionHash: txHash,
    };
  }

  /**
   * Reclama entrega (vendedor indica que entregó).
   * Transición: PENDING_ESCROW → IN_ESCROW
   * Firma vía OWS con la clave del vendedor.
   */
  async reclamarEntrega(
    dealId: number | bigint,
    vendedorSecretKey: string,
    pruebaEntrega: string = ''
  ): Promise<{ transactionHash: string }> {
    const txHash = await this.signAndBroadcastViaOws(
      [
        (builder) => {
          const contract = new Contract(this.contractId);
          const call = contract.call(
            'reclamar_entrega',
            nativeToScVal(BigInt(dealId), { type: 'u64' }),
            nativeToScVal(Buffer.from(pruebaEntrega), { type: 'bytes' })
          );
          builder.addOperation({ body: call.body } as any);
        },
      ],
      vendedorSecretKey
    );

    return { transactionHash: txHash };
  }

  /**
   * Confirma entrega (comprador confirma recepción).
   * Transición: IN_ESCROW → DELIVERED
   * Firma vía OWS con la clave del comprador.
   */
  async confirmarEntrega(
    dealId: number | bigint,
    compradorSecretKey: string
  ): Promise<{ transactionHash: string }> {
    const txHash = await this.signAndBroadcastViaOws(
      [
        (builder) => {
          const contract = new Contract(this.contractId);
          const call = contract.call(
            'confirmar_entrega',
            nativeToScVal(BigInt(dealId), { type: 'u64' })
          );
          builder.addOperation({ body: call.body } as any);
        },
      ],
      compradorSecretKey
    );

    return { transactionHash: txHash };
  }

  /**
   * Libera fondos al vendedor (comprador aprueba).
   * Transición: DELIVERED → SETTLED
   * Firma vía OWS con la clave del comprador.
   */
  async liberar(
    dealId: number | bigint,
    compradorSecretKey: string
  ): Promise<{ transactionHash: string; vendedor: string; monto: bigint }> {
    const txHash = await this.signAndBroadcastViaOws(
      [
        (builder) => {
          const contract = new Contract(this.contractId);
          const call = contract.call(
            'liberar',
            nativeToScVal(BigInt(dealId), { type: 'u64' })
          );
          builder.addOperation({ body: call.body } as any);
        },
      ],
      compradorSecretKey
    );

    return {
      transactionHash: txHash,
      vendedor: '',
      monto: BigInt(0),
    };
  }

  /**
   * Reembolsa fondos al comprador.
   * Transición: PENDING_ESCROW/IN_ESCROW/DELIVERED → DISPUTED
   * Firma vía OWS con la clave del comprador.
   */
  async reembolsar(
    dealId: number | bigint,
    compradorSecretKey: string
  ): Promise<{ transactionHash: string }> {
    const txHash = await this.signAndBroadcastViaOws(
      [
        (builder) => {
          const contract = new Contract(this.contractId);
          const call = contract.call(
            'reembolsar',
            nativeToScVal(BigInt(dealId), { type: 'u64' })
          );
          builder.addOperation({ body: call.body } as any);
        },
      ],
      compradorSecretKey
    );

    return { transactionHash: txHash };
  }

  /**
   * Obtiene el estado actual de un Deal desde el contrato.
   * Read-only: simula una transacción sin firmar.
   */
  async obtenerDeal(dealId: number | bigint): Promise<DealData | null> {
    try {
      const adminKeypair = Keypair.fromSecret(this.adminSecretKey);
      const result = await this.simulateReadOnly(
        [
          (builder) => {
            const contract = new Contract(this.contractId);
            const call = contract.call(
              'get_deal',
              nativeToScVal(BigInt(dealId), { type: 'u64' })
            );
            builder.addOperation({ body: call.body } as any);
          },
        ],
        adminKeypair.publicKey()
      );

      // Extraer el returnValue del resultado de simulate
      const returnValue = result?.results?.[0]?.returnValue;
      if (!returnValue) {
        return null;
      }

      const deal = scValToNative(returnValue);

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
   * Read-only: simula una transacción sin firmar.
   */
  async obtenerConfig(): Promise<{
    admin: string;
    usdcSac: string;
    settleGraceSeconds: bigint;
    paused: boolean;
  }> {
    const adminKeypair = Keypair.fromSecret(this.adminSecretKey);
    const result = await this.simulateReadOnly(
      [
        (builder) => {
          const contract = new Contract(this.contractId);
          const call = contract.call('get_config');
          builder.addOperation({ body: call.body } as any);
        },
      ],
      adminKeypair.publicKey()
    );

    const returnValue = result?.results?.[0]?.returnValue;
    if (!returnValue) {
      throw new Error('No se pudo obtener la configuración del contrato');
    }

    const config = scValToNative(returnValue);

    return {
      admin: config.admin,
      usdcSac: config.usdc_sac,
      settleGraceSeconds: BigInt(config.settle_grace_seconds.toString()),
      paused: config.paused,
    };
  }

  /**
   * Pausa el contrato (solo admin).
   * Firma vía OWS con la clave admin.
   */
  async pausar(): Promise<{ transactionHash: string }> {
    const txHash = await this.signAndBroadcastViaOws(
      [(builder) => {
        const contract = new Contract(this.contractId);
        const call = contract.call('pausar');
        builder.addOperation({ body: call.body } as any);
      }],
      this.adminSecretKey
    );

    return { transactionHash: txHash };
  }

  /**
   * Reanuda el contrato (solo admin).
   * Firma vía OWS con la clave admin.
   */
  async reanudar(): Promise<{ transactionHash: string }> {
    const txHash = await this.signAndBroadcastViaOws(
      [
        (builder) => {
          const contract = new Contract(this.contractId);
          const call = contract.call('unpausar');
          builder.addOperation({ body: call.body } as any);
        },
      ],
      this.adminSecretKey
    );

    return { transactionHash: txHash };
  }

  /**
   * Rota la clave admin (solo admin actual).
   * Firma vía OWS con la clave admin actual.
   */
  async rotarAdmin(nuevoAdmin: string): Promise<{ transactionHash: string }> {
    const txHash = await this.signAndBroadcastViaOws(
      [
        (builder) => {
          const contract = new Contract(this.contractId);
          const call = contract.call(
            'set_admin',
            nativeToScVal(Address.fromString(nuevoAdmin))
          );
          builder.addOperation({ body: call.body } as any);
        },
      ],
      this.adminSecretKey
    );

    return { transactionHash: txHash };
  }
}
