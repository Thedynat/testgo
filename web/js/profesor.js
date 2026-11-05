import { profesor as api, MODO } from './api.js';
import * as N from './nucleo.js';
import { $, $$, h, vaciar, marca, notificar, notificarError, dialogo, confirmar, ocupado, descargar, relojTexto, haceTexto, icono, comprimirImagen } from './comun.js';
import { leerArchivo, leerTexto, analizar, promptIA, leerRespuestaIA, pareceFormatoIA } from './importar.js';
import { markdownIntento, pdfIntento, zipTodos } from './exportar.js';

const app = $('#app');
const nav = $('#nav');
let sesion = null;
let limpiezaVista = () => {};

// ---------- Acceso ----------

async function arrancar() {
  try {
    sesion = await api.sesion();
  } catch (e) {
    vaciar(app, h('div', { class: 'centrado' }, h('div', { class: 'aviso peligro' }, e.message)));
    return;
  }
  if (!sesion.conectado) return pantallaAcceso();
  pintarNav();
  mostrar();
}

function pintarNav() {
  vaciar(nav,
    h('a', { class: 'enlace-nav', href: '#/', 'data-ruta': 'lista' }, 'Exámenes'),
    api.guardarCentro ? h('a', { class: 'enlace-nav', href: '#/centro', 'data-ruta': 'centro' }, 'Centro') : null,
    h('button', { class: 'enlace-nav', onclick: guiaBienvenida }, 'Ayuda'),
    MODO === 'servidor' ? h('button', { class: 'boton fantasma mini', onclick: cambiarPassword }, 'Contraseña') : h('span', { class: 'pequeno suave', style: { alignSelf: 'center', padding: '0 8px' } }, sesion.email),
    h('button', { class: 'boton fantasma mini', onclick: async () => {
      await api.salir().catch(() => {});
      location.hash = '';
      location.reload();
    } }, icono('salir'), 'Salir'),
  );
}

function tarjetaAcceso(...contenido) {
  vaciar(nav);
  vaciar(app, h('div', { class: 'centrado' }, h('div', { class: 'tarjeta tarjeta-login' }, marca(true, '#/'), ...contenido)));
}

function formulario(campos, textoBoton, enviar) {
  const error = h('p', { class: 'error-campo', role: 'alert' });
  const boton = h('button', { class: 'boton primario grande', type: 'submit' }, textoBoton);
  const form = h('form', {
    class: 'pila',
    onsubmit: async e => {
      e.preventDefault();
      error.textContent = '';
      boton.disabled = true;
      try {
        await enviar();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        boton.disabled = false;
      }
    },
  }, campos, error, boton);
  return { form, error };
}

const campo = (texto, input, ayuda) => h('label', { class: 'campo' }, h('span', {}, texto), input, ayuda ? h('small', {}, ayuda) : null);

function pantallaAcceso() {
  if (MODO === 'firebase') return accesoFirebase();
  const clave = h('input', { type: 'password', autocomplete: sesion.configurado ? 'current-password' : 'new-password', required: true, minlength: sesion.configurado ? 1 : 8 });
  if (!sesion.configurado) {
    const repetir = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const { form } = formulario(
      [h('p', { class: 'suave' }, 'Es la primera vez que se abre TestGO en este servidor. Crea la contraseña del panel del profesor.'), campo('Contraseña nueva', clave, 'Al menos 8 caracteres.'), campo('Repítela', repetir)],
      'Crear contraseña y entrar',
      async () => {
        if (clave.value !== repetir.value) throw new Error('Las contraseñas no coinciden.');
        await api.configurar(clave.value);
        arrancar();
      },
    );
    tarjetaAcceso(form);
  } else {
    const { form } = formulario([campo('Contraseña del profesor', clave)], 'Entrar', async () => {
      await api.login(clave.value);
      arrancar();
    });
    tarjetaAcceso(form);
  }
  clave.focus();
}

function accesoFirebase(modo = 'entrar') {
  if (sesion.email && sesion.pendienteVerificar) {
    return tarjetaAcceso(
      h('h2', {}, 'Confirma tu correo'),
      h('p', {}, `Te hemos enviado un enlace a ${sesion.email}. Ábrelo y vuelve aquí.`),
      h('div', { class: 'pila' },
        h('button', { class: 'boton primario grande', onclick: () => location.reload() }, 'Ya lo he confirmado'),
        h('button', { class: 'boton', onclick: e => ocupado(e.currentTarget, async () => {
          await api.reenviarVerificacion();
          notificar('Correo enviado de nuevo');
        }) }, 'Reenviar el correo'),
        h('button', { class: 'boton fantasma', onclick: async () => {
          await api.salir();
          location.reload();
        } }, 'Usar otra cuenta'),
      ),
    );
  }
  const correo = h('input', { type: 'email', autocomplete: 'email', required: true, placeholder: `nombre${api.dominio || ''}` });
  const clave = h('input', { type: 'password', autocomplete: modo === 'crear' ? 'new-password' : 'current-password', required: true, minlength: modo === 'crear' ? 8 : 1 });
  const ayudaDominio = api.dominio ? `Solo cuentas ${api.dominio}` : null;
  const enlaces = h('div', { class: 'fila entre pequeno' },
    modo === 'entrar'
      ? [h('a', { href: '#', onclick: e => (e.preventDefault(), accesoFirebase('crear')) }, 'Crear cuenta de profesor'), h('a', { href: '#', onclick: e => (e.preventDefault(), recuperar(correo.value)) }, 'He olvidado la contraseña')]
      : [h('a', { href: '#', onclick: e => (e.preventDefault(), accesoFirebase('entrar')) }, 'Ya tengo cuenta')],
  );
  const { form } = formulario(
    [campo('Correo del centro', correo, ayudaDominio), campo('Contraseña', clave, modo === 'crear' ? 'Al menos 8 caracteres. No uses la de tu correo.' : null)],
    modo === 'crear' ? 'Crear cuenta' : 'Entrar',
    async () => {
      if (modo === 'crear') await api.registrar(correo.value, clave.value);
      else await api.login(correo.value, clave.value);
      arrancar();
    },
  );
  tarjetaAcceso(h('h2', { style: { textAlign: 'center' } }, modo === 'crear' ? 'Crear cuenta' : 'Panel del profesor'), form, enlaces);
  correo.focus();
}

async function recuperar(correoInicial) {
  const correo = h('input', { type: 'email', value: correoInicial, required: true });
  const ok = await dialogo({
    titulo: 'Recuperar contraseña',
    contenido: h('div', { class: 'pila' }, h('p', {}, 'Te enviaremos un enlace para poner una contraseña nueva.'), campo('Correo', correo)),
    botones: [{ texto: 'Cancelar', valor: false }, { texto: 'Enviar enlace', valor: true, clase: 'primario' }],
  });
  if (!ok) return;
  try {
    await api.recuperar(correo.value);
    notificar('Si la cuenta existe, te llegará un correo en unos minutos.');
  } catch (e) {
    notificarError(e);
  }
}

async function cambiarPassword() {
  const clave = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const ok = await dialogo({
    titulo: 'Cambiar contraseña',
    contenido: campo('Contraseña nueva', clave, 'Al menos 8 caracteres.'),
    botones: [{ texto: 'Cancelar', valor: false }, { texto: 'Cambiar', valor: true, clase: 'primario', antes: () => (clave.value.length >= 8 ? true : (notificar('Al menos 8 caracteres', 'error'), false)) }],
  });
  if (ok) ocupado(null, async () => {
    await api.cambiarPassword(clave.value);
    notificar('Contraseña cambiada');
  });
}

// ---------- Rutas ----------
// #/                          lista de exámenes
// #/examen/<id>/<pestaña>     preguntas · ajustes · directo · resultados

const PESTANAS = { preguntas: 'Preguntas', ajustes: 'Ajustes', revisar: 'Revisar y abrir', directo: 'En directo', resultados: 'Corregir' };

function mostrar() {
  limpiezaVista();
  limpiezaVista = () => {};
  $$('.dialogo-cajon').forEach(d => d.remove());
  const [seccion, E, pestana] = location.hash.replace(/^#\/?/, '').split('/');
  $$('#nav [data-ruta]').forEach(a => a.classList.toggle('activo', a.dataset.ruta === (seccion === 'examen' ? 'examen' : seccion === 'centro' ? 'centro' : 'lista')));
  if (seccion === 'examen' && E) return vistaExamen(E, PESTANAS[pestana] ? pestana : 'preguntas');
  if (seccion === 'centro' && api.guardarCentro) return vistaCentro();
  vistaLista();
}

window.addEventListener('hashchange', () => sesion?.conectado && mostrar());

const irA = ruta => (location.hash = ruta);
const rutaExamen = (E, pestana = 'preguntas') => `#/examen/${E}/${pestana}`;
const plural = (n, uno, varios) => `${N.numero(n)} ${n === 1 ? uno : varios}`;
const fechaCorta = ms => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

// La dirección que deben escribir los alumnos. Si el profesor ha abierto el panel con "localhost",
// esa no les sirve: se usa la del equipo en la red del aula.
let direccionAlumnos = null;
async function urlAlumnos() {
  if (direccionAlumnos) return direccionAlumnos;
  direccionAlumnos = location.host;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && api.direcciones) {
    try {
      const [primera] = await api.direcciones();
      if (primera) direccionAlumnos = primera;
    } catch {}
  }
  return direccionAlumnos;
}

async function copiar(texto, aviso = 'Copiado') {
  try {
    await navigator.clipboard.writeText(texto);
    notificar(aviso);
  } catch {
    notificar('No se ha podido copiar', 'error');
  }
}

// ---------- Lista de exámenes ----------

const botonNuevo = () => h('button', { class: 'boton primario', onclick: e => ocupado(e.currentTarget, async () => {
  const ex = await api.crearExamen({ titulo: 'Nuevo examen' });
  irA(rutaExamen(ex.id));
}) }, icono('mas'), 'Nuevo examen');

const botonImportarNuevo = () => h('button', { class: 'boton', onclick: async () => {
  const r = await dialogoImportar();
  if (!r) return;
  const ex = await ocupado(null, () => api.crearExamen({ titulo: r.titulo || 'Examen importado', preguntas: r.preguntas }));
  if (ex) {
    notificar(`Examen creado con ${r.preguntas.length} preguntas`);
    irA(rutaExamen(ex.id));
  }
} }, icono('subir'), 'Importar Word o PDF');

let filtroLista = { texto: '', estado: 'todos' };

// Tres pantallas que explican cómo se usa TestGO; salen solas la primera vez
function guiaBienvenida() {
  const pantallas = [
    ['lapiz', '1. Crea el examen', 'Escribe las preguntas o importa un examen que ya tengas en Word o PDF. TestGO separa las preguntas, opciones y soluciones por ti, y lo revisas antes de añadirlas.'],
    ['candado', '2. Elige el tipo y ábrelo', 'En Ajustes eliges si es un examen, un control suave o un repaso, y TestGO pone el control antichuleta por ti. En "Revisar y abrir" compruebas que no falte nada y proyectas el código en clase.'],
    ['directo', '3. Síguelo en directo y corrige', 'Ves a cada alumno en el plano de la clase: por qué pregunta va, cuánto le queda y si se ha bloqueado. Al acabar, corriges las de desarrollo con los criterios y descargas los PDF.'],
  ];
  let i = 0;
  const cuerpo = h('div', { class: 'guia' });
  const pie = h('div', { class: 'dialogo-pie' });
  const d = h('dialog', {}, cuerpo, pie);
  const cerrar = () => {
    guardarPreferencia('testgo.guiaVista', 'si');
    d.close();
    d.remove();
  };
  d.addEventListener('cancel', e => (e.preventDefault(), cerrar()));
  const pintar = () => {
    const [ico, titulo, texto] = pantallas[i];
    vaciar(cuerpo,
      h('div', { class: 'icono-guia' }, icono(ico)),
      h('h2', {}, titulo),
      h('p', { class: 'suave' }, texto),
      h('div', { class: 'puntos-guia' }, pantallas.map((_, j) => h('span', { class: j === i ? 'activo' : '' }))),
    );
    vaciar(pie,
      h('button', { class: 'boton fantasma', style: { marginRight: 'auto' }, onclick: cerrar }, 'Saltar'),
      i > 0 ? h('button', { class: 'boton', onclick: () => ((i -= 1), pintar()) }, 'Anterior') : null,
      h('button', { class: 'boton primario', onclick: () => (i < pantallas.length - 1 ? ((i += 1), pintar()) : cerrar()) }, i < pantallas.length - 1 ? 'Siguiente' : 'Empezar'),
    );
  };
  document.body.append(d);
  d.showModal();
  pintar();
}

async function vistaLista() {
  document.title = 'TestGO · Exámenes';
  if (preferencia('testgo.guiaVista', 'no') !== 'si') setTimeout(guiaBienvenida, 300);
  const resumen = h('p', { class: 'suave', style: { margin: '4px 0 0' } }, ' ');
  const lista = h('div', { class: 'examenes' }, [1, 2, 3].map(() => h('div', { class: 'tarjeta esqueleto' })));
  const buscador = h('label', { class: 'buscador' }, icono('lupa'),
    h('input', { type: 'search', placeholder: 'Buscar examen o código', value: filtroLista.texto, 'aria-label': 'Buscar examen', oninput: e => ((filtroLista.texto = e.target.value), pintar()) }));
  const segmentado = h('div', { class: 'segmentado', role: 'tablist', 'aria-label': 'Filtrar por estado' });

  vaciar(app,
    h('div', { class: 'titulo-seccion', style: { marginTop: 0 } },
      h('div', {}, h('h1', { style: { margin: 0 } }, 'Tus exámenes'), resumen),
      h('div', { class: 'fila' }, botonImportarNuevo(), botonNuevo()),
    ),
    h('div', { class: 'barra-herramientas' }, buscador, segmentado),
    lista,
  );

  let examenes;
  try {
    examenes = await api.listarExamenes();
  } catch (e) {
    return vaciar(lista, h('div', { class: 'aviso peligro' }, e.message));
  }
  const abiertos = examenes.filter(e => e.abierto).length;
  resumen.textContent = examenes.length ? `${plural(examenes.length, 'examen', 'exámenes')} · ${plural(abiertos, 'abierto', 'abiertos')} ahora` : 'Todavía no tienes ninguno';

  function pintar() {
    const opciones = [['todos', 'Todos', examenes.length], ['abiertos', 'Abiertos', abiertos], ['cerrados', 'Cerrados', examenes.length - abiertos]];
    vaciar(segmentado, opciones.map(([v, t, n]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(filtroLista.estado === v), class: filtroLista.estado === v ? 'activo' : '',
      onclick: () => ((filtroLista.estado = v), pintar()),
    }, t, h('span', { class: 'cuenta' }, n))));

    if (!examenes.length) {
      return vaciar(lista,
        h('div', { class: 'tarjeta vacio', style: { gridColumn: '1 / -1' } },
          h('img', { src: '/img/logo.svg', alt: '' }),
          h('h2', {}, 'Crea tu primer examen'),
          h('p', {}, 'Empieza desde cero o sube un examen que ya tengas en Word o PDF: TestGO separa las preguntas por ti.'),
          h('div', { class: 'fila', style: { justifyContent: 'center' } }, botonImportarNuevo(), botonNuevo()),
        ),
      );
    }
    const q = N.normalizar(filtroLista.texto);
    const visibles = examenes.filter(e =>
      (filtroLista.estado === 'todos' || (filtroLista.estado === 'abiertos') === e.abierto) &&
      (!q || N.normalizar(e.titulo).includes(q) || e.codigo.toLowerCase().includes(q)),
    );
    vaciar(lista, visibles.length
      ? visibles.map(tarjetaExamen)
      : h('div', { class: 'vacio', style: { gridColumn: '1 / -1' } }, h('p', {}, 'Ningún examen coincide con la búsqueda.'), h('button', { class: 'boton', onclick: () => {
        filtroLista = { texto: '', estado: 'todos' };
        vistaLista();
      } }, 'Quitar filtros')));
  }
  pintar();
}

function tarjetaExamen(ex) {
  const parar = fn => e => {
    e.stopPropagation();
    e.preventDefault();
    fn(e);
  };
  return h('article', {
    class: 'tarjeta examen-tarjeta', tabindex: '0', role: 'link', 'aria-label': `Abrir ${ex.titulo}`,
    onclick: () => irA(rutaExamen(ex.id)),
    onkeydown: e => e.key === 'Enter' && e.target === e.currentTarget && irA(rutaExamen(ex.id)),
  },
    h('div', { class: 'fila entre' },
      ex.abierto ? h('span', { class: 'chip exito' }, 'Abierto') : h('span', { class: 'chip' }, 'Cerrado'),
      h('span', { class: 'codigo', title: 'Código para los alumnos' }, ex.codigo),
    ),
    h('h3', {}, ex.titulo),
    h('div', { class: 'datos-examen' },
      h('span', {}, h('b', {}, ex.preguntas), ex.preguntas === 1 ? ' pregunta' : ' preguntas'),
      h('span', {}, h('b', {}, ex.alumnos), ex.alumnos === 1 ? ' alumno' : ' alumnos'),
      h('span', {}, h('b', {}, ex.entregados), ' entregados'),
    ),
    h('div', { class: 'pie-tarjeta' },
      h('span', { class: 'pequeno suave' }, `Creado el ${fechaCorta(ex.creado)}`),
      h('span', { class: 'espacio' }),
      h('a', { class: 'boton mini', href: rutaExamen(ex.id, 'directo'), onclick: e => e.stopPropagation() }, icono('directo'), 'En directo'),
      h('button', { class: 'boton fantasma mini', title: 'Duplicar', 'aria-label': `Duplicar ${ex.titulo}`, onclick: parar(e => duplicarExamen(ex.id, e.currentTarget)) }, icono('copia')),
      h('button', { class: 'boton fantasma mini', title: 'Borrar', 'aria-label': `Borrar ${ex.titulo}`, onclick: parar(e => borrarExamen(ex, e.currentTarget, vistaLista)) }, icono('papelera')),
    ),
  );
}

