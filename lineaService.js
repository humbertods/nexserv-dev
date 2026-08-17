// ============================================================
// lineaService.js — NEXSERV · FASE 1: Capa de Abstracción LINEAS
// Depende de: api.js  (apiGet, apiPost disponibles en window global)
// Cargarse ANTES de nexserv-main-1.js…4.js en index.html
// ============================================================
// ARQUITECTURA:
//   LINEAS = motor transaccional (fuente única de verdad)
//   Este archivo expone el objeto global LineaService con métodos
//   que mapean cada operación al endpoint correcto del backend.
//   Las hojas legacy (TicketMulti / ServicioPromo / ServicioNormal)
//   siguen siendo escritas por el backend mientras dure la migración,
//   pero el frontend NO debe llamarlas directamente — solo aquí.
// ============================================================

(function(window) {
  'use strict';

  // ─── helpers internos ────────────────────────────────────────
  function _idPrefix(id) {
    var s = String(id || '');
    if (s.startsWith('TM-')) return 'TM';
    if (s.startsWith('SP-')) return 'SP';
    if (s.startsWith('SN-')) return 'SN';
    if (s.startsWith('LE-')) return 'LE';
    return '';
  }

  // ─── LineaService ─────────────────────────────────────────────
  var LineaService = {

    // ----------------------------------------------------------
    // clasificarTicket(ticket)
    // Clasificación pura (sin red). Devuelve { esMulti, tienePromo, tipo }
    // ----------------------------------------------------------
    clasificarTicket: function(ticket) {
      var id     = String(ticket && (ticket.idEspera || ticket.id) || '');
      var fuente = String(ticket && ticket.fuente || '');
      var tipo   = _idPrefix(id) || fuente.replace('Servicio','') || 'SN';
      var esMulti   = tipo === 'TM' || (ticket && Array.isArray(ticket.areas) && ticket.areas.length > 1);
      var tienePromo = tipo === 'SP' || (ticket && !!ticket.promoNombre);
      return { esMulti: esMulti, tienePromo: tienePromo, tipo: tipo };
    },

    // ----------------------------------------------------------
    // etiquetaFuente({ fuente, idEspera })
    // Devuelve etiqueta legible de la fuente del ticket.
    // ----------------------------------------------------------
    etiquetaFuente: function(opts) {
      var f = String(opts && opts.fuente || '');
      var id = String(opts && opts.idEspera || '');
      if (f === 'TicketMulti' || id.startsWith('TM-'))  return 'Multi';
      if (f === 'ServicioPromo' || id.startsWith('SP-')) return 'Promo';
      if (f === 'ServicioNormal' || id.startsWith('SN-')) return 'Normal';
      if (id.startsWith('LE-')) return 'Lista';
      return f || 'Normal';
    },

    // ----------------------------------------------------------
    // obtenerListaEspera()
    // Devuelve: Promise → array de tickets en espera
    // Endpoint: getTableroLineas (LINEAS). SIN fallback a getListaEspera
    // (legacy) — Bloque de protección de fuente: mezclar respuestas
    // LINEAS + legacy ante una falla de LINEAS es exactamente el riesgo que
    // este cambio elimina. success=false, excepción o red → la promesa se
    // rechaza y el caller decide (hoy: refrescarAsignacionesStaff/loadStaffHome
    // ya hacen .catch(function(){ return []; }) — ante fallo, "Por empezar"
    // queda vacío en vez de mostrarse desde legacy).
    // ----------------------------------------------------------
    obtenerListaEspera: function() {
      return apiGet('getTableroLineas')
        .then(function(r) {
          if (!r || r.success !== true) {
            throw new Error('[LineaService.obtenerListaEspera] getTableroLineas no exitoso: ' +
              ((r && (r.error || r.message)) || 'sin detalle'));
          }
          // FIX nombres de campo: getTableroLineas devuelve { cola, en_servicio,
          // completado, cobrado } — NO { esperando, enServicio, porCobrar }. Antes
          // se leían los nombres equivocados → la lista volvía SIEMPRE vacía.
          var lista = [].concat(
            r.cola          || r.esperando  || [],
            r.en_servicio   || r.enServicio || [],
            r.por_verificar || [],   // staff finalizó, espera que Mikaela mande a cobro
            r.completado    || r.porCobrar  || []
          );
          return lista;
        });
    },

    // ----------------------------------------------------------
    // obtenerServiciosHoy(chicaNombre)
    // Devuelve: Promise → array de servicios completados hoy por la chica
    // Endpoint: getServiciosHoy (LINEAS-backed en backend)
    // ----------------------------------------------------------
    obtenerServiciosHoy: function(chicaNombre) {
      return apiGet('getServiciosHoy', { chica: chicaNombre || '' })
        .then(function(r) {
          return (r && r.success && r.servicios) ? r.servicios : [];
        })
        .catch(function() { return []; });
    },

    // ----------------------------------------------------------
    // crearServicio(payload)
    // payload para 1 área normal:  { codigo, nombre, servicio, area, prioridad, observaciones, esTop, total, [asignadaA] }
    // payload para 1 área promo:   + { promoNombre, precioPromo, precioRegular }
    // payload para multi (2+ áreas): { codigo, nombre, prioridad, observaciones, areas:[{area,tipo,tentativo,precio,...}], secuencia:[...], [asignadaA] }
    // Devuelve: Promise → { success, id, ... }
    // ----------------------------------------------------------
    // AM-1P — el payload puede transportar opcionalmente el contexto de
    // ESTANCIA (`baseTicketRef` y/o `visita`). Se envía tal cual: no se
    // inventa, no se completa, no se vuelve obligatorio. Una creación inicial
    // sigue funcionando sin ellos (callers existentes intactos). El backend es
    // la autoridad: valida `visita` contra las líneas del `baseTicketRef` y
    // falla cerrado ante mismatch — el frontend solo aporta contexto.
    crearServicio: function(payload) {
      var esMulti = payload && Array.isArray(payload.areas) && payload.areas.length > 1;
      var esPromo = !esMulti && !!(payload && payload.promoNombre);

      if (esMulti) {
        return apiPost('crearTicketMulti', payload);
      } else if (esPromo) {
        return apiPost('addServicioPromo', payload);
      } else {
        return apiPost('addServicioNormal', payload);
      }
    },

    // ----------------------------------------------------------
    // tomarAreaTicket({ idEspera, chicaNombre, chicaArea, areaIdx })
    // Devuelve: Promise → { success, ... }
    // ----------------------------------------------------------
    tomarAreaTicket: function(opts) {
      var tipo = _idPrefix(opts && opts.idEspera || '');
      if (tipo === 'TM') {
        return apiPost('tomarAreaTicketMulti', opts);
      } else if (tipo === 'SP') {
        return apiPost('tomarServicioPromo', opts);
      } else {
        // SN, LE o sin prefijo → flujo normal
        return apiPost('tomarServicioNormal', opts);
      }
    },

    // ----------------------------------------------------------
    // finalizarServicio({ idEspera, chicaNombre, clienteNombre, servicio,
    //                     total, promoNombre, precioPromo, precioRegular,
    //                     serviciosDetalle })
    // Devuelve: Promise → { success, ... }
    // ----------------------------------------------------------
    finalizarServicio: function(opts) {
      var tipo = _idPrefix(opts && opts.idEspera || '');
      if (tipo === 'SP') {
        return apiPost('finalizarServicioPromo', opts);
      } else {
        // SN, LE, TM (area única) → flujo normal
        return apiPost('finalizarServicioNormal', opts);
      }
    },

    // ----------------------------------------------------------
    // completarAreaTicket({ idEspera, chicaNombre, [esUltima], [absorberPendientes], [desgloseCompleto] })
    // Solo para TM. Devuelve: Promise → { success, ... }
    // ----------------------------------------------------------
    completarAreaTicket: function(opts) {
      return apiPost('completarAreaTicketMulti', opts);
    },

    // ----------------------------------------------------------
    // obtenerGrupoTicket(idEspera)
    // Devuelve: Promise → objeto TM con sus áreas, o null
    // ----------------------------------------------------------
    obtenerGrupoTicket: function(idEspera) {
      return apiGet('getTicketMulti', { idEspera: idEspera || '' })
        .then(function(r) {
          if (!r || !r.success) return null;
          // El backend devuelve { activos:[], porCobrar:[], porVerificar:[] }
          // r.ticket y r.data no existen — buscar en activos por idEspera
          var id = String(idEspera || '').trim();
          var todos = [].concat(r.activos || [], r.porCobrar || [], r.porVerificar || []);
          if (id) {
            var match = todos.find(function(t){ return String(t.idEspera||'').trim() === id; });
            if (match) return match;
          }
          return todos[0] || null;
        })
        .catch(function() { return null; });
    },

    // ----------------------------------------------------------
    // obtenerPorCobrarSP(idEspera)
    // Devuelve: Promise → { success, enServicio:[], porCobrar:[] }
    // Toggle emergency: localStorage NEXSERV_LINEAS_PC !== '0'
    // ----------------------------------------------------------
    obtenerPorCobrarSP: function(idEspera) {
      var usarLineas = localStorage.getItem('NEXSERV_LINEAS_PC') !== '0';
      var endpoint   = usarLineas ? 'getPorCobrarDesdeLineas' : 'getPorCobrar';
      return apiGet(endpoint, { idEspera: idEspera || '' })
        .then(function(r) {
          if (!r || !r.success) return { success: false, enServicio: [], porCobrar: [] };
          return r;
        })
        .catch(function() { return { success: false, enServicio: [], porCobrar: [] }; });
    },

    // ----------------------------------------------------------
    // finalizarComponentes({ ticketRef, staff, lineaIds })
    // Bloque 2 — Promo parcial LINEAS. Finaliza únicamente los lineaIds
    // indicados (deben pertenecer a ticketRef y estar asignados a staff).
    // Devuelve: Promise → { success, ticket_ref, completadas, errores }
    // ----------------------------------------------------------
    finalizarComponentes: function (opts) {
      return apiPost('finalizarComponentesStaff', opts);
    },

    // ----------------------------------------------------------
    // asignarServicio({ codigo, servicio, area, precio, chica, observaciones })
    // Devuelve: Promise → { success, ... }
    // ----------------------------------------------------------
    asignarServicio: function(opts) {
      return apiPost('asignarServicioNormal', opts);
    },

    // ----------------------------------------------------------
    // asignarYIniciarLinea(ticketRef, lineaId)
    // D7.1 P6-B FASE 3 — "Yo sigo": reclama UNA línea huérfana (esperando,
    // sin staff) del ticket y la pone en_servicio a nombre de quien la pide.
    // Manda SOLO ticketRef + lineaId — NUNCA staff: la identidad la inyecta
    // el backend desde la sesión firmada (ver case 'asignarYIniciarLineaNativa'
    // en NexServ_AppsScript.js). Si el frontend mandara staff igual, el
    // backend lo ignora por completo.
    // Devuelve: Promise → { success, ticket_ref, linea_id, staff, ... }
    // ----------------------------------------------------------
    asignarYIniciarLinea: function(ticketRef, lineaId) {
      return apiPost('asignarYIniciarLineaNativa', { ticketRef: ticketRef, lineaId: lineaId });
    },

    // ----------------------------------------------------------
    // completarActualYContinuar(ticketRef, lineaActualId, lineaSiguienteId)
    // CONTINUAR_MISMA_STAFF — transición ATÓMICA: completa la línea actual
    // (en_servicio, mía) e inicia la siguiente (esperando, sin staff,
    // compatible) en UNA sola transacción backend. Reemplaza al par
    // "finalizar + asignarYIniciar" que dejaba una ventana observable con la
    // actual ya completada y la siguiente todavía esperando.
    // El backend (completarActualYContinuarLineaNativa, NexServ_Lineas.gs)
    // valida todo en una pasada de solo lectura antes de escribir, verifica
    // por relectura y compensa LINEAS+TicketsFuente si algo falla — NO se
    // implementa rollback acá.
    // Manda SOLO los tres ids — NUNCA staff: la identidad la inyecta el
    // backend desde la sesión firmada (ver case 'completarActualYContinuar-
    // LineaNativa' en NexServ_AppsScript.js). Si el frontend mandara staff
    // igual, el backend lo ignora por completo.
    // Devuelve: Promise → { success, ticket_ref, linea_actual, linea_siguiente, ... }
    // ----------------------------------------------------------
    completarActualYContinuar: function(ticketRef, lineaActualId, lineaSiguienteId) {
      return apiPost('completarActualYContinuarLineaNativa', {
        ticketRef: ticketRef,
        lineaActualId: lineaActualId,
        lineaSiguienteId: lineaSiguienteId
      });
    }

  }; // end LineaService

  // Exportar globalmente (igual que las demás funciones del proyecto)
  window.LineaService = LineaService;

})(window);
