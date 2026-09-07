import type { Config, Context } from '@netlify/functions';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function ensureAdmin(): void {
  if (getApps().length) return;

  // Dev local (`netlify dev` + Firebase Emulator Suite): sem credencial real nenhuma,
  // só aponta pro emulador do Firestore.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'demo-fakevideo' });
    return;
  }

  // Produção: credenciais da service account (geradas de graça no Firebase, plano Spark).
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
    })
  });
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

function randomSegment(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function generateRoomCode(): string {
  return `${randomSegment(3)}-${randomSegment(4)}-${randomSegment(3)}`;
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: { ownerUid?: string } = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio é aceitável; a sala simplesmente fica sem dono reconhecido
  }

  try {
    ensureAdmin();
    const roomCode = generateRoomCode();
    await getFirestore().collection('rooms').doc(roomCode).set({
      createdAt: FieldValue.serverTimestamp(),
      ownerUid: (body.ownerUid ?? '').trim() || null
    });
    return new Response(JSON.stringify({ roomCode }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    console.error('create-room failed', err);
    return new Response(JSON.stringify({ error: 'failed to create room' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
};

export const config: Config = { path: '/api/create-room' };
