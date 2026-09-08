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
 * Talks to the two Netlify Functions (netlify/functions/) that replace the old
 * Firebase Cloud Functions — this way the project doesn't depend on Firebase's paid (Blaze) plan.
 */
@Injectable({ providedIn: 'root' })
export class RoomService {
  private readonly apiBase = environment.apiBase;

  async createRoom(): Promise<string> {
    const res = await fetch(`${this.apiBase}/api/create-room`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to create room');
    const data = (await res.json()) as CreateRoomResponse;
    return data.roomCode;
  }

  async getAccessToken(roomCode: string, displayName: string): Promise<GenerateTokenResponse> {
    const res = await fetch(`${this.apiBase}/api/generate-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomCode, displayName })
    });
    if (!res.ok) throw new Error('Failed to generate access token');
    return (await res.json()) as GenerateTokenResponse;
  }
}
