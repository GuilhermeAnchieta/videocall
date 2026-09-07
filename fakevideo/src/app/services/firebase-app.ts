import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { environment } from '../../environments/environment';

// Firebase aqui só cuida de Firestore + Storage + Auth anônimo (tudo disponível no plano
// gratuito Spark). A geração de token do LiveKit e a criação de sala são Netlify Functions
// (ver ../../../netlify/functions) — assim o projeto não depende do plano pago Blaze.
const app = initializeApp(environment.firebase);

export const firestore = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

if (environment.useEmulators) {
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
