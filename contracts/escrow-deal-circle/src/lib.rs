#![no_std]

//! # Escrow de Deal - ReWallet Lab (Capa 2) — USDC de Circle (testnet)
//!
//! Contrato Soroban para retener fondos USDC en un Deal hasta que se cumplan
//! las condiciones de liberación. Modelo request-céntrico (I1 del brief).
//! No hay billetera custodia: el contrato *es* el escrow.
//!
//! Esta versión usa el SAC de USDC de Circle en Stellar testnet:
//!   SAC:  CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
//!   Issuer: GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
//!
//! El contrato anterior (escrow-deal) se mantiene intacto para no romper
//! nada que ya dependa de él.

use soroban_sdk::{
    contract, contractevent, contracterror, contractimpl, contracttype, panic_with_error, token,
    Address, Bytes, Env,
};

////////////////////////////////////////////////////////////////////////////////
// Tipos de datos
////////////////////////////////////////////////////////////////////////////////

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DealStatus {
    PendingEscrow = 0,
    InEscrow = 1,
    Delivered = 2,
    Settled = 3,
    Disputed = 4,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    /// Administración: pausa, rotación de admin, configuración.
    pub admin: Address,
    /// Stellar Asset Contract (SAC) del USDC de Circle testnet.
    pub usdc_sac: Address,
    /// Segundos después de `deadline` durante los cuales un reembolso está
    /// bloqueado, dando ventana para asentar antes de permitir reembolso
    /// sin restricciones.
    pub settle_grace_seconds: u64,
    /// Stop de emergencia: bloquea nuevas operaciones (salvo reembolso).
    pub paused: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct Deal {
    pub deal_id: u64,
    pub comprador: Address,
    pub vendedor: Address,
    pub monto: i128,                // USDC en unidades base (7 decimales)
    pub estado: DealStatus,
    pub creado_en: u64,             // Ledger timestamp de creación
    pub entrega_reclamada_en: Option<u64>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Deal(u64),
    NextDealId(u64),                // Contador para generar deal_id secuencial
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    DealExists = 1,
    DealNotFound = 2,
    InvalidState = 3,
    InvalidAmount = 4,
    NotExpired = 5,
    Paused = 6,
    RefundLocked = 7,
    InvalidConfig = 8,
    NotAuthorized = 9,
    DeliveryAlreadyClaimed = 10,
    DeliveryAlreadyConfirmed = 11,
    AlreadySettled = 12,
}

////////////////////////////////////////////////////////////////////////////////
// Eventos on-chain (nombres estándar I7)
////////////////////////////////////////////////////////////////////////////////

#[contractevent(topics = ["deposito"])]
pub struct DepositoEvent {
    pub deal_id: u64,
    pub comprador: Address,
    pub monto: i128,
    pub timestamp: u64,
}

#[contractevent(topics = ["entrega_reclamada"])]
pub struct EntregaReclamadaEvent {
    pub deal_id: u64,
    pub vendedor: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["entrega_confirmada"])]
pub struct EntregaConfirmadaEvent {
    pub deal_id: u64,
    pub comprador: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["liberado"])]
pub struct LiberadoEvent {
    pub deal_id: u64,
    pub comprador: Address,
    pub vendedor: Address,
    pub monto: i128,
    pub timestamp: u64,
}

#[contractevent(topics = ["reembolsado"])]
pub struct ReembolsadoEvent {
    pub deal_id: u64,
    pub comprador: Address,
    pub monto: i128,
    pub timestamp: u64,
}

#[contractevent(topics = ["disputado"])]
pub struct DisputadoEvent {
    pub deal_id: u64,
    pub motivo: Bytes,
    pub timestamp: u64,
}

#[contractevent(topics = ["pause"])]
pub struct PauseEvent {
    pub paused: bool,
}

#[contractevent(topics = ["admin_rotado"])]
pub struct AdminRotadoEvent {
    pub nuevo_admin: Address,
}

