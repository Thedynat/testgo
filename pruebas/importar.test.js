import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analizar, leerTexto, quitarCabeceras } from '../web/js/importar.js';

const linea = texto => ({ texto, marcada: false, lista: null, nivel: 0 });

// Mismo formato que un examen de RA con partes, casillas, líneas para responder y cabecera en cada página
const POR_PARTES = [
  [
    'MÓDULO: MONTAJE Y MANTENIMIENTO DE EQUIPOS CURSO: 26-27',
    'FECHA: 29/10/2026',
    'RA3. Mide parámetros eléctricos, identificando el tipo de señal y relacionándola con sus',
    'unidades características.',
    'PARTE I · TEST (0,5 puntos cada una; total 1 punto)',
    'Marca una sola respuesta. Las respuestas incorrectas no restan.',
    '1. ¿Qué tipo de señal tiene forma de onda senoidal?',
    '☐ a) Continua',
    '☐ b) Alterna',
    '2. ¿Qué magnitud se mide en hercios (Hz)?',
    '☐ a) Tensión',
    '☐ b) Frecuencia',
    'CFGM Sistemas Microinformáticos y Redes',
    'Pág. 1 de 2',
  ],
  [
    'PARTE II · RESPUESTA CORTA (1 punto cada una)',
    '3. Vas a medir la línea de +5 V de un conector Molex. Indica el',
    'modo y el rango que eliges.',
    '______________________________________________',
    '______________________________________________',
    'PARTE III · DESARROLLO (2 puntos)',
    '4. Explica cómo compruebas una fuente ATX. Incluye:',
    '• Las precauciones de seguridad.',
    '• El instrumento y el rango.',
    '______________________________________________',
    'PARTE IV · CASO PRÁCTICO (3 puntos)',
    '5. Un SAI pita al cortar la red y el ordenador se apaga.',
    'a) Dibuja el esquema de bloques. (1 punto)',
    '______________________________________________',
    'b) ¿Qué medirías y dónde? (2 puntos)',
    '______________________________________________',
    'CFGM Sistemas Microinformáticos y Redes',
    'Pág. 2 de 2',
  ],
].map(p => p.map(linea));

test('examen por partes: tipos, puntos, apartados y cabeceras', () => {
  const { titulo, preguntas } = analizar(quitarCabeceras(POR_PARTES));
  assert.equal(titulo, 'RA3. Mide parámetros eléctricos, identificando el tipo de señal y relacionándola con sus unidades características.');
  assert.deepEqual(preguntas.map(p => p.tipo), ['test', 'test', 'corta', 'desarrollo', 'desarrollo', 'desarrollo']);
  assert.deepEqual(preguntas.map(p => p.puntos), [0.5, 0.5, 1, 2, 1, 2]);
  assert.deepEqual(preguntas[0].opciones, ['Continua', 'Alterna'], 'sin la casilla ni la letra');
  assert.equal(preguntas[1].opciones.at(-1), 'Frecuencia', 'el pie de página no se pega a la opción');
  assert.equal(preguntas[2].enunciado, 'Vas a medir la línea de +5 V de un conector Molex. Indica el modo y el rango que eliges.');
  assert.ok(!preguntas.some(p => p.enunciado.includes('___')), 'sin las líneas para responder');
  assert.match(preguntas[3].enunciado, /\n• Las precauciones de seguridad\.\n• El instrumento y el rango\.$/);
  // El caso práctico se separa en un apartado por pregunta, con el enunciado común
  const [a, b] = preguntas.slice(4);
  assert.equal(a.grupo, b.grupo);
  assert.deepEqual([a.apartado, b.apartado], ['a', 'b']);
  assert.equal(a.contexto, 'Un SAI pita al cortar la red y el ordenador se apaga.');
  assert.equal(a.enunciado, 'Dibuja el esquema de bloques.');
  assert.equal(b.enunciado, '¿Qué medirías y dónde?');
  assert.equal(preguntas[3].grupo, undefined, 'las viñetas de "Incluye:" no son apartados');
});

