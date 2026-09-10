import type { Config, Context } from '@netlify/edge-functions';
import { getStore } from '@netlify/blobs';

// Edge Function rather than a classic Netlify Function for the same reason as upload-clip: a
// clip's response body can be large, and classic functions cap responses at ~6MB too.
export default async (_req: Request, context: Context): Promise<Response> => {
  const clipId = context.params.id;
  if (!clipId) {
    return new Response('Not found', { status: 404 });
  }

  const store = getStore({ name: 'clips', consistency: 'strong' });
  const result = await store.getWithMetadata(clipId, { type: 'arrayBuffer' });

  if (!result || result.data === null) {
    return new Response('Not found', { status: 404 });
  }

  const contentType = (result.metadata?.['contentType'] as string) ?? 'video/mp4';
  return new Response(result.data, {
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=31536000, immutable'
    }
  });
};

export const config: Config = { path: '/api/clip/:id' };
