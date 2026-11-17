import { alumno as api } from './api.js';
import * as N from './nucleo.js';
import { $, $$, h, vaciar, marca, notificar, notificarError, confirmar, ocupado, relojTexto, icono } from './comun.js';

const app = $('#app');
const estadoGuardado = $('#estado-guardado');
const ESPERA_GUARDADO_MS = 3000;

let actual = null; // último estado recibido: { examen, intento, nota, desfase }
let pantalla = '';
let respuestas = {};
let respuestasCargadas = false;
let pendienteGuardar = false;
let temporizadorGuardado = null;
let pararObservador = null;
let entregando = false;

const ahoraServidor = () => Date.now() + (actual?.desfase || 0);

// ---------- Entrada ----------

function pantallaEntrada(error = '', datos = {}) {
  pantalla = 'entrada';
  estadoGuardado.textContent = '';
  // El código se escribe en un solo campo, que se ve como seis casillas
  const LARGO = 6;
  const casillas = [...Array(LARGO)].map(() => h('span', { class: 'casilla-codigo', 'aria-hidden': 'true' }));
  const codigo = h('input', {
    type: 'text', id: 'codigo-examen', class: 'codigo-oculto', maxlength: LARGO, autocomplete: 'one-time-code', inputmode: 'text',
    autocapitalize: 'characters', spellcheck: false, 'aria-describedby': 'ayuda-codigo',
    value: N.limpiarCodigo(datos.codigo || new URLSearchParams(location.search).get('c') || '').slice(0, LARGO), required: true,
  });
  const pintarCasillas = () => {
    const v = codigo.value;
    const activa = document.activeElement === codigo ? Math.min(v.length, LARGO - 1) : -1;
    casillas.forEach((c, i) => {
      c.textContent = v[i] || '';
      c.classList.toggle('llena', !!v[i]);
      c.classList.toggle('activa', i === activa);
    });
  };
  codigo.addEventListener('input', () => {
    const limpio = N.limpiarCodigo(codigo.value).slice(0, LARGO);
    if (limpio !== codigo.value) codigo.value = limpio;
    pintarCasillas();
    if (limpio.length === LARGO && !nombre.value) nombre.focus();
  });
  ['focus', 'blur', 'keyup', 'click'].forEach(ev => codigo.addEventListener(ev, pintarCasillas));
  const cajaCodigo = h('div', { class: 'codigo-cajas' }, casillas, codigo);

  const nombre = h('input', { type: 'text', id: 'nombre-alumno', autocomplete: 'name', placeholder: 'Ej.: Laura Martínez Pérez', value: datos.nombre || '', required: true, maxlength: 80 });
  const mensaje = h('p', { class: 'error-campo', role: 'alert' }, error);
  const zonaReentrada = h('div');
  const boton = h('button', { class: 'boton primario grande boton-entrar', type: 'submit' }, h('span', {}, 'Entrar al examen'), icono('flecha'));

  const formulario = h('form', {
    class: 'pila',
    onsubmit: async e => {
      e.preventDefault();
      mensaje.textContent = '';
      vaciar(zonaReentrada);
      if (!codigo.value.trim()) return (mensaje.textContent = 'Escribe el código del examen.');
      if (codigo.value.length < LARGO) return (mensaje.textContent = `El código tiene ${LARGO} caracteres.`);
      if (N.limpiarNombre(nombre.value).length < 3) return (mensaje.textContent = 'Escribe tu nombre y apellidos.');
      boton.disabled = true;
      boton.classList.add('cargando');
      try {
        await api.entrar(codigo.value, nombre.value);
        iniciar();
      } catch (err) {
        mensaje.textContent = err.message;
        if (err.codigo === 'nombre_ocupado') {
          zonaReentrada.append(
            h('button', {
              class: 'boton', type: 'button',
              onclick: ev => ocupado(ev.currentTarget, async () => {
                await api.solicitarReentrada(codigo.value, nombre.value);
                iniciar();
              }),
            }, 'Pedir al profesor volver a entrar'),
          );
        }
      } finally {
        boton.disabled = false;
        boton.classList.remove('cargando');
      }
    },
  },
    h('div', { class: 'campo' },
      h('label', { for: 'codigo-examen' }, 'Código del examen'),
      cajaCodigo,
      h('small', { id: 'ayuda-codigo' }, 'Te lo da tu profesor al empezar.'),
    ),
    h('div', { class: 'campo' },
      h('label', { for: 'nombre-alumno' }, 'Nombre y apellidos'),
      h('div', { class: 'campo-icono' }, icono('usuario'), nombre),
      h('small', {}, 'Completo, tal como te conoce tu profesor.'),
    ),
    mensaje,
    zonaReentrada,
    boton,
  );

  const centro = h('div', { class: 'centro-entrada' });
  // El nombre y el logo del centro, y su mensaje para los alumnos, si los hay
  api.centro?.().then(c => centro.append(
    bloqueCentro(c) || '',
    c?.mensajeAlumnos ? h('p', { class: 'mensaje-centro' }, c.mensajeAlumnos) : '',
  )).catch(() => {});

  // Solo una tarjeta flotante sobre la foto de fondo
  vaciar(app, h('div', { class: 'entrada' },
    h('div', { class: 'tarjeta-entrada' },
      h('div', { class: 'marca-entrada' }, marca(true)),
      centro,
      h('h1', { class: 'titulo-entrada' }, 'Entrar al examen'),
      formulario,
      // Para los profesores: lleva al panel (allí se inicia sesión)
      h('div', { class: 'acceso-profesor' },
        h('span', {}, '¿Eres profesor?'),
        h('a', { class: 'boton fantasma mini', href: '/profesor' }, icono('usuario'), 'Acceso para profesores', icono('flecha')),
      ),
    ),
  ));
  pintarCasillas();
  (codigo.value.length === LARGO ? nombre : codigo).focus();
  pintarCasillas();
}

