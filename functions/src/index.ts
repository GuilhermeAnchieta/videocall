import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { AccessToken } from 'livekit-server-sdk';

initializeApp();
setGlobalOptions({ maxInstances: 10 });

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';

const ROOM_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

function randomSegment(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

function generateRoomCode(): string {
  return `${randomSegment(3)}-${randomSegment(4)}-${randomSegment(3)}`;
}

function assertLiveKitConfigured(): void {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new HttpsError(
      'failed-precondition',
      'LiveKit credentials are not configured on the server (LIVEKIT_API_KEY/LIVEKIT_API_SECRET).'
    );
  }
}

export const createRoom = onCall(async (request) => {
  assertLiveKitConfigured();

  const roomCode = generateRoomCode();
  await getFirestore()
    .collection('rooms')
    .doc(roomCode)
    .set({
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth?.uid ?? null
    });

  return { roomCode };
});

export const generateLiveKitToken = onCall(async (request) => {
  assertLiveKitConfigured();

  const roomCode = request.data?.roomCode;
  const displayName = request.data?.displayName;

  if (typeof roomCode !== 'string' || !roomCode.trim()) {
    throw new HttpsError('invalid-argument', 'roomCode is required.');
  }
  if (typeof displayName !== 'string' || !displayName.trim()) {
    throw new HttpsError('invalid-argument', 'displayName is required.');
  }

  const trimmedName = displayName.trim().slice(0, 60);
  const identity = `${trimmedName.slice(0, 40).replace(/\s+/g, '_')}-${Math.random().toString(36).slice(2, 8)}`;

  const accessToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: trimmedName,
    ttl: '4h'
  });
  accessToken.addGrant({
    room: roomCode.trim(),
    roomJoin: true,
    roomCreate: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });

  const token = await accessToken.toJwt();
  return { token, livekitUrl: LIVEKIT_URL };
});