function duplicarExamen(E, boton) {
  return ocupado(boton, async () => {
    const completo = await api.obtenerExamen(E);
    const copia = await api.crearExamen({ ...completo, titulo: `${completo.titulo} (copia)` });
    notificar('Examen duplicado');
    irA(rutaExamen(copia.id));
  });
}

async function borrarExamen(ex, boton, despues) {
  const alumnos = ex.alumnos || 0;
  const ok = await confirmar('¿Borrar el examen?', `Se borrarán "${ex.titulo}"${alumnos ? ` y los exámenes de sus ${alumnos} alumnos` : ''}. No se puede deshacer.`, 'Borrar', 'peligro');
  if (!ok) return;
  await ocupado(boton, async () => {
    await api.borrarExamen(ex.id);
    notificar('Examen borrado');
    despues();
  });
}

// ---------- Datos del centro (nombre y logo) ----------

// Lo que necesitan las exportaciones: el centro (para la cabecera) y cómo bajar las imágenes
async function opcionesExportar() {
  let centro = null;
  try {
    centro = await api.centro?.();
  } catch {}
  return { centro, urlImagen: api.urlImagen };
}

async function vistaCentro() {
  document.title = 'TestGO · Centro';
  vaciar(app, h('div', { class: 'tarjeta esqueleto', style: { height: '200px' } }));
  let centro;
  try {
    centro = await api.centro();
  } catch (e) {
    return vaciar(app, h('div', { class: 'aviso peligro' }, e.message));
  }
  const nombre = h('input', { type: 'text', maxlength: 150, value: centro.nombre, placeholder: 'IES Ejemplo' });
  const vista = h('div', { class: 'vista-centro' });
  const zonaLogo = h('div', { class: 'fila' });
  const pintar = () => {
    vaciar(vista,
      centro.logo ? h('img', { src: api.urlImagen(centro.logo), alt: '' }) : h('span', { class: 'sin-logo' }, icono('escuela')),
      h('span', {}, nombre.value || 'Nombre del centro'),
    );
    const entrada = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
      const archivo = e.target.files[0];
      if (!archivo) return;
      await ocupado(null, async () => {
        centro.logo = await api.subirImagen(await comprimirImagen(archivo, 600));
      });
      pintar();
    } });
    vaciar(zonaLogo, entrada,
      h('button', { class: 'boton', type: 'button', onclick: () => entrada.click() }, icono('imagen'), centro.logo ? 'Cambiar logo' : 'Subir logo'),
      centro.logo ? h('button', { class: 'boton fantasma peligro', type: 'button', onclick: () => ((centro.logo = null), pintar()) }, 'Quitar logo') : null,
    );
  };
  nombre.addEventListener('input', pintar);
  pintar();

  vaciar(app,
    h('div', { class: 'titulo-seccion', style: { marginTop: 0 } }, h('div', {}, h('h1', { style: { margin: 0 } }, 'Tu centro'), h('p', { class: 'suave', style: { margin: '4px 0 0' } }, 'El nombre y el logo salen en la entrada de los alumnos, en sus exámenes y en los PDF.'))),
    h('section', { class: 'tarjeta ajustes-seccion' },
      h('div', {}, h('h3', {}, 'Nombre y logo'), h('p', { class: 'suave pequeno', style: { margin: 0 } }, 'Mejor un logo en PNG con fondo transparente o blanco.')),
      h('div', { class: 'pila' },
        campo('Nombre del centro', nombre),
        h('div', { class: 'campo' }, h('span', {}, 'Logo'), zonaLogo),
        h('div', { class: 'campo' }, h('span', {}, 'Así lo verán los alumnos'), vista),
        h('div', {}, h('button', { class: 'boton primario', onclick: e => ocupado(e.currentTarget, async () => {
          centro = await api.guardarCentro({ nombre: nombre.value, logo: centro.logo });
          notificar('Datos del centro guardados');
          pintar();
        }) }, 'Guardar')),
      ),
    ),
  );
}

// ---------- Página de un examen ----------
// Cinco pasos en orden: preguntas → ajustes → revisar y abrir → en directo → corregir

const SIGUIENTE = {
  preguntas: ['ajustes', 'Siguiente: ajustes'],
  ajustes: ['revisar', 'Siguiente: revisar y abrir'],
  directo: ['resultados', 'Siguiente: corregir'],
};

function estadoPasos(x) {
  const problemas = N.problemasExamen(x);
  return {
    preguntas: !x.preguntas.length ? '' : problemas.length ? 'aviso' : 'hecho',
    ajustes: x.modo ? 'hecho' : '',
    revisar: x.abierto || x.alumnos ? 'hecho' : '',
    directo: x.alumnos && !x.abierto ? 'hecho' : '',
    resultados: '',
  };
}

async function vistaExamen(E, pestana) {
  vaciar(app, h('div', { class: 'tarjeta esqueleto', style: { height: '150px' } }));
  let ex;
  try {
    ex = await api.obtenerExamen(E);
  } catch (e) {
    return vaciar(app, h('div', { class: 'aviso peligro' }, e.message), h('p', {}, h('a', { href: '#/' }, 'Volver a tus exámenes')));
  }

  // Estado compartido por los pasos y guardado automático
  const ctx = { E, ex, borrador: structuredClone(ex), limpiar: [] };
  let temporizador = null;
  let guardando = Promise.resolve();
  const estadoGuardado = h('span', { class: 'estado-guardado' }, 'Guardado');

  ctx.programar = () => {
    estadoGuardado.textContent = 'Cambios sin guardar…';
    estadoGuardado.dataset.estado = 'pendiente';
    clearTimeout(temporizador);
    temporizador = setTimeout(ctx.guardar, 1000);
    ctx.alCambiarBorrador?.();
  };
  ctx.guardar = () => {
    clearTimeout(temporizador);
    temporizador = null;
    const b = ctx.borrador;
    guardando = guardando.then(async () => {
      estadoGuardado.textContent = 'Guardando…';
      try {
        ctx.ex = await api.guardarExamen(E, {
          titulo: b.titulo, asignatura: b.asignatura, duracion: b.duracion, numPreguntas: b.numPreguntas, maxSalidas: b.maxSalidas,
          penalizacion: b.penalizacion, barajar: b.barajar, mostrarNota: b.mostrarNota, marcaAgua: b.marcaAgua,
          modo: b.modo, plano: b.plano, preguntas: b.preguntas,
        });
        estadoGuardado.textContent = 'Guardado';
        estadoGuardado.dataset.estado = '';
        pintarCabecera();
      } catch (e) {
        estadoGuardado.textContent = 'No se ha guardado';
        estadoGuardado.dataset.estado = 'error';
        notificarError(e);
      }
    });
    return guardando;
  };
  // Abre o cierra el examen guardando antes lo pendiente
  ctx.cambiarAbierto = async abrir => {
    await ctx.guardar();
    ctx.ex = await api.guardarExamen(E, { abierto: abrir });
    ctx.borrador.abierto = ctx.ex.abierto;
    notificar(ctx.ex.abierto ? 'Examen abierto: ya pueden entrar los alumnos' : 'Examen cerrado: no puede entrar nadie más');
    pintarCabecera();
  };

  const alSalir = e => {
    if (temporizador) {
      e.preventDefault();
      ctx.guardar();
    }
  };
  window.addEventListener('beforeunload', alSalir);
  limpiezaVista = () => {
    window.removeEventListener('beforeunload', alSalir);
    if (temporizador) ctx.guardar();
    ctx.limpiar.forEach(f => f());
  };

  // Cabecera común
  const titulo = h('h1');
  const chips = h('div', { class: 'fila' });
  const datos = h('p', { class: 'suave pequeno', style: { margin: 0 } });
  const codigo = h('span', { class: 'codigo codigo-medio' });
  const botonAbrir = h('button', { class: 'boton' });
  const pasos = h('nav', { class: 'pasos-examen', 'aria-label': 'Pasos del examen' });
  const contenido = h('div', { class: 'contenido-pestana' });
  const pie = h('div', { class: 'pie-paso' });
  const migaTitulo = h('span');

  function pintarCabecera() {
    const x = { ...ctx.ex, ...ctx.borrador, abierto: ctx.ex.abierto, alumnos: ctx.ex.alumnos };
    document.title = `TestGO · ${x.titulo}`;
    titulo.textContent = x.titulo;
    migaTitulo.textContent = x.titulo;
    vaciar(chips, x.abierto ? h('span', { class: 'chip exito' }, 'Abierto') : h('span', { class: 'chip' }, 'Cerrado'));
    const puntos = x.preguntas.reduce((s, p) => s + p.puntos, 0);
    datos.textContent = `${x.asignatura ? `${x.asignatura} · ` : ''}${plural(x.preguntas.length, 'pregunta', 'preguntas')} · ${plural(puntos, 'punto', 'puntos')} · ${x.duracion} min${x.alumnos ? ` · ${plural(x.alumnos, 'alumno', 'alumnos')}` : ''}`;
    codigo.textContent = x.codigo;
    // Para abrir hay que pasar por "Revisar y abrir"; cerrar se puede desde aquí
    botonAbrir.className = `boton ${x.abierto ? '' : 'primario'}`;
    vaciar(botonAbrir, x.abierto ? [icono('candado'), 'Cerrar examen'] : ['Revisar y abrir', icono('derecha')]);
    botonAbrir.onclick = x.abierto ? e => ocupado(e.currentTarget, () => ctx.cambiarAbierto(false)) : () => irA(rutaExamen(E, 'revisar'));
    if (pestana === 'revisar' && !x.abierto) botonAbrir.hidden = true;
    else botonAbrir.hidden = false;
    const estado = estadoPasos(N.limpiarExamen({ ...x }, x));
    vaciar(pasos, Object.entries(PESTANAS).map(([clave, texto], n) => h('a', {
      href: rutaExamen(E, clave),
      class: `paso-examen ${clave === pestana ? 'actual' : ''} ${estado[clave] || ''}`,
      'aria-current': clave === pestana ? 'step' : null,
    },
    h('span', { class: 'num' }, estado[clave] === 'hecho' && clave !== pestana ? icono('check') : n + 1),
    h('span', {}, texto),
    clave === 'directo' && x.abierto ? h('span', { class: 'punto-vivo', 'aria-label': 'abierto' }) : null,
    )));
  }
  ctx.pintarCabecera = pintarCabecera;

  // Pie de cada paso: anterior y siguiente
  const claves = Object.keys(PESTANAS);
  const anterior = claves[claves.indexOf(pestana) - 1];
  const siguiente = SIGUIENTE[pestana];
  vaciar(pie,
    anterior ? h('a', { class: 'boton fantasma', href: rutaExamen(E, anterior) }, icono('izquierda'), PESTANAS[anterior]) : h('span'),
    siguiente ? h('a', { class: 'boton primario', href: rutaExamen(E, siguiente[0]) }, siguiente[1], icono('derecha')) : h('span'),
  );

  vaciar(app,
    h('nav', { class: 'migas', 'aria-label': 'Ruta' }, h('a', { href: '#/' }, 'Exámenes'), h('span', { 'aria-hidden': 'true' }, '/'), migaTitulo, h('span', { class: 'espacio' }), estadoGuardado),
    h('header', { class: 'cabecera-examen' },
      h('div', { class: 'pila', style: { gap: '6px', minWidth: 0 } }, h('div', { class: 'fila' }, titulo, chips), datos),
      h('div', { class: 'acciones-examen' },
        h('div', { class: 'caja-codigo' },
          h('span', { class: 'pequeno suave' }, 'Código'),
          codigo,
          h('button', { class: 'boton fantasma mini', title: 'Copiar código', 'aria-label': 'Copiar código', onclick: () => copiar(ctx.ex.codigo, 'Código copiado') }, icono('copia')),
          h('button', { class: 'boton fantasma mini', title: 'Mostrar a la clase', 'aria-label': 'Mostrar el código a la clase', onclick: () => mostrarALaClase(ctx) }, icono('pantalla')),
        ),
        botonAbrir,
      ),
    ),
    pasos,
    contenido,
    pie,
  );
  pintarCabecera();

  ({ preguntas: pestanaPreguntas, ajustes: pestanaAjustes, revisar: pestanaRevisar, directo: pestanaDirecto, resultados: pestanaResultados })[pestana](ctx, contenido);
}

// Código en grande para proyectarlo en clase
async function mostrarALaClase(ctx) {
  const url = await urlAlumnos();
  const contador = h('p', { class: 'suave' });
  const parar = api.observarIntentos(ctx.E, ({ intentos }) => {
    contador.textContent = intentos.length ? `${plural(intentos.length, 'alumno ha entrado', 'alumnos han entrado')}` : 'Esperando a los alumnos…';
  }, () => {});
  dialogo({
    ancho: true,
    contenido: h('div', { class: 'proyeccion' },
      marca(true, '#'),
      h('p', { class: 'suave' }, 'Entra en'),
      h('div', { class: 'proyeccion-url' }, url),
      h('p', { class: 'suave' }, 'y escribe este código'),
      h('div', { class: 'proyeccion-codigo' }, ctx.ex.codigo),
      ctx.ex.abierto ? contador : h('div', { class: 'aviso amarillo' }, 'El examen está cerrado: ábrelo para que puedan entrar.'),
    ),
    botones: [{ texto: 'Cerrar', valor: true }],
  }).then(parar);
}

// ---------- Paso 1: preguntas (índice a la izquierda, una pregunta a la derecha) ----------

const NOMBRE_CORTO = { test: 'Test', vf: 'V / F', multiple: 'Varias', corta: 'Corta', numerica: 'Numérica', relacionar: 'Relacionar', desarrollo: 'Desarrollo' };
const tieneProblemas = p => N.problemasExamen({ preguntas: [p] }).length > 0;