function bloqueCentro(centro) {
  if (!centro?.nombre && !centro?.logo) return null;
  return h('div', { class: 'centro' },
    centro.logo ? h('img', { src: api.urlImagen(centro.logo), alt: '' }) : null,
    centro.nombre ? h('span', {}, centro.nombre) : null,
  );
}

function pantallaPendiente() {
  if (pantalla === 'pendiente') return;
  pantalla = 'pendiente';
  vaciar(app, h('div', { class: 'centrado' }, h('div', { class: 'tarjeta tarjeta-login', style: { textAlign: 'center' } },
    icono('reloj', 'icono-grande'),
    h('h2', {}, 'Esperando al profesor'),
    h('p', { class: 'suave' }, 'Le hemos pedido que te deje volver a entrar con tu nombre. En cuanto acepte, seguirás donde lo dejaste.'),
    h('button', { class: 'boton fantasma', onclick: salirAlInicio }, 'Cancelar'),
  )));
}

function salirAlInicio() {
  pararObservador?.();
  api.olvidar();
  actual = null;
  respuestasCargadas = false;
  pantallaEntrada();
}

// ---------- Ciclo principal ----------

function iniciar() {
  pararObservador?.();
  respuestasCargadas = false;
  pararObservador = api.observar(alCambiar, err => {
    if (err.estado === 401) {
      quitarVigilancia();
      pararObservador?.();
      pantallaEntrada(err.message);
    } else if (err.codigo === 'sin_conexion') {
      estadoGuardado.textContent = 'Sin conexión: se guardará al volver';
    } else {
      notificarError(err);
    }
  });
}

function alCambiar(estado) {
  if (estado.pendiente) return pantallaPendiente();
  actual = estado;
  const { intento } = estado;
  if (!respuestasCargadas) {
    respuestas = { ...(intento.respuestas || {}) };
    respuestasCargadas = true;
  }
  if (pendienteGuardar && estadoGuardado.textContent.startsWith('Sin conexión')) programarGuardado(0);
  if (intento.estado === 'entregado') return pantallaEntregado();
  if (!intento.inicio) return pantallaInstrucciones();
  pantallaExamen();
}

// ---------- Instrucciones ----------

function pantallaInstrucciones() {
  if (pantalla === 'instrucciones') return;
  pantalla = 'instrucciones';
  const { examen, intento } = actual;
  const total = intento.orden.length;
  const empezar = h('button', {
    class: 'boton primario grande boton-azul boton-empezar',
    onclick: ev => ocupado(ev.currentTarget, async () => {
      pedirPantallaCompleta(); // sin esperar: si el navegador no la concede, el examen empieza igual
      await api.comenzar();
    }),
  }, h('span', {}, 'Empezar el examen'), icono('flecha'));
  const salidas = examen.maxSalidas === 1
    ? 'Si sales de la pantalla completa o cambias de pestaña, el examen se bloquea y tendrás que avisar al profesor.'
    : examen.maxSalidas
      ? `Cada salida queda registrada. A la ${examen.maxSalidas}.ª el examen se bloquea y tendrás que avisar al profesor.`
      : 'Se abre a pantalla completa. Cada vez que salgas, el profesor lo verá.';
  const norma = (ico, texto, clase = '') => h('li', { class: clase }, h('span', { class: 'icono-norma' }, icono(ico)), h('span', {}, texto));
  vaciar(app, h('div', { class: 'instrucciones' },
    bloqueCentro(actual.centro),
    h('p', { class: 'saludo' }, `Hola, ${intento.nombre}`),
    examen.asignatura ? h('p', { class: 'asignatura' }, examen.asignatura) : null,
    h('h1', {}, examen.titulo),
    h('div', { class: 'datos-instrucciones' },
      h('div', {}, h('b', {}, `${examen.duracion} min`), h('span', {}, 'de tiempo')),
      h('div', {}, h('b', {}, total), h('span', {}, total === 1 ? 'pregunta' : 'preguntas')),
      examen.maxSalidas ? h('div', {}, h('b', {}, examen.maxSalidas - 1), h('span', {}, examen.maxSalidas - 1 === 1 ? 'salida permitida' : 'salidas permitidas')) : null,
    ),
    h('ul', { class: 'normas' },
      norma('pantalla', salidas, examen.maxSalidas === 1 ? 'importante' : ''),
      norma('check', 'Tus respuestas se guardan solas mientras escribes.'),
      norma('reloj', 'El tiempo empieza al pulsar el botón. Al acabar, el examen se entrega solo.'),
      examen.penalizacion ? norma('aviso', `En las de test, cada fallo resta un ${N.numero(examen.penalizacion * 100)} % de lo que vale la pregunta. En blanco no resta.`) : null,
      examen.marcaAgua ? norma('usuario', 'Tu nombre y la fecha salen de fondo en todo el examen.') : null,
    ),
    empezar,
  ));
}

async function pedirPantallaCompleta() {
  try {
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      await Promise.race([document.documentElement.requestFullscreen({ navigationUI: 'hide' }), new Promise(r => setTimeout(r, 2000))]);
    }
  } catch {}
}

// ---------- Examen: una pregunta cada vez ----------

let reloj = null;
let cajaReloj = null;
let pieIzquierda = null;
let pieDerecha = null;
let contadorPaso = null;
let capaBloqueo = null;
let avisoPantallaCompleta = null;
let navegador = null;
let zonaPaso = null;
let pie = null;
let preguntas = [];
let numeros = []; // "1", "2", "9a", "9b"...
let paso = 0; // índice de la pregunta; preguntas.length es la pantalla de revisión
let marcadas = new Set();
const avisosTiempo = new Set();
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

const LETRA = j => String.fromCharCode(65 + j);
const enRevision = () => paso === preguntas.length;
const respondida = id => N.hayRespuesta(respuestas[id]);
const palabras = texto => (String(texto || '').trim().match(/\S+/g) || []).length;
const recortar = (texto, n = 110) => (texto.length > n ? `${texto.slice(0, n).trimEnd()}…` : texto).replace(/\s+/g, ' ');

