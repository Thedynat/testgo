// Examen de un alumno (enunciados y debajo su respuesta) en Markdown, PDF o todos en un ZIP
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
      const perm = p.tipo === 'test' ? (o.perm || p.opciones.map((_, i) => i)).filter(i => i < p.opciones.length) : [];
      return { p, perm };
    })
    .filter(Boolean);
  // Número de cada pregunta ("3a") y si es la primera de su ejercicio, que lleva el enunciado común
  const numeros = N.etiquetas(lista.map(x => x.p));
  return lista.map((x, i) => ({ ...x, numero: numeros[i], abreEjercicio: !!x.p.grupo && lista[i - 1]?.p.grupo !== x.p.grupo }));
}

function resumen(ex, a) {
  const c = N.corregir(ex, a);
  return {
    c,
    datos: [
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

function respuestaTest(p, perm, r) {
  if (r === undefined || r === null || r === '') return null;
  const pos = perm.indexOf(r);
  return `${pos >= 0 ? `${LETRA(pos)}) ` : ''}${p.opciones[r] ?? ''}`;
}

// ---------- Markdown ----------

export function markdownIntento(ex, a) {
  const { c, datos } = resumen(ex, a);
  const l = [`# ${ex.titulo}`, ''];
  for (const [clave, valor] of datos) l.push(`- **${clave}:** ${valor}`);
  l.push('', '---', '');
  preguntasDelAlumno(ex, a).forEach(({ p, perm, numero, abreEjercicio }) => {
    const d = c.detalle[p.id];
    const r = a.respuestas?.[p.id];
    if (abreEjercicio && p.contexto) l.push(`## Ejercicio ${numero.replace(/[a-z]+$/, '')}`, '', p.contexto.trim(), '');
    l.push(`${p.grupo ? '###' : '##'} Pregunta ${numero}`, '', `*${N.NOMBRE_TIPO[p.tipo]} · ${puntosTexto(p.puntos)}*`, '', p.enunciado.trim(), '');
    if (p.tipo === 'test') {
      perm.forEach((idx, j) => {
        const marcas = [idx === r ? '**← respuesta del alumno**' : '', idx === p.correcta ? '*(correcta)*' : ''].filter(Boolean).join(' ');
        l.push(`- ${LETRA(j)}) ${p.opciones[idx]}${marcas ? ` ${marcas}` : ''}`);
      });
      l.push('');
    }
    l.push('**Respuesta del alumno:**', '');
    const texto = p.tipo === 'test' ? respuestaTest(p, perm, r) : r;
    if (texto === null || texto === undefined || String(texto).trim() === '') l.push('> *(en blanco)*');
    else for (const linea of String(texto).split(/\r?\n/)) l.push(`> ${linea}`);
    l.push('');
    if (p.tipo === 'corta' && p.respuestas.length) l.push(`*Respuestas aceptadas: ${p.respuestas.join(' / ')}*`, '');
    if (d) l.push(`**Corrección:** ${N.ESTADO_RESPUESTA[d.estado]} · ${N.numero(d.puntos)} / ${N.numero(d.max)}`, '');
    l.push('---', '');
  });
  l.push(`*Generado con TestGO el ${N.fechaHora(Date.now())}*`, '');
  return l.join('\n');
}

// ---------- PDF ----------

// Las fuentes estándar de PDF solo tienen caracteres latinos: el resto se cambia por "?"
const PERMITIDOS = /[^\n\t\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g;
const paraPDF = texto => String(texto ?? '').replace(/\t/g, '    ').replace(PERMITIDOS, '?');

const COLOR = {
  marino: [12, 18, 48],
  go: [12, 144, 246],
  indigo: [78, 72, 252],
  gris: [110, 116, 140],
  borde: [221, 226, 240],
  fondo: [245, 247, 252],
  verde: [21, 122, 82],
  rojo: [198, 47, 47],
};

export async function pdfIntento(ex, a) {
  const JsPDF = await jspdf();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  dibujarIntento(doc, ex, a);
  return doc.output('blob');
}

function dibujarIntento(doc, ex, a) {
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

  // Cabecera con la marca
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...COLOR.marino);
  doc.text('Test', M, y);
  doc.setTextColor(...COLOR.go);
  doc.text('GO', M + doc.getTextWidth('Test'), y);
  y += 10;

  texto(ex.titulo, { tam: 17, negrita: true });
  y += 2;
  const { c, datos } = resumen(ex, a);
  for (const [clave, valor] of datos) {
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
    if (p.tipo === 'test') {
      perm.forEach((idx, j) => {
        const elegida = idx === r;
        const correcta = idx === p.correcta;
        const marca = [elegida ? '<- respuesta del alumno' : '', correcta ? '(correcta)' : ''].filter(Boolean).join('  ');
        texto(`${LETRA(j)}) ${p.opciones[idx]}${marca ? `   ${marca}` : ''}`, {
          sangria: 4,
          negrita: elegida,
          color: correcta ? COLOR.verde : elegida && !correcta ? COLOR.rojo : COLOR.marino,
        });
      });
      y += 1.5;
    }
    texto('Respuesta del alumno', { tam: 9.5, negrita: true, color: COLOR.gris });
    const respuesta = p.tipo === 'test' ? respuestaTest(p, perm, r) : r;
    const vacia = respuesta === null || respuesta === undefined || String(respuesta).trim() === '';
    texto(vacia ? '(en blanco)' : String(respuesta), { cursiva: vacia, color: vacia ? COLOR.gris : COLOR.marino, barra: COLOR.indigo, sangria: 1 });
    if (p.tipo === 'corta' && p.respuestas.length) {
      y += 1;
      texto(`Respuestas aceptadas: ${p.respuestas.join(' / ')}`, { tam: 9, cursiva: true, color: COLOR.gris });
    }
    if (d) {
      y += 1;
      const color = d.estado === 'correcta' ? COLOR.verde : d.estado === 'incorrecta' ? COLOR.rojo : COLOR.gris;
      texto(`${N.ESTADO_RESPUESTA[d.estado]} · ${N.numero(d.puntos)} / ${N.numero(d.max)}`, { tam: 9.5, negrita: true, color });
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

export async function zipTodos(ex, intentos, alProgreso = () => {}) {
  const [JSZip, JsPDF] = await Promise.all([jszip(), jspdf()]);
  const zip = new JSZip();
  const carpeta = N.nombreArchivo(ex.titulo);
  const usados = new Set();
  const ordenados = [...intentos].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
  for (const [i, a] of ordenados.entries()) {
    let base = N.nombreArchivo(a.nombre);
    for (let n = 2; usados.has(base); n++) base = `${N.nombreArchivo(a.nombre)}-${n}`;
    usados.add(base);
    zip.file(`${carpeta}/markdown/${base}.md`, markdownIntento(ex, a));
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    dibujarIntento(doc, ex, a);
    zip.file(`${carpeta}/pdf/${base}.pdf`, doc.output('arraybuffer'));
    alProgreso(i + 1, ordenados.length);
    await new Promise(r => setTimeout(r, 0)); // deja respirar a la página
  }
  zip.file(`${carpeta}/notas.csv`, N.generarCSV(ex, intentos));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
