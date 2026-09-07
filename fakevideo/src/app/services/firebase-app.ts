import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { environment } from '../../environments/environment';

// Firebase aqui só cuida de Firestore + Auth anônimo (plano gratuito Spark, sem cartão).
// Os arquivos de vídeo dos clipes vão pro Netlify Blobs (ver netlify/functions/upload-clip.mts)
// em vez do Firebase Storage, que hoje exige o plano pago Blaze pra provisionar um bucket novo.
const app = initializeApp(environment.firebase);

export const firestore = getFirestore(app);
export const auth = getAuth(app);

if (environment.useEmulators) {
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