// La pregunta en la que estaba y las marcadas sobreviven a una recarga de la página
const claveLocal = () => `testgo.pasos.${actual.intento.nombre}.${actual.intento.inicio}`;
function guardarLocal() {
  try {
    localStorage.setItem(claveLocal(), JSON.stringify({ paso, marcadas: [...marcadas] }));
  } catch {}
}
function leerLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(claveLocal()) || 'null');
    if (!d) return;
    paso = Math.min(Math.max(0, Number(d.paso) || 0), preguntas.length);
    marcadas = new Set((d.marcadas || []).filter(id => preguntas.some(p => p.id === id)));
  } catch {}
}

function pantallaExamen() {
  const { examen, intento } = actual;
  if (pantalla !== 'examen') {
    pantalla = 'examen';
    construirExamen();
    activarVigilancia();
  }
  actualizarBloqueo(intento.estado === 'bloqueado');
  actualizarReloj();
  const chip = $('#salidas-restantes');
  if (examen.maxSalidas && chip) {
    const quedan = examen.maxSalidas - N.salidasDesde(intento);
    // En el móvil solo el número, para que quepa el título
    vaciar(chip, h('span', { class: 'solo-ancho' }, 'Salidas: '), `${N.salidasDesde(intento)}/${examen.maxSalidas}`);
    chip.title = `Has salido ${N.salidasDesde(intento)} de ${examen.maxSalidas} veces permitidas`;
    chip.className = `chip chip-salidas ${quedan <= 1 ? 'peligro' : 'aviso'}`;
    chip.hidden = !intento.salidas;
  }
}

function construirExamen() {
  const { examen, intento } = actual;
  preguntas = N.vistaPreguntas(examen.preguntas, intento.orden);
  numeros = N.etiquetas(preguntas);
  paso = 0;
  marcadas = new Set();
  leerLocal();
  avisarPosicion();

  reloj = h('span', { class: 'reloj-texto' });
  cajaReloj = h('span', { class: 'reloj', role: 'timer', 'aria-label': 'Tiempo restante' }, icono('reloj'), reloj);
  navegador = h('nav', { class: 'pasos', 'aria-label': 'Preguntas del examen' });
  zonaPaso = h('div', { class: 'zona-paso' });
  pieIzquierda = h('div', { class: 'pie-lado' });
  pieDerecha = h('div', { class: 'pie-lado derecha' });
  // En el móvil no caben los números: un contador que lleva a la lista de preguntas
  contadorPaso = h('button', { type: 'button', class: 'contador-paso', onclick: () => irA(preguntas.length) });
  pie = h('div', { class: 'pie-examen' }, h('div', { class: 'pie-dentro' }, pieIzquierda, navegador, contadorPaso, pieDerecha));
  avisoPantallaCompleta = h('div', { class: 'aviso-pantalla', hidden: true },
    icono('pantalla'),
    h('span', {}, 'Has salido de la pantalla completa.'),
    h('button', { class: 'boton mini', onclick: pedirPantallaCompleta }, 'Volver'),
  );

  const botonCuaderno = h('button', {
    type: 'button', class: 'boton-cuaderno', 'aria-expanded': 'false', title: 'Cuaderno: apuntes que solo ves tú',
    onclick: () => (cuaderno?.panel.classList.contains('abierto') ? cerrarCuaderno() : abrirCuaderno()),
  }, icono('cuaderno'), h('span', { class: 'solo-ancho' }, 'Cuaderno'));
  crearCuaderno(botonCuaderno);

  document.body.classList.add('en-examen');
  vaciar(app,
    h('header', { class: 'barra-examen' },
      h('div', { class: 'barra-dentro' },
        h('img', { class: 'logo-examen', src: '/img/logo.svg', alt: 'TestGO' }),
        h('div', { class: 'barra-titulo' },
          h('h1', {}, examen.titulo),
          h('span', {}, examen.asignatura ? `${examen.asignatura} · ` : '', h('span', { id: 'resumen-respondidas' })),
        ),
        h('span', { id: 'salidas-restantes', class: 'chip aviso', hidden: true }),
        estadoGuardado,
        botonCuaderno,
        cajaReloj,
      ),
      h('div', { class: 'progreso-examen' }, h('i', { id: 'barra-progreso' })),
    ),
    avisoPantallaCompleta,
    zonaPaso,
    h('p', { class: 'atajos' }, h('kbd', {}, '←'), ' ', h('kbd', {}, '→'), ' cambiar de pregunta · ', h('kbd', {}, 'A'), ' ', h('kbd', {}, 'B'), ' ', h('kbd', {}, 'C'), '… elegir opción · ', h('kbd', {}, 'M'), ' marcar para revisar'),
    pie,
  );
  if (examen.marcaAgua) ponerMarcaAgua(intento.nombre, intento.inicio);
  pintarNavegador();
  pintarPaso();
  clearInterval(pantallaExamen.intervalo);
  pantallaExamen.intervalo = setInterval(actualizarReloj, 500);
}

// Nombre del alumno y fecha repetidos en diagonal por el fondo, para que se vea en cualquier foto o captura
function ponerMarcaAgua(nombre, inicio) {
  quitarMarcaAgua();
  const texto = `${nombre} · ${new Date(inicio || Date.now()).toLocaleDateString('es-ES')}`;
  const escapar = t => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="240"><text x="210" y="125" text-anchor="middle" transform="rotate(-24 210 120)" font-family="system-ui, sans-serif" font-size="17" font-weight="600" fill="rgba(12,18,48,0.075)">${escapar(texto)}</text></svg>`;
  document.body.append(h('div', { class: 'marca-agua', 'aria-hidden': 'true', style: { backgroundImage: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")` } }));
}

const quitarMarcaAgua = () => $$('.marca-agua').forEach(m => m.remove());

// ---------- Cuaderno: una hoja en blanco para apuntes ----------
// Se guarda solo en este equipo, no se entrega y el profesor no lo ve. Se borra al entregar.

