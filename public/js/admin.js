/*
 * Administración del centro (solo en Firebase y con el modo Admin activado).
 *
 * Un menú lateral con seis secciones. Cada sección es una función que pinta su panel:
 *   Centro      nombre y logo
 *   Mensajes    aviso para los profesores y mensaje para los alumnos
 *   Profesores  lista, aprobar, bloquear y nombrar administradores
 *   Acceso      dominios permitidos y aprobación de registros
 *   Exámenes    valores por defecto y normas obligatorias
 *   Datos       uso, limpieza de fin de curso y copia de seguridad
 *
 * Todo pasa por api.admin (api-firebase.js) y las reglas de Firestore lo vuelven a comprobar.
 */
import { admin as apiAdmin, profesor as api } from './api.js';
import * as N from './nucleo.js';
import { h, vaciar, notificar, notificarError, confirmar, ocupado, descargar, icono, comprimirImagen } from './comun.js';

const GRUPOS = [
  { titulo: 'Centro', secciones: [
    { id: 'centro', titulo: 'Centro', icono: 'escuela', descripcion: 'El nombre y el logo del instituto, los mismos para todos.', pintar: seccionCentro },
    { id: 'mensajes', titulo: 'Mensajes', icono: 'campana', descripcion: 'Un aviso para todos los profesores y un mensaje en la entrada de los alumnos.', pintar: seccionMensajes },
  ] },
  { titulo: 'Personas', secciones: [
    { id: 'profesores', titulo: 'Profesores', icono: 'usuario', descripcion: 'Quién usa TestGO. Aprueba, bloquea y nombra administradores.', pintar: seccionProfesores },
    { id: 'acceso', titulo: 'Acceso', icono: 'candado', descripcion: 'Qué correos pueden ser profesores y si hay que aprobar las cuentas nuevas.', pintar: seccionAcceso },
  ] },
  { titulo: 'Exámenes', secciones: [
    { id: 'examenes', titulo: 'Exámenes', icono: 'archivo', descripcion: 'Cómo empiezan los exámenes nuevos y qué normas no se pueden desactivar.', pintar: seccionExamenes },
  ] },
  { titulo: 'Mantenimiento', secciones: [
    { id: 'datos', titulo: 'Datos', icono: 'cuadricula', descripcion: 'Uso del centro, limpieza de fin de curso y copia de seguridad.', pintar: seccionDatos },
  ] },
];
const SECCIONES = GRUPOS.flatMap(g => g.secciones);

export async function vistaAdministracion(app, { sub, sesion }) {
  const seccion = SECCIONES.find(s => s.id === sub) || SECCIONES[0];
  document.title = `TestGO · Administración · ${seccion.titulo}`;
  const contenido = h('div', { class: 'admin-contenido' }, h('div', { class: 'tarjeta esqueleto', style: { height: '220px' } }));

  vaciar(app, h('div', { class: 'admin' },
    h('aside', { class: 'admin-menu', 'aria-label': 'Secciones de Administración' },
      h('div', { class: 'admin-menu-titulo' }, 'Administración'),
      GRUPOS.map(g => h('div', { class: 'admin-menu-grupo' },
        h('div', { class: 'admin-menu-etiqueta' }, g.titulo),
        g.secciones.map(s => h('a', { class: 'admin-menu-enlace' + (s === seccion ? ' activo' : ''), href: `#/admin/${s.id}`, 'aria-current': s === seccion ? 'page' : null },
          icono(s.icono), s.titulo)))),
    ),
    h('div', { class: 'admin-panel' },
      h('header', { class: 'admin-cabecera' }, h('h1', {}, seccion.titulo), h('p', {}, seccion.descripcion)),
      contenido,
    ),
  ));

  try {
    const ajustes = await apiAdmin.leerAjustes();
    await seccion.pintar(contenido, { ajustes, sesion });
  } catch (e) {
    vaciar(contenido, h('div', { class: 'aviso peligro' }, e.message));
  }
}

// ---------- Piezas comunes ----------

// Un bloque con título, descripción y sus filas de ajustes
const grupo = (titulo, descripcion, ...hijos) => h('section', { class: 'ajuste-grupo' },
  h('div', { class: 'ajuste-grupo-cabecera' }, h('h2', {}, titulo), descripcion ? h('p', {}, descripcion) : null),
  h('div', { class: 'ajuste-grupo-cuerpo' }, hijos));

