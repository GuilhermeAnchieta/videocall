import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

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
    const res = await fetch(`${this.apiBase}/api/create-room`, { method: 'POST' });
    if (!res.ok) throw new Error('Falha ao criar sala');
    const data = (await res.json()) as CreateRoomResponse;
    return data.roomCode;
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
