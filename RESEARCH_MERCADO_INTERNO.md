# ReWallet Lab — Research de construcción: Mercado Interno (Fase 1)

**Versión:** 1.0  
**Fase:** Mercado interno (validación rápida)  
**Estado:** Listo para revisión humana antes de codear  
**Fuente de verdad:** Brief de contexto ReWallet v1.0 (Secciones 1-12)

---

## Estado del laboratorio

El workspace de LabAGENT está vacío (no hay código de la PoC Stellar en este
directorio). Las capacidades on-chain ya validadas (gas sponsorship,
sponsored reserves, fondeo USDC, transferencias P2P sin XLM, arquitectura
hexagonal) se dan por existentes y se integran por separado. Esta fase construye
el **mercado interno off-chain** como backend independiente, con puntos de
integración claros para el agente Stellar y el escrow en fases futuras.

---

## 9.1 Parser con reglas

### 9.1.1 Set mínimo de patrones

El parser es **reglas, no LLM** (decisión confirmada por el usuario). Se
implementa como una cadena de extractores sobre texto libre en español.

| Campo | Patrón sugerido | Ejemplo capturado |
|-------|----------------|-------------------|
| producto | `/(?i)(?:necesito|quiero|busco|requiero)\s+(.+?)(?:\s*,|\s*de\s|\s*a\s|\s*hasta|\s*para|\s*$)/` | "azúcar" |
| cantidad | `/(?i)(\d+(?:[.,]\d+)?)\s*(kg|unidades|lt|litros|packs?|cajas?|bolsas?)\b/i` | "10 kg" |
| precio_max | `/(?i)(?:hasta|\$max|máximo\s*\$?|menos\s*de\s*\$?)\s*\$?\s*(\d+(?:[.,]\d+)?)/i` | "$1500" o "hasta $1500/kg" |
| plazo_entrega | `/(?i)(?:para\s+el\s+)?(lunes|martes|miércoles|jueves|viernes|sábado|domingo|mañana|pasado|\d{1,2}\/\d{1,2})/i` | "viernes" |
| ubicación | `/(?i)(?:en|de|zona\s+)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+)/i` | "Belgrano" |

### 9.1.2 Contrato de salida del parser

```ts
type ParsedRequest = {
  producto: string | null;
  cantidad: number | null;
  unidad: string | null;
  precio_max: number | null;
  plazo_entrega: string | null;   // ISO string o null
  ubicacion: string | null;
  categoria: string | null;       // null en esta fase (se infiere o se deja vacío)
  tags: string[];                 // [] en esta fase
  perfil_solicitante: string | null; // null: se pide al usuario al confirmar
  raw: string;                    // texto original para auditoría
  missing: string[];              // campos obligatorios faltantes
};
```

Campos obligatorios para publicar: `producto`, `cantidad`, `unidad`.
Si faltan, el parser devuelve `missing` y el flujo pide aclaración al humano
**sin inventar valores**.

### 9.1.3 Frases de ejemplo que la PoC debe parsear bien

1. "necesito 10 kg de azúcar"
2. "quiero comprar 10 kg de azúcar, hasta $1500/kg, para el viernes"
3. "necesito 50 litros de diésel a menos de $900"
4. "busco 200 unidades de papel A4"
5. "requiero 5 cajas de leche entera, presupuesto máximo $4000"
6. "necesito azúcar, 10 kg, zona Belgrano"
7. "quiero 100 kg de harina 0000 para mañana"
8. "compra de 25 kg de arroz, precio máximo $1200, para el lunes"
9. "necesito 500 sobres de facturas"
10. "quiero 2 packs de agua mineral de 6 lt"
11. "busco 10 cajas de cerveza, hasta $8000, entrega jueves"
12. "necesito 15 kg de yerba mate"

### 9.1.4 Casos donde el parser debe fallar limpiamente

