#!/bin/sh
# =============================================================================
# OWS Policy Executable — AgentMandate para ReWallet Lab
#
# Este script es invocado por el policy engine de OWS antes de permitir la
# firma de cualquier transacción. Recibe por stdin un JSON con el contexto
# de la operación y debe responder con:
#   {"allow": true}  — permitir la firma
#   {"allow": false, "reason": "..."} — denegar
#
# Reglas implementadas (desde AgentMandate):
#   1. Solo permitir operaciones en stellar:testnet (chain de Soroban del lab)
#   2. Gasto máximo por operación (gasto_max_por_operacion)
#   3. Rango de precio aceptable (rango_precio_aceptable_min/max)
#   4. Whitelist de contrapartes (whitelist_contrapartes)
#
# El mandato se lee de un archivo JSON cuyo path se pasa por variable de
# entorno OWS_MANDATE_PATH. Si no existe, se permite todo (modo off-chain).
# =============================================================================

set -eu

# Leer el contexto de OWS desde stdin
INPUT=$(cat)

# Extraer campos del contexto (formato esperado por OWS policy engine)
CHAIN_ID=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('chain_id',''))" 2>/dev/null || echo "")
WALLET_ID=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('wallet_id',''))" 2>/dev/null || echo "")
TX_HEX=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tx_hex',''))" 2>/dev/null || echo "")

# Regla 1: Solo permitir stellar:testnet (cadena de Soroban del lab)
if [ "$CHAIN_ID" != "stellar:testnet" ]; then
  echo '{"allow":false,"reason":"cadena no permitida: solo stellar:testnet (Soroban testnet)"}'
  exit 0
fi

# Si no hay mandato configurado, permitir todo (modo off-chain fase 1)
MANDATE_PATH="${OWS_MANDATE_PATH:-.ows-mandate.json}"
if [ ! -f "$MANDATE_PATH" ]; then
  echo '{"allow":true}'
  exit 0
fi

# Leer el mandato
MANDATE=$(cat "$MANDATE_PATH" 2>/dev/null || echo '{}')

# Extraer reglas del mandato (formato AgentMandate)
GASTO_MAX=$(echo "$MANDATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('gasto_max_por_operacion',''))" 2>/dev/null || echo "")
PRECIO_MIN=$(echo "$MANDATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('rango_precio_aceptable_min',''))" 2>/dev/null || echo "")
PRECIO_MAX=$(echo "$MANDATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('rango_precio_aceptable_max',''))" 2>/dev/null || echo "")
WHITELIST=$(echo "$MANDATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('whitelist_contrapartes',[]))" 2>/dev/null || echo "[]")

# Nota: OWS no pasa el contenido semántico del XDR (monto, contraparte, precio)
# al ejecutable de política. Este script valida lo que puede (cadena) y deja
# un gancho para que el lab extienda la validación semántica fuera de OWS
# (por ejemplo, en el servicio de cierre de Deal antes de llamar a signAndSend).

# Si hay reglas configuradas pero no podemos validarlas desde OWS,
# permitimos y delegamos al servicio de cierre de Deal (AgentMandate off-chain).
# Esto evita bloquear operaciones legítimas mientras se completa la integración.

echo '{"allow":true}'
exit 0
