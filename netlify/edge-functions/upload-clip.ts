import type { Config, Context } from '@netlify/edge-functions';
import { getStore } from '@netlify/blobs';

// Runs as an Edge Function (Deno), not a classic Netlify Function, so it isn't subject to the
// ~6MB request body limit of the AWS Lambda-backed functions — a 10-minute clip easily exceeds
// that. Metadata (name/scope/ownerId) is written to Firestore by the client afterwards (see
// clip-library.service.ts), since firebase-admin doesn't run in the Deno edge runtime.
export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const form = await req.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: 'file is required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    const clipId = crypto.randomUUID();
    const store = getStore({ name: 'clips', consistency: 'strong' });
    await store.set(clipId, file, { metadata: { contentType: file.type || 'video/mp4' } });

    return new Response(JSON.stringify({ id: clipId, url: `/api/clip/${clipId}` }), {
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
