import { Injectable } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { firestore } from './firebase-app';
import { getCurrentUserId } from './current-user';

interface GenerateTokenResponse {
  token: string;
  livekitUrl: string;
}

interface CreateRoomResponse {
  roomCode: string;
}

/**
 * Fala com as duas Netlify Functions (netlify/functions/) que substituem as antigas
 * Firebase Cloud Functions — assim o projeto não depende do plano pago (Blaze) do Firebase.
 */
@Injectable({ providedIn: 'root' })
export class RoomService {
  private readonly apiBase = environment.apiBase;

  async createRoom(): Promise<string> {
    const ownerUid = await getCurrentUserId();
    const res = await fetch(`${this.apiBase}/api/create-room`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerUid })
    });
    if (!res.ok) throw new Error('Falha ao criar sala');
    const data = (await res.json()) as CreateRoomResponse;
    return data.roomCode;
  }

  /** Dono da sala é quem a criou (uid anônimo do Firebase salvo no doc na criação). */
  async getRoomOwnerUid(roomCode: string): Promise<string | undefined> {
    const snap = await getDoc(doc(firestore, 'rooms', roomCode));
    const data = snap.data() as { ownerUid?: string | null } | undefined;
    return data?.ownerUid ?? undefined;
  }

  async getAccessToken(roomCode: string, displayName: string): Promise<GenerateTokenResponse> {
    const res = await fetch(`${this.apiBase}/api/generate-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomCode, displayName })
    });
    if (!res.ok) throw new Error('Falha ao gerar token de acesso');
    return (await res.json()) as GenerateTokenResponse;
  }
}
