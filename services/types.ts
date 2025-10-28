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

// Fix: The inline type for `window.aistudio` was causing a TypeScript type conflict.
// To resolve this, the `AIStudio` interface is moved into the `declare global` block,
// ensuring it is a true global type and preventing module-scoping conflicts.
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    webkitAudioContext: typeof AudioContext;
    aistudio?: AIStudio;
  }
}