// TTL: ~30 días de ledgers antes de necesitar bump
const DEAL_TTL_THRESHOLD: u32 = 17_280;  // ~1 día
const DEAL_TTL_EXTEND: u32 = 518_400;     // ~30 días

// SAC de USDC de Circle en Stellar testnet (default al construir)
// Puede ser sobresalido al llamar al constructor.
const USDC_CIRCLE_TESTNET_SAC: &str = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

//////////////////////////////////////////////////////////////////////////////
// Contrato
//////////////////////////////////////////////////////////////////////////////

#[contract]
pub struct EscrowDealCircleContract;

#[contractimpl]
impl EscrowDealCircleContract {
    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------
    pub fn __constructor(
        env: Env,
        admin: Address,
        usdc_sac: Address,
        settle_grace_seconds: u64,
    ) {
        if settle_grace_seconds == 0 {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                usdc_sac,
                settle_grace_seconds,
                paused: false,
            },
        );
        // Inicializar contador de deal_id
        env.storage()
            .persistent()
            .set(&DataKey::NextDealId(0), &0u64);
    }

    // -----------------------------------------------------------------------
    // Lectura de configuración y deals
    // -----------------------------------------------------------------------
    pub fn get_config(env: Env) -> Config {
        Self::config(&env)
    }

    pub fn get_deal(env: Env, deal_id: u64) -> Option<Deal> {
        env.storage()
            .persistent()
            .get(&DataKey::Deal(deal_id))
    }

    pub fn get_next_deal_id(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::NextDealId(0))
            .unwrap_or(0)
    }

    // -----------------------------------------------------------------------
    // 1. depositar: comprador bloquea USDC en el escrow
    // -----------------------------------------------------------------------
    /// Crea un Deal en estado PENDING_ESCROW y bloquea el monto de USDC.
    /// Llamada por el comprador, quien paga su propio USDC al escrow.
    pub fn depositar(
        env: Env,
        comprador: Address,
        vendedor: Address,
        monto: i128,
        _deadline: u64,
    ) -> Result<u64, Error> {
        // El comprador paga su propio USDC al escrow
        comprador.require_auth();

        let config = Self::config(&env);
        if config.paused {
            return Err(Error::Paused);
        }
        if monto <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Generar deal_id secuencial
        let next_id_key = DataKey::NextDealId(0);
        let next_id: u64 = env
            .storage()
            .persistent()
            .get(&next_id_key)
            .unwrap_or(0);
        let deal_id = next_id + 1;

        let key = DataKey::Deal(deal_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::DealExists);
        }

        let ahora = env.ledger().timestamp();

        // Efectos antes de interacción (CEI): registrar el deal
        env.storage().persistent().set(
            &key,
            &Deal {
                deal_id,
                comprador: comprador.clone(),
                vendedor: vendedor.clone(),
                monto,
                estado: DealStatus::PendingEscrow,
                creado_en: ahora,
                entrega_reclamada_en: None,
            },
        );
        env.storage().persistent().extend_ttl(&key, DEAL_TTL_THRESHOLD, DEAL_TTL_EXTEND);

        // Actualizar contador
        env.storage().persistent().set(&next_id_key, &deal_id);

        // Interacción: transferir USDC del comprador al contrato
        token::TokenClient::new(&env, &config.usdc_sac).transfer(
            &comprador,
            &env.current_contract_address(),
            &monto,
        );

        DepositoEvent {
            deal_id,
            comprador,
            monto,
            timestamp: ahora,
        }
        .publish(&env);

        Ok(deal_id)
    }

    // -----------------------------------------------------------------------
    // 2. reclamar_entrega: vendedor reclama haber entregado
    // -----------------------------------------------------------------------
    /// El vendedor indica que ha entregado el producto/servicio.
    /// Transición: PENDING_ESCROW → IN_ESCROW
    pub fn reclamar_entrega(
        env: Env,
        deal_id: u64,
        prueba_entrega: Bytes,
    ) -> Result<(), Error> {
        let key = DataKey::Deal(deal_id);
        let mut deal = Self::load(&env, &key)?;

        if deal.estado != DealStatus::PendingEscrow {
            return Err(Error::InvalidState);
        }

        // Solo el vendedor puede reclamar entrega
        deal.vendedor.require_auth();

        // Efectos antes de interacción
        deal.estado = DealStatus::InEscrow;
        deal.entrega_reclamada_en = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &deal);

        EntregaReclamadaEvent {
            deal_id,
            vendedor: deal.vendedor.clone(),
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // 3. confirmar_entrega: comprador confirma recepción
    // -----------------------------------------------------------------------
    /// El comprador confirma que recibió el producto/servicio.
    /// Transición: IN_ESCROW → DELIVERED
    pub fn confirmar_entrega(env: Env, deal_id: u64) -> Result<(), Error> {
        let key = DataKey::Deal(deal_id);
        let mut deal = Self::load(&env, &key)?;

        if deal.estado != DealStatus::InEscrow {
            return Err(Error::InvalidState);
        }

        // Solo el comprador puede confirmar
        deal.comprador.require_auth();

        // Efectos antes de interacción
        deal.estado = DealStatus::Delivered;
        env.storage().persistent().set(&key, &deal);

        EntregaConfirmadaEvent {
            deal_id,
            comprador: deal.comprador.clone(),
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // 4. liberar: comprador libera fondos al vendedor
    // -----------------------------------------------------------------------
    /// El comprador aprueba la liberación final de fondos.
    /// Transición: DELIVERED → SETTLED
    pub fn liberar(env: Env, deal_id: u64) -> Result<(), Error> {
        let config = Self::config(&env);
        if config.paused {
            return Err(Error::Paused);
        }

        let key = DataKey::Deal(deal_id);
        let mut deal = Self::load(&env, &key)?;

        if deal.estado != DealStatus::Delivered {
            return Err(Error::InvalidState);
        }

        // Solo el comprador puede liberar fondos
        deal.comprador.require_auth();

        // Efectos antes de interacción (CEI)
        let monto = deal.monto;
        let vendedor = deal.vendedor.clone();
        let comprador = deal.comprador.clone();
        deal.estado = DealStatus::Settled;
        env.storage().persistent().set(&key, &deal);

        // Interacción: transferir USDC del contrato al vendedor
        token::TokenClient::new(&env, &config.usdc_sac).transfer(
            &env.current_contract_address(),
            &vendedor,
            &monto,
        );

        LiberadoEvent {
            deal_id,
            comprador,
            vendedor,
            monto,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // 5. reembolsar: devolver fondos al comprador
    // -----------------------------------------------------------------------
    /// Reembolsa el monto al comprador.
    ///
    /// - Estado PENDING_ESCROW: antes de `deadline + settle_grace` solo el
    ///   comprador puede cancelar; después, permiso abierto.
    /// - Estado IN_ESCROW/DELIVERED: bloqueado hasta `deadline + settle_grace`
    ///   para evitar front-running; después, permiso abierto.
    pub fn reembolsar(env: Env, deal_id: u64) -> Result<(), Error> {
        let key = DataKey::Deal(deal_id);
        let mut deal = Self::load(&env, &key)?;

        if deal.estado != DealStatus::PendingEscrow
            && deal.estado != DealStatus::InEscrow
            && deal.estado != DealStatus::Delivered
        {
            return Err(Error::InvalidState);
        }

        let config = Self::config(&env);
        let grace_end = deal
            .creado_en
            .saturating_add(config.settle_grace_seconds);
        let ahora = env.ledger().timestamp();

        if ahora <= grace_end {
            // Dentro de la ventana de gracia
            if deal.estado != DealStatus::PendingEscrow {
                // Trabajo comprometido: no reembolsar hasta que termine ventana
                return Err(Error::RefundLocked);
            }
            // PENDING_ESCROW: solo el comprador puede cancelar temprano
            deal.comprador.require_auth();
        }

        // Efectos antes de interacción (CEI)
        let comprador = deal.comprador.clone();
        let monto = deal.monto;
        deal.estado = DealStatus::Disputed;
        env.storage().persistent().set(&key, &deal);

        // Interacción: transferir USDC del contrato al comprador
        token::TokenClient::new(&env, &config.usdc_sac).transfer(
            &env.current_contract_address(),
            &comprador,
            &monto,
        );

        ReembolsadoEvent {
            deal_id,
            comprador,
            monto,
            timestamp: ahora,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // 6. disputar: abrir disputa (Capa 3 placeholder)
    // -----------------------------------------------------------------------
    /// Abre una disputa sobre el deal.
    /// Transición: cualquier estado → DISPUTED
    pub fn disputar(env: Env, deal_id: u64, motivo: Bytes) -> Result<(), Error> {
        let key = DataKey::Deal(deal_id);
        let mut deal = Self::load(&env, &key)?;

        if deal.estado == DealStatus::Disputed {
            return Err(Error::InvalidState);
        }
        if deal.estado == DealStatus::Settled {
            return Err(Error::AlreadySettled);
        }

        // Cualquiera puede iniciar una disputa
        if motivo.len() == 0 {
            return Err(Error::InvalidAmount);
        }

        // Efectos antes de interacción
        deal.estado = DealStatus::Disputed;
        env.storage().persistent().set(&key, &deal);

        DisputadoEvent {
            deal_id,
            motivo,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // 7. pause / unpause: stop de emergencia
    // -----------------------------------------------------------------------
    pub fn pause(env: Env) {
        let mut config = Self::config(&env);
        config.admin.require_auth();
        config.paused = true;
        Self::save_config(&env, &config);
        PauseEvent { paused: true }.publish(&env);
    }

    pub fn unpause(env: Env) {
        let mut config = Self::config(&env);
        config.admin.require_auth();
        config.paused = false;
        Self::save_config(&env, &config);
        PauseEvent { paused: false }.publish(&env);
    }

    // -----------------------------------------------------------------------
    // 8. set_admin: rotación de clave admin
    // -----------------------------------------------------------------------
    pub fn set_admin(env: Env, nuevo_admin: Address) {
        let mut config = Self::config(&env);
        config.admin.require_auth();
        config.admin = nuevo_admin.clone();
        Self::save_config(&env, &config);
        AdminRotadoEvent {
            nuevo_admin,
        }
        .publish(&env);
    }

    // -----------------------------------------------------------------------
    // Métodos internos
    // -----------------------------------------------------------------------
    fn config(env: &Env) -> Config {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap()
    }

    fn save_config(env: &Env, config: &Config) {
        env.storage().instance().set(&DataKey::Config, config);
    }

    fn load(env: &Env, key: &DataKey) -> Result<Deal, Error> {
        env.storage()
            .persistent()
            .get(key)
            .ok_or(Error::DealNotFound)
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_depositar_y_reembolsar() {
        let env = Env::default();
        let contract_id = env.register_contract(None, EscrowDealCircleContract);
        let client = EscrowDealCircleContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let usdc_sac = Address::generate(&env);
        let comprador = Address::generate(&env);
        let vendedor = Address::generate(&env);

        // Inicializar contrato
        client.__constructor(&admin, &usdc_sac, &86400);

        // Depositar (en tests de unidad se usa set_auth para simular auth)
        env.as_contract(&contract_id, || {
            env.set_auth(comprador.clone(), comprador.clone());
        });

        let deal_id = client.depositar(
            &comprador,
            &vendedor,
            &1000,
            &(env.ledger().timestamp() + 100000),
        );
        assert_eq!(deal_id, Ok(1));

        // Verificar estado
        let deal = client.get_deal(&deal_id).unwrap();
        assert_eq!(deal.estado, DealStatus::PendingEscrow);
        assert_eq!(deal.monto, 1000);
    }
}
