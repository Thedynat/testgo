/*
 * Conexión con Firebase (plan gratuito: Auth + Firestore, sin Cloud Functions).
 * Ofrece lo mismo que api-servidor.js. Como no hay servidor, la seguridad está en firestore.rules:
 * el alumno solo puede escribir en su propio intento, el tiempo lo controla la hora de Firebase
 * y las soluciones están en un documento que solo lee el profesor.
 *
 *   examenes/{E}                          examen completo (solo su profesor)
 *   publico/{E}                           lo que ve el alumno, sin soluciones
 *   publico/{E}/intentos/{uid}            intento de cada alumno (uid de su sesión anónima)
 *   publico/{E}/intentos/{uid}/incidencias/{id}
 *   publico/{E}/nombres/{clave}           { uid }: un intento por nombre
 *   publico/{E}/solicitudes/{uid}         alumno que pide volver a entrar desde otro equipo
 *   codigos/{CÓDIGO}                      { examenId }
 *   imagenes/{id}                         imágenes de las preguntas y el logo (data: URL)
 *   profesores/{uid}                      { email, estado: activo | pendiente | bloqueado, creado, ultimoAcceso }
 *   ajustes/acceso                        { dominios, aprobarRegistros }: quién puede ser profesor
 *   ajustes/admins                        { correos }: administradores además de los principales (ADMINS)
 *   ajustes/centro                        { nombre, logo, mensajeAlumnos }: el mismo para todos
 *   ajustes/examenes                      { defectos, normas }: cómo empiezan los exámenes y qué no se puede cambiar
 *   ajustes/aviso                         { texto, tipo, activo }: aviso para todos los profesores
 * Los ajustes solo los cambia un administrador (lo comprueba firestore.rules).
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, signInWithPopup, GoogleAuthProvider, reload,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where,
  onSnapshot, writeBatch, runTransaction, serverTimestamp, getCountFromServer, collectionGroup,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { FIREBASE, DOMINIO_PROFESORES, ADMINS } from './config.js';
import * as N from './nucleo.js';

const { ErrorTestGO } = N;

// Alumno y profesor usan instancias separadas: así sus sesiones no se pisan si se abren en el mismo navegador
const instancias = {};
function conexion(papel) {
  if (!instancias[papel]) {
    const app = initializeApp(FIREBASE, papel);
    instancias[papel] = { auth: getAuth(app), db: initializeFirestore(app, { ignoreUndefinedProperties: true }) };
    instancias[papel].listo = new Promise(r => {
      const parar = onAuthStateChanged(instancias[papel].auth, () => (parar(), r()));
    });
  }
  return instancias[papel];
}

// ---------- Utilidades ----------

const ms = v => (v && typeof v.toMillis === 'function' ? v.toMillis() : v ?? null);

// Pasa las fechas de Firestore a milisegundos, que es lo que usa el núcleo
function aIntento(snap) {
  const d = snap.data({ serverTimestamps: 'estimate' });
  return {
    ...d,
    id: snap.id,
    creado: ms(d.creado),
    inicio: ms(d.inicio),
    ultimaSenal: ms(d.ultimaSenal),
    entregadoEn: ms(d.entregadoEn),
    ultimaIncidencia: d.ultimaIncidencia ? { ...d.ultimaIncidencia, t: ms(d.ultimaIncidencia.t) } : null,
    respuestas: d.respuestas || {},
    notasManual: d.notasManual || {},
  };
}

const aIncidencia = snap => {
  const d = snap.data({ serverTimestamps: 'estimate' });
  return { t: ms(d.t), tipo: d.tipo, detalle: d.detalle };
};

function traducir(e) {
  if (e instanceof ErrorTestGO) return e;
  const codigo = String(e?.code || '');
  if (codigo === 'unavailable' || codigo === 'auth/network-request-failed') return new ErrorTestGO(0, 'No hay conexión con internet.', 'sin_conexion');
  if (codigo === 'permission-denied') return new ErrorTestGO(403, 'No tienes permiso para hacer esto.');
  const auth = {
    'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
    'auth/wrong-password': 'El correo o la contraseña no son correctos.',
    'auth/user-not-found': 'El correo o la contraseña no son correctos.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/email-already-in-use': 'Ya hay una cuenta con ese correo. Entra con tu contraseña.',
    'auth/weak-password': 'La contraseña es demasiado débil: usa al menos 8 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un poco y vuelve a probar.',
    'auth/popup-closed-by-user': 'Se ha cerrado la ventana de Google antes de terminar.',
    'auth/operation-not-allowed': 'Este método de acceso no está activado en Firebase (Authentication → Sign-in method).',
    'auth/admin-restricted-operation': 'El acceso de alumnos sin cuenta no está activado en Firebase (Authentication → Anónimo).',
  };
  if (auth[codigo]) return new ErrorTestGO(400, auth[codigo], codigo);
  console.error(e);
  return new ErrorTestGO(500, 'Algo ha fallado al hablar con Firebase. Vuelve a intentarlo.');
}

const intentar = f => async (...args) => {
  try {
    return await f(...args);
  } catch (e) {
    throw traducir(e);
  }
};

// Imágenes: se guardan en Firestore (el plan gratuito no incluye Storage) y se guardan en memoria al cargarlas
const imagenes = new Map();
const urlImagen = id => imagenes.get(id) || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

async function cargarImagenes(db, ids) {
  await Promise.all([...new Set(ids.filter(id => id && !imagenes.has(id)))].map(async id => {
    try {
      const s = await getDoc(doc(db, 'imagenes', id));
      if (s.exists()) imagenes.set(id, s.data().datos);
    } catch {}
  }));
}

const idsImagenes = (preguntas, centro) => [centro?.logo, ...(preguntas || []).map(p => p.imagen)];

// Nombre y logo del centro: uno solo para todos los profesores y alumnos
async function leerCentro(db) {
  const s = await getDoc(doc(db, 'ajustes', 'centro'));
  return { nombre: s.data()?.nombre || '', logo: s.data()?.logo || null, mensajeAlumnos: s.data()?.mensajeAlumnos || '' };
}

// Un documento de Firestore admite como mucho 1 MB: se reduce la imagen hasta que quepa
async function encoger(datos) {
  if (datos.length < 900000) return datos;
  const img = await new Promise((resolver, rechazar) => {
    const i = new Image();
    i.onload = () => resolver(i);
    i.onerror = rechazar;
    i.src = datos;
  });
  let lado = Math.max(img.naturalWidth, img.naturalHeight);
  let salida = datos;
  for (let calidad = 0.8; salida.length >= 900000 && lado > 300; calidad -= 0.1) {
    lado = Math.round(lado * 0.8);
    const escala = lado / Math.max(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * escala);
    c.height = Math.round(img.naturalHeight * escala);
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    salida = c.toDataURL('image/jpeg', Math.max(0.5, calidad));
  }
  if (salida.length >= 900000) throw new ErrorTestGO(413, 'La imagen es demasiado grande. Prueba con una más pequeña.');
  return salida;
}

// ---------- Alumno ----------

const CLAVE_ALUMNO = 'testgo.firebase.alumno';
const leerLocal = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_ALUMNO) || 'null');
  } catch {
    return null;
  }
};
const guardarLocal = v => {
  try {
    if (v) localStorage.setItem(CLAVE_ALUMNO, JSON.stringify(v));
    else localStorage.removeItem(CLAVE_ALUMNO);
  } catch {}
};

async function sesionAlumno() {
  const c = conexion('alumno');
  await c.listo;
  if (!c.auth.currentUser) await signInAnonymously(c.auth);
  return { ...c, uid: c.auth.currentUser.uid };
}

async function examenPorCodigo(db, codigo) {
  const c = N.limpiarCodigo(codigo);
  const s = c ? await getDoc(doc(db, 'codigos', c)) : null;
  if (!s?.exists()) throw new ErrorTestGO(404, 'No hay ningún examen con ese código.');
  const E = s.data().examenId;
  const pub = await getDoc(doc(db, 'publico', E));
  if (!pub.exists()) throw new ErrorTestGO(404, 'No hay ningún examen con ese código.');
  return { E, pub: pub.data() };
}

// Estado del alumno que se comparte entre las llamadas (lo usa el observador)
const estadoAlumnoActual = { E: null, pub: null, intento: null, desfase: 0 };

export const alumno = {
  sesionGuardada: () => !!leerLocal()?.E,
  // Para la pantalla de entrada, antes de escribir el código
  centro: intentar(async () => {
    const { db } = await sesionAlumno();
    const c = await leerCentro(db);
    await cargarImagenes(db, [c.logo]);
    return c;
  }),
  urlImagen,

  entrar: intentar(async (codigo, nombreEscrito) => {
    const { db, uid } = await sesionAlumno();
    const { E, pub } = await examenPorCodigo(db, codigo);
    const nombre = N.limpiarNombre(nombreEscrito);
    N.comprobarNombre(nombre);
    // En el mismo navegador ya tiene su examen: sigue donde lo dejó
    if ((await getDoc(doc(db, 'publico', E, 'intentos', uid))).exists()) return guardarLocal({ E });
    const clave = N.claveNombre(nombre);
    const ocupado = await getDoc(doc(db, 'publico', E, 'nombres', clave));
    if (ocupado.exists()) {
      throw new ErrorTestGO(409, 'Ya hay alguien en este examen con ese nombre. Si eres tú, pide al profesor que te deje volver a entrar.', 'nombre_ocupado');
    }
    if (!pub.abierto) throw new ErrorTestGO(403, 'El examen está cerrado. Espera a que el profesor lo abra.');
    if (!pub.preguntas?.length) throw new ErrorTestGO(409, 'Este examen todavía no tiene preguntas.');
    const base = N.nuevoIntento({ nombre, semilla: uid, ex: pub, ahora: 0 });
    const lote = writeBatch(db);
    lote.set(doc(db, 'publico', E, 'nombres', clave), { uid, nombre });
    lote.set(doc(db, 'publico', E, 'intentos', uid), {
      ...base,
      creado: serverTimestamp(),
      ultimaSenal: serverTimestamp(),
      navegador: navigator.userAgent.slice(0, 300),
    });
    try {
      await lote.commit();
    } catch (e) {
      // Otro alumno ha cogido el mismo nombre justo a la vez
      if (e?.code === 'permission-denied' && (await getDoc(doc(db, 'publico', E, 'nombres', clave))).exists()) {
        throw new ErrorTestGO(409, 'Ya hay alguien en este examen con ese nombre. Si eres tú, pide al profesor que te deje volver a entrar.', 'nombre_ocupado');
      }
      throw e;
    }
    guardarLocal({ E });
  }),

  solicitarReentrada: intentar(async (codigo, nombreEscrito) => {
    const { db, uid } = await sesionAlumno();
    const { E } = await examenPorCodigo(db, codigo);
    const nombre = N.limpiarNombre(nombreEscrito);
    N.comprobarNombre(nombre);
    await setDoc(doc(db, 'publico', E, 'solicitudes', uid), { nombre, nombreClave: N.claveNombre(nombre), t: serverTimestamp() });
    guardarLocal({ E, pendiente: true });
  }),

  observar(cb, alError) {
    let parar = () => {};
    let latido = null;
    let cerrado = false;
    (async () => {
      try {
        const { db, uid } = await sesionAlumno();
        const local = leerLocal();
        if (!local?.E) throw new ErrorTestGO(401, 'Tu sesión de examen ya no es válida.');
        const E = local.E;
        const pub = (await getDoc(doc(db, 'publico', E))).data();
        if (!pub) throw new ErrorTestGO(401, 'Este examen ya no existe.');
        // Siempre el centro actual, aunque el examen se creara antes de cambiarlo
        pub.centro = await leerCentro(db).catch(() => pub.centro || null);
        // Copiar y pegar lo decide el administrador para todo el centro (Normas obligatorias), no cada examen
        pub.copiarPegar = !(await leerAjustesExamenes(db)).normas.bloquearCopiarPegar;
        await cargarImagenes(db, idsImagenes(pub.preguntas, pub.centro));
        Object.assign(estadoAlumnoActual, { E, pub, uid, db });
        if (cerrado) return;

        // Señal de vida cada minuto; de paso sirve para calcular la diferencia con la hora de Firebase
        let enviadoEn = 0;
        const senal = () => {
          if (estadoAlumnoActual.intento?.estado === 'entregado') return;
          enviadoEn = Date.now();
          updateDoc(doc(db, 'publico', E, 'intentos', uid), { ultimaSenal: serverTimestamp() }).catch(() => {});
        };
        latido = setInterval(senal, 60000);

        parar = onSnapshot(doc(db, 'publico', E, 'intentos', uid), { includeMetadataChanges: true }, snap => {
          if (!snap.exists()) {
            if (leerLocal()?.pendiente) return cb({ pendiente: true });
            return alError(new ErrorTestGO(401, 'Tu sesión de examen ya no es válida.'));
          }
          if (leerLocal()?.pendiente) guardarLocal({ E });
          const intento = aIntento(snap);
          if (enviadoEn && !snap.metadata.hasPendingWrites && intento.ultimaSenal) {
            estadoAlumnoActual.desfase = intento.ultimaSenal - (enviadoEn + (Date.now() - enviadoEn) / 2);
            enviadoEn = 0;
          }
          estadoAlumnoActual.intento = intento;
          cb({ examen: pub, intento, nota: intento.notaPublicada || null, centro: pub.centro || null, desfase: estadoAlumnoActual.desfase });
        }, e => alError(traducir(e)));
        senal();
      } catch (e) {
        alError(traducir(e));
      }
    })();
    return () => {
      cerrado = true;
      clearInterval(latido);
      parar();
    };
  },

  comenzar: intentar(async () => {
    const { E, db, uid, intento } = estadoAlumnoActual;
    if (!intento || intento.inicio || intento.estado !== 'en_curso') return;
    const lote = writeBatch(db);
    lote.update(doc(db, 'publico', E, 'intentos', uid), { inicio: serverTimestamp() });
    lote.set(doc(collection(db, 'publico', E, 'intentos', uid, 'incidencias')), { t: serverTimestamp(), tipo: 'inicio', detalle: 'Empezó el examen' });
    await lote.commit();
  }),

  guardar: intentar(async respuestas => {
    const { E, db, uid, pub, intento, desfase } = estadoAlumnoActual;
    if (!intento || !N.puedeResponder(intento, Date.now() + desfase)) return;
    await updateDoc(doc(db, 'publico', E, 'intentos', uid), { respuestas: N.limpiarRespuestas(pub.preguntas, intento.orden, respuestas) });
  }),

  incidencia: intentar(async (tipo, detalle) => {
    const { E, db, uid, pub, intento } = estadoAlumnoActual;
    if (!intento || !N.TIPOS_INCIDENCIA.has(tipo)) return;
    const efecto = N.efectoIncidencia(intento, pub.maxSalidas, tipo, detalle, Date.now());
    if (!efecto) return;
    const lote = writeBatch(db);
    if (Object.keys(efecto.cambios).length) lote.update(doc(db, 'publico', E, 'intentos', uid), efecto.cambios);
    for (const r of efecto.registros) {
      lote.set(doc(collection(db, 'publico', E, 'intentos', uid, 'incidencias')), { t: serverTimestamp(), tipo: r.tipo, detalle: r.detalle });
    }
    await lote.commit();
  }),

  entregar: intentar(async (respuestas, automatico) => {
    const { E, db, uid, pub, intento, desfase } = estadoAlumnoActual;
    if (!intento || intento.estado === 'entregado') return;
    if (intento.estado === 'bloqueado') throw new ErrorTestGO(403, 'El examen está bloqueado. Avisa al profesor.');
    const motivo = automatico ? 'Entregado automáticamente al acabar el tiempo' : 'Entregado por el alumno';
    const cambios = { estado: 'entregado', entregadoEn: serverTimestamp(), motivoEntrega: motivo };
    // Pasado el tiempo, Firebase ya no acepta respuestas nuevas: se entrega lo último guardado
    if (N.puedeResponder(intento, Date.now() + desfase)) cambios.respuestas = N.limpiarRespuestas(pub.preguntas, intento.orden, respuestas);
    const lote = writeBatch(db);
    lote.update(doc(db, 'publico', E, 'intentos', uid), cambios);
    lote.set(doc(collection(db, 'publico', E, 'intentos', uid, 'incidencias')), { t: serverTimestamp(), tipo: 'entrega', detalle: motivo });
    await lote.commit();
  }),

  posicion: intentar(async (indice, etiqueta) => {
    const { E, db, uid, intento } = estadoAlumnoActual;
    if (!intento || intento.estado === 'entregado') return;
    await updateDoc(doc(db, 'publico', E, 'intentos', uid), {
      posicion: { indice, total: intento.orden.length, etiqueta: String(etiqueta ?? '').slice(0, 10), t: Date.now() },
    });
  }),

  olvidar: () => guardarLocal(null),
};

// ---------- Profesor ----------

const minusculas = correo => String(correo || '').toLowerCase().trim();

// Quién puede entrar, según Administración → Acceso y Profesores.
// Los administradores principales (ADMINS en config.js) son fijos: nadie los puede quitar desde el panel.
const acceso = { dominios: [DOMINIO_PROFESORES.replace(/^@/, '')], aprobarRegistros: false, adminsExtra: [] };
const cuenta = { estado: 'activo' };

// ajustes/acceso se puede leer sin haber iniciado sesión: hace falta para comprobar el correo al registrarse
async function cargarAcceso(db) {
  try {
    const d = (await getDoc(doc(db, 'ajustes', 'acceso'))).data();
    if (Array.isArray(d?.dominios) && d.dominios.length) acceso.dominios = d.dominios.map(minusculas);
    acceso.aprobarRegistros = !!d?.aprobarRegistros;
  } catch {}
}

async function cargarAdmins(db) {
  try {
    acceso.adminsExtra = ((await getDoc(doc(db, 'ajustes', 'admins'))).data()?.correos || []).map(minusculas);
  } catch {
    acceso.adminsExtra = [];
  }
}

const esAdminPrincipal = correo => ADMINS.map(minusculas).includes(minusculas(correo));
const esAdmin = correo => esAdminPrincipal(correo) || acceso.adminsExtra.includes(minusculas(correo));
const dominioDe = correo => minusculas(correo).split('@')[1] || '';
const dominioPermitido = correo => acceso.dominios.includes(dominioDe(correo));
const textoDominios = () => acceso.dominios.map(d => '@' + d).join(', ');
// Puede entrar al panel: cuenta de un dominio permitido o administrador
const esDelCentro = correo => dominioPermitido(correo) || esAdmin(correo);

// La ficha del profesor se crea la primera vez que entra. Su estado lo decide un administrador.
async function prepararFicha(db, u) {
  const ref = doc(db, 'profesores', u.uid);
  const email = minusculas(u.email);
  const s = await getDoc(ref);
  if (!s.exists()) {
    const estado = acceso.aprobarRegistros && !esAdmin(email) ? 'pendiente' : 'activo';
    await setDoc(ref, { email, estado, creado: serverTimestamp(), ultimoAcceso: serverTimestamp() });
    return estado;
  }
  const d = s.data();
  // El último acceso se apunta como mucho una vez cada hora, para no escribir en cada recarga
  if (Date.now() - (ms(d.ultimoAcceso) || 0) > 3600000 || d.email !== email) {
    updateDoc(ref, { email, ultimoAcceso: serverTimestamp() }).catch(() => {});
  }
  return d.estado || 'activo';
}

// Valores por defecto y normas de los exámenes (se leen una vez por sesión)
let ajustesExamenes = null;
async function leerAjustesExamenes(db) {
  if (!ajustesExamenes) {
    try {
      const d = (await getDoc(doc(db, 'ajustes', 'examenes'))).data() || {};
      ajustesExamenes = { defectos: d.defectos || {}, normas: d.normas || {} };
    } catch {
      ajustesExamenes = { defectos: {}, normas: {} };
    }
  }
  return ajustesExamenes;
}

// Un administrador puede usar el panel como profesor o como administrador.
// Se recuerda en este navegador; la primera vez entra como profesor.
const CLAVE_MODO = 'testgo.modoPanel';
const leerModo = () => {
  try {
    return localStorage.getItem(CLAVE_MODO) === 'admin' ? 'admin' : 'profesor';
  } catch {
    return 'profesor';
  }
};

async function sesionProfesor() {
  const c = conexion('profesor');
  await c.listo;
  const u = c.auth.currentUser;
  if (!u || u.isAnonymous || !u.emailVerified || !esDelCentro(u.email)) throw new ErrorTestGO(401, 'Inicia sesión');
  if (cuenta.estado !== 'activo' && !esAdmin(u.email)) throw new ErrorTestGO(403, 'Tu cuenta no está activa.');
  // admin: está usando el modo administrador ahora mismo
  return { ...c, uid: u.uid, email: u.email, admin: esAdmin(u.email) && leerModo() === 'admin' };
}

const examenes = new Map(); // caché de los exámenes completos, para corregir en el navegador

async function contarAlumnos(db, E) {
  const [todos, entregados] = await Promise.all([
    getCountFromServer(collection(db, 'publico', E, 'intentos')),
    getCountFromServer(query(collection(db, 'publico', E, 'intentos'), where('estado', '==', 'entregado'))),
  ]);
  return { alumnos: todos.data().count, entregados: entregados.data().count };
}

// Código de 6 letras que no use otro examen (se reserva dentro de una transacción)
async function reservarCodigo(db, E, uid) {
  for (let i = 0; i < 20; i++) {
    const codigo = N.codigoAleatorio(6);
    const libre = await runTransaction(db, async t => {
      const ref = doc(db, 'codigos', codigo);
      if ((await t.get(ref)).exists()) return false;
      t.set(ref, { examenId: E, propietario: uid });
      return true;
    });
    if (libre) return codigo;
  }
  throw new ErrorTestGO(503, 'No se pudo generar un código. Vuelve a intentarlo.');
}


// Lo que se guarda en publico/{E}: lo que ve el alumno
// Siempre con el dueño del examen, aunque lo edite un administrador
const documentoPublico = (ex, centro) => ({ ...N.datosPublicos(ex), codigo: ex.codigo, propietario: ex.propietario, centro });

async function leerIncidencias(db, E, uids) {
  const listas = await Promise.all(uids.map(u => getDocs(collection(db, 'publico', E, 'intentos', u, 'incidencias'))));
  return listas.flatMap(l => l.docs.map(aIncidencia)).sort((x, y) => x.t - y.t);
}

async function intentoCompleto(db, E, A) {
  const s = await getDoc(doc(db, 'publico', E, 'intentos', A));
  if (!s.exists()) throw new ErrorTestGO(404, 'Alumno no encontrado');
  const a = aIntento(s);
  a.incidencias = await leerIncidencias(db, E, [A, ...(a.uidsAnteriores || [])]);
  return a;
}

async function borrarColeccion(db, ruta) {
  const docs = (await getDocs(collection(db, ...ruta))).docs;
  for (let i = 0; i < docs.length; i += 400) {
    const lote = writeBatch(db);
    docs.slice(i, i + 400).forEach(d => lote.delete(d.ref));
    await lote.commit();
  }
  return docs;
}

const nuevaIncidencia = (lote, db, E, A, tipo, detalle) =>
  lote.set(doc(collection(db, 'publico', E, 'intentos', A, 'incidencias')), { t: serverTimestamp(), tipo, detalle: String(detalle || '').slice(0, 300) });

export const profesor = {
  modo: 'firebase',
  // El primer dominio permitido (para el ejemplo del campo de correo) y todos, para la ayuda
  get dominio() {
    return '@' + acceso.dominios[0];
  },
  get textoDominios() {
    return textoDominios();
  },
  urlImagen,

  async sesion() {
    const { auth, db } = conexion('profesor');
    await conexion('profesor').listo;
    await cargarAcceso(db);
    let u = auth.currentUser;
    if (u && !u.isAnonymous && !u.emailVerified) {
      await reload(u).catch(() => {});
      u = auth.currentUser;
      // Recién confirmado el correo: hace falta un token nuevo para que las reglas lo vean verificado
      if (u?.emailVerified) await u.getIdToken(true).catch(() => {});
    }
    if (!u || u.isAnonymous) return { conectado: false };
    await cargarAdmins(db);
    if (!esDelCentro(u.email)) {
      await signOut(auth);
      return { conectado: false, error: `Solo pueden entrar cuentas ${textoDominios()}.` };
    }
    if (!u.emailVerified) return { conectado: false, email: u.email, pendienteVerificar: true };
    // Pendiente de aprobar o bloqueado por un administrador: no entra al panel
    cuenta.estado = esAdmin(u.email) ? 'activo' : await prepararFicha(db, u);
    if (esAdmin(u.email)) prepararFicha(db, u).catch(() => {});
    if (cuenta.estado === 'pendiente') return { conectado: false, email: u.email, pendienteAprobacion: true };
    if (cuenta.estado === 'bloqueado') return { conectado: false, email: u.email, bloqueado: true };
    // puedeAdmin: es administrador; admin: tiene activado el modo administrador
    const puedeAdmin = esAdmin(u.email);
    // proveedor: 'password' (correo y contraseña) o 'google.com'
    const proveedor = u.providerData.some(p => p.providerId === 'password') ? 'password' : u.providerData[0]?.providerId || null;
    return { conectado: true, email: u.email, puedeAdmin, admin: puedeAdmin && leerModo() === 'admin', proveedor };
  },

  cambiarModo(modo) {
    try {
      localStorage.setItem(CLAVE_MODO, modo === 'admin' ? 'admin' : 'profesor');
    } catch {}
  },

  login: intentar(async (correo, clave) => {
    await signInWithEmailAndPassword(conexion('profesor').auth, correo.trim(), clave);
  }),

  loginGoogle: intentar(async () => {
    const { auth } = conexion('profesor');
    const proveedor = new GoogleAuthProvider();
    proveedor.setCustomParameters({ prompt: 'select_account' });
    const r = await signInWithPopup(auth, proveedor);
    await cargarAdmins(conexion('profesor').db);
    if (!esDelCentro(r.user.email)) {
      await signOut(auth);
      throw new ErrorTestGO(403, `Solo pueden entrar cuentas ${textoDominios()}. Has entrado con ${r.user.email}.`);
    }
  }),

  registrar: intentar(async (correo, clave) => {
    await cargarAcceso(conexion('profesor').db);
    if (!dominioPermitido(correo) && !esAdminPrincipal(correo)) throw new ErrorTestGO(400, `Solo se pueden crear cuentas con el correo del centro (${textoDominios()}).`);
    if (String(clave).length < 8) throw new ErrorTestGO(400, 'La contraseña debe tener al menos 8 caracteres.');
    const r = await createUserWithEmailAndPassword(conexion('profesor').auth, correo.trim(), clave);
    await sendEmailVerification(r.user);
  }),

  recuperar: intentar(async correo => sendPasswordResetEmail(conexion('profesor').auth, correo.trim())),
  reenviarVerificacion: intentar(async () => sendEmailVerification(conexion('profesor').auth.currentUser)),
  salir: () => signOut(conexion('profesor').auth),

  // ----- Exámenes -----

  // El administrador recibe los de todos los profesores, con el correo de cada dueño
  listarExamenes: intentar(async () => {
    const { db, uid, admin } = await sesionProfesor();
    const s = await getDocs(admin ? collection(db, 'examenes') : query(collection(db, 'examenes'), where('propietario', '==', uid)));
    const correos = new Map();
    if (admin) (await getDocs(collection(db, 'profesores'))).forEach(d => correos.set(d.id, d.data().email));
    const lista = await Promise.all(s.docs.map(async d => {
      const ex = d.data();
      return {
        id: d.id, titulo: ex.titulo, codigo: ex.codigo, abierto: ex.abierto, creado: ex.creado, preguntas: ex.preguntas.length,
        mio: ex.propietario === uid, propietarioEmail: ex.propietarioEmail || correos.get(ex.propietario) || '',
        ...(await contarAlumnos(db, d.id)),
      };
    }));
    return lista.sort((a, b) => b.creado - a.creado);
  }),

  crearExamen: intentar(async datos => {
    const { db, uid, email } = await sesionProfesor();
    const { defectos, normas } = await leerAjustesExamenes(db);
    const id = N.nuevoId();
    const codigo = await reservarCodigo(db, id, uid);
    const limpio = N.aplicarNormas(N.limpiarExamen(N.aplicarDefectos(datos, defectos)), normas);
    const ex = { id, ...limpio, codigo, abierto: false, creado: Date.now(), propietario: uid, propietarioEmail: email };
    const lote = writeBatch(db);
    lote.set(doc(db, 'examenes', id), ex);
    lote.set(doc(db, 'publico', id), documentoPublico(ex, await leerCentro(db)));
    await lote.commit();
    examenes.set(id, ex);
    return { ...ex, alumnos: 0 };
  }),

  obtenerExamen: intentar(async E => {
    const { db } = await sesionProfesor();
    const s = await getDoc(doc(db, 'examenes', E));
    if (!s.exists()) throw new ErrorTestGO(404, 'Examen no encontrado');
    const ex = s.data();
    examenes.set(E, ex);
    await cargarImagenes(db, idsImagenes(ex.preguntas));
    return { ...ex, ...(await contarAlumnos(db, E)) };
  }),

  guardarExamen: intentar(async (E, datos) => {
    const { db, uid } = await sesionProfesor();
    const previo = (await getDoc(doc(db, 'examenes', E))).data();
    if (!previo) throw new ErrorTestGO(404, 'Examen no encontrado');
    const { alumnos, entregados } = await contarAlumnos(db, E);
    const cambios = N.limpiarExamen(datos, previo);
    N.comprobarCambios(previo, cambios, alumnos > 0);
    const { normas } = await leerAjustesExamenes(db);
    const ex = N.aplicarNormas({ ...previo, ...cambios, ...(datos.abierto !== undefined ? { abierto: !!datos.abierto } : {}) }, normas);
    const lote = writeBatch(db);
    lote.set(doc(db, 'examenes', E), ex);
    lote.set(doc(db, 'publico', E), documentoPublico(ex, await leerCentro(db)));
    await lote.commit();
    examenes.set(E, ex);
    return { ...ex, alumnos, entregados };
  }),

  nuevoCodigo: intentar(async E => {
    const { db, uid } = await sesionProfesor();
    const ex = (await getDoc(doc(db, 'examenes', E))).data();
    const codigo = await reservarCodigo(db, E, ex.propietario);
    const lote = writeBatch(db);
    lote.delete(doc(db, 'codigos', ex.codigo));
    lote.update(doc(db, 'examenes', E), { codigo });
    lote.update(doc(db, 'publico', E), { codigo });
    await lote.commit();
    examenes.set(E, { ...ex, codigo });
    return { ...ex, codigo, ...(await contarAlumnos(db, E)) };
  }),

  borrarExamen: intentar(async E => {
    const { db } = await sesionProfesor();
    const ex = (await getDoc(doc(db, 'examenes', E))).data();
    // Primero lo de dentro: las reglas comprueban el dueño en publico/{E}
    const intentos = (await getDocs(collection(db, 'publico', E, 'intentos'))).docs;
    for (const i of intentos) await borrarColeccion(db, ['publico', E, 'intentos', i.id, 'incidencias']);
    await borrarColeccion(db, ['publico', E, 'intentos']);
    await borrarColeccion(db, ['publico', E, 'nombres']);
    await borrarColeccion(db, ['publico', E, 'solicitudes']);
    const lote = writeBatch(db);
    lote.delete(doc(db, 'publico', E));
    lote.delete(doc(db, 'examenes', E));
    if (ex?.codigo) lote.delete(doc(db, 'codigos', ex.codigo));
    await lote.commit();
    examenes.delete(E);
  }),

  // ----- En directo -----

  observarIntentos(E, cb, alError) {
    let paradas = [];
    let datos = { intentos: [], solicitudes: [], desfase: 0 };
    let cerrado = false;
    const avisar = () => cb({ ...datos });
    (async () => {
      try {
        const { db } = await sesionProfesor();
        if (!examenes.has(E)) examenes.set(E, (await getDoc(doc(db, 'examenes', E))).data());
        if (cerrado) return;
        paradas.push(onSnapshot(collection(db, 'publico', E, 'intentos'), s => {
          datos.intentos = s.docs.map(aIntento);
          avisar();
          revisar(db, E, datos.intentos).catch(() => {});
        }, e => alError(traducir(e))));
        paradas.push(onSnapshot(collection(db, 'publico', E, 'solicitudes'), s => {
          datos.solicitudes = s.docs.map(d => ({ id: d.id, ...d.data(), t: ms(d.data().t) }));
          avisar();
        }, e => alError(traducir(e))));
      } catch (e) {
        alError(traducir(e));
      }
    })();
    return () => {
      cerrado = true;
      paradas.forEach(p => p());
      paradas = [];
    };
  },

  intento: intentar(async (E, A) => {
    const { db } = await sesionProfesor();
    return intentoCompleto(db, E, A);
  }),

  intentosCompletos: intentar(async E => {
    const { db } = await sesionProfesor();
    const s = await getDocs(collection(db, 'publico', E, 'intentos'));
    return Promise.all(s.docs.map(async d => {
      const a = aIntento(d);
      a.incidencias = await leerIncidencias(db, E, [a.id, ...(a.uidsAnteriores || [])]);
      return a;
    }));
  }),

  accion: intentar(async (E, A, accion, datos) => {
    const { db } = await sesionProfesor();
    const a = await intentoCompleto(db, E, A);
    const efecto = N.efectoAccion(a, accion, datos, Date.now());
    if (efecto) {
      const lote = writeBatch(db);
      lote.update(doc(db, 'publico', E, 'intentos', A), efecto.cambios);
      nuevaIncidencia(lote, db, E, A, ...efecto.registro);
      await lote.commit();
    }
    return intentoCompleto(db, E, A);
  }),

  guardarCorreccion: intentar(async (E, A, correccion) => {
    const { db } = await sesionProfesor();
    const ex = examenes.get(E) || (await getDoc(doc(db, 'examenes', E))).data();
    const a = await intentoCompleto(db, E, A);
    await updateDoc(doc(db, 'publico', E, 'intentos', A), N.limpiarCorreccion(ex, a, correccion));
    return intentoCompleto(db, E, A);
  }),

  borrarIntento: intentar(async (E, A) => {
    const { db } = await sesionProfesor();
    const s = await getDoc(doc(db, 'publico', E, 'intentos', A));
    if (!s.exists()) return;
    const a = s.data();
    for (const u of [A, ...(a.uidsAnteriores || [])]) await borrarColeccion(db, ['publico', E, 'intentos', u, 'incidencias']);
    const lote = writeBatch(db);
    lote.delete(doc(db, 'publico', E, 'intentos', A));
    const nombre = await getDoc(doc(db, 'publico', E, 'nombres', a.nombreClave));
    if (nombre.exists() && nombre.data().uid === A) lote.delete(nombre.ref);
    await lote.commit();
  }),

  // El alumno ha entrado desde otro equipo (otra sesión): se le pasa su intento a la sesión nueva
  resolverSolicitud: intentar(async (E, S, aceptar) => {
    const { db } = await sesionProfesor();
    const solicitud = await getDoc(doc(db, 'publico', E, 'solicitudes', S));
    if (!solicitud.exists()) throw new ErrorTestGO(404, 'La solicitud ya no existe.');
    if (!aceptar) return deleteDoc(solicitud.ref);
    const { nombreClave } = solicitud.data();
    const nombre = await getDoc(doc(db, 'publico', E, 'nombres', nombreClave));
    if (!nombre.exists()) throw new ErrorTestGO(404, 'Ya no hay ningún alumno con ese nombre. Dile que vuelva a entrar normalmente.');
    const anterior = nombre.data().uid;
    const viejo = await getDoc(doc(db, 'publico', E, 'intentos', anterior));
    if (!viejo.exists()) throw new ErrorTestGO(404, 'Ya no hay ningún alumno con ese nombre. Dile que vuelva a entrar normalmente.');
    const datos = viejo.data();
    const lote = writeBatch(db);
    lote.set(doc(db, 'publico', E, 'intentos', S), { ...datos, uidsAnteriores: [...(datos.uidsAnteriores || []), anterior] });
    lote.update(nombre.ref, { uid: S });
    lote.delete(viejo.ref);
    lote.delete(solicitud.ref);
    nuevaIncidencia(lote, db, E, S, 'reentrada', 'Volvió a entrar desde otro equipo, permitido por el profesor');
    await lote.commit();
  }),

  // ----- Centro e imágenes -----

  centro: intentar(async () => {
    const { db } = await sesionProfesor();
    const c = await leerCentro(db);
    await cargarImagenes(db, [c.logo]);
    return c;
  }),

  // Solo un administrador: el nombre y el logo son los mismos para todos
  guardarCentro: intentar(async ({ nombre, logo, mensajeAlumnos }) => {
    const { db, admin } = await sesionProfesor();
    if (!admin) throw new ErrorTestGO(403, 'Solo un administrador puede cambiar el nombre y el logo del centro.');
    const previo = await leerCentro(db);
    const centro = {
      nombre: String(nombre ?? previo.nombre).trim().slice(0, 150),
      logo: logo === undefined ? previo.logo : logo || null,
      mensajeAlumnos: String(mensajeAlumnos ?? previo.mensajeAlumnos).trim().slice(0, 300),
    };
    await setDoc(doc(db, 'ajustes', 'centro'), centro);
    // Los exámenes ya creados, de todos los profesores, también lo enseñan
    const s = await getDocs(collection(db, 'examenes'));
    for (let i = 0; i < s.docs.length; i += 400) {
      const lote = writeBatch(db);
      s.docs.slice(i, i + 400).forEach(d => lote.update(doc(db, 'publico', d.id), { centro }));
      await lote.commit();
    }
    return centro;
  }),

  // Valores por defecto y normas del centro (para enseñarlas en los ajustes del examen)
  ajustesExamenes: intentar(async () => {
    const { db } = await sesionProfesor();
    return leerAjustesExamenes(db);
  }),

  // Aviso del centro para todos los profesores, si hay uno activo
  aviso: intentar(async () => {
    const { db } = await sesionProfesor();
    const d = (await getDoc(doc(db, 'ajustes', 'aviso'))).data();
    return d?.activo && d.texto ? { texto: d.texto, tipo: d.tipo || 'info', t: ms(d.t) || 0 } : null;
  }),

  subirImagen: intentar(async datos => {
    const { db, uid } = await sesionProfesor();
    const reducida = await encoger(datos);
    const id = N.nuevoId(12);
    await setDoc(doc(db, 'imagenes', id), { datos: reducida, propietario: uid });
    imagenes.set(id, reducida);
    return id;
  }),
};

// ---------- Administración ----------
// Solo para un administrador con el modo Admin activado. Las reglas de Firestore lo vuelven a comprobar.

async function soloAdmin() {
  const s = await sesionProfesor();
  if (!s.admin) throw new ErrorTestGO(403, 'Esto solo lo puede hacer un administrador en modo Admin.');
  return s;
}

const limpiarDominio = d => minusculas(d).replace(/^@/, '');
const dominioValido = d => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);

export const admin = {
  principales: ADMINS.map(minusculas),

  leerAjustes: intentar(async () => {
    const { db } = await soloAdmin();
    const leer = async nombre => (await getDoc(doc(db, 'ajustes', nombre))).data() || {};
    const [acc, adm, exs, aviso] = await Promise.all(['acceso', 'admins', 'examenes', 'aviso'].map(leer));
    const centro = await leerCentro(db);
    await cargarImagenes(db, [centro.logo]);
    return {
      acceso: { dominios: acc.dominios?.length ? acc.dominios : acceso.dominios, aprobarRegistros: !!acc.aprobarRegistros },
      admins: adm.correos || [],
      centro,
      examenes: { defectos: exs.defectos || {}, normas: exs.normas || {} },
      aviso: { texto: aviso.texto || '', tipo: aviso.tipo || 'info', activo: !!aviso.activo },
    };
  }),

  // ----- Profesores -----

  profesores: intentar(async () => {
    const { db } = await soloAdmin();
    const [fichas, todos] = await Promise.all([getDocs(collection(db, 'profesores')), getDocs(collection(db, 'examenes'))]);
    await cargarAdmins(db);
    const porProfesor = {};
    todos.forEach(d => {
      const p = d.data().propietario;
      porProfesor[p] = (porProfesor[p] || 0) + 1;
    });
    const orden = { pendiente: 0, activo: 1, bloqueado: 2 };
    return fichas.docs.map(d => {
      const x = d.data();
      const email = minusculas(x.email);
      return {
        uid: d.id, email, estado: x.estado || 'activo', creado: ms(x.creado), ultimoAcceso: ms(x.ultimoAcceso),
        examenes: porProfesor[d.id] || 0,
        rol: esAdminPrincipal(email) ? 'principal' : acceso.adminsExtra.includes(email) ? 'admin' : 'profesor',
      };
    }).sort((a, b) => orden[a.estado] - orden[b.estado] || a.email.localeCompare(b.email));
  }),

  cambiarEstado: intentar(async (uid, estado) => {
    const { db, uid: yo } = await soloAdmin();
    if (uid === yo) throw new ErrorTestGO(400, 'No puedes cambiar tu propia cuenta.');
    if (!['activo', 'pendiente', 'bloqueado'].includes(estado)) throw new ErrorTestGO(400, 'Estado no válido.');
    await updateDoc(doc(db, 'profesores', uid), { estado });
  }),

  cambiarAdmin: intentar(async (email, hacerAdmin) => {
    const { db, email: yo } = await soloAdmin();
    email = minusculas(email);
    if (esAdminPrincipal(email)) throw new ErrorTestGO(400, 'Los administradores principales no se pueden cambiar desde el panel.');
    if (!hacerAdmin && email === minusculas(yo)) throw new ErrorTestGO(400, 'No puedes quitarte a ti mismo el rol de administrador.');
    await cargarAdmins(db);
    const correos = hacerAdmin ? [...new Set([...acceso.adminsExtra, email])] : acceso.adminsExtra.filter(c => c !== email);
    await setDoc(doc(db, 'ajustes', 'admins'), { correos });
    acceso.adminsExtra = correos;
  }),

  // ----- Acceso -----

  guardarAcceso: intentar(async ({ dominios, aprobarRegistros }) => {
    const { db } = await soloAdmin();
    const lista = [...new Set((dominios || []).map(limpiarDominio).filter(dominioValido))].slice(0, 20);
    if (!lista.length) throw new ErrorTestGO(400, 'Pon al menos un dominio, por ejemplo edu.gva.es.');
    const datos = { dominios: lista, aprobarRegistros: !!aprobarRegistros };
    await setDoc(doc(db, 'ajustes', 'acceso'), datos);
    Object.assign(acceso, datos);
    return datos;
  }),

  // ----- Centro y mensajes -----

  guardarCentro: datos => profesor.guardarCentro(datos),

  guardarAviso: intentar(async ({ texto, tipo, activo }) => {
    const { db } = await soloAdmin();
    const datos = {
      texto: String(texto || '').trim().slice(0, 500),
      tipo: ['info', 'aviso', 'urgente'].includes(tipo) ? tipo : 'info',
      activo: !!activo && !!String(texto || '').trim(),
      t: serverTimestamp(),
    };
    await setDoc(doc(db, 'ajustes', 'aviso'), datos);
    return { ...datos, t: Date.now() };
  }),

  // ----- Exámenes -----

  guardarExamenes: intentar(async ({ defectos = {}, normas = {} }) => {
    const { db } = await soloAdmin();
    const limpio = {
      defectos: {
        modo: N.MODOS[defectos.modo] && defectos.modo !== 'personalizado' ? defectos.modo : '',
        duracion: Math.round(N.acotar(defectos.duracion, 60, 1, 600)),
        penalizacion: N.acotar(defectos.penalizacion, 0, 0, 1),
      },
      normas: {
        marcaAgua: !!normas.marcaAgua,
        barajar: !!normas.barajar,
        ocultarNota: !!normas.ocultarNota,
        salidasMaximas: Math.round(N.acotar(normas.salidasMaximas, 0, 0, 50)),
        bloquearCopiarPegar: !!normas.bloquearCopiarPegar,
      },
    };
    await setDoc(doc(db, 'ajustes', 'examenes'), limpio);
    ajustesExamenes = limpio;
    return limpio;
  }),

  // ----- Datos -----

  uso: intentar(async () => {
    const { db } = await soloAdmin();
    const contar = async q => (await getCountFromServer(q)).data().count;
    const [profesores, pendientes, examenesTotal, abiertos, intentos] = await Promise.all([
      contar(collection(db, 'profesores')),
      contar(query(collection(db, 'profesores'), where('estado', '==', 'pendiente'))),
      contar(collection(db, 'examenes')),
      contar(query(collection(db, 'examenes'), where('abierto', '==', true))),
      contar(collectionGroup(db, 'intentos')),
    ]);
    return { profesores, pendientes, examenes: examenesTotal, abiertos, intentos };
  }),

  // Exámenes creados hace más de esos meses (cerrados: los abiertos no se tocan)
  examenesAntiguos: intentar(async meses => {
    const { db } = await soloAdmin();
    const limite = Date.now() - Number(meses) * 30.44 * 864e5;
    const s = await getDocs(query(collection(db, 'examenes'), where('creado', '<', limite)));
    return s.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(e => !e.abierto)
      .map(e => ({ id: e.id, titulo: e.titulo, creado: e.creado, propietarioEmail: e.propietarioEmail || '' }))
      .sort((a, b) => a.creado - b.creado);
  }),

  borrarExamenes: intentar(async (ids, alAvanzar) => {
    await soloAdmin();
    for (let i = 0; i < ids.length; i++) {
      await profesor.borrarExamen(ids[i]);
      alAvanzar?.(i + 1, ids.length);
    }
  }),

  // Copia de todo en un objeto: ajustes, profesores, exámenes y respuestas de los alumnos
  copia: intentar(async alAvanzar => {
    const { db } = await soloAdmin();
    const ajustes = {};
    for (const nombre of ['acceso', 'admins', 'centro', 'examenes', 'aviso']) ajustes[nombre] = (await getDoc(doc(db, 'ajustes', nombre))).data() || null;
    const profesores = (await getDocs(collection(db, 'profesores'))).docs.map(d => ({ uid: d.id, ...d.data(), creado: ms(d.data().creado), ultimoAcceso: ms(d.data().ultimoAcceso) }));
    const lista = (await getDocs(collection(db, 'examenes'))).docs;
    const examenesCopia = [];
    for (let i = 0; i < lista.length; i++) {
      const intentos = (await getDocs(collection(db, 'publico', lista[i].id, 'intentos'))).docs.map(aIntento);
      examenesCopia.push({ ...lista[i].data(), intentos });
      alAvanzar?.(i + 1, lista.length);
    }
    return { app: 'TestGO', version: 1, fecha: new Date().toISOString(), ajustes, profesores, examenes: examenesCopia };
  }),
};

// Lo que en el servidor propio hace el servidor y aquí hace el panel del profesor mientras está abierto:
// entregar los exámenes a los que se les acabó el tiempo y publicar la nota si el examen la enseña
async function revisar(db, E, intentos) {
  const ex = examenes.get(E);
  if (!ex) return;
  const ahora = Date.now();
  for (const a of intentos) {
    if (a.estado !== 'entregado' && a.inicio && ahora > N.limiteDe(a) + 60000) {
      const lote = writeBatch(db);
      lote.update(doc(db, 'publico', E, 'intentos', a.id), { estado: 'entregado', entregadoEn: N.limiteDe(a), motivoEntrega: 'Tiempo agotado', bloqueadoPor: null });
      nuevaIncidencia(lote, db, E, a.id, 'entrega', 'Tiempo agotado');
      await lote.commit();
      continue;
    }
    if (ex.mostrarNota && a.estado === 'entregado') {
      const c = N.corregir(ex, a);
      const nota = { nota: c.nota, total: c.total, max: c.max, pendiente: c.pendiente };
      if (JSON.stringify(nota) !== JSON.stringify(a.notaPublicada || null)) {
        await updateDoc(doc(db, 'publico', E, 'intentos', a.id), { notaPublicada: nota });
      }
    }
  }
}