function pestanaPreguntas(ctx, contenido) {
  const { borrador } = ctx;
  if (!borrador.preguntas.some(p => p.id === ctx.seleccion)) ctx.seleccion = borrador.preguntas[0]?.id ?? null;
  const indice = h('div', { class: 'indice-preguntas' });
  const zonaEditor = h('div', { class: 'zona-editor' });
  const avisoAlumnos = ctx.ex.alumnos
    ? h('div', { class: 'aviso amarillo pequeno', style: { marginBottom: '14px' } }, `Ya hay ${plural(ctx.ex.alumnos, 'alumno', 'alumnos')} en este examen. Puedes corregir textos y soluciones (las notas se recalculan), pero no quitar preguntas ni opciones.`)
    : null;

  const seleccionar = id => {
    ctx.seleccion = id;
    pintar();
    zonaEditor.scrollIntoView({ block: 'nearest' });
    $('textarea', zonaEditor)?.focus({ preventScroll: true });
  };

  const rehacer = () => {
    ordenarApartados(borrador.preguntas);
    pintar();
    ctx.programar();
  };

  const anadir = (tipo, extra = {}) => {
    const inicial = { tipo, opciones: tipo === 'test' || tipo === 'multiple' ? ['', '', '', ''] : undefined, pares: tipo === 'relacionar' ? [{}, {}, {}] : undefined, ...extra };
    const p = N.limpiarPregunta(inicial);
    // Se añade después de la seleccionada (o al final)
    const i = borrador.preguntas.findIndex(q => q.id === ctx.seleccion);
    const despues = i >= 0 ? borrador.preguntas.findLastIndex(q => q === borrador.preguntas[i] || (q.grupo && q.grupo === borrador.preguntas[i].grupo)) : -1;
    borrador.preguntas.splice(despues >= 0 ? despues + 1 : borrador.preguntas.length, 0, p);
    ctx.programar();
    seleccionar(p.id);
  };

  const importar = async inicio => {
    const r = await dialogoImportar(inicio);
    if (!r) return;
    borrador.preguntas.push(...r.preguntas);
    ctx.seleccion = r.preguntas[0]?.id ?? ctx.seleccion;
    pintar();
    ctx.programar();
    notificar(`${plural(r.preguntas.length, 'pregunta añadida', 'preguntas añadidas')}`);
  };

  // Mover arrastrando en el índice: las sueltas saltan ejercicios enteros; los apartados, dentro del suyo
  const mover = (idOrigen, idDestino) => {
    const origen = borrador.preguntas.find(q => q.id === idOrigen);
    const destino = borrador.preguntas.find(q => q.id === idDestino);
    if (!origen || !destino || origen === destino) return;
    const grupos = N.unidades(borrador.preguntas);
    // Se coloca donde estaba el destino: detrás si se mueve hacia abajo, delante si hacia arriba
    const recolocar = (lista, elemento, objetivo) => {
      const k = lista.indexOf(elemento);
      const bajando = k < lista.indexOf(objetivo);
      lista.splice(k, 1);
      lista.splice(lista.indexOf(objetivo) + (bajando ? 1 : 0), 0, elemento);
    };
    if (origen.grupo && origen.grupo === destino.grupo) {
      recolocar(grupos.find(x => x.includes(origen)), origen, destino);
    } else if (origen.grupo && destino.grupo && origen.grupo !== destino.grupo) {
      return notificar('Un apartado solo se mueve dentro de su ejercicio', 'error');
    } else {
      const gOrigen = grupos.find(x => x.includes(origen));
      const gDestino = grupos.find(x => x.includes(destino));
      if (gOrigen === gDestino) return;
      recolocar(grupos, gOrigen, gDestino);
    }
    borrador.preguntas.splice(0, borrador.preguntas.length, ...grupos.flat());
    rehacer();
  };

  function pintarIndice() {
    const info = infoLista(borrador.preguntas);
    const total = borrador.preguntas.reduce((s, p) => s + Number(p.puntos || 0), 0);
    let arrastrada = null;
    vaciar(indice,
      h('div', { class: 'indice-lista', role: 'list' }, borrador.preguntas.map((p, i) =>
        h('button', {
          type: 'button', role: 'listitem', draggable: true,
          class: `item-indice ${p.id === ctx.seleccion ? 'sel' : ''} ${p.grupo && !info[i].primeroDelGrupo ? 'apartado' : ''}`,
          'aria-current': p.id === ctx.seleccion ? 'true' : null,
          title: p.enunciado || 'Sin enunciado',
          onclick: () => seleccionar(p.id),
          ondragstart: e => {
            arrastrada = p.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', p.id);
          },
          ondragover: e => (e.preventDefault(), e.currentTarget.classList.add('encima')),
          ondragleave: e => e.currentTarget.classList.remove('encima'),
          ondrop: e => {
            e.preventDefault();
            mover(arrastrada || e.dataTransfer.getData('text/plain'), p.id);
          },
        },
        h('span', { class: 'num' }, info[i].numero),
        h('span', { class: 'texto' }, p.enunciado.trim() || h('i', {}, 'Sin enunciado')),
        h('span', { class: 'meta' }, NOMBRE_CORTO[p.tipo], ' · ', N.numero(p.puntos)),
        tieneProblemas(p) ? h('span', { class: 'punto-aviso', title: 'Le falta algo' }) : null,
        ))),
      h('div', { class: 'indice-pie' },
        menuAnadir(anadir, 'izquierda'),
        h('div', { class: 'fila entre pequeno' },
          h('span', {}, 'Total ', h('b', {}, `${N.numero(total)} puntos`)),
          total > 0 && Math.abs(total - 10) > 0.001 ? h('button', { class: 'boton fantasma mini', title: 'Reparte los puntos para que el examen sume 10', onclick: () => {
            ajustarA10(borrador.preguntas);
            pintar();
            ctx.programar();
            notificar('Puntos ajustados para que el examen sume 10');
          } }, 'Ajustar a 10') : null,
        ),
        h('p', { class: 'pequeno suave', style: { margin: 0 } }, 'Arrastra las preguntas para cambiar el orden.'),
      ),
    );
  }

  function pintarEditor() {
    const i = borrador.preguntas.findIndex(q => q.id === ctx.seleccion);
    if (i < 0) return vaciar(zonaEditor);
    const p = borrador.preguntas[i];
    const info = infoLista(borrador.preguntas);
    const anteriorId = borrador.preguntas[i - 1]?.id;
    const siguienteId = borrador.preguntas[i + 1]?.id;
    vaciar(zonaEditor,
      h('div', { class: 'fila entre barra-editor' },
        h('span', { class: 'pequeno suave' }, `Pregunta ${info[i].numero} de ${borrador.preguntas.length}`),
        h('div', { class: 'fila' },
          h('button', { class: 'boton fantasma mini', onclick: () => vistaAlumno(ctx, p.id) }, icono('ojo'), 'Vista del alumno'),
          h('button', { class: 'boton fantasma mini', disabled: !anteriorId, 'aria-label': 'Pregunta anterior', title: 'Pregunta anterior', onclick: () => seleccionar(anteriorId) }, icono('izquierda')),
          h('button', { class: 'boton fantasma mini', disabled: !siguienteId, 'aria-label': 'Pregunta siguiente', title: 'Pregunta siguiente', onclick: () => seleccionar(siguienteId) }, icono('derecha')),
        ),
      ),
      editorPregunta(p, i, borrador.preguntas.length, {
        ...info[i],
        alCambiar: () => (ctx.programar(), pintarIndice()),
        alRehacer: () => (pintar(), ctx.programar()),
        alMover: d => {
          const destino = borrador.preguntas[i + d];
          if (destino) mover(p.id, destino.id);
        },
        alDuplicar: () => {
          const copia = N.limpiarPregunta({ ...structuredClone(p), id: undefined });
          borrador.preguntas.splice(i + 1, 0, copia);
          ctx.seleccion = copia.id;
          rehacer();
        },
        alAnadirApartado: () => {
          if (!p.grupo) Object.assign(p, { grupo: N.nuevoId(), apartado: 'a', contexto: '' });
          const ultimo = borrador.preguntas.findLastIndex(q => q.grupo === p.grupo);
          const nueva = N.limpiarPregunta({ tipo: 'desarrollo', grupo: p.grupo, contexto: p.contexto });
          borrador.preguntas.splice(ultimo + 1, 0, nueva);
          ctx.seleccion = nueva.id;
          rehacer();
        },
        alCambiarContexto: texto => {
          cambiarContexto(borrador.preguntas, p.grupo, texto);
          ctx.programar();
        },
        // Sin "¿seguro?": se borra y se puede deshacer
        alBorrar: () => {
          const copia = structuredClone(borrador.preguntas);
          const seleccionAntes = ctx.seleccion;
          borrador.preguntas.splice(i, 1);
          ctx.seleccion = borrador.preguntas[Math.min(i, borrador.preguntas.length - 1)]?.id ?? null;
          rehacer();
          notificar('Pregunta borrada', '', {
            texto: 'Deshacer',
            alPulsar: () => {
              borrador.preguntas.splice(0, borrador.preguntas.length, ...copia);
              ctx.seleccion = seleccionAntes;
              pintar();
              ctx.programar();
            },
          });
        },
        sinConfirmarBorrado: true,
      }),
    );
  }

  function pintar() {
    if (!borrador.preguntas.length) return pintarInicio();
    vaciar(contenido, avisoAlumnos, h('div', { class: 'editor-preguntas' }, indice, zonaEditor));
    pintarIndice();
    pintarEditor();
  }

  // Examen vacío: cuatro formas de empezar
  function pintarInicio() {
    const opcion = (ico, titulo, texto, accion) => h('button', { class: 'opcion-inicio', type: 'button', onclick: accion }, icono(ico, 'icono-opcion'), h('b', {}, titulo), h('span', {}, texto));
    vaciar(contenido,
      h('div', { class: 'inicio-preguntas' },
        h('h2', {}, '¿Cómo quieres crear las preguntas?'),
        h('p', { class: 'suave' }, 'Puedes combinar varias formas: después siempre puedes añadir, cambiar o quitar preguntas.'),
        h('div', { class: 'opciones-inicio' },
          opcion('lapiz', 'Escribirlas aquí', 'Empieza por una de test y añade las que quieras.', () => anadir('test')),
          opcion('subir', 'Importar un Word o PDF', 'TestGO separa las preguntas por ti.', () => importar()),
          opcion('chispa', 'Con ayuda de una IA', 'Para exámenes con un formato raro.', () => importar('ia')),
          opcion('copia', 'Copiar de otro examen', 'Reutiliza preguntas que ya tienes.', () => copiarDeOtro(ctx, preguntas => {
            borrador.preguntas.push(...preguntas);
            ctx.seleccion = preguntas[0]?.id;
            pintar();
            ctx.programar();
          })),
        ),
      ),
    );
  }

  ctx.alCambiarBorrador = () => ctx.pintarCabecera?.();
  pintar();
}

// Reparte los puntos para que el examen sume 10, manteniendo la proporción entre preguntas
function ajustarA10(preguntas) {
  const total = preguntas.reduce((s, p) => s + p.puntos, 0);
  if (!total) return;
  const factor = 10 / total;
  for (const p of preguntas) {
    const antes = p.puntos;
    p.puntos = Math.round(p.puntos * factor * 100) / 100;
    if (p.criterios?.length && antes) p.criterios.forEach(c => (c.puntos = Math.round(c.puntos * (p.puntos / antes) * 100) / 100));
  }
  // Lo que sobre o falte por redondear va a la pregunta que más vale
  const diferencia = Math.round((10 - preguntas.reduce((s, p) => s + p.puntos, 0)) * 100) / 100;
  if (diferencia) {
    const mayor = preguntas.reduce((a, b) => (b.puntos > a.puntos ? b : a));
    mayor.puntos = Math.round((mayor.puntos + diferencia) * 100) / 100;
  }
}

// Elegir un examen y copiar sus preguntas (con identificadores nuevos)
async function copiarDeOtro(ctx, alElegir) {
  let examenes;
  try {
    examenes = (await api.listarExamenes()).filter(e => e.id !== ctx.E && e.preguntas > 0);
  } catch (e) {
    return notificarError(e);
  }
  if (!examenes.length) return notificar('No tienes otros exámenes con preguntas');
  const elegido = await dialogo({
    titulo: 'Copiar preguntas de otro examen',
    contenido: h('div', { class: 'lista-elegir' }, examenes.map(e =>
      h('label', { class: 'opcion-elegir' }, h('input', { type: 'radio', name: 'examen-origen', value: e.id }), h('span', {}, h('b', {}, e.titulo), h('small', {}, `${plural(e.preguntas, 'pregunta', 'preguntas')} · ${fechaCorta(e.creado)}`))))),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Copiar preguntas', clase: 'primario', valor: () => $('input[name="examen-origen"]:checked')?.value || null }],
  });
  if (!elegido) return;
  const origen = await ocupado(null, () => api.obtenerExamen(elegido));
  if (!origen) return;
  const grupos = new Map();
  const copias = origen.preguntas.map(p => {
    if (p.grupo && !grupos.has(p.grupo)) grupos.set(p.grupo, N.nuevoId());
    return N.limpiarPregunta({ ...structuredClone(p), id: undefined, grupo: p.grupo ? grupos.get(p.grupo) : undefined });
  });
  alElegir(copias);
  notificar(`${plural(copias.length, 'pregunta copiada', 'preguntas copiadas')} de "${origen.titulo}"`);
}

// Cómo verá el alumno el examen (o una pregunta), sin guardar nada
function vistaAlumno(ctx, desdeId) {
  const ex = N.limpiarExamen(ctx.borrador, ctx.borrador);
  const preguntas = N.vistaPreguntas(N.preguntasPublicas(ex.preguntas), ex.preguntas.map(p => ({ id: p.id, perm: null })));
  const numeros = N.etiquetas(preguntas);
  let i = Math.max(0, preguntas.findIndex(p => p.id === desdeId));
  const cuerpo = h('div');
  const pintar = () => {
    const p = preguntas[i];
    let control;
    if (p.opciones) {
      control = h('div', { class: `opciones ${p.tipo === 'vf' ? 'opciones-vf' : ''}` }, p.opciones.map((o, j) =>
        h('label', { class: 'opcion' }, h('input', { type: p.tipo === 'multiple' ? 'checkbox' : 'radio', name: 'vista' }), h('span', { class: 'letra' }, p.tipo === 'vf' ? o.texto[0] : String.fromCharCode(65 + j)), h('span', { class: 'texto-opcion' }, o.texto))));
    } else if (p.tipo === 'relacionar') {
      control = h('div', { class: 'relacionar' }, p.izquierda.map((t, k) => h('div', { class: 'fila-relacionar' }, h('span', { class: 'izquierda' }, h('span', { class: 'letra-mini' }, k + 1), t), h('select', {}, h('option', {}, 'Elige…'), p.derecha.map(d => h('option', {}, d.texto))))));
    } else if (p.tipo === 'numerica') {
      control = h('div', { class: 'fila' }, h('input', { type: 'text', class: 'respuesta-numerica', placeholder: '0' }), p.unidad ? h('span', { class: 'unidad' }, p.unidad) : null);
    } else {
      control = h('textarea', { class: 'respuesta-alumno', rows: p.tipo === 'corta' ? 3 : 8, placeholder: 'Escribe aquí tu respuesta' });
    }
    vaciar(cuerpo,
      h('section', { class: 'tarjeta pregunta', style: { boxShadow: 'none' } },
        h('div', { class: 'fila entre' }, h('span', { class: 'meta' }, 'Pregunta ', h('span', { class: 'sin-mayusculas' }, numeros[i]), ` de ${preguntas.length}`), h('span', { class: 'chip sin-punto' }, plural(p.puntos, 'punto', 'puntos'))),
        p.contexto ? h('div', { class: 'contexto' }, p.contexto) : null,
        h('h2', { class: 'enunciado' }, p.apartado ? h('span', { class: 'letra-apartado' }, `${p.apartado})`) : null, p.enunciado || 'Sin enunciado'),
        p.imagen ? h('img', { class: 'imagen-revision', src: api.urlImagen(p.imagen), alt: '' }) : null,
        control,
      ),
      h('div', { class: 'fila entre', style: { marginTop: '12px' } },
        h('button', { class: 'boton', disabled: i === 0, onclick: () => ((i -= 1), pintar()) }, icono('izquierda'), 'Anterior'),
        h('span', { class: 'pequeno suave' }, 'Vista previa: no se guarda nada'),
        h('button', { class: 'boton', disabled: i === preguntas.length - 1, onclick: () => ((i += 1), pintar()) }, 'Siguiente', icono('derecha')),
      ),
    );
  };
  if (!preguntas.length) return notificar('Todavía no hay preguntas');
  pintar();
  dialogo({ titulo: 'Así lo verá el alumno', contenido: cuerpo, ancho: true, botones: [{ texto: 'Cerrar', valor: true }] });
}

const DESCRIPCION_TIPO = {
  test: 'Una respuesta correcta entre varias',
  vf: 'Una afirmación verdadera o falsa',
  multiple: 'Varias respuestas correctas',
  corta: 'Una palabra o cifra que se corrige sola',
  numerica: 'Un número con un margen de error (±)',
  relacionar: 'Unir elementos de dos columnas',
  desarrollo: 'Texto libre, con criterios de corrección',
};

// Menú desplegable para añadir una pregunta de cualquier tipo
function menuAnadir(anadir, lado = 'derecha') {
  const menu = h('details', { class: `menu menu-${lado}` },
    h('summary', { class: 'boton primario' }, icono('mas'), 'Añadir pregunta'),
    h('div', { class: 'menu-lista' }, N.TIPOS.map(t =>
      h('button', { type: 'button', onclick: () => {
        menu.open = false;
        anadir(t);
      } }, h('b', {}, N.NOMBRE_TIPO[t]), h('span', {}, DESCRIPCION_TIPO[t])))),
  );
  // Se cierra al pulsar fuera
  const fuera = e => menu.open && !menu.contains(e.target) && (menu.open = false);
  document.addEventListener('click', fuera);
  return menu;
}

// ---------- Paso 2: ajustes ----------

