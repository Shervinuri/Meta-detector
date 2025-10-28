export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedObject {
  name: string;
  box: BoundingBox;
}

export type AppStatus = 'IDLE' | 'SELECT_KEY' | 'REQUESTING_PERMISSIONS' | 'READY' | 'LISTENING' | 'ANALYZING' | 'ERROR' | 'QUOTA_ERROR';

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}
