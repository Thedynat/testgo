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

const PESTANAS = { preguntas: 'Preguntas', ajustes: 'Ajustes', directo: 'En directo', resultados: 'Resultados' };

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

async function vistaLista() {
  document.title = 'TestGO · Exámenes';
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

async function vistaExamen(E, pestana) {
  vaciar(app, h('div', { class: 'tarjeta esqueleto', style: { height: '150px' } }));
  let ex;
  try {
    ex = await api.obtenerExamen(E);
  } catch (e) {
    return vaciar(app, h('div', { class: 'aviso peligro' }, e.message), h('p', {}, h('a', { href: '#/' }, 'Volver a tus exámenes')));
  }

  // Estado compartido por las pestañas y guardado automático
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
          titulo: b.titulo, duracion: b.duracion, numPreguntas: b.numPreguntas, maxSalidas: b.maxSalidas,
          penalizacion: b.penalizacion, barajar: b.barajar, mostrarNota: b.mostrarNota, preguntas: b.preguntas,
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
  const pestanas = h('nav', { class: 'pestanas', 'aria-label': 'Secciones del examen' });
  const contenido = h('div', { class: 'contenido-pestana' });

  function pintarCabecera() {
    const x = ctx.ex;
    document.title = `TestGO · ${x.titulo}`;
    titulo.textContent = x.titulo;
    migaTitulo.textContent = x.titulo;
    vaciar(chips, x.abierto ? h('span', { class: 'chip exito' }, 'Abierto') : h('span', { class: 'chip' }, 'Cerrado'));
    const puntos = x.preguntas.reduce((s, p) => s + p.puntos, 0);
    datos.textContent = `${x.asignatura ? `${x.asignatura} · ` : ''}${plural(x.preguntas.length, 'pregunta', 'preguntas')} · ${plural(puntos, 'punto', 'puntos')} · ${x.duracion} min${x.alumnos ? ` · ${plural(x.alumnos, 'alumno', 'alumnos')}` : ''}`;
    codigo.textContent = x.codigo;
    botonAbrir.className = `boton ${x.abierto ? '' : 'primario'}`;
    vaciar(botonAbrir, x.abierto ? [icono('candado'), 'Cerrar examen'] : [icono('directo'), 'Abrir examen']);
    vaciar(pestanas, Object.entries(PESTANAS).map(([clave, texto]) => h('a', {
      href: rutaExamen(E, clave),
      class: clave === pestana ? 'activa' : '',
      'aria-current': clave === pestana ? 'page' : null,
    }, texto, clave === 'preguntas' ? h('span', { class: 'cuenta' }, x.preguntas.length) : null, clave === 'directo' && x.abierto ? h('span', { class: 'punto-vivo', 'aria-label': 'abierto' }) : null)));
  }

  botonAbrir.onclick = e => ocupado(e.currentTarget, async () => {
    if (!ctx.ex.abierto) {
      const problemas = N.problemasExamen(N.limpiarExamen(ctx.borrador));
      if (!ctx.borrador.preguntas.length) throw new Error('Añade al menos una pregunta antes de abrirlo.');
      if (problemas.length && !(await confirmar('Hay cosas por revisar', `${problemas[0]}${problemas.length > 1 ? ` (y ${problemas.length - 1} más)` : ''} ¿Abrirlo igualmente?`, 'Abrir igualmente'))) return;
    }
    await ctx.guardar();
    ctx.ex = await api.guardarExamen(E, { abierto: !ctx.ex.abierto });
    ctx.borrador.abierto = ctx.ex.abierto;
    notificar(ctx.ex.abierto ? 'Examen abierto: ya pueden entrar los alumnos' : 'Examen cerrado: no puede entrar nadie más');
    pintarCabecera();
  });

  const migaTitulo = h('span');
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
    pestanas,
    contenido,
  );
  pintarCabecera();

  ({ preguntas: pestanaPreguntas, ajustes: pestanaAjustes, directo: pestanaDirecto, resultados: pestanaResultados })[pestana](ctx, contenido);
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

// ---------- Pestaña: preguntas ----------

function pestanaPreguntas(ctx, contenido) {
  const { borrador } = ctx;
  const avisos = h('div');
  const lista = h('div', { class: 'pila' });
  const cabecera = h('h2', { style: { margin: 0 } });

  const pintarAvisos = () => {
    const problemas = N.problemasExamen(N.limpiarExamen(borrador));
    vaciar(avisos, problemas.length && borrador.preguntas.length
      ? h('details', { class: 'aviso amarillo pequeno' },
        h('summary', {}, h('b', {}, `${plural(problemas.length, 'cosa', 'cosas')} por revisar antes de abrirlo`)),
        h('ul', {}, problemas.slice(0, 12).map(t => h('li', {}, t))))
      : null);
    const puntos = borrador.preguntas.reduce((s, p) => s + Number(p.puntos || 0), 0);
    cabecera.textContent = `${plural(borrador.preguntas.length, 'pregunta', 'preguntas')} · ${plural(puntos, 'punto', 'puntos')}`;
  };
  ctx.alCambiarBorrador = pintarAvisos;

  const rehacer = () => {
    ordenarApartados(borrador.preguntas);
    pintar();
    ctx.programar();
  };

  const pintar = () => {
    const info = infoLista(borrador.preguntas);
    vaciar(lista, borrador.preguntas.length
      ? borrador.preguntas.map((p, i) => editorPregunta(p, i, borrador.preguntas.length, {
        ...info[i],
        alCambiar: ctx.programar,
        alRehacer: () => (pintar(), ctx.programar()),
        // Un apartado se mueve dentro de su ejercicio; una pregunta suelta salta ejercicios enteros
        alMover: d => {
          const grupos = N.unidades(borrador.preguntas);
          const lista = p.grupo ? grupos.find(g => g.includes(p)) : grupos;
          const k = p.grupo ? lista.indexOf(p) : grupos.findIndex(g => g[0] === p);
          const j = k + d;
          if (j < 0 || j >= lista.length) return;
          [lista[k], lista[j]] = [lista[j], lista[k]];
          borrador.preguntas.splice(0, borrador.preguntas.length, ...grupos.flat());
          rehacer();
        },
        alDuplicar: () => {
          borrador.preguntas.splice(i + 1, 0, N.limpiarPregunta({ ...structuredClone(p), id: undefined }));
          rehacer();
        },
        alAnadirApartado: () => {
          if (!p.grupo) Object.assign(p, { grupo: N.nuevoId(), apartado: 'a', contexto: '' });
          const ultimo = borrador.preguntas.findLastIndex(q => q.grupo === p.grupo);
          borrador.preguntas.splice(ultimo + 1, 0, N.limpiarPregunta({ tipo: 'desarrollo', grupo: p.grupo, contexto: p.contexto }));
          rehacer();
        },
        alCambiarContexto: texto => {
          cambiarContexto(borrador.preguntas, p.grupo, texto);
          ctx.programar();
        },
        alBorrar: () => {
          borrador.preguntas.splice(i, 1);
          rehacer();
        },
      }))
      : h('div', { class: 'tarjeta vacio' },
        h('h2', {}, 'Añade la primera pregunta'),
        h('p', {}, 'Escríbelas aquí o impórtalas de un examen en Word o PDF.'),
        h('div', { class: 'fila', style: { justifyContent: 'center' } }, botonImportar(), h('button', { class: 'boton primario', onclick: () => anadir('test') }, icono('mas'), 'Pregunta de test')),
      ));
    pintarAvisos();
  };

  const anadir = tipo => {
    const inicial = { tipo, opciones: tipo === 'test' || tipo === 'multiple' ? ['', '', '', ''] : undefined, pares: tipo === 'relacionar' ? [{}, {}, {}] : undefined };
    borrador.preguntas.push(N.limpiarPregunta(inicial));
    pintar();
    ctx.programar();
    const ultima = lista.lastElementChild;
    ultima?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('textarea', ultima)?.focus({ preventScroll: true });
  };

  const botonImportar = () => h('button', { class: 'boton', onclick: async () => {
    const r = await dialogoImportar();
    if (!r) return;
    borrador.preguntas.push(...r.preguntas);
    pintar();
    ctx.programar();
    notificar(`${r.preguntas.length} preguntas añadidas`);
  } }, icono('subir'), 'Importar');

  vaciar(contenido,
    h('div', { class: 'barra-herramientas pegajosa' },
      cabecera,
      h('div', { class: 'fila' },
        botonImportar(),
        menuAnadir(anadir),
      ),
    ),
    ctx.ex.alumnos ? h('div', { class: 'aviso amarillo pequeno', style: { marginBottom: '14px' } }, `Ya hay ${plural(ctx.ex.alumnos, 'alumno', 'alumnos')} en este examen. Puedes corregir textos y soluciones (las notas se recalculan), pero no quitar preguntas ni opciones.`) : null,
    avisos,
    lista,
  );
  pintar();
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
function menuAnadir(anadir) {
  const menu = h('details', { class: 'menu' },
    h('summary', { class: 'boton primario' }, icono('mas'), 'Añadir pregunta'),
    h('div', { class: 'menu-lista' }, N.TIPOS.map(t =>
      h('button', { type: 'button', onclick: () => {
        menu.open = false;
        anadir(t);
      } }, h('b', {}, N.NOMBRE_TIPO[t]), h('span', {}, DESCRIPCION_TIPO[t])))),
  );
  // Se cierra al pulsar fuera
  document.addEventListener('click', e => menu.open && !menu.contains(e.target) && (menu.open = false));
  return menu;
}

// ---------- Pestaña: ajustes ----------

function pestanaAjustes(ctx, contenido) {
  const b = ctx.borrador;
  const entrada = (clave, atributos, convertir = v => v) =>
    h('input', { ...atributos, value: b[clave], oninput: e => ((b[clave] = convertir(e.target.value)), ctx.programar()) });
  const interruptor = (clave, texto, ayuda) =>
    h('label', { class: 'ajuste-interruptor' },
      h('span', {}, h('b', {}, texto), h('small', {}, ayuda)),
      h('input', { type: 'checkbox', role: 'switch', class: 'interruptor', checked: !!b[clave], onchange: e => ((b[clave] = e.target.checked), ctx.programar()) }));

  const penalizacion = h('select', { onchange: e => ((b.penalizacion = Number(e.target.value)), ctx.programar()) },
    [['0', 'No restan'], ['0.25', 'Restan 1/4 de la pregunta'], ['0.3333', 'Restan 1/3 de la pregunta'], ['0.5', 'Restan 1/2 de la pregunta'], ['1', 'Restan la pregunta entera']].map(([v, t]) => h('option', { value: v }, t)));
  if (![...penalizacion.options].some(o => Math.abs(Number(o.value) - b.penalizacion) < 0.001)) penalizacion.append(h('option', { value: String(b.penalizacion) }, `Restan ${N.numero(b.penalizacion * 100)} %`));
  penalizacion.value = [...penalizacion.options].find(o => Math.abs(Number(o.value) - b.penalizacion) < 0.001)?.value;

  const seccion = (tituloSeccion, descripcion, ...hijos) =>
    h('section', { class: 'tarjeta ajustes-seccion' },
      h('div', {}, h('h3', {}, tituloSeccion), h('p', { class: 'suave pequeno', style: { margin: 0 } }, descripcion)),
      h('div', { class: 'pila' }, hijos));

  vaciar(contenido, h('div', { class: 'pila' },
    seccion('General', 'Lo que ven los alumnos al entrar.',
      campo('Título', entrada('titulo', { type: 'text', maxlength: 200 })),
      campo('Asignatura o módulo', entrada('asignatura', { type: 'text', maxlength: 120, placeholder: 'Montaje y Mantenimiento de Equipos' }), 'Sale en la pantalla del alumno y en los PDF, junto al nombre y el logo del centro.'),
      h('div', { class: 'rejilla', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } },
        campo('Duración (minutos)', entrada('duracion', { type: 'number', min: 1, max: 600 }, Number)),
        campo('Preguntas por alumno', entrada('numPreguntas', { type: 'number', min: 0, max: 500 }, Number), '0 = todas. Si pones menos, a cada alumno le tocan unas al azar.'),
      ),
    ),
    seccion('Corrección', 'Cómo se puntúa y qué ve el alumno al acabar.',
      campo('Respuestas incorrectas en test', penalizacion),
      interruptor('mostrarNota', 'Enseñar la nota al entregar', 'Si hay preguntas de desarrollo, la nota será provisional hasta que las corrijas.'),
    ),
    seccion('Control antichuleta', 'Se registra cada vez que el alumno sale del examen.',
      campo('Bloquear tras salir', entrada('maxSalidas', { type: 'number', min: 0, max: 50 }, Number), 'Número de salidas de la pantalla. 0 = no bloquear nunca.'),
      interruptor('barajar', 'Barajar preguntas y opciones', 'Cada alumno las ve en un orden distinto.'),
      interruptor('marcaAgua', 'Marca de agua con el nombre y la fecha', 'El nombre del alumno y la fecha salen de fondo en todo el examen: si alguien hace una foto o una captura, se sabe de quién es.'),
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
}

// ---------- Pestaña: en directo ----------

const FILTROS_DIRECTO = { todos: 'Todos', en_curso: 'En curso', bloqueado: 'Bloqueados', entregado: 'Entregados', incidencias: 'Con incidencias' };

function pestanaDirecto(ctx, contenido) {
  const { E } = ctx;
  let datos = { intentos: [], solicitudes: [], desfase: 0 };
  let cargado = false;
  const filtro = { estado: 'todos', texto: '' };
  const metricas = h('div', { class: 'metricas' });
  const solicitudes = h('div', { class: 'pila', style: { gap: '8px' } });
  const segmentado = h('div', { class: 'segmentado' });
  const tabla = h('tbody');
  const direccion = h('b', { class: 'mono' }, location.host);
  urlAlumnos().then(u => (direccion.textContent = u));

  const coincide = a => {
    if (filtro.texto && !N.normalizar(a.nombre).includes(N.normalizar(filtro.texto))) return false;
    if (filtro.estado === 'incidencias') return (a.salidas || 0) > 0 || !!a.ultimaIncidencia;
    return filtro.estado === 'todos' || a.estado === filtro.estado;
  };

  async function recogerTodos(boton) {
    const pendientes = datos.intentos.filter(a => a.estado !== 'entregado');
    if (!pendientes.length) return notificar('No hay exámenes sin entregar');
    if (!(await confirmar('¿Recoger todos los exámenes?', `Se entregarán ya los ${pendientes.length} exámenes que siguen abiertos, con lo que lleve respondido cada alumno.`, 'Recoger todos', 'peligro'))) return;
    await ocupado(boton, async () => {
      for (const a of pendientes) await api.accion(E, a.id, 'entregar');
      notificar(`${plural(pendientes.length, 'examen recogido', 'exámenes recogidos')}`);
    });
  }

  vaciar(contenido,
    h('div', { class: 'fila entre', style: { marginBottom: '16px' } },
      h('p', { class: 'suave', style: { margin: 0 } }, 'Los alumnos entran en ', direccion, ' con el código del examen.'),
      h('div', { class: 'fila' },
        h('button', { class: 'boton', onclick: () => mostrarALaClase(ctx) }, icono('pantalla'), 'Mostrar a la clase'),
        h('button', { class: 'boton peligro', onclick: e => recogerTodos(e.currentTarget) }, 'Recoger todos'),
      ),
    ),
    metricas,
    solicitudes,
    h('div', { class: 'barra-herramientas' },
      h('label', { class: 'buscador' }, icono('lupa'), h('input', { type: 'search', placeholder: 'Buscar alumno', 'aria-label': 'Buscar alumno', oninput: e => ((filtro.texto = e.target.value), pintar()) })),
      segmentado,
    ),
    h('div', { class: 'tabla-contenedor' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Alumno'), h('th', {}, 'Estado'), h('th', {}, 'Progreso'), h('th', { class: 'num' }, 'Tiempo'),
        h('th', { class: 'num' }, 'Salidas'), h('th', {}, 'Última incidencia'), h('th', { class: 'num' }, 'Nota'), h('th', {}, ''),
      )),
      tabla,
    )),
  );

  function pintar() {
    const ahora = Date.now() + datos.desfase;
    const todos = [...datos.intentos].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
    const cuenta = {
      todos: todos.length,
      en_curso: todos.filter(a => a.estado === 'en_curso').length,
      bloqueado: todos.filter(a => a.estado === 'bloqueado').length,
      entregado: todos.filter(a => a.estado === 'entregado').length,
      incidencias: todos.filter(a => (a.salidas || 0) > 0 || a.ultimaIncidencia).length,
    };
    const metrica = (clave, texto, color) => h('button', {
      type: 'button', class: `metrica clicable ${filtro.estado === clave && clave !== 'todos' ? 'activa' : ''}`,
      onclick: () => ((filtro.estado = filtro.estado === clave ? 'todos' : clave), pintar()),
    }, h('span', {}, texto), h('b', { style: { color: cuenta[clave] && color ? color : '' } }, cuenta[clave]));
    vaciar(metricas,
      metrica('todos', 'Alumnos'),
      metrica('en_curso', 'En curso'),
      metrica('bloqueado', 'Bloqueados', 'var(--peligro)'),
      metrica('entregado', 'Entregados', 'var(--exito)'),
    );
    vaciar(segmentado, Object.entries(FILTROS_DIRECTO).map(([v, t]) => h('button', {
      type: 'button', class: filtro.estado === v ? 'activo' : '', onclick: () => ((filtro.estado = v), pintar()),
    }, t, h('span', { class: 'cuenta' }, cuenta[v]))));

    vaciar(solicitudes, datos.solicitudes.map(s =>
      h('div', { class: 'aviso amarillo fila entre' },
        h('span', {}, h('b', {}, s.nombre), ' pide volver a entrar desde otro dispositivo.'),
        h('div', { class: 'fila' },
          h('button', { class: 'boton mini', onclick: e => ocupado(e.currentTarget, () => api.resolverSolicitud(E, s.id, false)) }, 'Rechazar'),
          h('button', { class: 'boton primario mini', onclick: e => ocupado(e.currentTarget, async () => {
            await api.resolverSolicitud(E, s.id, true);
            notificar(`${s.nombre} puede volver a entrar`);
          }) }, 'Permitir'),
        ),
      ),
    ));

    const lista = todos.filter(coincide);
    if (!cargado) return vaciar(tabla, h('tr', {}, h('td', { colspan: 8, class: 'vacio' }, 'Cargando…')));
    if (!todos.length) {
      return vaciar(tabla, h('tr', {}, h('td', { colspan: 8, class: 'vacio' },
        ctx.ex.abierto ? 'Esperando a que entren los alumnos…' : 'El examen está cerrado. Ábrelo con el botón de arriba para que puedan entrar.')));
    }
    if (!lista.length) return vaciar(tabla, h('tr', {}, h('td', { colspan: 8, class: 'vacio' }, 'Ningún alumno coincide con el filtro.')));
    const ids = lista.map(a => a.id);
    vaciar(tabla, lista.map(a => filaAlumno(a, ahora, ids)));
  }

  function filaAlumno(a, ahora, ids) {
    const total = a.orden?.length || 0;
    const hechas = Object.keys(a.respuestas || {}).length;
    const sinSenal = a.estado !== 'entregado' && a.inicio && ahora - (a.ultimaSenal || 0) > (MODO === 'firebase' ? 150000 : 40000);
    let chip;
    if (a.estado === 'entregado') chip = h('span', { class: 'chip exito' }, 'Entregado');
    else if (a.estado === 'bloqueado') chip = h('span', { class: 'chip peligro' }, 'Bloqueado');
    else if (!a.inicio) chip = h('span', { class: 'chip' }, 'Sin empezar');
    else chip = h('span', { class: 'chip info' }, 'En curso');
    let tiempo = '—';
    if (a.inicio && a.estado !== 'entregado') tiempo = relojTexto(N.limiteDe(a) - ahora);
    else if (a.inicio && a.entregadoEn) tiempo = N.duracionTexto(a.entregadoEn - a.inicio);
    const c = N.corregir(ctx.ex, a);
    const salidas = N.salidasDesde(a);
    const ultima = a.ultimaIncidencia;
    return h('tr', { class: 'clicable', onclick: () => detalleAlumno(ctx, a.id, ids) },
      h('td', {}, h('div', { class: 'celda-alumno' }, h('span', { class: 'avatar' }, iniciales(a.nombre)), h('div', {}, h('b', {}, a.nombre), sinSenal ? h('div', { class: 'pequeno', style: { color: 'var(--aviso)' } }, `Sin señal ${haceTexto(ahora - a.ultimaSenal)}`) : null))),
      h('td', {}, chip),
      h('td', {}, h('div', { class: 'progreso-mini', title: `${hechas} de ${total} respondidas` }, h('div', {}, h('i', { style: { width: `${total ? (hechas / total) * 100 : 0}%` } })), h('span', {}, `${hechas}/${total}`))),
      h('td', { class: 'num mono' }, tiempo),
      h('td', { class: 'num' }, salidas || a.salidas ? h('span', { class: `chip sin-punto ${ctx.ex.maxSalidas && salidas >= ctx.ex.maxSalidas - 1 ? 'peligro' : 'aviso'}` }, ctx.ex.maxSalidas ? `${salidas}/${ctx.ex.maxSalidas}` : String(a.salidas)) : h('span', { class: 'suave' }, '0')),
      h('td', { class: 'pequeno' }, ultima ? [h('div', { style: { color: 'var(--peligro)' } }, ultima.detalle), h('div', { class: 'suave' }, haceTexto(ahora - ultima.t))] : h('span', { class: 'suave' }, '—')),
      h('td', { class: 'num' }, a.inicio ? h('b', {}, `${N.numero(c.nota)}${c.pendiente ? '*' : ''}`) : ''),
      h('td', {}, a.estado === 'bloqueado'
        ? h('button', { class: 'boton primario mini', onclick: e => {
          e.stopPropagation();
          ocupado(e.currentTarget, () => api.accion(E, a.id, 'desbloquear'));
        } }, 'Desbloquear')
        : h('span', { class: 'flecha-fila', 'aria-hidden': 'true' }, icono('derecha'))),
    );
  }

  const parar = api.observarIntentos(E, d => {
    datos = d;
    cargado = true;
    pintar();
  }, e => (e.estado === 401 ? location.reload() : notificarError(e)));
  const reloj = setInterval(pintar, 1000);
  ctx.limpiar.push(parar, () => clearInterval(reloj));
  pintar();
}

const iniciales = nombre => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

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
function editorPregunta(p, i, total, { alCambiar, alRehacer, alMover, alBorrar, alDescartar, alDuplicar, alAnadirApartado, alCambiarContexto = () => {}, numero, primeroDelGrupo = true }) {
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
            if (!p.enunciado.trim() || (await confirmar('¿Borrar la pregunta?', p.enunciado.slice(0, 160), 'Borrar', 'peligro'))) alBorrar();
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

function dialogoImportar() {
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

    paso1();
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
