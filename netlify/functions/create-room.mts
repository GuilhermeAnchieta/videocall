import type { Config, Context } from '@netlify/functions';

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

  const roomCode = generateRoomCode();
  return new Response(JSON.stringify({ roomCode }), {
    headers: { 'content-type': 'application/json' }
  });
};

export const config: Config = { path: '/api/create-room' };
