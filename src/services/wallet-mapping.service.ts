import { query } from '../config/db';

export interface WalletMapping {
  id: string;
  labagent_user_id: string;
  solana_public_key: string;
  network: string;
  created_at: Date;
}

/**
 * Guarda el mapeo entre un usuario de LabAGENT y su clave pública de Solana.
 * Esto permite saber a qué wallet enviar USDC cuando se acepta un Deal.
 */
export async function saveWalletMapping(
  labagent_user_id: string,
  solana_public_key: string,
  network: string = 'devnet'
): Promise<WalletMapping> {
  const res = await query(
    `INSERT INTO wallet_mappings (labagent_user_id, solana_public_key, network)
     VALUES ($1, $2, $3)
     ON CONFLICT (labagent_user_id)
     DO UPDATE SET solana_public_key = $2, network = $3, updated_at = now()
     RETURNING id, labagent_user_id, solana_public_key, network, created_at`,
    [labagent_user_id, solana_public_key, network]
  );
  return res.rows[0];
}

/**
 * Obtiene la clave pública de Solana de un usuario de LabAGENT.
 */
export async function getWalletMapping(
  labagent_user_id: string
): Promise<WalletMapping | null> {
  const res = await query(
    `SELECT id, labagent_user_id, solana_public_key, network, created_at
     FROM wallet_mappings WHERE labagent_user_id = $1`,
    [labagent_user_id]
  );
  return res.rows[0] ?? null;
}

/**
 * Obtiene el usuario de LabAGENT asociado a una clave pública de Solana.
 */
export async function getLabAgentUserBySolanaKey(
  solana_public_key: string
): Promise<{ labagent_user_id: string } | null> {
  const res = await query(
    `SELECT labagent_user_id FROM wallet_mappings WHERE solana_public_key = $1`,
    [solana_public_key]
  );
  return res.rows[0] ?? null;
}