- Texto sin producto reconocible ("hola", "buenos días", "¿cómo estás?").
- Sin cantidad ni unidad ("necesito azúcar" sin cuánto).
- Texto ambiguo entre producto y cantidad ("necesito 10" sin unidad).
- Solicitudes de servicios no físicos o fuera de mandato ("necesito un crédito",
  "quiero vender mi auto").
- Duplicados idénticos en corto tiempo (posible spam: se marca, no se bloquea
  automáticamente).

**Acción ante fallo:** devolver error con mensaje en español pidiendo aclaración
al humano. Nunca publicar un Request con campos obligatorios inventados.

### 9.1.5 Flujo de confirmación previa a publicar

1. Usuario envía texto libre.
2. Parser produce `ParsedRequest`.
3. Si `missing` no vacío → responder al usuario listando qué falta y pedirlo.
4. Si completo → mostrar resumen de confirmación (ver 9.1.6).
5. Usuario confirma explícitamente → se crea Request en estado `OPEN` y se
   emite `RequestCreated`.

### 9.1.6 Resumen que ve el usuario antes de publicar

```
¿Publicar esta solicitud?

Producto: azúcar
Cantidad: 10 kg
Precio máximo: $1500/kg
Plazo de entrega: viernes
Ubicación: Belgrano
Tu perfil: comercio (sugerido)

[Confirmar y publicar] [Editar] [Cancelar]
```

---

## 9.2 Stack y persistencia

### 9.2.1 Stack recomendado (default)

| Capa | Elección | Motivo |
|------|----------|--------|
| Backend | Node.js + TypeScript (NestJS o Express ligero) | Velocidad, ecosistema TS, fácil integración con SDK Stellar existente (JS/TS) |
| Base de datos | PostgreSQL | Transacciones ACID para cierres de Deal (requisito 9.5), JSONB para events.payload |
| ORM / queries | Prisma o raw `pg` | Prisma acelera DDL/migrations; raw `pg` si se quiere mínimamente depender |
| API | REST + JSON | Checklist de endpoints de la Sec. 8 |
| Tests | Jest + supertest | Rápido, maduro en TS |

**Default propuesto:** Node/TS + Postgres + Prisma + Jest. Se justifica por
velocidad de validación y compatibilidad con el SDK Stellar (JS/TS) de la PoC.

### 9.2.2 Esquema SQL (DDL)

