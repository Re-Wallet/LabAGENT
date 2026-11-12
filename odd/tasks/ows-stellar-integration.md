# OWS Stellar/Soroban Integration — ReWallet Lab

## Header
Integración completa de Open Wallet Standard (OWS) como capa de custodia y firmado con políticas sobre el contrato de escrow Soroban de ReWallet Lab, incluyendo despliegue de nuevo contrato con USDC de Circle y prueba end-to-end real en testnet.

## Specs
- S1: «forkear el pr 181» — preparar el repositorio/fork de `open-wallet-standard/core` sobre la rama `feature/stellar-integration` (PR #181) para tener soporte Stellar (XLM) con coin type 148, derivation `m/44'/148'/{index}'`, StrKey `G…`, y firma de `TransactionEnvelope` XDR compatible con Soroban.
- S2: «otro agente vaya haciendo toda la implementacion» — adaptar `src/services/escrow-client.service.ts` para delegar el firmado a OWS (vía bindings de Node) en lugar de `Keypair.fromSecret(...).sign(...)`, y conectar `src/services/agent-mandate.service.ts` con el policy engine de OWS antes de firmar depósitos, liberaciones y reembolsos.
- S3: «al terminar podamos unirla y testear» — unir la base de OWS (PR #181) con la implementación del lab, correr los tests del lab y una prueba end-to-end de firmado de una transacción Soroban de prueba contra testnet de Stellar.
- S4: «desplegar contrato con USDC de Circle» — crear `contracts/escrow-deal-circle/` basado en `escrow-deal` existente, con SAC de USDC de Circle por defecto y `comprador.require_auth()` para que el comprador pague su propio USDC.
- S5: «flujo end-to-end real con USDC de Circle» — ejecutar depositar→reclamar→confirmar→liberar con 10 USDC de Circle reales en Stellar testnet y verificar hashes de transacción.

## Tasks
- T1 (S1, explore, commit): Revisar PR #181 de OWS, clonar rama `feature/stellar-integration`, verificar `cargo test --workspace` (555 tests pasan), binario `ows` compilado con soporte stellar y stellar-testnet, bindings de Node instalados y verificados. → COMMIT `5055836`
- T2 (S2, implement, commit): Reemplazar `Keypair.fromSecret` + `.sign()` en `EscrowClient` por `signAndSend` de OWS. Las claves se importan en el vault de OWS cifrado en reposo. Compila sin errores TypeScript. → COMMIT `5055836`
- T3 (S2, implement, commit): Script de política `scripts/ows-agent-mandate-policy.sh` creado. `EscrowClient.setupPolicy()` registra política en OWS, importa clave admin al vault y crea API key vinculada. `owsApiToken` configurable. Compila sin errores. → COMMIT `5055836`
- T4 (S3, implement, commit): `escrow-client.service.ts` compila limpio. Tests E2E requieren PostgreSQL (no disponible en este entorno, preexistente). 555 tests de OWS pasan en `vendor/ows-core/`. → COMMIT `5055836`
- T5 (S3, checking, commit): Verificado que OWS firma XDR de Soroban (InvokeHostFunction: depositar) con `stellar:testnet`, produce firma de 64 bytes válida. `ows sign tx --chain stellar:testnet` funciona. Broadcast real a Horizon probado con pago XLM (hash `d9c08592...`). → COMMIT `5055836`
- T6 (S4, implement, commit): Contrato `escrow-deal-circle/` creado en `contracts/escrow-deal-circle/`. Compilado con `stellar contract build`. Desplegado en Stellar testnet: `CCRVOLUKWDAISVLAVGDYXWXAM5RAQPRW2AGLGJTXF24DAZNT7LOOBA7T`. Admin: `GD2Z6SOFTJD6UBWTJJF7I2ZXYS2NONB6FVH6HBUJYVUFV6TUFOYXBY5Q`. SAC: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. `comprador.require_auth()` implementado. → COMMIT `374d459`
- T7 (S5, checking, commit): Flujo E2E completo verificado con 10 USDC de Circle reales:
  - Depositar (deal_id: 1): `d7ddffa8e1cc11659165a91353a538c5fab20181723f90c269c633096519bc93`
  - Reclamar entrega: `92eee358cb28561ede7daf76d769c0ede14e60721e5a9e764e6515affc57e609`
  - Confirmar entrega: `cd466552d56931707e3a0170c41bcbaa3d2253df6a00827eed1483610e52a49c`
  - Liberar fondos: `0718cd56e736cf2e8ee538e10a60623388ec43e665c6e0c43f75cfbd25ad4967`
  Todos los eventos on-chain verificados en stellar.expert. → COMMIT `876d5b2`

## Log
L1: «habiendome sacado todas las dudas ahora si lo hagamos comencemos por un lado que necesito ver si hay una posibilidad que el agente solamente se encargue de forkear el pr 181 y por otro lado otro agente vaya haciendo toda la implementacion para que al terminar podamos unirla y testear»
L2: «si vamos hazlo tu» — Parent implementa T1-T5 inline tras fallo de workers gentle-ai-worker (modelos no disponibles)
L3: «el usdc quiero que sea de circle» — Cambio a USDC de Circle testnet SAC
L4: «no, lo que haremos sera desplegar otro contrato pero que acepte usdc de circle respetando lo que ya tenemos» — Nuevo contrato `escrow-deal-circle` con `comprador.require_auth()`
L5: «voy a crear la linea de confianza y fondearme con usdc de circle, ahora el codigo de aca tambien tiene que estar para usdc de circle alli haremos las pruebas» — Código preparado para USDC Circle, cuenta de usuario fondeada con Friendbot
L6: «vamos con esto «1. Modificar el contrato para que el comprador pueda depositar su propio USDC sin necesidad de auth del admin»» — Contrato modificado, redeployado, flujo E2E verificado con USDC de Circle real

## Commits
- `5055836` — feat: integrar Open Wallet Standard (OWS) como capa de custodia y firmado con políticas sobre escrow Soroban
- `b366622` — feat: preparar código para USDC de Circle en testnet
- `374d459` — feat: desplegar contrato escrow con USDC de Circle y actualizar cliente
- `876d5b2` — feat: flujo end-to-end USDC de Circle completado y contrato corregido