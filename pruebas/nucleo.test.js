import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../web/js/nucleo.js';

const examen = preguntas => N.limpiarExamen({ barajar: false, penalizacion: 0.25, preguntas });
const intento = (ex, respuestas, extra = {}) => ({
  orden: N.generarOrden(ex, 'semilla'),
  respuestas: N.limpiarRespuestas(ex.preguntas, N.generarOrden(ex, 'semilla'), respuestas),
  ...extra,
});

test('por defecto se bloquea a la primera salida y sin marca de agua', () => {
  const ex = N.limpiarExamen({});
  assert.equal(ex.maxSalidas, 1);
  assert.equal(ex.marcaAgua, false);
  const a = { estado: 'en_curso', inicio: 1, salidas: 0, baseSalidas: 0 };
  assert.equal(N.efectoIncidencia(a, ex.maxSalidas, 'salida', 'Cambió de pestaña', 2).cambios.estado, 'bloqueado');
});

test('verdadero o falso: acierto y fallo con penalización', () => {
  const ex = examen([{ tipo: 'vf', enunciado: 'La RAM es volátil', correcta: 0 }]);
  const [p] = ex.preguntas;
  assert.deepEqual(p.opciones, ['Verdadero', 'Falso']);
  assert.equal(N.corregir(ex, intento(ex, { [p.id]: 0 })).detalle[p.id].estado, 'correcta');
  assert.equal(N.corregir(ex, intento(ex, { [p.id]: 1 })).detalle[p.id].puntos, -0.25);
});

test('varias correctas: las buenas suman, las malas restan y nunca baja de 0', () => {
  const ex = examen([{ tipo: 'multiple', enunciado: 'Periféricos de entrada', opciones: ['Teclado', 'Monitor', 'Ratón', 'Impresora'], correctas: [0, 2], puntos: 2 }]);
  const [p] = ex.preguntas;
  const nota = r => N.corregir(ex, intento(ex, { [p.id]: r })).detalle[p.id];
  assert.deepEqual(nota([0, 2]), { puntos: 2, max: 2, estado: 'correcta' });
  assert.deepEqual(nota([0]), { puntos: 1, max: 2, estado: 'parcial' });
  assert.deepEqual(nota([0, 2, 3]), { puntos: 1, max: 2, estado: 'parcial' });
  assert.deepEqual(nota([1, 3]), { puntos: 0, max: 2, estado: 'incorrecta' });
});

test('numérica: acepta el margen en % o en unidades y la coma decimal', () => {
  const ex = examen([
    { tipo: 'numerica', enunciado: 'Línea amarilla', valor: 12, tolerancia: 5, unidad: 'V' },
    { tipo: 'numerica', enunciado: 'Ohmios', valor: 220, tolerancia: 10, modoTolerancia: 'abs' },
  ]);
  const [pct, abs] = ex.preguntas;
  const estado = (p, r) => N.corregir(ex, intento(ex, { [p.id]: r })).detalle[p.id].estado;
  assert.deepEqual(N.rangoNumerica(pct), [11.4, 12.6]);
  assert.equal(estado(pct, '11,5'), 'correcta');
  assert.equal(estado(pct, '12.6'), 'correcta');
  assert.equal(estado(pct, '13'), 'incorrecta');
  assert.equal(estado(pct, 'doce'), 'incorrecta');
  assert.equal(estado(abs, '229'), 'correcta');
  assert.equal(estado(abs, '231'), 'incorrecta');
});

test('relacionar: el alumno no ve las parejas y cada acierto cuenta su parte', () => {
  const ex = examen([{ tipo: 'relacionar', enunciado: 'Relaciona', puntos: 3, pares: [{ izq: 'CPU', der: 'Procesa' }, { izq: 'RAM', der: 'Memoria' }, { izq: 'HDD', der: 'Almacena' }] }]);
  const [p] = ex.preguntas;
  const publica = N.preguntaPublica(p);
  assert.equal(publica.pares, undefined);
  assert.notDeepEqual(publica.derecha, ['Procesa', 'Memoria', 'Almacena'], 'la derecha va desordenada');
  // Posición de cada pareja correcta en la columna que ve el alumno
  const pos = i => p.ordenDerecha.indexOf(i);
  const nota = r => N.corregir(ex, intento(ex, { [p.id]: r })).detalle[p.id];
  assert.deepEqual(nota([pos(0), pos(1), pos(2)]), { puntos: 3, max: 3, estado: 'correcta' });
  assert.deepEqual(nota([pos(0), null, null]), { puntos: 1, max: 3, estado: 'parcial' });
  assert.equal(N.textoRespuesta(p, [pos(0), null, null]), 'CPU → Procesa · RAM → — · HDD → —');
});

test('las soluciones y los criterios no llegan al alumno', () => {
  const ex = examen([
    { tipo: 'test', enunciado: 'a', opciones: ['x', 'y'], correcta: 1 },
    { tipo: 'multiple', enunciado: 'b', opciones: ['x', 'y'], correctas: [0] },
    { tipo: 'numerica', enunciado: 'c', valor: 5 },
    { tipo: 'desarrollo', enunciado: 'd', criterios: [{ texto: 'Seguridad', puntos: 1 }] },
  ]);
  const publico = JSON.stringify(N.datosPublicos(ex));
  for (const secreto of ['"correcta"', '"correctas"', '"valor"', '"criterios"', 'Seguridad']) assert.ok(!publico.includes(secreto), secreto);
});

test('corrección a mano con rúbrica y comentarios', () => {
  const ex = examen([{ tipo: 'desarrollo', enunciado: 'Explica', puntos: 2, criterios: [{ texto: 'Seguridad', puntos: 1 }, { texto: 'Medida', puntos: 1 }] }]);
  const [p] = ex.preguntas;
  const c = N.limpiarCorreccion(ex, {}, { notasManual: { [p.id]: 1 }, comentarios: { [p.id]: '  Falta la medida  ' }, rubricas: { [p.id]: [0, 7] } });
  assert.deepEqual(c, { notasManual: { [p.id]: 1 }, comentarios: { [p.id]: 'Falta la medida' }, rubricas: { [p.id]: [0] } });
  assert.equal(N.corregir(ex, { ...intento(ex, { [p.id]: 'texto' }), ...c }).total, 1);
  // Borrar el comentario
  assert.deepEqual(N.limpiarCorreccion(ex, c, { comentarios: { [p.id]: '' } }).comentarios, {});
});

test('con alumnos dentro no se pueden cambiar las parejas', () => {
  const ex = examen([{ tipo: 'relacionar', enunciado: 'R', pares: [{ izq: 'a', der: 'b' }, { izq: 'c', der: 'd' }] }]);
  const otra = structuredClone(ex);
  otra.preguntas[0].pares.push({ izq: 'e', der: 'f' });
  assert.throws(() => N.comprobarCambios(ex, otra, true), /parejas/);
  assert.doesNotThrow(() => N.comprobarCambios(ex, otra, false));
});