let cuaderno = null; // { panel, caja, boton }
const claveCuaderno = () => `testgo.cuaderno.${actual.intento.nombre}.${actual.intento.inicio}`;
function leerCuaderno() {
  try {
    return localStorage.getItem(claveCuaderno()) || '';
  } catch {
    return '';
  }
}
function borrarCuaderno() {
  try {
    if (actual?.intento) localStorage.removeItem(claveCuaderno());
  } catch {}
}

function crearCuaderno(boton) {
  cuaderno?.panel.remove();
  const estado = h('span', { class: 'estado-cuaderno' }, 'Se guarda en este equipo');
  const caja = h('textarea', {
    class: 'hoja-cuaderno', spellcheck: false, value: leerCuaderno(), 'aria-label': 'Cuaderno',
    placeholder: 'Apunta aquí lo que quieras: ideas, cálculos, un borrador de tus respuestas…',
  });
  let espera = null;
  caja.addEventListener('input', () => {
    boton.classList.toggle('con-notas', !!caja.value.trim());
    estado.textContent = 'Guardando…';
    clearTimeout(espera);
    espera = setTimeout(() => {
      try {
        localStorage.setItem(claveCuaderno(), caja.value);
        estado.textContent = 'Guardado en este equipo';
      } catch {
        estado.textContent = 'No se ha podido guardar';
      }
    }, 400);
  });
  const panel = h('aside', { class: 'cuaderno', 'aria-label': 'Cuaderno', inert: true, onkeydown: e => e.key === 'Escape' && cerrarCuaderno() },
    h('div', { class: 'cabeza-cuaderno' },
      h('span', { class: 'icono-norma' }, icono('cuaderno')),
      h('div', {}, h('b', {}, 'Cuaderno'), h('span', {}, 'Solo lo ves tú. No se entrega.')),
      h('button', { type: 'button', class: 'boton fantasma mini', 'aria-label': 'Cerrar el cuaderno', onclick: cerrarCuaderno }, icono('x')),
    ),
    caja,
    h('div', { class: 'pie-cuaderno' },
      estado,
      h('button', { type: 'button', class: 'boton fantasma mini', onclick: async () => {
        if (!caja.value.trim()) return;
        if (!(await confirmar('¿Borrar el cuaderno?', 'Se borrará todo lo que has apuntado.', 'Borrar'))) return;
        caja.value = '';
        caja.dispatchEvent(new Event('input'));
        caja.focus();
      } }, icono('papelera'), 'Borrar todo'),
    ),
  );
  boton.classList.toggle('con-notas', !!caja.value.trim());
  document.body.append(panel);
  cuaderno = { panel, caja, boton };
}

function abrirCuaderno() {
  if (!cuaderno || capaBloqueo) return;
  cuaderno.panel.inert = false;
  cuaderno.panel.classList.add('abierto');
  document.body.classList.add('cuaderno-abierto');
  cuaderno.boton.setAttribute('aria-expanded', 'true');
  cuaderno.caja.focus({ preventScroll: true });
}

function cerrarCuaderno() {
  if (!cuaderno?.panel.classList.contains('abierto')) return;
  const dentro = cuaderno.panel.contains(document.activeElement);
  cuaderno.panel.classList.remove('abierto');
  cuaderno.panel.inert = true;
  document.body.classList.remove('cuaderno-abierto');
  cuaderno.boton.setAttribute('aria-expanded', 'false');
  if (dentro) cuaderno.boton.focus({ preventScroll: true });
}

function pintarNavegador() {
  vaciar(navegador,
    preguntas.map((p, i) => {
      const hecha = respondida(p.id);
      const marcada = marcadas.has(p.id);
      return h('button', {
        type: 'button',
        class: `paso ${i === paso ? 'actual' : ''} ${hecha ? 'hecha' : ''} ${marcada ? 'marcada' : ''}`,
        'aria-current': i === paso ? 'step' : null,
        'aria-label': `Pregunta ${numeros[i]}${hecha ? ', respondida' : ', sin responder'}${marcada ? ', marcada para revisar' : ''}`,
        title: `Pregunta ${numeros[i]}`,
        onclick: () => irA(i),
      }, numeros[i]);
    }),
    h('button', {
      type: 'button',
      class: `paso revisar ${enRevision() ? 'actual' : ''}`,
      'aria-current': enRevision() ? 'step' : null,
      'aria-label': 'Revisar y entregar',
      title: 'Revisar y entregar',
      onclick: () => irA(preguntas.length),
    }, icono('check')),
  );
  const hechas = preguntas.filter(p => respondida(p.id)).length;
  const resumen = $('#resumen-respondidas');
  if (resumen) resumen.textContent = `${hechas} de ${preguntas.length} respondidas`;
  const barra = $('#barra-progreso');
  if (barra) barra.style.width = `${preguntas.length ? (hechas / preguntas.length) * 100 : 0}%`;
  if (contadorPaso) {
    contadorPaso.textContent = enRevision() ? 'Revisión' : `${numeros[paso]} de ${preguntas.length}`;
    contadorPaso.setAttribute('aria-label', 'Ver todas las preguntas');
  }
  // Centrar el botón actual sin mover la página (scrollIntoView desplazaría también la ventana)
  const boton = navegador.querySelector('.actual');
  if (boton && navegador.scrollWidth > navegador.clientWidth) {
    navegador.scrollLeft = boton.offsetLeft - navegador.clientWidth / 2 + boton.offsetWidth / 2;
  }
}

// El profesor ve en el plano de la clase por qué pregunta va cada alumno (se avisa al dejar de moverse)
let temporizadorPosicion = null;
function avisarPosicion() {
  clearTimeout(temporizadorPosicion);
  temporizadorPosicion = setTimeout(() => {
    api.posicion?.(paso, enRevision() ? 'Revisión' : numeros[paso]).catch(() => {});
  }, 800);
}

function irA(i) {
  if (i < 0 || i > preguntas.length || i === paso) return;
  const direccion = i > paso ? 1 : -1;
  if (pendienteGuardar) guardarAhora();
  paso = i;
  guardarLocal();
  avisarPosicion();
  pintarNavegador();
  pintarPaso(direccion);
  // Si el principio de la pregunta queda debajo de la barra fija, se vuelve arriba
  const barra = $('.barra-examen').getBoundingClientRect().bottom;
  if (zonaPaso.getBoundingClientRect().top < barra + 8) window.scrollTo({ top: 0, behavior: sinMovimiento ? 'auto' : 'smooth' });
}

