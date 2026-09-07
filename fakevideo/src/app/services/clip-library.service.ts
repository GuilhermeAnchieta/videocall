import { Injectable } from '@angular/core';
import { addDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { firestore, storage } from './firebase-app';
import { getCurrentUserId } from './current-user';
import { ClipInfo } from '../models/room-state';

const CLIPS_COLLECTION = 'clips';

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
    const clipId = crypto.randomUUID();
    const videoPath = `clips/personal/${uid}/${clipId}-${file.name}`;
    const videoRef = ref(storage, videoPath);

    await uploadBytes(videoRef, file);
    const url = await getDownloadURL(videoRef);

    let thumbnailUrl: string | undefined;
    let durationSeconds: number | undefined;
    try {
      const captured = await this.captureThumbnailAndDuration(file);
      durationSeconds = captured.durationSeconds;
      const thumbRef = ref(storage, `clips/personal/${uid}/${clipId}-thumb.jpg`);
      await uploadBytes(thumbRef, captured.thumbnailBlob);
      thumbnailUrl = await getDownloadURL(thumbRef);
    } catch {
      // thumbnail generation is best-effort; clip still works without it
    }

    const clip: Omit<ClipInfo, 'id'> = {
      name,
      url,
      thumbnailUrl,
      durationSeconds,
      scope: 'personal',
      ownerId: uid
    };

    const docRef = await addDoc(collection(firestore, CLIPS_COLLECTION), clip);
    return { id: docRef.id, ...clip };
  }

  private captureThumbnailAndDuration(file: File): Promise<{ thumbnailBlob: Blob; durationSeconds: number }> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = URL.createObjectURL(file);

      video.onloadedmetadata = () => {
        video.currentTime = Math.min(1, video.duration / 2);
      };

      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas context unavailable'));
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(video.src);
          if (blob) {
            resolve({ thumbnailBlob: blob, durationSeconds: video.duration });
          } else {
            reject(new Error('thumbnail capture failed'));
          }
        }, 'image/jpeg', 0.8);
      };

      video.onerror = () => reject(new Error('video load failed'));
    });
  }
}
