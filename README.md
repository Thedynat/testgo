<p align="center">
  <img src="web/img/logo.svg" alt="" width="96">
</p>

<h1 align="center">TestGO</h1>

<p align="center">Exámenes en el aula: el alumno entra con un código, responde pregunta a pregunta y el profesor lo sigue en directo.</p>

---

TestGO es una aplicación web para hacer exámenes en clase desde el ordenador o el móvil. Pensada para FP, funciona en un solo equipo del aula, sin instalar nada en los ordenadores de los alumnos y sin necesitar internet.

## Qué hace

**Para el alumno**

- Entra con el código del examen y su nombre, sin crear cuentas.
- Una pregunta por pantalla, con navegador de preguntas, *Marcar para revisar* y una pantalla de revisión antes de entregar.
- Atajos de teclado: <kbd>←</kbd> <kbd>→</kbd> para moverse y <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> para elegir opción.
- Las respuestas se guardan solas. Si se recarga la página, vuelve a la misma pregunta.
- Avisos cuando quedan 5 minutos y 1 minuto. Al acabar el tiempo, el examen se entrega solo.

**Para el profesor**

- **Siete tipos de pregunta,** todos con imagen opcional (por ejemplo, para identificar componentes de una placa base):
  - **Test** y **verdadero o falso**.
  - **Varias correctas:** las correctas marcadas suman y las incorrectas restan.
  - **Respuesta corta:** se corrige sola, sin tener en cuenta mayúsculas ni tildes.
  - **Numérica:** con un margen en % o en unidades, por ejemplo 12 V ± 5 %.
  - **Relacionar columnas.**
  - **Desarrollo:** con criterios de corrección (rúbrica). Al corregir marcas los que cumple el alumno y la nota se calcula sola.
- **Ejercicios con apartados:** se muestran como 9a, 9b y 9c, con el enunciado común encima.
- **Comentarios del profesor** en cada respuesta. Salen en el PDF del alumno.
- **Importar** un examen que ya tienes:
  - Desde **Word o PDF**: TestGO separa las preguntas, opciones, soluciones y puntos, y quita las líneas para responder y las cabeceras de página.
  - **Con ayuda de una IA** (ChatGPT, Gemini, Claude…): TestGO te da las instrucciones, la IA convierte el examen y tú pegas el resultado.
  - Antes de importar, todo pasa por una pantalla de revisión.
- **Ajustes del examen:** asignatura, duración, preguntas al azar por alumno, barajar preguntas y opciones, penalización por fallo en test y si el alumno ve su nota al entregar.
- **Control antichuleta:** registra cuándo el alumno sale de la pantalla completa, cambia de pestaña, copia o pega. Por defecto, **el examen se bloquea a la primera salida**; el profesor puede cambiarlo o desbloquearlo desde el panel.
- **Marca de agua** opcional: el nombre del alumno y la fecha de fondo en todo el examen, para que cualquier foto o captura diga de quién es.
- **Tu centro:** el nombre y el logo del instituto salen en la entrada de los alumnos, en sus exámenes y en los PDF.
- **En directo:** quién ha entrado, su progreso, el tiempo, las salidas y la última incidencia. Desde ahí puedes bloquear, desbloquear, dar o quitar tiempo, recoger o reabrir un examen, y permitir que un alumno vuelva a entrar desde otro equipo.
- **Mostrar a la clase:** la dirección y el código en grande para proyectarlos.
- **Resultados:** nota media, aprobados, pendientes de corregir y porcentaje de acierto por pregunta. *Empezar a corregir* recorre uno a uno los alumnos que tienen preguntas por corregir a mano.
- **Exportar:** el examen de cada alumno (enunciados con su respuesta debajo) en **Markdown** o **PDF**, todos a la vez en un **ZIP**, y las notas en **CSV** para Excel.

## Requisitos

- [Node.js](https://nodejs.org) 20 o superior. No hace falta `npm install`: no tiene dependencias.
- Alumnos y profesor en la misma red (la wifi o el cable del aula).

## Instalación y arranque

```bash
git clone https://github.com/mohabnw/testgo.git
cd testgo
npm start
```

Al arrancar, la consola muestra las direcciones:

```
TestGO funcionando en el puerto 3000

  Profesor:  http://localhost:3000/profesor
  Alumnos:   http://192.168.1.20:3000
```

1. Abre **`/profesor`** en tu navegador. La primera vez te pedirá crear la contraseña del panel.
2. Crea o importa un examen y pulsa **Abrir examen**.
3. Los alumnos entran en la dirección de **Alumnos** y escriben el código. Con **Mostrar a la clase** puedes proyectar la dirección y el código.

Para usar otro puerto:

```bash
PORT=8080 npm start          # Linux / macOS
set PORT=8080 && npm start   # Windows
```

> Si los alumnos no consiguen entrar, revisa que el cortafuegos de Windows permita Node.js en redes privadas. Windows lo pregunta la primera vez que arrancas TestGO.

## Dónde se guardan los datos

Todo se guarda en `servidor/datos/testgo.json`: la contraseña (cifrada con scrypt), los exámenes y las respuestas. Esa carpeta no se sube a git.

- **Copia de seguridad:** copia ese archivo.
- **Empezar de cero:** borra la carpeta `servidor/datos` y te volverá a pedir la contraseña.
- **Guardarlos en otra carpeta:** define la variable `TESTGO_DATOS=/ruta/a/la/carpeta`.

## Importar un examen

| Formato | Qué entiende |
|---|---|
| Preguntas | `1.`, `2)`, `Pregunta 3:` o listas numeradas de Word |
| Opciones | `a)`, `B.`, `(c)` o casillas `☐` / `[ ]` |
| Respuesta correcta | Negrita o subrayado, `*` o `[x]` al lado, o una línea `Solución: b` |
| Respuesta corta | Una línea `Respuesta: ROM / Read Only Memory` |
| Puntos | `(0,5 puntos)` en la pregunta, o `PARTE I · TEST (0,5 puntos cada una)` en la parte |
| Apartados | `a)`, `b)`, `c)` con líneas para responder o con sus propios puntos |

Si el examen tiene un formato raro, o es un PDF escaneado que no tiene texto, usa **Con ayuda de una IA**.

## Estructura

```
servidor/servidor.js   servidor HTTP sin dependencias
web/
  index.html           página del alumno
  profesor.html        panel del profesor
  js/nucleo.js         lógica compartida: corrección, orden, apartados, CSV
  js/importar.js       lectura de Word/PDF y del formato de la IA
  js/exportar.js       Markdown, PDF y ZIP
  vendor/              pdf.js, jsPDF y JSZip (incluidas para funcionar sin internet)
pruebas/               pruebas automáticas
```

## Pruebas

```bash
npm test
```

## En preparación

- Versión en **Firebase** (Hosting, Auth y Firestore en el plan gratuito), para usar TestGO por internet con cuentas de profesor del centro.