// Una fila: etiqueta y ayuda a la izquierda, el control a la derecha
const fila = (etiqueta, ayuda, control, apilada = false) => h('div', { class: 'ajuste-fila' + (apilada ? ' apilada' : '') },
  h('div', { class: 'ajuste-fila-texto' }, h('b', {}, etiqueta), ayuda ? h('small', {}, ayuda) : null),
  h('div', { class: 'ajuste-fila-control' }, control));

const interruptor = (activo, alCambiar, etiqueta) => h('input', {
  type: 'checkbox', role: 'switch', class: 'interruptor', checked: !!activo, 'aria-label': etiqueta, onchange: e => alCambiar(e.target.checked),
});

const selector = (opciones, valor, alCambiar, etiqueta) => {
  const s = h('select', { 'aria-label': etiqueta, onchange: e => alCambiar(e.target.value) }, opciones.map(([v, t]) => h('option', { value: String(v) }, t)));
  s.value = String(valor);
  return s;
};

const pieGuardar = (accion, texto = 'Guardar cambios') => h('div', { class: 'ajuste-pie' },
  h('button', { class: 'boton acento', onclick: e => ocupado(e.currentTarget, accion) }, texto));

const inicial = correo => (String(correo || '?').trim()[0] || '?').toUpperCase();
const fecha = ms => (ms ? new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// «hace 5 min», «hace 3 días»… y la fecha cuando ya hace más de un mes
function haceCuanto(ms) {
  if (!ms) return '—';
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 2) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias < 31 ? `hace ${dias} ${dias === 1 ? 'día' : 'días'}` : fecha(ms);
}

// El aviso tal como lo ven los profesores en Inicio (también se usa en profesor.js)
export function bannerAviso(aviso, alCerrar) {
  const iconos = { info: 'campana', aviso: 'aviso', urgente: 'aviso' };
  return h('div', { class: `banner-aviso ${aviso.tipo}`, role: 'status' },
    icono(iconos[aviso.tipo] || 'campana'),
    h('p', {}, aviso.texto),
    alCerrar ? h('button', { class: 'boton fantasma mini solo-icono', title: 'Ocultar', 'aria-label': 'Ocultar aviso', onclick: alCerrar }, icono('x')) : null,
  );
}

// ---------- Centro ----------

function seccionCentro(contenido, { ajustes }) {
  const centro = { ...ajustes.centro };
  const nombre = h('input', { type: 'text', maxlength: 150, value: centro.nombre, placeholder: 'IES Ejemplo', 'aria-label': 'Nombre del centro' });
  const vista = h('div', { class: 'vista-centro' });
  const zonaLogo = h('div', { class: 'fila' });

  const pintar = () => {
    vaciar(vista,
      centro.logo ? h('img', { src: api.urlImagen(centro.logo), alt: '' }) : h('span', { class: 'sin-logo' }, icono('escuela')),
      h('span', {}, nombre.value || 'Nombre del centro'));
    const entrada = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
      const archivo = e.target.files[0];
      if (!archivo) return;
      await ocupado(null, async () => {
        centro.logo = await api.subirImagen(await comprimirImagen(archivo, 600));
      });
      pintar();
    } });
    vaciar(zonaLogo, entrada,
      h('button', { class: 'boton mini', type: 'button', onclick: () => entrada.click() }, icono('imagen'), centro.logo ? 'Cambiar logo' : 'Subir logo'),
      centro.logo ? h('button', { class: 'boton fantasma mini peligro', type: 'button', onclick: () => ((centro.logo = null), pintar()) }, 'Quitar') : null);
  };
  nombre.addEventListener('input', pintar);
  pintar();

  vaciar(contenido,
    grupo('Nombre y logo', 'Salen en la entrada de los alumnos, en sus exámenes y en los PDF de todos los profesores.',
      fila('Nombre del centro', null, nombre),
      fila('Logo', 'Mejor en PNG, con fondo transparente o blanco.', zonaLogo),
      fila('Así lo verán los alumnos', null, vista, true),
    ),
    pieGuardar(async () => {
      const r = await apiAdmin.guardarCentro({ nombre: nombre.value, logo: centro.logo });
      Object.assign(ajustes.centro, r);
      notificar('Centro guardado');
    }),
  );
}

