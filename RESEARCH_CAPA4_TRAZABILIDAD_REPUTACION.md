# Research Capa 4 — Trazabilidad y Reputación On-Chain (ReWallet Lab)

**Estado:** Research para fase futura (Capa 4 del brief)  
**Contexto:** La fase actual (mercado off-chain) ya emite eventos estándar en la tabla `events` (invariante I3 e I7). El DDL oficial vive en otro proyecto/rama; `tests/setup.ts` tiene el DDL local equivalente.

---

## El problema: "dar valor a la traza" no es un único feature

Según el contexto recibido, la trazabilidad y reputación tienen **tres niveles** que se implementan en orden estricto:

```
Mercado funcional (requests, offers, deals)
      ↓
Escrow (los deals se liquidan, generan eventos con valor económico real: DELIVERED, SETTLED, DISPUTED)
      ↓
Trazabilidad + reputación (ahora sí la traza tiene "valor": deals cerrados, entregas, disputas)
```

Sin escrow, los deals se quedan en `PENDING_ESCROW` y nunca generan eventos de liquidación. La traza de un deal que nunca se liquidó no dice nada sobre la confiabilidad de un agente.

### Lo que SÍ se puede hacer ahora (off-chain, sin escrow)

Ya implementado: **reputación básica off-chain por `agente_id`** (`GET /reputacion/:agenteId`), calculada desde eventos existentes:
- `requests_publicados`, `ofertas_enviadas`, `ofertas_aceptadas`, `deals_creados`, `solicitudes_canceladas`, `mensajes_enviados`
- `tasa_respuesta`, `tasa_cancelacion`, `conversion_request_a_deal`, `tiempo_medio_respuesta_segundos`

Esto es un **prototipo de señal** para validar qué métricas importan antes de comprometerse con un contrato on-chain.

---

## Herramientas Capa 4 — Comparativa para anclaje on-chain

Cuando llegue el escrow y se quiera anclar la trazabilidad on-chain, estas son las opciones:

| Herramienta | Qué hace | Encaje con ReWallet | Madurez | Idioma |
|-------------|----------|---------------------|---------|--------|
| **ORBIT Protocol** | Identidad on-chain para agentes en Soroban, registro, verificación, reputación acumulable por `agente_id`, soulbound passports. 5 contratos desplegados en testnet. | Encaja directamente con `AgentRegistry` conceptual. Muy alineado con `agente_id` distinto del humano (I9). | Testnet, 53 agentes verificados, 73 unit tests | TS SDK + contratos Soroban |
| **AgentRep** | "Credit bureau" para la economía de agentes. Score on-chain de confianza basado en historial real de pagos y entregas. O(1) actualización, ponderado por tasa de éxito y volumen de pago (logarítmico). ERC-8004 estándar. | Patrón más cercano al "historial por agente" del brief. Ideal para `AgentMandate` gobernado por traza. | Testnet/mainnet (Hedera + Stellar versiones) | Contratos + SDK |
| **Agent Passport SDK** (`@ggoldani/agent-passport-sdk`) | Registry de confianza on-chain en Stellar/Soroban con acceso tipado de lectura/escritura al contrato. Ratings solo se desbloquean con pagos verificados (x402). No hay reseñas gratuitas ni autpromoción. | Puente más directo si se mantiene TS como lenguaje principal. Pago-gated = confianza económica real. | Testnet (contrato desplegado), SDK npm | TypeScript SDK + MCP |
| **Cogladius** | SDK TypeScript donde el agente "carry a reputation that anyone can recompute from public events". Escrow no-custodial en Soroban, veredictos on-chain, reputación recomputable desde eventos públicos. | Exactamente el concepto "traza → reputación recomputable". Patrón de escrow reutilizable. | Testnet, contrato upstream no auditado (canales limitados a 5 XLM) | TypeScript SDK |
| **Merkle root / hashes de eventos** (CAP-0046-08) | En lugar de anclar cada evento on-chain, se ancla un Merkle root de lotes de eventos off-chain. La atestación se forma off-chain y solo el root va a Stellar. CAP-0046-08 estandariza hashes SHA256 de eventos de contrato en Stellar. | Patrón que mejor encaja con invariante I3 (log off-chain primero, puente on-chain después). Menos costos de gas. | Propuesta CAP / implementaciones en acceso layer | Especificación + implementaciones de terceros |

---

## Recomendación para ReWallet Lab

### Cuando llegue el escrow (Capa 2)

**Cogladius** es el punto de entrada más natural si se quiere un solo framework que cubra agente + escrow + reputación recomputable. El patrón de escrow con tasks es reutilizable para el mercado de RFQ/negociación.

**Advertencia:** Cogladius declara explícitamente que el contrato de one-way-channel es código upstream no auditado y limita los canales a 5 XLM por seguridad. Tratar como primitiva experimental para el lab, no como infraestructura de producción.

### Cuando llegue la trazabilidad on-chain (Capa 4)

| Si priorizás... | Elegí... | Por qué |
|-----------------|----------|---------|
| Identidad + reputación acumulable por `agente_id`, soulbound passports | **ORBIT Protocol** | Encaja directo con `AgentRegistry` y `agente_id` (I9). Listo en testnet. |
| Score de crédito tipo FICO para agentes, ponderado por pago/volumen | **AgentRep** | Patrón más cercano al "historial por agente" del brief. |
| Mantener TS como lenguaje principal, confianza basada en pagos verificados | **Agent Passport SDK** | Puente directo TS, pago-gated evita reseñas falsas. |
| Reputación recomputable desde eventos públicos, sin confiar en gateway | **Cogladius** | Concepto "traza → reputación recomputable" exacto. |
| Minimizar costos on-chain, anclar lotes de eventos | **Merkle root + CAP-0046-08** | Mejor encaje con I3 (log off-chain primero). |

### Hoja de ruta sugerida

1. **Fase 1 (ahora):** Mercado off-chain + reputación básica off-chain (ya implementado).
2. **Capa 2 (escrow):** Integrar Cogladius o Mycelium para liquidación de deals. Los deals dejan de quedar en `PENDING_ESCROW`.
3. **Capa 4 (trazabilidad):** Anclar eventos on-chain usando Merkle root (CAP-0046-08) + ORBIT/AgentRep para reputación por `agente_id`.
4. **Evolución de AgentMandate:** Ajustar límites según historial de deals cerrados (ver Opción C).

---

## Invariantes respetadas en toda esta hoja de ruta

- **I3:** Todo cambio de estado emite un evento (off-chain ahora, anclaje on-chain después).
- **I7:** Nombres de evento estándar (`RequestCreated`, `OfferAccepted`, `DealCreated`, etc.) se mapean sin ambigüedad a eventos de contrato.
- **I9:** `agente_id` distinto del humano — se mantiene como clave de reputación en todas las herramientas Capa 4.
- **I5:** El Deal es el puente al escrow — cuando llegue el escrow, el Deal ya tiene todo lo necesario (precio final, condiciones, partes).
