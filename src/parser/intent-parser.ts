import { ParsedRequest, ParserResult } from './types';

/**
 * Parser con reglas (no LLM) para frases de intención de compra.
 * Fase 1: regex sobre texto en español.
 *
 * Patrón soportado (ejemplos):
 *   "necesito 10 kg de azúcar"
 *   "quiero comprar 10 kg de azúcar, hasta $1500/kg, para el viernes"
 *   "busco 50 litros de diésel a menos de $900"
 *   "necesito 200 unidades de papel A4, zona Belgrano"
 *
 * Campos obligatorios para publicar: producto, cantidad, unidad.
 * Si faltan → resultado con missing[] y error guiado al humano (no inventa).
 */

const DIA_SEMANA = [
  'lunes', 'martes', 'miércoles', 'miercoles', 'jueves',
  'viernes', 'sábado', 'sabado', 'domingo',
];

// Verbos de intención que pueden iniciar la frase
const VERBOS_INICIO = [
  'necesito', 'quiero', 'busco', 'requiero',
  'comprar', 'adquirir', 'solicito', 'compra',
];

// Artículos y preposiciones que pueden ir antes del producto
const ARTICULOS = ['un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las'];

/**
 * Elimina verbos de inicio, artículos y preposiciones iniciales.
 * Devuelve el texto "limpio" desde donde empieza el producto.
 */
function limpiarPrefijo(texto: string): string {
  let t = texto.trim();

  // Remover verbos de inicio (uno o más, encadenados como "quiero comprar")
  let cambiado = true;
  while (cambiado) {
    cambiado = false;
    for (const v of VERBOS_INICIO) {
      const regex = new RegExp(`^${v}\\s+`, 'i');
      if (regex.test(t)) {
        t = t.replace(regex, '');
        cambiado = true;
        break;
      }
    }
  }

  // Remover "de" inicial
  t = t.replace(/^de\s+/i, '');

  // Remover artículos iniciales
  for (const art of ARTICULOS) {
    const regex = new RegExp(`^${art}\\s+`, 'i');
    if (regex.test(t)) {
      t = t.replace(regex, '');
      break;
    }
  }

  return t.trim();
}

/**
 * Extrae producto: la palabra/frase principal después de quitar verbos,
 * artículos y la cantidad+unidad.
 *
 * Patrones reconocidos:
 *   "10 kg de azúcar"        → producto = "azúcar"
 *   "50 litros de diésel"    → producto = "diésel"
 *   "200 unidades de papel"  → producto = "papel"
 *   "azúcar" (sin cantidad)  → producto = "azúcar"
 */
function extraerProducto(textoOriginal: string, cantidad: number | null, unidad: string | null): string | null {
  let t = limpiarPrefijo(textoOriginal);

  // Unidades reconocidas (forma original en el texto, no normalizada)
  const UNIDADES_RE = 'kg|kilos|kilogramos|lt|litros|litro|unidades|unidad|packs|pack|cajas|caja|bolsas|bolsa|sobre|sobres|bidones|bidon|barricas|barrica';

  // Patrón: [cantidad] [unidad] de [producto]
  if (cantidad !== null && unidad !== null) {
    const patronCant = new RegExp(
      `^${cantidad}\\s+(?:${UNIDADES_RE})\\s*de\\s+(.+?)(?:\s*,|\s+para|\s+hasta|\s+a\s+menos|\s+presupuesto|\s+en\s+|\s+zona\s+|\s*$)`,
      'i'
    );
    const m = t.match(patronCant);
    if (m && m[1]) {
      return limpiarProducto(m[1]);
    }
  }

  // Sin "de" después de cantidad+unidad, o sin cantidad:
  // tomar lo que queda como producto (hasta delimitadores)
  const m2 = t.match(/^(.+?)(?:\s*,|\s+para|\s+hasta|\s+a\s+menos|\s+presupuesto|\s+en\s+|\s+zona\s+|\s*$)/i);
  if (!m2 || !m2[1]) return null;
  return limpiarProducto(m2[1]);
}

/**
 * Limpia el producto extraído: remueve delimitadores residuales y artículos finales.
 */
function limpiarProducto(p: string): string | null {
  let producto = p.trim();
  // Cortar en delimitadores de precio/ubicación/tiempo
  producto = producto.replace(/\s+(a\s+menos|hasta|presupuesto|en|zona)\s+.*$/i, '').trim();
  // Remover artículos/preposiciones sueltos al final
  producto = producto.replace(/\s+(de|del|a|en|para)\s*$/i, '').trim();
  if (!producto || producto.length < 2) return null;
  return producto;
}

/**
 * Extrae cantidad + unidad: número seguido de unidad reconocida.
 */
function extraerCantidadUnidad(texto: string): { cantidad: number | null; unidad: string | null } {
  const patron =
    /(\d+(?:[.,]\d+)?)\s*(kg|kilos|kilogramos|lt|litros|litro|unidades|unidad|packs|pack|cajas|caja|bolsas|bolsa|sobre|sobres|bidones|bidon|barricas|barrica)/i;
  const m = texto.match(patron);
  if (!m) return { cantidad: null, unidad: null };

  const cantidad = parseFloat(m[1].replace(',', '.'));
  let unidad = m[2].toLowerCase();

  const normalizacion: Record<string, string> = {
    kilos: 'kg', kilogramos: 'kg',
    lt: 'lt', litros: 'lt', litro: 'lt',
    unidades: 'unidad', unidad: 'unidad',
    packs: 'pack', pack: 'pack',
    cajas: 'caja', caja: 'caja',
    bolsas: 'bolsa', bolsa: 'bolsa',
    sobres: 'sobre', sobre: 'sobre',
    bidones: 'bidon', bidon: 'bidon',
    barricas: 'barrica', barrica: 'barrica',
  };
  unidad = normalizacion[unidad] || unidad;

  return { cantidad, unidad };
}