// ---------- Mensajes ----------

function seccionMensajes(contenido, { ajustes }) {
  const aviso = { ...ajustes.aviso };
  const texto = h('textarea', { rows: 3, maxlength: 500, placeholder: 'Por ejemplo: recordad cerrar los exámenes al acabar la clase.', 'aria-label': 'Texto del aviso' }, aviso.texto);
  const vistaAviso = h('div', { class: 'vista-previa' });
  const pintarAviso = () => vaciar(vistaAviso, aviso.texto.trim()
    ? bannerAviso({ ...aviso, texto: aviso.texto })
    : h('p', { class: 'suave pequeno' }, 'Escribe un aviso para ver cómo queda.'));
  texto.addEventListener('input', () => ((aviso.texto = texto.value), pintarAviso()));
  pintarAviso();

  const mensaje = h('textarea', { rows: 2, maxlength: 300, placeholder: 'Por ejemplo: apaga el móvil y déjalo en la mochila antes de empezar.', 'aria-label': 'Mensaje para los alumnos' }, ajustes.centro.mensajeAlumnos || '');
  const cuenta = h('small', { class: 'contador' });
  const contar = () => (cuenta.textContent = `${mensaje.value.length} / 300`);
  mensaje.addEventListener('input', contar);
  contar();

  vaciar(contenido,
    grupo('Aviso para los profesores', 'Sale arriba en el Inicio de todos los profesores hasta que lo desactives. Cada profesor puede ocultarlo.',
      fila('Mostrar el aviso', null, interruptor(aviso.activo, v => (aviso.activo = v), 'Mostrar el aviso')),
      fila('Tipo', null, selector([['info', 'Información'], ['aviso', 'Aviso'], ['urgente', 'Urgente']], aviso.tipo, v => ((aviso.tipo = v), pintarAviso()), 'Tipo de aviso')),
      fila('Texto', null, texto, true),
      fila('Así lo verán', null, vistaAviso, true),
    ),
    pieGuardar(async () => {
      Object.assign(ajustes.aviso, await apiAdmin.guardarAviso(aviso));
      notificar(ajustes.aviso.activo ? 'Aviso publicado' : 'Aviso guardado (desactivado)');
    }, 'Guardar aviso'),

    grupo('Mensaje para los alumnos', 'Sale en la pantalla de entrada, debajo del nombre del centro. Déjalo vacío para no mostrar nada.',
      fila('Mensaje', null, h('div', { class: 'pila', style: { gap: '4px' } }, mensaje, cuenta), true),
    ),
    pieGuardar(async () => {
      Object.assign(ajustes.centro, await apiAdmin.guardarCentro({ mensajeAlumnos: mensaje.value }));
      notificar('Mensaje para los alumnos guardado');
    }, 'Guardar mensaje'),
  );
}

// ---------- Profesores ----------

