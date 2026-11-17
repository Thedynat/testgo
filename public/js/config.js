// Configuración de la versión en Firebase (Hosting + Auth + Firestore, plan gratuito).
// El servidor propio (servidor/servidor.js) sirve su propio config.js y este archivo no se usa.
// Estas claves de Firebase no son secretas: identifican el proyecto; lo que protege los datos
// son las reglas de firestore.rules.
export const MODO = 'firebase';

export const FIREBASE = {
  apiKey: 'AIzaSyA-7l2MksISfztqtJK-eLddVVcn6NLUMpA',
  authDomain: 'testgo-58376.firebaseapp.com',
  projectId: 'testgo-58376',
  storageBucket: 'testgo-58376.firebasestorage.app',
  messagingSenderId: '233392639880',
  appId: '1:233392639880:web:1e9a91c0e062085859b43d',
};

// Solo pueden ser profesores las cuentas de este dominio (tiene que coincidir con firestore.rules)
export const DOMINIO_PROFESORES = '@edu.gva.es';

// Administradores: pueden entrar aunque no sean del dominio y ven y gestionan los exámenes de todos
// (tiene que coincidir con la función admin() de firestore.rules)
export const ADMINS = ['thedynat@gmail.com', 'dj.vidalsoriano@edu.gva.es'];
