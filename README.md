# ReWallet Lab - Mercado Interno (Fase 1)

[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue)](https://www.postgresql.org/)
[![Stellar Soroban](https://img.shields.io/badge/Stellar%20Soroban-Testnet-blue)](https://developers.stellar.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

ReWallet Lab es un laboratorio de agentes autónomos para comercio electrónico descentralizado. Implementa un mercado interno de solicitudes (RFQ - Request for Quotation) donde compradores y vendedores negocian productos mediante agentes autónomos, con soporte para escrow on-chain en Stellar Soroban y trazabilidad completa de eventos.

## 📋 Tabla de Contenidos

- [🎯 Objetivo del Proyecto](#-objetivo-del-proyecto)
- [🏗️ Arquitectura](#-arquitectura)
- [📊 Diagrama de Arquitectura Hexagonal](#-diagrama-de-arquitectura-hexagonal)
- [🔄 Flujo de Transacciones del Deal](#-flujo-de-transacciones-del-deal)
- [📊 Capas del Sistema](#-capas-del-sistema)
- [📋 Diagrama de Eventos y Trazabilidad](#-diagrama-de-eventos-y-trazabilidad)
- [🚀 Despliegue del Sistema](#-despliegue-del-sistema)
- [🛠️ Instalación y Configuración](#-instalación-y-configuración)
- [📚 Endpoints de la API](#-endpoints-de-la-api)
- [🔗 Contratos Desplegados en Testnet](#-contratos-desplegados-en-testnet)
- [🧪 Pruebas E2E](#-pruebas-e2e)
- [📖 Documentación de Investigación](#-documentación-de-investigación)
- [🔗 Enlaces de Verificación](#-enlaces-de-verificación)
- [📄 Licencia](#-licencia)

---

## 🎯 Objetivo del Proyecto

El objetivo de ReWallet Lab es validar un mercado interno de solicitudes donde:

1. **Usuarios** pueden expresar necesidades de compra en lenguaje natural
2. **Agentes autónomos** parsean el lenguaje natural a solicitudes estructuradas (Request)
3. **Mercado interno** permite que contrapartes envíen ofertas (Offer)
4. **Negociación híbrida** donde el agente filtra y sugiere, pero el humano aprueba el deal final
5. **Escrow on-chain** que retiene fondos hasta la liberación condicional
6. **Trazabilidad completa** de todos los eventos en base de datos off-chain y anclaje on-chain

---

## 🏗️ Arquitectura

El sistema sigue una **arquitectura hexagonal** (puertos y adaptadores) que separa claramente las responsabilidades:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Capa de Presentación (API REST)              │
│                    ┌─────────────────────────────────┐          │
│                    │  Express.js - Controladores     │          │
│                    │  Rutas API - Validación         │          │
│                    └─────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Capa de Aplicación (Use Cases)               │
│                    ┌─────────────────────────────────┐          │
│                    │  Cierre de Deal                 │          │
│                    │  Agente Mandato               │          │
│                    │  Parser de Intención          │          │
│                    │  Reputación                   │          │
│                    │  Cliente Escrow Soroban       │          │
│                    └─────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Capa de Dominio (Domain)                     │
│                    ┌─────────────────────────────────┐          │
│                    │  Request / Offer / Deal         │          │
│                    │  Message / Event                │          │
│                    │  AgentMandate                 │          │
│                    └─────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Capa de Infraestructura                      │
│                    ┌─────────────────────────────────┐          │
│                    │  Repositorios (PostgreSQL)      │          │
│                    │  Contratos Soroban (Testnet)    │          │
│                    └─────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### Capas del Sistema

| Capa | Nombre | Descripción |
|------|--------|-------------|
| **Capa 1** | Mercado Interno | Request, Offer, Message, Deal, Events (off-chain) |
| **Capa 2** | Escrow | Contrato Soroban para retención de fondos |
| **Capa 3** | AgentMandate | Límites y permisos del agente (off-chain) |
| **Capa 4** | Trazabilidad y Reputación | Eventos on-chain, Agent Registry, reputación |
| **Capa 5** | Canales Externos | ChatGPT/ACP, Nirium (futuro) |

---

## 📊 Diagrama de Arquitectura Hexagonal

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#5D9CEC', 'secondaryColor': '#48CFAD', 'tertiaryColor': '#F6BB42', 'fontFamily': 'Arial'}}}%%

graph TD
    %% Capa de Presentación
    subgraph Capa_Presentacion["📱 Capa de Presentación (API REST)"]
        API[API REST Express]
        API_Controllers[Controladores Express]
        API_Routes[Rutas API]
    end

    %% Capa de Aplicación
    subgraph Capa_Aplicacion["🔧 Capa de Aplicación (Use Cases)"]
        DealClosure[Servicio de Cierre de Deal]
        AgentMandate[Servicio AgentMandate]
        ParserIntencion[Parser de Intención]
        Reputacion[Servicio Reputación]
        EscrowClient[Cliente Escrow Soroban]
    end

    %% Capa de Dominio
    subgraph Capa_Dominio["🎯 Capa de Dominio (Domain)"]
        Request[Entidad Request]
        Offer[Entidad Offer]
        Deal[Entidad Deal]
        Message[Entidad Message]
        Event[Entidad Event]
        AgentMandate[Entidad AgentMandate]
    end

    %% Capa de Infraestructura
    subgraph Capa_Infraestructura["💾 Capa de Infraestructura"]
        RepositorioRequests[Repositorio Requests]
        RepositorioOffers[Repositorio Offers]
        RepositorioMessages[Repositorio Messages]
        RepositorioDeals[Repositorio Deals]
        RepositorioEvents[Repositorio Events]
        RepositorioMandates[Repositorio AgentMandates]
        DB[(PostgreSQL<br/>Tabla: requests, offers,<br/>messages, deals, events,<br/>agent_mandates)]
        Blockchain[Contratos Soroban<br/>Testnet]
    end

    API --> API_Controllers --> API_Routes
    API_Controllers --> DealClosure
    API_Controllers --> AgentMandate
    API_Controllers --> ParserIntencion
    API_Controllers --> Reputacion

    DealClosure --> Request
    DealClosure --> Offer
    DealClosure --> Deal
    ParserIntencion --> Request
    AgentMandate --> Offer
    Reputacion --> AgentMandate

    DealClosure --> RepositorioRequests
    DealClosure --> RepositorioOffers
    DealClosure --> RepositorioMessages
    DealClosure --> RepositorioDeals
    DealClosure --> RepositorioEvents
    AgentMandate --> RepositorioMandates
    EscrowClient --> Blockchain

    Request -.-> RepositorioRequests
    Offer -.-> RepositorioOffers
    Message -.-> RepositorioMessages
    Deal -.-> RepositorioDeals
    Event -.-> RepositorioEvents
    AgentMandate -.-> RepositorioMandates

    RepositorioRequests --> DB
    RepositorioOffers --> DB
    RepositorioMessages --> DB
    RepositorioDeals --> DB
    RepositorioEvents --> DB
    RepositorioMandates --> DB
```

---

## 🔄 Flujo de Transacciones del Deal

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#5D9CEC', 'secondaryColor': '#48CFAD', 'tertiaryColor': '#F6BB42', 'fontFamily': 'Arial'}}}%%

graph TD
    UsuarioA[👤 Usuario A - Comprador]
    UsuarioB[👤 Usuario B - Vendedor]
    Mercado[🏪 Mercado Interno]
    Escrow[⛓️ Contrato Escrow Soroban]

    UsuarioA --> CrearRequest[Crear Request]
    UsuarioB --> EnviarOffer[Enviar Offer]
    CrearRequest --> AceptarOffer[Aceptar Offer]
    EnviarOffer --> AceptarOffer

    AceptarOffer --> PENDING_ESCROW[PENDING_ESCROW]
    PENDING_ESCROW --> Depositar[Depositar USDC]
    Depositar --> IN_ESCROW[IN_ESCROW]

    IN_ESCROW --> Reclamar[Reclamar Entrega]
    Reclamar --> DELIVERED[DELIVERED]

    DELIVERED --> Confirmar[Confirmar Entrega]
    Confirmar --> Liberar[Liberar Fondos]
    Liberar --> SETTLED[SETTLED]

    PENDING_ESCROW --> Reembolsar[Reembolsar]
    DELIVERED --> Reembolsar
    Reembolsar --> DISPUTED[DISPUTED]

    Depositar -.-> Contrato_Escrow[Contrato Escrow Soroban]
    Reclamar -.-> Contrato_Escrow
    Confirmar -.-> Contrato_Escrow
    Liberar -.-> Contrato_Escrow
    Reembolsar -.-> Contrato_Escrow
```

---

## 📋 Diagrama de Eventos y Trazabilidad

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#5D9CEC', 'secondaryColor': '#48CFAD', 'tertiaryColor': '#F6BB42', 'fontFamily': 'Arial'}}}%%

graph TD
    %% Eventos del Mercado
    subgraph Eventos_Mercado["📊 Eventos de Mercado Interno"]
        E1[RequestCreated]
        E2[OfferSubmitted]
        E3[OfferAccepted]
        E4[OfferRejected]
        E5[MessageSent]
        E6[RequestCancelled]
        E7[RequestExpired]
        E8[RequestClosed]
    end

    %% Eventos del Escrow
    subgraph Eventos_Escrow["⛓️ Eventos de Escrow"]
        E9[DealCreated]
        E10[Deposito]
        E11[EntregaReclamada]
        E12[EntregaConfirmada]
        E13[Liberado]
        E14[Reembolsado]
        E15[Disputado]
    end

    %% Tabla de Eventos Off-Chain
    subgraph Tabla_Events["💾 Tabla events (PostgreSQL Off-Chain)"]
        T1[ID, type, actor_id, actor_tipo]
        T2[request_id, offer_id, deal_id]
        T3[payload JSONB]
        T4[timestamp]
    end

    %% Anclaje On-Chain
    subgraph Anclaje_OnChain["⛓️ Anclaje On-Chain (Event Anchor)"]
        A1[Merkle Root]
        A2[Batch de Eventos]
        A3[Root Hash en Contrato]
    end

    E1 --> T1
    E2 --> T1
    E3 --> T1
    E4 --> T1
    E5 --> T1
    E6 --> T1
    E7 --> T1
    E8 --> T1
    E9 --> T1
    E10 --> T1
    E11 --> T1
    E12 --> T1
    E13 --> T1
    E14 --> T1
    E15 --> T1

    T1 --> A1
    A1 --> A2
    A2 --> A3
```

---

## 🚀 Despliegue del Sistema

### 1. Backend (Node.js + Express)

```bash
# Clonar el repositorio
git clone https://github.com/Re-Wallet/LabAGENT.git
cd LabAGENT

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# Compilar TypeScript
npx tsc

# Iniciar el servidor
node dist/index.js
```

### 2. Base de Datos PostgreSQL

```bash
# Crear base de datos y usuario
sudo -u postgres psql -c "CREATE USER labagent WITH PASSWORD 'labagent';"
sudo -u postgres psql -c "CREATE DATABASE labagent OWNER labagent;"

# Ejecutar migraciones (DDL en tests/setup.ts)
psql -h localhost -U labagent -d labagent -f tests/setup.ts
```

### 3. Contratos Soroban (Testnet)

```bash
# Construir contratos
cd contracts/escrow-deal
stellar contract build

cd ../event-anchor
stellar contract build

cd ../agent-registry
stellar contract build

# Desplegar en testnet
stellar contract deploy \
  --wasm target/wasm32v1-none/release/escrow_deal.wasm \
  --alias escrow_deal_v1 \
  --network testnet \
  --source TU_CUENTA \
  -- \
  --admin TU_PUBLIC_KEY \
  --usdc-sac TU_SAC_DE_USDC \
  --settle-grace-seconds 604800
```

---

## 🛠️ Instalación y Configuración

### Prerrequisitos

- Node.js 18+
- PostgreSQL 15+
- Stellar CLI (para contratos)
- Rust + cargo (para contratos Soroban)

### Variables de Entorno

Crear archivo `.env`:

```env
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=5434
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

SOROBAN_CONTRACT_ID=CBTW3FBMCPURBGUGUL3TKVKKNPDPBMPQGQMCK4VK2MAHJXU7NHNXGEAP
SOROBAN_SAC_ID=CBPYDMY3MU6CDAY2QVPUV735Q7IT5BEG33IDJEDZUBP4A5IXSOAAAA62
SOROBAN_ADMIN_SECRET_KEY=TU_SECRET_KEY
```

---

## 📚 Endpoints de la API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/requests` | Crear solicitud (texto libre con confirmación, o estructura directa) |
| `GET` | `/requests` | Listar tablero (filtros: estado, categoria, agente_id, limit, offset) |
| `GET` | `/requests/:id` | Ver solicitud + sala (offers, messages, deal) |
| `POST` | `/requests/:id/messages` | Enviar mensaje u oferta (OFFER, COUNTER_OFFER, TEXT) |
| `POST` | `/requests/:id/offers/:offerId/accept` | Aceptar oferta → Deal en PENDING_ESCROW → Request CLOSED |
| `POST` | `/requests/:id/cancel` | Cancelar solicitud |
| `GET` | `/requests/:id/resumen-agente` | Resumen del agente del solicitante (filtro por AgentMandate) |
| `POST` | `/requests/:id/sincronizar-estado` | Sincronizar estado del Deal con payment link del Prototype |
| `GET` | `/reputacion/:agenteId` | Reputación básica off-chain por agente_id |
| `GET` | `/health` | Health check |

### Ejemplo: Crear Request

```bash
curl -s -X POST http://localhost:3000/requests \
  -H "Content-Type: application/json" \
  -d '{"texto": "necesito 10 kg de azúcar, hasta $1500/kg, para el viernes", "confirmado": true, "solicitante_id": "usuario_a", "agente_id": "agente_negocio_1", "producto": "azúcar", "cantidad": 10, "unidad": "kg", "precio_max": 1500}'
```

Respuesta:
```json
{
  "ok": true,
  "request": {
    "id": "uuid-generado",
    "solicitante_id": "usuario_a",
    "agente_id": "agente_negocio_1",
    "producto": "azúcar",
    "cantidad": "10",
    "unidad": "kg",
    "precio_max": "1500",
    "estado": "OPEN"
  }
}
```

### Ejemplo: Aceptar Oferta

```bash
curl -s -X POST "http://localhost:3000/requests/:id/offers/:offerId/accept" \
  -H "Content-Type: application/json" \
  -d '{"actor_id": "usuario_a"}'
```

Respuesta:
```json
{
  "ok": true,
  "mensaje": "Deal creado en PENDING_ESCROW. Aprobado por el humano.",
  "result": {
    "deal": {
      "id": "uuid-deal",
      "estado": "PENDING_ESCROW",
      "precio_final": 1500
    }
  }
}
```

---

## 🔗 Contratos Desplegados en Testnet

| Contrato | Dirección | Descripción |
|----------|-----------|-------------|
| **Escrow de Deal** | `CAR4Z3CHDEYMMR6J6XMOWHRTWA45YDFAGGQXR7O76HAKM3ERJG33M47D` | Retiene USDC en escrow hasta liberación |
| **Event Anchor** | `CAB57G6KNWEV24PSF6BBOW6IG4KMT4E2IOVSSFJGOFPFE4LY3YWDJEM5` | Anclaje de eventos off-chain con Merkle root |
| **Agent Registry** | `CDDFBJ6UBN76FH6Q5PDPAHGSGV32OS4GZ5SF7TYUVJBV2UUDQN7RHMUN` | Registro de agentes y reputación acumulable |

### Verificar Contratos en Stellar Testnet

- [Escrow en Stellar Testnet](https://stellar.expert/explorer/testnet/contract/CAR4Z3CHDEYMMR6J6XMOWHRTWA45YDFAGGQXR7O76HAKM3ERJG33M47D)
- [Event Anchor en Stellar Testnet](https://stellar.expert/explorer/testnet/contract/CAB57G6KNWEV24PSF6BBOW6IG4KMT4E2IOVSSFJGOFPFE4LY3YWDJEM5)
- [Agent Registry en Stellar Testnet](https://stellar.expert/explorer/testnet/contract/CDDFBJ6UBN76FH6Q5PDPAHGSGV32OS4GZ5SF7TYUVJBV2UUDQN7RHMUN)
- [USDC SAC en Stellar Testnet](https://stellar.expert/explorer/testnet/contract/CBPYDMY3MU6CDAY2QVPUV735Q7IT5BEG33IDJEDZUBP4A5IXSOAAAA62)

---

## 🧪 Pruebas E2E

### Ejecutar todos los tests

```bash
npm test
```

### Ejecutar tests específicos

```bash
npx jest tests/e2e-mercado-interno.test.ts --verbose
```

### Casos de Prueba

| Test | Descripción | Estado |
|------|-------------|--------|
| Parser convierte texto a Request estructurado | ✅ Pasa |
| Parser falla limpiamente sin cantidad | ✅ Pasa |
| Parser falla limpiamente en saludo | ✅ Pasa |
| POST /requests - crear request desde texto libre | ✅ Pasa |
| POST /requests - crear request confirmado | ✅ Pasa |
| GET /requests - listar tablero | ✅ Pasa |
| POST /messages - Usuario B envía Offer | ✅ Pasa |
| GET /requests/:id - ver solicitud + sala | ✅ Pasa |
| GET /resumen-agente - agente filtra ofertas | ✅ Pasa |
| POST /accept - Usuario A acepta → Deal PENDING_ESCROW | ✅ Pasa |
| Verificar eventos emitidos | ✅ Pasa |
| Deal está en PENDING_ESCROW | ✅ Pasa |
| Inmutabilidad de Message | ✅ Pasa |
| GET /reputacion/:agenteId | ✅ Pasa |
| Agente sin actividad devuelve ceros | ✅ Pasa |
| Wallet mapping: guardar y obtener | ✅ Pasa |
| Deal payment link: guardar y obtener | ✅ Pasa |

---

## 🔗 Enlaces de Verificación

### Enlaces Externos

- [Stellar Testnet Explorer](https://stellar.expert/explorer/testnet)
- [Stellar Lab](https://lab.stellar.org/)
- [Documentación Soroban](https://developers.stellar.org/docs/build/smart-contracts/overview)
- [CAP-0046-08 - Smart Contract Logging](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046.md)

### Enlaces Internos

- [Research Mercado Interno](./RESEARCH_MERCADO_INTERNO.md)
- [Research Capa 2 - Escrow](./RESEARCH_CAPA2_ESCROW_SOROBAN.md)
- [Research Cogladius (evaluado y descartado)](./RESEARCH_CAPA2_COGLADIUS_ESCROW.md)
- [Research Capa 4 - Trazabilidad y Reputación](./RESEARCH_CAPA4_TRAZABILIDAD_REPUTACION.md)
- [Research Opción C - Mandate Gobernado](./RESEARCH_OPCION_C_MANDATE_GOBERNADO.md)
- [Diseño de Contratos Capa 2](./docs/architecture/diagrams/)

---

## 📦 Estructura del Proyecto

```
LabAGENT/
├── src/
│   ├── config/          # Configuración DB y entorno
│   ├── controllers/     # Controladores Express
│   ├── events/          # Servicio de eventos
│   ├── parser/          # Parser con reglas (no LLM)
│   ├── repositories/    # Repositorios de BD
│   ├── routes/          # Rutas de la API
│   ├── services/        # Servicios de negocio
│   │   ├── deal-closure.service.ts
│   │   ├── reputacion.service.ts
    │   ├── escrow-client.service.ts
│   │   └── agent-mandate.service.ts
│   └── index.ts         # Punto de entrada
├── tests/               # Tests E2E
├── contracts/           # Contratos Soroban
│   ├── escrow-deal/
│   ├── event-anchor/
│   └── agent-registry/
├── docs/                # Documentación y diagramas
│   └── architecture/diagrams/
├── scripts/             # Scripts de utilidad
├── RESEARCH_*.md        # Documentos de investigación
├── README.md            # Este archivo
├── docker-compose.yml   # Postgres para desarrollo
└── jest.config.js       # Configuración de Jest
```

---

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

---

## 🤝 Contribuir

1. Fork el repositorio
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Añadir nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

---

**Desarrollado con ❤️ para el laboratorio ReWallet**