async function seccionProfesores(contenido, { ajustes, sesion }) {
  let lista = await apiAdmin.profesores();
  const filtro = { estado: 'todos', texto: '' };
  const pestanas = h('div', { class: 'pestanas-tabla', role: 'tablist', 'aria-label': 'Filtrar profesores' });
  const buscador = h('label', { class: 'buscador-tabla' }, icono('lupa'),
    h('input', { type: 'search', placeholder: 'Buscar', 'aria-label': 'Buscar profesor', oninput: e => ((filtro.texto = e.target.value.toLowerCase()), pintar()) }));
  const tabla = h('div', { class: 'tabla-examenes', role: 'table', 'aria-label': 'Profesores' });
  const avisoPendientes = h('div');
  const yo = String(sesion.email || '').toLowerCase();

  const ETIQUETA_ESTADO = { activo: ['verde', 'Activo'], pendiente: ['amarilla', 'Pendiente'], bloqueado: ['roja', 'Bloqueado'] };
  const ETIQUETA_ROL = { principal: 'Admin principal', admin: 'Administrador', profesor: 'Profesor' };

  async function recargar() {
    lista = await apiAdmin.profesores();
    pintar();
  }

  // Bloquear a un administrador también le quita el rol (si no, seguiría entrando como administrador)
  const acciones = p => {
    if (p.rol === 'principal' || p.email === yo) return [];
    const r = [];
    if (p.estado === 'pendiente') r.push(['check', 'Aprobar', () => apiAdmin.cambiarEstado(p.uid, 'activo'), 'Profesor aprobado']);
    if (p.estado !== 'bloqueado') {
      r.push(['candado', p.estado === 'pendiente' ? 'Rechazar' : 'Bloquear', async () => {
        if (!(await confirmar(`¿Bloquear a ${p.email}?`, 'No podrá entrar al panel ni crear exámenes. Sus exámenes no se borran y puedes desbloquearlo cuando quieras.', 'Bloquear', 'peligro'))) return false;
        if (p.rol === 'admin') await apiAdmin.cambiarAdmin(p.email, false);
        await apiAdmin.cambiarEstado(p.uid, 'bloqueado');
      }, 'Profesor bloqueado', true]);
    } else {
      r.push(['check', 'Desbloquear', () => apiAdmin.cambiarEstado(p.uid, 'activo'), 'Profesor desbloqueado']);
    }
    if (p.estado === 'activo') {
      r.push(p.rol === 'admin'
        ? ['usuario', 'Quitar administrador', () => apiAdmin.cambiarAdmin(p.email, false), 'Ya no es administrador']
        : ['usuario', 'Hacer administrador', async () => {
          if (!(await confirmar(`¿Hacer administrador a ${p.email}?`, 'Podrá cambiar todos los ajustes del centro, bloquear profesores y borrar exámenes antiguos.', 'Hacer administrador'))) return false;
          await apiAdmin.cambiarAdmin(p.email, true);
        }, 'Ahora es administrador']);
    }
    return r;
  };

  const filaProfesor = p => {
    const opciones = acciones(p);
    const menu = opciones.length ? h('details', { class: 'menu menu-auto menu-fila' },
      h('summary', { class: 'boton fantasma mini solo-icono', title: 'Acciones', 'aria-label': `Acciones para ${p.email}` }, icono('puntos')),
      h('div', { class: 'menu-lista' }, opciones.map(([ic, texto, accion, ok, peligro]) => h('button', {
        type: 'button', class: peligro ? 'peligro' : '',
        onclick: async () => {
          menu.open = false;
          try {
            if ((await accion()) === false) return;
            notificar(ok);
          } catch (e) {
            notificarError(e);
          }
          await recargar().catch(notificarError);
        },
      }, h('b', {}, icono(ic), texto))))) : h('span', { class: 'suave pequeno', title: p.email === yo ? 'Es tu cuenta' : 'Los administradores principales no se pueden cambiar' }, '—');
    const [claseEstado, textoEstado] = ETIQUETA_ESTADO[p.estado];
    return h('div', { class: 'fila-examen fila-profesor', role: 'row' },
      h('span', { class: 'celda-nombre', role: 'cell' },
        h('span', { class: 'avatar' }, inicial(p.email)),
        h('span', { class: 'celda-titulo' },
          h('b', {}, p.email, p.email === yo ? h('span', { class: 'suave' }, ' · tú') : null),
          h('small', { class: p.rol === 'profesor' ? '' : 'rol-admin' }, ETIQUETA_ROL[p.rol]))),
      h('span', { role: 'cell' }, h('span', { class: 'etiqueta ' + claseEstado }, textoEstado)),
      h('span', { role: 'cell', class: 'celda-dato' }, p.examenes),
      h('span', { role: 'cell', class: 'celda-dato', title: p.ultimoAcceso ? new Date(p.ultimoAcceso).toLocaleString('es-ES') : '' }, haceCuanto(p.ultimoAcceso)),
      h('span', { role: 'cell', class: 'celda-acciones visible' }, menu),
    );
  };

  function pintar() {
    const pendientes = lista.filter(p => p.estado === 'pendiente').length;
    vaciar(avisoPendientes, !ajustes.acceso.aprobarRegistros && !pendientes ? null : h('div', { class: 'aviso amarillo' },
      pendientes === 1 ? '1 profesor espera tu aprobación. ' : pendientes ? `${pendientes} profesores esperan tu aprobación. ` : 'Las cuentas nuevas necesitan tu aprobación. ',
      h('a', { href: '#/admin/acceso' }, 'Cambiar cómo se aprueban las cuentas')));
    const cuenta = e => lista.filter(p => (e === 'admins' ? p.rol !== 'profesor' : p.estado === e)).length;
    const opciones = [['todos', 'Todos', lista.length], ['pendiente', 'Pendientes', cuenta('pendiente')], ['bloqueado', 'Bloqueados', cuenta('bloqueado')], ['admins', 'Administradores', cuenta('admins')]];
    vaciar(pestanas, opciones.map(([v, t, n]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(filtro.estado === v), class: filtro.estado === v ? 'activo' : '',
      onclick: () => ((filtro.estado = v), pintar()),
    }, t, h('span', { class: 'cuenta' }, n))));
    const visibles = lista.filter(p =>
      (filtro.estado === 'todos' || (filtro.estado === 'admins' ? p.rol !== 'profesor' : p.estado === filtro.estado)) &&
      (!filtro.texto || p.email.includes(filtro.texto)));
    vaciar(tabla, visibles.length
      ? [h('div', { class: 'fila-examen fila-profesor cabecera', role: 'row' }, ['Profesor', 'Estado', 'Exámenes', 'Último acceso', ''].map(t => h('span', { role: 'columnheader' }, t))), visibles.map(filaProfesor)]
      : h('div', { class: 'tabla-vacia' }, h('p', {}, filtro.estado === 'pendiente' ? 'No hay ningún profesor esperando aprobación.' : 'Ningún profesor coincide.')));
  }
  pintar();

  vaciar(contenido,
    avisoPendientes,
    h('div', { class: 'barra-tabla' }, pestanas, h('span', { class: 'espacio' }), buscador),
    tabla,
    h('p', { class: 'nota-pie' }, 'Cada profesor aparece aquí la primera vez que entra al panel. Los administradores principales están fijos en el código y no se pueden cambiar desde aquí.'),
  );
}