```sql
-- 5.1 Request
CREATE TABLE requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitante_id  TEXT NOT NULL,
  agente_id       TEXT NOT NULL,
  producto        TEXT NOT NULL,
  cantidad        NUMERIC NOT NULL,
  unidad          TEXT NOT NULL,
  precio_max      NUMERIC,
  plazo_entrega   TIMESTAMPTZ,
  ubicacion       TEXT,
  categoria       TEXT,
  tags            TEXT[] DEFAULT '{}',
  perfil_solicitante TEXT CHECK (perfil_solicitante IN
    ('emprendedor','comercio','pyme','empresa')),
  estado          TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (estado IN ('OPEN','NEGOTIATING','CLOSED','EXPIRED','CANCELLED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);

-- 5.2 Offer
CREATE TABLE offers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  oferente_id             TEXT NOT NULL,
  agente_oferente_id      TEXT,
  precio                  NUMERIC NOT NULL,
  cantidad                NUMERIC NOT NULL,
  condiciones_entrega     TEXT NOT NULL DEFAULT '',
  estado                  TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (estado IN ('PENDING','ACCEPTED','REJECTED','WITHDRAWN')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5.3 Message (inmutable: ver 9.2.3)
CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  autor_id    TEXT NOT NULL,
  autor_tipo  TEXT NOT NULL CHECK (autor_tipo IN ('HUMAN','AGENT')),
  tipo        TEXT NOT NULL CHECK (tipo IN
    ('TEXT','OFFER','COUNTER_OFFER','ACCEPT','REJECT')),
  contenido   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5.4 Deal
CREATE TABLE deals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  offer_id            UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  precio_final        NUMERIC NOT NULL,
  condiciones_finales TEXT NOT NULL DEFAULT '',
  estado              TEXT NOT NULL DEFAULT 'PENDING_ESCROW'
    CHECK (estado IN ('PENDING_ESCROW','IN_ESCROW','DELIVERED','SETTLED','DISPUTED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5.5 Event
CREATE TABLE events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  actor_tipo TEXT NOT NULL CHECK (actor_tipo IN ('HUMAN','AGENT','SYSTEM')),
  request_id UUID REFERENCES requests(id),
  offer_id   UUID REFERENCES offers(id),
  deal_id    UUID REFERENCES deals(id),
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5.6 AgentMandate (parte del perfil del negocio)
CREATE TABLE agent_mandates (
  agente_id                TEXT PRIMARY KEY,
  negocio_id               TEXT NOT NULL,
  gasto_max_por_operacion  NUMERIC NOT NULL,
  gasto_max_acumulado      NUMERIC NOT NULL,
  gasto_ventana_tiempo     INTERVAL NOT NULL,
  rango_precio_aceptable_min NUMERIC,
  rango_precio_aceptable_max NUMERIC,
  plazo_max_entrega        INTERVAL,
  whitelist_contrapartes   TEXT[] DEFAULT '{}'
);

-- Índices
CREATE INDEX idx_requests_estado      ON requests(estado);
CREATE INDEX idx_requests_categoria   ON requests(categoria);
CREATE INDEX idx_requests_solicitante ON requests(solicitante_id);
CREATE INDEX idx_requests_agente      ON requests(agente_id);
CREATE INDEX idx_requests_expires_at  ON requests(expires_at);
CREATE INDEX idx_offers_request       ON offers(request_id);
CREATE INDEX idx_offers_estado        ON offers(estado);
CREATE INDEX idx_messages_request     ON messages(request_id, created_at);
CREATE INDEX idx_deals_request        ON deals(request_id);
CREATE INDEX idx_events_type          ON events(type);
CREATE INDEX idx_events_request       ON events(request_id);
CREATE INDEX idx_events_timestamp     ON events(timestamp DESC);
```

### 9.2.4 Garantía de inmutabilidad de Message

**Capa de base de datos (recomendado):** trigger `BEFORE UPDATE` en `messages`
que impida cualquier modificación tras el `INSERT`:

```sql
CREATE OR REPLACE FUNCTION messages_immutable()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM messages WHERE id = NEW.id AND
             (NEW.contenido IS DISTINCT FROM OLD.contenido
              OR NEW.tipo IS DISTINCT FROM OLD.tipo
              OR NEW.autor_id IS DISTINCT FROM OLD.autor_id)) THEN
    RAISE EXCEPTION 'Message es inmutable: id=%', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_immutable
BEFORE UPDATE ON messages
FOR EACH ROW EXECUTE FUNCTION messages_immutable();
```

**Capa de aplicación:** el servicio de mensajes solo expone `create`; no hay
endpoint `PUT /messages`. Responder o referenciar se modela como un nuevo
`Message` con `tipo` distinto, nunca como edición.

---

## 9.3 Eventos y trazabilidad off-chain

### 9.3.1 Diseño de la tabla events

Ver DDL en 9.2.2. Cada fila captura:
- `type`: nombre estándar del evento (ver I7).
- `actor_id` / `actor_tipo`: quién ejecutó la transición.
- `request_id` / `offer_id` / `deal_id`: referencia al objeto afectado (uno o más).
- `payload`: snapshot completo del estado resultante (JSONB), para reconstruir
  la traza sin depender del estado actual de las tablas.
- `timestamp`: momento de la transición.

### 9.3.2 Patrón: transición = write state + emit event

**Regla:** no existe una transición de estado de Request, Offer o Deal sin su
evento correspondiente. Implementación:

1. Todo cambio de estado pasa por un **servicio de transacciones** (unit of work).
2. Dentro de una sola transacción de BD:
   a. Se escribe el nuevo estado de la entidad.
   b. Se inserta la fila en `events` con `type`, actor, referencia y `payload`.
