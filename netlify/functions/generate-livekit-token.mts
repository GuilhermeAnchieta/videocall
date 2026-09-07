import type { Config, Context } from '@netlify/functions';
import { AccessToken } from 'livekit-server-sdk';

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !livekitUrl) {
    return new Response(JSON.stringify({ error: 'LiveKit credentials are not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

  let body: { roomCode?: string; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const roomCode = (body.roomCode ?? '').trim();
  const displayName = (body.displayName ?? '').trim();
  if (!roomCode || !displayName) {
    return new Response(JSON.stringify({ error: 'roomCode and displayName are required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const trimmedName = displayName.slice(0, 60);
  const identity = `${trimmedName.slice(0, 40).replace(/\s+/g, '_')}-${Math.random().toString(36).slice(2, 8)}`;

  const accessToken = new AccessToken(apiKey, apiSecret, { identity, name: trimmedName, ttl: '4h' });
  accessToken.addGrant({
    room: roomCode,
    roomJoin: true,
    roomCreate: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });

  const token = await accessToken.toJwt();
  return new Response(JSON.stringify({ token, livekitUrl }), {
    headers: { 'content-type': 'application/json' }
  });
};

export const config: Config = { path: '/api/generate-token' };
