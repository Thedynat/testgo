/*
 * Importar un examen desde Word (.docx), PDF o texto pegado.
 * 1. Se saca el texto línea a línea, con lo que se pueda saber del formato (negrita, listas numeradas...).
 * 2. Se separa en preguntas: numeración, opciones a) b) c), "Solución: b", puntos entre paréntesis...
 * El profesor lo revisa todo antes de importarlo.
 */
import { ErrorTestGO, normalizar, limpiarPregunta, nuevoId } from './nucleo.js';
import { jszip, pdfjs } from './librerias.js';

// Una línea: { texto, marcada, lista: 'numero' | 'letra' | 'vineta' | null, nivel }

export async function leerArchivo(archivo) {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.docx')) return leerWord(await archivo.arrayBuffer());
  if (nombre.endsWith('.pdf')) return leerPDF(await archivo.arrayBuffer());
  if (nombre.endsWith('.txt') || nombre.endsWith('.md')) return leerTexto(await archivo.text());
  if (nombre.endsWith('.doc')) throw new ErrorTestGO(400, 'Los .doc antiguos no se pueden leer. Ábrelo en Word y guárdalo como .docx.');
  throw new ErrorTestGO(400, 'Sube un archivo de Word (.docx) o un PDF.');
}

export const leerTexto = texto => String(texto).split(/\r?\n/).map(t => ({ texto: t, marcada: false, lista: null, nivel: 0 }));

// ---------- Word ----------

async function leerWord(datos) {
  const JSZip = await jszip();
  let zip;
  try {
    zip = await JSZip.loadAsync(datos);
  } catch {
    throw new ErrorTestGO(400, 'El archivo no es un .docx válido.');
  }
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new ErrorTestGO(400, 'El archivo no es un .docx válido.');
  const formatos = leerNumeracion(await zip.file('word/numbering.xml')?.async('string'));
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const lineas = [];

  for (const p of doc.getElementsByTagName('w:p')) {
    let texto = '';
    let marcado = 0;
    let total = 0;
    for (const r of p.getElementsByTagName('w:r')) {
      let trozo = '';
      for (const n of r.childNodes) {
        if (n.nodeName === 'w:t') trozo += n.textContent;
        else if (n.nodeName === 'w:tab') trozo += ' ';
        else if (n.nodeName === 'w:br' || n.nodeName === 'w:cr') trozo += '\n';
        else if (n.nodeName === 'w:sym') trozo += simbolo(n.getAttribute('w:char'));
      }
      texto += trozo;
      const visibles = trozo.replace(/\s/g, '').length;
      total += visibles;
      if (visibles && runMarcado(r)) marcado += visibles;
    }
    const numPr = p.getElementsByTagName('w:numPr')[0];
    let lista = null;
    let nivel = 0;
    if (numPr) {
      const numId = numPr.getElementsByTagName('w:numId')[0]?.getAttribute('w:val');
      nivel = Number(numPr.getElementsByTagName('w:ilvl')[0]?.getAttribute('w:val') || 0);
      const fmt = formatos[numId]?.[nivel];
      if (numId !== '0') lista = /letter/i.test(fmt) ? 'letra' : fmt === 'bullet' ? 'vineta' : 'numero';
    }
    // Un salto de línea dentro del párrafo separa líneas, pero solo la primera lleva la numeración
    texto.split('\n').forEach((t, i) => lineas.push({ texto: t, marcada: total > 0 && marcado / total >= 0.8, lista: i ? null : lista, nivel }));
  }
  return lineas;
}

// numId -> nivel -> formato (decimal, lowerLetter, bullet...)
function leerNumeracion(xml) {
  if (!xml) return {};
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const abstractos = {};
  for (const a of doc.getElementsByTagName('w:abstractNum')) {
    const niveles = {};
    for (const lvl of a.getElementsByTagName('w:lvl')) {
      niveles[lvl.getAttribute('w:ilvl')] = lvl.getElementsByTagName('w:numFmt')[0]?.getAttribute('w:val') || 'decimal';
    }
    abstractos[a.getAttribute('w:abstractNumId')] = niveles;
  }
  const formatos = {};
  for (const n of doc.getElementsByTagName('w:num')) {
    const abs = n.getElementsByTagName('w:abstractNumId')[0]?.getAttribute('w:val');
    formatos[n.getAttribute('w:numId')] = abstractos[abs] || {};
  }
  return formatos;
}

const activo = el => el && !['0', 'false', 'none'].includes(el.getAttribute('w:val'));