3. Si cualquiera de los dos falla, se hace rollback de todo.

Esto garantiza atomicidad: nunca hay estado sin evento, ni evento sin estado.

### 9.3.3 Mapeo evento → transición (Sec. 6)

| Evento | Entidad | Transición | Actor |
|--------|---------|------------|-------|
| RequestCreated | Request | creada (OPEN) | AGENT |
| OfferSubmitted | Offer | PENDING | HUMAN / AGENT |
| OfferAccepted | Offer | PENDING → ACCEPTED | HUMAN |
| DealCreated | Deal | creada (PENDING_ESCROW) | SYSTEM (agente prepara) |
| RequestClosed | Request | NEGOTIATING → CLOSED | SYSTEM |
| OfferRejected | Offer | PENDING → REJECTED | SYSTEM (al cerrar deal) |
| MessageSent | Message | insert | HUMAN / AGENT |
| RequestCancelled | Request | OPEN → CANCELLED | HUMAN |
| RequestExpired | Request | OPEN → EXPIRED | SYSTEM (job/cron) |

---

## 9.4 Agente del solicitante (comportamiento)

### 9.4.1 Modelo de AgentMandate en código

```ts
type AgentMandate = {
  agente_id: string;
  negocio_id: string;
  gasto_max_por_operacion: number;
  gasto_max_acumulado: number;
  gasto_ventana_tiempo: Interval;      // ej. 30 días
  rango_precio_aceptable?: { min: number; max: number } | null;
  plazo_max_entrega?: Interval | null;
  whitelist_contrapartes?: string[] | null;
};
```

Validaciones del agente (off-chain, fase 1):
- **Por operación:** `oferta.precio * oferta.cantidad <= mandato.gasto_max_por_operacion`.
- **Acumulado:** suma de ofertas aceptadas en `gasto_ventana_tiempo` <= `gasto_max_acumulado`.
- **Rango de precio:** si `rango_precio_aceptable` está definido, el precio unitario
  de la oferta debe estar dentro de `[min, max]`.
- **Plazo:** si `plazo_max_entrega` está definido, `oferta.entrega <= plazo_max`.
- **Whitelist:** si está definida, `oferente_id` debe estar en la lista.

### 9.4.2 Filtrado de ofertas

Al listar ofertas de su solicitud, el agente del solicitante:
1. Descarta ofertas `WITHDRAWN` o `REJECTED`.
2. Aplica cada regla del mandato.
3. Clasifica cada oferta pendiente como:
   - `DENTRO_MANDATO`: se muestra al usuario en el resumen.
   - `FUERA_MANDATO`: se marca como no recomendada (se puede ver, pero el agente
     advierte que excede el mandato; requiere aprobación explícita del humano).

### 9.4.3 Resumen al usuario

Para cada oferta relevante, el agente presenta:
- Oferente, precio unitario, cantidad, total.
- Condiciones de entrega.
- ¿Está dentro del mandato? (sí/no + razón si no).
- Tiempo transcurrido desde la oferta.
- Botón: "Aceptar esta oferta" / "Descartar".

### 9.4.4 Cuándo escala al humano (regla concreta)

El agente escala (no decide solo) cuando se cumple **alguna** de:
- Precio unitario fuera de `rango_precio_aceptable`.
- Oferente no está en `whitelist_contrapartes` (si está definida).
- Plazo de entrega ofrecido > `plazo_max_entrega`.
- Total de la operación > `gasto_max_por_operacion`.

En esos casos, el agente informa al humano con la oferta y las razones, y
espera la decisión humana antes de aceptar.

---

## 9.5 Cierre del Deal (transaccional)

**Regla:** todo en **una sola transacción de BD**. Confirmado.

Secuencia al aceptar una Offer (`POST /requests/:id/offers/:offerId/accept`):