function pintarPaso(direccion = 0) {
  if (enRevision()) return pintarRevision(direccion);
  const p = preguntas[paso];
  const bloqueado = actual.intento.estado !== 'en_curso';
  const { control, pieTarjeta, ayuda, foco } = controlPregunta(p, bloqueado);

  const marcada = marcadas.has(p.id);
  const tarjeta = h('section', { class: `pregunta ${claseEntrada(direccion)}` },
    h('div', { class: 'cabeza-pregunta' },
      h('span', { class: 'meta' }, 'Pregunta ', h('span', { class: 'sin-mayusculas' }, numeros[paso]), ` de ${preguntas.length}`),
      h('span', { class: 'puntos-pregunta' }, `${N.numero(p.puntos)} ${p.puntos === 1 ? 'punto' : 'puntos'}`),
      h('span', { class: 'espacio' }),
      h('button', {
        class: `boton-marcar ${marcada ? 'activo' : ''}`, type: 'button', 'aria-pressed': String(marcada),
        onclick: () => alternarMarca(p.id),
      }, icono('bandera'), h('span', {}, marcada ? 'Marcada' : 'Marcar para revisar')),
    ),
    p.contexto ? h('div', { class: 'contexto' }, p.contexto) : null,
    h('h2', { class: 'enunciado', id: `enunciado-${p.id}`, tabindex: '-1' }, p.apartado ? h('span', { class: 'letra-apartado' }, `${p.apartado})`) : null, p.enunciado),
    p.imagen ? imagenPregunta(p.imagen) : null,
    ayuda ? h('p', { class: 'ayuda-pregunta' }, ayuda) : null,
    control,
    pieTarjeta ? h('div', { class: 'fila entre' }, h('span'), pieTarjeta) : null,
  );
  vaciar(zonaPaso, tarjeta);

  vaciar(pieIzquierda,
    h('button', { class: 'boton boton-paso', type: 'button', disabled: paso === 0, 'aria-label': 'Pregunta anterior', onclick: () => irA(paso - 1) },
      icono('izquierda'), h('span', { class: 'solo-ancho' }, 'Anterior')),
  );
  vaciar(pieDerecha,
    h('button', { class: 'boton primario boton-paso boton-azul', type: 'button', onclick: () => irA(paso + 1) },
      h('span', {}, paso === preguntas.length - 1 ? 'Revisar' : 'Siguiente'), icono('derecha')),
  );

  if (direccion) (foco || $(`#enunciado-${p.id}`, tarjeta)).focus({ preventScroll: true });
}

// El cuadro de respuesta de cada tipo de pregunta
function controlPregunta(p, bloqueado) {
  const r = respuestas[p.id];
  const borrar = h('button', { class: 'boton fantasma mini', type: 'button', disabled: bloqueado, onclick: () => {
    responder(p.id, null);
    pintarPaso();
  } }, 'Borrar mi respuesta');

  if (p.tipo === 'test' || p.tipo === 'vf') {
    return {
      ayuda: 'Elige una respuesta.',
      pieTarjeta: borrar,
      control: h('div', { class: `opciones ${p.tipo === 'vf' ? 'opciones-vf' : ''}`, role: 'radiogroup', 'aria-labelledby': `enunciado-${p.id}` },
        p.opciones.map((o, j) =>
          h('label', { class: 'opcion' },
            h('input', { type: 'radio', name: `p-${p.id}`, value: String(o.i), checked: r === o.i, disabled: bloqueado, onchange: () => responder(p.id, o.i) }),
            h('span', { class: 'letra', 'aria-hidden': 'true' }, p.tipo === 'vf' ? o.texto[0] : LETRA(j)),
            h('span', { class: 'texto-opcion' }, o.texto),
          ),
        ),
      ),
    };
  }

  if (p.tipo === 'multiple') {
    const elegidas = new Set(Array.isArray(r) ? r : []);
    return {
      ayuda: 'Puede haber varias correctas: marca todas las que lo sean. Las incorrectas marcadas restan.',
      pieTarjeta: borrar,
      control: h('div', { class: 'opciones', role: 'group', 'aria-labelledby': `enunciado-${p.id}` },
        p.opciones.map((o, j) =>
          h('label', { class: 'opcion casilla-opcion' },
            h('input', { type: 'checkbox', value: String(o.i), checked: elegidas.has(o.i), disabled: bloqueado, onchange: e => {
              const actuales = new Set(Array.isArray(respuestas[p.id]) ? respuestas[p.id] : []);
              if (e.target.checked) actuales.add(o.i);
              else actuales.delete(o.i);
              responder(p.id, actuales.size ? [...actuales].sort((x, y) => x - y) : null);
            } }),
            h('span', { class: 'letra', 'aria-hidden': 'true' }, LETRA(j)),
            h('span', { class: 'texto-opcion' }, o.texto),
          ),
        ),
      ),
    };
  }

  if (p.tipo === 'numerica') {
    const entrada = h('input', {
      type: 'text', inputmode: 'decimal', class: 'respuesta-numerica', value: r ?? '', maxlength: 30, autocomplete: 'off',
      disabled: bloqueado, placeholder: '0', 'aria-labelledby': `enunciado-${p.id}`,
      oninput: e => {
        const v = e.target.value.replace(/[^\d.,\-\s]/g, '');
        if (v !== e.target.value) e.target.value = v;
        responder(p.id, v.trim() || null);
      },
    });
    return {
      ayuda: 'Escribe solo el número. Puedes usar coma o punto para los decimales.',
      foco: entrada,
      control: h('div', { class: 'fila' }, entrada, p.unidad ? h('span', { class: 'unidad' }, p.unidad) : null),
    };
  }

  if (p.tipo === 'relacionar') {
    const filas = Array.isArray(r) ? r : p.izquierda.map(() => null);
    return {
      ayuda: 'Elige para cada elemento de la izquierda su pareja de la derecha.',
      pieTarjeta: borrar,
      control: h('div', { class: 'relacionar' },
        p.izquierda.map((texto, i) =>
          h('div', { class: 'fila-relacionar' },
            h('span', { class: 'izquierda' }, h('span', { class: 'letra-mini' }, i + 1), texto),
            h('select', {
              disabled: bloqueado, 'aria-label': `Pareja de ${texto}`, value: filas[i] === null ? '' : String(filas[i]),
              onchange: e => {
                const nuevas = Array.isArray(respuestas[p.id]) ? [...respuestas[p.id]] : p.izquierda.map(() => null);
                nuevas[i] = e.target.value === '' ? null : Number(e.target.value);
                responder(p.id, nuevas.some(v => v !== null) ? nuevas : null);
              },
            }, h('option', { value: '' }, 'Elige…'), p.derecha.map(d => h('option', { value: String(d.j) }, d.texto))),
          ),
        ),
      ),
    };
  }

  // Respuesta corta o desarrollo
  const contador = h('span', { class: 'contador', 'aria-live': 'polite' });
  const contar = v => (contador.textContent = `${palabras(v)} ${palabras(v) === 1 ? 'palabra' : 'palabras'}`);
  const caja = h('textarea', {
    class: 'respuesta-alumno',
    rows: p.tipo === 'corta' ? 3 : 10,
    value: r ?? '',
    maxlength: p.tipo === 'corta' ? 2000 : 20000,
    spellcheck: false,
    disabled: bloqueado,
    placeholder: 'Escribe aquí tu respuesta',
    'aria-labelledby': `enunciado-${p.id}`,
    oninput: e => {
      responder(p.id, e.target.value);
      contar(e.target.value);
    },
  });
  contar(caja.value);
  return { control: caja, pieTarjeta: contador, foco: caja };
}