function pestanaAjustes(ctx, contenido) {
  const b = ctx.borrador;
  const entrada = (clave, atributos, convertir = v => v) =>
    h('input', { ...atributos, value: b[clave], oninput: e => ((b[clave] = convertir(e.target.value)), ctx.programar()) });
  const interruptor = (clave, texto, explicacion) =>
    h('label', { class: 'ajuste-interruptor' },
      h('span', {}, h('b', {}, texto), h('small', {}, explicacion)),
      h('input', { type: 'checkbox', role: 'switch', class: 'interruptor', checked: !!b[clave], onchange: e => ((b[clave] = e.target.checked), ctx.programar(), pintar()) }));

  const seccion = (tituloSeccion, descripcion, ...hijos) =>
    h('section', { class: 'tarjeta ajustes-seccion' },
      h('div', {}, h('h3', {}, tituloSeccion), h('p', { class: 'suave pequeno', style: { margin: 0 } }, descripcion)),
      h('div', { class: 'pila' }, hijos));

  const elegirModo = clave => {
    b.modo = clave;
    Object.assign(b, N.MODOS[clave].ajustes);
    ctx.programar();
    pintar();
  };

  function pintar() {
    const penalizacion = h('select', { onchange: e => ((b.penalizacion = Number(e.target.value)), ctx.programar()) },
      [['0', 'No restan'], ['0.25', 'Restan 1/4 de la pregunta'], ['0.3333', 'Restan 1/3 de la pregunta'], ['0.5', 'Restan 1/2 de la pregunta'], ['1', 'Restan la pregunta entera']].map(([v, t]) => h('option', { value: v }, t)));
    if (![...penalizacion.options].some(o => Math.abs(Number(o.value) - b.penalizacion) < 0.001)) penalizacion.append(h('option', { value: String(b.penalizacion) }, `Restan ${N.numero(b.penalizacion * 100)} %`));
    penalizacion.value = [...penalizacion.options].find(o => Math.abs(Number(o.value) - b.penalizacion) < 0.001)?.value;

    const personalizado = b.modo === 'personalizado';
    vaciar(contenido, h('div', { class: 'pila' },
      h('section', { class: 'tarjeta' },
        h('h3', {}, '¿Qué tipo de examen es?'),
        h('p', { class: 'suave pequeno' }, 'Elige uno y TestGO pone los ajustes de control por ti. Siempre puedes cambiarlos uno a uno.'),
        h('div', { class: 'modos' }, Object.entries(N.MODOS).map(([clave, m]) =>
          h('label', { class: `modo ${b.modo === clave ? 'elegido' : ''}` },
            h('input', { type: 'radio', name: 'modo', checked: b.modo === clave, onchange: () => elegirModo(clave) }),
            h('b', {}, m.nombre), h('span', {}, m.descripcion)))),
        !b.modo ? h('p', { class: 'pequeno texto-aviso', style: { margin: '12px 0 0' } }, 'Todavía no has elegido: se usan los ajustes por defecto (bloqueo a la primera salida).') : null,
      ),
      seccion('Qué pasará durante el examen', personalizado ? 'Cambia cada opción a tu gusto.' : 'Lo que hace el modo elegido.',
        personalizado
          ? [
            campo('Bloquear tras salir', entrada('maxSalidas', { type: 'number', min: 0, max: 50 }, Number), 'Número de veces que puede salir de la pantalla del examen antes de bloquearse. 0 = no bloquear nunca.'),
            interruptor('barajar', 'Barajar preguntas y opciones', 'Cada alumno las ve en un orden distinto.'),
            interruptor('mostrarNota', 'Enseñar la nota al entregar', 'Si hay preguntas de desarrollo, la nota será provisional hasta que las corrijas.'),
            interruptor('marcaAgua', 'Marca de agua con el nombre y la fecha', 'El nombre del alumno y la fecha salen de fondo: si alguien hace una foto o una captura, se sabe de quién es.'),
          ]
          : [
            h('ul', { class: 'lista-explicacion' }, N.explicarControl(b).map(t => h('li', {}, t))),
            h('div', {}, h('button', { class: 'boton fantasma mini', onclick: () => ((b.modo = 'personalizado'), ctx.programar(), pintar()) }, 'Cambiar las opciones una a una')),
          ],
      ),
      seccion('General', 'Lo que ven los alumnos al entrar.',
        campo('Título', entrada('titulo', { type: 'text', maxlength: 200 })),
        campo('Asignatura o módulo', entrada('asignatura', { type: 'text', maxlength: 120, placeholder: 'Montaje y Mantenimiento de Equipos' }), 'Sale en la pantalla del alumno y en los PDF, junto al nombre y el logo del centro.'),
        h('div', { class: 'rejilla', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } },
          campo('Duración (minutos)', entrada('duracion', { type: 'number', min: 1, max: 600 }, Number)),
          campo(['Preguntas por alumno ', ayuda('Si el examen tiene 20 preguntas y pones 10, a cada alumno le tocan 10 al azar (los ejercicios con apartados cuentan como una). Así no todos tienen el mismo examen.')], entrada('numPreguntas', { type: 'number', min: 0, max: 500 }, Number), '0 = todas.'),
        ),
      ),
      seccion('Corrección', 'Cómo se puntúan los fallos.',
        campo(['Respuestas incorrectas en test ', ayuda('Solo afecta a las de test y verdadero o falso. Las que se dejan en blanco nunca restan. En las de varias correctas, cada opción mal marcada ya resta por sí sola.')], penalizacion),
      ),
      seccion('Código de acceso', 'Si el código se ha difundido, genera otro. Los que ya están dentro siguen.',
        h('div', { class: 'fila' },
          h('span', { class: 'codigo codigo-medio' }, ctx.ex.codigo),
          h('button', { class: 'boton', onclick: async e => {
            if (!(await confirmar('¿Cambiar el código?', 'El código actual dejará de funcionar. Los alumnos que ya estén dentro no se ven afectados.', 'Cambiar código'))) return;
            ocupado(e.currentTarget, async () => {
              ctx.ex = await api.nuevoCodigo(ctx.E);
              notificar(`Nuevo código: ${ctx.ex.codigo}`);
              mostrar();
            });
          } }, icono('refrescar'), 'Generar otro código'),
        ),
      ),
      seccion('Otras acciones', 'Copia el examen para otro grupo o bórralo.',
        h('div', { class: 'fila' },
          h('button', { class: 'boton', onclick: e => duplicarExamen(ctx.E, e.currentTarget) }, icono('copia'), 'Duplicar examen'),
          h('button', { class: 'boton peligro', onclick: e => borrarExamen(ctx.ex, e.currentTarget, () => irA('#/')) }, icono('papelera'), 'Borrar examen'),
        ),
      ),
    ));
    ctx.pintarCabecera?.();
  }
  pintar();
}

// Botón (?) que explica un ajuste
const ayuda = texto => h('button', { type: 'button', class: 'ayuda', title: texto, 'aria-label': `Ayuda: ${texto}`, onclick: e => {
  e.preventDefault();
  notificar(texto);
} }, '?');

// ---------- Paso 3: revisar y abrir ----------

function pestanaRevisar(ctx, contenido) {
  const x = N.limpiarExamen(ctx.borrador, ctx.borrador);
  const problemas = N.problemasExamen(x);
  const puntos = x.preguntas.reduce((s, p) => s + p.puntos, 0);
  const fila = (ok, titulo, detalle, accion) =>
    h('li', { class: `comprobacion ${ok ? 'bien' : 'mal'}` },
      h('span', { class: 'icono-comprobacion' }, icono(ok ? 'check' : 'aviso')),
      h('div', {}, h('b', {}, titulo), detalle ? h('div', { class: 'pequeno suave' }, detalle) : null),
      accion || null);
  const ir = (paso, texto) => h('a', { class: 'boton fantasma mini', href: rutaExamen(ctx.E, paso) }, texto);

  const abierto = ctx.ex.abierto;
  vaciar(contenido, h('div', { class: 'pila revisar' },
    h('section', { class: 'tarjeta' },
      h('h2', {}, abierto ? 'El examen está abierto' : 'Antes de abrir el examen'),
      h('ul', { class: 'lista-comprobacion' },
        fila(x.preguntas.length > 0, `${plural(x.preguntas.length, 'pregunta', 'preguntas')} · ${plural(puntos, 'punto', 'puntos')}`, x.numPreguntas ? `A cada alumno le tocan ${x.numPreguntas} al azar.` : 'Todos los alumnos tienen todas las preguntas. La nota se calcula sobre 10.', ir('preguntas', 'Ver preguntas')),
        fila(!problemas.length, problemas.length ? `${plural(problemas.length, 'cosa', 'cosas')} por revisar en las preguntas` : 'Todas las preguntas están completas',
          problemas.length ? h('ul', { class: 'problemas' }, problemas.slice(0, 5).map(t => h('li', {}, t)), problemas.length > 5 ? h('li', {}, `y ${problemas.length - 5} más`) : null) : null,
          problemas.length ? ir('preguntas', 'Arreglar') : null),
        fila(true, `Duración: ${x.duracion} minutos`, 'El tiempo empieza a contar para cada alumno cuando pulsa "Empezar".', ir('ajustes', 'Cambiar')),
        fila(!!x.modo, x.modo ? `Modo: ${N.MODOS[x.modo].nombre}` : 'No has elegido el tipo de examen', h('ul', { class: 'problemas' }, N.explicarControl(x).map(t => h('li', {}, t))), ir('ajustes', x.modo ? 'Cambiar' : 'Elegir')),
      ),
    ),
    h('section', { class: 'tarjeta abrir' },
      abierto
        ? [
          h('p', {}, 'Los alumnos ya pueden entrar con el código ', h('b', { class: 'mono' }, ctx.ex.codigo), '.'),
          h('div', { class: 'fila' },
            h('a', { class: 'boton primario grande-ancho', href: rutaExamen(ctx.E, 'directo') }, icono('directo'), 'Ir a En directo'),
            h('button', { class: 'boton', onclick: () => mostrarALaClase(ctx) }, icono('pantalla'), 'Mostrar a la clase'),
            h('button', { class: 'boton', onclick: e => ocupado(e.currentTarget, async () => {
              await ctx.cambiarAbierto(false);
              pestanaRevisar(ctx, contenido);
            }) }, icono('candado'), 'Cerrar examen'),
          ),
        ]
        : [
          h('p', { class: 'suave' }, 'Al abrirlo, los alumnos podrán entrar con el código. Te enseñamos el código en grande para proyectarlo.'),
          h('div', { class: 'fila' },
            h('button', { class: 'boton', onclick: () => vistaAlumno(ctx) }, icono('ojo'), 'Ver como alumno'),
            h('button', { class: 'boton primario grande-ancho', onclick: e => ocupado(e.currentTarget, async () => {
              if (!x.preguntas.length) throw new Error('Añade al menos una pregunta antes de abrirlo.');
              if (problemas.length && !(await confirmar('Hay cosas por revisar', `${problemas[0]}${problemas.length > 1 ? ` (y ${problemas.length - 1} más)` : ''} ¿Abrirlo igualmente?`, 'Abrir igualmente'))) return;
              await ctx.cambiarAbierto(true);
              irA(rutaExamen(ctx.E, 'directo'));
              mostrarALaClase(ctx);
            }) }, icono('directo'), 'Abrir examen'),
          ),
        ],
    ),
  ));
}

// ---------- Paso 4: en directo ----------

const FILTROS_DIRECTO = { todos: 'Todos', en_curso: 'En curso', bloqueado: 'Bloqueados', entregado: 'Entregados', incidencias: 'Con incidencias' };
const VISTAS_DIRECTO = { plano: 'Plano de la clase', tarjetas: 'Tarjetas', tabla: 'Tabla' };
const iniciales = nombre => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
const nombreCorto = nombre => {
  const [primero, segundo] = nombre.split(/\s+/).filter(Boolean);
  return segundo ? `${primero} ${segundo[0]}.` : primero || nombre;
};

function preferencia(clave, porDefecto) {
  try {
    return localStorage.getItem(clave) ?? porDefecto;
  } catch {
    return porDefecto;
  }
}
function guardarPreferencia(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {}
}

// Estado de un alumno para pintarlo (igual en tarjetas, plano y tabla)
function estadoAlumno(a, ahora) {
  const sinSenal = a.estado !== 'entregado' && a.inicio && ahora - (a.ultimaSenal || 0) > (MODO === 'firebase' ? 150000 : 40000);
  const clase = a.estado === 'bloqueado' ? 'bloqueado' : a.estado === 'entregado' ? 'entregado' : sinSenal ? 'sin-senal' : !a.inicio ? 'sin-empezar' : 'en-curso';
  const texto = { bloqueado: 'Bloqueado', entregado: 'Entregado', 'sin-senal': 'Sin conexión', 'sin-empezar': 'Sin empezar', 'en-curso': 'En curso' }[clase];
  const prioridad = { bloqueado: 0, 'sin-senal': 1, 'en-curso': 2, 'sin-empezar': 3, entregado: 4 }[clase];
  return { clase, texto, prioridad, sinSenal };
}

// "Pregunta 4b de 11", "Revisando", o el progreso si aún no ha avisado
function posicionTexto(a) {
  const total = a.orden?.length || 0;
  if (a.estado === 'entregado' || !a.inicio) return '';
  if (a.posicion?.etiqueta === 'Revisión') return 'Revisando antes de entregar';
  if (a.posicion) return `Pregunta ${a.posicion.etiqueta || a.posicion.indice + 1} de ${total}`;
  return '';
}

function pestanaDirecto(ctx, contenido) {
  const { E } = ctx;
  let datos = { intentos: [], solicitudes: [], desfase: 0 };
  let cargado = false;
  let bloqueadosAntes = 0;
  const filtro = { estado: 'todos', texto: '' };
  let vista = preferencia('testgo.vistaDirecto', ctx.borrador.plano ? 'plano' : 'tarjetas');
  let sonido = preferencia('testgo.sonido', 'no') === 'si';

  const resumen = h('div', { class: 'tarjeta resumen-directo' });
  const atencion = h('div', { class: 'atencion' });
  const fin = h('div');
  const herramientas = h('div', { class: 'barra-herramientas' });
  const zona = h('div');

  const enMarcha = () => datos.intentos.filter(a => a.estado !== 'entregado' && a.inicio);

  async function masTiempoATodos(boton) {
    const lista = enMarcha();
    if (!lista.length) return notificar('No hay nadie haciendo el examen');
    if (!(await confirmar('¿Dar 5 minutos más a todos?', `Se añadirán 5 minutos a los ${lista.length} alumnos que siguen con el examen.`, '+5 minutos'))) return;
    await ocupado(boton, async () => {
      for (const a of lista) await api.accion(E, a.id, 'tiempo', { minutos: 5 });
      notificar(`5 minutos más para ${plural(lista.length, 'alumno', 'alumnos')}`);
    });
  }

  async function recogerTodos(boton) {
    const pendientes = datos.intentos.filter(a => a.estado !== 'entregado');
    if (!pendientes.length) return notificar('No hay exámenes sin entregar');
    if (!(await confirmar('¿Recoger todos los exámenes?', `Se entregarán ya los ${pendientes.length} exámenes que siguen abiertos, con lo que lleve respondido cada alumno.`, 'Recoger todos', 'peligro'))) return;
    await ocupado(boton, async () => {
      for (const a of pendientes) await api.accion(E, a.id, 'entregar');
      notificar(`${plural(pendientes.length, 'examen recogido', 'exámenes recogidos')}`);
    });
  }

  // Un pitido corto cuando alguien se bloquea (si el profesor lo ha activado)
  function pitar() {
    try {
      const audio = new AudioContext();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + 0.35);
    } catch {}
  }

  const coincide = a => {
    if (filtro.texto && !N.normalizar(a.nombre).includes(N.normalizar(filtro.texto))) return false;
    if (filtro.estado === 'incidencias') return (a.salidas || 0) > 0 || !!a.ultimaIncidencia;
    return filtro.estado === 'todos' || a.estado === filtro.estado;
  };

  function pintarResumen(ahora) {
    const lista = datos.intentos;
    const cuenta = estado => lista.filter(a => a.estado === estado).length;
    const limites = enMarcha().map(a => N.limiteDe(a));
    const restante = limites.length ? Math.max(...limites) - ahora : null;
    const botonSonido = h('button', {
      class: `boton fantasma mini ${sonido ? 'activo' : ''}`, 'aria-pressed': String(sonido), title: 'Pitar cuando alguien se bloquee',
      onclick: () => {
        sonido = !sonido;
        guardarPreferencia('testgo.sonido', sonido ? 'si' : 'no');
        if (sonido) pitar();
        pintarResumen(Date.now() + datos.desfase);
      },
    }, icono('campana'), sonido ? 'Aviso sonoro activado' : 'Aviso sonoro');
    vaciar(resumen,
      h('div', { class: 'reloj-directo' },
        h('span', { class: 'grande mono', 'data-cuenta': restante === null ? '' : String(Math.max(...limites)) }, restante === null ? '—' : relojTexto(restante)),
        h('span', { class: 'pequeno suave' }, restante === null ? (ctx.ex.abierto ? 'Nadie ha empezado' : 'Examen cerrado') : 'hasta que acabe el último'),
      ),
      h('div', { class: 'cifras' },
        h('span', {}, h('b', {}, cuenta('en_curso')), ' en curso'),
        h('span', {}, h('b', {}, cuenta('entregado')), ' entregados'),
        h('span', { class: cuenta('bloqueado') ? 'texto-peligro' : '' }, h('b', {}, cuenta('bloqueado')), ' bloqueados'),
        h('span', { class: 'suave' }, `de ${plural(lista.length, 'alumno', 'alumnos')}`),
      ),
      h('div', { class: 'fila acciones-directo' },
        h('button', { class: 'boton', onclick: e => masTiempoATodos(e.currentTarget) }, '+5 min a todos'),
        h('button', { class: 'boton peligro', onclick: e => recogerTodos(e.currentTarget) }, 'Recoger todos'),
        h('button', { class: 'boton fantasma mini', onclick: () => mostrarALaClase(ctx) }, icono('pantalla'), 'Código'),
        botonSonido,
      ),
    );
  }

  // Lo urgente primero: bloqueos, peticiones para volver a entrar y alumnos sin conexión
  function pintarAtencion(ahora) {
    const avisos = [];
    for (const a of datos.intentos.filter(x => x.estado === 'bloqueado')) {
      avisos.push(h('div', { class: 'aviso-directo rojo' },
        icono('candado'),
        h('span', {}, h('b', {}, a.nombre), ` se ha bloqueado${a.ultimaIncidencia ? `: ${a.ultimaIncidencia.detalle.toLowerCase()}` : ''}`),
        h('button', { class: 'boton fantasma mini', onclick: () => detalleAlumno(ctx, a.id) }, 'Ver'),
        h('button', { class: 'boton primario mini', onclick: e => ocupado(e.currentTarget, () => api.accion(E, a.id, 'desbloquear')) }, 'Desbloquear'),
      ));
    }
    for (const s of datos.solicitudes) {
      avisos.push(h('div', { class: 'aviso-directo ambar' },
        icono('directo'),
        h('span', {}, h('b', {}, s.nombre), ' pide volver a entrar desde otro equipo'),
        h('button', { class: 'boton fantasma mini', onclick: e => ocupado(e.currentTarget, () => api.resolverSolicitud(E, s.id, false)) }, 'Rechazar'),
        h('button', { class: 'boton primario mini', onclick: e => ocupado(e.currentTarget, async () => {
          await api.resolverSolicitud(E, s.id, true);
          notificar(`${s.nombre} puede volver a entrar`);
        }) }, 'Permitir'),
      ));
    }
    // Los que no tienen conexión van en un solo aviso: si se cae la wifi serían muchos
    const sinConexion = datos.intentos.filter(x => estadoAlumno(x, ahora).sinSenal && x.estado !== 'bloqueado');
    if (sinConexion.length === 1) {
      const [a] = sinConexion;
      avisos.push(h('div', { class: 'aviso-directo' },
        icono('reloj'),
        h('span', {}, h('b', {}, a.nombre), ` lleva ${N.duracionTexto(ahora - a.ultimaSenal)} sin conexión`),
        h('button', { class: 'boton fantasma mini', onclick: () => detalleAlumno(ctx, a.id) }, 'Ver'),
      ));
    } else if (sinConexion.length > 1) {
      avisos.push(h('div', { class: 'aviso-directo' },
        icono('reloj'),
        h('span', {}, h('b', {}, `${sinConexion.length} alumnos sin conexión: `), sinConexion.map(a => nombreCorto(a.nombre)).join(', '),
          sinConexion.length >= datos.intentos.filter(x => x.estado !== 'entregado').length / 2 ? h('span', { class: 'suave' }, ' · Puede que se haya caído la wifi del aula.') : null),
        h('button', { class: 'boton fantasma mini', onclick: () => detalleAlumno(ctx, sinConexion[0].id, sinConexion.map(a => a.id)) }, 'Ver'),
      ));
    }
    vaciar(atencion, avisos.length
      ? [h('h3', { class: 'titulo-atencion' }, `Necesita tu atención (${avisos.length})`), avisos]
      : cargado && datos.intentos.length ? h('p', { class: 'todo-bien' }, icono('check'), 'Todo en orden') : null);

    const todos = datos.intentos.length;
    const entregados = datos.intentos.filter(a => a.estado === 'entregado').length;
    vaciar(fin, todos && entregados === todos
      ? h('div', { class: 'aviso exito fila entre', style: { marginBottom: '16px' } },
        h('span', {}, h('b', {}, 'Todos han entregado. '), ctx.ex.abierto ? 'Puedes cerrar el examen y empezar a corregir.' : 'Ya puedes corregir.'),
        h('div', { class: 'fila' },
          ctx.ex.abierto ? h('button', { class: 'boton mini', onclick: e => ocupado(e.currentTarget, () => ctx.cambiarAbierto(false)) }, 'Cerrar examen') : null,
          h('a', { class: 'boton primario mini', href: rutaExamen(E, 'resultados') }, 'Empezar a corregir', icono('derecha')),
        ))
      : null);
  }

  function pintarHerramientas() {
    const cuenta = clave => datos.intentos.filter(a => (clave === 'todos' ? true : clave === 'incidencias' ? (a.salidas || 0) > 0 || a.ultimaIncidencia : a.estado === clave)).length;
    vaciar(herramientas,
      h('div', { class: 'segmentado', role: 'tablist', 'aria-label': 'Cómo ver a los alumnos' }, Object.entries(VISTAS_DIRECTO).map(([v, t]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(vista === v), class: vista === v ? 'activo' : '', onclick: () => {
          vista = v;
          guardarPreferencia('testgo.vistaDirecto', v);
          pintarTodo();
        } }, icono({ plano: 'mesa', tarjetas: 'cuadricula', tabla: 'lista' }[v]), t))),
      vista === 'plano' ? h('span') : h('div', { class: 'fila' },
        h('label', { class: 'buscador' }, icono('lupa'), h('input', { type: 'search', placeholder: 'Buscar alumno', value: filtro.texto, 'aria-label': 'Buscar alumno', oninput: e => {
          filtro.texto = e.target.value;
          pintarZona(Date.now() + datos.desfase);
        } })),
        h('select', { 'aria-label': 'Filtrar', value: filtro.estado, onchange: e => {
          filtro.estado = e.target.value;
          pintarZona(Date.now() + datos.desfase);
        } }, Object.entries(FILTROS_DIRECTO).map(([v, t]) => h('option', { value: v }, `${t} (${cuenta(v)})`))),
      ),
    );
  }

  function pintarZona(ahora) {
    if (!cargado) return vaciar(zona, h('div', { class: 'tarjeta esqueleto' }));
    if (vista === 'plano') return vaciar(zona, planoClase(ctx, datos, ahora));
    if (!datos.intentos.length) {
      return vaciar(zona, h('div', { class: 'tarjeta vacio' }, ctx.ex.abierto ? h('p', {}, 'Esperando a que entren los alumnos…') : h('p', {}, 'El examen está cerrado. Ábrelo desde ', h('a', { href: rutaExamen(E, 'revisar') }, 'Revisar y abrir'), '.')));
    }
    const lista = datos.intentos.filter(coincide)
      .map(a => ({ a, e: estadoAlumno(a, ahora) }))
      .sort((x, y) => (vista === 'tarjetas' ? x.e.prioridad - y.e.prioridad : 0) || x.a.nombre.localeCompare(y.a.nombre, 'es'));
    if (!lista.length) return vaciar(zona, h('p', { class: 'vacio' }, 'Ningún alumno coincide con el filtro.'));
    const ids = lista.map(x => x.a.id);
    if (vista === 'tarjetas') return vaciar(zona, h('div', { class: 'tarjetas-alumnos' }, lista.map(({ a, e }) => tarjetaAlumno(ctx, a, e, ahora, ids))));
    vaciar(zona, h('div', { class: 'tabla-contenedor' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Alumno'), h('th', {}, 'Estado'), h('th', {}, 'Progreso'), h('th', { class: 'num' }, 'Tiempo'),
        h('th', { class: 'num' }, 'Salidas'), h('th', {}, 'Última incidencia'), h('th', { class: 'num' }, 'Nota'), h('th', {}, ''),
      )),
      h('tbody', {}, lista.map(({ a, e }) => filaAlumno(ctx, a, e, ahora, ids))),
    )));
  }

  function pintarTodo() {
    const ahora = Date.now() + datos.desfase;
    pintarResumen(ahora);
    pintarAtencion(ahora);
    pintarHerramientas();
    pintarZona(ahora);
  }

  vaciar(contenido, resumen, atencion, fin, herramientas, zona);
  ctx.repintarDirecto = () => pintarZona(Date.now() + datos.desfase);

  const parar = api.observarIntentos(E, d => {
    datos = d;
    cargado = true;
    const bloqueados = d.intentos.filter(a => a.estado === 'bloqueado').length;
    if (sonido && bloqueados > bloqueadosAntes) pitar();
    bloqueadosAntes = bloqueados;
    // Mientras se arrastra un alumno en el plano no se repinta, para no cortar el arrastre
    if (ctx.arrastrando) return;
    pintarTodo();
  }, e => (e.estado === 401 ? location.reload() : notificarError(e)));
  // Cada segundo solo se actualizan los relojes (repintar todo haría que se perdieran clics)
  const reloj = setInterval(() => {
    const ahora = Date.now() + datos.desfase;
    for (const el of contenido.querySelectorAll('[data-cuenta]')) {
      if (el.dataset.cuenta) el.textContent = relojTexto(Number(el.dataset.cuenta) - ahora);
    }
  }, 1000);
  ctx.limpiar.push(parar, () => clearInterval(reloj));
  pintarTodo();
}