test('reparte los puntos del ejercicio entre apartados que no dicen nada', () => {
  const { preguntas } = analizar(leerTexto('1. Caso práctico de redes. (3 puntos)\na) ¿Qué máscara usarías?\n_____\nb) ¿Cuántos equipos caben?\n_____\nc) Justifica la puerta de enlace.\n_____'));
  assert.equal(preguntas.length, 3);
  assert.deepEqual(preguntas.map(p => p.puntos), [1, 1, 1]);
  assert.ok(preguntas.every(p => p.contexto === 'Caso práctico de redes.'));
});

const EXAMEN = `Examen de Montaje y Mantenimiento - UD2

1. ¿Dónde se guarda el firmware UEFI? (0,5 puntos)
a) En la memoria RAM
b) En un chip de memoria flash de la placa base *
c) En el disco duro
d) En la tarjeta gráfica

2) ¿Cuántos bits tiene un byte?
A. 4
B. 8
C. 16
Solución: B

Pregunta 3: ¿Qué siglas tiene la memoria de solo lectura?
Respuesta: ROM / Read Only Memory

4. Explica para qué sirve la pasta térmica. (2 puntos)

5. ¿Qué conector usa un SSD M.2 NVMe?
[ ] SATA
[x] PCIe
[ ] IDE`;

test('separa un examen numerado en preguntas', () => {
  const { titulo, preguntas } = analizar(leerTexto(EXAMEN));
  assert.equal(titulo, 'Examen de Montaje y Mantenimiento - UD2');
  assert.equal(preguntas.length, 5);

  const [p1, p2, p3, p4, p5] = preguntas;
  assert.equal(p1.tipo, 'test');
  assert.equal(p1.enunciado, '¿Dónde se guarda el firmware UEFI?');
  assert.equal(p1.puntos, 0.5);
  assert.equal(p1.opciones.length, 4);
  assert.equal(p1.opciones[1], 'En un chip de memoria flash de la placa base');
  assert.equal(p1.correcta, 1);

  assert.equal(p2.correcta, 1, 'la solución B es la segunda opción');
  assert.deepEqual(p2.opciones, ['4', '8', '16']);

  assert.equal(p3.tipo, 'corta');
  assert.deepEqual(p3.respuestas, ['ROM', 'Read Only Memory']);

  assert.equal(p4.tipo, 'desarrollo');
  assert.equal(p4.puntos, 2);

  assert.equal(p5.correcta, 1);
  assert.deepEqual(p5.opciones, ['SATA', 'PCIe', 'IDE']);
});

test('avisa cuando no encuentra la respuesta correcta', () => {
  const { preguntas } = analizar(leerTexto('1. ¿Pregunta?\na) Uno\nb) Dos'));
  assert.equal(preguntas[0].correcta, null);
  assert.ok(preguntas[0].avisos.length);
});

test('las opciones en negrita marcan la correcta', () => {
  const lineas = [
    { texto: '1. ¿Capital de Francia?', marcada: false, lista: null, nivel: 0 },
    { texto: 'a) Madrid', marcada: false, lista: null, nivel: 0 },
    { texto: 'b) París', marcada: true, lista: null, nivel: 0 },
  ];
  assert.equal(analizar(lineas).preguntas[0].correcta, 1);
});

test('entiende las listas automáticas de Word', () => {
  const lineas = [
    { texto: 'Título', marcada: false, lista: null, nivel: 0 },
    { texto: '¿Cuántos núcleos tiene?', marcada: false, lista: 'numero', nivel: 0 },
    { texto: 'Dos', marcada: false, lista: 'numero', nivel: 1 },
    { texto: 'Cuatro', marcada: true, lista: 'numero', nivel: 1 },
    { texto: '¿Qué es la BIOS?', marcada: false, lista: 'numero', nivel: 0 },
  ];
  const { preguntas } = analizar(lineas);
  assert.equal(preguntas.length, 2);
  assert.deepEqual(preguntas[0].opciones, ['Dos', 'Cuatro']);
  assert.equal(preguntas[0].correcta, 1);
  assert.equal(preguntas[1].tipo, 'desarrollo');
});

test('sin numeración, cada texto tras unas opciones es otra pregunta', () => {
  const { preguntas } = analizar(leerTexto('Repaso\n¿Capital de Francia?\na) Madrid\nb) París\nSolución: b\n¿Color del cielo?\na) Azul *\nb) Verde'));
  assert.equal(preguntas.length, 2);
  assert.equal(preguntas[0].correcta, 1);
  assert.equal(preguntas[1].correcta, 0);
});
