# Fase B — Diseño de Contratos Soroban Personalizados para ReWallet

**Basado en ingeniería inversa de Cogladius (escrow v1 leído completo)**  
**Estado:** Diseño listo para implementar  
**Red:** Stellar Testnet (USDC)  
**Modelo:** Request-céntrico (I1 del brief)

---

## Hallazgos clave de Cogladius (aplicados a ReWallet)

| Patrón de Cogladius | Cómo lo aplicamos en ReWallet |
|---------------------|------------------------------|
| `post_task` bloquea fondos de poster → contract | `depositar` bloquea USDC de comprador → contrato de escrow |
| `release_to_winner` verifica ed25519 signature + paga | `liberar` verifica firma del comprador + paga al vendedor |
| `refund` devuelve fondos al poster | `reembolsar` devuelve USDC al comprador |
| Estados: Open → Active → Completed / Refunded | Estados: PENDING_ESCROW → IN_ESCROW → DELIVERED → SETTLED / DISPUTED |
| Eventos on-chain: Post, Activate, Settle, Refund, Dispute, Pause | Eventos: Depositado, Liberado, Reclamado, Reembolsado, Disputado, Resuelto |
| CEI pattern (Effects before Interaction) | Aplicar en todas las funciones que mueven fondos |
| Upgradeability nativa de Soroban | Aplicar para poder actualizar lógica sin redeploy |
| TTL de storage persistente | Configurar TTL para no perder datos de deals antiguos |

---

## Contrato 1: Escrow de Deal (Soroban Rust)

### Estados del Deal

```rust
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DealStatus {
    PENDING_ESCROW = 0,   // Fondos bloqueados, esperando entrega
    IN_ESCROW = 1,        // Vendedor reclamó, entrega en curso
    DELIVERED = 2,        // Entrega reclamada, esperando confirmación del comprador
    SETTLED = 3,          // Comprador confirmó, fondos liberados al vendedor
    DISPUTED = 4,         // Disputa abierta (Capa 3)
}
```

### Estructura de Config

```rust
#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,                    // Puede pausar, rotar clave de veredicto
    pub usdc_sac: Address,                 // Stellar Asset Contract de USDC (testnet)
    pub settle_grace_seconds: u64,         // Ventana después de deadline para reembolso
    pub paused: bool,                      // Stop de emergencia
}
```

### Estructura del Deal

```rust
#[contracttype]
#[derive(Clone)]
pub struct Deal {
    pub deal_id: u64,
    pub comprador: Address,
    pub vendedor: Address,
    pub monto: i128,                       // USDC en unidades base (7 decimales)
    pub estado: DealStatus,
    pub creado_en: u64,                    // Timestamp de creación
    pub entrega_reclamada_en: Option<u64>, // Cuándo el vendedor reclamó entrega
}
```

### Funciones del contrato

| Función | Autenticación | Efecto |
|---------|--------------|--------|
| `__constructor` | deployer | Inicializa config |
| `depositar(deal_id, monto)` | comprador | Bloquea USDC, estado → PENDING_ESCROW |
| `reclamar_entrega(vendedor, deal_id, prueba)` | vendedor | Estado → IN_ESCROW |
| `confirmar_entrega(comprador, deal_id)` | comprador | Estado → DELIVERED |
| `liberar(comprador, deal_id)` | comprador | Transfiere USDC al vendedor, estado → SETTLED |
| `reembolsar(comprador, deal_id)` | comprador (antes de deadline) / cualquiera (después) | Devuelve USDC al comprador, estado → DISPUTED o Refunded |
| `disputar(cualquiera, deal_id, motivo)` | cualquiera | Estado → DISPUTED (Capa 3) |
| `pause` / `unpause` | admin | Bloquea nuevas operaciones (excepto reembolso) |
| `set_admin(nuevo_admin)` | admin | Rotación de admin key |

### Eventos on-chain (nombres estándar I7)

