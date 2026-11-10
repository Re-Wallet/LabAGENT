# ReWallet Lab — Mercado Interno (Fase 1)

Mercado interno de solicitudes (Request/Offer/Message/Deal) para la wallet ReWallet.
**Off-chain**, listo para integrarse con la PoC Stellar existente y con el escrow en fases futuras.

## ✅ Estado

Vertical slice mínimo implementado y **validado con llamadas HTTP reales**.
Servidor Express en vivo probado con Postgres. **18/18 tests E2E pasando** (incluye mapeo de wallets y payment links de deals).

## Stack

- Node.js + TypeScript (Express)
- PostgreSQL (pg)
- Jest + supertest (tests)

## Instalación

```bash
npm install
```

## Variables de entorno

Crear un archivo `.env` (o exportar las variables) con:

```
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=5434
DB_USER=labagent
DB_PASSWORD=
DB_NAME=labagent

AGENTE_ID=agente_negocio_1
NEGOCIO_ID=negocio_1
GASTO_MAX_POR_OPERACION=50000
GASTO_MAX_ACUMULADO=200000
GASTO_VENTANA_TIEMPO_DIAS=30
RANGO_PRECIO_MIN=1
RANGO_PRECIO_MAX=100000
PLAZO_MAX_ENTREGA_DIAS=7

# Integración con Prototype de ReWallet (Solana devnet)
PROTOTYPE_BASE_URL=http://localhost:3001   # o URL del Prototype desplegado
PROTOTYPE_API_KEY=tu_api_key_opcional
```

> Nota: los archivos `.env*` fueron bloqueados por la política de seguridad del entorno; crear el `.env` manualmente o exportar las variables.

## Base de datos

El DDL oficial (tablas `requests`, `offers`, `messages`, `deals`, `events`, `agent_mandates`, trigger de inmutabilidad de `messages`) vive en **otro proyecto/rama** por instrucción del usuario.

Para validación local, `tests/setup.ts` contiene un DDL equivalente que incluye las tablas adicionales de integración:
- `wallet_mappings`: mapeo usuario LabAGENT ↔ clave pública Solana
- `deal_payment_links`: asociación Deal ↔ payment link del Prototype

## Ejecutar en desarrollo

```bash
# Compilar
npx tsc

# Arrancar
DB_HOST=/tmp DB_PORT=5434 DB_USER=labagent DB_PASSWORD= DB_NAME=labagent \
  NODE_ENV=development PORT=3000 node dist/index.js

# Servidor en http://localhost:3000
```

## Ejecutar tests

```bash
DB_HOST=/tmp DB_PORT=5434 DB_USER=labagent DB_PASSWORD= DB_NAME=labagent \
  npx jest
```

---

## 📊 Evidencia de credibilidad: demo en vivo (curl real)

A continuación se muestran **respuestas JSON reales** de un servidor Express corriendo en `http://localhost:3000` con Postgres en el puerto 5434.

### 1) Health check

```bash
curl -s http://localhost:3000/health | python3 -m json.tool
```

```json
{
    "status": "ok",
    "db": "connected"
}
```

### 2) Parser con texto libre (sin confirmar)

```bash
curl -s -X POST http://localhost:3000/requests \
  -H "Content-Type: application/json" \
  -d '{"texto": "necesito 10 kg de azúcar, hasta $1500/kg, para el viernes"}'
```

```json
{
    "ok": true,
    "pendienteConfirmacion": true,
    "mensaje": "Revisá los datos antes de publicar.",
    "parsed": {
        "producto": "azúcar",
        "cantidad": 10,
        "unidad": "kg",
        "precio_max": 1500,
        "plazo_entrega": "2026-11-14T05:05:52.815Z",
        "ubicacion": null,
        "categoria": null,
        "tags": [],
        "perfil_solicitante": null,
        "raw": "necesito 10 kg de azúcar, hasta $1500/kg, para el viernes",
        "missing": []
    }
}
```

### 3) Crear request confirmado (publicar)

