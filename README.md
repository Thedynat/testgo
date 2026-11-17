# TestGO — versión publicada en testgo-58376

Proyecto Firebase: `testgo-58376` (cuenta iesmaestrat@gmail.com).
Web: https://testgo-58376.web.app

La rama `firebase` guarda la copia recuperada del proyecto anterior, `testgo-e26db`.

## Archivos

- `public/`: los 24 archivos de la versión de Firebase Hosting publicada el 11/11/2026 (`sites/testgo-58376/versions/9c8d6eeb5214f3ba`), descargados tal cual.
- `firestore.rules`: reglas de Firestore activas en `testgo-58376`.
- `firebase.json` y `.firebaserc`: configuración reconstruida a partir de esa versión (cabeceras `Cache-Control` y `cleanUrls`).
- `recovery-manifest.json`: versión de Hosting, configuración, rutas y hashes de los archivos descargados.

No incluye historial anterior ni datos de usuarios o exámenes.

## Vista local

Desde esta carpeta:

```powershell
npx.cmd firebase-tools serve --only hosting --project testgo-58376
```

La aplicación conserva la conexión al Firebase real: las acciones en la vista local pueden leer o modificar sus datos según las reglas y la cuenta usada.

## Publicación

Indica siempre el proyecto y la cuenta:

```powershell
npx.cmd firebase-tools deploy --only hosting --project testgo-58376 --account iesmaestrat@gmail.com
```
