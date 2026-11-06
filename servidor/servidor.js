/*
 * TestGO, versión para montar en un servidor propio.
 * Sin dependencias: solo Node 20 o superior. Los datos se guardan en servidor/datos/testgo.json.
 *
 *   node servidor/servidor.js            (puerto 3000)
 *   PORT=8080 node servidor/servidor.js
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as N from '../web/js/nucleo.js';

const { ErrorTestGO } = N;
const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(RAIZ, '..', 'web');
const DATOS = process.env.TESTGO_DATOS || path.join(RAIZ, 'datos');
const ARCHIVO = path.join(DATOS, 'testgo.json');
const PUERTO = Number(process.env.PORT) || 3000;
const SESION_PROFESOR_MS = 12 * 60 * 60 * 1000;
const HUECO_DESCONEXION_MS = 30000;
const MAX_INCIDENCIAS = 2000;

// ---------- Datos ----------

const vacio = () => ({ config: {}, examenes: {}, codigos: {}, intentos: {}, nombres: {}, solicitudes: {}, imagenes: {} });

function cargar() {
  try {
    return { ...vacio(), ...JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')) };
  } catch (e) {
    if (e.code === 'ENOENT') return vacio();
    console.error(`No se puede leer ${ARCHIVO}: ${e.message}`);
    console.error('Revisa el archivo o muévelo a otra carpeta para empezar de cero. No se ha tocado nada.');
    process.exit(1);
  }
}

const db = cargar();
let temporizador = null;

// Se escribe en un archivo temporal y luego se renombra: si se corta la luz no queda a medias
function guardarYa() {
  clearTimeout(temporizador);
  temporizador = null;
  fs.mkdirSync(DATOS, { recursive: true });
  const tmp = `${ARCHIVO}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, ARCHIVO);
}

function guardar() {
  if (!temporizador) temporizador = setTimeout(guardarYa, 300);
}

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    if (temporizador) guardarYa();
    process.exit(0);
  });
}

// ---------- Firmas y sesiones ----------

const firmar = texto => crypto.createHmac('sha256', db.config.secreto).update(texto).digest('base64url').slice(0, 32);

function firmaValida(texto, firma) {
  if (!db.config.secreto) return false;
  const a = Buffer.from(firmar(texto));
  const b = Buffer.from(String(firma || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const tokenAlumno = (E, A, gen = 0) => `${E}.${A}.${gen}.${firmar(`alumno.${E}.${A}.${gen}`)}`;

function leerCookie(req, nombre) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
  return m ? m[1] : null;
}

function profesorConectado(req) {
  const [caduca, firma] = String(leerCookie(req, 'testgo_sid') || '').split('.');
  return Number(caduca) > Date.now() && firmaValida(`profesor.${caduca}`, firma);
}

const fallosLogin = new Map();

// ---------- Utilidades ----------

const ahora = () => Date.now();

function examenOError(E) {
  const ex = db.examenes[E];
  if (!ex) throw new ErrorTestGO(404, 'Examen no encontrado');
  return ex;
}

function intentoOError(E, A) {
  const a = db.intentos[E]?.[A];
  if (!a) throw new ErrorTestGO(404, 'Alumno no encontrado');
  return a;
}

function registrar(a, tipo, detalle, t = ahora()) {
  if (a.incidencias.length >= MAX_INCIDENCIAS) return;
  a.incidencias.push({ t, tipo, detalle: String(detalle || '').slice(0, 300) });
  if (N.SOSPECHOSAS.has(tipo)) a.ultimaIncidencia = { t, tipo, detalle };
}

function entregar(a, motivo, t = ahora()) {
  if (a.estado === 'entregado') return;
  Object.assign(a, { estado: 'entregado', entregadoEn: t, motivoEntrega: motivo, bloqueadoPor: null });
  registrar(a, 'entrega', motivo, t);
  guardar();
}

function caducar(a) {
  if (N.tiempoAgotado(a, ahora())) entregar(a, 'Tiempo agotado', N.limiteDe(a));
}

// Para el directo, que se pide cada 3 s: sin las incidencias ni el Notebook, que pueden ocupar mucho
const ligero = ({ incidencias, notebook, ...resto }) => resto;

function codigoUnico(E) {
  for (let i = 0; i < 50; i++) {
    const codigo = N.codigoAleatorio(6);
    if (!db.codigos[codigo]) {
      db.codigos[codigo] = E;
      return codigo;
    }
  }
  throw new ErrorTestGO(503, 'No se pudo generar un código. Vuelve a intentarlo.');
}

// Lo que recibe el navegador del alumno en cada petición
function estadoAlumno(ex, a) {
  const intento = {
    nombre: a.nombre,
    estado: a.estado,
    inicio: a.inicio,
    duracion: a.duracion,
    minutosExtra: a.minutosExtra,
    orden: a.orden,
    respuestas: a.respuestas,
    notebook: a.notebook || '',
    salidas: a.salidas,
    baseSalidas: a.baseSalidas,
    bloqueadoPor: a.bloqueadoPor || null,
    entregadoEn: a.entregadoEn,
    motivoEntrega: a.motivoEntrega,
  };
  let nota = null;
  if (a.estado === 'entregado' && ex.mostrarNota) {
    const c = N.corregir(ex, a);
    nota = { nota: c.nota, total: c.total, max: c.max, pendiente: c.pendiente };
  }
  return { examen: N.datosPublicos(ex), intento, nota, centro: datosCentro(), ahora: ahora() };
}

// ---------- Rutas ----------

const rutas = [];
function ruta(metodo, patron, acceso, manejador) {
  const re = new RegExp('^' + patron.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  rutas.push({ metodo, re, acceso, manejador });
}

// --- Alumno ---

ruta('POST', '/api/alumno/entrar', null, ({ cuerpo, req }) => {
  if (!db.config.secreto) throw new ErrorTestGO(503, 'El profesor todavía no ha configurado TestGO.');
  const E = db.codigos[N.limpiarCodigo(cuerpo.codigo)];
  const ex = E && db.examenes[E];
  if (!ex) throw new ErrorTestGO(404, 'No hay ningún examen con ese código.');
  const nombre = N.limpiarNombre(cuerpo.nombre);
  N.comprobarNombre(nombre);
  const clave = N.claveNombre(nombre);
  db.nombres[E] ??= {};
  if (db.intentos[E]?.[db.nombres[E][clave]]) {
    throw new ErrorTestGO(409, 'Ya hay alguien en este examen con ese nombre. Si eres tú, pide al profesor que te deje volver a entrar.', 'nombre_ocupado');
  }
  if (!ex.abierto) throw new ErrorTestGO(403, 'El examen está cerrado. Espera a que el profesor lo abra.');
  if (!ex.preguntas.length) throw new ErrorTestGO(409, 'Este examen todavía no tiene preguntas.');
  const A = N.nuevoId();
  const a = {
    id: A,
    ...N.nuevoIntento({ nombre, semilla: N.nuevoId(), ex, ahora: ahora() }),
    gen: 0,
    ip: req.socket.remoteAddress || '',
    navegador: String(req.headers['user-agent'] || '').slice(0, 300),
    incidencias: [],
  };
  (db.intentos[E] ??= {})[A] = a;
  db.nombres[E][clave] = A;
  guardar();
  return { token: tokenAlumno(E, A) };
});

ruta('POST', '/api/alumno/solicitar', null, ({ cuerpo, req }) => {
  const E = db.codigos[N.limpiarCodigo(cuerpo.codigo)];
  if (!E || !db.examenes[E]) throw new ErrorTestGO(404, 'No hay ningún examen con ese código.');
  const nombre = N.limpiarNombre(cuerpo.nombre);
  N.comprobarNombre(nombre);
  const S = 's' + N.nuevoId();
  (db.solicitudes[E] ??= {})[S] = { id: S, nombre, nombreClave: N.claveNombre(nombre), t: ahora(), ip: req.socket.remoteAddress || '' };
  guardar();
  return { token: tokenAlumno(E, S) };
});

// Identifica al alumno por su token firmado
function alumnoDe(req) {
  const [E, A, gen, firma] = String(req.headers['x-token'] || '').split('.');
  if (!E || !A || !firmaValida(`alumno.${E}.${A}.${gen}`, firma)) throw new ErrorTestGO(401, 'Tu sesión de examen ya no es válida.');
  return { E, A, gen };
}

ruta('GET', '/api/alumno/estado', null, ({ req }) => {
  const { E, A, gen } = alumnoDe(req);
  if (A.startsWith('s')) {
    // Esperando a que el profesor acepte la solicitud para volver a entrar
    const s = db.solicitudes[E]?.[A];
    if (!s) throw new ErrorTestGO(401, 'El profesor no ha aceptado la solicitud.');
    if (!s.aceptadaPara) return { pendiente: true };
    const destino = db.intentos[E]?.[s.aceptadaPara];
    delete db.solicitudes[E][A];
    guardar();
    if (!destino) throw new ErrorTestGO(401, 'Tu examen ya no existe.');
    return { token: tokenAlumno(E, destino.id, destino.gen) };
  }
  return estadoAlumno(...cargarAlumno(E, A, gen));
});

function cargarAlumno(E, A, gen) {
  const ex = db.examenes[E];
  const a = ex && db.intentos[E]?.[A];
  if (!a || String(a.gen) !== gen) throw new ErrorTestGO(401, 'Tu sesión de examen ya no es válida.');
  caducar(a);
  const t = ahora();
  if (a.estado === 'en_curso' && a.inicio && t - a.ultimaSenal > HUECO_DESCONEXION_MS) {
    registrar(a, 'desconexion', `Sin conexión durante ${N.duracionTexto(t - a.ultimaSenal)}`);
  }
  a.ultimaSenal = t;
  guardar();
  return [ex, a];
}

function rutaAlumno(nombre, manejador) {
  ruta('POST', `/api/alumno/${nombre}`, null, ctx => {
    const { E, A, gen } = alumnoDe(ctx.req);
    const [ex, a] = cargarAlumno(E, A, gen);
    manejador({ ...ctx, ex, a });
    guardar();
    return estadoAlumno(ex, a);
  });
}

rutaAlumno('comenzar', ({ a }) => {
  if (a.estado !== 'en_curso' || a.inicio) return;
  a.inicio = ahora();
  registrar(a, 'inicio', 'Empezó el examen');
});

rutaAlumno('guardar', ({ ex, a, cuerpo }) => {
  if (N.puedeResponder(a, ahora())) a.respuestas = N.limpiarRespuestas(ex.preguntas, a.orden, cuerpo.respuestas);
  if (N.puedeResponder(a, ahora()) && cuerpo.notebook !== undefined) a.notebook = N.limpiarNotebook(cuerpo.notebook);
});

// En qué pregunta está el alumno (para el plano de la clase y la vista en directo)
rutaAlumno('posicion', ({ a, cuerpo }) => {
  if (a.estado === 'entregado') return;
  const total = (a.orden || []).length;
  const i = Math.round(N.acotar(cuerpo.indice, 0, 0, total));
  a.posicion = { indice: i, total, etiqueta: String(cuerpo.etiqueta ?? '').slice(0, 10), t: ahora() };
});

rutaAlumno('incidencia', ({ ex, a, cuerpo }) => {
  const tipo = String(cuerpo.tipo || '');
  if (!N.TIPOS_INCIDENCIA.has(tipo)) throw new ErrorTestGO(400, 'Tipo de incidencia no válido');
  const efecto = N.efectoIncidencia(a, ex.maxSalidas, tipo, cuerpo.detalle, ahora());
  if (!efecto || a.incidencias.length >= MAX_INCIDENCIAS) return;
  Object.assign(a, efecto.cambios);
  a.incidencias.push(...efecto.registros);
});

rutaAlumno('entregar', ({ ex, a, cuerpo }) => {
  if (a.estado === 'bloqueado') throw new ErrorTestGO(403, 'El examen está bloqueado. Avisa al profesor.');
  if (a.estado !== 'en_curso' || !a.inicio) return;
  if (N.puedeResponder(a, ahora())) a.respuestas = N.limpiarRespuestas(ex.preguntas, a.orden, cuerpo.respuestas);
  if (N.puedeResponder(a, ahora()) && cuerpo.notebook !== undefined) a.notebook = N.limpiarNotebook(cuerpo.notebook);
  entregar(a, cuerpo.automatico ? 'Entregado automáticamente al acabar el tiempo' : 'Entregado por el alumno');
});

// --- Profesor ---

ruta('GET', '/api/profesor/sesion', null, ({ req }) => ({ configurado: !!db.config.hash, conectado: profesorConectado(req) }));

function abrirSesion(seguro) {
  const caduca = ahora() + SESION_PROFESOR_MS;
  const sid = `${caduca}.${firmar(`profesor.${caduca}`)}`;
  return { 'Set-Cookie': `testgo_sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESION_PROFESOR_MS / 1000}${seguro ? '; Secure' : ''}` };
}

ruta('POST', '/api/profesor/configurar', null, ({ cuerpo, seguro }) => {
  if (db.config.hash) throw new ErrorTestGO(409, 'TestGO ya tiene contraseña. Recarga la página para entrar.');
  const clave = String(cuerpo.password || '');
  if (clave.length < 8) throw new ErrorTestGO(400, 'La contraseña debe tener al menos 8 caracteres.');
  const sal = crypto.randomBytes(16);
  db.config = { sal: sal.toString('hex'), hash: crypto.scryptSync(clave, sal, 64).toString('hex'), secreto: crypto.randomBytes(32).toString('hex') };
  guardarYa();
  return { cuerpo: { ok: true }, cabeceras: abrirSesion(seguro) };
});

ruta('POST', '/api/profesor/login', null, async ({ cuerpo, req, seguro }) => {
  if (!db.config.hash) throw new ErrorTestGO(409, 'Primero hay que crear la contraseña del profesor.');
  const ip = req.socket.remoteAddress || '';
  const calculado = crypto.scryptSync(String(cuerpo.password ?? ''), Buffer.from(db.config.sal, 'hex'), 64);
  if (!crypto.timingSafeEqual(calculado, Buffer.from(db.config.hash, 'hex'))) {
    const fallos = (fallosLogin.get(ip) || 0) + 1;
    fallosLogin.set(ip, fallos);
    await new Promise(r => setTimeout(r, Math.min(800 * fallos, 8000)));
    throw new ErrorTestGO(401, 'Contraseña incorrecta');
  }
  fallosLogin.delete(ip);
  return { cuerpo: { ok: true }, cabeceras: abrirSesion(seguro) };
});

ruta('POST', '/api/profesor/salir', null, ({ seguro }) => ({
  cuerpo: { ok: true },
  cabeceras: { 'Set-Cookie': `testgo_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${seguro ? '; Secure' : ''}` },
}));

ruta('PUT', '/api/profesor/password', 'profesor', ({ cuerpo }) => {
  const clave = String(cuerpo.password || '');
  if (clave.length < 8) throw new ErrorTestGO(400, 'La contraseña debe tener al menos 8 caracteres.');
  const sal = crypto.randomBytes(16);
  Object.assign(db.config, { sal: sal.toString('hex'), hash: crypto.scryptSync(clave, sal, 64).toString('hex') });
  guardarYa();
  return { ok: true };
});

// Direcciones de este equipo en la red del aula, para enseñárselas a los alumnos.
// Primero la wifi o el cable de verdad; al final las de VPN y máquinas virtuales (Tailscale, VMware...).
const VIRTUAL = /vmware|virtualbox|vbox|vethernet|hyper-v|wsl|tailscale|zerotier|docker|vpn|hamachi|loopback/i;
const privada = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const vpnCgnat = ip => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

function direccionesRed() {
  const puntos = ({ nombre, address }) => (VIRTUAL.test(nombre) ? 4 : 0) + (vpnCgnat(address) ? 4 : 0) + (privada(address) ? 0 : 1);
  return Object.entries(os.networkInterfaces())
    .flatMap(([nombre, lista]) => (lista || []).map(d => ({ ...d, nombre })))
    .filter(d => d.family === 'IPv4' && !d.internal)
    .sort((a, b) => puntos(a) - puntos(b))
    .map(d => `${d.address}:${PUERTO}`);
}

ruta('GET', '/api/profesor/direcciones', 'profesor', () => direccionesRed());

function resumenExamen(ex) {
  const intentos = Object.values(db.intentos[ex.id] || {});
  return {
    id: ex.id,
    titulo: ex.titulo,
    codigo: ex.codigo,
    abierto: ex.abierto,
    creado: ex.creado,
    preguntas: ex.preguntas.length,
    alumnos: intentos.length,
    entregados: intentos.filter(a => a.estado === 'entregado').length,
  };
}

ruta('GET', '/api/profesor/examenes', 'profesor', () =>
  Object.values(db.examenes).sort((a, b) => b.creado - a.creado).map(resumenExamen),
);

ruta('POST', '/api/profesor/examenes', 'profesor', ({ cuerpo }) => {
  const id = N.nuevoId();
  const ex = { id, ...N.limpiarExamen(cuerpo), codigo: codigoUnico(id), abierto: false, creado: ahora() };
  db.examenes[id] = ex;
  guardar();
  return ex;
});

const conAlumnos = ex => ({ ...ex, alumnos: Object.keys(db.intentos[ex.id] || {}).length });

ruta('GET', '/api/profesor/examenes/:E', 'profesor', ({ params }) => conAlumnos(examenOError(params.E)));

ruta('PUT', '/api/profesor/examenes/:E', 'profesor', ({ params, cuerpo }) => {
  const previo = examenOError(params.E);
  const cambios = N.limpiarExamen(cuerpo, previo);
  N.comprobarCambios(previo, cambios, Object.keys(db.intentos[previo.id] || {}).length > 0);
  const ex = { ...previo, ...cambios, ...(cuerpo.abierto !== undefined ? { abierto: !!cuerpo.abierto } : {}) };
  db.examenes[ex.id] = ex;
  guardar();
  return conAlumnos(ex);
});

ruta('POST', '/api/profesor/examenes/:E/codigo', 'profesor', ({ params }) => {
  const ex = examenOError(params.E);
  delete db.codigos[ex.codigo];
  ex.codigo = codigoUnico(ex.id);
  guardar();
  return conAlumnos(ex);
});

ruta('DELETE', '/api/profesor/examenes/:E', 'profesor', ({ params }) => {
  const ex = examenOError(params.E);
  delete db.codigos[ex.codigo];
  for (const tabla of ['examenes', 'intentos', 'nombres', 'solicitudes']) delete db[tabla][ex.id];
  limpiarImagenes();
  guardar();
});

// ---------- Imágenes (preguntas y logo del centro) ----------

const MAX_IMAGEN = 2 * 1024 * 1024;
const RE_IMAGEN = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

ruta('POST', '/api/profesor/imagenes', 'profesor', ({ cuerpo }) => {
  const m = String(cuerpo.datos || '').match(RE_IMAGEN);
  if (!m) throw new ErrorTestGO(400, 'La imagen tiene que ser PNG, JPG, WebP o GIF.');
  if (m[2].length * 0.75 > MAX_IMAGEN) throw new ErrorTestGO(413, 'La imagen es demasiado grande (máximo 2 MB).');
  const id = N.nuevoId(12);
  db.imagenes[id] = { tipo: m[1], datos: m[2], creada: ahora() };
  guardar();
  return { id };
});

// Pública: el identificador es aleatorio y solo lo conoce quien ve el examen
ruta('GET', '/api/imagenes/:id', null, ({ params }) => {
  const img = db.imagenes[params.id];
  if (!img) throw new ErrorTestGO(404, 'Imagen no encontrada');
  return { binario: Buffer.from(img.datos, 'base64'), tipo: img.tipo };
});

// Borra las imágenes que ya no usa ningún examen ni el logo (las de la última hora se respetan:
// pueden ser de un examen que se está editando y aún no se ha guardado)
function limpiarImagenes() {
  const usadas = new Set([db.config.centro?.logo]);
  for (const ex of Object.values(db.examenes)) for (const p of ex.preguntas) if (p.imagen) usadas.add(p.imagen);
  for (const [id, img] of Object.entries(db.imagenes)) {
    if (!usadas.has(id) && ahora() - img.creada > 60 * 60 * 1000) delete db.imagenes[id];
  }
}

// ---------- Datos del centro ----------

const datosCentro = () => ({ nombre: db.config.centro?.nombre || '', logo: db.config.centro?.logo || null });

ruta('GET', '/api/publico/centro', null, datosCentro);
ruta('GET', '/api/profesor/centro', 'profesor', datosCentro);

ruta('PUT', '/api/profesor/centro', 'profesor', ({ cuerpo }) => {
  const logo = cuerpo.logo && db.imagenes[cuerpo.logo] ? cuerpo.logo : null;
  db.config.centro = { nombre: String(cuerpo.nombre ?? '').trim().slice(0, 150), logo };
  guardar();
  return datosCentro();
});

ruta('GET', '/api/profesor/examenes/:E/intentos', 'profesor', ({ params, url }) => {
  const ex = examenOError(params.E);
  const intentos = Object.values(db.intentos[ex.id] || {});
  intentos.forEach(caducar);
  const completo = url.searchParams.get('completo') === '1';
  return {
    ahora: ahora(),
    intentos: intentos.map(a => (completo ? a : ligero(a))),
    solicitudes: Object.values(db.solicitudes[ex.id] || {}).filter(s => !s.aceptadaPara),
  };
});

ruta('GET', '/api/profesor/examenes/:E/intentos/:A', 'profesor', ({ params }) => {
  const a = intentoOError(params.E, params.A);
  caducar(a);
  return a;
});

ruta('POST', '/api/profesor/examenes/:E/intentos/:A/accion', 'profesor', ({ params, cuerpo }) => {
  const a = intentoOError(params.E, params.A);
  caducar(a);
  const efecto = N.efectoAccion(a, cuerpo.accion, cuerpo.datos, ahora());
  if (efecto) {
    Object.assign(a, efecto.cambios);
    registrar(a, ...efecto.registro);
    guardar();
  }
  return a;
});

// Corrección a mano: notas, comentarios para el alumno y criterios de la rúbrica
ruta('PUT', '/api/profesor/examenes/:E/intentos/:A/notas', 'profesor', ({ params, cuerpo }) => {
  const ex = examenOError(params.E);
  const a = intentoOError(params.E, params.A);
  Object.assign(a, N.limpiarCorreccion(ex, a, cuerpo));
  guardar();
  return a;
});

ruta('DELETE', '/api/profesor/examenes/:E/intentos/:A', 'profesor', ({ params }) => {
  const a = intentoOError(params.E, params.A);
  delete db.intentos[params.E][a.id];
  if (db.nombres[params.E]?.[a.nombreClave] === a.id) delete db.nombres[params.E][a.nombreClave];
  guardar();
});

ruta('POST', '/api/profesor/examenes/:E/solicitudes/:S', 'profesor', ({ params, cuerpo }) => {
  const s = db.solicitudes[params.E]?.[params.S];
  if (!s) throw new ErrorTestGO(404, 'La solicitud ya no existe.');
  if (!cuerpo.aceptar) {
    delete db.solicitudes[params.E][params.S];
    guardar();
    return { ok: true };
  }
  const a = db.intentos[params.E]?.[db.nombres[params.E]?.[s.nombreClave]];
  if (!a) throw new ErrorTestGO(404, 'Ya no hay ningún alumno con ese nombre. Dile que vuelva a entrar normalmente.');
  a.gen += 1; // la sesión anterior deja de valer
  registrar(a, 'reentrada', `Volvió a entrar desde otro dispositivo (${s.ip}), permitido por el profesor`);
  s.aceptadaPara = a.id;
  guardar();
  return { ok: true };
});

// ---------- Archivos de la web ----------

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const CABECERAS_SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'",
};

function servirArchivo(res, ruta) {
  if (ruta === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': TIPOS_MIME['.js'], 'Cache-Control': 'no-cache', ...CABECERAS_SEGURIDAD });
    return res.end("export const MODO = 'servidor';\n");
  }
  const alias = { '/': '/index.html', '/profesor': '/profesor.html' };
  let relativa;
  try {
    relativa = decodeURIComponent(alias[ruta] || ruta);
  } catch {
    relativa = '';
  }
  const archivo = path.join(WEB, relativa);
  if (!relativa || !archivo.startsWith(WEB + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(archivo, (err, datos) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...CABECERAS_SEGURIDAD });
      return res.end('No encontrado');
    }
    const ext = path.extname(archivo);
    res.writeHead(200, {
      'Content-Type': TIPOS_MIME[ext] || 'application/octet-stream',
      'Cache-Control': relativa.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache',
      ...CABECERAS_SEGURIDAD,
    });
    res.end(datos);
  });
}

// ---------- Entrada ----------

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    if (req.method !== 'POST' && req.method !== 'PUT') return resolver({});
    let texto = '';
    req.setEncoding('utf8');
    req.on('data', trozo => {
      texto += trozo;
      if (texto.length > 5e6) {
        rechazar(new ErrorTestGO(413, 'Datos demasiado grandes'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!texto) return resolver({});
      try {
        const v = JSON.parse(texto);
        resolver(v && typeof v === 'object' ? v : {});
      } catch {
        rechazar(new ErrorTestGO(400, 'JSON no válido'));
      }
    });
    req.on('error', rechazar);
  });
}

function responderJSON(res, estado, datos, cabeceras = {}) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CABECERAS_SEGURIDAD, ...cabeceras });
  res.end(JSON.stringify(datos ?? { ok: true }));
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return responderJSON(res, 405, { error: 'Método no permitido' });
    return servirArchivo(res, url.pathname);
  }
  try {
    const r = rutas.find(x => x.metodo === req.method && x.re.test(url.pathname));
    if (!r) throw new ErrorTestGO(404, 'Ruta no encontrada');
    if (r.acceso === 'profesor' && !profesorConectado(req)) throw new ErrorTestGO(401, 'Inicia sesión');
    const seguro = req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
    const ctx = { req, url, seguro, params: url.pathname.match(r.re).groups || {}, cuerpo: await leerCuerpo(req) };
    const resultado = await r.manejador(ctx);
    if (resultado?.binario) {
      res.writeHead(200, { 'Content-Type': resultado.tipo, 'Cache-Control': 'public, max-age=31536000, immutable', ...CABECERAS_SEGURIDAD });
      return res.end(resultado.binario);
    }
    if (resultado?.cabeceras) return responderJSON(res, 200, resultado.cuerpo, resultado.cabeceras);
    responderJSON(res, 200, resultado);
  } catch (e) {
    if (!(e instanceof ErrorTestGO)) console.error(e);
    responderJSON(res, e.estado || 500, { error: e instanceof ErrorTestGO ? e.message : 'Error interno del servidor', codigo: e.codigo || '' });
  }
});

servidor.listen(PUERTO, () => {
  limpiarImagenes();
  console.log(`\nTestGO funcionando en el puerto ${PUERTO}\n`);
  console.log(`  Profesor:  http://localhost:${PUERTO}/profesor`);
  for (const d of direccionesRed()) console.log(`  Alumnos:   http://${d}`);
  console.log(`\nDatos en ${ARCHIVO}\nPulsa Ctrl+C para pararlo.\n`);
});
