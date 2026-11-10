# Research Capa 2 — Escrow on-chain (Soroban / Stellar)

**Objetivo:** Elegir la opción más sostenible a largo plazo para el escrow de ReWallet Lab, evitando tener que rehacer las cosas.

**Contexto:** El mercado interno (fase 1) ya está funcionando off-chain. Los Deals se crean en `PENDING_ESCROW`. Capa 2 implica que el Deal pase a `IN_ESCROW` → `DELIVERED` → `SETTLED` (o `DISPUTED`) con fondos retenidos on-chain.

---

## Opciones evaluadas

### Opción A: Mycelium (Python-first framework)

**Qué es:** Framework completo para desarrollo de contratos Soroban y orquestación agéntica. Incluye DSL, SDK, CLI y compiler que transpila Python a Soroban Rust/WASM.

| Aspecto | Detalle |
|---------|---------|
| **Lenguaje** | Python (compila a WASM para Soroban) |
| **Escrow nativo** | Sí, incluye escrow/x402 como parte del framework |
| **SDK** | `mycelium-sdk` (signing, contract calls, x402, hive discovery) |
| **Estado** | v0.5.1 en PyPI, repo GitHub creado junio 2026 |
| **Mantenedores** | 2 contribuyentes principales |
| **Estrellas GitHub** | 1 |
| **Auditoría** | CertiK: "Moderately Developed", No KYC verificado |
| **SCF** | Sí, participó en Stellar Community Fund |
| **Stack mismatch** | Nuestro backend es Node/TS; Mycelium es Python |

**Ventajas:**
- Un solo framework cubre agente + escrow + SDK (menos herramientas que gestionar)
- Escrow x402 incluido nativamente
- Python-first (más fácil de escribir lógica de negocio compleja)

**Desventajas:**
- Framework muy nuevo (repo público desde junio 2026, solo 1 estrella)
- Pocos mantenedores (2 personas) — riesgo de abandono
- No auditado profesionalmente (CertiK solo scoring, no auditoría de contratos)
- Stack mismatch: backend Node/TS vs framework Python
- Menos control sobre la lógica del escrow (es del framework)

---

### Opción B: Cogladius (SDK TypeScript)

**Qué es:** SDK TypeScript para tareas con recompensa bloqueada en escrow Soroban. Los humanos postean tareas con recompensa XLM bloqueada, los agentes compiten, y el escrow libera solo con veredict on-chain.

| Aspecto | Detalle |
|---------|---------|
| **Lenguaje** | TypeScript (encaja con nuestro stack) |
| **Escrow** | One-way-channel (pago unidireccional) |
| **Estado** | v0.2.5 en npm, experimental/testnet |
| **Auditoría** | **Contrato unaudited upstream code** |
| **Límites** | Canales limitados a 5 XLM por seguridad |
| **Spend caps** | 2 XLM lifetime, 0.1 XLM por pago, 1 XLM por sesión |

**Ventajas:**
- TypeScript (encaja con nuestro stack Node/TS)
- Diseñado para agentes autónomos
- Reputación recomputable desde eventos públicos

**Desventajas:**
- **Contrato no auditado** — riesgo de seguridad alto para fondos
- Límite de 5 XLM por canal — insuficiente para pagos comerciales reales
- Diseñado para "tareas con recompensa", no para RFQ/negociación de compraventa
- Spend caps muy restrictivos para uso comercial
- Experimental, no apto para producción

---

### Opción C: Contrato Soroban simple personalizado

**Qué es:** Escribir nuestro propio contrato de escrow en Soroban (Rust) adaptado exactamente a las necesidades de ReWallet (Request/Offer/Deal).

| Aspecto | Detalle |
|---------|---------|
| **Lenguaje** | Rust (Soroban) |
| **Escrow** | Totalmente bajo nuestro control |
| **Estado** | Por escribir |
| **Auditoría** | Por contratar (necesario antes de mainnet) |
| **Upgradeability** | Soroban tiene `update_current_contract` nativo (no necesita proxy patterns como EVM) |
| **Stack** | Backend Node/TS llama al contrato vía stellar-sdk |

**Ventajas:**
- Control total sobre la lógica de escrow (condiciones de liberación, disputas, reembolsos)
- No dependemos de framework externo que pueda ser abandonado
- Soroban tiene upgradeability nativa (WASM bytecode replacement in-place, mismo contract ID)
- Podemos empezar simple (liberación directa) y agregar complejidad (disputas, arbitraje) gradualmente
- Alineado con el brief: "velocidad de validación sobre elegancia arquitectónica"

**Desventajas:**
- Tenemos que escribir, probar y auditar el contrato nosotros mismos
- Requiere conocimiento de Rust/Soroban (o contratarlo)
- Antes de mainnet es obligatorio una auditoría profesional