function tarjetaAlumno(ctx, a, e, ahora, ids) {
  const total = a.orden?.length || 0;
  const hechas = Object.values(a.respuestas || {}).filter(N.hayRespuesta).length;
  const c = a.estado === 'entregado' ? N.corregir(ctx.ex, a) : null;
  const limite = a.inicio && a.estado !== 'entregado' ? N.limiteDe(a) : null;
  return h('article', { class: `tarjeta-alumno ${e.clase}`, tabindex: '0', role: 'button', 'aria-label': `${a.nombre}: ${e.texto}`, onclick: () => detalleAlumno(ctx, a.id, ids), onkeydown: ev => ev.key === 'Enter' && detalleAlumno(ctx, a.id, ids) },
    h('div', { class: 'fila entre', style: { flexWrap: 'nowrap' } },
      h('div', { class: 'celda-alumno', style: { minWidth: 0 } }, h('span', { class: 'avatar' }, iniciales(a.nombre)), h('b', { class: 'nombre-alumno' }, a.nombre)),
      limite ? h('span', { class: 'mono pequeno', 'data-cuenta': String(limite) }, relojTexto(limite - ahora)) : null,
    ),
    h('div', { class: 'progreso-mini' }, h('div', {}, h('i', { style: { width: `${total ? (hechas / total) * 100 : 0}%` } })), h('span', {}, `${hechas}/${total}`)),
    h('div', { class: 'fila entre pequeno' },
      h('span', { class: 'estado-texto' }, e.texto, posicionTexto(a) ? ` · ${posicionTexto(a)}` : '', c ? ` · ${N.numero(c.nota)}${c.pendiente ? '*' : ''}` : ''),
      a.salidas ? h('span', { class: 'chip sin-punto aviso', title: 'Salidas de la pantalla del examen' }, `${a.salidas} ${a.salidas === 1 ? 'salida' : 'salidas'}`) : null,
    ),
    a.estado === 'bloqueado' ? h('button', { class: 'boton primario mini', onclick: ev => {
      ev.stopPropagation();
      ocupado(ev.currentTarget, () => api.accion(ctx.E, a.id, 'desbloquear'));
    } }, 'Desbloquear') : null,
  );
}

function filaAlumno(ctx, a, e, ahora, ids) {
  const total = a.orden?.length || 0;
  const hechas = Object.values(a.respuestas || {}).filter(N.hayRespuesta).length;
  const limite = a.inicio && a.estado !== 'entregado' ? N.limiteDe(a) : null;
  const tiempo = limite ? relojTexto(limite - ahora) : a.inicio && a.entregadoEn ? N.duracionTexto(a.entregadoEn - a.inicio) : '—';
  const c = N.corregir(ctx.ex, a);
  const salidas = N.salidasDesde(a);
  const ultima = a.ultimaIncidencia;
  const chip = { bloqueado: 'peligro', entregado: 'exito', 'sin-senal': 'aviso', 'sin-empezar': '', 'en-curso': 'info' }[e.clase];
  return h('tr', { class: 'clicable', onclick: () => detalleAlumno(ctx, a.id, ids) },
    h('td', {}, h('div', { class: 'celda-alumno' }, h('span', { class: 'avatar' }, iniciales(a.nombre)), h('div', {}, h('b', {}, a.nombre), posicionTexto(a) ? h('div', { class: 'pequeno suave' }, posicionTexto(a)) : null))),
    h('td', {}, h('span', { class: `chip ${chip}` }, e.texto)),
    h('td', {}, h('div', { class: 'progreso-mini', title: `${hechas} de ${total} respondidas` }, h('div', {}, h('i', { style: { width: `${total ? (hechas / total) * 100 : 0}%` } })), h('span', {}, `${hechas}/${total}`))),
    h('td', { class: 'num mono', 'data-cuenta': limite ? String(limite) : '' }, tiempo),
    h('td', { class: 'num' }, salidas || a.salidas ? h('span', { class: `chip sin-punto ${ctx.ex.maxSalidas && salidas >= ctx.ex.maxSalidas - 1 ? 'peligro' : 'aviso'}` }, ctx.ex.maxSalidas ? `${salidas}/${ctx.ex.maxSalidas}` : String(a.salidas)) : h('span', { class: 'suave' }, '0')),
    h('td', { class: 'pequeno' }, ultima ? [h('div', { style: { color: 'var(--peligro)' } }, ultima.detalle), h('div', { class: 'suave' }, haceTexto(ahora - ultima.t))] : h('span', { class: 'suave' }, '—')),
    h('td', { class: 'num' }, a.inicio ? h('b', {}, `${N.numero(c.nota)}${c.pendiente ? '*' : ''}`) : ''),
    h('td', {}, a.estado === 'bloqueado'
      ? h('button', { class: 'boton primario mini', onclick: ev => {
        ev.stopPropagation();
        ocupado(ev.currentTarget, () => api.accion(ctx.E, a.id, 'desbloquear'));
      } }, 'Desbloquear')
      : h('span', { class: 'flecha-fila', 'aria-hidden': 'true' }, icono('derecha'))),
  );
}

// ---------- Plano de la clase ----------
// Mesas en filas y columnas; cada alumno se coloca arrastrándolo, o pulsándolo y luego pulsando una mesa

function planoClase(ctx, datos, ahora) {
  const b = ctx.borrador;
  const plano = b.plano || { filas: 4, columnas: 6, puestos: {} };
  const porClave = new Map(datos.intentos.map(a => [a.nombreClave, a]));
  const colocados = new Set(Object.values(plano.puestos));
  const sinSitio = datos.intentos.filter(a => !colocados.has(a.nombreClave)).sort((x, y) => (x.creado || 0) - (y.creado || 0));

  const guardarPlano = cambio => {
    b.plano = cambio;
    ctx.seleccionPlano = null;
    ctx.programar();
    ctx.repintarDirecto();
  };
  const sitioDe = clave => Object.keys(plano.puestos).find(s => plano.puestos[s] === clave);
  // Pone al alumno en la mesa; si había otro, se intercambian
  const colocar = (clave, sitio) => {
    const puestos = { ...plano.puestos };
    const anterior = sitioDe(clave);
    const ocupante = puestos[sitio];
    if (anterior) delete puestos[anterior];
    if (ocupante && anterior) puestos[anterior] = ocupante;
    puestos[sitio] = clave;
    guardarPlano({ ...plano, puestos });
  };
  const quitar = clave => {
    const puestos = { ...plano.puestos };
    delete puestos[sitioDe(clave)];
    guardarPlano({ ...plano, puestos });
  };
  const autocolocar = () => {
    const puestos = { ...plano.puestos };
    const libres = [];
    for (let f = 0; f < plano.filas; f++) for (let c = 0; c < plano.columnas; c++) if (!puestos[`${f}-${c}`]) libres.push(`${f}-${c}`);
    sinSitio.forEach((a, i) => libres[i] && (puestos[libres[i]] = a.nombreClave));
    if (sinSitio.length > libres.length) notificar(`Faltan ${sinSitio.length - libres.length} mesas: añade filas o columnas`, 'error');
    guardarPlano({ ...plano, puestos });
  };
  const tamano = (campo, d) => guardarPlano({ ...plano, [campo]: Math.min(12, Math.max(1, plano[campo] + d)) });

  const arrastre = clave => ({
    draggable: true,
    ondragstart: e => {
      ctx.arrastrando = true;
      e.dataTransfer.setData('text/plain', clave);
      e.dataTransfer.effectAllowed = 'move';
    },
    ondragend: () => {
      ctx.arrastrando = false;
    },
  });

  const contador = (texto, campo) => h('div', { class: 'contador-plano' },
    h('span', { class: 'pequeno suave' }, texto),
    h('button', { class: 'boton fantasma mini', 'aria-label': `Menos ${texto.toLowerCase()}`, onclick: () => tamano(campo, -1) }, '−'),
    h('b', {}, plano[campo]),
    h('button', { class: 'boton fantasma mini', 'aria-label': `Más ${texto.toLowerCase()}`, onclick: () => tamano(campo, 1) }, '+'),
  );

  const mesas = [];
  for (let f = 0; f < plano.filas; f++) {
    for (let c = 0; c < plano.columnas; c++) {
      const sitio = `${f}-${c}`;
      const clave = plano.puestos[sitio];
      const a = clave ? porClave.get(clave) : null;
      const soltar = {
        ondragover: e => (e.preventDefault(), e.currentTarget.classList.add('encima')),
        ondragleave: e => e.currentTarget.classList.remove('encima'),
        ondrop: e => {
          e.preventDefault();
          ctx.arrastrando = false;
          const origen = e.dataTransfer.getData('text/plain');
          if (origen) colocar(origen, sitio);
        },
      };
      if (!a) {
        mesas.push(h('div', {
          class: `mesa vacia ${ctx.seleccionPlano ? 'esperando' : ''}`, ...soltar,
          onclick: () => ctx.seleccionPlano && colocar(ctx.seleccionPlano, sitio),
          'aria-label': `Mesa ${f + 1}-${c + 1} libre`,
        }, h('span', { class: 'pequeno' }, ctx.seleccionPlano ? 'Colocar aquí' : '')));
        continue;
      }
      const e = estadoAlumno(a, ahora);
      const limite = a.inicio && a.estado !== 'entregado' ? N.limiteDe(a) : null;
      const nota = a.estado === 'entregado' ? N.corregir(ctx.ex, a) : null;
      mesas.push(h('div', {
        class: `mesa ${e.clase} ${ctx.seleccionPlano === a.nombreClave ? 'elegida' : ''}`, ...soltar, ...arrastre(a.nombreClave),
        tabindex: '0', role: 'button', 'aria-label': `${a.nombre}: ${e.texto}`,
        onclick: () => (ctx.seleccionPlano && ctx.seleccionPlano !== a.nombreClave ? colocar(ctx.seleccionPlano, sitio) : detalleAlumno(ctx, a.id)),
      },
      h('div', { class: 'fila entre', style: { flexWrap: 'nowrap', gap: '4px' } },
        h('b', { class: 'nombre-mesa', title: a.nombre }, nombreCorto(a.nombre)),
        h('button', { class: 'quitar-mesa', title: 'Quitar de esta mesa', 'aria-label': `Quitar a ${a.nombre} de la mesa`, onclick: ev => (ev.stopPropagation(), quitar(a.nombreClave)) }, '×'),
      ),
      h('span', { class: 'estado-mesa' }, e.texto),
      limite ? h('span', { class: 'tiempo-mesa mono', 'data-cuenta': String(limite) }, relojTexto(limite - ahora)) : null,
      posicionTexto(a) ? h('span', { class: 'pregunta-mesa' }, posicionTexto(a).replace('Pregunta ', 'P. ')) : null,
      nota ? h('span', { class: 'pregunta-mesa' }, `Nota ${N.numero(nota.nota)}${nota.pendiente ? '*' : ''}`) : null,
      a.salidas ? h('span', { class: 'salidas-mesa', title: 'Salidas de la pantalla' }, `${a.salidas} ${a.salidas === 1 ? 'salida' : 'salidas'}`) : null,
      ));
    }
  }

  return h('div', { class: 'plano' },
    h('div', { class: 'fila entre herramientas-plano' },
      h('div', { class: 'fila' }, contador('Filas', 'filas'), contador('Columnas', 'columnas')),
      h('div', { class: 'fila' },
        sinSitio.length ? h('button', { class: 'boton mini', onclick: autocolocar }, 'Colocar por orden de llegada') : null,
        Object.keys(plano.puestos).length ? h('button', { class: 'boton fantasma mini', onclick: async () => {
          if (await confirmar('¿Vaciar el plano?', 'Se quitarán todos los alumnos de sus mesas. No afecta a sus exámenes.', 'Vaciar')) guardarPlano({ ...plano, puestos: {} });
        } }, 'Vaciar plano') : null,
      ),
    ),
    h('div', { class: 'pizarra' }, 'Pizarra · mesa del profesor'),
    h('div', { class: 'mesas', style: { gridTemplateColumns: `repeat(${plano.columnas}, minmax(0, 1fr))` } }, mesas),
    h('div', { class: 'sin-sitio' },
      h('span', { class: 'pequeno suave' }, sinSitio.length
        ? `${plural(sinSitio.length, 'alumno', 'alumnos')} sin mesa: arrástralos a su sitio, o pulsa uno y después su mesa.`
        : datos.intentos.length ? 'Todos los alumnos tienen mesa.' : 'Aquí aparecerán los alumnos según vayan entrando.'),
      h('div', { class: 'fila' }, sinSitio.map(a => h('button', {
        type: 'button', class: `ficha-alumno ${ctx.seleccionPlano === a.nombreClave ? 'elegida' : ''} ${estadoAlumno(a, ahora).clase}`,
        ...arrastre(a.nombreClave),
        onclick: () => {
          ctx.seleccionPlano = ctx.seleccionPlano === a.nombreClave ? null : a.nombreClave;
          ctx.repintarDirecto();
        },
      }, nombreCorto(a.nombre)))),
    ),
  );
}