function runMarcado(r) {
  const pr = r.getElementsByTagName('w:rPr')[0];
  if (!pr) return false;
  const shd = pr.getElementsByTagName('w:shd')[0]?.getAttribute('w:fill');
  return activo(pr.getElementsByTagName('w:b')[0]) || activo(pr.getElementsByTagName('w:u')[0]) || activo(pr.getElementsByTagName('w:highlight')[0]) || (!!shd && !/^(auto|FFFFFF)$/i.test(shd));
}

// Casillas de Wingdings/Symbol que se usan para marcar la respuesta
function simbolo(codigo) {
  const c = String(codigo || '').toUpperCase();
  if (['F0FE', 'F078', 'F0FD', 'F0FC'].includes(c)) return '☒';
  if (['F0A8', 'F06F', 'F071'].includes(c)) return '☐';
  return '';
}

// ---------- PDF ----------

async function leerPDF(datos) {
  const pdf = await pdfjs();
  let documento;
  try {
    documento = await pdf.getDocument({ data: new Uint8Array(datos), isEvalSupported: false }).promise;
  } catch (e) {
    throw new ErrorTestGO(400, e?.name === 'PasswordException' ? 'El PDF tiene contraseña. Quítasela y vuelve a subirlo.' : 'No se ha podido leer el PDF.');
  }
  const paginas = [];
  for (let n = 1; n <= documento.numPages; n++) {
    const pagina = await documento.getPage(n);
    const contenido = await pagina.getTextContent();
    paginas.push(lineasDePagina(contenido.items, await fuentesNegrita(pagina, contenido)));
  }
  const lineas = quitarCabeceras(paginas);
  if (!lineas.some(l => l.texto.trim())) {
    throw new ErrorTestGO(400, 'Este PDF no tiene texto: parece un documento escaneado. Súbelo en Word o en un PDF generado desde Word.');
  }
  return lineas;
}

// Junta los trozos de texto de una página de pdf.js en líneas
export function lineasDePagina(items, negritas = new Set()) {
  const lineas = [];
  let actual = null;
  for (const item of items) {
    if (!('str' in item)) continue;
    const y = item.transform[5];
    const alto = Math.abs(item.transform[3]) || 10;
    if (!actual || Math.abs(y - actual.y) > alto * 0.5) {
      if (actual) lineas.push(cerrarLinea(actual));
      actual = { y, trozos: [] };
    }
    actual.trozos.push({ x: item.transform[4], texto: item.str, negrita: negritas.has(item.fontName), ancho: item.width });
    if (item.hasEOL) {
      lineas.push(cerrarLinea(actual));
      actual = null;
    }
  }
  if (actual) lineas.push(cerrarLinea(actual));
  return lineas.filter(l => l.texto.trim());
}

const RE_NUMERO_PAGINA = /^(?:p[áa]g(?:ina)?\.?\s*)?\d+\s*(?:de|\/)\s*\d+$|^p[áa]g(?:ina)?\.?\s*\d+$/i;

// Quita la cabecera y el pie que se repiten en cada página, y los números de página
export function quitarCabeceras(paginas) {
  const BORDE = 8;
  const veces = new Map();
  if (paginas.length > 1) {
    for (const pagina of paginas) {
      const bordes = new Set([...pagina.slice(0, BORDE), ...pagina.slice(-BORDE)].map(l => normalizar(l.texto)));
      for (const t of bordes) veces.set(t, (veces.get(t) || 0) + 1);
    }
  }
  const repetida = (l, i, total) => (i < BORDE || i >= total - BORDE) && (veces.get(normalizar(l.texto)) || 0) >= 2 && !RE_HUECO.test(l.texto);
  const lineas = [];
  for (const pagina of paginas) {
    pagina.forEach((l, i) => {
      if (repetida(l, i, pagina.length) || RE_NUMERO_PAGINA.test(l.texto.trim())) return;
      lineas.push(l);
    });
  }
  return lineas;
}

function cerrarLinea({ trozos }) {
  trozos.sort((a, b) => a.x - b.x);
  let texto = '';
  let fin = null;
  let negrita = 0;
  let total = 0;
  for (const t of trozos) {
    if (fin !== null && t.x - fin > 1.5 && !texto.endsWith(' ') && !t.texto.startsWith(' ')) texto += ' ';
    texto += t.texto;
    fin = t.x + (t.ancho || 0);
    const visibles = t.texto.replace(/\s/g, '').length;
    total += visibles;
    if (t.negrita) negrita += visibles;
  }
  return { texto, marcada: total > 0 && negrita / total >= 0.8, lista: null, nivel: 0 };
}