---

## Comparativa de sostenibilidad a largo plazo

| Criterio | Mycelium | Cogladius | Contrato simple |
|----------|----------|-----------|-----------------|
| **Control sobre la lógica** | Bajo (del framework) | Bajo (del framework) | **Alto (nosotros)** |
| **Stack alineado (Node/TS)** | No (Python) | Sí (TypeScript) | Sí (TS llama al contrato) |
| **Auditoría existente** | No | **No (unaudited)** | Por hacer |
| **Límites de monto** | Sin límites conocidos | 5 XLM por canal | Sin límites (nosotros definimos) |
| **Mantenimiento a largo plazo** | Riesgo (2 mantenedores, framework nuevo) | Riesgo (experimental) | **Controlado (nosotros)** |
| **Upgradeability** | Depende del framework | N/A | **Nativa en Soroban** |
| **Velocidad de implementación** | Media (aprender framework) | Baja (ya hay SDK) | Alta (contrato simple) |
| **Adecuado para PoC** | Medio | Bajo (límites 5 XLM) | **Alto** |

---

## Recomendación: Opción C — Contrato Soroban simple personalizado

**Razón principal:** Para una fase de validación rápida (PoC), necesitamos algo que podamos escribir rápido, controlar completamente, y que no nos obligue a rehacer todo si el framework externo cambia o se abandona. Un contrato Soroban simple nos da:

1. **Control total:** La lógica de liberación de fondos está definida por nosotros, no por un framework externo.
2. **Sin dependencia de frameworks nuevos y poco probados:** Ni Mycelium (1 estrella, 2 mantenedores) ni Cogladius (contrato unaudited, límite 5 XLM).
3. **Upgradeability nativa de Soroban:** Si necesitamos cambiar la lógica del escrow, Soroban permite actualizar el WASM in-place manteniendo el mismo contract ID (no hay que migrar usuarios a un nuevo contrato).
4. **Escalable:** Empezamos con liberación directa (comprador paga → vendedor recibe), y luego agregamos disputas, arbitraje, milestone payments gradualmente.

**Cuándo reconsiderar Mycelium o Cogladius:** Solo si en fases futuras necesitamos características avanzadas que ellos proporcionen nativamente (ej. x402 micropagos, reputación recomputable automática) y hayan madurado (auditoría, más mantenedores, límites más altos).

---

## Plan de implementación Capa 2 (contrato simple)

### Tareas

| # | Tarea | Descripción | Estimación |
|---|-------|-------------|------------|
| 1 | Research y diseño del contrato | Definir estados, roles, condiciones de liberación, disputa | 0.5 día |
| 2 | Escribir contrato Soroban (Rust) | `init`, `deposit`, `release`, `refund`, `dispute`, `resolve` | 2 días |
| 3 | Compilar y desplegar en testnet | Wasm, contract ID, inicializar | 0.5 día |
| 4 | Integrar con backend Node/TS | Llamar al contrato desde el cierre del Deal | 1 día |
| 5 | Actualizar máquina de estados del Deal | `PENDING_ESCROW` → `IN_ESCROW` → `DELIVERED` → `SETTLED` / `DISPUTED` | 0.5 día |
| 6 | Eventos on-chain ↔ off-chain | Emitir eventos en LabAGENT cuando cambie estado on-chain | 0.5 día |
| 7 | Pruebas E2E en testnet | Flujo completo: solicitud → oferta → aceptar → depósito → liberación | 1 día |
| 8 | Documentación y auditoría plan | Documentar el contrato, planificar auditoría antes de mainnet | 0.5 día |

**Total estimado:** ~6 días relativos

### Decisiones por confirmar (antes de codear)

1. **¿Aprobas usar Contrato Soroban simple personalizado (Opción C) en lugar de Mycelium o Cogladius?**
   - Default propuesto: **Sí**

2. **¿El contrato debe empezar con liberación simple (comprador confirma → se libera) o incluir disputa/arbitraje desde el inicio?**
   - Default propuesto: **Liberación simple primero, disputa en fase posterior**

3. **¿Qué token se usa en el escrow?** USDC en Stellar testnet (ya validado en PoC)
   - Default propuesto: **USDC (testnet)**

4. **¿Quién puede trigger la liberación?** ¿Solo el comprador, o también el vendedor después de un timeout?
   - Default propuesto: **Comprador confirma; timeout automático después de X días → liberación o disputa**

5. **¿Aprobas comenzar la implementación de Capa 2 una vez definidas estas decisiones?**
   - Default propuesto: **Sí**

---

**No empezar a codear Capa 2 hasta recibir tu aprobación de este research y las decisiones marcadas.**