// ---------- Pestaña: resultados ----------

function pestanaResultados(ctx, contenido) {
  const { E } = ctx;
  let intentos = [];
  const zona = h('div', { class: 'pila' }, h('div', { class: 'tarjeta esqueleto', style: { height: '120px' } }));

  async function exportarTodos(boton) {
    if (!intentos.length) return notificar('Todavía no hay alumnos en este examen');
    const etiqueta = boton.lastChild;
    const texto = etiqueta.textContent;
    await ocupado(boton, async () => {
      const completos = await api.intentosCompletos(E);
      const zip = await zipTodos(ctx.ex, completos, (n, total) => (etiqueta.textContent = `Generando ${n} de ${total}…`), await opcionesExportar());
      descargar(`${N.nombreArchivo(ctx.ex.titulo)}-examenes.zip`, zip);
    });
    etiqueta.textContent = texto;
  }

  vaciar(contenido,
    h('div', { class: 'fila entre', style: { marginBottom: '16px' } },
      h('p', { class: 'suave', style: { margin: 0 } }, 'Pulsa un alumno para ver sus respuestas y corregir las de desarrollo.'),
      h('div', { class: 'fila' },
        h('button', { class: 'boton', onclick: () => descargar(`notas-${N.nombreArchivo(ctx.ex.titulo)}.csv`, N.generarCSV(ctx.ex, intentos), 'text/csv;charset=utf-8') }, icono('bajar'), 'Notas (CSV)'),
        h('button', { class: 'boton primario', onclick: e => exportarTodos(e.currentTarget) }, icono('bajar'), h('span', {}, 'Exportar todos (ZIP)')),
      ),
    ),
    zona,
  );

  function pintar() {
    const ex = ctx.ex;
    const empezados = intentos.filter(a => a.inicio).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
    if (!empezados.length) {
      return vaciar(zona, h('div', { class: 'tarjeta vacio' }, h('h2', {}, 'Todavía no hay resultados'), h('p', {}, 'Aparecerán aquí en cuanto los alumnos empiecen el examen.'), h('a', { class: 'boton', href: rutaExamen(E, 'directo') }, icono('directo'), 'Ir a En directo')));
    }
    const notas = new Map(empezados.map(a => [a.id, N.corregir(ex, a)]));
    const entregados = empezados.filter(a => a.estado === 'entregado');
    const media = entregados.length ? entregados.reduce((s, a) => s + notas.get(a.id).nota, 0) / entregados.length : null;
    const aprobados = entregados.filter(a => notas.get(a.id).nota >= 5).length;
    const pendientes = empezados.filter(a => notas.get(a.id).pendiente);
    const ids = empezados.map(a => a.id);

    // Estadística por pregunta
    const numerosExamen = N.etiquetas(ex.preguntas);
    const porPregunta = ex.preguntas.map((p, i) => {
      let vistas = 0, blanco = 0, bien = 0, puntos = 0;
      for (const a of empezados) {
        const d = notas.get(a.id).detalle[p.id];
        if (!d) continue;
        vistas++;
        if (d.estado === 'blanco') blanco++;
        // Las parciales cuentan por la parte acertada
        if (d.max > 0 && (d.estado === 'correcta' || d.estado === 'parcial' || d.estado === 'manual')) bien += Math.max(0, d.puntos) / d.max;
        puntos += d.puntos;
      }
      return { p, i, vistas, blanco, acierto: vistas ? bien / vistas : null, media: vistas ? puntos / vistas : null };
    });

    vaciar(zona,
      h('div', { class: 'metricas', style: { margin: 0 } },
        h('div', { class: 'metrica' }, h('span', {}, 'Entregados'), h('b', {}, `${entregados.length}/${empezados.length}`)),
        h('div', { class: 'metrica' }, h('span', {}, 'Nota media'), h('b', {}, media === null ? '—' : N.numero(media, 1))),
        h('div', { class: 'metrica' }, h('span', {}, 'Aprobados'), h('b', {}, entregados.length ? `${aprobados}/${entregados.length}` : '—')),
        h('div', { class: 'metrica' }, h('span', {}, 'Por corregir'), h('b', { style: { color: pendientes.length ? 'var(--aviso)' : '' } }, pendientes.length)),
      ),
      pendientes.length ? h('div', { class: 'aviso amarillo fila entre' },
        h('span', {}, `${plural(pendientes.length, 'alumno tiene', 'alumnos tienen')} preguntas por corregir a mano.`),
        h('button', { class: 'boton mini primario', onclick: () => detalleAlumno(ctx, pendientes[0].id, pendientes.map(a => a.id), { corregir: true }) }, 'Empezar a corregir', icono('derecha')),
      ) : null,
      h('div', { class: 'tabla-contenedor' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Alumno'), h('th', {}, 'Estado'), h('th', { class: 'num' }, 'Puntos'), h('th', { class: 'num' }, 'Nota'), h('th', {}, ''))),
        h('tbody', {}, empezados.map(a => {
          const c = notas.get(a.id);
          return h('tr', { class: 'clicable', onclick: () => detalleAlumno(ctx, a.id, ids) },
            h('td', {}, h('div', { class: 'celda-alumno' }, h('span', { class: 'avatar' }, iniciales(a.nombre)), h('b', {}, a.nombre))),
            h('td', {}, a.estado === 'entregado' ? (c.pendiente ? h('span', { class: 'chip aviso' }, 'Por corregir') : h('span', { class: 'chip exito' }, 'Corregido')) : h('span', { class: 'chip info' }, 'Haciéndolo')),
            h('td', { class: 'num' }, `${N.numero(c.total)} / ${N.numero(c.max)}`),
            h('td', { class: 'num' }, h('span', {
              class: `nota ${c.pendiente || a.estado !== 'entregado' ? 'provisional' : c.nota >= 5 ? 'aprobado' : 'suspenso'}`,
              title: c.pendiente ? 'Provisional: faltan preguntas por corregir' : null,
            }, N.numero(c.nota))),
            h('td', {}, h('span', { class: 'flecha-fila', 'aria-hidden': 'true' }, icono('derecha'))),
          );
        })),
      )),
      h('h2', { style: { margin: '12px 0 0' } }, 'Por pregunta'),
      h('div', { class: 'tabla-contenedor' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Pregunta'), h('th', {}, 'Acierto'), h('th', { class: 'num' }, 'En blanco'), h('th', { class: 'num' }, 'Media'))),
        h('tbody', {}, porPregunta.map(({ p, i, vistas, blanco, acierto, media: m }) =>
          h('tr', {},
            h('td', { class: 'suave' }, numerosExamen[i]),
            h('td', {}, h('div', { class: 'texto-recortado', title: p.enunciado }, p.enunciado), h('div', { class: 'pequeno suave' }, `${N.NOMBRE_TIPO[p.tipo]} · ${plural(p.puntos, 'punto', 'puntos')}`)),
            h('td', { style: { minWidth: '160px' } }, acierto === null ? h('span', { class: 'suave' }, '—') : h('div', { class: `progreso-mini ${acierto < 0.4 ? 'bajo' : ''}` }, h('div', {}, h('i', { style: { width: `${acierto * 100}%` } })), h('span', {}, `${Math.round(acierto * 100)} %`))),
            h('td', { class: 'num' }, vistas ? `${blanco}/${vistas}` : '—'),
            h('td', { class: 'num' }, m === null ? '—' : `${N.numero(m)} / ${N.numero(p.puntos)}`),
          ),
        )),
      )),
      porPregunta.some(x => x.acierto !== null && x.acierto < 0.4 && x.vistas >= 3)
        ? h('p', { class: 'pequeno suave', style: { margin: 0 } }, 'Las preguntas en rojo las ha acertado menos del 40 %: puede que estén mal planteadas o que la solución marcada no sea la buena.')
        : null,
    );
  }

  const parar = api.observarIntentos(E, d => {
    intentos = d.intentos;
    pintar();
  }, e => (e.estado === 401 ? location.reload() : notificarError(e)));
  ctx.limpiar.push(parar);
}

// Editor de una pregunta. Cambia el objeto p directamente.
function editorPregunta(p, i, total, { alCambiar, alRehacer, alMover, alBorrar, alDescartar, alDuplicar, alAnadirApartado, alCambiarContexto = () => {}, numero, primeroDelGrupo = true, sinConfirmarBorrado = false }) {
  const cuerpo = h('div', { class: 'pila' });
  const tipo = h('select', { value: p.tipo, 'aria-label': 'Tipo de pregunta', onchange: e => {
    const nuevo = e.target.value;
    const base = { ...p, tipo: nuevo, opciones: p.opciones?.length && p.tipo !== 'vf' ? p.opciones : ['', '', '', ''] };
    if (nuevo === 'test' && p.correctas?.length) base.correcta = p.correctas[0];
    if (nuevo === 'relacionar' && !p.pares?.length) base.pares = [{}, {}, {}];
    // Se quitan los datos del tipo anterior (correctas, pares...) para que no se guarden
    const limpio = N.limpiarPregunta(base);
    for (const clave of Object.keys(p)) if (!(clave in limpio) && clave !== 'avisos' && clave !== 'descartada') delete p[clave];
    Object.assign(p, limpio);
    alRehacer();
  } }, N.TIPOS.map(t => h('option', { value: t }, N.NOMBRE_TIPO[t])));

  const enunciado = h('textarea', { rows: 2, placeholder: 'Escribe el enunciado', value: p.enunciado, oninput: e => ((p.enunciado = e.target.value), alCambiar()) });
  // Que el cuadro crezca con el texto
  const ajustar = () => {
    enunciado.style.height = 'auto';
    enunciado.style.height = `${enunciado.scrollHeight + 2}px`;
  };
  enunciado.addEventListener('input', ajustar);
  requestAnimationFrame(ajustar);

  cuerpoPregunta(p, cuerpo, alCambiar);
  const zonaImagen = h('div');
  editorImagen(p, zonaImagen, alCambiar);

  const avisos = p.avisos?.length ? h('div', { class: 'aviso amarillo pequeno' }, p.avisos.join(' ')) : null;

  // Apartado de un ejercicio: el primero lleva el enunciado común, que se comparte con los demás
  let contexto = null;
  if (p.grupo && primeroDelGrupo) {
    const caja = h('textarea', { rows: 2, value: p.contexto || '', placeholder: 'Texto común a todos los apartados del ejercicio', oninput: e => alCambiarContexto(e.target.value) });
    contexto = h('label', { class: 'campo contexto-editor' }, h('span', {}, 'Enunciado común del ejercicio'), caja);
  } else if (p.grupo) {
    contexto = h('p', { class: 'pequeno suave', style: { margin: 0 } }, 'Apartado del ejercicio de arriba: comparte su enunciado común.');
  }

  return h('article', { class: `tarjeta pregunta-editor ${p.tipo} ${p.grupo ? 'es-apartado' : ''} ${p.grupo && !primeroDelGrupo ? 'apartado-siguiente' : ''}` },
    h('div', { class: 'pregunta-cabecera' },
      h('span', { class: 'numero' }, numero ?? `${i + 1}`),
      tipo,
      h('label', { class: 'fila pequeno suave', style: { gap: '6px' } }, 'Puntos', h('input', { class: 'puntos', type: 'number', min: 0, max: 100, step: 0.25, value: p.puntos, oninput: e => ((p.puntos = N.acotar(e.target.value, 0, 0, 100)), alCambiar()) })),
      h('span', { style: { flex: 1 } }),
      alDescartar
        ? h('label', { class: 'casilla pequeno' }, h('input', { type: 'checkbox', checked: !p.descartada, onchange: e => alDescartar(!e.target.checked) }), 'Importar')
        : [
          h('button', { class: 'boton fantasma mini', disabled: i === 0, title: 'Subir', 'aria-label': 'Subir', onclick: () => alMover(-1) }, icono('arriba')),
          h('button', { class: 'boton fantasma mini', disabled: i === total - 1, title: 'Bajar', 'aria-label': 'Bajar', onclick: () => alMover(1) }, icono('abajo')),
          alDuplicar ? h('button', { class: 'boton fantasma mini', title: 'Duplicar pregunta', 'aria-label': 'Duplicar pregunta', onclick: alDuplicar }, icono('copia')) : null,
          alAnadirApartado ? h('button', { class: 'boton fantasma mini', title: 'Añadir otro apartado a este ejercicio', onclick: alAnadirApartado }, icono('mas'), 'Apartado') : null,
          h('button', { class: 'boton fantasma mini', title: 'Borrar pregunta', 'aria-label': 'Borrar pregunta', onclick: async () => {
            if (sinConfirmarBorrado || !p.enunciado.trim() || (await confirmar('¿Borrar la pregunta?', p.enunciado.slice(0, 160), 'Borrar', 'peligro'))) alBorrar();
          } }, icono('papelera')),
        ],
    ),
    avisos,
    contexto,
    enunciado,
    zonaImagen,
    cuerpo,
  );
}

// Lista editable de opciones. marcar: 'una' (radio, test) o 'varias' (casillas, varias correctas)
function editorOpciones(p, cuerpo, alCambiar, marcar) {
  const esCorrecta = j => (marcar === 'una' ? p.correcta === j : p.correctas.includes(j));
  const pintar = () => {
    vaciar(cuerpo,
      p.opciones.map((o, j) =>
        h('div', { class: `opcion-editor ${esCorrecta(j) ? 'correcta' : ''}` },
          h('input', {
            type: marcar === 'una' ? 'radio' : 'checkbox', name: `correcta-${p.id}`, checked: esCorrecta(j),
            title: 'Respuesta correcta', 'aria-label': `Marcar la opción ${j + 1} como correcta`,
            onchange: e => {
              if (marcar === 'una') p.correcta = j;
              else p.correctas = e.target.checked ? [...new Set([...p.correctas, j])].sort((x, y) => x - y) : p.correctas.filter(x => x !== j);
              pintar();
              alCambiar();
            },
          }),
          h('input', { type: 'text', value: o, placeholder: `Opción ${String.fromCharCode(97 + j)}`, oninput: e => ((p.opciones[j] = e.target.value), alCambiar()) }),
          h('button', { class: 'boton fantasma mini', type: 'button', title: 'Quitar opción', 'aria-label': 'Quitar opción', onclick: () => {
            p.opciones.splice(j, 1);
            if (marcar === 'una') p.correcta = p.correcta === j ? null : p.correcta > j ? p.correcta - 1 : p.correcta;
            else p.correctas = p.correctas.filter(x => x !== j).map(x => (x > j ? x - 1 : x));
            pintar();
            alCambiar();
          } }, icono('papelera')),
        ),
      ),
      h('div', { class: 'fila entre' },
        p.opciones.length < 10 ? h('button', { class: 'boton fantasma mini', type: 'button', onclick: () => {
          p.opciones.push('');
          pintar();
          alCambiar();
          $$('.opcion-editor input[type=text]', cuerpo).at(-1)?.focus();
        } }, icono('mas'), 'Añadir opción') : h('span'),
        h('label', { class: 'casilla pequeno suave' }, h('input', { type: 'checkbox', checked: p.fijarOpciones, onchange: e => ((p.fijarOpciones = e.target.checked), alCambiar()) }), 'No barajar estas opciones'),
      ),
      marcar === 'una' && p.correcta === null ? h('p', { class: 'pequeno', style: { color: 'var(--aviso)', margin: 0 } }, 'Marca el círculo de la respuesta correcta.') : null,
      marcar === 'varias' ? h('p', { class: 'pequeno suave', style: { margin: 0 } }, 'Marca todas las correctas. Cada correcta que elija el alumno suma y cada incorrecta resta (sin bajar de 0).') : null,
    );
  };
  pintar();
}

