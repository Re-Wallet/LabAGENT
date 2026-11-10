import { Request, Response } from 'express';
import { parseIntent } from '../parser/intent-parser';
import {
  createRequest,
  getRequestById,
  listRequests,
  updateRequestEstado,
} from '../repositories/requests.repository';
import { createOffer } from '../repositories/offers.repository';
import { createMessage } from '../repositories/messages.repository';
import { cerrarDeal } from '../services/deal-closure.service';
import { evaluarOfertaContraMandato, generarResumenUsuario } from '../services/agent-mandate.service';
import { getDealByRequest } from '../repositories/deals.repository';
import { emitEvent } from '../events/service';
import { inTransaction } from '../events/service';
import { calcularReputacionAgente } from '../services/reputacion.service';

// ---- Tipos internos ----
interface BodyCreateRequest {
  texto?: string;
  solicitante_id?: string;
  agente_id?: string;
  producto?: string;
  cantidad?: number;
  unidad?: string;
  precio_max?: number | null;
  plazo_entrega?: string | null;
  ubicacion?: string | null;
  categoria?: string | null;
  tags?: string[];
  perfil_solicitante?: string | null;
  expires_at?: string | null;
  confirmado?: boolean; // si ya se confirmó la publicación
}

/**
 * POST /requests
 * Crea un Request desde texto libre o estructura.
 * Si viene texto sin confirmar → devuelve el parsed para que el usuario confirme.
 * Si viene confirmado → crea el Request y emite RequestCreated.
 */
export async function crearRequest(req: Request, res: Response): Promise<void> {
  const body = req.body as BodyCreateRequest;

  // Caso A: texto libre → parsear y devolver para confirmación
  if (body.texto && !body.confirmado) {
    const resultado = parseIntent(body.texto);
    if (!resultado.ok || !resultado.data) {
      res.status(400).json({ ok: false, error: resultado.error, data: resultado.data });
      return;
    }
    res.status(200).json({
      ok: true,
      pendienteConfirmacion: true,
      mensaje: 'Revisá los datos antes de publicar.',
      parsed: resultado.data,
    });
    return;
  }

  // Caso B: crear directamente (texto confirmado o estructura completa)
  const {
    solicitante_id,
    agente_id,
    producto,
    cantidad,
    unidad,
    precio_max,
    plazo_entrega,
    ubicacion,
    categoria,
    tags,
    perfil_solicitante,
    expires_at,
  } = body;

  if (!solicitante_id || !agente_id || !producto || !cantidad || !unidad) {
    res.status(400).json({
      ok: false,
      error: 'Faltan campos obligatorios: solicitante_id, agente_id, producto, cantidad, unidad.',
    });
    return;
  }

  const expiresAt = expires_at
    ? new Date(expires_at)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    const request = await createRequest({
      solicitante_id,
      agente_id,
      producto,
      cantidad,
      unidad,
      precio_max: precio_max ?? null,
      plazo_entrega: plazo_entrega ? new Date(plazo_entrega) : null,
      ubicacion: ubicacion ?? null,
      categoria: categoria ?? null,
      tags: tags ?? [],
      perfil_solicitante: perfil_solicitante ?? null,
      expires_at: expiresAt,
    });

    res.status(201).json({
      ok: true,
      pendienteConfirmacion: false,
      request,
      mensaje: 'Solicitud publicada. Estado: OPEN.',
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Error interno',
    });
  }
}

/**
 * GET /requests
 * Listar tablero (default OPEN). Filtros: estado, categoria, agente_id.
 */
export async function listarRequests(req: Request, res: Response): Promise<void> {
  const { estado, categoria, agente_id, limit, offset } = req.query;
  try {
    const requests = await listRequests({
      estado: (estado as string) || 'OPEN',
      categoria: categoria as string,
      agente_id: agente_id as string,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });
    res.json({ ok: true, count: requests.length, requests });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Error interno' });
  }
}

/**
 * GET /requests/:id
 * Ver solicitud + sala (messages + offers) + deal si existe.
 */
