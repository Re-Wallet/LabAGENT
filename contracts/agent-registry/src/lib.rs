#![no_std]

//! # Agent Registry - ReWallet Lab (Capa 4)
//!
//! Contrato Soroban para registro de agentes y reputación acumulable.
//! Versión ultra-simplificada para Soroban SDK 29.0.1.

use soroban_sdk::{
    contract, contractevent, contracterror, contractimpl, contracttype, panic_with_error, Address,
    Bytes, Env,
};

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AgentStatus {
    Active = 0,
    Suspended = 1,
    Banned = 2,
}

#[contracttype]
#[derive(Clone)]
pub struct AgentProfile {
    pub agente_id: Address,
    pub nombre: Bytes,
    pub reputacion_score: i128,
    pub deals_cerrados: u32,
    pub deals_exitosos: u32,
    pub volumen_total_usdc: i128,
    pub ultimo_actualizacion: u64,
    pub estado: AgentStatus,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub reputation_decay_factor: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Agent(Address),
    AgentCount(u64),
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    AgentNotFound = 1,
    InvalidConfig = 3,
    Unauthorized = 4,
    AgentAlreadyRegistered = 5,
}

#[contractevent(topics = ["agent_registered"])]
pub struct AgentRegisteredEvent {
    pub agente_id: Address,
    pub nombre: Bytes,
    pub timestamp: u64,
}

#[contractevent(topics = ["reputation_updated"])]
pub struct ReputationUpdatedEvent {
    pub agente_id: Address,
    pub score_anterior: i128,
    pub score_nuevo: i128,
    pub motivo: Bytes,
    pub timestamp: u64,
}

#[contract]
pub struct AgentRegistry;

#[contractimpl]
impl AgentRegistry {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                reputation_decay_factor: 950,
            },
        );
    }

    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn get_agent(env: Env, agente_id: Address) -> Option<AgentProfile> {
        env.storage().persistent().get(&DataKey::Agent(agente_id))
    }

    pub fn get_agent_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::AgentCount(0))
            .unwrap_or(0)
    }

    pub fn register_agent(
        env: Env,
        agente_id: Address,
        nombre: Bytes,
    ) -> Result<(), Error> {
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        config.admin.require_auth();

        let key = DataKey::Agent(agente_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AgentAlreadyRegistered);
        }

        let ahora = env.ledger().timestamp();

        let profile: AgentProfile = AgentProfile {
            agente_id: agente_id.clone(),
            nombre: nombre.clone(),
            reputacion_score: 500,
            deals_cerrados: 0,
            deals_exitosos: 0,
            volumen_total_usdc: 0,
            ultimo_actualizacion: ahora,
            estado: AgentStatus::Active,
        };

        env.storage().persistent().set(&key, &profile);

        let count_key = DataKey::AgentCount(0);
        let count: u64 = env
            .storage()
            .persistent()
            .get(&count_key)
            .unwrap_or(0);
        env.storage().persistent().set(&count_key, &(count + 1));

        AgentRegisteredEvent {
            agente_id: agente_id.clone(),
            nombre: nombre.clone(),
            timestamp: ahora,
        }
        .publish(&env);

        Ok(())
    }

    pub fn actualizar_reputacion(
        env: Env,
        agente_id: Address,
        puntuacion_cambio: i128,
        monto: i128,
    ) -> Result<(), Error> {
        let mut profile: AgentProfile = match env.storage().persistent().get(&DataKey::Agent(agente_id.clone())) {
            Some(p) => p,
            None => return Err(Error::AgentNotFound),
        };

        if profile.estado != AgentStatus::Active {
            return Ok(());
        }

        let mut nuevo_score = profile.reputacion_score;
        nuevo_score = nuevo_saturado(nuevo_score + puntuacion_cambio, 1000);

        if monto > 0 {
            // Bonificador simple basado en monto (evitar f64::log10)
            let volumen_bonus: i128 = if monto > 1000000 { 10 } else if monto > 100000 { 5 } else if monto > 10000 { 2 } else { 1 };
            nuevo_score = nuevo_saturado(nuevo_score + volumen_bonus, 1000);
        }

        profile.reputacion_score = nuevo_score;
        profile.ultimo_actualizacion = env.ledger().timestamp();

        env.storage().persistent().set(
            &DataKey::Agent(agente_id.clone()),
            &profile,
        );

        ReputationUpdatedEvent {
            agente_id: agente_id.clone(),
            score_anterior: profile.reputacion_score,
            score_nuevo: nuevo_score,
            motivo: Bytes::from_slice(&env, b"deal_settled"),
            timestamp: profile.ultimo_actualizacion,
        }
        .publish(&env);

        Ok(())
    }

    pub fn suspender_agente(env: Env, agente_id: Address) -> Result<(), Error> {
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        config.admin.require_auth();

        let mut profile: AgentProfile = match env.storage().persistent().get(&DataKey::Agent(agente_id.clone())) {
            Some(p) => p,
            None => return Err(Error::AgentNotFound),
        };

        profile.estado = AgentStatus::Suspended;
        env.storage().persistent().set(&DataKey::Agent(agente_id), &profile);

        Ok(())
    }

    pub fn reactivar_agente(env: Env, agente_id: Address) -> Result<(), Error> {
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        config.admin.require_auth();

        let mut profile: AgentProfile = match env.storage().persistent().get(&DataKey::Agent(agente_id.clone())) {
            Some(p) => p,
            None => return Err(Error::AgentNotFound),
        };

        profile.estado = AgentStatus::Active;
        env.storage().persistent().set(&DataKey::Agent(agente_id), &profile);

        Ok(())
    }
}

fn nuevo_saturado(valor: i128, maximo: i128) -> i128 {
    if valor > maximo {
        maximo
    } else {
        valor
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_registro_agente() {
        let env = Env::default();
        let contract_id = env.register_contract(None, AgentRegistry);
        let client = AgentRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let agente = Address::generate(&env);

        env.as_contract(&contract_id, || {
            env.set_auth(admin.clone(), admin.clone());
        });
        client.__constructor(&admin);

        env.as_contract(&contract_id, || {
            env.set_auth(admin.clone(), admin.clone());
        });
        client.register_agent(&agente, &Bytes::from_array(&env, b"Agente Test"));

        let profile: AgentProfile = client.get_agent(&agente).unwrap();
        assert_eq!(profile.agente_id, agente);
        assert_eq!(profile.reputacion_score, 500);
        assert_eq!(profile.deals_cerrados, 0);
        assert_eq!(profile.estado, AgentStatus::Active);
    }
}