// El cuerpo del editor según el tipo de pregunta
function cuerpoPregunta(p, cuerpo, alCambiar) {
  if (p.tipo === 'test') return editorOpciones(p, cuerpo, alCambiar, 'una');
  if (p.tipo === 'multiple') return editorOpciones(p, cuerpo, alCambiar, 'varias');

  if (p.tipo === 'vf') {
    const pintar = () => vaciar(cuerpo,
      h('div', { class: 'opciones-vf-editor' }, N.OPCIONES_VF.map((texto, j) =>
        h('label', { class: `opcion-editor-vf ${p.correcta === j ? 'correcta' : ''}` },
          h('input', { type: 'radio', name: `correcta-${p.id}`, checked: p.correcta === j, onchange: () => {
            p.correcta = j;
            pintar();
            alCambiar();
          } }),
          texto,
        ))),
      p.correcta === null ? h('p', { class: 'pequeno', style: { color: 'var(--aviso)', margin: 0 } }, 'Marca si la afirmación es verdadera o falsa.') : null,
    );
    return pintar();
  }

  if (p.tipo === 'corta') {
    return cuerpo.append(campo('Respuestas aceptadas (una por línea)',
      h('textarea', { rows: 2, value: p.respuestas.join('\n'), oninput: e => ((p.respuestas = e.target.value.split('\n').map(s => s.trim()).filter(Boolean)), alCambiar()) }),
      'No se distinguen mayúsculas, tildes ni espacios. Si la dejas vacía, se corrige a mano.'));
  }

  if (p.tipo === 'numerica') {
    const rango = h('p', { class: 'pequeno suave', style: { margin: 0 } });
    const pintarRango = () => {
      const r = N.rangoNumerica(p);
      rango.textContent = r ? `Se dará por buena cualquier respuesta entre ${N.numero(r[0], 6)} y ${N.numero(r[1], 6)}${p.unidad ? ` ${p.unidad}` : ''}.` : 'Escribe la respuesta correcta.';
    };
    const cambio = () => (pintarRango(), alCambiar());
    const valor = h('input', { type: 'text', inputmode: 'decimal', value: p.valor === null ? '' : String(p.valor).replace('.', ','), placeholder: '230', oninput: e => {
      const n = N.leerNumero(e.target.value);
      p.valor = e.target.value.trim() && Number.isFinite(n) ? n : null;
      cambio();
    } });
    const tolerancia = h('input', { type: 'number', min: 0, step: 'any', value: p.tolerancia, oninput: e => ((p.tolerancia = N.acotar(e.target.value, 0, 0, 1e9)), cambio()) });
    const modo = h('select', { value: p.modoTolerancia, onchange: e => ((p.modoTolerancia = e.target.value), cambio()) },
      h('option', { value: '%' }, '% del valor'), h('option', { value: 'abs' }, 'unidades'));
    const unidad = h('input', { type: 'text', maxlength: 20, value: p.unidad, placeholder: 'V, Ω, GB…', oninput: e => ((p.unidad = e.target.value.trim()), cambio()) });
    cuerpo.append(
      h('div', { class: 'rejilla', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' } },
        campo('Respuesta correcta', valor),
        campo('Margen (±)', h('div', { class: 'fila', style: { flexWrap: 'nowrap' } }, tolerancia, modo)),
        campo('Unidad (opcional)', unidad),
      ),
      rango,
    );
    return pintarRango();
  }

  if (p.tipo === 'relacionar') {
    const pintar = () => vaciar(cuerpo,
      h('div', { class: 'cabecera-pares pequeno suave' }, h('span', {}, 'Columna izquierda'), h('span', {}, 'Su pareja (derecha)'), h('span')),
      p.pares.map((par, j) =>
        h('div', { class: 'par-editor' },
          h('input', { type: 'text', value: par.izq, placeholder: `Elemento ${j + 1}`, oninput: e => ((par.izq = e.target.value), alCambiar()) }),
          h('input', { type: 'text', value: par.der, placeholder: 'Su pareja', oninput: e => ((par.der = e.target.value), alCambiar()) }),
          h('button', { class: 'boton fantasma mini', type: 'button', title: 'Quitar pareja', 'aria-label': 'Quitar pareja', onclick: () => {
            p.pares.splice(j, 1);
            p.ordenDerecha = N.limpiarPregunta({ ...p, ordenDerecha: null }).ordenDerecha;
            pintar();
            alCambiar();
          } }, icono('papelera')),
        ),
      ),
      h('div', { class: 'fila entre' },
        p.pares.length < 20 ? h('button', { class: 'boton fantasma mini', type: 'button', onclick: () => {
          p.pares.push({ izq: '', der: '' });
          p.ordenDerecha = N.limpiarPregunta({ ...p, ordenDerecha: null }).ordenDerecha;
          pintar();
          alCambiar();
          $$('.par-editor input', cuerpo).at(-2)?.focus();
        } }, icono('mas'), 'Añadir pareja') : h('span'),
        h('span', { class: 'pequeno suave' }, 'El alumno verá la columna derecha desordenada. Cada pareja acertada suma su parte.'),
      ),
    );
    return pintar();
  }

  // Desarrollo: criterios de corrección (rúbrica), opcionales
  const pintar = () => {
    const suma = p.criterios.reduce((s, c) => s + Number(c.puntos || 0), 0);
    vaciar(cuerpo,
      h('div', { class: 'fila entre' },
        h('b', { class: 'pequeno' }, 'Criterios de corrección'),
        p.criterios.length ? h('span', { class: `pequeno ${Math.abs(suma - p.puntos) > 0.001 ? 'texto-aviso' : 'suave'}` }, `Suman ${N.numero(suma)} de ${N.numero(p.puntos)} puntos`) : null,
      ),
      p.criterios.length ? null : h('p', { class: 'pequeno suave', style: { margin: 0 } }, 'Opcional. Si añades criterios, al corregir solo tendrás que marcar los que cumple el alumno y la nota se calcula sola.'),
      p.criterios.map((c, j) =>
        h('div', { class: 'criterio-editor' },
          h('input', { type: 'text', value: c.texto, placeholder: 'Menciona las precauciones de seguridad', oninput: e => ((c.texto = e.target.value), alCambiar()) }),
          h('input', { type: 'number', min: 0, step: 0.25, value: c.puntos, 'aria-label': 'Puntos del criterio', oninput: e => {
            c.puntos = N.acotar(e.target.value, 0, 0, 100);
            alCambiar();
          }, onchange: pintar }),
          h('button', { class: 'boton fantasma mini', type: 'button', title: 'Quitar criterio', 'aria-label': 'Quitar criterio', onclick: () => {
            p.criterios.splice(j, 1);
            pintar();
            alCambiar();
          } }, icono('papelera')),
        ),
      ),
      h('div', {}, h('button', { class: 'boton fantasma mini', type: 'button', onclick: () => {
        p.criterios.push({ texto: '', puntos: p.criterios.length ? 0.5 : p.puntos });
        pintar();
        alCambiar();
        $$('.criterio-editor input[type=text]', cuerpo).at(-1)?.focus();
      } }, icono('mas'), 'Añadir criterio')),
    );
  };
  pintar();
}

// Imagen del enunciado: se reduce en el navegador antes de subirla
function editorImagen(p, zona, alCambiar) {
  const pintar = () => {
    const entrada = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
      const archivo = e.target.files[0];
      if (!archivo) return;
      vaciar(zona, h('p', { class: 'pequeno suave', style: { margin: 0 } }, 'Subiendo imagen…'));
      try {
        p.imagen = await api.subirImagen(await comprimirImagen(archivo));
        alCambiar();
      } catch (err) {
        notificarError(err);
      }
      pintar();
    } });
    if (!p.imagen) {
      return vaciar(zona, entrada, h('button', { class: 'boton fantasma mini', type: 'button', onclick: () => entrada.click() }, icono('imagen'), 'Añadir imagen'));
    }
    vaciar(zona, entrada, h('div', { class: 'imagen-editor' },
      h('img', { src: api.urlImagen(p.imagen), alt: 'Imagen de la pregunta' }),
      h('div', { class: 'fila' },
        h('button', { class: 'boton mini', type: 'button', onclick: () => entrada.click() }, 'Cambiar'),
        h('button', { class: 'boton fantasma mini peligro', type: 'button', onclick: () => {
          delete p.imagen;
          alCambiar();
          pintar();
        } }, 'Quitar'),
      ),
    ));
  };
  pintar();
}

// Datos de cada pregunta para pintarla en una lista: su número ("3b") y si abre su ejercicio
function infoLista(preguntas) {
  const numeros = N.etiquetas(preguntas);
  return preguntas.map((p, i) => ({ numero: numeros[i], primeroDelGrupo: !p.grupo || preguntas[i - 1]?.grupo !== p.grupo }));
}

const cambiarContexto = (preguntas, grupo, texto) => preguntas.forEach(q => q.grupo === grupo && (q.contexto = texto));

// Tras borrar o mover, las letras de los apartados vuelven a ser a, b, c... Un apartado solo deja de serlo.
function ordenarApartados(preguntas) {
  for (const grupo of N.unidades(preguntas)) {
    if (!grupo[0].grupo) continue;
    if (grupo.length === 1) {
      const [p] = grupo;
      if (p.contexto?.trim()) p.enunciado = `${p.contexto.trim()}\n${p.enunciado}`;
      delete p.grupo;
      delete p.apartado;
      delete p.contexto;
      continue;
    }
    grupo.forEach((p, j) => (p.apartado = String.fromCharCode(97 + j)));
  }
}

// ---------- Importar ----------