async function fuentesNegrita(pagina, contenido) {
  const negritas = new Set();
  try {
    await pagina.getOperatorList();
    for (const id of new Set(contenido.items.map(i => i.fontName))) {
      const fuente = pagina.commonObjs.has(id) ? pagina.commonObjs.get(id) : null;
      if (/bold|black|heavy|semibold/i.test(fuente?.name || '')) negritas.add(id);
    }
  } catch {}
  return negritas;
}

// ---------- Separar en preguntas ----------

const RE_PREGUNTA = /^(?:(?:pregunta|ejercicio|cuesti[oó]n)\s*)?(\d{1,3})\s*(?:[.)\-:ºª]|\s-\s)\s*(.*)$/i;
const RE_PREGUNTA_SOLA = /^(?:pregunta|ejercicio|cuesti[oó]n)\s*(\d{1,3})\s*[.:]?\s*(.*)$/i;
const RE_OPCION_LETRA = /^\(?\s*([a-hA-H])\s*[).:\-]\s*(.+)$/;
const RE_OPCION_CASILLA = /^(\[\s*[xX✓✔ ]?\s*\]|[☐☒☑■□○●◯])\s*(.*)$/;
const RE_VINETA = /^[•▪◦\-–]\s+(.*)$/;
const RE_SOLUCION = /^(?:respuesta(?:\s+correcta)?|soluci[oó]n|correcta|clave)\s*[:=]\s*(.+)$/i;
const RE_PUNTOS = /\(\s*(\d+(?:[.,]\d+)?)\s*(?:puntos?|ptos?\.?|pts?\.?|p)\s*\)/i;
const RE_MARCA = /^\s*(\*|\(x\)|\[x\]|✓|✔|☒|☑|■|●)\s*|\s*(\*|\(x\)|\[x\]|✓|✔)\s*$/i;
const RE_DESARROLLO = /\b(explica|describe|razona|desarrolla|justifica|compara|define|comenta|analiza|enumera|indica|incluye)\b/i;
// Líneas para escribir la respuesta: "_______", "........"
const RE_HUECO = /^[\s_.\-–—…·]{5,}$/;
// "PARTE II · RESPUESTA CORTA (1 punto cada una)", "Bloque 2: Desarrollo"
const RE_SECCION = /^(?:parte|bloque|secci[oó]n)\s+(?:[IVXLC]+|\d{1,2}|[A-Z])(?=[\s.:·\-–—]|$)[\s.:·\-–—]*(.*)$/i;
// "MÓDULO: ...", "FECHA: ...", "ALUMNO:": datos de la cabecera, no el título
const RE_ETIQUETA = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .]{1,30}:/;

const numeroDe = texto => Number(String(texto).replace(',', '.'));
const LETRA = i => String.fromCharCode(97 + i);

function tipoSeccion(texto) {
  if (/\btest\b|opci[oó]n m[uú]ltiple|elecci[oó]n m[uú]ltiple/i.test(texto)) return 'test';
  if (/respuestas? cortas?|preguntas? cortas?/i.test(texto)) return 'corta';
  if (/desarrollo|caso pr[aá]ctico|supuesto|problema|ensayo/i.test(texto)) return 'desarrollo';
  return null;
}

function puntosSeccion(texto) {
  const cada = texto.match(/(\d+(?:[.,]\d+)?)\s*(?:puntos?|ptos?\.?|pts?\.?)\s*(?:cada\s+una|cada\s+pregunta|por\s+pregunta|c\/u)/i);
  const total = texto.match(/total\s*(?:de\s*)?:?\s*(\d+(?:[.,]\d+)?)/i) || texto.match(RE_PUNTOS);
  return { cada: cada ? numeroDe(cada[1]) : null, total: total ? numeroDe(total[1]) : null };
}

// Una línea cortada a mitad de frase (típico del PDF) sigue en la misma línea
const unir = (previo, t) => (/[.:?!;)]$/.test(previo) || !/^[a-zà-ÿ(]/.test(t) ? '\n' : ' ');

const esTitulo = t => !RE_ETIQUETA.test(t) && !/^[a-zà-ÿ]/.test(t) && !RE_HUECO.test(t);

