import { Injectable } from '@angular/core';
import { addDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { firestore } from './firebase-app';
import { getCurrentUserId } from './current-user';
import { environment } from '../../environments/environment';
import { ClipInfo } from '../models/room-state';

const CLIPS_COLLECTION = 'clips';

/**
 * Clip metadata lives in Firestore (free on the Spark plan). The video bytes themselves
 * go to Netlify Blobs via the `upload-clip` function — we don't use Firebase Storage because,
 * since Sept/2024, provisioning a new bucket requires the paid Blaze plan even for free-tier usage.
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
    if (!res.ok) throw new Error('Failed to upload clip');
    return (await res.json()) as ClipInfo;
  }
}