// Imagen de la pregunta; al pulsarla se ve en grande
function imagenPregunta(id) {
  const src = api.urlImagen(id);
  return h('button', { type: 'button', class: 'imagen-pregunta', 'aria-label': 'Ver la imagen en grande', onclick: () => {
    const d = h('dialog', { class: 'visor-imagen', onclick: () => (d.close(), d.remove()) }, h('img', { src, alt: '' }));
    document.body.append(d);
    d.showModal();
  } }, h('img', { src, alt: 'Imagen de la pregunta', loading: 'lazy' }));
}

function claseEntrada(direccion) {
  if (sinMovimiento || !direccion) return '';
  return direccion > 0 ? 'entra-derecha' : 'entra-izquierda';
}

function pintarRevision(direccion = 0) {
  const sin = preguntas.filter(p => !respondida(p.id));
  const marcadasLista = preguntas.filter(p => marcadas.has(p.id));
  const estado = p => {
    if (marcadas.has(p.id)) return h('span', { class: 'chip aviso' }, 'Marcada');
    return respondida(p.id) ? h('span', { class: 'chip exito' }, 'Respondida') : h('span', { class: 'chip' }, 'En blanco');
  };
  vaciar(zonaPaso, h('section', { class: `pregunta revision ${claseEntrada(direccion)}` },
    h('div', {},
      h('h2', { class: 'enunciado', tabindex: '-1', id: 'titulo-revision' }, 'Revisa antes de entregar'),
      h('p', { class: 'suave', style: { margin: 0 } }, 'Pulsa una pregunta para volver a ella.'),
    ),
    h('div', { class: 'metricas', style: { margin: 0 } },
      h('div', { class: 'metrica' }, h('span', {}, 'Respondidas'), h('b', {}, `${preguntas.length - sin.length}/${preguntas.length}`)),
      h('div', { class: 'metrica' }, h('span', {}, 'En blanco'), h('b', { style: { color: sin.length ? 'var(--aviso)' : '' } }, sin.length)),
      h('div', { class: 'metrica' }, h('span', {}, 'Marcadas'), h('b', {}, marcadasLista.length)),
    ),
    sin.length ? h('div', { class: 'aviso amarillo pequeno' }, `Te ${sin.length === 1 ? 'queda 1 pregunta' : `quedan ${sin.length} preguntas`} sin responder. Las preguntas en blanco no restan.`) : null,
    h('div', { class: 'lista-revision' },
      preguntas.map((p, i) =>
        h('button', { class: 'fila-revision', type: 'button', onclick: () => irA(i) },
          h('span', { class: 'num' }, numeros[i]),
          h('span', { class: 'texto' }, recortar(p.enunciado)),
          estado(p),
        ),
      ),
    ),
  ));
  vaciar(pieIzquierda,
    h('button', { class: 'boton boton-paso', type: 'button', 'aria-label': 'Pregunta anterior', onclick: () => irA(paso - 1) },
      icono('izquierda'), h('span', { class: 'solo-ancho' }, 'Anterior')),
  );
  vaciar(pieDerecha,
    h('button', { class: 'boton primario boton-paso boton-azul', type: 'button', onclick: ev => entregarManual(ev.currentTarget) },
      icono('check'), h('span', {}, 'Entregar')),
  );
  if (direccion) $('#titulo-revision')?.focus({ preventScroll: true });
}

function alternarMarca(id) {
  if (marcadas.has(id)) marcadas.delete(id);
  else marcadas.add(id);
  guardarLocal();
  pintarNavegador();
  pintarPaso();
}

function responder(id, valor) {
  if (actual?.intento.estado !== 'en_curso') return;
  const antes = respondida(id);
  if (valor === null || valor === '') delete respuestas[id];
  else respuestas[id] = valor;
  if (antes !== respondida(id) || typeof valor !== 'string') pintarNavegador();
  programarGuardado();
}

