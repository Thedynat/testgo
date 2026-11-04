// Examen de un alumno (enunciados y debajo su respuesta) en Markdown, PDF o todos en un ZIP.
// opciones: { centro: { nombre, logo }, urlImagen: id => url } para el logo y las imágenes de las preguntas
import * as N from './nucleo.js';
import { jspdf, jszip } from './librerias.js';

const LETRA = i => String.fromCharCode(97 + i);

// Preguntas en el orden en que las vio el alumno, con sus opciones también en ese orden
function preguntasDelAlumno(ex, a) {
  const porId = new Map(ex.preguntas.map(p => [p.id, p]));
  const orden = a.orden?.length ? a.orden : ex.preguntas.map(p => ({ id: p.id, perm: null }));
  const lista = orden
    .map(o => {
      const p = porId.get(o.id);
      if (!p) return null;
      const perm = N.CON_OPCIONES.has(p.tipo) ? (o.perm || p.opciones.map((_, i) => i)).filter(i => i < p.opciones.length) : [];
      return { p, perm };
    })
    .filter(Boolean);
  // Número de cada pregunta ("3a") y si es la primera de su ejercicio, que lleva el enunciado común
  const numeros = N.etiquetas(lista.map(x => x.p));
  return lista.map((x, i) => ({ ...x, numero: numeros[i], abreEjercicio: !!x.p.grupo && lista[i - 1]?.p.grupo !== x.p.grupo }));
}

function resumen(ex, a, centro) {
  const c = N.corregir(ex, a);
  return {
    c,
    datos: [
      centro?.nombre ? ['Centro', centro.nombre] : null,
      ex.asignatura ? ['Asignatura', ex.asignatura] : null,
      ['Alumno', a.nombre],
      ['Estado', N.ESTADO_INTENTO[a.estado] || a.estado],
      ['Nota', `${N.numero(c.nota)} / 10 (${N.numero(c.total)} de ${N.numero(c.max)} puntos)${c.pendiente ? ', provisional: faltan preguntas por corregir' : ''}`],
      a.inicio ? ['Inicio', N.fechaHora(a.inicio)] : null,
      a.entregadoEn ? ['Entrega', `${N.fechaHora(a.entregadoEn)}${a.motivoEntrega ? ` (${a.motivoEntrega})` : ''}`] : null,
      ['Salidas del examen', String(a.salidas || 0)],
    ].filter(Boolean),
  };
}

const puntosTexto = n => `${N.numero(n)} ${Math.abs(n) === 1 ? 'punto' : 'puntos'}`;

// Opciones de las preguntas que se responden eligiendo, con las marcas de elegida y correcta
function opcionesConMarcas(p, perm, r) {
  const elegidas = new Set(Array.isArray(r) ? r : N.hayRespuesta(r) ? [r] : []);
  const buenas = new Set(p.tipo === 'multiple' ? p.correctas : [p.correcta]);
  return perm.map((idx, j) => ({
    texto: `${p.tipo === 'vf' ? '' : `${LETRA(j)}) `}${p.opciones[idx]}`,
    elegida: elegidas.has(idx),
    correcta: buenas.has(idx),
  }));
}

// Texto de la respuesta del alumno (null si la dejó en blanco)
function respuestaTexto(p, perm, r) {
  if (!N.hayRespuesta(r)) return null;
  if (N.CON_OPCIONES.has(p.tipo)) {
    return opcionesConMarcas(p, perm, r).filter(o => o.elegida).map(o => o.texto).join('\n');
  }
  if (p.tipo === 'relacionar') {
    return p.pares.map((par, i) => {
      const k = r[i] === null || r[i] === undefined ? null : p.ordenDerecha[r[i]];
      return `${par.izq} → ${k === null ? '(sin responder)' : p.pares[k]?.der ?? ''}${k === i ? '  ✓' : ''}`;
    }).join('\n');
  }
  return N.textoRespuesta(p, r);
}

// Criterios de la rúbrica con los que ha marcado el profesor
const criteriosTexto = (p, a) => {
  const marcados = new Set(a.rubricas?.[p.id] || []);
  return (p.criterios || []).map((c, j) => ({ texto: `${c.texto} (${N.numero(c.puntos)})`, cumple: marcados.has(j) }));
};

// ---------- Markdown ----------

