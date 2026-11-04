import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerRespuestaIA, pareceFormatoIA, promptIA } from '../web/js/importar.js';

// Lo que suele devolver ChatGPT: texto antes, bloque ```json y texto después
const RESPUESTA = `¡Claro! Aquí tienes el examen en formato TestGO:

\`\`\`json
{
  "testgo": 1,
  "titulo": "RA3 · Medidas eléctricas",
  "preguntas": [
    { "tipo": "test", "enunciado": "¿Qué magnitud se mide en hercios (Hz)?", "puntos": 0.5, "opciones": ["Tensión", "Intensidad", "Frecuencia", "Resistencia"], "correcta": "c" },
    { "tipo": "corta", "enunciado": "¿Qué siglas tiene la memoria de solo lectura?", "puntos": 1, "respuestas": ["ROM", "Read Only Memory"] },
    { "tipo": "desarrollo", "enunciado": "Un SAI pita al cortar la red.\\na) Dibuja el esquema de bloques. (1 punto)\\nb) ¿Qué medirías? (2 puntos)", "puntos": 3 }
  ]
}
\`\`\`

Si quieres, puedo ajustar los puntos.`;

test('lee la respuesta de una IA con texto alrededor', () => {
  const { titulo, preguntas } = leerRespuestaIA(RESPUESTA);
  assert.equal(titulo, 'RA3 · Medidas eléctricas');
  assert.deepEqual(preguntas.map(p => p.tipo), ['test', 'corta', 'desarrollo']);
  assert.equal(preguntas[0].correcta, 2);
  assert.equal(preguntas[0].puntos, 0.5);
  assert.deepEqual(preguntas[1].respuestas, ['ROM', 'Read Only Memory']);
  assert.equal(preguntas[2].enunciado.split('\n').length, 3);
  assert.equal(preguntas[2].puntos, 3);
  assert.ok(preguntas.every(p => !p.avisos.length));
});

test('tolera los fallos típicos de las IA', () => {
  const malo = `{
    "titulo": "Repaso",
    "preguntas": [
      { "tipo": "Opción múltiple", "enunciado": "¿Bits de un byte?", "puntos": "0,5", "opciones": ["a) 4", "b) 8", "c) 16",], "correcta": "B" },
      { "tipo": "test", "enunciado": "¿Capital de Francia?", "opciones": ["Madrid", "París"], "correcta": 1 },
      { "tipo": "test", "enunciado": "¿Color del cielo?", "opciones": ["Azul", "Verde"], "correcta": "Azul" },
      { "tipo": "respuesta corta", "enunciado": "¿Qué es la CPU?", "respuesta": "Procesador / Unidad central de proceso" },
    ]
  }`;
  const { preguntas } = leerRespuestaIA(malo);
  assert.equal(preguntas[0].tipo, 'test');
  assert.deepEqual(preguntas[0].opciones, ['4', '8', '16'], 'sin las letras delante');
  assert.equal(preguntas[0].correcta, 1);
  assert.equal(preguntas[0].puntos, 0.5, 'acepta la coma decimal');
  assert.equal(preguntas[1].correcta, 1, 'acepta el índice numérico');
  assert.equal(preguntas[1].puntos, 1, 'sin puntos vale 1');
  assert.equal(preguntas[2].correcta, 0, 'acepta el texto de la opción');
  assert.equal(preguntas[3].tipo, 'corta');
  assert.deepEqual(preguntas[3].respuestas, ['Procesador', 'Unidad central de proceso']);
});

test('avisa de lo que falta en vez de inventárselo', () => {
  const { preguntas } = leerRespuestaIA('[{"tipo":"test","enunciado":"¿Uno?","opciones":["a","b"],"correcta":null},{"tipo":"test","enunciado":"Sin opciones"}]');
  assert.equal(preguntas[0].correcta, null);
  assert.match(preguntas[0].avisos[0], /márcala/);
  assert.equal(preguntas[1].tipo, 'desarrollo');
  assert.ok(preguntas[1].avisos.length);
});

test('da un error claro si no hay código', () => {
  assert.throws(() => leerRespuestaIA('Lo siento, no puedo leer el archivo.'), /No se ha encontrado el código/);
  assert.throws(() => leerRespuestaIA('{"preguntas": [}'), /tiene un error/);
});