// ---------- Acceso ----------

function seccionAcceso(contenido, { ajustes }) {
  const datos = { dominios: [...ajustes.acceso.dominios], aprobarRegistros: ajustes.acceso.aprobarRegistros };
  const chips = h('div', { class: 'chips-dominio' });
  const nuevo = h('input', { type: 'text', placeholder: 'ejemplo.es', 'aria-label': 'Dominio nuevo', onkeydown: e => e.key === 'Enter' && (e.preventDefault(), anadir()) });

  function anadir() {
    const d = nuevo.value.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return notificar('Escribe un dominio como edu.gva.es', 'error');
    if (!datos.dominios.includes(d)) datos.dominios.push(d);
    nuevo.value = '';
    pintar();
  }

  function pintar() {
    vaciar(chips, datos.dominios.map(d => h('span', { class: 'chip-dominio' }, '@' + d,
      datos.dominios.length > 1 ? h('button', { type: 'button', title: 'Quitar', 'aria-label': `Quitar @${d}`, onclick: () => ((datos.dominios = datos.dominios.filter(x => x !== d)), pintar()) }, icono('x')) : null)));
  }
  pintar();

  vaciar(contenido,
    grupo('Dominios permitidos', 'Solo las cuentas de estos dominios pueden crear su cuenta de profesor y entrar. Los administradores entran siempre.',
      fila('Dominios', null, chips, true),
      fila('Añadir un dominio', null, h('div', { class: 'fila' }, nuevo, h('button', { class: 'boton mini', type: 'button', onclick: anadir }, icono('mas'), 'Añadir'))),
    ),
    grupo('Cuentas nuevas', null,
      fila('Aprobar a los profesores nuevos', 'Las cuentas nuevas esperan a que un administrador las apruebe en Profesores antes de poder usar TestGO. Las que ya existen no cambian.',
        interruptor(datos.aprobarRegistros, v => (datos.aprobarRegistros = v), 'Aprobar a los profesores nuevos')),
    ),
    pieGuardar(async () => {
      Object.assign(ajustes.acceso, await apiAdmin.guardarAcceso(datos));
      notificar('Acceso guardado');
    }),
    grupo('Administradores principales', 'Están fijos en el código (config.js y firestore.rules) para que nadie pueda quedarse sin acceso. Al resto los nombras en Profesores.',
      apiAdmin.principales.map(c => fila(c, null, h('span', { class: 'etiqueta azul' }, 'Admin principal'))),
      ajustes.admins.length ? fila('Otros administradores', ajustes.admins.join(', '), h('a', { class: 'boton mini', href: '#/admin/profesores' }, 'Ver en Profesores')) : null,
    ),
  );
}