// libre: el documento no numera las preguntas; cada texto que va después de unas opciones empieza otra
export function analizar(lineas, libre = false) {
  const preguntas = [];
  const secciones = [];
  let titulo = '';
  let actual = null;
  let seccion = null;

  const nueva = enunciado => {
    actual = { enunciado: enunciado || '', opciones: [], solucion: null, huecos: 0, seccion };
    preguntas.push(actual);
  };

  for (const linea of lineas) {
    const t = linea.texto.replace(/[  ]+/g, ' ').trim();
    if (!t) continue;

    if (RE_HUECO.test(t)) {
      if (actual) (actual.opciones.at(-1) || actual).huecos += 1;
      continue;
    }

    const sec = t.match(RE_SECCION);
    if (sec) {
      seccion = { tipo: tipoSeccion(t), ...puntosSeccion(t) };
      secciones.push(seccion);
      actual = null; // lo que venga hasta la siguiente pregunta son instrucciones
      continue;
    }

    const sol = t.match(RE_SOLUCION);
    if (sol && actual) {
      actual.solucion = sol[1].trim();
      continue;
    }

    const opcion = leerOpcion(linea, t, actual);
    if (opcion) {
      actual.opciones.push(opcion);
      continue;
    }

    const preg = linea.lista === 'numero' && linea.nivel === 0 ? [null, null, t] : t.match(RE_PREGUNTA) || t.match(RE_PREGUNTA_SOLA);
    if (preg) {
      nueva(preg[2]);
      continue;
    }

    if (libre && (!actual || actual.opciones.length || actual.solucion)) {
      if (!actual && !titulo && !t.endsWith('?')) titulo = esTitulo(t) ? t : '';
      else nueva(t);
      continue;
    }

    if (!actual) {
      if (!titulo && esTitulo(t)) titulo = t;
      else if (titulo && !seccion && !preguntas.length && unir(titulo, t) === ' ') titulo += ` ${t}`;
      continue;
    }
    // Continuación de la última opción o del enunciado
    if (actual.opciones.length) actual.opciones.at(-1).texto += ` ${t}`;
    else actual.enunciado += actual.enunciado ? `${unir(actual.enunciado, t)}${t}` : t;
  }

  if (!libre && !preguntas.length) return analizar(lineas, true);

  const convertidas = preguntas.flatMap(b => [].concat(convertir(b)).map(p => ({ b, p }))).filter(({ p }) => p.enunciado || p.opciones?.length);
  repartirPuntos(convertidas, secciones);
  return {
    titulo,
    preguntas: convertidas.map(({ p: { avisos, ...p } }) => ({ ...limpiarPregunta({ ...p, puntos: p.puntos ?? 1 }), avisos })),
  };
}

function leerOpcion(linea, t, actual) {
  if (!actual) return null;
  let m;
  const opcion = (texto, fuerte, marcada = linea.marcada) => ({ texto, fuerte, marcada, huecos: 0 });
  if (linea.lista === 'letra' || (linea.lista && linea.nivel > 0)) return opcion(t, true);
  if (linea.lista === 'vineta') return opcion(t, false);
  if ((m = t.match(RE_OPCION_CASILLA))) {
    // "☐ a) Osciloscopio": la casilla y la letra sobran
    const resto = m[2].match(RE_OPCION_LETRA);
    return opcion(resto ? resto[2] : m[2], true, /[xX✓✔☒☑■●]/.test(m[1]) || linea.marcada);
  }
  if ((m = t.match(RE_OPCION_LETRA))) return opcion(m[2], true);
  if ((m = t.match(RE_VINETA)) && actual.opciones.length) return opcion(m[1], false);
  return null;
}

function sacarPuntos(texto) {
  const m = texto.match(RE_PUNTOS);
  return m ? numeroDe(m[1]) : null;
}

