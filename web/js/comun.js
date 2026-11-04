// Utilidades de interfaz que usan las páginas del alumno y del profesor

export const $ = (selector, raiz = document) => raiz.querySelector(selector);
export const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

// Crea elementos sin innerHTML: h('button', { class: 'boton', onclick }, 'Texto')
export function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos || {})) {
    if (valor === undefined || valor === null || valor === false || clave === 'value') continue;
    if (clave.startsWith('on') && typeof valor === 'function') el.addEventListener(clave.slice(2), valor);
    else if (clave === 'class') el.className = valor;
    else if (clave === 'style' && typeof valor === 'object') Object.assign(el.style, valor);
    else if (clave in el && typeof valor !== 'string') el[clave] = valor;
    else el.setAttribute(clave, valor === true ? '' : valor);
  }
  agregar(el, hijos);
  // El valor va después de los hijos para que un <select> ya tenga sus opciones
  if (atributos?.value !== undefined && atributos.value !== null) el.value = atributos.value;
  return el;
}

function agregar(el, hijos) {
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

export function vaciar(el, ...hijos) {
  el.replaceChildren();
  agregar(el, hijos);
  return el;
}

export function marca(grande = false, href = '/') {
  return h('a', { class: grande ? 'marca marca-grande' : 'marca', href, 'aria-label': 'TestGO' },
    h('img', { src: '/img/logo.svg', alt: '' }),
    h('span', {}, 'Test', h('b', {}, 'GO')),
  );
}

let contenedorNotificaciones = null;
export function notificar(texto, tipo = '') {
  if (!contenedorNotificaciones) {
    contenedorNotificaciones = h('div', { class: 'notificaciones', role: 'status', 'aria-live': 'polite' });
    document.body.append(contenedorNotificaciones);
  }
  const n = h('div', { class: `notificacion ${tipo}` }, texto);
  contenedorNotificaciones.append(n);
  setTimeout(() => n.remove(), tipo === 'error' ? 6000 : 3500);
}

export const notificarError = e => notificar(e?.message || String(e), 'error');

// Diálogo modal; devuelve una promesa con el valor del botón pulsado (o null si se cierra)
export function dialogo({ titulo, contenido, botones = [{ texto: 'Aceptar', valor: true, clase: 'primario' }], ancho = false, alAbrir }) {
  return new Promise(resolver => {
    const d = h('dialog', { class: ancho ? 'ancho' : '' });
    const cerrar = valor => {
      d.close();
      d.remove();
      resolver(valor);
    };
    const pie = h('div', { class: 'dialogo-pie' },
      botones.map(b =>
        h('button', {
          class: `boton ${b.clase || ''}`,
          type: 'button',
          onclick: async () => {
            if (b.antes && (await b.antes()) === false) return;
            cerrar(typeof b.valor === 'function' ? b.valor() : b.valor);
          },
        }, b.texto),
      ),
    );
    d.append(h('div', { class: 'dialogo-cuerpo' }, titulo ? h('h2', {}, titulo) : null, contenido), pie);
    d.addEventListener('cancel', e => {
      e.preventDefault();
      cerrar(null);
    });
    document.body.append(d);
    d.showModal();
    alAbrir?.(d, cerrar);
  });
}

export const confirmar = (titulo, texto, textoBoton = 'Aceptar', clase = 'primario') =>
  dialogo({
    titulo,
    contenido: h('p', {}, texto),
    botones: [
      { texto: 'Cancelar', valor: false },
      { texto: textoBoton, valor: true, clase },
    ],
  });

// Ejecuta una acción mostrando el botón como ocupado y avisando de los errores
export async function ocupado(boton, accion) {
  if (boton) boton.disabled = true;
  try {
    return await accion();
  } catch (e) {
    notificarError(e);
    return undefined;
  } finally {
    if (boton) boton.disabled = false;
  }
}

export function descargar(nombre, contenido, tipo = 'text/plain;charset=utf-8') {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Reduce una foto a un tamaño razonable (máx. 1600 px) y la devuelve como data: URL
export async function comprimirImagen(archivo, lado = 1600) {
  if (!archivo.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((resolver, rechazar) => {
      const i = new Image();
      i.onload = () => resolver(i);
      i.onerror = () => rechazar(new Error('No se ha podido abrir la imagen.'));
      i.src = url;
    });
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(img.naturalWidth * escala);
    lienzo.height = Math.round(img.naturalHeight * escala);
    const c = lienzo.getContext('2d');
    c.fillStyle = '#fff'; // las PNG transparentes quedan sobre blanco
    c.fillRect(0, 0, lienzo.width, lienzo.height);
    c.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    // Las capturas con texto o esquemas se ven mejor en PNG; las fotos, en JPG
    const png = lienzo.toDataURL('image/png');
    const jpg = lienzo.toDataURL('image/jpeg', 0.85);
    return archivo.type === 'image/png' && png.length < 1.4e6 ? png : jpg;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function relojTexto(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export const haceTexto = ms => {
  const s = Math.round(ms / 1000);
  if (s < 10) return 'ahora';
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`;
};

// Iconos de trazo (24x24)
const ICONOS = {
  candado: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
  check: 'M20 6 9 17l-5-5',
  reloj: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  subir: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v4h16v-4',
  bajar: 'M12 4v12m0 0-4-4m4 4 4-4M4 16v4h16v-4',
  mas: 'M12 5v14M5 12h14',
  papelera: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  ojo: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  arriba: 'm6 15 6-6 6 6',
  izquierda: 'm15 18-6-6 6-6',
  derecha: 'm9 18 6-6-6-6',
  bandera: 'M5 21V4m0 0h11l-2 4 2 4H5',
  lupa: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  pantalla: 'M3 4h18v12H3zM8 20h8M12 16v4',
  refrescar: 'M20 11a8 8 0 0 0-14.9-3M4 5v3h3M4 13a8 8 0 0 0 14.9 3M20 19v-3h-3',
  x: 'M18 6 6 18M6 6l12 12',
  imagen: 'M4 5h16v14H4zM4 15l4-4 5 5M14 14l2-2 4 4M15.5 8.5h.01',
  escuela: 'M3 10 12 5l9 5-9 5zM7 12v4c0 1 2 3 5 3s5-2 5-3v-4',
  chispa: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  abajo: 'm6 9 6 6 6-6',
  copia: 'M9 9h11v11H9zM5 15H4V4h11v1',
  salir: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  directo: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2',
  lapiz: 'M4 20h4L19 9l-4-4L4 16v4z',
  archivo: 'M14 3H6v18h12V7l-4-4zM14 3v4h4',
  aviso: 'M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
};

export function icono(nombre, clase = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (clase) svg.setAttribute('class', clase);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONOS[nombre] || '');
  svg.append(path);
  return svg;
}