| Evento | Campos | Cuándo se emite |
|--------|--------|-----------------|
| `Deposito` | deal_id, comprador, monto, timestamp | Comprador deposita USDC |
| `EntregaReclamada` | deal_id, vendedor, timestamp | Vendedor confirma entrega |
| `EntregaConfirmada` | deal_id, comprador, timestamp | Comprador confirma recepción |
| `Liberado` | deal_id, vendedor, monto, timestamp | Fondos transferidos al vendedor |
| `Reembolsado` | deal_id, comprador, monto, timestamp | Fondos devueltos al comprador |
| `Disputado` | deal_id, motivo, timestamp | Disputa abierta |

### Patrón CEI (Checks-Effects-Interactions)

Todas las funciones que mueven fondos siguen este patrón:
1. **Checks:** Validar estado, autenticación, montos
2. **Effects:** Actualizar storage (estado del deal)
3. **Interactions:** Llamar al contrato de USDC para transferir

### Patrones de seguridad

- **CEI:** Efectos antes de interacciones con contratos externos (USDC SAC)
- **Require auth:** `comprador.require_auth()` para operaciones del comprador
- **Validación de estado:** Verificar que el deal está en el estado esperado antes de transicionar
- **TTL:** `extend_ttl` para entradas persistentes (~30 días)
- **Pausa de emergencia:** Admin puede pausar operaciones nuevas (reembolsos siempre disponibles)

---

## Integración con LabAGENT (backend Node/TS)

### Flujo de sincronización

```
1. Usuario acepta oferta (off-chain)
   └─► Deal creado en PENDING_ESCROW (tabla deals)
   └─► Evento DealCreated emitido (tabla events)

2. Comprador deposita USDC en contrato on-chain
   └─► Evento Deposito emitido on-chain
   └─► Backend sincroniza: Deal → IN_ESCROW

3. Vendedor entrega y reclama (on-chain)
   └─► Evento EntregaReclamada on-chain
   └─► Backend sincroniza: Deal → DELIVERED

4. Comprador confirma y libera (on-chain)
   └─► Evento Liberado on-chain
   └─► Backend sincroniza: Deal → SETTLED
```

### Endpoints nuevos

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/deals/:id/depositar` | Comprador deposita USDC en contrato escrow |
| `POST` | `/deals/:id/reclamar-entrega` | Vendedor reclama entrega |
| `POST` | `/deals/:id/confirmar-entrega` | Comprador confirma recepción |
| `POST` | `/deals/:id/liberar` | Comprador libera fondos al vendedor |
| `POST` | `/deals/:id/reembolsar` | Comprador reembolsa (cancela deal) |
| `POST` | `/deals/:id/sincronizar` | Sincroniza estado desde contrato on-chain |
| `GET` | `/deals/:id/estado` | Ver estado actual del deal (off-chain + on-chain) |

### Mapeo de estados

| Off-chain (LabAGENT) | On-chain (Contrato) |
|----------------------|---------------------|
| PENDING_ESCROW | PENDING_ESCROW (fondos bloqueados) |
| IN_ESCROW | IN_ESCROW (entrega reclamada) |
| DELIVERED | DELIVERED (entrega confirmada por comprador) |
| SETTLED | SETTLED (fondos transferidos) |
| DISPUTED | DISPUTED (disputa abierta) |

---

## Decisiones de diseño (pendientes de confirmación)

| # | Decisión | Default propuesto |
|---|----------|-------------------|
| 1 | ¿Token USDC en Stellar Testnet (SAC)? | Sí |
| 2 | ¿Liberación simple (comprador confirma) sin disputa en Capa 2? | Sí |
| 3 | ¿Quién puede reembolsar? Comprador antes de deadline, cualquiera después | Sí |
| 4 | ¿Ventana de gracia para reembolso después de deadline? | 7 días |
| 5 | ¿Upgradeability nativa de Soroban habilitada? | Sí (admin puede actualizar WASM) |

---

## Próximos pasos

1. Escribir el contrato Soroban en Rust
2. Compilar y desplegar en Stellar Testnet
3. Integrar con backend Node/TS (llamadas al contrato vía stellar-sdk)
4. Pruebas E2E: solicitud → oferta → aceptar → depósito → entrega → liberación

**¿Apruebas este diseño para comenzar a escribir el contrato Soroban?** No codearé hasta recibir tu confirmación.