// inicio: 'ia' para abrir directamente la opción de importar con una IA
function dialogoImportar(inicio) {
  return new Promise(resolver => {
    const d = h('dialog', { class: 'ancho' });
    const cuerpo = h('div', { class: 'dialogo-cuerpo' });
    const pie = h('div', { class: 'dialogo-pie' });
    d.append(cuerpo, pie);
    const cerrar = valor => {
      d.close();
      d.remove();
      resolver(valor);
    };
    d.addEventListener('cancel', e => (e.preventDefault(), cerrar(null)));
    document.body.append(d);
    d.showModal();

    const paso1 = (error = '') => {
      const input = h('input', { type: 'file', accept: '.docx,.pdf,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const zona = h('label', { class: 'zona-archivo' },
        input,
        icono('archivo', 'icono-grande'),
        h('b', {}, 'Arrastra aquí el examen o pulsa para elegirlo'),
        h('span', { class: 'pequeno' }, 'Word (.docx) o PDF con texto'),
      );
      const texto = h('textarea', { rows: 5, placeholder: '1. ¿Cuántos bits tiene un byte?\na) 4\nb) 8 *\nc) 16' });
      const procesar = async fuente => {
        vaciar(cuerpo, h('div', { class: 'centrado', style: { minHeight: '200px' } }, h('p', { class: 'suave' }, 'Leyendo el documento y separando las preguntas…')));
        vaciar(pie);
        try {
          // Si lo pegado es el código que devuelve una IA, se lee tal cual
          if (typeof fuente === 'string' && pareceFormatoIA(fuente)) return paso2(leerRespuestaIA(fuente), '');
          const lineas = typeof fuente === 'string' ? leerTexto(fuente) : await leerArchivo(fuente);
          const r = analizar(lineas);
          if (!r.preguntas.length) throw new Error('No se ha encontrado ninguna pregunta. Comprueba que estén numeradas (1., 2., …) o con opciones a), b), …');
          paso2(r, typeof fuente === 'string' ? '' : fuente.name);
        } catch (e) {
          paso1(e.message);
        }
      };
      input.onchange = () => input.files[0] && procesar(input.files[0]);
      zona.addEventListener('dragover', e => (e.preventDefault(), zona.classList.add('encima')));
      zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
      zona.addEventListener('drop', e => {
        e.preventDefault();
        zona.classList.remove('encima');
        if (e.dataTransfer.files[0]) procesar(e.dataTransfer.files[0]);
      });
      vaciar(cuerpo,
        h('h2', {}, 'Importar preguntas'),
        error ? h('div', { class: 'aviso peligro', style: { marginBottom: '14px' } }, error) : null,
        zona,
        h('button', { class: 'opcion-ia', type: 'button', onclick: () => pasoIA() },
          h('span', { class: 'icono-ia' }, icono('chispa')),
          h('span', {},
            h('b', {}, 'Con ayuda de una IA'),
            h('span', { class: 'pequeno suave' }, 'Para exámenes con un formato raro: TestGO te da las instrucciones para ChatGPT, Gemini o Claude, y tú pegas aquí lo que te devuelva.'),
          ),
          icono('derecha'),
        ),
        h('details', { style: { marginTop: '16px' } },
          h('summary', { class: 'suave', style: { cursor: 'pointer' } }, 'O pega el texto del examen'),
          h('div', { class: 'pila', style: { marginTop: '10px' } }, texto, h('button', { class: 'boton', style: { justifySelf: 'start' }, onclick: () => texto.value.trim() && procesar(texto.value) }, 'Separar preguntas')),
        ),
        h('div', { class: 'aviso pequeno', style: { marginTop: '16px' } },
          h('b', {}, 'Cómo lo entiende TestGO'),
          h('ul', {},
            h('li', {}, 'Preguntas numeradas: "1.", "2)", "Pregunta 3:" o listas numeradas de Word.'),
            h('li', {}, 'Opciones con letra: "a)", "B.", "(c)" o casillas "[ ]".'),
            h('li', {}, 'Respuesta correcta: en negrita o subrayada, con "*" o "[x]", o una línea "Solución: b".'),
            h('li', {}, 'Respuesta corta: una línea "Respuesta: ROM" debajo de la pregunta.'),
            h('li', {}, 'Puntos: "(0,5 puntos)" en el enunciado. Si no, vale 1.'),
          ),
        ),
      );
      vaciar(pie, h('button', { class: 'boton', onclick: () => cerrar(null) }, 'Cancelar'));
    };

    // Importar con una IA: copiar el prompt, dárselo a la IA con el examen y pegar su respuesta
    const pasoIA = (error = '', pegado = '') => {
      let resolver = true;
      const prompt = h('textarea', { class: 'prompt-ia', rows: 9, readonly: true, value: promptIA({ resolver }), 'aria-label': 'Instrucciones para la IA', onfocus: e => e.target.select() });
      const avisoResolver = h('div', { class: 'aviso amarillo pequeno' }, 'La IA puede equivocarse al resolver: revisa las respuestas correctas en el siguiente paso.');
      const casilla = h('label', { class: 'casilla pequeno' },
        h('input', { type: 'checkbox', checked: true, onchange: e => {
          resolver = e.target.checked;
          prompt.value = promptIA({ resolver });
          avisoResolver.hidden = !resolver;
        } }),
        'Que la IA resuelva las respuestas correctas si el examen no las trae');
      const respuesta = h('textarea', { rows: 8, value: pegado, placeholder: '```json\n{\n  "testgo": 1,\n  "titulo": "…",\n  "preguntas": [ … ]\n}\n```', 'aria-label': 'Respuesta de la IA', spellcheck: false });
      const botonCopiar = h('button', { class: 'boton primario', type: 'button', onclick: async () => {
        await copiar(prompt.value, 'Instrucciones copiadas: pégalas en la IA');
        vaciar(botonCopiar, icono('check'), 'Copiadas');
        setTimeout(() => vaciar(botonCopiar, icono('copia'), 'Copiar instrucciones'), 2500);
      } }, icono('copia'), 'Copiar instrucciones');
      const paso = (n, titulo, ...hijos) => h('section', { class: 'paso-ia' }, h('span', { class: 'numero-paso' }, n), h('div', { class: 'pila', style: { gap: '10px' } }, h('h3', { style: { margin: 0 } }, titulo), hijos));

      vaciar(cuerpo,
        h('h2', {}, 'Importar con ayuda de una IA'),
        error ? h('div', { class: 'aviso peligro', style: { marginBottom: '14px' } }, error) : null,
        h('div', { class: 'pila' },
          paso(1, 'Copia las instrucciones', casilla, prompt, h('div', {}, botonCopiar)),
          paso(2, 'Dáselas a la IA con tu examen',
            h('p', { class: 'suave', style: { margin: 0 } }, 'Abre ChatGPT, Gemini, Claude o Copilot, pega las instrucciones y adjunta el examen en PDF o Word (o pega su texto debajo de las instrucciones).'),
            avisoResolver,
          ),
          paso(3, 'Pega aquí lo que te responda', respuesta, h('small', { class: 'suave' }, 'Pega la respuesta entera: TestGO encuentra el código aunque venga con texto alrededor.')),
        ),
      );
      vaciar(pie,
        h('button', { class: 'boton', style: { marginRight: 'auto' }, onclick: () => paso1() }, icono('izquierda'), 'Volver'),
        h('button', { class: 'boton', onclick: () => cerrar(null) }, 'Cancelar'),
        h('button', { class: 'boton primario', onclick: () => {
          if (!respuesta.value.trim()) return notificar('Pega primero la respuesta de la IA', 'error');
          try {
            const pegadoAhora = respuesta.value;
            paso2(leerRespuestaIA(pegadoAhora), '', () => pasoIA('', pegadoAhora));
          } catch (e) {
            pasoIA(e.message, respuesta.value);
          }
        } }, 'Revisar preguntas', icono('derecha')),
      );
    };

    const paso2 = ({ titulo, preguntas }, archivo, volver = () => paso1()) => {
      const tituloInput = h('input', { type: 'text', value: titulo || archivo.replace(/\.[^.]+$/, '') });
      const lista = h('div');
      const botonImportar = h('button', { class: 'boton primario' });
      const contar = () => {
        const n = preguntas.filter(p => !p.descartada).length;
        botonImportar.textContent = `Importar ${n} ${n === 1 ? 'pregunta' : 'preguntas'}`;
        botonImportar.disabled = !n;
      };
      const pintar = () => {
        const info = infoLista(preguntas);
        vaciar(lista, preguntas.map((p, i) => {
          const el = editorPregunta(p, i, preguntas.length, {
            ...info[i],
            alCambiarContexto: texto => cambiarContexto(preguntas, p.grupo, texto),
            alCambiar: () => {},
            alRehacer: pintar,
            alDescartar: v => {
              p.descartada = v;
              el.classList.toggle('descartada', v);
              contar();
            },
          });
          el.classList.add('revision-pregunta');
          el.classList.toggle('descartada', !!p.descartada);
          return el;
        }));
        contar();
      };
      const porTipo = N.TIPOS.map(t => [t, preguntas.filter(p => p.tipo === t).length]).filter(([, n]) => n);
      const conAvisos = preguntas.filter(p => p.avisos?.length).length;
      vaciar(cuerpo,
        h('h2', {}, 'Revisa las preguntas'),
        h('p', {}, `Se han encontrado ${preguntas.length} preguntas: ${porTipo.map(([t, n]) => `${n} de ${N.NOMBRE_TIPO[t].toLowerCase()}`).join(', ')}.`),
        conAvisos ? h('div', { class: 'aviso amarillo pequeno', style: { marginBottom: '12px' } }, `${conAvisos} ${conAvisos === 1 ? 'necesita' : 'necesitan'} que la revises: lo verás marcado en amarillo.`) : null,
        h('div', { style: { marginBottom: '16px' } }, campo('Título del examen (si creas uno nuevo)', tituloInput)),
        lista,
      );
      botonImportar.onclick = () => {
        const elegidas = preguntas.filter(p => !p.descartada).map(({ avisos, descartada, ...p }) => p);
        ordenarApartados(elegidas); // si se descartan apartados, los demás se vuelven a numerar
        cerrar({ titulo: tituloInput.value.trim(), preguntas: elegidas.map(p => N.limpiarPregunta(p)) });
      };
      vaciar(pie, h('button', { class: 'boton', style: { marginRight: 'auto' }, onclick: volver }, icono('izquierda'), 'Volver'), h('button', { class: 'boton', onclick: () => cerrar(null) }, 'Cancelar'), botonImportar);
      pintar();
    };

    if (inicio === 'ia') pasoIA();
    else paso1();
  });
}

// ---------- Ficha de un alumno (panel lateral) ----------

// Lo que respondió el alumno, según el tipo de pregunta
function respuestaRevision(p, o, r) {
  const enBlanco = () => h('div', { class: 'respuesta-texto vacia' }, 'En blanco');
  if (N.CON_OPCIONES.has(p.tipo)) {
    const perm = o.perm || p.opciones.map((_, k) => k);
    const elegidas = new Set(Array.isArray(r) ? r : r === undefined || r === null ? [] : [r]);
    const buenas = new Set(p.tipo === 'multiple' ? p.correctas : [p.correcta]);
    return h('div', { class: 'pila', style: { gap: '4px' } }, perm.map((idx, k) =>
      h('div', { class: `opcion-revision ${elegidas.has(idx) ? 'elegida' : ''} ${buenas.has(idx) ? 'buena' : ''}` },
        h('span', { class: 'letra-mini' }, p.tipo === 'vf' ? p.opciones[idx][0] : String.fromCharCode(65 + k)), p.opciones[idx],
        buenas.has(idx) ? h('span', { class: 'etiqueta-opcion exito' }, 'Correcta') : null,
        elegidas.has(idx) ? h('span', { class: 'etiqueta-opcion' }, 'Su respuesta') : null),
    ), elegidas.size ? null : enBlanco());
  }
  if (p.tipo === 'relacionar') {
    if (!N.hayRespuesta(r)) return enBlanco();
    return h('div', { class: 'pila', style: { gap: '4px' } }, p.pares.map((par, i) => {
      const elegida = r[i] === null || r[i] === undefined ? null : p.ordenDerecha[r[i]];
      const bien = elegida === i;
      return h('div', { class: `opcion-revision ${bien ? 'buena' : ''}` },
        h('span', { class: 'letra-mini' }, i + 1), `${par.izq} → `, h('b', {}, elegida === null ? '—' : p.pares[elegida]?.der ?? '?'),
        h('span', { class: `etiqueta-opcion ${bien ? 'exito' : ''}` }, bien ? 'Bien' : `Era: ${par.der}`));
    }));
  }
  if (!N.hayRespuesta(r)) return enBlanco();
  return h('div', { class: 'respuesta-texto' }, N.textoRespuesta(p, r));
}

// Rúbrica: al marcar los criterios que cumple el alumno, la nota de la pregunta se calcula sola
function rubricaRevision(p, a, cambios, notaEntrada) {
  const marcados = new Set(cambios.rubricas[p.id] ?? a.rubricas?.[p.id] ?? []);
  return h('div', { class: 'rubrica' },
    h('span', { class: 'meta-pregunta' }, 'Criterios'),
    p.criterios.map((c, j) =>
      h('label', { class: 'casilla criterio' },
        h('input', { type: 'checkbox', checked: marcados.has(j), onchange: e => {
          if (e.target.checked) marcados.add(j);
          else marcados.delete(j);
          cambios.rubricas[p.id] = [...marcados].sort((x, y) => x - y);
          const suma = p.criterios.reduce((s, x, k) => s + (marcados.has(k) ? x.puntos : 0), 0);
          notaEntrada.value = String(Math.round(suma * 100) / 100);
          cambios.notasManual[p.id] = notaEntrada.value;
        } }),
        h('span', {}, c.texto || 'Criterio sin texto'),
        h('span', { class: 'puntos-criterio' }, N.numero(c.puntos)),
      ),
    ),
  );
}

// ids: los alumnos de la lista desde la que se abre, para pasar al anterior o al siguiente
// corregir: abrir cada alumno directamente en su primera pregunta por corregir
function detalleAlumno(ctx, inicial, ids = [inicial], { corregir = false } = {}) {
  const { E } = ctx;
  $$('.dialogo-cajon').forEach(d => d.remove());
  let A = inicial;
  let a = null;
  // Lo que el profesor ha cambiado y aún no ha guardado
  const sinCambios = () => ({ notasManual: {}, comentarios: {}, rubricas: {} });
  let cambios = sinCambios();
  const hayCambios = () => Object.values(cambios).some(o => Object.keys(o).length > 0);

  const cabeza = h('div', { class: 'cajon-cabeza' });
  const cuerpo = h('div', { class: 'cajon-cuerpo' }, h('p', { class: 'suave' }, 'Cargando…'));
  const pie = h('div', { class: 'dialogo-pie' });
  const d = h('dialog', { class: 'dialogo-cajon', 'aria-label': 'Ficha del alumno' }, cabeza, cuerpo, pie);
  const cerrar = async () => {
    if (hayCambios() && !(await confirmar('¿Salir sin guardar?', 'Has cambiado la corrección y todavía no la has guardado.', 'Salir sin guardar', 'peligro'))) return;
    d.close();
    d.remove();
  };
  d.addEventListener('cancel', e => (e.preventDefault(), cerrar()));
  d.addEventListener('click', e => e.target === d && cerrar()); // clic fuera del panel
  document.body.append(d);
  d.showModal();

  const guardarNotas = async () => {
    if (!hayCambios()) return;
    const notasManual = Object.fromEntries(Object.entries(cambios.notasManual).map(([k, v]) => [k, v === '' || v === null ? null : Number(v)]));
    a = await api.guardarCorreccion(E, A, { ...cambios, notasManual });
    cambios = sinCambios();
    notificar('Corrección guardada');
  };

  const cargar = async nuevo => {
    try {
      if (nuevo !== undefined) {
        await guardarNotas();
        A = nuevo;
      }
      vaciar(cuerpo, h('div', { class: 'tarjeta esqueleto', style: { height: '200px' } }));
      a = await api.intento(E, A);
      pintar();
      cuerpo.scrollTop = 0;
      const pendiente = corregir && $('.por-corregir', cuerpo);
      if (pendiente) {
        pendiente.scrollIntoView({ block: 'start' });
        $('.nota-manual', pendiente)?.focus({ preventScroll: true });
      }
    } catch (e) {
      vaciar(cuerpo, h('div', { class: 'aviso peligro' }, e.message));
    }
  };

  const accion = (nombre, datos) => async ev => {
    if (nombre === 'entregar' && !(await confirmar('¿Recoger el examen?', `Se entregará el examen de ${a.nombre} con lo que lleve respondido.`, 'Recoger'))) return;
    await ocupado(ev.currentTarget, async () => {
      a = await api.accion(E, A, nombre, datos);
      pintar();
    });
  };

  // Atajos dentro del panel: flechas para cambiar de alumno (si no se está escribiendo)
  d.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    const i = ids.indexOf(A);
    if (e.key === 'ArrowRight' && i < ids.length - 1) cargar(ids[i + 1]);
    if (e.key === 'ArrowLeft' && i > 0) cargar(ids[i - 1]);
  });

  function pintar() {
    const ex = ctx.ex;
    const c = N.corregir(ex, a);
    const porId = new Map(ex.preguntas.map(p => [p.id, p]));
    // Numeración en el orden que vio el alumno ("3a", "3b"...); las que ya no existen quedan con "?"
    const vistas = (a.orden || []).map(o => porId.get(o.id) || { id: o.id });
    const numerosOrden = N.etiquetas(vistas);
    const ahora = Date.now();
    const i = ids.indexOf(A);
    const chip = { en_curso: 'info', bloqueado: 'peligro', entregado: 'exito' }[a.estado];

    vaciar(cabeza,
      h('div', { class: 'celda-alumno', style: { minWidth: 0 } },
        h('span', { class: 'avatar grande' }, iniciales(a.nombre)),
        h('div', { style: { minWidth: 0 } }, h('h2', { style: { margin: 0 } }, a.nombre), h('span', { class: `chip ${chip}` }, N.ESTADO_INTENTO[a.estado])),
      ),
      h('div', { class: 'fila', style: { flexWrap: 'nowrap' } },
        ids.length > 1 ? [
          h('button', { class: 'boton fantasma mini', disabled: i <= 0, title: 'Alumno anterior (←)', 'aria-label': 'Alumno anterior', onclick: () => cargar(ids[i - 1]) }, icono('izquierda')),
          h('span', { class: 'pequeno suave', style: { whiteSpace: 'nowrap' } }, `${i + 1} de ${ids.length}`),
          h('button', { class: 'boton fantasma mini', disabled: i >= ids.length - 1, title: 'Alumno siguiente (→)', 'aria-label': 'Alumno siguiente', onclick: () => cargar(ids[i + 1]) }, icono('derecha')),
        ] : null,
        h('button', { class: 'boton fantasma mini', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: cerrar }, icono('x')),
      ),
    );

    const acciones = [];
    if (a.estado === 'en_curso') acciones.push(h('button', { class: 'boton mini peligro', onclick: accion('bloquear') }, icono('candado'), 'Bloquear'));
    if (a.estado === 'bloqueado') acciones.push(h('button', { class: 'boton mini primario', onclick: accion('desbloquear') }, 'Desbloquear'));
    if (a.inicio && a.estado !== 'entregado') {
      acciones.push(h('div', { class: 'grupo-botones' },
        h('button', { class: 'boton mini', onclick: accion('tiempo', { minutos: -5 }) }, '−5 min'),
        h('button', { class: 'boton mini', onclick: accion('tiempo', { minutos: 5 }) }, '+5 min'),
      ));
    }
    if (a.estado !== 'entregado') acciones.push(h('button', { class: 'boton mini', onclick: accion('entregar') }, 'Recoger examen'));
    if (a.estado === 'entregado') acciones.push(h('button', { class: 'boton mini', onclick: accion('reabrir') }, 'Reabrir'));

    const datos = [
      a.inicio ? ['Empezó', N.fechaHora(a.inicio)] : ['Estado', 'Todavía no ha empezado'],
      a.estado !== 'entregado' && a.inicio ? ['Le quedan', relojTexto(N.limiteDe(a) - ahora)] : null,
      a.entregadoEn ? ['Entregó', `${N.fechaHora(a.entregadoEn)}${a.motivoEntrega ? ` · ${a.motivoEntrega}` : ''}`] : null,
      a.minutosExtra ? ['Tiempo extra', `${a.minutosExtra} min`] : null,
      ['Salidas', String(a.salidas || 0)],
    ].filter(Boolean);

    const avisoOrden = MODO === 'firebase' && a.semilla && !N.ordenValido(ex, a)
      ? h('div', { class: 'aviso amarillo pequeno' }, 'Las preguntas de este alumno no coinciden con las que le tocaban. Puede pasar si cambiaste el examen después de que entrara; si no, revísalo.')
      : null;

    vaciar(cuerpo,
      h('div', { class: 'resumen-alumno' },
        h('div', { class: 'metrica' }, h('span', {}, c.pendiente ? 'Nota provisional' : 'Nota'), h('b', {}, `${N.numero(c.nota)}`, h('small', {}, ' / 10')), h('div', { class: 'pequeno suave' }, `${N.numero(c.total)} de ${N.numero(c.max)} puntos`)),
        h('dl', { class: 'datos' }, datos.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      ),
      acciones.length ? h('div', { class: 'fila' }, acciones) : null,
      avisoOrden,
      h('h3', { class: 'titulo-cajon' }, 'Respuestas'),
      (a.orden || []).map((o, n) => {
        const p = porId.get(o.id);
        if (!p) return null;
        const anterior = porId.get(a.orden[n - 1]?.id);
        const abreEjercicio = p.grupo && anterior?.grupo !== p.grupo;
        const r = a.respuestas?.[p.id];
        const dd = c.detalle[p.id];
        const respuesta = respuestaRevision(p, o, r);
        const chipEstado = { correcta: 'exito', parcial: 'info', incorrecta: 'peligro', pendiente: 'aviso', manual: 'acento', blanco: '' }[dd.estado];
        const nota = h('input', {
          class: 'nota-manual', type: 'number', step: 0.25, min: -p.puntos, max: p.puntos,
          value: cambios.notasManual[p.id] ?? a.notasManual?.[p.id] ?? '', placeholder: N.numero(dd.puntos),
          'aria-label': `Puntos de la pregunta ${numerosOrden[n]}`,
          oninput: e => (cambios.notasManual[p.id] = e.target.value),
        });
        const rubrica = p.criterios?.length ? rubricaRevision(p, a, cambios, nota) : null;
        const comentario = h('textarea', {
          class: 'comentario-profesor', rows: 1, placeholder: 'Comentario para el alumno (opcional)',
          value: cambios.comentarios[p.id] ?? a.comentarios?.[p.id] ?? '',
          'aria-label': `Comentario de la pregunta ${numerosOrden[n]}`,
          oninput: e => (cambios.comentarios[p.id] = e.target.value),
        });
        const solucion = p.tipo !== 'test' && p.tipo !== 'vf' && p.tipo !== 'multiple' ? N.textoSolucion(p) : '';
        return h('div', { class: `respuesta-detalle ${dd.estado === 'pendiente' ? 'por-corregir' : ''}` },
          h('div', { class: 'fila entre' },
            h('span', { class: 'meta-pregunta' }, `Pregunta ${numerosOrden[n]} · ${N.NOMBRE_TIPO[p.tipo]}`),
            h('div', { class: 'fila', style: { flexWrap: 'nowrap' } }, h('span', { class: `chip ${chipEstado}` }, N.ESTADO_RESPUESTA[dd.estado]), h('label', { class: 'fila pequeno suave', style: { gap: '6px', flexWrap: 'nowrap', whiteSpace: 'nowrap' } }, nota, `/ ${N.numero(p.puntos)}`)),
          ),
          abreEjercicio && p.contexto ? h('div', { class: 'contexto' }, p.contexto) : null,
          h('div', { class: 'enunciado-revision' }, p.apartado ? h('span', { class: 'letra-apartado' }, `${p.apartado})`) : null, p.enunciado),
          p.imagen ? h('img', { class: 'imagen-revision', src: api.urlImagen(p.imagen), alt: '' }) : null,
          respuesta,
          solucion ? h('div', { class: 'pequeno suave' }, `${p.tipo === 'corta' ? 'Aceptadas' : 'Solución'}: ${solucion}`) : null,
          rubrica,
          comentario,
        );
      }),
      h('h3', { class: 'titulo-cajon' }, 'Registro'),
      a.incidencias?.length
        ? h('ul', { class: 'cronologia' }, [...a.incidencias].reverse().map(inc =>
          h('li', {}, h('time', {}, new Date(inc.t).toLocaleTimeString('es-ES')), h('span', { class: N.SOSPECHOSAS.has(inc.tipo) ? 'sospechosa' : '' }, inc.detalle || inc.tipo))))
        : h('p', { class: 'suave' }, 'Sin registros.'),
    );

    vaciar(pie,
      h('button', { class: 'boton fantasma peligro', style: { marginRight: 'auto' }, onclick: async e => {
        if (!(await confirmar('¿Borrar este alumno?', `Se borrará el examen de ${a.nombre} y podrá volver a entrar como si fuera nuevo.`, 'Borrar', 'peligro'))) return;
        ocupado(e.currentTarget, async () => {
          await api.borrarIntento(E, A);
          cambios = sinCambios();
          d.close();
          d.remove();
        });
      } }, icono('papelera'), 'Borrar'),
      h('button', { class: 'boton', onclick: e => ocupado(e.currentTarget, async () => descargar(`${N.nombreArchivo(a.nombre)}.md`, markdownIntento(ctx.ex, a, await opcionesExportar()), 'text/markdown;charset=utf-8')) }, icono('bajar'), 'Markdown'),
      h('button', { class: 'boton', onclick: e => ocupado(e.currentTarget, async () => descargar(`${N.nombreArchivo(a.nombre)}.pdf`, await pdfIntento(ctx.ex, a, await opcionesExportar()))) }, icono('bajar'), 'PDF'),
      h('button', { class: 'boton primario', onclick: e => ocupado(e.currentTarget, async () => {
        if (!hayCambios()) return notificar('No has cambiado nada');
        await guardarNotas();
        pintar();
      }) }, 'Guardar corrección'),
    );
  }

  cargar();
}

arrancar();