export function markdownIntento(ex, a, { centro } = {}) {
  const { c, datos } = resumen(ex, a, centro);
  const l = [`# ${ex.titulo}`, ''];
  for (const [clave, valor] of datos) l.push(`- **${clave}:** ${valor}`);
  l.push('', '---', '');
  preguntasDelAlumno(ex, a).forEach(({ p, perm, numero, abreEjercicio }) => {
    const d = c.detalle[p.id];
    const r = a.respuestas?.[p.id];
    if (abreEjercicio && p.contexto) l.push(`## Ejercicio ${numero.replace(/[a-z]+$/, '')}`, '', p.contexto.trim(), '');
    l.push(`${p.grupo ? '###' : '##'} Pregunta ${numero}`, '', `*${N.NOMBRE_TIPO[p.tipo]} · ${puntosTexto(p.puntos)}*`, '', p.enunciado.trim(), '');
    if (p.imagen) l.push('*(La pregunta incluye una imagen.)*', '');
    if (N.CON_OPCIONES.has(p.tipo)) {
      for (const o of opcionesConMarcas(p, perm, r)) {
        const marcas = [o.elegida ? '**← respuesta del alumno**' : '', o.correcta ? '*(correcta)*' : ''].filter(Boolean).join(' ');
        l.push(`- ${o.texto}${marcas ? ` ${marcas}` : ''}`);
      }
      l.push('');
    }
    l.push('**Respuesta del alumno:**', '');
    const texto = respuestaTexto(p, perm, r);
    if (texto === null || !String(texto).trim()) l.push('> *(en blanco)*');
    else for (const linea of String(texto).split(/\r?\n/)) l.push(`> ${linea}`);
    l.push('');
    const solucion = N.CON_OPCIONES.has(p.tipo) ? '' : N.textoSolucion(p);
    if (solucion) l.push(`*${p.tipo === 'corta' ? 'Respuestas aceptadas' : 'Solución'}: ${solucion}*`, '');
    if (p.criterios?.length) {
      l.push('**Criterios de corrección:**', '');
      for (const k of criteriosTexto(p, a)) l.push(`- [${k.cumple ? 'x' : ' '}] ${k.texto}`);
      l.push('');
    }
    if (d) l.push(`**Corrección:** ${N.ESTADO_RESPUESTA[d.estado]} · ${N.numero(d.puntos)} / ${N.numero(d.max)}`, '');
    if (a.comentarios?.[p.id]) l.push(`**Comentario del profesor:** ${a.comentarios[p.id]}`, '');
    l.push('---', '');
  });
  l.push(`*Generado con TestGO el ${N.fechaHora(Date.now())}*`, '');
  return l.join('\n');
}

// ---------- PDF ----------

