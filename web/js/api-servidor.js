// Conexión con servidor/servidor.js por HTTP
import { ErrorTestGO } from './nucleo.js';

const CLAVE_TOKEN = 'testgo.token';

function leerToken() {
  try {
    return localStorage.getItem(CLAVE_TOKEN) || '';
  } catch {
    return '';
  }
}

function guardarToken(t) {
  try {
    if (t) localStorage.setItem(CLAVE_TOKEN, t);
    else localStorage.removeItem(CLAVE_TOKEN);
  } catch {}
}

async function pedir(metodo, ruta, cuerpo, cabeceras = {}) {
  let res;
  try {
    res = await fetch(ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...cabeceras },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      credentials: 'same-origin',
    });
  } catch {
    throw new ErrorTestGO(0, 'No hay conexión con el servidor.', 'sin_conexion');
  }
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErrorTestGO(res.status, datos.error || `Error ${res.status}`, datos.codigo || '');
  return datos;
}

const urlImagen = id => `/api/imagenes/${encodeURIComponent(id)}`;

// ---------- Alumno ----------

let observador = null;

const conToken = (metodo, ruta, cuerpo) => pedir(metodo, ruta, cuerpo, { 'X-Token': leerToken() });

function emitir(estado) {
  if (!observador || !estado?.intento) return estado;
  observador.cb({ ...estado, desfase: estado.ahora - Date.now() });
  return estado;
}

export const alumno = {
  sesionGuardada: () => !!leerToken(),
  centro: () => pedir('GET', '/api/publico/centro'),
  urlImagen,

  async entrar(codigo, nombre) {
    const { token } = await pedir('POST', '/api/alumno/entrar', { codigo, nombre });
    guardarToken(token);
  },

  async solicitarReentrada(codigo, nombre) {
    const { token } = await pedir('POST', '/api/alumno/solicitar', { codigo, nombre });
    guardarToken(token);
  },

  observar(cb, alError) {
    let parado = false;
    let espera = null;
    observador = { cb };
    const ciclo = async () => {
      if (parado) return;
      let siguiente = 5000;
      try {
        const estado = await conToken('GET', '/api/alumno/estado');
        if (estado.token) {
          guardarToken(estado.token);
          siguiente = 0;
        } else if (estado.pendiente) {
          cb({ pendiente: true });
          siguiente = 3000;
        } else {
          emitir(estado);
        }
      } catch (e) {
        if (e.estado === 401) {
          guardarToken('');
          parado = true;
        }
        alError(e);
      }
      if (!parado) espera = setTimeout(ciclo, siguiente);
    };
    ciclo();
    return () => {
      parado = true;
      clearTimeout(espera);
      observador = null;
    };
  },

  comenzar: () => conToken('POST', '/api/alumno/comenzar', {}).then(emitir),
  guardar: respuestas => conToken('POST', '/api/alumno/guardar', { respuestas }).then(emitir),
  incidencia: (tipo, detalle) => conToken('POST', '/api/alumno/incidencia', { tipo, detalle }).then(emitir),
  entregar: (respuestas, automatico) => conToken('POST', '/api/alumno/entregar', { respuestas, automatico }).then(emitir),
  olvidar: () => guardarToken(''),
};

// ---------- Profesor ----------

const ex = E => `/api/profesor/examenes/${encodeURIComponent(E)}`;
const it = (E, A) => `${ex(E)}/intentos/${encodeURIComponent(A)}`;

export const profesor = {
  modo: 'servidor',

  sesion: () => pedir('GET', '/api/profesor/sesion'),
  configurar: password => pedir('POST', '/api/profesor/configurar', { password }),
  login: password => pedir('POST', '/api/profesor/login', { password }),
  salir: () => pedir('POST', '/api/profesor/salir', {}),
  cambiarPassword: password => pedir('PUT', '/api/profesor/password', { password }),
  direcciones: () => pedir('GET', '/api/profesor/direcciones'),
  centro: () => pedir('GET', '/api/profesor/centro'),
  guardarCentro: datos => pedir('PUT', '/api/profesor/centro', datos),
  subirImagen: datos => pedir('POST', '/api/profesor/imagenes', { datos }).then(r => r.id),
  urlImagen,

  listarExamenes: () => pedir('GET', '/api/profesor/examenes'),
  crearExamen: datos => pedir('POST', '/api/profesor/examenes', datos),
  obtenerExamen: E => pedir('GET', ex(E)),
  guardarExamen: (E, datos) => pedir('PUT', ex(E), datos),
  nuevoCodigo: E => pedir('POST', `${ex(E)}/codigo`, {}),
  borrarExamen: E => pedir('DELETE', ex(E)),

  observarIntentos(E, cb, alError) {
    let parado = false;
    let espera = null;
    const ciclo = async () => {
      if (parado) return;
      try {
        const r = await pedir('GET', `${ex(E)}/intentos`);
        if (!parado) cb({ intentos: r.intentos, solicitudes: r.solicitudes, desfase: r.ahora - Date.now() });
      } catch (e) {
        alError(e);
      }
      if (!parado) espera = setTimeout(ciclo, 3000);
    };
    ciclo();
    return () => {
      parado = true;
      clearTimeout(espera);
    };
  },

  intento: (E, A) => pedir('GET', it(E, A)),
  intentosCompletos: E => pedir('GET', `${ex(E)}/intentos?completo=1`).then(r => r.intentos),
  accion: (E, A, accion, datos) => pedir('POST', `${it(E, A)}/accion`, { accion, datos }),
  // correccion: { notasManual, comentarios, rubricas }
  guardarCorreccion: (E, A, correccion) => pedir('PUT', `${it(E, A)}/notas`, correccion),
  borrarIntento: (E, A) => pedir('DELETE', it(E, A)),
  resolverSolicitud: (E, S, aceptar) => pedir('POST', `${ex(E)}/solicitudes/${encodeURIComponent(S)}`, { aceptar }),
};
