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
 *   profesores/{uid}                      { centro: { nombre, logo } }
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, signInWithPopup, GoogleAuthProvider, reload,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where,
  onSnapshot, writeBatch, runTransaction, serverTimestamp, getCountFromServer,
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
  centro: async () => null,
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
const esAdmin = correo => ADMINS.map(minusculas).includes(minusculas(correo));
// Puede entrar al panel: cuenta del centro o administrador
const esDelCentro = correo => minusculas(correo).endsWith(DOMINIO_PROFESORES) || esAdmin(correo);

async function sesionProfesor() {
  const c = conexion('profesor');
  await c.listo;
  const u = c.auth.currentUser;
  if (!u || u.isAnonymous || !u.emailVerified || !esDelCentro(u.email)) throw new ErrorTestGO(401, 'Inicia sesión');
  return { ...c, uid: u.uid, email: u.email, admin: esAdmin(u.email) };
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

async function centroDe(db, uid) {
  const s = await getDoc(doc(db, 'profesores', uid));
  return { nombre: s.data()?.centro?.nombre || '', logo: s.data()?.centro?.logo || null };
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
  dominio: DOMINIO_PROFESORES,
  urlImagen,

  async sesion() {
    const { auth } = conexion('profesor');
    await conexion('profesor').listo;
    let u = auth.currentUser;
    if (u && !u.isAnonymous && !u.emailVerified) {
      await reload(u).catch(() => {});
      u = auth.currentUser;
      // Recién confirmado el correo: hace falta un token nuevo para que las reglas lo vean verificado
      if (u?.emailVerified) await u.getIdToken(true).catch(() => {});
    }
    if (!u || u.isAnonymous) return { conectado: false };
    if (!esDelCentro(u.email)) {
      await signOut(auth);
      return { conectado: false, error: `Solo pueden entrar cuentas ${DOMINIO_PROFESORES}.` };
    }
    if (!u.emailVerified) return { conectado: false, email: u.email, pendienteVerificar: true };
    return { conectado: true, email: u.email, admin: esAdmin(u.email) };
  },

  login: intentar(async (correo, clave) => {
    if (!esDelCentro(correo)) throw new ErrorTestGO(400, `Usa tu correo del centro (${DOMINIO_PROFESORES}).`);
    await signInWithEmailAndPassword(conexion('profesor').auth, correo.trim(), clave);
  }),

  loginGoogle: intentar(async () => {
    const { auth } = conexion('profesor');
    const proveedor = new GoogleAuthProvider();
    proveedor.setCustomParameters({ prompt: 'select_account' });
    const r = await signInWithPopup(auth, proveedor);
    if (!esDelCentro(r.user.email)) {
      await signOut(auth);
      throw new ErrorTestGO(403, `Solo pueden entrar cuentas ${DOMINIO_PROFESORES}. Has entrado con ${r.user.email}.`);
    }
  }),

  registrar: intentar(async (correo, clave) => {
    if (!esDelCentro(correo)) throw new ErrorTestGO(400, `Solo se pueden crear cuentas con el correo del centro (${DOMINIO_PROFESORES}).`);
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
    const id = N.nuevoId();
    const codigo = await reservarCodigo(db, id, uid);
    const ex = { id, ...N.limpiarExamen(datos), codigo, abierto: false, creado: Date.now(), propietario: uid, propietarioEmail: email };
    const lote = writeBatch(db);
    lote.set(doc(db, 'examenes', id), ex);
    lote.set(doc(db, 'publico', id), documentoPublico(ex, await centroDe(db, uid)));
    lote.set(doc(db, 'profesores', uid), { email }, { merge: true });
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
    const ex = { ...previo, ...cambios, ...(datos.abierto !== undefined ? { abierto: !!datos.abierto } : {}) };
    const lote = writeBatch(db);
    lote.set(doc(db, 'examenes', E), ex);
    lote.set(doc(db, 'publico', E), documentoPublico(ex, await centroDe(db, ex.propietario)));
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
    const { db, uid } = await sesionProfesor();
    const c = await centroDe(db, uid);
    await cargarImagenes(db, [c.logo]);
    return c;
  }),

  guardarCentro: intentar(async ({ nombre, logo }) => {
    const { db, uid } = await sesionProfesor();
    const centro = { nombre: String(nombre ?? '').trim().slice(0, 150), logo: logo || null };
    await setDoc(doc(db, 'profesores', uid), { centro }, { merge: true });
    // Los exámenes ya creados también lo enseñan
    const s = await getDocs(query(collection(db, 'examenes'), where('propietario', '==', uid)));
    for (let i = 0; i < s.docs.length; i += 400) {
      const lote = writeBatch(db);
      s.docs.slice(i, i + 400).forEach(d => lote.update(doc(db, 'publico', d.id), { centro }));
      await lote.commit();
    }
    return centro;
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
