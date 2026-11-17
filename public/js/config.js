// Configuración de la versión en Firebase (Hosting + Auth + Firestore, plan gratuito).
// El servidor propio (servidor/servidor.js) sirve su propio config.js y este archivo no se usa.
// Estas claves de Firebase no son secretas: identifican el proyecto; lo que protege los datos
// son las reglas de firestore.rules.
export const MODO = 'firebase';

export const FIREBASE = {
  apiKey: 'AIzaSyAmAjh9HMrJitgbOgPcXkO0gnxiWpfpVPM',
  authDomain: 'testgo-e26db.firebaseapp.com',
  projectId: 'testgo-e26db',
  storageBucket: 'testgo-e26db.firebasestorage.app',
  messagingSenderId: '548189251285',
  appId: '1:548189251285:web:d1a27af96aff9ecde8645c',
};

// Solo pueden ser profesores las cuentas de este dominio (tiene que coincidir con firestore.rules)
export const DOMINIO_PROFESORES = '@edu.gva.es';

// Administradores: pueden entrar aunque no sean del dominio y ven y gestionan los exámenes de todos
// (tiene que coincidir con la función admin() de firestore.rules)
export const ADMINS = ['thedynat@gmail.com', 'dj.vidalsoriano@edu.gva.es'];