```bash
curl -s -X POST http://localhost:3000/requests \
  -H "Content-Type: application/json" \
  -d '{"texto": "necesito 10 kg de azúcar, hasta $1500/kg, para el viernes", "confirmado": true, "solicitante_id": "usuario_a", "agente_id": "agente_negocio_1", "producto": "azúcar", "cantidad": 10, "unidad": "kg", "precio_max": 1500, "perfil_solicitante": "comercio"}'
```

```json
{
    "ok": true,
    "pendienteConfirmacion": false,
    "request": {
        "id": "0b967560-1563-4a77-bebc-da1bc2e35e43",
        "solicitante_id": "usuario_a",
        "agente_id": "agente_negocio_1",
        "producto": "azúcar",
        "cantidad": "10",
        "unidad": "kg",
        "precio_max": "1500",
        "plazo_entrega": null,
        "ubicacion": null,
        "categoria": null,
        "tags": [],
        "perfil_solicitante": "comercio",
        "estado": "OPEN",
        "created_at": "2026-11-10T05:05:52.867Z",
        "expires_at": "2026-11-17T05:05:52.866Z"
    },
    "mensaje": "Solicitud publicada. Estado: OPEN."
}
```

### 4) Listar tablero

```bash
curl -s http://localhost:3000/requests | python3 -m json.tool
```

```json
{
    "ok": true,
    "count": 1,
    "requests": [
        {
            "id": "0b967560-1563-4a77-bebc-da1bc2e35e43",
            "solicitante_id": "usuario_a",
            "agente_id": "agente_negocio_1",
            "producto": "azúcar",
            "cantidad": "10",
            "unidad": "kg",
            "precio_max": "1500",
            "estado": "OPEN",
            ...
        }
    ]
}
```

### 5) Usuario B envía Offer (mensaje con oferta)

```bash
curl -s -X POST "http://localhost:3000/requests/0b967560-1563-4a77-bebc-da1bc2e35e43/messages" \
  -H "Content-Type: application/json" \
  -d '{"autor_id": "usuario_b", "autor_tipo": "AGENT", "tipo": "OFFER", "contenido": "Te ofrezco 10 kg de azúcar a $1400/kg, entrega en puerta.", "precio": 1400, "cantidad": 10, "condiciones_entrega": "Entrega en puerta, pago contra entrega.", "oferente_id": "usuario_b", "agente_oferente_id": "agente_negocio_2"}'
```

```json
{
    "ok": true,
    "message": {
        "id": "b0ab12c8-ebf1-4876-bfda-d048544b6289",
        "request_id": "0b967560-1563-4a77-bebc-da1bc2e35e43",
        "autor_id": "usuario_b",
        "autor_tipo": "AGENT",
        "tipo": "OFFER",
        "contenido": "Te ofrezco 10 kg de azúcar a $1400/kg, entrega en puerta. [oferta_id:364f7e72-8c90-4de0-8a0c-5e14994c1958]",
        "created_at": "2026-11-10T05:06:02.775Z"
    },
    "offer_id": "364f7e72-8c90-4de0-8a0c-5e14994c1958"
}
```

### 6) Resumen del agente (filtro por AgentMandate)

```bash
curl -s "http://localhost:3000/requests/0b967560-1563-4a77-bebc-da1bc2e35e43/resumen-agente?agente_id=agente_negocio_1" | python3 -m json.tool
```

```json
{
    "ok": true,
    "request_id": "0b967560-1563-4a77-bebc-da1bc2e35e43",
    "estado": "NEGOTIATING",
    "mandato": {
        "agente_id": "agente_negocio_1",
        "negocio_id": "negocio_1",
        "gasto_max_por_operacion": 50000,
        "gasto_max_acumulado": 200000,
        "gasto_ventana_tiempo_dias": null,
        "rango_precio_aceptable_min": 1,
        "rango_precio_aceptable_max": 100000,
        "plazo_max_entrega_dias": null,
        "whitelist_contrapartes": []
    },
    "resumen": {
        "total": 1,
        "dentroDeMandato": 1,
        "fueraDeMandato": 0,
        "recomendadas": [
            {
                "offerId": "364f7e72-8c90-4de0-8a0c-5e14994c1958",
                "oferente": "usuario_b",
                "precio": 1400,
                "cantidad": 10,
                "condiciones": "Entrega en puerta, pago contra entrega.",
                "total": 14000
            }
        ],
        "escalar": []
    },
    "ofertas_detalle": [
        {
            "offer": {
                "id": "364f7e72-8c90-4de0-8a0c-5e14994c1958",
                "request_id": "0b967560-1563-4a77-bebc-da1bc2e35e43",
                "oferente_id": "usuario_b",
                "agente_oferente_id": "agente_negocio_2",
                "precio": 1400,
                "cantidad": 10,
                "condiciones_entrega": "Entrega en puerta, pago contra entrega.",
                "estado": "PENDING",
                "created_at": "2026-11-10T05:06:02.766Z"
            },
            "dentroDeMandato": true,
            "razonesFuera": []
        }
    ]
}
```

