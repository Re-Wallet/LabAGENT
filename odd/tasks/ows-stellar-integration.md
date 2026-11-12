# OWS Stellar/Soroban Integration — ReWallet Lab

## Header
Integramos Open Wallet Standard (OWS) como capa de custodia y firmado con políticas sobre el contrato de escrow Soroban existente de ReWallet Lab. Un agente prepara el fork del PR #181 de OWS (soporte Stellar/XLM); otro agente implementa el adaptador en el lab (`EscrowClient`, `AgentMandate`); finalmente se unen y testean.

## Specs
- S1: «forkear el pr 181» — preparar el repositorio/fork de `open-wallet-standard/core` sobre la rama `feature/stellar-integration` (PR #181) para tener soporte Stellar (XLM) con coin type 148, derivation `m/44'/148'/{index}'`, StrKey `G…`, y firma de `TransactionEnvelope` XDR compatible con Soroban (InvokeHostFunction comparte `ENVELOPE_TYPE_TX`).
- S2: «otro agente vaya haciendo toda la implementacion» — adaptar `src/services/escrow-client.service.ts` para delegar el firmado a OWS (vía bindings de Node o CLI) en lugar de `Keypair.fromSecret(...).sign(...)`, y conectar `src/services/agent-mandate.service.ts` con el policy engine de OWS antes de firmar depósitos, liberaciones y reembolsos.
- S3: «al terminar podamos unirla y testear» — unir la base de OWS (PR #181) con la implementación del lab, correr los tests del lab y una prueba end-to-end de firmado de una transacción Soroban de prueba contra testnet de Stellar.

## Tasks
- T1 (S1, explore, commit): Revisar PR #181 de OWS, clonar/preparar la rama `feature/stellar-integration`, verificar `cargo test --workspace` y validar `ows sign tx --chain stellar-testnet`.
- T2 (S2, implement, commit): Crear adaptador OWS en el lab: reemplazar `Keypair.fromSecret` + `.sign()` en `EscrowClient` por llamada a OWS `sign_transaction(chain="stellar:testnet")` y `encode_signed_transaction`.
- T3 (S2, implement, commit): Conectar `AgentMandate` con el policy engine de OWS: validar monto máximo, rango de precio y whitelist de contrapartes antes de permitir la firma de cualquier operación de escrow.
- T4 (S3, implement, commit): Unir base OWS + implementación del lab; correr tests existentes del lab sin regresiones.
- T5 (S3, checking, commit): Prueba end-to-end: construir XDR de una transacción Soroban (depositar/liberar) en el lab, firmar vía OWS, enviar a Horizon testnet y verificar hash de transacción.

## Log
L1: «habiendome sacado todas las dudas ahora si lo hagamos comencemos por un lado que necesito ver si hay una posibilidad que el agente solamente se encargue de forkear el pr 181 y por otro lado otro agente vaya haciendo toda la implementacion para que al terminar podamos unirla y testear»