// Atajos de teclado: flechas para moverse, letras o números para elegir opción, M para marcar
function teclado(e) {
  if (!examenActivo() || capaBloqueo || document.querySelector('dialog[open]')) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.target.matches('textarea, input[type="text"], select')) return;
  const p = preguntas[paso];
  const tecla = e.key.toLowerCase();
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    irA(paso + 1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    irA(paso - 1);
  } else if (tecla === 'm' && p) {
    alternarMarca(p.id);
  } else if (p && N.CON_OPCIONES.has(p.tipo)) {
    let j = /^[a-h]$/.test(tecla) ? tecla.charCodeAt(0) - 97 : /^[1-9]$/.test(tecla) ? Number(tecla) - 1 : -1;
    if (p.tipo === 'vf' && (tecla === 'v' || tecla === 'f')) j = tecla === 'v' ? 0 : 1;
    const casilla = $$('.zona-paso .opcion input')[j];
    if (!casilla) return;
    e.preventDefault();
    // En las de varias correctas, la tecla marca o desmarca
    casilla.checked = casilla.type === 'checkbox' ? !casilla.checked : true;
    casilla.dispatchEvent(new Event('change', { bubbles: true }));
    casilla.focus({ preventScroll: true });
  }
}

function programarGuardado(espera = ESPERA_GUARDADO_MS) {
  pendienteGuardar = true;
  estadoGuardado.textContent = 'Guardando…';
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = setTimeout(guardarAhora, espera);
}

