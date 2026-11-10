# ReWallet Lab — Mercado Interno (Fase 1)

Mercado interno de solicitudes (Request/Offer/Message/Deal) para la wallet ReWallet.
**Off-chain**, listo para integrarse con la PoC Stellar existente y con el escrow en fases futuras.

## Estado

En desarrollo — vertical slice mínimo implementado. Esperando acceso a Postgres para ejecutar los tests E2E.

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
DB_PORT=5432
DB_USER=labagent
DB_PASSWORD=labagent
DB_NAME=labagent

AGENTE_ID=agente_negocio_1
NEGOCIO_ID=negocio_1
GASTO_MAX_POR_OPERACION=50000
GASTO_MAX_ACUMULADO=200000
GASTO_VENTANA_TIEMPO_DIAS=30
RANGO_PRECIO_MIN=1
RANGO_PRECIO_MAX=100000
PLAZO_MAX_ENTREGA_DIAS=7
```

> Nota: los archivos `.env*` fueron bloqueados por la política de seguridad del entorno; crear el `.env` manualmente o exportar las variables.

## Base de datos

El DDL oficial (tablas `requests`, `offers`, `messages`, `deals`, `events`, `agent_mandates`, trigger de inmutabilidad de `messages`) vive en **otro proyecto/rama** por instrucción del usuario.

Para validación local, `tests/setup.ts` contiene un DDL equivalente que se ejecuta antes de los tests.

```bash
# Ejemplo: crear base y usuario (requiere acceso a Postgres)
sudo -u postgres psql -c "CREATE USER labagent WITH PASSWORD 'labagent';"
sudo -u postgres psql -c "CREATE DATABASE labagent OWNER labagent;"
```

## Ejecutar en desarrollo

```bash
npx ts-node src/index.ts
# Servidor en http://localhost:3000
```

## Ejecutar tests

Requiere Postgres accesible con las variables de entorno arriba:

```bash
npm test
# o
npx jest
```

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
| `GET` | `/health` | Health check |

## Ejemplo: caso E2E (azúcar)

1. **Usuario A publica**: `POST /requests` con `texto: "necesito 10 kg de azúcar, hasta $1500/kg, para el viernes"` + `confirmado: true`
2. **Usuario B oferta**: `POST /requests/:id/messages` con `tipo: "OFFER"`, `precio: 1400`, `cantidad: 10`
3. **Agente A filtra**: `GET /requests/:id/resumen-agente?agente_id=agente_negocio_1`
4. **Usuario A acepta**: `POST /requests/:id/offers/:offerId/accept` con `actor_id: "usuario_a"`
   → Deal en `PENDING_ESCROW`, Request `CLOSED`, demás ofertas `REJECTED`

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
- Capa 4: Trazabilidad on-chain.
- Capa 5: Canales externos (ChatGPT/ACP), Nirium para tesorería.
