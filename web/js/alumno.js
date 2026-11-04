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
  const codigo = h('input', { type: 'text', class: 'codigo-entrada', maxlength: 8, autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, placeholder: 'ABC123', value: datos.codigo || new URLSearchParams(location.search).get('c') || '', required: true });
  const nombre = h('input', { type: 'text', autocomplete: 'name', placeholder: 'Nombre y apellidos', value: datos.nombre || '', required: true, maxlength: 80 });
  const mensaje = h('p', { class: 'error-campo', role: 'alert' }, error);
  const zonaReentrada = h('div');
  const boton = h('button', { class: 'boton primario grande', type: 'submit' }, 'Entrar al examen');

  const formulario = h('form', {
    class: 'pila',
    onsubmit: async e => {
      e.preventDefault();
      mensaje.textContent = '';
      vaciar(zonaReentrada);
      if (!codigo.value.trim()) return (mensaje.textContent = 'Escribe el código del examen.');
      if (N.limpiarNombre(nombre.value).length < 3) return (mensaje.textContent = 'Escribe tu nombre y apellidos.');
      boton.disabled = true;
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
      }
    },
  },
    h('label', { class: 'campo' }, h('span', {}, 'Código del examen'), codigo),
    h('label', { class: 'campo' }, h('span', {}, 'Tu nombre y apellidos'), nombre, h('small', {}, 'Escríbelo completo: es el nombre con el que te verá el profesor.')),
    mensaje,
    zonaReentrada,
    boton,
  );

  vaciar(app, h('div', { class: 'centrado' }, h('div', { class: 'tarjeta tarjeta-login' }, marca(true), formulario)));
  (codigo.value ? nombre : codigo).focus();
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
    class: 'boton primario grande',
    onclick: ev => ocupado(ev.currentTarget, async () => {
      pedirPantallaCompleta(); // sin esperar: si el navegador no la concede, el examen empieza igual
      await api.comenzar();
    }),
  }, 'Empezar el examen');
  vaciar(app, h('div', { class: 'centrado' }, h('div', { class: 'tarjeta', style: { width: 'min(620px, 100%)' } },
    h('p', { class: 'suave pequeno' }, `Hola, ${intento.nombre}`),
    h('h1', {}, examen.titulo),
    h('div', { class: 'metricas' },
      h('div', { class: 'metrica' }, h('span', {}, 'Tiempo'), h('b', {}, `${examen.duracion} min`)),
      h('div', { class: 'metrica' }, h('span', {}, 'Preguntas'), h('b', {}, total)),
      examen.maxSalidas ? h('div', { class: 'metrica' }, h('span', {}, 'Salidas permitidas'), h('b', {}, examen.maxSalidas - 1)) : null,
    ),
    h('div', { class: 'aviso amarillo pila', style: { gap: '4px', marginBottom: '18px' } },
      h('b', {}, 'Antes de empezar'),
      h('ul', {},
        h('li', {}, 'El examen se abre a pantalla completa. No salgas de ella ni cambies de pestaña o de programa.'),
        h('li', {}, examen.maxSalidas ? `Cada salida queda registrada. A la ${examen.maxSalidas}.ª el examen se bloquea y tendrás que avisar al profesor.` : 'Cada salida queda registrada y el profesor la verá.'),
        h('li', {}, 'Tus respuestas se guardan solas mientras escribes.'),
        h('li', {}, 'El tiempo empieza a contar cuando pulses el botón. Al acabar, el examen se entrega solo.'),
        examen.penalizacion ? h('li', {}, `Las respuestas de test incorrectas restan ${N.numero(examen.penalizacion * 100)} % de su valor. Las que dejes en blanco no restan.`) : null,
      ),
    ),
    empezar,
  )));
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
const respondida = id => respuestas[id] !== undefined && respuestas[id] !== null && String(respuestas[id]).trim() !== '';
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
    chip.textContent = `Salidas: ${N.salidasDesde(intento)} de ${examen.maxSalidas}`;
    chip.className = `chip ${quedan <= 1 ? 'peligro' : 'aviso'}`;
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

  reloj = h('span', { class: 'reloj', role: 'timer', 'aria-label': 'Tiempo restante' });
  navegador = h('nav', { class: 'pasos', 'aria-label': 'Preguntas del examen' });
  zonaPaso = h('div', { class: 'zona-paso' });
  pie = h('div', { class: 'pie-examen' });
  avisoPantallaCompleta = h('div', { class: 'aviso amarillo fila entre', hidden: true, style: { marginBottom: '16px' } },
    h('span', {}, 'Has salido de la pantalla completa.'),
    h('button', { class: 'boton mini', onclick: pedirPantallaCompleta }, 'Volver a pantalla completa'),
  );

  vaciar(app,
    h('div', { class: 'barra-examen' },
      h('div', { class: 'barra-titulo' }, h('h1', {}, examen.titulo), h('span', { id: 'resumen-respondidas', class: 'pequeno suave' })),
      h('span', { id: 'salidas-restantes', class: 'chip aviso', hidden: true }),
      reloj,
      navegador,
    ),
    avisoPantallaCompleta,
    zonaPaso,
    pie,
    h('p', { class: 'atajos' }, h('kbd', {}, '←'), ' ', h('kbd', {}, '→'), ' cambiar de pregunta · ', h('kbd', {}, 'A'), ' ', h('kbd', {}, 'B'), ' ', h('kbd', {}, 'C'), '… elegir opción · ', h('kbd', {}, 'M'), ' marcar para revisar'),
  );
  pintarNavegador();
  pintarPaso();
  clearInterval(pantallaExamen.intervalo);
  pantallaExamen.intervalo = setInterval(actualizarReloj, 500);
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
  // Centrar el botón actual sin mover la página (scrollIntoView desplazaría también la ventana)
  const boton = navegador.querySelector('.actual');
  if (boton && navegador.scrollWidth > navegador.clientWidth) {
    navegador.scrollLeft = boton.offsetLeft - navegador.clientWidth / 2 + boton.offsetWidth / 2;
  }
}

