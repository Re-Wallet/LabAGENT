#![no_std]

//! # Event Anchor - ReWallet Lab (Capa 4)
//!
//! Contrato Soroban para anclaje de eventos off-chain.
//! Almacena roots Merkle de lotes de eventos para verificación off-chain.

use soroban_sdk::{
    contract, contractevent, contracterror, contractimpl, contracttype, panic_with_error, Address,
    Bytes, Env,
};

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BatchStatus {
    Pending = 0,
    Anchored = 1,
}

#[contracttype]
#[derive(Clone)]
pub struct Batch {
    pub batch_id: u64,
    pub root_hash: Bytes,
    pub event_count: u32,
    pub timestamp: u64,
    pub status: BatchStatus,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub last_batch_id: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Batch(u64),
    EventCount(u64),
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    ConfigNotInitialized = 1,
    BatchNotFound = 2,
    InvalidConfig = 3,
    Unauthorized = 4,
}

#[contractevent(topics = ["batch_anchored"])]
pub struct BatchAnchoredEvent {
    pub batch_id: u64,
    pub root_hash: Bytes,
    pub event_count: u32,
    pub timestamp: u64,
}

#[contract]
pub struct EventAnchor;

#[contractimpl]
impl EventAnchor {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(
            &DataKey::Config,
            &Config { admin, last_batch_id: 0 },
        );
    }

    pub fn get_config(env: Env) -> Config {
        Self::config(&env)
    }

    pub fn get_batch(env: Env, batch_id: u64) -> Option<Batch> {
        env.storage().persistent().get(&DataKey::Batch(batch_id))
    }

    pub fn get_last_batch_id(env: Env) -> u64 {
        Self::config(&env).last_batch_id
    }

    pub fn get_total_events(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::EventCount(0))
            .unwrap_or(0)
    }

    pub fn anchor_batch(
        env: Env,
        batch_id: u64,
        root_hash: Bytes,
        event_count: u32,
        timestamp: u64,
    ) -> Result<(), Error> {
        let config = Self::config(&env);
        config.admin.require_auth();

        let key = DataKey::Batch(batch_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::BatchNotFound);
        }

        let batch = Batch {
            batch_id,
            root_hash: root_hash.clone(),
            event_count,
            timestamp,
            status: BatchStatus::Anchored,
        };

        env.storage().persistent().set(&key, &batch);

        let mut config = Self::config(&env);
        config.last_batch_id = batch_id.max(config.last_batch_id);
        Self::save_config(&env, &config);

        let total_events_key = DataKey::EventCount(0);
        let total_events: u64 = env
            .storage()
            .persistent()
            .get(&total_events_key)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&total_events_key, &(total_events + event_count as u64));

        BatchAnchoredEvent {
            batch_id,
            root_hash,
            event_count,
            timestamp,
        }
        .publish(&env);

        Ok(())
    }

    fn config(env: &Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    fn save_config(env: &Env, config: &Config) {
        env.storage().instance().set(&DataKey::Config, config);
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_anchor_batch() {
        let env = Env::default();
        let contract_id = env.register_contract(None, EventAnchor);
        let client = EventAnchorClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        env.as_contract(&contract_id, || {
            env.set_auth(admin.clone(), admin.clone());
        });

        client.__constructor(&admin);

        let root_hash = Bytes::from_array(&env, &[1u8; 32]);
        let timestamp = env.ledger().timestamp();

        client.anchor_batch(&1, &root_hash, &1, &timestamp);

        let batch = client.get_batch(&1).unwrap();
        assert_eq!(batch.batch_id, 1);
        assert_eq!(batch.event_count, 1);
        assert_eq!(batch.status, BatchStatus::Anchored);
    }
}
