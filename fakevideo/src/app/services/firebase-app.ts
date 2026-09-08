import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { environment } from '../../environments/environment';

// Firebase here only handles Firestore + anonymous Auth (free Spark plan, no card required).
// Clip video files go to Netlify Blobs (see netlify/functions/upload-clip.mts)
// instead of Firebase Storage, which now requires the paid Blaze plan to provision a new bucket.
const app = initializeApp(environment.firebase);

export const firestore = getFirestore(app);
export const auth = getAuth(app);

if (environment.useEmulators) {
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
