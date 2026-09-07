export const environment = {
  production: true,
  useEmulators: false,
  // '' = mesma origem (o site publicado na Netlify serve o Angular + as functions no mesmo domínio).
  apiBase: '',
  firebase: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT',
    storageBucket: 'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID'
  }
};