/**
 * Extrae precio máximo: "hasta $X", "máximo $X", "menos de $X", "presupuesto $X".
 */
function extraerPrecioMax(texto: string): number | null {
  const patrones = [
    /(?:hasta|\$max|máximo\s*\$?|maximo\s*\$?|menos\s*de\s*\$?|presupuesto\s*(?:de\s*)?\$?)\s*\$?\s*(\d+(?:[.,]\d+)?)/i,
    /\$\s*(\d+(?:[.,]\d+)?)/,
  ];
  for (const p of patrones) {
    const m = texto.match(p);
    if (m && m[1]) {
      return parseFloat(m[1].replace(',', '.'));
    }
  }
  return null;
}

/**
 * Extrae plazo de entrega: día de la semana, "mañana", "pasado", o fecha DD/MM.
 */
function extraerPlazoEntrega(texto: string): string | null {
  const t = texto.toLowerCase();
  const hoy = new Date();
  let fecha: Date | null = null;

  for (const dia of DIA_SEMANA) {
    const regex = new RegExp(`\\b${dia}\\b`, 'i');
    if (regex.test(t)) {
      const idx = DIA_SEMANA.map((d) => d.toLowerCase()).indexOf(dia);
      const diaHoy = hoy.getDay(); // 0=domingo, 1=lunes...
      const diaNumero = idx === 8 ? 0 : idx + 1;
      let diff = diaNumero - diaHoy;
      if (diff <= 0) diff += 7;
      fecha = new Date(hoy);
      fecha.setDate(hoy.getDate() + diff);
      break;
    }
  }

  if (!fecha && /mañana/.test(t)) {
    fecha = new Date(hoy);
    fecha.setDate(hoy.getDate() + 1);
  }
  if (!fecha && /pasado/.test(t)) {
    fecha = new Date(hoy);
    fecha.setDate(hoy.getDate() + 2);
  }
  if (!fecha) {
    const m = t.match(/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      const dia = parseInt(m[1], 10);
      const mes = parseInt(m[2], 10);
      fecha = new Date(hoy.getFullYear(), mes - 1, dia);
      if (fecha < hoy) {
        fecha.setFullYear(hoy.getFullYear() + 1);
      }
    }
  }

  return fecha ? fecha.toISOString() : null;
}

/**
 * Extrae ubicación: "en Belgrano", "zona Centro", "de CABA".
 */
function extraerUbicacion(texto: string): string | null {
  const patron = /(?:en|de|zona)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]{2,})/;
  const m = texto.match(patron);
  if (m && m[1]) {
    return m[1].trim();
  }
  return null;
}

/**
 * Determina si el texto parece una solicitud de compra válida.
 */
function pareceSolicitudValida(texto: string): boolean {
  const t = texto.toLowerCase();
  const tieneVerbo = VERBOS_INICIO.some((v) => t.includes(v));
  const tieneNumero = /\d/.test(t);
  const noEsSaludo = !/^(hola|buenos|buenas|¿cómo|como estas|qué tal)/.test(t.trim());
  return tieneVerbo && tieneNumero && noEsSaludo;
}

export function parseIntent(texto: string): ParserResult {
  const raw = texto.trim();

  if (!raw || raw.length < 5) {
    return {
      ok: false,
      error: 'No pude entender tu mensaje. Por favor escribí qué necesitás comprar (ejemplo: "necesito 10 kg de azúcar").',
    };
  }

  if (!pareceSolicitudValida(raw)) {
    return {
      ok: false,
      error: 'No detecté una solicitud de compra clara. Decime qué producto necesitás y en qué cantidad (ejemplo: "necesito 10 kg de azúcar").',
    };
  }

  const { cantidad, unidad } = extraerCantidadUnidad(raw);
  const producto = extraerProducto(raw, cantidad, unidad);
  const precio_max = extraerPrecioMax(raw);
  const plazo_entrega = extraerPlazoEntrega(raw);
  const ubicacion = extraerUbicacion(raw);

  const missing: string[] = [];
  if (!producto) missing.push('producto');
  if (!cantidad) missing.push('cantidad');
  if (!unidad) missing.push('unidad');

  const parsed: ParsedRequest = {
    producto,
    cantidad,
    unidad,
    precio_max,
    plazo_entrega,
    ubicacion,
    categoria: null,
    tags: [],
    perfil_solicitante: null,
    raw,
    missing,
  };

  if (missing.length > 0) {
    const campos = missing.join(', ');
    return {
      ok: false,
      error: `Faltan datos para publicar la solicitud: ${campos}. Decíme, por ejemplo: "necesito 10 kg de azúcar".`,
      data: parsed,
    };
  }

  return { ok: true, data: parsed };
}
