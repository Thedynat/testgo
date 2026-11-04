/*
 * Núcleo de TestGO: la lógica que comparten el navegador y el servidor.
 * No usa el DOM ni Node, así se puede importar desde los dos lados.
 */

export const TIPOS = ['test', 'corta', 'desarrollo'];
export const NOMBRE_TIPO = { test: 'Test', corta: 'Respuesta corta', desarrollo: 'Desarrollo' };

// Incidencias que puede enviar el navegador del alumno
export const TIPOS_INCIDENCIA = new Set(['salida', 'regreso', 'copiar', 'pegar', 'menu', 'imprimir']);
// Las que el profesor ve resaltadas en el panel
export const SOSPECHOSAS = new Set(['salida', 'copiar', 'pegar', 'menu', 'imprimir', 'desconexion', 'reentrada']);

export const AJUSTES = {
  titulo: 'Nuevo examen',
  duracion: 60,
  numPreguntas: 0,
  maxSalidas: 3,
  penalizacion: 0,
  barajar: true,
  mostrarNota: false,
};

export class ErrorTestGO extends Error {
  constructor(estado, mensaje, codigo = '') {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

// ---------- Textos y nombres ----------

export const normalizar = texto =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const limpiarNombre = nombre => String(nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

// Clave para que "Laura Martínez" y "laura  martinez" sean el mismo alumno
export const claveNombre = nombre =>
  normalizar(nombre).replace(/[^a-z0-9 ]/g, '').trim().replace(/ /g, '-').slice(0, 80) || 'sin-nombre';

export function comprobarNombre(nombre) {
  if (nombre.length < 3) throw new ErrorTestGO(400, 'Escribe tu nombre y apellidos.');
}

export const limpiarCodigo = codigo => String(codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

export function nuevoId(bytes = 8) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sin 0/O ni 1/I para que no se confundan al dictarlo
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function codigoAleatorio(n = 6) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map(b => LETRAS[b % LETRAS.length]).join('');
}

export function acotar(valor, porDefecto, min, max) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : porDefecto;
}

const redondear = (n, decimales = 2) => Math.round(n * 10 ** decimales) / 10 ** decimales;

// ---------- Exámenes ----------

export function limpiarPregunta(p = {}) {
  const tipo = TIPOS.includes(p.tipo) ? p.tipo : 'test';
  const q = {
    id: typeof p.id === 'string' && /^[a-z0-9]{4,32}$/.test(p.id) ? p.id : nuevoId(),
    tipo,
    enunciado: String(p.enunciado ?? '').slice(0, 5000),
    puntos: redondear(acotar(p.puntos, 1, 0, 100)),
  };
  if (tipo === 'test') {
    q.opciones = (Array.isArray(p.opciones) ? p.opciones : []).slice(0, 10).map(o => String(o ?? '').slice(0, 1000));
    q.correcta = Number.isInteger(p.correcta) && p.correcta >= 0 && p.correcta < q.opciones.length ? p.correcta : null;
    q.fijarOpciones = !!p.fijarOpciones;
  }
  if (tipo === 'corta') {
    q.respuestas = (Array.isArray(p.respuestas) ? p.respuestas : [])
      .map(r => String(r ?? '').trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 20);
  }
  // Apartado de un ejercicio: comparte el enunciado común (contexto) con los demás del mismo grupo
  if (typeof p.grupo === 'string' && /^[a-z0-9]{4,32}$/.test(p.grupo)) {
    q.grupo = p.grupo;
    q.apartado = String(p.apartado ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 3);
    q.contexto = String(p.contexto ?? '').slice(0, 10000);
  }
  return q;
}

// Preguntas sueltas o ejercicios con apartados: cada unidad va junta y en orden
export function unidades(preguntas) {
  const lista = [];
  const porGrupo = new Map();
  for (const p of preguntas) {
    if (!p.grupo) {
      lista.push([p]);
      continue;
    }
    if (!porGrupo.has(p.grupo)) {
      porGrupo.set(p.grupo, []);
      lista.push(porGrupo.get(p.grupo));
    }
    porGrupo.get(p.grupo).push(p);
  }
  return lista;
}

// Número que se enseña de cada pregunta, en el orden dado: "1", "2", "3a", "3b", "4"...
export function etiquetas(preguntas) {
  const salida = [];
  let n = 0;
  let grupoAnterior = null;
  preguntas.forEach((p, i) => {
    if (!p.grupo || p.grupo !== grupoAnterior) n++;
    grupoAnterior = p.grupo || null;
    const enGrupo = p.grupo && (preguntas[i - 1]?.grupo === p.grupo || preguntas[i + 1]?.grupo === p.grupo);
    salida.push(enGrupo ? `${n}${p.apartado || ''}` : String(n));
  });
  return salida;
}

// Número de ejercicios (un ejercicio con apartados cuenta como uno)
export const totalEjercicios = preguntas => unidades(preguntas).length;

// Ajustes y preguntas de un examen, con valores dentro de rango
export function limpiarExamen(datos = {}, previo = {}) {
  const base = { ...AJUSTES, ...previo };
  const si = (clave, f) => (datos[clave] !== undefined ? f(datos[clave]) : base[clave]);
  return {
    titulo: String(datos.titulo ?? base.titulo).trim().slice(0, 200) || 'Examen sin título',
    duracion: Math.round(acotar(datos.duracion, base.duracion, 1, 600)),
    numPreguntas: Math.round(acotar(datos.numPreguntas, base.numPreguntas, 0, 500)),
    maxSalidas: Math.round(acotar(datos.maxSalidas, base.maxSalidas, 0, 50)),
    penalizacion: redondear(acotar(datos.penalizacion, base.penalizacion, 0, 1), 4),
    barajar: si('barajar', Boolean),
    mostrarNota: si('mostrarNota', Boolean),
    preguntas: (Array.isArray(datos.preguntas) ? datos.preguntas : base.preguntas || []).slice(0, 500).map(limpiarPregunta),
  };
}

// Lo que puede ver el alumno: sin respuestas correctas
export const preguntasPublicas = preguntas => preguntas.map(({ correcta, respuestas, ...resto }) => resto);

export const datosPublicos = ex => ({
  titulo: ex.titulo,
  duracion: ex.duracion,
  numPreguntas: ex.numPreguntas,
  maxSalidas: ex.maxSalidas,
  penalizacion: ex.penalizacion,
  barajar: ex.barajar,
  mostrarNota: ex.mostrarNota,
  abierto: !!ex.abierto,
  preguntas: preguntasPublicas(ex.preguntas),
});

export function problemasExamen(ex) {
  const avisos = [];
  if (!ex.preguntas.length) avisos.push('El examen no tiene preguntas.');
  const numeros = etiquetas(ex.preguntas);
  ex.preguntas.forEach((p, i) => {
    const n = `Pregunta ${numeros[i]}`;
    if (!p.enunciado.trim()) avisos.push(`${n}: no tiene enunciado.`);
    if (p.tipo === 'test' && p.opciones.filter(o => o.trim()).length < 2) avisos.push(`${n}: necesita al menos dos opciones.`);
    if (p.tipo === 'test' && p.correcta === null) avisos.push(`${n}: no tiene marcada la respuesta correcta.`);
    if (p.tipo === 'corta' && !p.respuestas.length) avisos.push(`${n}: no tiene respuestas aceptadas (se corregirá a mano).`);
  });
  return avisos;
}

// Con alumnos dentro se pueden corregir textos y soluciones, pero no quitar preguntas u opciones
export function comprobarCambios(previo, nuevo, hayAlumnos) {
  if (!hayAlumnos) return;
  const nuevas = new Map(nuevo.preguntas.map(p => [p.id, p]));
  for (const p of previo.preguntas) {
    const q = nuevas.get(p.id);
    if (!q || q.tipo !== p.tipo || (p.tipo === 'test' && q.opciones.length !== p.opciones.length)) {
      throw new ErrorTestGO(409, 'Ya hay alumnos en este examen: puedes corregir textos y soluciones, pero no quitar preguntas, cambiar su tipo ni el número de opciones.');
    }
  }
}

// ---------- Orden de preguntas (igual en profesor y alumno a partir de una semilla) ----------

function semillaNumerica(texto) {
  let h = 2166136261;
  for (const c of String(texto)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function generador(semilla) {
  let a = semillaNumerica(semilla);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barajarCon(lista, azar) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generarOrden(ex, semilla) {
  const azar = generador(semilla);
  // Se baraja y se eligen ejercicios enteros: los apartados de un ejercicio no se separan
  let grupos = unidades(ex.preguntas);
  if (ex.numPreguntas > 0 && ex.numPreguntas < grupos.length) {
    const elegidos = new Set(barajarCon(grupos, azar).slice(0, ex.numPreguntas));
    grupos = grupos.filter(g => elegidos.has(g));
  }
  if (ex.barajar) grupos = barajarCon(grupos, azar);
  return grupos.flat().map(p => {
    if (p.tipo !== 'test') return { id: p.id, perm: null };
    const indices = p.opciones.map((_, i) => i);
    return { id: p.id, perm: ex.barajar && !p.fijarOpciones ? barajarCon(indices, azar) : indices };
  });
}

// Comprueba que el alumno tiene las preguntas que le tocaban (en Firebase el orden lo calcula su navegador)
export function ordenValido(ex, intento) {
  const esperado = generarOrden(ex, intento.semilla).map(o => o.id).sort().join(',');
  return esperado === (intento.orden || []).map(o => o.id).sort().join(',');
}

// Preguntas tal como las ve el alumno; cada opción conserva su índice original
export function vistaPreguntas(preguntas, orden) {
  const porId = new Map(preguntas.map(p => [p.id, p]));
  return (orden || [])
    .map(o => {
      const p = porId.get(o.id);
      if (!p) return null;
      const v = { id: p.id, tipo: p.tipo, enunciado: p.enunciado, puntos: p.puntos };
      if (p.grupo) Object.assign(v, { grupo: p.grupo, apartado: p.apartado, contexto: p.contexto });
      if (p.tipo === 'test') {
        const perm = (o.perm || p.opciones.map((_, i) => i)).filter(i => i < p.opciones.length);
        v.opciones = perm.map(i => ({ i, texto: p.opciones[i] }));
      }
      return v;
    })
    .filter(Boolean);
}

// ---------- Intentos ----------

export function nuevoIntento({ nombre, semilla, ex, ahora }) {
  return {
    nombre,
    nombreClave: claveNombre(nombre),
    semilla,
    estado: 'en_curso',
    creado: ahora,
    inicio: null,
    duracion: ex.duracion,
    minutosExtra: 0,
    orden: generarOrden(ex, semilla),
    respuestas: {},
    salidas: 0,
    baseSalidas: 0,
    ultimaIncidencia: null,
    ultimaSenal: ahora,
    entregadoEn: null,
    motivoEntrega: null,
    notasManual: {},
  };
}

export const limiteDe = a => (a.inicio ? a.inicio + (a.duracion + (a.minutosExtra || 0)) * 60000 : null);
export const tiempoAgotado = (a, ahora) => a.estado !== 'entregado' && !!a.inicio && ahora >= limiteDe(a);
export const salidasDesde = a => (a.salidas || 0) - (a.baseSalidas || 0);
export const puedeResponder = (a, ahora) => a.estado === 'en_curso' && !!a.inicio && ahora < limiteDe(a) + 30000;

export function limpiarRespuestas(preguntas, orden, respuestas) {
  const porId = new Map(preguntas.map(p => [p.id, p]));
  const permitidas = new Set((orden || []).map(o => o.id));
  const salida = {};
  for (const [id, valor] of Object.entries(respuestas || {})) {
    const p = porId.get(id);
    if (!p || !permitidas.has(id) || valor === null || valor === undefined || valor === '') continue;
    if (p.tipo === 'test') {
      const n = Number(valor);
      if (Number.isInteger(n) && n >= 0 && n < p.opciones.length) salida[id] = n;
    } else {
      salida[id] = String(valor).slice(0, 20000);
    }
  }
  return salida;
}

// Lo que provoca una incidencia del alumno: cambios en el intento y registros nuevos
export function efectoIncidencia(a, maxSalidas, tipo, detalle, ahora) {
  if (a.estado === 'entregado' || !a.inicio) return null;
  const inc = { t: ahora, tipo, detalle: String(detalle || '').slice(0, 300) };
  const cambios = {};
  const registros = [inc];
  if (SOSPECHOSAS.has(tipo)) cambios.ultimaIncidencia = inc;
  if (tipo === 'salida') {
    cambios.salidas = (a.salidas || 0) + 1;
    const tras = { ...a, ...cambios };
    if (a.estado === 'en_curso' && maxSalidas > 0 && salidasDesde(tras) >= maxSalidas) {
      cambios.estado = 'bloqueado';
      cambios.bloqueadoPor = 'automatico';
      registros.push({ t: ahora, tipo: 'bloqueo', detalle: `Bloqueado automáticamente tras ${salidasDesde(tras)} salidas` });
    }
  }
  return { cambios, registros };
}

export const ACCIONES = {
  bloquear: 'Bloquear',
  desbloquear: 'Desbloquear',
  tiempo: 'Cambiar tiempo',
  entregar: 'Recoger examen',
  reabrir: 'Reabrir',
};

// Lo que provoca una acción del profesor. Devuelve null si no cambia nada.
export function efectoAccion(a, accion, datos, ahora) {
  switch (accion) {
    case 'bloquear':
      if (a.estado !== 'en_curso') return null;
      return { cambios: { estado: 'bloqueado', bloqueadoPor: 'profesor' }, registro: ['bloqueo', 'Bloqueado por el profesor'] };
    case 'desbloquear':
      if (a.estado !== 'bloqueado') return null;
      return { cambios: { estado: 'en_curso', bloqueadoPor: null, baseSalidas: a.salidas || 0 }, registro: ['desbloqueo', 'Desbloqueado por el profesor'] };
    case 'tiempo': {
      if (!a.inicio || a.estado === 'entregado') throw new ErrorTestGO(409, 'El alumno no está haciendo el examen.');
      const minutos = Math.round(acotar(datos?.minutos, 5, -600, 600));
      if (!minutos) return null;
      return {
        cambios: { minutosExtra: (a.minutosExtra || 0) + minutos },
        registro: ['tiempo', `El profesor ${minutos > 0 ? 'añadió' : 'quitó'} ${Math.abs(minutos)} min`],
      };
    }
    case 'entregar':
      if (a.estado === 'entregado') return null;
      return {
        cambios: { estado: 'entregado', entregadoEn: ahora, motivoEntrega: 'Recogido por el profesor' },
        registro: ['entrega', 'Recogido por el profesor'],
      };
    case 'reabrir': {
      if (a.estado !== 'entregado') return null;
      // Que le queden al menos 5 minutos
      const limite = limiteDe(a);
      const falta = limite ? Math.max(0, Math.ceil((ahora + 5 * 60000 - limite) / 60000)) : 0;
      return {
        cambios: { estado: 'en_curso', entregadoEn: null, motivoEntrega: null, bloqueadoPor: null, baseSalidas: a.salidas || 0, minutosExtra: (a.minutosExtra || 0) + falta },
        registro: ['aviso', 'El profesor reabrió el examen'],
      };
    }
    default:
      throw new ErrorTestGO(400, 'Acción no válida');
  }
}

// ---------- Corrección ----------

export function corregir(ex, a) {
  const porId = new Map(ex.preguntas.map(p => [p.id, p]));
  const orden = a.orden?.length ? a.orden : ex.preguntas.map(p => ({ id: p.id }));
  const detalle = {};
  let total = 0;
  let max = 0;
  let pendiente = false;
  for (const { id } of orden) {
    const p = porId.get(id);
    if (!p) continue;
    max += p.puntos;
    const r = a.respuestas?.[id];
    const manual = a.notasManual?.[id];
    const vacia = r === undefined || r === null || r === '';
    let puntos = 0;
    let estado;
    if (manual !== undefined && manual !== null) {
      puntos = acotar(manual, 0, -p.puntos, p.puntos);
      estado = 'manual';
    } else if (vacia) {
      estado = 'blanco';
    } else if (p.tipo === 'test') {
      if (p.correcta === null) estado = 'pendiente';
      else if (r === p.correcta) [puntos, estado] = [p.puntos, 'correcta'];
      else [puntos, estado] = [-p.puntos * (ex.penalizacion || 0), 'incorrecta'];
    } else if (p.tipo === 'corta' && p.respuestas.length) {
      const bien = p.respuestas.some(x => normalizar(x) === normalizar(r));
      [puntos, estado] = bien ? [p.puntos, 'correcta'] : [0, 'incorrecta'];
    } else {
      estado = 'pendiente';
    }
    if (estado === 'pendiente') pendiente = true;
    total += puntos;
    detalle[id] = { puntos: redondear(puntos), max: p.puntos, estado };
  }
  total = Math.max(0, redondear(total));
  return { total, max: redondear(max), nota: max ? redondear((total / max) * 10) : 0, pendiente, detalle };
}

export const ESTADO_RESPUESTA = {
  correcta: 'Correcta',
  incorrecta: 'Incorrecta',
  blanco: 'En blanco',
  pendiente: 'Pendiente de corregir',
  manual: 'Corregida a mano',
};

export const ESTADO_INTENTO = { en_curso: 'En curso', bloqueado: 'Bloqueado', entregado: 'Entregado' };

// ---------- Formatos ----------

export const numero = (n, decimales = 2) => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: decimales });

export function duracionTexto(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const fechaHora = ms => (ms ? new Date(ms).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' }) : '');

export function textoRespuesta(p, r) {
  if (r === undefined || r === null || r === '') return '';
  if (p.tipo === 'test') return p.opciones[r] ?? '';
  return String(r);
}

const celdaCSV = v => {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV con punto y coma y coma decimal, que es lo que espera Excel en español
export function generarCSV(ex, intentos) {
  const cabecera = ['Nombre', 'Estado', 'Nota (sobre 10)', 'Puntos', 'Máximo', 'Pendiente', 'Salidas', 'Inicio', 'Entrega'];
  etiquetas(ex.preguntas).forEach(e => cabecera.push(`P${e}`));
  const filas = [...intentos]
    .sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'))
    .map(a => {
      const c = corregir(ex, a);
      const fila = [a.nombre, ESTADO_INTENTO[a.estado], numero(c.nota), numero(c.total), numero(c.max), c.pendiente ? 'Sí' : 'No', a.salidas || 0, fechaHora(a.inicio), fechaHora(a.entregadoEn)];
      ex.preguntas.forEach(p => fila.push(c.detalle[p.id] ? numero(c.detalle[p.id].puntos) : ''));
      return fila;
    });
  return '﻿' + [cabecera, ...filas].map(f => f.map(celdaCSV).join(';')).join('\r\n');
}

export const nombreArchivo = texto =>
  normalizar(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'examen';
