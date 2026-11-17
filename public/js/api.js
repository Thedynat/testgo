// Elige cómo hablar con los datos: el servidor propio o Firebase.
// El servidor sirve su propio config.js; en Firebase Hosting se usa el archivo de la carpeta web.
import { MODO } from './config.js';

const modulo = MODO === 'firebase' ? await import('./api-firebase.js') : await import('./api-servidor.js');

export { MODO };
export const alumno = modulo.alumno;
export const profesor = modulo.profesor;
// Solo en Firebase: la administración del centro (en el servidor propio no existe)
export const admin = modulo.admin || null;
