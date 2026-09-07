import { User, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { auth } from './firebase-app';

let readyPromise: Promise<string> | null = null;

/** Anonymous auth gives each device a stable uid, used to own personal clips without a full login flow. */
export function getCurrentUserId(): Promise<string> {
  if (!readyPromise) {
    readyPromise = new Promise<string>((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(
        auth,
        (user: User | null) => {
          if (user) {
            unsubscribe();
            resolve(user.uid);
          }
        },
        reject
      );
      if (!auth.currentUser) {
        signInAnonymously(auth).catch(reject);
      }
    });
  }
  return readyPromise;
}