function convertir(bruta) {
  const avisos = [];
  let enunciado = bruta.enunciado.trim();
  let puntos = sacarPuntos(enunciado);
  if (puntos !== null) enunciado = enunciado.replace(RE_PUNTOS, '').replace(/[ \t]{2,}/g, ' ').trim();
  const tipoSec = bruta.seccion?.tipo;

  // Marcas escritas a mano: "*", "(x)", "✔"...
  const opciones = bruta.opciones.map(o => ({
    texto: o.texto.replace(RE_MARCA, '').trim(),
    marcada: o.marcada,
    escrita: RE_MARCA.test(o.texto),
    fuerte: o.fuerte,
    huecos: o.huecos,
    puntos: sacarPuntos(o.texto),
  }));

  // a), b), c) que son apartados de una pregunta de desarrollo y no opciones de test
  const apartados = opciones.length > 0 && (
    tipoSec === 'desarrollo' || tipoSec === 'corta' ||
    opciones.some(o => o.huecos > 0 || o.puntos !== null) ||
    (!opciones.some(o => o.fuerte) && RE_DESARROLLO.test(enunciado))
  );

  if (opciones.length >= 2 && !apartados) {
    let correcta = null;
    const escritas = opciones.flatMap((o, i) => (o.escrita ? [i] : []));
    const formato = opciones.flatMap((o, i) => (o.marcada ? [i] : []));
    if (escritas.length === 1) correcta = escritas[0];
    else if (formato.length === 1) correcta = formato[0];
    else if (bruta.solucion) {
      const letra = bruta.solucion.match(/^\(?([a-hA-H])\)?(?:[).\s]|$)/);
      if (letra) correcta = letra[1].toLowerCase().charCodeAt(0) - 97;
      else {
        const i = opciones.findIndex(o => normalizar(o.texto) === normalizar(bruta.solucion));
        if (i >= 0) correcta = i;
      }
      if (correcta !== null && correcta >= opciones.length) correcta = null;
    }
    if (correcta === null) avisos.push('No se ha encontrado cuál es la respuesta correcta: márcala tú.');
    if (formato.length > 1 && escritas.length !== 1) avisos.push('Había varias opciones en negrita o subrayadas.');
    const vf = opciones.length === 2 && /^v(erdadero)?\.?$/i.test(opciones[0].texto) && /^f(also)?\.?$/i.test(opciones[1].texto);
    if (vf) return { tipo: 'vf', enunciado, puntos, correcta, avisos: avisos.map(t => t.replace('cuál es la respuesta correcta', 'si es verdadera o falsa')) };
    return { tipo: 'test', enunciado, puntos, opciones: opciones.map(o => o.texto), correcta, avisos };
  }

  // Ejercicio con apartados a), b), c): una pregunta por apartado, con el enunciado común encima
  if (apartados && opciones.length >= 2 && opciones.every(o => o.fuerte)) {
    const grupo = nuevoId();
    const reparto = puntos !== null && opciones.every(o => o.puntos === null) ? Math.round((puntos / opciones.length) * 100) / 100 : null;
    const tipo = tipoSec === 'corta' ? 'corta' : 'desarrollo';
    return opciones.map((o, j) => ({
      tipo,
      enunciado: o.texto.replace(RE_PUNTOS, '').replace(/[ \t]{2,}/g, ' ').trim(),
      puntos: o.puntos ?? reparto,
      grupo,
      apartado: LETRA(j),
      contexto: enunciado,
      ...(tipo === 'corta' ? { respuestas: [] } : {}),
      avisos: tipo === 'corta' ? ['No tiene respuestas aceptadas: añádelas o se corregirá a mano.'] : [],
    }));
  }

  if (opciones.length) {
    enunciado += '\n' + opciones.map((o, j) => `${o.fuerte ? `${LETRA(j)}) ` : '• '}${o.texto}`).join('\n');
    if (puntos === null && opciones.some(o => o.puntos !== null)) puntos = opciones.reduce((s, o) => s + (o.puntos || 0), 0);
    if (opciones.length === 1 && !apartados) avisos.push('Tenía una sola opción: se ha añadido al enunciado.');
  }

  if (bruta.solucion && (tipoSec === 'corta' || !RE_DESARROLLO.test(enunciado))) {
    return { tipo: 'corta', enunciado, puntos, respuestas: bruta.solucion.split(/\s*[/;|]\s*/).filter(Boolean), avisos };
  }
  if (tipoSec === 'corta' && !opciones.length) {
    avisos.push('No tiene respuestas aceptadas: añádelas o se corregirá a mano.');
    return { tipo: 'corta', enunciado, puntos, respuestas: [], avisos };
  }
  return { tipo: 'desarrollo', enunciado, puntos, avisos };
}

// "(0,5 puntos cada una)" o "(total 3 puntos)" en el título de la parte, para las preguntas que no dicen nada
function repartirPuntos(convertidas, secciones) {
  for (const sec of secciones) {
    const de = convertidas.filter(x => x.b.seccion === sec);
    const sin = de.filter(x => x.p.puntos === null);
    if (!sin.length) continue;
    if (sec.cada !== null) {
      sin.forEach(x => (x.p.puntos = sec.cada));
    } else if (sec.total !== null) {
      const usados = de.reduce((s, x) => s + (x.p.puntos || 0), 0);
      const resto = sec.total - usados;
      if (resto > 0) sin.forEach(x => (x.p.puntos = Math.round((resto / sin.length) * 100) / 100));
    }
  }
}

// ---------- Formato TestGO para importar con ayuda de una IA ----------
// El profesor copia este prompt, se lo da a una IA con su examen y pega aquí el JSON que le devuelve.

