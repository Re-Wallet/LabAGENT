import { Router } from 'express';
import {
  crearRequest,
  listarRequests,
  verRequest,
  enviarMensaje,
  aceptarOferta,
  cancelarRequest,
  resumenAgente,
} from '../controllers/requests.controller';

const router = Router();

// POST /requests — crear solicitud (texto libre o estructura)
router.post('/', crearRequest);

// GET /requests — listar tablero
router.get('/', listarRequests);

// GET /requests/:id — ver solicitud + sala
router.get('/:id', verRequest);

// POST /requests/:id/messages — enviar mensaje u oferta
router.post('/:id/messages', enviarMensaje);

// POST /requests/:id/offers/:offerId/accept — aceptar oferta → Deal PENDING_ESCROW
router.post('/:id/offers/:offerId/accept', aceptarOferta);

// POST /requests/:id/cancel — cancelar solicitud
router.post('/:id/cancel', cancelarRequest);

// GET /requests/:id/resumen-agente — resumen del agente del solicitante
router.get('/:id/resumen-agente', resumenAgente);

export default router;