async function guardarAhora() {
  clearTimeout(temporizadorGuardado);
  if (!pendienteGuardar) return;
  pendienteGuardar = false;
  try {
    await api.guardar({ ...respuestas });
    estadoGuardado.textContent = `Guardado a las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    pendienteGuardar = true;
    estadoGuardado.textContent = e.codigo === 'sin_conexion' ? 'Sin conexión: se guardará al volver' : 'No se ha podido guardar';
    if (e.codigo !== 'sin_conexion') notificarError(e);
    temporizadorGuardado = setTimeout(guardarAhora, 8000);
  }
}

function actualizarReloj() {
  if (!actual || pantalla !== 'examen') return;
  const { intento } = actual;
  const restante = N.limiteDe(intento) - ahoraServidor();
  reloj.textContent = relojTexto(restante);
  cajaReloj.classList.toggle('poco', restante < 5 * 60000);
  // Avisos a los 5 minutos y al último minuto (solo si el examen dura más que eso)
  for (const minutos of [5, 1]) {
    if (restante > 0 && restante <= minutos * 60000 && !avisosTiempo.has(minutos) && (intento.duracion + (intento.minutosExtra || 0)) > minutos) {
      avisosTiempo.add(minutos);
      notificar(minutos === 1 ? 'Queda 1 minuto: el examen se entregará solo.' : `Quedan ${minutos} minutos.`);
    }
  }
  if (restante <= 0 && intento.estado === 'en_curso' && !entregando) entregar(true);
}

async function entregarManual(boton) {
  const sin = preguntas.filter(p => !respondida(p.id)).length;
  const marc = preguntas.filter(p => marcadas.has(p.id)).length;
  const partes = [];
  if (sin) partes.push(`${sin} ${sin === 1 ? 'pregunta sin responder' : 'preguntas sin responder'}`);
  if (marc) partes.push(`${marc} ${marc === 1 ? 'marcada' : 'marcadas'} para revisar`);
  const ok = await confirmar(
    '¿Entregar el examen?',
    `${partes.length ? `Tienes ${partes.join(' y ')}. ` : ''}Después de entregar no podrás cambiar nada.`,
    'Entregar',
  );
  if (ok) await ocupado(boton, () => entregar(false));
}

async function entregar(automatico) {
  entregando = true;
  try {
    clearTimeout(temporizadorGuardado);
    pendienteGuardar = false;
    await api.entregar({ ...respuestas }, automatico);
  } catch (e) {
    entregando = false;
    if (automatico) setTimeout(() => entregar(true), 5000);
    throw e;
  }
}

// La capa tiene dos estados: bloqueado, y desbloqueado esperando a que el alumno pulse para volver.
// Hace falta que pulse: el navegador solo deja poner la pantalla completa tras un clic del usuario.
let estadoCapa = '';

function actualizarBloqueo(bloqueado) {
  if (bloqueado && estadoCapa !== 'bloqueado') {
    estadoCapa = 'bloqueado';
    cerrarCuaderno();
    pintarCapa(
      h('div', { class: 'tarjeta tarjeta-bloqueo' },
        h('span', { class: 'icono-bloqueo' }, icono('candado')),
        h('h2', {}, 'Examen bloqueado'),
        h('p', {}, actual.intento.bloqueadoPor === 'profesor'
          ? 'El profesor ha bloqueado tu examen.'
          : actual.examen.maxSalidas === 1 ? 'Has salido de la pantalla del examen.' : 'Has salido del examen demasiadas veces.'),
        h('p', { class: 'suave' }, 'Avisa al profesor. Tus respuestas están guardadas y podrás seguir cuando te desbloquee.'),
        h('p', { class: 'esperando' }, h('span', { class: 'punto-espera' }), 'Esperando al profesor…'),
      ),
    );
    $$('#app input, #app textarea, #app select').forEach(el => (el.disabled = true));
  } else if (!bloqueado && estadoCapa === 'bloqueado') {
    estadoCapa = 'desbloqueado';
    const volver = h('button', { class: 'boton primario grande boton-azul boton-volver', type: 'button', onclick: volverAlExamen },
      icono('pantalla'), h('span', {}, 'Volver al examen'));
    pintarCapa(
      h('div', { class: 'tarjeta tarjeta-bloqueo' },
        h('span', { class: 'icono-bloqueo listo' }, icono('check')),
        h('h2', {}, 'Ya puedes seguir'),
        h('p', {}, 'El profesor te ha desbloqueado. Tus respuestas siguen ahí.'),
        document.fullscreenEnabled ? h('p', { class: 'suave' }, 'El examen volverá a pantalla completa.') : null,
        volver,
      ),
    );
    volver.focus();
  }
}

function pintarCapa(contenido) {
  if (!capaBloqueo) {
    capaBloqueo = h('div', { class: 'bloqueo', role: 'alertdialog', 'aria-modal': 'true' });
    document.body.append(capaBloqueo);
  }
  vaciar(capaBloqueo, contenido);
}

function volverAlExamen() {
  pedirPantallaCompleta(); // dentro del clic, para que el navegador la permita
  capaBloqueo?.remove();
  capaBloqueo = null;
  estadoCapa = '';
  $$('#app input, #app textarea, #app select').forEach(el => (el.disabled = false));
  // Al volver a la pantalla completa se registra el regreso
  setTimeout(() => revisarPresencia(''), 800);
}

// ---------- Control de salidas ----------

let vigilando = false;
let fuera = false;
let salidaEn = 0;
const ultimaPorTipo = {};

function enviarIncidencia(tipo, detalle) {
  const t = Date.now();
  if (tipo !== 'salida' && tipo !== 'regreso' && t - (ultimaPorTipo[tipo] || 0) < 3000) return;
  ultimaPorTipo[tipo] = t;
  api.incidencia(tipo, detalle).catch(() => {});
}

function examenActivo() {
  return vigilando && actual?.intento.estado === 'en_curso' && actual.intento.inicio && !entregando;
}

function revisarPresencia(motivo) {
  if (!examenActivo()) return;
  const sinPantallaCompleta = document.fullscreenEnabled && !document.fullscreenElement;
  avisoPantallaCompleta.hidden = !sinPantallaCompleta;
  const ahoraFuera = document.visibilityState === 'hidden' || !document.hasFocus() || sinPantallaCompleta;
  if (ahoraFuera && !fuera) {
    fuera = true;
    salidaEn = Date.now();
    enviarIncidencia('salida', motivo);
  } else if (!ahoraFuera && fuera) {
    fuera = false;
    enviarIncidencia('regreso', `Volvió al examen tras ${N.duracionTexto(Date.now() - salidaEn)}`);
  }
}

// Copiar, cortar, pegar y el botón derecho están permitidos: no se bloquean ni se avisa al profesor
const manejadores = {
  visibilitychange: () => revisarPresencia('Cambió de pestaña o minimizó el navegador'),
  blur: () => setTimeout(() => revisarPresencia('Pasó a otra ventana o programa'), 150),
  focus: () => revisarPresencia(''),
  fullscreenchange: () => revisarPresencia('Salió de la pantalla completa'),
  beforeprint: () => examenActivo() && enviarIncidencia('imprimir', 'Intentó imprimir la página'),
};

function activarVigilancia() {
  if (vigilando) return;
  vigilando = true;
  for (const [evento, f] of Object.entries(manejadores)) {
    (evento === 'visibilitychange' || evento === 'fullscreenchange' ? document : window).addEventListener(evento, f);
  }
  window.addEventListener('beforeunload', avisarAntesDeSalir);
  document.addEventListener('keydown', teclado);
  // Margen para que el navegador termine de poner la pantalla completa
  setTimeout(() => revisarPresencia('No está en pantalla completa (recargó la página o no la aceptó)'), 2500);
}

function quitarVigilancia() {
  vigilando = false;
  document.body.classList.remove('en-examen', 'cuaderno-abierto');
  cuaderno?.panel.remove();
  cuaderno = null;
  $('.cabecera')?.append(estadoGuardado);
  quitarMarcaAgua();
  for (const [evento, f] of Object.entries(manejadores)) {
    (evento === 'visibilitychange' || evento === 'fullscreenchange' ? document : window).removeEventListener(evento, f);
  }
  window.removeEventListener('beforeunload', avisarAntesDeSalir);
  document.removeEventListener('keydown', teclado);
  clearInterval(pantallaExamen.intervalo);
}

function avisarAntesDeSalir(e) {
  if (!examenActivo()) return;
  if (pendienteGuardar) guardarAhora();
  e.preventDefault();
}

// ---------- Entregado ----------

function pantallaEntregado() {
  quitarVigilancia();
  capaBloqueo?.remove();
  capaBloqueo = null;
  estadoCapa = '';
  entregando = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  estadoGuardado.textContent = '';
  const { examen, intento, nota } = actual;
  // Las notas del cuaderno no se entregan: se borran de este equipo al acabar
  cerrarCuaderno();
  borrarCuaderno();
  const clave = `entregado-${nota ? `${nota.nota}-${nota.pendiente}` : 'sin'}`;
  if (pantalla === clave) return;
  pantalla = clave;
  let bloqueNota = null;
  if (nota) {
    bloqueNota = h('div', { class: 'metricas', style: { marginTop: '18px' } },
      h('div', { class: 'metrica' }, h('span', {}, nota.pendiente ? 'Nota provisional' : 'Nota'), h('b', {}, `${N.numero(nota.nota)} / 10`)),
      h('div', { class: 'metrica' }, h('span', {}, 'Puntos'), h('b', {}, `${N.numero(nota.total)} / ${N.numero(nota.max)}`)),
    );
  }
  vaciar(app, h('div', { class: 'centrado' }, h('div', { class: 'tarjeta tarjeta-login', style: { textAlign: 'center', width: 'min(520px, 100%)' } },
    icono('check', 'icono-grande'),
    h('h2', {}, 'Examen entregado'),
    h('p', { class: 'suave' }, `${examen.titulo} · ${intento.nombre}`),
    intento.motivoEntrega ? h('p', { class: 'pequeno suave' }, intento.motivoEntrega) : null,
    bloqueNota,
    nota?.pendiente ? h('p', { class: 'pequeno suave' }, 'Falta que el profesor corrija alguna pregunta a mano, así que la nota puede cambiar.') : null,
    !nota && examen.mostrarNota ? h('p', { class: 'pequeno suave' }, 'La nota aparecerá aquí en cuanto esté calculada.') : null,
    h('button', { class: 'boton', style: { marginTop: '12px' }, onclick: salirAlInicio }, 'Salir'),
  )));
}

// ---------- Arranque ----------

if (api.sesionGuardada()) iniciar();
else pantallaEntrada();
