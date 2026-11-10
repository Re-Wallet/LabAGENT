import { getMandate } from '../repositories/agent-mandate.repository';
import { listOffersByRequest } from '../repositories/offers.repository';

export interface OfertaEvaluada {
  offer: any;
  dentroDeMandato: boolean;
  razonesFuera: string[];
}

/**
 * Evalúa una oferta contra el AgentMandate del agente del solicitante.
 * Devuelve si está dentro del mandato y las razones si no lo está.
 */
export async function evaluarOfertaContraMandato(
  agenteId: string,
  requestId: string
): Promise<{ mandato: any | null; ofertas: OfertaEvaluada[] }> {
  const mandato = await getMandate(agenteId);
  const ofertas = await listOffersByRequest(requestId);

  const evaluadas: OfertaEvaluada[] = ofertas.map((oferta) => {
    const razones: string[] = [];
    let dentro = true;

    if (!mandato) {
      dentro = true; // sin mandato definido, se permite (off-chain fase 1)
      return { offer: oferta, dentroDeMandato: true, razones: [] };
    }

    const total = Number(oferta.precio) * Number(oferta.cantidad);

    // 1. Gasto máximo por operación
    if (total > mandato.gasto_max_por_operacion) {
      dentro = false;
      razones.push(
        `Total $${total} excede gasto máximo por operación $${mandato.gasto_max_por_operacion}`
      );
    }

    // 2. Rango de precio aceptable
    if (
      mandato.rango_precio_aceptable_min !== null &&
      mandato.rango_precio_aceptable_max !== null &&
      (Number(oferta.precio) < mandato.rango_precio_aceptable_min ||
        Number(oferta.precio) > mandato.rango_precio_aceptable_max)
    ) {
      dentro = false;
      razones.push(
        `Precio $${oferta.precio} fuera de rango [$${mandato.rango_precio_aceptable_min}, $${mandato.rango_precio_aceptable_max}]`
      );
    }

    // 3. Whitelist de contrapartes
    if (
      mandato.whitelist_contrapartes &&
      mandato.whitelist_contrapartes.length > 0 &&
      !mandato.whitelist_contrapartes.includes(oferta.oferente_id)
    ) {
      dentro = false;
      razones.push(
        `Contraparte ${oferta.oferente_id} no está en whitelist`
      );
    }

    return {
      offer: oferta,
      dentroDeMandato: dentro,
      razonesFuera: razones,
    };
  });

  return { mandato, ofertas: evaluadas };
}

/**
 * Genera el resumen para el usuario: qué ofertas mostrar, cuáles escalar.
 */
export function generarResumenUsuario(evaluadas: OfertaEvaluada[]) {
  const dentro = evaluadas.filter((e) => e.dentroDeMandato);
  const fuera = evaluadas.filter((e) => !e.dentroDeMandato);

  return {
    total: evaluadas.length,
    dentroDeMandato: dentro.length,
    fueraDeMandato: fuera.length,
    recomendadas: dentro.map((e) => ({
      offerId: e.offer.id,
      oferente: e.offer.oferente_id,
      precio: e.offer.precio,
      cantidad: e.offer.cantidad,
      condiciones: e.offer.condiciones_entrega,
      total: Number(e.offer.precio) * Number(e.offer.cantidad),
    })),
    escalar: fuera.map((e) => ({
      offerId: e.offer.id,
      oferente: e.offer.oferente_id,
      precio: e.offer.precio,
      razones: e.razonesFuera,
    })),
  };
}