export function promptIA({ resolver = true } = {}) {
  return `Convierte el examen que te adjunto (o que pego al final) al formato de importación de TestGO.

Responde SOLO con un bloque de código \`\`\`json, sin explicaciones antes ni después, con esta estructura exacta:

{
  "testgo": 1,
  "titulo": "Título del examen",
  "preguntas": [
    {
      "tipo": "test",
      "enunciado": "¿Cuántos bits tiene un byte?",
      "puntos": 0.5,
      "opciones": ["4", "8", "16"],
      "correcta": "b"
    },
    {
      "tipo": "corta",
      "enunciado": "¿Qué siglas tiene la memoria de solo lectura?",
      "puntos": 1,
      "respuestas": ["ROM", "Read Only Memory"]
    },
    {
      "tipo": "desarrollo",
      "enunciado": "Explica para qué sirve la pasta térmica.",
      "puntos": 2
    },
    {
      "enunciado": "En el aula hay un SAI conectado a un ordenador. Al cortar la red, el SAI pita y el ordenador se apaga.",
      "apartados": [
        { "tipo": "desarrollo", "enunciado": "Dibuja el esquema de bloques de un SAI.", "puntos": 1 },
        { "tipo": "corta", "enunciado": "¿Qué tensión debería dar la salida del SAI?", "puntos": 0.5, "respuestas": ["230 V", "230"] }
      ]
    }
  ]
}

Reglas:
1. "tipo" solo puede ser uno de estos (los campos que lleva cada uno van entre paréntesis):
   - "test": elegir UNA opción entre varias ("opciones" y "correcta": "b").
   - "vf": verdadero o falso ("correcta": "verdadero" o "falso"; sin "opciones").
   - "multiple": hay VARIAS opciones correctas ("opciones" y "correctas": ["a", "c"]).
   - "corta": la respuesta es una palabra o una frase muy breve que se puede comprobar ("respuestas").
   - "numerica": la respuesta es un número ("valor": 12, "tolerancia": 5 si se acepta un margen del 5 %, o "tolerancia_abs": 0.5 para ±0,5; y "unidad": "V" si la tiene).
   - "relacionar": unir elementos de dos columnas ("pares": [["CPU", "Procesa los datos"], ["RAM", "Memoria temporal"]], cada pareja con el elemento de la izquierda y su pareja correcta).
   - "desarrollo": explicar, justificar, razonar o casos prácticos. Si el examen indica criterios de corrección, añádelos: "criterios": [{"texto": "Menciona la seguridad", "puntos": 0.5}].
2. Copia los enunciados y las opciones tal cual están en el examen, sin resumir, corregir ni traducir. No inventes preguntas, no te saltes ninguna y respeta el orden.
3. En "opciones" escribe solo el texto de cada opción, sin la letra ni la casilla (nada de "a)", "B." o "☐").
4. "correcta" es la letra de la opción correcta: "a" para la primera, "b" para la segunda, y así.
5. ${resolver
    ? 'Si el examen no indica la respuesta correcta, resuélvela tú. En las de tipo "corta", pon en "respuestas" todas las formas válidas de escribirla (siglas, nombre completo, con y sin unidades).'
    : 'Si el examen no indica la respuesta correcta, pon "correcta": null en las de test y "respuestas": [] en las cortas. No las resuelvas tú.'}
6. "puntos" es un número con punto decimal (0.5, no 0,5). Usa los que indique el examen para cada pregunta; si una parte dice "0,5 puntos cada una", ponlo en cada pregunta de esa parte. Si no dice nada, pon 1.
7. Si un ejercicio tiene apartados (a, b, c...), escríbelo como el último ejemplo: el texto común en "enunciado" y cada apartado dentro de "apartados" como una pregunta más, con su "tipo", su "enunciado" (sin la letra) y sus "puntos". No repitas los apartados dentro del enunciado común. Las viñetas que solo detallan qué incluir en la respuesta ("Incluye: • … • …") no son apartados: déjalas dentro del enunciado.
8. No incluyas las líneas para escribir la respuesta (____ o ....), las cabeceras y pies de página, el nombre del alumno, la fecha ni las instrucciones generales del examen.
9. El JSON tiene que ser válido: comillas dobles, sin comas al final de las listas y los saltos de línea dentro de un texto escritos como \\n.
`;
}

const TIPOS_IA = {
  test: 'test', tipo_test: 'test', opcion_multiple: 'test', eleccion: 'test', una_correcta: 'test',
  vf: 'vf', verdadero_falso: 'vf', verdaderofalso: 'vf', true_false: 'vf',
  multiple: 'multiple', varias: 'multiple', varias_correctas: 'multiple', multirespuesta: 'multiple', seleccion_multiple: 'multiple',
  numerica: 'numerica', numero: 'numerica', calculo: 'numerica',
  relacionar: 'relacionar', emparejar: 'relacionar', unir: 'relacionar', relacion: 'relacionar', columnas: 'relacionar',
  corta: 'corta', respuesta_corta: 'corta', short: 'corta', breve: 'corta', completar: 'corta',
  desarrollo: 'desarrollo', abierta: 'desarrollo', larga: 'desarrollo', caso: 'desarrollo', caso_practico: 'desarrollo', ensayo: 'desarrollo', essay: 'desarrollo',
};

