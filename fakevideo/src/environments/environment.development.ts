export const environment = {
  production: false,
  useEmulators: true,
  // '' = same origin (works with `netlify dev`, which serves the Angular app + the functions together).
  apiBase: '',
  firebase: {
    apiKey: 'demo-key',
    authDomain: 'demo-fakevideo.firebaseapp.com',
    projectId: 'demo-fakevideo',
    storageBucket: 'demo-fakevideo.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000'
  }
};
