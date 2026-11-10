# Research Capa 2 — Escrow on-chain con Cogladius (Soroban / Stellar)

**Decisión tomada por el usuario:** Usar Cogladius para Capa 2.
**Advertencia:** Contrato unaudited upstream code, límite de 5 XLM por canal, spend caps restrictivos. Aceptable para lab de validación rápida con montos pequeños. NO usar en producción sin auditoría.

---

## Qué es Cogladius

SDK TypeScript para agentes que encuentran tareas con recompensa bloqueada en escrow Soroban, pagan por datos, envían trabajo y cobran on-chain con reputación recomputable.

| Aspecto | Detalle |
|---------|---------|
| **Lenguaje** | TypeScript (encaja con nuestro stack Node/TS) |
| **Escrow** | One-way-channel (pago unidireccional) |
| **Estado** | v0.2.5 en npm, experimental/testnet |
| **Auditoría** | **Contrato unaudited upstream code** |
| **Límites** | Canales limitados a 5 XLM por seguridad |
| **Spend caps** | 2 XLM lifetime, 0.1 XLM por pago, 1 XLM por sesión |
| **Reputación** | Recomputable desde eventos públicos |

---

## Adaptación a ReWallet (RFQ / negociación, no "tareas con recompensa")

Cogladius está diseñado para "tareas con recompensa" (un publicador pone XLM, un agente ejecuta, un veredict libera). En ReWallet nuestro modelo es **request-céntrico** (I1): una solicitud de compra, ofertas, y un deal cerrado.

**Mapeo necesario:**

| Concepto ReWallet | Concepto Cogladius | Adaptación |
|-------------------|-------------------|------------|
| Request (solicitud de compra) | Task (tarea con recompensa) | La request se publica como una tarea con recompensa = precio del deal |
| Offer (oferta) | Task claim / submission | El vendedor "reclama" la task con su precio y condiciones |
| Deal cerrado | Task accepted / verdict | El comprador acepta = veredict que libera el escrow |
| Deal PENDING_ESCROW | Reward locked | El XLM/USDC queda bloqueado en el contrato |
| Deal DELIVERED / SETTLED | Funds released | El veredict on-chain libera los fondos |
| Deal DISPUTED | Dispute / refund | Si hay disputa, se devuelven los fondos |

---

## Plan de implementación Capa 2 con Cogladius

### Tareas

| # | Tarea | Descripción | Estimación |
|---|-------|-------------|------------|
| 1 | Research e integración del SDK Cogladius | Instalar `@cogladius/sdk`, entender API de creación de task, claim, settle | 1 día |
| 2 | Mapear Deal ↔ Task Cogladius | Definir cómo se crea una task desde un Deal aceptado | 0.5 día |
| 3 | Crear task en escrow al aceptar oferta | Al aceptar Deal en LabAGENT, crear task en Cogladius con monto bloqueado | 1 día |
| 4 | Sincronizar estado del Deal | Consultar estado del task/task en Cogladius, actualizar Deal PENDING_ESCROW → IN_ESCROW → DELIVERED / DISPUTED | 1 día |
| 5 | Manejo de montos > 5 XLM | Estrategia para pagos que excedan el límite de canal (dividir, o usar XLM como medio y USDC como valor de referencia) | 0.5 día |
| 6 | Pruebas E2E en testnet | Flujo completo: solicitud → oferta → aceptar → task en escrow → liberación | 1 día |
| 7 | Documentación y advertencias de seguridad | Documentar límites, contrato unaudited, estrategia de mitigación | 0.5 día |

**Total estimado:** ~5 días relativos

---

## Advertencias críticas (debe aceptar el usuario)

1. **Contrato unaudited:** El contrato de one-way-channel es código upstream no auditado. No usar con fondos reales.
2. **Límite 5 XLM por canal:** Los pagos mayores a 5 XLM requieren dividir en múltiples canales o usar otra estrategia.
3. **Spend caps restrictivos:** 2 XLM lifetime, 0.1 XLM por pago, 1 XLM por sesión. Necesita configuración cuidadosa para no bloquear pagos legítimos.
4. **Solo XLM, no USDC nativo:** Cogladius bloquea XLM en el escrow. Para USDC se necesita conversión o usar XLM como medio de pago con USDC como referencia de valor.
5. **Experimental/testnet:** Solo para validación en testnet. No apto para producción.

---

## Decisiones por confirmar (antes de codear)

| # | Decisión | Default propuesto |
|---|----------|-------------------|
| 1 | ¿Aprobar usar Cogladius para Capa 2 sabiendo que el contrato está unaudited y tiene límite de 5 XLM? | Sí (ya decidiste, pero confirmar explícitamente) |
| 2 | ¿Cómo manejar pagos > 5 XLM? | Dividir en múltiples canales, o usar XLM como medio con conversión a USDC off-chain |
| 3 | ¿Qué red Stellar usar para pruebas? | Testnet (ya validado en PoC) |
| 4 | ¿Incluir disputa/arbitraje en Capa 2 o dejar para Capa 3? | Dejar para Capa 3 (Capa 2 = liberación directa simple) |
| 5 | ¿Apruebas comenzar la implementación de Capa 2 con Cogladius? | Sí |

---

**No empezaré a codear Capa 2 hasta recibir tu aprobación explícita de este plan.**
