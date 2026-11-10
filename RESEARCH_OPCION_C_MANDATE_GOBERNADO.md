# Research Opción C — AgentMandate gobernado por traza (ReWallet Lab)

**Estado:** Diseño para fase futura (Capa 3/4 del brief)  
**Contexto:** La fase actual modela AgentMandate off-chain con límites estáticos. La traza (tabla `events`) ya existe y captura cada transición de estado (invariante I3, I7).

---

## El problema

El `AgentMandate` actual tiene límites fijos:
- `gasto_max_por_operacion`
- `gasto_max_acumulado`
- `gasto_ventana_tiempo`
- `rango_precio_aceptable` (min/max)
- `plazo_max_entrega`
- `whitelist_contrapartes`

Estos límites se aplican off-chain y nunca cambian según el desempeño del agente. El brief (Sección 6, etapa Traza) dice que el agente "aprende de la traza para proponer ajustes a sus límites (fase posterior, siempre gobernado, nunca autónomo sin control)".

---

## Diseño: Mandato Dinámico Gobernado

La idea es que la traza generada en fase 1 se use para **proponer** ajustes al mandato, pero un humano debe **aprobarlos** explícitamente. Nunca es autónomo.

### Flujo

```
Eventos de traza (RequestCreated, OfferAccepted, DealCreated, etc.)
      ↓
Servicio calcula "factor de ajuste" basado en historial del agente
      ↓
Se propone un nuevo AgentMandate con límites ajustados
      ↓
Humano revisa la propuesta + justificación basada en traza
      ↓
Humano aprueba o rechaza (gobernanza explícita)
      ↓
Si se aprueba: se actualiza el AgentMandate y se emite evento AgentMandateUpdated
```

### Factores de ajuste proponibles (desde eventos existentes)

| Métrica de traza | Cómo afecta al mandato |
|------------------|------------------------|
| `deals_creados` (exitosos en PENDING_ESCROW) | ↑ `gasto_max_por_operacion` si hay muchos deals cerrados sin disputa |
| `tasa_respuesta` (ofertas → aceptación) | ↑ `rango_precio_aceptable_max` si el agente responde rápido y acierta |
| `tasa_cancelacion` | ↓ `gasto_max_por_operacion` si cancela muchas solicitudes |
| `conversion_request_a_deal` | Factor general de confianza para todos los límites |

### Reglas de gobernanza (innegociables)

1. **Nunca autónomo:** El servicio solo **propone**, nunca aplica cambios solos.
2. **Aprobación humana explícita:** Un humano debe firmar cada cambio de mandato.
3. **Justificación obligatoria:** Cada propuesta debe citar los eventos de traza que la justifican.
4. **Límites de seguridad:** Los ajustes no pueden exceder un multiplicador máximo (ej. 2x) sobre los límites originales.
5. **Evento de auditoría:** Cada cambio emite `AgentMandateUpdated` con payload completo (antes/después, actor, justificación, eventos de traza citados).

---

## Modelo de datos propuesto (fase futura)

```sql
-- Propuesta de mandato ajustado (pendiente de aprobación humana)
CREATE TABLE agent_mandate_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id TEXT NOT NULL,
  mandato_actual JSONB NOT NULL,      -- snapshot del mandato antes del cambio
  mandato_propuesto JSONB NOT NULL,   -- nuevo mandato propuesto
  justificacion TEXT NOT NULL,        -- por qué se propone el cambio
  eventos_traza_citados TEXT[],       -- ids de eventos que justifican el cambio
  estado TEXT NOT NULL DEFAULT 'PENDING'  -- PENDING | APROBADO | RECHAZADO
);
propuesto_por TEXT NOT NULL,          -- humano que propone
aprobado_por TEXT,                    -- humano que aprueba
aprobado_en TIMESTAMPTZ,
creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historial de cambios de mandato (auditoría)
CREATE TABLE agent_mandate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id TEXT NOT NULL,
  campo TEXT NOT NULL,                -- ej. 'gasto_max_por_operacion'
  valor_anterior TEXT,
  valor_nuevo TEXT,
  justificacion TEXT NOT NULL,
  eventos_traza_citados TEXT[],
  aprobado_por TEXT NOT NULL,
  cambiado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Servicio base (prototipo)

Ver `src/services/mandate-governance.service.ts`. Incluye:

1. `calcularFactorAjuste(agente_id)` — calcula un factor multiplicador basado en traza
2. `proponerAjusteMandato(agente_id, justificacion)` — genera una propuesta de mandato
3. `aprobarAjusteMandato(proposalId, aprobado_por)` — aplica el cambio (gobernanza)

Los multiplicadores son conservadores (máximo 1.5x sobre límites originales) para no exponer fondos sin control.

---

## Próximos pasos (no implementar en esta fase)

1. Crear las tablas `agent_mandate_proposals` y `agent_mandate_history` en el DDL (otro proyecto/rama).
2. Conectar el servicio de gobernanza al endpoint de propuesta/aprobación.
3. Cuando llegue el escrow (Capa 2), los eventos `DELIVERED`/`SETTLED`/`DISPUTED` añaden señales más fuertes para el factor de ajuste.
4. Cuando llegue AgentMandate on-chain (Capa 3, REAPP o Eunomia), los límites ajustados se escriben en el contrato.