1. Verificar que la Offer esté `PENDING` y que la Request esté `OPEN` o `NEGOTIATING`.
2. Marcar la Offer aceptada = `ACCEPTED`.
3. Crear Deal vinculado:
   - `request_id`, `offer_id`, `precio_final = offer.precio`,
     `condiciones_finales = offer.condiciones_entrega`,
     `estado = PENDING_ESCROW`.
4. Marcar Request = `CLOSED`.
5. Todas las demás Offer `PENDING` de esa Request → `REJECTED`.
6. Emitir eventos (todos dentro de la misma transacción):
   - `OfferAccepted` (actor = usuario que acepta)
   - `DealCreated` (actor = SYSTEM/agente)
   - `RequestClosed` (actor = SYSTEM)
   - `OfferRejected` × n (actor = SYSTEM)
7. Commit.

Si falla cualquier paso → rollback completo. No hay estado parcial.

Regla de unicidad: SOLO una Offer por Request puede pasar a `ACCEPTED`. La
restricción se aplica en la transacción (verificar que no exista otra
`ACCEPTED` para ese `request_id` antes de marcar).

---

## 9.6 Decisiones abiertas (defaults propuestos)

| Decisión | Default propuesto | ¿Confirmar? |
|----------|-------------------|-------------|
| Visibilidad del tablero | BROADCAST TOTAL (todas las requests OPEN visibles a todos) | Sí |
| Autonomía del agente | Contraoferta dentro del mandato; escala al humano fuera de él | Sí |
| Cierre del deal | Aprobación explícita del humano SIEMPRE | Sí |
| Identidad del agente | Un agente por negocio (agente_id propio, distinto del humano) | Sí |
| Persistencia de la sala | Mensajes inmutables e indefinidos; archivar es solo flag de lectura | Sí |
| Parser | REGLAS (confirmado por el usuario en el brief) | Ya confirmado |
| Stack | Node/TS + Postgres + Prisma + Jest | Sí |
| Eventos | Tabla events off-chain, transición = write + emit en una transacción | Sí |

---

## 9.7 Vertical slice mínimo (E2E de una sola pasada)

**Caso de validación:**

1. Usuario A: "necesito 10 kg de azúcar, hasta $1500/kg, para el viernes"
2. Parser → Request → confirmación → publicada (OPEN) + `RequestCreated`
3. Usuario B (o su agente) entra, envía Offer (precio 1400, 10 kg,
   condiciones "entrega en puerta") → Request pasa a `NEGOTIATING` +
   `OfferSubmitted`
4. Agente A filtra (dentro de mandato: sí) y resume al usuario A
5. Usuario A acepta → Deal en `PENDING_ESCROW`, Request `CLOSED`,
   demás Offers `REJECTED`, eventos emitidos (`OfferAccepted`, `DealCreated`,
   `RequestClosed`, `OfferRejected`)

**Qué se puede recortar sin perder la validación:**
- Perfil de solicitante (puede defaultar a "comercio").
- Categoría y tags (se crean vacías, se usan en fases futuras).
- Ubicación (opcional, nullable).
- Plazo de entrega (opcional, nullable).
- Whitelist de contrapartes (opcional, nullable).
- UI rica: puede validarse con curl/Postman contra los endpoints REST.
- Expiración automática de requests (job/cron): se puede simular manualmente en
  esta fase.

---

## 9.8 Herramientas del ecosistema Stellar (encaje progresivo)

Tu amigo compartió un set de herramientas relevantes. La recomendación para esta fase es **no adoptar ninguna todavía**:

> Para la fase actual (mercado interno, sin escrow): no adoptes ninguna de estas herramientas todavía. Tu mercado de Request/Offer/Message/Deal es off-chain y específico. Meter una herramienta on-chain ahora te agrega complejidad sin validar el concepto.