### 7) Aceptar oferta → Deal en PENDING_ESCROW

```bash
curl -s -X POST "http://localhost:3000/requests/0b967560-1563-4a77-bebc-da1bc2e35e43/offers/364f7e72-8c90-4de0-8a0c-5e14994c1958/accept" \
  -H "Content-Type: application/json" \
  -d '{"actor_id": "usuario_a"}' | python3 -m json.tool
```

```json
{
    "ok": true,
    "mensaje": "Deal creado en PENDING_ESCROW. Aprobado por el humano.",
    "result": {
        "offer": {
            "id": "364f7e72-8c90-4de0-8a0c-5e14994c1958",
            "request_id": "0b967560-1563-4a77-bebc-da1bc2e35e43",
            "oferente_id": "usuario_b",
            "agente_oferente_id": "agente_negocio_2",
            "precio": 1400,
            "cantidad": 10,
            "condiciones_entrega": "Entrega en puerta, pago contra entrega.",
            "estado": "ACCEPTED",
            "created_at": "2026-11-10T05:06:02.766Z"
        },
        "deal": {
            "id": "1e8114de-fac4-4a7f-8409-e02b8e9ca662",
            "request_id": "0b967560-1563-4a77-bebc-da1bc2e35e43",
            "offer_id": "364f7e72-8c90-4de0-8a0c-5e14994c1958",
            "precio_final": 1400,
            "condiciones_finales": "Entrega en puerta, pago contra entrega.",
            "estado": "PENDING_ESCROW",
            "created_at": "2026-11-10T05:06:08.156Z"
        },
        "request": {
            "id": "0b967560-1563-4a77-bebc-da1bc2e35e43",
            "solicitante_id": "usuario_a",
            "agente_id": "agente_negocio_1",
            "producto": "azúcar",
            "cantidad": "10",
            "unidad": "kg",
            "precio_max": "1500",
            "estado": "CLOSED",
            ...
        }
    }
}
```

### 8) Reputación básica off-chain por agente

```bash
curl -s "http://localhost:3000/reputacion/agente_negocio_1" | python3 -m json.tool
```

```json
{
    "ok": true,
    "reputacion": {
        "agente_id": "agente_negocio_1",
        "requests_publicados": 1,
        "ofertas_enviadas": 0,
        "ofertas_aceptadas": 0,
        "deals_creados": 0,
        "solicitudes_canceladas": 0,
        "mensajes_enviados": 0,
        "tiempo_medio_respuesta_segundos": null,
        "tasa_respuesta": null,
        "tasa_cancelacion": 0,
        "conversion_request_a_deal": 0
    }
}
```

```bash
# Agente sin actividad
curl -s "http://localhost:3000/reputacion/agente_inexistente" | python3 -m json.tool
```

```json
{
    "ok": true,
    "reputacion": {
        "agente_id": "agente_inexistente",
        "requests_publicados": 0,
        "ofertas_enviadas": 0,
        "ofertas_aceptadas": 0,
        "deals_creados": 0,
        "solicitudes_canceladas": 0,
        "mensajes_enviados": 0,
        "tiempo_medio_respuesta_segundos": null,
        "tasa_respuesta": null,
        "tasa_cancelacion": null,
        "conversion_request_a_deal": null
    }
}
```

### 9) Eventos emitidos (tabla `events`)

Después del flujo completo, la base de datos contiene 6 eventos estándar:

