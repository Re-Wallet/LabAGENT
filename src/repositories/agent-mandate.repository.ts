import { query } from '../config/db';

export interface AgentMandate {
  agente_id: string;
  negocio_id: string;
  gasto_max_por_operacion: number;
  gasto_max_acumulado: number;
  gasto_ventana_tiempo_dias: number;
  rango_precio_aceptable_min?: number | null;
  rango_precio_aceptable_max?: number | null;
  plazo_max_entrega_dias?: number | null;
  whitelist_contrapartes: string[];
}

/**
 * Obtiene el AgentMandate de un agente.
 */
export async function getMandate(agente_id: string): Promise<AgentMandate | null> {
  const res = await query(
    `SELECT agente_id, negocio_id, gasto_max_por_operacion, gasto_max_acumulado,
            gasto_ventana_tiempo, rango_precio_aceptable_min,
            rango_precio_aceptable_max, plazo_max_entrega, whitelist_contrapartes
     FROM agent_mandates WHERE agente_id = $1`,
    [agente_id]
  );
  const row = res.rows[0];
  if (!row) return null;

  return {
    agente_id: row.agente_id,
    negocio_id: row.negocio_id,
    gasto_max_por_operacion: Number(row.gasto_max_por_operacion),
    gasto_max_acumulado: Number(row.gasto_max_acumulado),
    gasto_ventana_tiempo_dias: row.gasto_ventana_tiempo
      ? Math.floor(Number(row.gasto_ventana_tiempo) / 86400000) // interval -> ms
      : 30,
    rango_precio_aceptable_min: row.rango_precio_aceptable_min
      ? Number(row.rango_precio_aceptable_min)
      : null,
    rango_precio_aceptable_max: row.rango_precio_aceptable_max
      ? Number(row.rango_precio_aceptable_max)
      : null,
    plazo_max_entrega_dias: row.plazo_max_entrega
      ? Math.floor(Number(row.plazo_max_entrega) / 86400000)
      : null,
    whitelist_contrapartes: row.whitelist_contrapartes ?? [],
  };
}