// Las fuentes estándar de PDF solo tienen caracteres latinos: el resto se cambia por "?"
const PERMITIDOS = /[^\n\t\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g;
const paraPDF = texto => String(texto ?? '').replace(/\t/g, '    ').replace(/→/g, '->').replace(/✓/g, '(bien)').replace(PERMITIDOS, '?');

const COLOR = {
  marino: [12, 18, 48],
  go: [12, 144, 246],
  indigo: [78, 72, 252],
  gris: [110, 116, 140],
  borde: [221, 226, 240],
  fondo: [245, 247, 252],
  verde: [21, 122, 82],
  rojo: [198, 47, 47],
  ambar: [180, 83, 9],
};

// Descarga las imágenes (logo y preguntas) como data: URL con su tamaño, para meterlas en el PDF
async function cargarImagenes(ids, urlImagen) {
  const imagenes = new Map();
  if (!urlImagen) return imagenes;
  await Promise.all([...new Set(ids.filter(Boolean))].map(async id => {
    try {
      const blob = await fetch(urlImagen(id)).then(r => (r.ok ? r.blob() : Promise.reject(new Error(r.status))));
      const datos = await new Promise((resolver, rechazar) => {
        const lector = new FileReader();
        lector.onload = () => resolver(lector.result);
        lector.onerror = rechazar;
        lector.readAsDataURL(blob);
      });
      const img = await new Promise((resolver, rechazar) => {
        const i = new Image();
        i.onload = () => resolver(i);
        i.onerror = rechazar;
        i.src = datos;
      });
      const formato = blob.type.includes('png') ? 'PNG' : blob.type.includes('webp') ? 'WEBP' : 'JPEG';
      imagenes.set(id, { datos, formato, ancho: img.naturalWidth, alto: img.naturalHeight });
    } catch {}
  }));
  return imagenes;
}

const idsImagenes = (ex, centro) => [centro?.logo, ...ex.preguntas.map(p => p.imagen)];

export async function pdfIntento(ex, a, opciones = {}) {
  const JsPDF = await jspdf();
  const imagenes = await cargarImagenes(idsImagenes(ex, opciones.centro), opciones.urlImagen);
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  dibujarIntento(doc, ex, a, opciones.centro, imagenes);
  return doc.output('blob');
}

function dibujarIntento(doc, ex, a, centro, imagenes = new Map()) {
  const M = 18;
  const ANCHO = 210 - 2 * M;
  const ALTO_UTIL = 297 - 20;
  let y = 20;

  const salto = alto => {
    if (y + alto > ALTO_UTIL) {
      doc.addPage();
      y = 20;
    }
  };

  function texto(contenido, { tam = 10.5, negrita = false, cursiva = false, color = COLOR.marino, sangria = 0, interlineado = 1.4, barra = null } = {}) {
    doc.setFont('helvetica', negrita && cursiva ? 'bolditalic' : negrita ? 'bold' : cursiva ? 'italic' : 'normal');
    doc.setFontSize(tam);
    doc.setTextColor(...color);
    const alto = (tam * 0.3528) * interlineado;
    const lineas = doc.splitTextToSize(paraPDF(contenido), ANCHO - sangria - (barra ? 4 : 0));
    for (const linea of lineas) {
      salto(alto);
      if (barra) {
        doc.setFillColor(...barra);
        doc.rect(M + sangria, y - alto * 0.78, 1.2, alto, 'F');
      }
      doc.text(linea, M + sangria + (barra ? 4 : 0), y);
      y += alto;
    }
  }

  // Imagen ajustada al ancho disponible y a una altura máxima
  function imagen(id, altoMax = 80, anchoMax = ANCHO) {
    const img = imagenes.get(id);
    if (!img) return;
    const escala = Math.min(anchoMax / img.ancho, altoMax / img.alto);
    const w = img.ancho * escala;
    const hh = img.alto * escala;
    salto(hh + 2);
    try {
      doc.addImage(img.datos, img.formato, M, y, w, hh);
      y += hh + 3;
    } catch {}
  }

  // Cabecera: logo y nombre del centro, o la marca de TestGO si no hay
  const logo = centro?.logo && imagenes.get(centro.logo);
  if (logo || centro?.nombre) {
    let x = M;
    if (logo) {
      // 12 mm de alto, o menos si el logo es muy ancho (máximo 40 mm)
      const proporcion = logo.ancho / logo.alto;
      const ancho = Math.min(40, proporcion * 12);
      try {
        doc.addImage(logo.datos, logo.formato, M, y - 8, ancho, ancho / proporcion);
        x += ancho + 4;
      } catch {}
    }
    if (centro?.nombre) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...COLOR.marino);
      doc.text(paraPDF(centro.nombre), x, y - 1);
    }
    y += 10;
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...COLOR.marino);
    doc.text('Test', M, y);
    doc.setTextColor(...COLOR.go);
    doc.text('GO', M + doc.getTextWidth('Test'), y);
    y += 10;
  }

  if (ex.asignatura) texto(ex.asignatura, { tam: 10, color: COLOR.gris, negrita: true });
  texto(ex.titulo, { tam: 17, negrita: true });
  y += 2;
  const { c, datos } = resumen(ex, a, null);
  for (const [clave, valor] of datos.filter(([k]) => k !== 'Asignatura')) {
    salto(6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...COLOR.gris);
    doc.text(paraPDF(`${clave}:`), M, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLOR.marino);
    const lineas = doc.splitTextToSize(paraPDF(valor), ANCHO - 38);
    doc.text(lineas, M + 38, y);
    y += 5.2 * lineas.length;
  }
  y += 3;
  doc.setDrawColor(...COLOR.borde);
  doc.line(M, y, M + ANCHO, y);
  y += 8;

  preguntasDelAlumno(ex, a).forEach(({ p, perm, numero, abreEjercicio }) => {
    const d = c.detalle[p.id];
    const r = a.respuestas?.[p.id];
    salto(22);
    if (abreEjercicio && p.contexto) {
      salto(20);
      texto(`Ejercicio ${numero.replace(/[a-z]+$/, '')}`, { tam: 12, negrita: true, color: COLOR.indigo });
      texto(p.contexto.trim(), { tam: 11, barra: COLOR.borde, sangria: 1 });
      y += 4;
    }
    texto(`Pregunta ${numero}`, { tam: 12, negrita: true, color: COLOR.indigo });
    texto(`${N.NOMBRE_TIPO[p.tipo]} · ${puntosTexto(p.puntos)}`, { tam: 9, color: COLOR.gris });
    y += 1.5;
    texto(p.enunciado.trim() || '(sin enunciado)', { tam: 11 });
    y += 1.5;
    if (p.imagen) imagen(p.imagen);
    if (N.CON_OPCIONES.has(p.tipo)) {
      for (const o of opcionesConMarcas(p, perm, r)) {
        const marca = [o.elegida ? '<- respuesta del alumno' : '', o.correcta ? '(correcta)' : ''].filter(Boolean).join('  ');
        texto(`${o.texto}${marca ? `   ${marca}` : ''}`, {
          sangria: 4,
          negrita: o.elegida,
          color: o.correcta ? COLOR.verde : o.elegida ? COLOR.rojo : COLOR.marino,
        });
      }
      y += 1.5;
    }
    texto('Respuesta del alumno', { tam: 9.5, negrita: true, color: COLOR.gris });
    const respuesta = respuestaTexto(p, perm, r);
    const vacia = respuesta === null || !String(respuesta).trim();
    texto(vacia ? '(en blanco)' : String(respuesta), { cursiva: vacia, color: vacia ? COLOR.gris : COLOR.marino, barra: COLOR.indigo, sangria: 1 });
    const solucion = N.CON_OPCIONES.has(p.tipo) ? '' : N.textoSolucion(p);
    if (solucion) {
      y += 1;
      texto(`${p.tipo === 'corta' ? 'Respuestas aceptadas' : 'Solución'}: ${solucion}`, { tam: 9, cursiva: true, color: COLOR.gris });
    }
    if (p.criterios?.length) {
      y += 1;
      texto('Criterios de corrección', { tam: 9.5, negrita: true, color: COLOR.gris });
      for (const k of criteriosTexto(p, a)) texto(`${k.cumple ? '[x]' : '[  ]'} ${k.texto}`, { tam: 9.5, sangria: 3, color: k.cumple ? COLOR.verde : COLOR.marino });
    }
    if (d) {
      y += 1;
      const color = d.estado === 'correcta' ? COLOR.verde : d.estado === 'incorrecta' ? COLOR.rojo : d.estado === 'parcial' ? COLOR.ambar : COLOR.gris;
      texto(`${N.ESTADO_RESPUESTA[d.estado]} · ${N.numero(d.puntos)} / ${N.numero(d.max)}`, { tam: 9.5, negrita: true, color });
    }
    if (a.comentarios?.[p.id]) {
      y += 1;
      texto(`Comentario del profesor: ${a.comentarios[p.id]}`, { tam: 9.5, cursiva: true, color: COLOR.indigo });
    }
    y += 6;
  });

  // Pie con el nombre y el número de página
  const paginas = doc.getNumberOfPages();
  for (let n = 1; n <= paginas; n++) {
    doc.setPage(n);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLOR.gris);
    doc.text(paraPDF(`${a.nombre} · ${ex.titulo}`), M, 290);
    doc.text(`Página ${n} de ${paginas}`, M + ANCHO, 290, { align: 'right' });
  }
}

// ---------- Todos en un ZIP ----------

export async function zipTodos(ex, intentos, alProgreso = () => {}, opciones = {}) {
  const [JSZip, JsPDF] = await Promise.all([jszip(), jspdf()]);
  const imagenes = await cargarImagenes(idsImagenes(ex, opciones.centro), opciones.urlImagen);
  const zip = new JSZip();
  const carpeta = N.nombreArchivo(ex.titulo);
  const usados = new Set();
  const ordenados = [...intentos].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
  for (const [i, a] of ordenados.entries()) {
    let base = N.nombreArchivo(a.nombre);
    for (let n = 2; usados.has(base); n++) base = `${N.nombreArchivo(a.nombre)}-${n}`;
    usados.add(base);
    zip.file(`${carpeta}/markdown/${base}.md`, markdownIntento(ex, a, opciones));
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    dibujarIntento(doc, ex, a, opciones.centro, imagenes);
    zip.file(`${carpeta}/pdf/${base}.pdf`, doc.output('arraybuffer'));
    alProgreso(i + 1, ordenados.length);
    await new Promise(r => setTimeout(r, 0)); // deja respirar a la página
  }
  zip.file(`${carpeta}/notas.csv`, N.generarCSV(ex, intentos));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