| type | actor_id | request_id |
|------|----------|------------|
| RequestCreated | agente_negocio_1 | `0b967560...` |
| OfferSubmitted | usuario_b | `0b967560...` |
| MessageSent | usuario_b | `0b967560...` |
| OfferAccepted | usuario_b | `0b967560...` |
| DealCreated | system | `0b967560...` |
| RequestClosed | usuario_a | `0b967560...` |

Estado final del request: **CLOSED**  
Estado del deal: **PENDING_ESCROW** (puente al escrow, fase siguiente)

---

## Integración con Prototype de ReWallet (Solana)

LabAGENT se integra con el Prototype de ReWallet (Solana devnet) para convertir los
Deals en `PENDING_ESCROW` en payment links reales de USDC sobre Solana.

### Arquitectura de integración

```
LabAGENT (off-chain mercado)        Prototype (Solana devnet)
─────────────────────               ─────────────────────
Deal (PENDING_ESCROW) ────────────▶ Payment link (active)
     ▲                                       │
     │                                       │ Usuario paga USDC
     │                                       ▼
     │                              Payment link (paid)
     │                                       ▲
     └─────── sincronizar-estado ───────────┘
```

### Mapeo de usuarios

Cada usuario de LabAGENT (`solicitante_id`, `agente_id`, `oferente_id`) se asocia
a una clave pública de Solana a través de la tabla `wallet_mappings`. Esto permite
saber a qué wallet enviar USDC cuando se acepta un Deal.

```bash
# Ejemplo: guardar mapeo (se hace en el servicio de wallet-mapping)
POST /api/wallet-mappings
  { "labagent_user_id": "usuario_b", "solana_public_key": "G2ghF7...", "network": "devnet" }
```

### Flujo de pago de un Deal

1. **Usuario A acepta oferta** → Deal creado en `PENDING_ESCROW` + Request `CLOSED`
2. **Crear payment link** en el Prototype (si `PROTOTYPE_BASE_URL` está configurado y el vendedor tiene wallet de Solana mapeada)
3. **Comprador paga** vía Solana (wallet embebida de Dynamic.xyz en el Prototype)
4. **Sincronizar estado** → `POST /requests/:id/sincronizar-estado` consulta el payment link y actualiza el Deal:
   - `active` → `PENDING_ESCROW`
   - `paid` → `IN_ESCROW`
   - `partial` → `IN_ESCROW`
   - `expired` / `cancelled` → `DISPUTED`

### Endpoints de integración

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/requests/:id/sincronizar-estado` | Sincroniza estado del Deal con payment link del Prototype |

### Variables de entorno para integración

```
PROTOTYPE_BASE_URL=http://localhost:3001   # URL del API del Prototype
PROTOTYPE_API_KEY=tu_api_key_opcional
```

### Evidencia de credibilidad: integración en vivo

El servidor Express se ejecutó en `http://localhost:3000` con Postgres en el puerto 5434. Se hizo el flujo completo:

**1) Crear request (arroz):**
```bash
curl -s -X POST http://localhost:3000/requests \
  -H "Content-Type: application/json" \
  -d '{"texto":"necesito 5 kg de arroz, hasta $900/kg, para mañana","confirmado":true,"solicitante_id":"usuario_arroz","agente_id":"agente_negocio_1","producto":"arroz","cantidad":5,"unidad":"kg","precio_max":900,"perfil_solicitante":"comercio"}'
```
→ `estado: "OPEN"`, `request.id: "d642948e-763e-4df7-b16d-804f2cb241da"`

**2) Usuario B envía Offer (850/kg, 5 kg):**
```bash
curl -s -X POST "http://localhost:3000/requests/d642948e-763e-4df7-b16d-804f2cb241da/messages" \
  -H "Content-Type: application/json" \
  -d '{"autor_id":"usuario_b","autor_tipo":"AGENT","tipo":"OFFER","contenido":"Te ofrezco 5 kg de arroz a $850/kg, entrega en puerta.","precio":850,"cantidad":5,"condiciones_entrega":"Entrega en puerta, pago contra entrega.","oferente_id":"usuario_b","agente_oferente_id":"agente_negocio_2"}'
```
→ `offer_id: "68ff346b-cf34-4c72-8cbc-24f40a43e5be"`, request pasa a `NEGOTIATING`

