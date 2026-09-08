import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Stores the video bytes in Netlify Blobs (free, no card) and only the metadata in
// Firestore — this way we don't depend on Firebase Storage, which now requires the Blaze
// plan even for free-tier usage (Google's change from Sept/2024).
function ensureAdmin(): void {
  if (getApps().length) return;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'demo-fakevideo' });
    return;
  }
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
    })
  });
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    const name = (form.get('name')?.toString() ?? '').trim();
    const ownerId = (form.get('ownerId')?.toString() ?? '').trim();

    if (!(file instanceof File) || !name || !ownerId) {
      return new Response(JSON.stringify({ error: 'file, name and ownerId are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    const clipId = crypto.randomUUID();
    const store = getStore({ name: 'clips', consistency: 'strong' });
    await store.set(clipId, file, { metadata: { contentType: file.type || 'video/mp4' } });

    ensureAdmin();
    const clip = {
      name: name.slice(0, 80),
      url: `/api/clip/${clipId}`,
      scope: 'personal' as const,
      ownerId
    };
    await getFirestore().collection('clips').doc(clipId).set(clip);

    return new Response(JSON.stringify({ id: clipId, ...clip }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    console.error('upload-clip failed', err);
    return new Response(JSON.stringify({ error: 'failed to upload clip' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
};

export const config: Config = { path: '/api/upload-clip' };