| Herramienta | Qué es | Capa donde encaja | Decisión para esta fase |
|-------------|--------|-------------------|-------------------------|
| **Mycelium** | Framework Python para contratos Soroban y orquestación agéntica (SDK on-chain, firma, escrow/x402, adaptadores IA). | Capa 1 (agente) y Capa 2 (escrow) | **No usar aún.** Punto de entrada natural cuando llegue la Capa 2 (escrow) si querés un solo framework que cubra agente + contrato. |
| **REAPP** | Protocolo de "mandatos criptográficos": el agente firma una intención con alcance restringido (monto, destinatario, tiempo), validado off-chain y liquidado atómicamente en Soroban. | Capa 3 (AgentMandate) | **No usar aún.** Muy alineado conceptualmente con tu AgentMandate. Candidato para Capa 3 si querés mandato firmado una vez + validación off-chain + liquidación on-chain. |
| **Eunomia (ex-PRISM)** | Tesorería no custodial en Soroban donde el contrato hace cumplir la política (límites por pago/diarios, lista blanca, sesiones con gasto acotado, escrow con plazo). | Capa 3 (política) | **No usar aún.** Candidato para Capa 3 si querés que el contrato directamente rechace operaciones fuera de política (más "duro", no depende de gateway externo). |
| **Stellar CLI for Agents** | CLI oficial con primitivas para agentes (token approve, tx new payment --build-only, AGENTS.md). | Capa 1 y Capa 2 | **No usar aún.** Útil cuando el agente prepare transacciones que el humano firma (alineado con "el agente no toca fondos"). |
| **Cogladius** | SDK TypeScript para agentes que encuentran tareas con recompensa bloqueada en escrow Soroban. | Capa 2 (escrow) | **No usar aún.** Patrón de escrow reutilizable, pero pensado para "tareas con recompensa", no para RFQ/negociación. Contrato upstream no auditado (canales limitados a 5 XLM). |
| **Nirium** | SDK para tesorería autónoma en Stellar/Soroban (rebalanceo USDC ↔ CETES, pagos x402, señales de mercado 24/7). | Capa 5 (futuro) | **No usar aún.** Menos prioritario; solo si el agente gestiona tesorería del negocio más adelante. |

**Hoja de ruta de adopción (progresiva):**

1. **Fase 1 (ahora):** Mercado interno off-chain puro. Node/TS + Postgres. Ninguna herramienta on-chain.
2. **Capa 2 (escrow):** Cuando el Deal deje de detenerse en PENDING_ESCROW y pase a liberación condicional on-chain. Evaluar Mycelium (único framework agente+contrato) o Cogladius (patrón TS, con advertencia de madurez).
3. **Capa 3 (AgentMandate on-chain):** Cuando los límites del agente deban aplicarse on-chain sin confiar en que "el agente se porte bien". Evaluar REAPP (mandato firmado con alcance) o Eunomia (contrato rechaza directamente fuera de política).
4. **Capa 5 (tesorería/externos):** Nirium y canales ChatGPT/ACP solo en visión de futuro.

Todas estas herramientas están en testnet o fase SCF (Stellar Community Fund): trátalas como primitivas experimentales para el lab, no como infraestructura de producción.

---

## Enfoque progresivo hacia pruebas tangibles

El lab avanza por capas, pero cada capa debe dejar una **prueba tangible** antes de pasar a la siguiente:

| Capa | Prueba tangible de esta fase | Entregable |
|------|------------------------------|------------|
| Capa 1: mercado | Dos usuarios (o sus agentes) negocian y cierran un Deal en PENDING_ESCROW off-chain, con eventos emitidos. | Endpoints funcionando + caso E2E verde (Sección 9.7). |
| Capa 2: escrow | El Deal PENDING_ESCROW se liquida condicionalmente en Soroban (Mycelium o similar). | Contrato de escrow integrado. |
| Capa 3: política | El AgentMandate se aplica on-chain (REAPP o Eunomia) y rechaza operaciones fuera de límites. | Contrato de política activo. |
| Capa 4: trazabilidad | Los eventos off-chain se reflejan on-chain o son verificables desde el contrato. | Trazabilidad cruzada. |
| Capa 5: canales externos | El agente recibe órdenes vía ChatGPT/ACP y opera en el mercado. | Integración externa. |

