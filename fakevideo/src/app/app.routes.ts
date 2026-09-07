import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/join-room/join-room.component').then((m) => m.JoinRoomComponent)
  },
  {
    path: 'call/:roomCode',
    loadComponent: () => import('./pages/call-room/call-room.component').then((m) => m.CallRoomComponent)
  },
  { path: '**', redirectTo: '' }
];