export async function verRequest(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  try {
    const request = await getRequestById(id);
    if (!request) {
      res.status(404).json({ ok: false, error: 'Request no encontrado' });
      return;
    }

    const { createOffer } = await import('../repositories/offers.repository');
    const { listMessagesByRequest } = await import('../repositories/messages.repository');
    const { listOffersByRequest } = await import('../repositories/offers.repository');

    const [offers, messages, deal] = await Promise.all([
      listOffersByRequest(id),
      listMessagesByRequest(id),
      getDealByRequest(id),
    ]);

    res.json({
      ok: true,
      request,
      sala: {
        offers,
        messages,
        deal,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Error interno' });
  }
}

/**
 * POST /requests/:id/messages
 * Enviar mensaje u oferta dentro de la sala de negociación.
 */
export async function enviarMensaje(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const {
    autor_id,
    autor_tipo,
    tipo,
    contenido,
    // campos de oferta si tipo es OFFER o COUNTER_OFFER
    precio,
    cantidad,
    condiciones_entrega,
    oferente_id,
    agente_oferente_id,
  } = req.body;

  if (!autor_id || !autor_tipo || !tipo || !contenido) {
    res.status(400).json({ ok: false, error: 'Faltan campos: autor_id, autor_tipo, tipo, contenido' });
    return;
  }

  try {
    // Si el mensaje trae oferta, crear la oferta primero
    let offerId: string | null = null;
    if ((tipo === 'OFFER' || tipo === 'COUNTER_OFFER') && precio !== undefined && cantidad !== undefined) {
      const offer = await createOffer({
        request_id: id,
        oferente_id: oferente_id || autor_id,
        agente_oferente_id: agente_oferente_id || null,
        precio: Number(precio),
        cantidad: Number(cantidad),
        condiciones_entrega: condiciones_entrega || '',
      });
      offerId = offer.id;
    }

    // Luego crear el message (puede referenciar la oferta)
    const contenidoFinal = offerId ? `${contenido} [oferta_id:${offerId}]` : contenido;
    const message = await createMessage({
      request_id: id,
      autor_id,
      autor_tipo: autor_tipo as 'HUMAN' | 'AGENT',
      tipo: tipo as 'TEXT' | 'OFFER' | 'COUNTER_OFFER' | 'ACCEPT' | 'REJECT',
      contenido: contenidoFinal,
    });

    res.status(201).json({ ok: true, message, offer_id: offerId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Error interno' });
  }
}

/**
 * POST /requests/:id/offers/:offerId/accept
 * Aceptar oferta → crear Deal en PENDING_ESCROW → Request CLOSED.
 * Aprobación humana explícita (actor_id = humano que acepta).
 */
export async function aceptarOferta(req: Request, res: Response): Promise<void> {
  const { id, offerId } = req.params;
  const { actor_id } = req.body;

  if (!actor_id) {
    res.status(400).json({ ok: false, error: 'actor_id es obligatorio (quién aprueba el deal)' });
    return;
  }

  try {
    const result = await cerrarDeal(offerId, actor_id);
    res.json({
      ok: true,
      mensaje: 'Deal creado en PENDING_ESCROW. Aprobado por el humano.',
      result,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Error interno',
    });
  }
}

/**
 * POST /requests/:id/cancel
 * Cancelar solicitud (solo OPEN o NEGOTIATING).
 */
export async function cancelarRequest(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { actor_id } = req.body;

  if (!actor_id) {
    res.status(400).json({ ok: false, error: 'actor_id es obligatorio' });
    return;
  }

  try {
    const request = await getRequestById(id);
    if (!request) {
      res.status(404).json({ ok: false, error: 'Request no encontrado' });
      return;
    }
    if (request.estado !== 'OPEN' && request.estado !== 'NEGOTIATING') {
      res.status(400).json({ ok: false, error: `No se puede cancelar un request en estado ${request.estado}` });
      return;
    }

    await updateRequestEstado(id, 'CANCELLED');
    await emitEvent({
      type: 'RequestCancelled',
      actor_id,
      actor_tipo: 'HUMAN',
      request_id: id,
      payload: { request_id: id, estado_anterior: request.estado },
    });

    res.json({ ok: true, mensaje: 'Solicitud cancelada' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Error interno' });
  }
}

/**
 * GET /requests/:id/resumen-agente
 * Resumen del agente del solicitante: ofertas filtradas por mandato.
 */
export async function resumenAgente(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { agente_id } = req.query;

  if (!agente_id) {
    res.status(400).json({ ok: false, error: 'agente_id es obligatorio' });
    return;
  }

  try {
    const request = await getRequestById(id);
    if (!request) {
      res.status(404).json({ ok: false, error: 'Request no encontrado' });
      return;
    }

    const { mandato, ofertas } = await evaluarOfertaContraMandato(
      agente_id as string,
      id
    );
    const resumen = generarResumenUsuario(ofertas);

    res.json({
      ok: true,
      request_id: id,
      estado: request.estado,
      mandato,
      resumen,
      ofertas_detalle: ofertas,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Error interno' });
  }
}

/**
 * GET /reputacion/:agenteId
 * Reputación básica off-chain de un agente calculada desde eventos.
 */
export async function obtenerReputacion(req: Request, res: Response): Promise<void> {
  const { agenteId } = req.params;

  if (!agenteId) {
    res.status(400).json({ ok: false, error: 'agenteId es obligatorio' });
    return;
  }

  try {
    const reputacion = await calcularReputacionAgente(agenteId);
    res.json({ ok: true, reputacion });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Error interno' });
  }
}