**Regla de oro:** no se avanza a la siguiente capa hasta que la prueba tangible de la actual esté verde. Esto evita reescribir y cumple el objetivo de velocidad de validación sin sacrificar las invariantes (I1-I10).

---

# Plan de construcción — Vertical slice mínimo

| # | Tarea | Descripción | Estimación relativa |
|---|-------|-------------|---------------------|
| 1 | Setup del proyecto | Inicializar Node/TS, Postgres (local o Docker), Prisma schema con las 6 tablas, índices, trigger de inmutabilidad de Message | 1 día |
| 2 | Modelo de datos y migraciones | DDL de requests, offers, messages, deals, events, agent_mandates | 0.5 día |
| 3 | Parser con reglas | Implementar extractores regex, contrato de salida `ParsedRequest`, casos de fallo limpio, 12 frases de prueba | 1 día |
| 4 | Endpoint POST /requests | Crear request desde texto libre o estructura, validación, confirmación previa, emisión `RequestCreated` | 1 día |
| 5 | Endpoint GET /requests y GET /requests/:id | Listar tablero con filtros (estado, categoría); ver solicitud + sala (messages + offers) | 1 día |
| 6 | Endpoint POST /requests/:id/messages | Enviar mensaje u oferta (OFFER, COUNTER_OFFER, TEXT); inmutabilidad | 0.5 día |
| 7 | Lógica del agente del solicitante | Filtrado por AgentMandate, resumen al usuario, escalada al humano | 1 día |
| 8 | Endpoint POST /requests/:id/offers/:offerId/accept | Cierre transaccional: Offer ACCEPTED, Deal PENDING_ESCROW, Request CLOSED, otras REJECTED, eventos | 1 día |
| 9 | Endpoint POST /requests/:id/cancel | Cancelar solicitud, emisión `RequestCancelled` | 0.5 día |
| 10 | Servicio de eventos | Centralizar emisión de eventos en cada transición (unidad de trabajo) | 0.5 día |
| 11 | Tests del slice | Pruebas de integración del caso E2E completo (9.7) | 1 día |
| 12 | Documentación de endpoints | README o OpenAPI del mercado interno | 0.5 día |

**Total estimado:** ~9 días (relativo, ajuste según disponibilidad).

Orden de ejecución: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12.
No se toca escrow on-chain, trazabilidad on-chain, reputación, ni canales
externos (fuera de alcance esta fase).

---

# Decisiones a confirmar (antes de codear)

1. **Stack:** ¿Aceptan Node/TS + Postgres + Prisma + Jest como default?
   - Default propuesto: **Sí**.
2. **Visibilidad del tablero:** ¿Broadcast total (todas las requests OPEN visibles a todos)?
   - Default propuesto: **Sí**.
3. **Autonomía del agente:** ¿Contraoferta dentro del mandato, escala al humano fuera de él?
   - Default propuesto: **Sí**.
4. **Cierre del deal:** ¿Aprobación explícita del humano SIEMPRE (agente no cierra solo)?
   - Default propuesto: **Sí**.
5. **Identidad del agente:** ¿Un agente por negocio, agente_id distinto del humano?
   - Default propuesto: **Sí**.
6. **Inmutabilidad de Message:** ¿Trigger de BD + solo endpoint POST (sin PUT)?
   - Default propuesto: **Sí**.
7. **Transacción de cierre del Deal:** ¿Todo en una sola transacción de BD?
   - Default propuesto: **Sí**.
8. **Parser:** ¿Reglas (no LLM) en esta fase? (ya confirmado en el brief)
   - Default: **Sí** (ya decidido).

**No empezar a codear hasta recibir aprobación explícita de este plan.** Una
vez aprobado, se implementa el vertical slice mínimo y se valida con el caso
E2E de la Sección 9.7.