// ---------- Exámenes ----------

const PENALIZACIONES = [['0', 'No restan'], ['0.25', 'Restan 1/4'], ['0.3333', 'Restan 1/3'], ['0.5', 'Restan 1/2'], ['1', 'Restan la pregunta entera']];

function seccionExamenes(contenido, { ajustes }) {
  const d = { modo: '', duracion: 60, penalizacion: 0, ...ajustes.examenes.defectos };
  const n = { marcaAgua: false, barajar: false, ocultarNota: false, salidasMaximas: 0, bloquearCopiarPegar: false, ...ajustes.examenes.normas };
  const penalizacion = String(PENALIZACIONES.find(([v]) => Math.abs(Number(v) - Number(d.penalizacion)) < 0.001)?.[0] ?? '0');

  vaciar(contenido,
    grupo('Valores por defecto', 'Con lo que empieza cada examen nuevo. El profesor puede cambiarlos después (salvo lo que fijen las normas).',
      fila('Tipo de examen', 'Pone por ti los ajustes de control del tipo elegido.',
        selector([['', 'Sin elegir'], ...Object.entries(N.MODOS).filter(([k]) => k !== 'personalizado').map(([k, m]) => [k, m.nombre])], d.modo || '', v => (d.modo = v), 'Tipo de examen')),
      fila('Duración', 'En minutos.', h('input', { type: 'number', min: 1, max: 600, value: d.duracion, class: 'campo-corto', 'aria-label': 'Duración en minutos', oninput: e => (d.duracion = Number(e.target.value)) })),
      fila('Respuestas incorrectas en test', 'Lo que resta cada fallo.', selector(PENALIZACIONES, penalizacion, v => (d.penalizacion = Number(v)), 'Penalización')),
    ),
    grupo('Normas obligatorias', 'Se aplican a todos los exámenes, también a los que ya existen cuando se vuelvan a guardar. El servidor lo comprueba: no se pueden saltar.',
      fila(N.NORMAS.marcaAgua, 'El nombre del alumno y la fecha de fondo en todo el examen.', interruptor(n.marcaAgua, v => (n.marcaAgua = v), N.NORMAS.marcaAgua)),
      fila(N.NORMAS.barajar, 'Cada alumno ve las preguntas y las opciones en otro orden.', interruptor(n.barajar, v => (n.barajar = v), N.NORMAS.barajar)),
      fila(N.NORMAS.ocultarNota, 'El alumno no ve su nota al entregar; el profesor la comunica después.', interruptor(n.ocultarNota, v => (n.ocultarNota = v), N.NORMAS.ocultarNota)),
      fila('Bloqueo por salir de la pantalla', 'El máximo de salidas que un profesor puede permitir antes de bloquear el examen.',
        selector([[0, 'Lo decide cada profesor'], [1, 'A la primera salida'], [2, 'Como mucho 2 salidas'], [3, 'Como mucho 3 salidas'], [5, 'Como mucho 5 salidas']], n.salidasMaximas, v => (n.salidasMaximas = Number(v)), 'Bloqueo por salir')),
      fila('Bloquear copiar y pegar', 'Los alumnos no pueden copiar, cortar, pegar ni arrastrar texto, y el profesor ve cada intento en directo. Vale para todos los exámenes en cuanto se guarda: el alumno lo recibe al entrar o al recargar el examen.',
        interruptor(n.bloquearCopiarPegar, v => (n.bloquearCopiarPegar = v), 'Bloquear copiar y pegar')),
    ),
    pieGuardar(async () => {
      Object.assign(ajustes.examenes, await apiAdmin.guardarExamenes({ defectos: d, normas: n }));
      notificar('Ajustes de exámenes guardados');
    }),
  );
}

// ---------- Datos ----------

