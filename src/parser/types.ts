/**
 * Contrato de salida del parser con reglas (Sección 9.1 del research).
 * Campos obligatorios para publicar: producto, cantidad, unidad.
 * Los campos faltantes quedan en null y se piden al usuario al confirmar.
 */
export interface ParsedRequest {
  producto: string | null;
  cantidad: number | null;
  unidad: string | null;
  precio_max: number | null;
  plazo_entrega: string | null;   // ISO string o null
  ubicacion: string | null;
  categoria: string | null;       // null en esta fase (filtrado futuro)
  tags: string[];                 // [] en esta fase
  perfil_solicitante: string | null; // null: se pide al usuario al confirmar
  raw: string;                    // texto original para auditoría
  missing: string[];              // campos obligatorios faltantes
}

/**
 * Resultado del parseo.
 * Si `missing` no está vacío, el flujo debe pedir aclaración al humano.
 */
export interface ParserResult {
  ok: boolean;
  data?: ParsedRequest;
  error?: string; // mensaje en español para mostrar al usuario
}