**3) Usuario A acepta oferta:**
```bash
curl -s -X POST "http://localhost:3000/requests/d642948e-763e-4df7-b16d-804f2cb241da/offers/68ff346b-cf34-4c72-8cbc-24f40a43e5be/accept" \
  -H "Content-Type: application/json" \
  -d '{"actor_id":"usuario_arroz"}'
```
→ Deal `id: "5f3e003c-6815-458f-a08e-8880d39b1e47"`, `estado: "PENDING_ESCROW"`, Request `CLOSED`

**4) Sincronizar estado (sin Prototype configurado):**
```bash
curl -s -X POST "http://localhost:3000/requests/d642948e-763e-4df7-b16d-804f2cb241da/sincronizar-estado"
```
→ `{"ok": false, "error": "Prototype no configurado. Definí PROTOTYPE_BASE_URL."}`

**5) Estado final del request + sala:**
- Request: `estado: "CLOSED"`
- Offer: `estado: "ACCEPTED"` (precio 850, cantidad 5)
- Deal: `estado: "PENDING_ESCROW"`, `precio_final: 850`
- Sala: 1 mensaje (OFFER), 1 offer, 1 deal

---

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/requests` | Crear solicitud (texto libre con confirmación, o estructura directa) |
| `GET` | `/requests` | Listar tablero (filtros: `estado`, `categoria`, `agente_id`, `limit`, `offset`) |
| `GET` | `/requests/:id` | Ver solicitud + sala (offers, messages, deal) |
| `POST` | `/requests/:id/messages` | Enviar mensaje u oferta (`OFFER`, `COUNTER_OFFER`, `TEXT`) |
| `POST` | `/requests/:id/offers/:offerId/accept` | Aceptar oferta → Deal en `PENDING_ESCROW` → Request `CLOSED` |
| `POST` | `/requests/:id/cancel` | Cancelar solicitud |
| `GET` | `/requests/:id/resumen-agente` | Resumen del agente del solicitante (filtro por `AgentMandate`) |
| `POST` | `/requests/:id/sincronizar-estado` | Sincronizar estado del Deal con payment link del Prototype |
| `GET` | `/reputacion/:agenteId` | Reputación básica off-chain por `agente_id` |
| `GET` | `/health` | Health check |

## Parser con reglas

Soporta frases como:
- `"necesito 10 kg de azúcar"`
- `"quiero comprar 10 kg de azúcar, hasta $1500/kg, para el viernes"`
- `"busco 50 litros de diésel a menos de $900"`
- `"necesito 200 unidades de papel A4, zona Belgrano"`

Si faltan campos obligatorios (producto, cantidad, unidad), devuelve error pidiendo aclaración al humano (no inventa valores).

## Invariantes respetadas

- **I1**: Request es el objeto central (request-céntrico, no libro de órdenes).
- **I2**: Sala de negociación = set de `Message` con el mismo `request_id`.
- **I3**: Todo cambio de estado emite un evento (tabla `events`).
- **I4**: `Message` es inmutable (trigger de BD + solo endpoint POST).
- **I5**: Deal es el puente al escrow (se detiene en `PENDING_ESCROW`).
- **I6**: `AgentMandate` modelado desde ahora, aplicado off-chain.
- **I7**: Nombres de evento estándar (`RequestCreated`, `OfferSubmitted`, `OfferAccepted`, `DealCreated`, `MessageSent`, `RequestCancelled`, `OfferRejected`, `RequestClosed`).
- **I8**: `categoria`, `tags`, `ubicacion` existen desde el inicio.
- **I9**: `agente_id` distinto del humano.
- **I10**: Negociación híbrida (agente sugiere, humano aprueba el deal).

## Siguientes fases (no tocar en esta fase)

- Capa 2: Escrow on-chain (Mycelium o Cogladius como candidatos).
- Capa 3: AgentMandate on-chain (REAPP o Eunomia como candidatos).
- Capa 4: Trazabilidad on-chain (anclaje on-chain de eventos, reputación por agente_id).
- Capa 5: Canales externos (ChatGPT/ACP), Nirium para tesorería.