// ¿Lo pegado es el JSON de una IA y no el texto de un examen?
export const pareceFormatoIA = texto => /^\s*(```|\{|\[)/.test(texto) && /"preguntas"|"enunciado"/.test(texto);

function sacarJSON(texto) {
  let t = String(texto).replace(/^﻿/, '');
  const bloque = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (bloque) t = bloque[1];
  const inicio = t.search(/[{[]/);
  const fin = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (inicio < 0 || fin < inicio) throw new ErrorTestGO(400, 'No se ha encontrado el código. Pega la respuesta completa de la IA (el bloque que empieza por { ).');
  t = t.slice(inicio, fin + 1);
  try {
    return JSON.parse(t);
  } catch {
    // Arreglos para los fallos típicos: comillas tipográficas y comas sobrantes
    const arreglado = t.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(arreglado);
    } catch (e) {
      throw new ErrorTestGO(400, `El código que ha devuelto la IA tiene un error (${e.message}). Pídele que lo revise y responda solo con JSON válido.`);
    }
  }
}

const textoDe = v => (v === null || v === undefined ? '' : String(v)).trim();
const quitarLetra = t => textoDe(t).replace(/^(?:[☐☒☑□■]\s*)?\(?\s*[a-hA-H]\s*[).:-]\s+/, '');

function indiceCorrecta(valor, opciones) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isInteger(valor) && valor >= 0 && valor < opciones.length ? valor : null;
  const t = textoDe(valor);
  const letra = t.match(/^\(?([a-hA-H])\)?\.?$/);
  if (letra) {
    const i = letra[1].toLowerCase().charCodeAt(0) - 97;
    return i < opciones.length ? i : null;
  }
  if (/^\d+$/.test(t)) {
    const i = Number(t);
    return i < opciones.length ? i : null;
  }
  const i = opciones.findIndex(o => normalizar(o) === normalizar(quitarLetra(t)));
  return i >= 0 ? i : null;
}

export function leerRespuestaIA(texto) {
  const datos = sacarJSON(texto);
  const lista = Array.isArray(datos) ? datos : datos.preguntas;
  if (!Array.isArray(lista) || !lista.length) throw new ErrorTestGO(400, 'El código no tiene ninguna pregunta.');
  const preguntas = lista.flatMap((q, n) => {
    const subs = Array.isArray(q?.apartados) ? q.apartados.filter(s => s && typeof s === 'object') : [];
    if (!subs.length) return [leerPreguntaIA(q, n)];
    // Ejercicio con apartados: una pregunta por apartado con el enunciado común
    const grupo = nuevoId();
    const contexto = textoDe(q.enunciado ?? q.contexto ?? q.pregunta);
    const total = Number(String(q.puntos ?? '').replace(',', '.'));
    const reparto = subs.every(s => s.puntos === undefined || s.puntos === null) && total > 0 ? Math.round((total / subs.length) * 100) / 100 : undefined;
    return subs.map((s, j) => leerPreguntaIA({ ...s, puntos: s.puntos ?? reparto }, n, {
      grupo,
      apartado: textoDe(s.apartado).toLowerCase().replace(/[^a-z0-9]/g, '') || LETRA(j),
      contexto,
    }));
  });
  return { titulo: textoDe(datos.titulo), preguntas };
}

function leerPreguntaIA(q, n, extra = {}) {
  const avisos = [];
  const original = textoDe(q.tipo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_');
  const opciones = (Array.isArray(q.opciones) ? q.opciones : []).map(o => quitarLetra(typeof o === 'object' && o ? o.texto ?? o.text : o)).filter(Boolean);
  let tipo = TIPOS_IA[original] || (q.pares ? 'relacionar' : q.valor !== undefined ? 'numerica' : opciones.length >= 2 ? 'test' : q.respuestas ? 'corta' : 'desarrollo');
  // Un test con exactamente "Verdadero / Falso" es de verdadero o falso
  if (tipo === 'test' && opciones.length === 2 && /^v(erdadero)?$/i.test(opciones[0]) && /^f(also)?$/i.test(opciones[1])) tipo = 'vf';
  if ((tipo === 'test' || tipo === 'multiple') && opciones.length < 2) {
    tipo = 'desarrollo';
    avisos.push('Venía con opciones pero no tenía al menos dos: se ha puesto como desarrollo.');
  }
  const puntos = Number(String(q.puntos ?? 1).replace(',', '.'));
  if (!Number.isFinite(puntos)) avisos.push('Los puntos no eran un número: se ha puesto 1.');
  const base = { ...extra, tipo, enunciado: textoDe(q.enunciado ?? q.pregunta), puntos: Number.isFinite(puntos) ? puntos : 1 };
  if (!base.enunciado) avisos.push(`La pregunta ${n + 1} venía sin enunciado.`);
  if (tipo === 'test') {
    const correcta = indiceCorrecta(q.correcta ?? q.solucion ?? q.respuesta, opciones);
    if (correcta === null) avisos.push('No trae la respuesta correcta: márcala tú.');
    return { ...limpiarPregunta({ ...base, opciones, correcta }), avisos };
  }
  if (tipo === 'vf') {
    const v = q.correcta ?? q.solucion ?? q.respuesta;
    const t = normalizar(v);
    // También vale la letra si venía como test con las opciones "Verdadero" (a) y "Falso" (b)
    const correcta = v === true || v === 0 || /^(v|verdadero|true|cierto|si|a)$/.test(t) ? 0 : v === false || v === 1 || /^(f|falso|false|no|b)$/.test(t) ? 1 : null;
    if (correcta === null) avisos.push('No trae si es verdadera o falsa: márcalo tú.');
    return { ...limpiarPregunta({ ...base, correcta }), avisos };
  }
  if (tipo === 'multiple') {
    const lista = q.correctas ?? q.correcta ?? q.soluciones ?? q.respuestas ?? [];
    const correctas = (Array.isArray(lista) ? lista : [lista]).map(v => indiceCorrecta(v, opciones)).filter(i => i !== null);
    if (!correctas.length) avisos.push('No trae las respuestas correctas: márcalas tú.');
    return { ...limpiarPregunta({ ...base, opciones, correctas }), avisos };
  }
  if (tipo === 'numerica') {
    const valor = Number(String(q.valor ?? q.solucion ?? q.respuesta ?? '').replace(',', '.').replace(/[^\d.\-eE]/g, ''));
    const abs = q.tolerancia_abs ?? q.margen_abs;
    const datos = { ...base, valor: Number.isFinite(valor) && String(q.valor ?? q.solucion ?? q.respuesta ?? '').trim() ? valor : null, unidad: textoDe(q.unidad) };
    if (abs !== undefined) Object.assign(datos, { tolerancia: abs, modoTolerancia: 'abs' });
    else if (q.tolerancia !== undefined) Object.assign(datos, { tolerancia: q.tolerancia, modoTolerancia: '%' });
    if (datos.valor === null) avisos.push('No trae el valor correcto: escríbelo tú.');
    return { ...limpiarPregunta(datos), avisos };
  }
  if (tipo === 'relacionar') {
    // [["CPU", "Procesa"], ...], [{"izq": "CPU", "der": "Procesa"}, ...] o {"izquierda": [...], "derecha": [...]}
    let pares = [];
    if (Array.isArray(q.pares)) pares = q.pares.map(x => (Array.isArray(x) ? { izq: x[0], der: x[1] } : { izq: x?.izq ?? x?.izquierda, der: x?.der ?? x?.derecha }));
    else if (Array.isArray(q.izquierda) && Array.isArray(q.derecha)) pares = q.izquierda.map((izq, i) => ({ izq, der: q.derecha[i] }));
    pares = pares.map(x => ({ izq: textoDe(x.izq), der: textoDe(x.der) })).filter(x => x.izq || x.der);
    if (pares.length < 2) avisos.push('Necesita al menos dos parejas: revísalas.');
    return { ...limpiarPregunta({ ...base, pares }), avisos };
  }
  if (tipo === 'corta') {
    const r = q.respuestas ?? q.respuesta ?? q.solucion;
    const respuestas = (Array.isArray(r) ? r : textoDe(r).split(/\s*[/;|]\s*/)).map(textoDe).filter(Boolean);
    if (!respuestas.length) avisos.push('No tiene respuestas aceptadas: añádelas o se corregirá a mano.');
    return { ...limpiarPregunta({ ...base, respuestas }), avisos };
  }
  const criterios = (Array.isArray(q.criterios) ? q.criterios : [])
    .map(c => (typeof c === 'string' ? { texto: c, puntos: 0 } : { texto: textoDe(c?.texto ?? c?.criterio), puntos: Number(String(c?.puntos ?? 0).replace(',', '.')) || 0 }))
    .filter(c => c.texto);
  return { ...limpiarPregunta({ ...base, criterios }), avisos };
}