test('distingue el JSON de la IA del texto de un examen', () => {
  assert.ok(pareceFormatoIA(RESPUESTA.slice(RESPUESTA.indexOf('```'))));
  assert.ok(pareceFormatoIA('{"preguntas": []}'));
  assert.ok(!pareceFormatoIA('1. ¿Cuántos bits tiene un byte?\na) 4\nb) 8'));
});

test('el prompt explica el formato y cambia según si la IA debe resolver', () => {
  const con = promptIA({ resolver: true });
  const sin = promptIA({ resolver: false });
  assert.match(con, /"testgo": 1/);
  assert.match(con, /resuélvela tú/);
  assert.match(sin, /No las resuelvas tú/);
  // El ejemplo del prompt también tiene que leerse bien
  const ejemplo = con.slice(con.indexOf('{'), con.indexOf('Reglas:'));
  assert.equal(leerRespuestaIA(ejemplo).preguntas.length, 5, '3 preguntas sueltas y un ejercicio con 2 apartados');
});

test('lee los tipos nuevos: verdadero/falso, varias correctas, numérica, relacionar y criterios', () => {
  const { preguntas } = leerRespuestaIA(`{"preguntas": [
    {"tipo": "vf", "enunciado": "La RAM es volátil", "correcta": "verdadero"},
    {"tipo": "multiple", "enunciado": "Periféricos de entrada", "opciones": ["Teclado", "Monitor", "Ratón"], "correctas": ["a", "c"]},
    {"tipo": "numerica", "enunciado": "Tensión de la línea amarilla", "valor": 12, "tolerancia": 5, "unidad": "V"},
    {"tipo": "numerica", "enunciado": "Resistencia", "valor": "220", "tolerancia_abs": 10},
    {"tipo": "relacionar", "enunciado": "Relaciona", "pares": [["CPU", "Procesa"], ["RAM", "Memoria"]]},
    {"tipo": "desarrollo", "enunciado": "Explica", "puntos": 2, "criterios": [{"texto": "Seguridad", "puntos": 1}, "Medida"]},
    {"tipo": "test", "enunciado": "¿Es cierto?", "opciones": ["Verdadero", "Falso"], "correcta": "b"}
  ]}`);
  const [vf, mu, nu, nuAbs, re, de, vf2] = preguntas;
  assert.equal(vf.tipo, 'vf');
  assert.equal(vf.correcta, 0);
  assert.deepEqual(mu.correctas, [0, 2]);
  assert.deepEqual([nu.valor, nu.tolerancia, nu.modoTolerancia, nu.unidad], [12, 5, '%', 'V']);
  assert.deepEqual([nuAbs.valor, nuAbs.tolerancia, nuAbs.modoTolerancia], [220, 10, 'abs']);
  assert.deepEqual(re.pares, [{ izq: 'CPU', der: 'Procesa' }, { izq: 'RAM', der: 'Memoria' }]);
  assert.equal(de.criterios.length, 2);
  assert.equal(vf2.tipo, 'vf', 'un test de Verdadero/Falso se convierte en vf');
  assert.equal(vf2.correcta, 1);
  assert.ok(preguntas.every(p => !p.avisos.length));
});

test('separa los apartados de un ejercicio en preguntas con el enunciado común', () => {
  const { preguntas } = leerRespuestaIA(`{"preguntas": [
    {"tipo": "test", "enunciado": "¿Uno?", "opciones": ["a", "b"], "correcta": "a"},
    {"enunciado": "Un SAI pita al cortar la red.", "puntos": 3, "apartados": [
      {"tipo": "desarrollo", "enunciado": "Dibuja el esquema."},
      {"tipo": "corta", "enunciado": "¿Tensión de salida?", "respuestas": ["230 V"]},
      {"tipo": "test", "enunciado": "¿Qué falla?", "opciones": ["Batería", "Cable"], "correcta": "a"}
    ]}
  ]}`);
  assert.equal(preguntas.length, 4);
  const [, a, b, c] = preguntas;
  assert.deepEqual([a.tipo, b.tipo, c.tipo], ['desarrollo', 'corta', 'test']);
  assert.ok(a.grupo && a.grupo === b.grupo && b.grupo === c.grupo);
  assert.deepEqual([a.apartado, b.apartado, c.apartado], ['a', 'b', 'c']);
  assert.ok([a, b, c].every(p => p.contexto === 'Un SAI pita al cortar la red.'));
  assert.deepEqual([a.puntos, b.puntos, c.puntos], [1, 1, 1], 'reparte los 3 puntos del ejercicio');
  assert.equal(c.correcta, 0);
  assert.equal(preguntas[0].grupo, undefined);
});