async function seccionDatos(contenido) {
  const uso = h('div', { class: 'tiles-uso' }, [1, 2, 3, 4].map(() => h('div', { class: 'tile-uso esqueleto' })));
  const resultadoLimpieza = h('div', { class: 'resultado-limpieza' });
  let meses = 12;

  vaciar(contenido,
    grupo('Uso del centro', null, uso),
    grupo('Limpieza de fin de curso', 'Borra los exámenes cerrados más antiguos con las respuestas de sus alumnos. El plan gratuito de Firebase tiene un límite de espacio. Descarga antes una copia de seguridad.',
      fila('Exámenes creados hace más de', null, h('div', { class: 'fila' },
        selector([[6, '6 meses'], [12, '1 año'], [24, '2 años']], meses, v => (meses = Number(v)), 'Antigüedad'),
        h('button', { class: 'boton mini', type: 'button', onclick: e => ocupado(e.currentTarget, buscarAntiguos) }, icono('lupa'), 'Buscar'))),
      resultadoLimpieza,
    ),
    grupo('Copia de seguridad', 'Un archivo con los ajustes, los profesores, todos los exámenes y las respuestas de los alumnos.',
      fila('Descargar copia', 'Formato JSON. Guárdalo en un sitio seguro: contiene datos de los alumnos.',
        h('button', { class: 'boton mini', type: 'button', onclick: e => ocupado(e.currentTarget, descargarCopia) }, icono('bajar'), 'Descargar')),
    ),
  );

  async function buscarAntiguos() {
    const lista = await apiAdmin.examenesAntiguos(meses);
    if (!lista.length) return vaciar(resultadoLimpieza, h('p', { class: 'suave pequeno' }, 'No hay exámenes cerrados tan antiguos.'));
    vaciar(resultadoLimpieza,
      h('div', { class: 'aviso amarillo' },
        h('b', {}, `${lista.length} ${lista.length === 1 ? 'examen' : 'exámenes'} para borrar`),
        h('ul', {}, lista.slice(0, 5).map(e => h('li', {}, `${e.titulo} · ${fecha(e.creado)}${e.propietarioEmail ? ` · ${e.propietarioEmail}` : ''}`)), lista.length > 5 ? h('li', {}, `y ${lista.length - 5} más`) : null),
      ),
      h('button', { class: 'boton peligro', type: 'button', onclick: async e => {
        if (!(await confirmar(`¿Borrar ${lista.length} ${lista.length === 1 ? 'examen' : 'exámenes'}?`, 'Se borrarán con todas las respuestas de sus alumnos. No se puede deshacer.', 'Borrar', 'peligro'))) return;
        const boton = e.currentTarget;
        const hecho = await ocupado(boton, async () => {
          await apiAdmin.borrarExamenes(lista.map(x => x.id), (i, total) => (boton.lastChild.textContent = ` Borrando ${i} de ${total}…`));
          return true;
        });
        if (!hecho) return buscarAntiguos();
        notificar('Exámenes borrados');
        vaciar(resultadoLimpieza);
        pintarUso();
      } }, icono('papelera'), ` Borrar ${lista.length} ${lista.length === 1 ? 'examen' : 'exámenes'}`),
    );
  }

  async function descargarCopia() {
    const copia = await apiAdmin.copia();
    descargar(`testgo-copia-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(copia, null, 2), 'application/json');
    notificar(`Copia descargada: ${copia.examenes.length} exámenes`);
  }

  async function pintarUso() {
    try {
      const u = await apiAdmin.uso();
      const tile = (valor, texto, extra) => h('div', { class: 'tile-uso' }, h('b', {}, N.numero(valor)), h('span', {}, texto), extra ? h('small', {}, extra) : null);
      vaciar(uso,
        tile(u.profesores, 'Profesores', u.pendientes ? `${u.pendientes} ${u.pendientes === 1 ? 'pendiente' : 'pendientes'} de aprobar` : null),
        tile(u.examenes, 'Exámenes'),
        tile(u.abiertos, 'Abiertos ahora'),
        tile(u.intentos, 'Exámenes hechos por alumnos'));
    } catch (e) {
      vaciar(uso, h('div', { class: 'aviso peligro' }, e.message));
    }
  }
  pintarUso();
}
