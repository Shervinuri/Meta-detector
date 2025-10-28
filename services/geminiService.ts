import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration, Blob } from "@google/genai";

// --- Audio Helper Functions ---

function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


// --- Gemini Service ---

// Fix: The `LiveSession` type is no longer exported from "@google/genai".
// A local interface is defined based on its usage within this service to
// maintain type safety for the live session object.
interface LiveSession {
  sendRealtimeInput(input: { media: Blob }): void;
  sendToolResponse(response: {
    functionResponses: {
      id: string;
      name: string;
      response: { result: any };
    };
  }): void;
  close(): void;
}


let sessionPromise: Promise<LiveSession> | null = null;
let outputAudioContext: AudioContext;
let nextStartTime = 0;
const sources = new Set<AudioBufferSourceNode>();

const displayDetectedObjectsFunctionDeclaration: FunctionDeclaration = {
  name: 'displayDetectedObjects',
  description: 'کادرهای مرزی را برای اشیاء شناسایی شده در فید دوربین نمایش می دهد. هر زمان که شیئی را که کاربر درخواست کرده است شناسایی کردید از این تابع استفاده کنید.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      detections: {
        type: Type.ARRAY,
        description: 'آرایه‌ای از اشیاء شناسایی شده در صحنه.',
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'نام شیء شناسایی شده.' },
            box: {
              type: Type.OBJECT,
              description: 'کادر مرزی شیء، با مختصات نرمال شده (۰.۰ تا ۱.۰).',
              properties: {
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                width: { type: Type.NUMBER },
                height: { type: Type.NUMBER },
              },
              required: ['x', 'y', 'width', 'height'],
            },
          },
          required: ['name', 'box'],
        },
      },
    },
    required: ['detections'],
  },
};

const clearDetectedObjectsFunctionDeclaration: FunctionDeclaration = {
    name: 'clearDetectedObjects',
    description: 'تمام کادرهای مرزی را از روی صفحه پاک می کند. زمانی که کاربر درخواست می کند کادرها حذف شوند یا زمانی که شیء دیگر در دید نیست، از این تابع استفاده کنید.',
    parameters: {
        type: Type.OBJECT,
        properties: {}
    }
};

export const startLiveSession = (callbacks: {
    onMessage: (message: LiveServerMessage) => void;
    onError: (error: ErrorEvent) => void;
    onClose: (event: CloseEvent) => void;
    onOpen: () => void;
}): Promise<LiveSession> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    nextStartTime = 0;
    
    sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: callbacks.onOpen,
            onmessage: callbacks.onMessage,
            onerror: callbacks.onError,
            onclose: callbacks.onClose,
        },
        config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            systemInstruction: "شما یک دستیار متخصص و همه‌کاره هستید. شما فید دوربین زنده را می‌بینید و به دستورات صوتی کاربر گوش می‌دهید. وظیفه اصلی شما شناسایی دقیق اشیاء، برندها، مدل‌ها و قطعات مختلف و راهنمایی در مورد تعمیرات است. برای مدیریت کادرهای روی صفحه، از ابزارهای زیر استفاده کنید:\n- `displayDetectedObjects`: هر زمان که کاربر از شما خواست محلی را نشان دهید (مثلاً 'مخزن ضدیخ کجاست؟')، از این ابزار برای کشیدن کادر دور آن استفاده کنید.\n- `clearDetectedObjects`: هر زمان که کاربر از شما خواست کادرها را بردارید (مثلاً 'کادر رو پاک کن' یا 'حالا برش دار') یا زمانی که شیء دیگر در دیدرس نیست، از این ابزار برای پاک کردن تمام کادرها از روی صفحه استفاده کنید.\n\nعلاوه بر این، شما به جستجوی وب دسترسی دارید. اگر کاربر سوالی پرسید که نیاز به اطلاعات به‌روز، اخبار، یا دانش عمومی دارد (مثلاً 'جدیدترین مدل این ماشین کی عرضه شده؟' یا 'قیمت این قطعه چقدر است؟')، از جستجوی وب برای یافتن پاسخ دقیق و جدید استفاده کنید. پاسخ‌های صوتی خود را واضح، مفید و جامع ارائه دهید.",
            tools: [
                { functionDeclarations: [displayDetectedObjectsFunctionDeclaration, clearDetectedObjectsFunctionDeclaration] },
                { googleSearch: {} }
            ]
        },
    });
    return sessionPromise;
};

export const streamAudio = (audioData: Float32Array) => {
    if (!sessionPromise) return;

    const l = audioData.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = audioData[i] * 32768;
    }
    const pcmBlob: Blob = {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };

    sessionPromise.then((session) => {
        session.sendRealtimeInput({ media: pcmBlob });
    });
};

export const streamImageFrame = (imageDataBase64: string) => {
    if (!sessionPromise) return;

    const imageBlob: Blob = {
        data: imageDataBase64,
        mimeType: 'image/jpeg',
    };

    sessionPromise.then((session) => {
        session.sendRealtimeInput({ media: imageBlob });
    });
};

export const sendToolResponse = (id: string, name: string, result: any) => {
    if (!sessionPromise) return;
    sessionPromise.then((session) => {
        session.sendToolResponse({
            functionResponses: {
                id : id,
                name: name,
                response: { result: result },
            }
        })
    });
};

export const playAudioResponse = async (base64Audio: string) => {
    if (!outputAudioContext || outputAudioContext.state === 'closed') return;

    nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
    const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
    const source = outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputAudioContext.destination);
    source.addEventListener('ended', () => {
        sources.delete(source);
    });
    source.start(nextStartTime);
    nextStartTime += audioBuffer.duration;
    sources.add(source);
};

export const stopAudioPlayback = () => {
    for (const source of sources.values()) {
        source.stop();
        sources.delete(source);
    }
    nextStartTime = 0;
};

export const closeLiveSession = () => {
    if (sessionPromise) {
        sessionPromise.then(session => session.close());
        sessionPromise = null;
    }
    if (outputAudioContext && outputAudioContext.state !== 'closed') {
        outputAudioContext.close();
    }
};