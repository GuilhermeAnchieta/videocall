import { Injectable } from '@angular/core';
import { addDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { firestore } from './firebase-app';
import { getCurrentUserId } from './current-user';
import { environment } from '../../environments/environment';
import { ClipInfo } from '../models/room-state';

const CLIPS_COLLECTION = 'clips';

/**
 * Metadados dos clipes ficam no Firestore (grátis no plano Spark). Os bytes do vídeo em si
 * vão pro Netlify Blobs via a function `upload-clip` — não usamos Firebase Storage porque,
 * desde set/2024, provisionar um bucket novo exige o plano pago Blaze mesmo pra uso gratuito.
 */
@Injectable({ providedIn: 'root' })
export class ClipLibraryService {
  async listAvailableClips(): Promise<ClipInfo[]> {
    const uid = await getCurrentUserId();
    const clipsRef = collection(firestore, CLIPS_COLLECTION);

    const [sharedSnap, personalSnap] = await Promise.all([
      getDocs(query(clipsRef, where('scope', '==', 'shared'))),
      getDocs(query(clipsRef, where('scope', '==', 'personal'), where('ownerId', '==', uid)))
    ]);

    const clips: ClipInfo[] = [];
    sharedSnap.forEach((doc) => clips.push({ id: doc.id, ...(doc.data() as Omit<ClipInfo, 'id'>) }));
    personalSnap.forEach((doc) => clips.push({ id: doc.id, ...(doc.data() as Omit<ClipInfo, 'id'>) }));
    return clips;
  }

  async uploadPersonalClip(file: File, name: string): Promise<ClipInfo> {
    const uid = await getCurrentUserId();

    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    form.append('ownerId', uid);

    const res = await fetch(`${environment.apiBase}/api/upload-clip`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('Falha ao enviar o clipe');
    return (await res.json()) as ClipInfo;
  }
}