function irA(i) {
  if (i < 0 || i > preguntas.length || i === paso) return;
  const direccion = i > paso ? 1 : -1;
  if (pendienteGuardar) guardarAhora();
  paso = i;
  guardarLocal();
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
  let control;
  let pieTarjeta = null;

  if (p.tipo === 'test') {
    control = h('div', { class: 'opciones', role: 'radiogroup', 'aria-labelledby': `enunciado-${p.id}` },
      p.opciones.map((o, j) =>
        h('label', { class: 'opcion' },
          h('input', { type: 'radio', name: `p-${p.id}`, value: String(o.i), checked: respuestas[p.id] === o.i, disabled: bloqueado, onchange: () => responder(p.id, o.i) }),
          h('span', { class: 'letra', 'aria-hidden': 'true' }, LETRA(j)),
          h('span', { class: 'texto-opcion' }, o.texto),
        ),
      ),
    );
    pieTarjeta = h('button', { class: 'boton fantasma mini', type: 'button', disabled: bloqueado, onclick: () => {
      $$(`input[name="p-${p.id}"]`).forEach(r => (r.checked = false));
      responder(p.id, null);
    } }, 'Borrar mi respuesta');
  } else {
    const contador = h('span', { class: 'contador', 'aria-live': 'polite' });
    const contar = v => (contador.textContent = `${palabras(v)} ${palabras(v) === 1 ? 'palabra' : 'palabras'}`);
    control = h('textarea', {
      class: 'respuesta-alumno',
      rows: p.tipo === 'corta' ? 3 : 10,
      value: respuestas[p.id] ?? '',
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
    contar(control.value);
    pieTarjeta = contador;
  }

  const marcada = marcadas.has(p.id);
  const tarjeta = h('section', { class: `tarjeta pregunta ${claseEntrada(direccion)}` },
    h('div', { class: 'fila entre' },
      h('span', { class: 'meta' }, 'Pregunta ', h('span', { class: 'sin-mayusculas' }, numeros[paso]), ` de ${preguntas.length}`),
      h('div', { class: 'fila' },
        marcada ? h('span', { class: 'chip aviso' }, 'Marcada') : null,
        h('span', { class: 'chip sin-punto' }, `${N.numero(p.puntos)} ${p.puntos === 1 ? 'punto' : 'puntos'}`),
      ),
    ),
    p.contexto ? h('div', { class: 'contexto' }, p.contexto) : null,
    h('h2', { class: 'enunciado', id: `enunciado-${p.id}`, tabindex: '-1' }, p.apartado ? h('span', { class: 'letra-apartado' }, `${p.apartado})`) : null, p.enunciado),
    p.tipo === 'test' ? h('p', { class: 'pequeno suave', style: { margin: '-4px 0 0' } }, 'Elige una respuesta.') : null,
    control,
    h('div', { class: 'fila entre' }, h('span'), pieTarjeta),
  );
  vaciar(zonaPaso, tarjeta);

  vaciar(pie,
    h('button', { class: 'boton', type: 'button', disabled: paso === 0, onclick: () => irA(paso - 1) }, icono('izquierda'), 'Anterior'),
    h('button', {
      class: `boton fantasma ${marcada ? 'activo' : ''}`, type: 'button', 'aria-pressed': String(marcada),
      onclick: () => alternarMarca(p.id),
    }, icono('bandera'), h('span', { class: 'solo-ancho' }, marcada ? 'Marcada para revisar' : 'Marcar para revisar')),
    h('button', { class: 'boton primario', type: 'button', onclick: () => irA(paso + 1) },
      paso === preguntas.length - 1 ? 'Revisar y entregar' : 'Siguiente', icono('derecha')),
  );

  if (direccion) {
    const foco = p.tipo === 'test' ? $(`#enunciado-${p.id}`, tarjeta) : control;
    foco.focus({ preventScroll: true });
  }
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
  vaciar(zonaPaso, h('section', { class: `tarjeta pila ${claseEntrada(direccion)}` },
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
  vaciar(pie,
    h('button', { class: 'boton', type: 'button', onclick: () => irA(paso - 1) }, icono('izquierda'), 'Anterior'),
    h('button', { class: 'boton primario', type: 'button', onclick: ev => entregarManual(ev.currentTarget) }, icono('check'), 'Entregar examen'),
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
  if (antes !== respondida(id) || typeof valor === 'number') pintarNavegador();
  programarGuardado();
}

// Atajos de teclado: flechas para moverse, letras o números para elegir opción, M para marcar
function teclado(e) {
  if (!examenActivo() || capaBloqueo || document.querySelector('dialog[open]')) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.target.matches('textarea, input[type="text"]')) return;
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
  } else if (p?.tipo === 'test') {
    const j = /^[a-h]$/.test(tecla) ? tecla.charCodeAt(0) - 97 : /^[1-9]$/.test(tecla) ? Number(tecla) - 1 : -1;
    const radio = $$('.zona-paso input[type="radio"]')[j];
    if (!radio) return;
    e.preventDefault();
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    radio.focus({ preventScroll: true });
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
  reloj.classList.toggle('poco', restante < 5 * 60000);
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

function actualizarBloqueo(bloqueado) {
  if (bloqueado && !capaBloqueo) {
    capaBloqueo = h('div', { class: 'bloqueo', role: 'alertdialog', 'aria-modal': 'true' },
      h('div', { class: 'tarjeta' },
        icono('candado', 'icono-grande'),
        h('h2', {}, 'Examen bloqueado'),
        h('p', {}, actual.intento.bloqueadoPor === 'profesor' ? 'El profesor ha bloqueado tu examen.' : 'Has salido del examen demasiadas veces.'),
        h('p', { class: 'suave' }, 'Avisa al profesor. Tus respuestas están guardadas y podrás seguir cuando te desbloquee.'),
      ),
    );
    document.body.append(capaBloqueo);
    $$('#app input, #app textarea').forEach(el => (el.disabled = true));
  } else if (!bloqueado && capaBloqueo) {
    capaBloqueo.remove();
    capaBloqueo = null;
    $$('#app input, #app textarea').forEach(el => (el.disabled = false));
    notificar('El profesor te ha desbloqueado. Puedes seguir.');
    pedirPantallaCompleta();
  }
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

const manejadores = {
  visibilitychange: () => revisarPresencia('Cambió de pestaña o minimizó el navegador'),
  blur: () => setTimeout(() => revisarPresencia('Pasó a otra ventana o programa'), 150),
  focus: () => revisarPresencia(''),
  fullscreenchange: () => revisarPresencia('Salió de la pantalla completa'),
  copy: e => {
    if (!examenActivo()) return;
    e.preventDefault();
    enviarIncidencia('copiar', 'Intentó copiar texto');
  },
  cut: e => {
    if (!examenActivo()) return;
    e.preventDefault();
    enviarIncidencia('copiar', 'Intentó cortar texto');
  },
  paste: e => {
    if (!examenActivo()) return;
    e.preventDefault();
    enviarIncidencia('pegar', 'Intentó pegar texto');
  },
  contextmenu: e => {
    if (!examenActivo()) return;
    e.preventDefault();
    enviarIncidencia('menu', 'Abrió el menú del botón derecho');
  },
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
  setTimeout(() => revisarPresencia('Empezó el examen fuera de la pantalla completa'), 1000);
}

function quitarVigilancia() {
  vigilando = false;
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
  entregando = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  estadoGuardado.textContent = '';
  const { examen, intento, nota } = actual;
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
