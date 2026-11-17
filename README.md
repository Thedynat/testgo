# TestGO — copia recuperada

Proyecto Firebase: `testgo-e26db`.
Web: https://testgo-e26db.web.app

## Archivos

- `public/`: 22 archivos descargados de Firebase Hosting, incluidos HTML, CSS, JavaScript e imágenes.
- `firestore.rules`: reglas activas recuperadas de Firebase Rules.
- `firebase.json` y `.firebaserc`: configuración local reconstruida para este proyecto.
- `recovery-manifest.json`: versión de Hosting, rutas y hashes de los archivos descargados.

El JavaScript publicado es legible y editable. Esta recuperación no incluye el historial Git, el servidor alternativo mencionado en el código ni los archivos originales que no se publicaron. No se han exportado datos de usuarios ni exámenes. Los hashes del despliegue no coinciden con los hashes de las respuestas HTTP; se conservan ambos en el manifiesto sin afirmar igualdad binaria con los archivos originales subidos.

## Vista local

Desde esta carpeta:

```powershell
& "$HOME\Documents\Codex\tools\firebase\firebase.cmd" serve --only hosting --project testgo-e26db
```

La aplicación conserva la conexión al Firebase real: las acciones en la vista local pueden leer o modificar sus datos según las reglas y la cuenta usada.

## Publicación

Cuando los cambios estén revisados:

```powershell
& "$HOME\Documents\Codex\tools\firebase\firebase.cmd" deploy --only hosting --project testgo-e26db
```

No se ha realizado ningún despliegue durante la recuperación.
