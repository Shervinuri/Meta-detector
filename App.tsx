import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DetectedObject, AppStatus } from './services/types';
import CameraFeed from './components/CameraFeed';
import {
  startLiveSession,
  closeLiveSession,
  streamAudio,
  playAudioResponse,
  stopAudioPlayback,
  streamImageFrame,
  sendToolResponse,
} from './services/geminiService';
import { LiveServerMessage } from '@google/genai';

// --- UI Components ---

const Spinner: React.FC = () => (
    <svg className="animate-spin h-10 w-10 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

// --- App Component ---

export default function App() {
  const [status, setStatus] = useState<AppStatus>('IDLE');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [selectedObject, setSelectedObject] = useState<DetectedObject | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [groundingChunks, setGroundingChunks] = useState<any[]>([]);


  const videoRef = useRef<HTMLVideoElement>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const transcriptionRef = useRef('');
  const isSessionActiveRef = useRef(false);
  const frameIntervalRef = useRef<number | null>(null);

  const handleSessionStop = useCallback(() => {
    if (!isSessionActiveRef.current) return;
    isSessionActiveRef.current = false;
    console.log("Stopping session and cleaning up resources.");

    if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
    }

    closeLiveSession();

    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
    }
    if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
        mediaStreamSourceRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
        inputAudioContextRef.current.close().then(() => {
             inputAudioContextRef.current = null;
        });
    }

    setDetectedObjects([]);
    setSelectedObject(null);
    setTranscription('');
    setGroundingChunks([]);
  }, []);

  const requestPermissionsAndSetup = useCallback(async () => {
    try {
        setStatus('REQUESTING_PERMISSIONS');
        const mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: true,
        });
        setStream(mediaStream);
        setStatus('READY');
    } catch (err: any) {
        console.error('Permission/Setup failed:', err);
        let errorMessage = 'یک خطای غیرمنتظره در هنگام راه‌اندازی رخ داد.';
         if (err instanceof Error) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
               errorMessage = 'مجوزهای دوربین و میکروفون مورد نیاز است. لطفاً دسترسی را اعطا کرده و صفحه را تازه‌سازی کنید.';
          } else {
               errorMessage = `راه‌اندازی ناموفق بود: ${err.message}`;
          }
        }
        setError(errorMessage);
        setStatus('ERROR');
    }
  }, []);

  const initialize = useCallback(async () => {
    try {
      setStatus('IDLE');
      if (!window.aistudio) {
          setError("محیط AI Studio در دسترس نیست.");
          setStatus('ERROR');
          return;
      }

      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
          setStatus('SELECT_KEY');
          return;
      }

      await requestPermissionsAndSetup();

    } catch (err: any) {
        console.error('Initialization check failed:', err);
        let errorMessage = 'یک خطای غیرمنتظره در هنگام راه‌اندازی رخ داد.';
         if (err instanceof Error) {
            errorMessage = `راه‌اندازی ناموفق بود: ${err.message}`;
        }
        setError(errorMessage);
        setStatus('ERROR');
    }
  }, [requestPermissionsAndSetup]);

  useEffect(() => {
    initialize();

    const currentStream = stream;
    return () => {
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }
        handleSessionStop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
        try {
            await window.aistudio.openSelectKey();
            // Assume key is now selected and proceed directly to the next step to avoid race conditions.
            await requestPermissionsAndSetup();
        } catch (e: any) {
            setError('امکان انتخاب کلید API وجود ندارد. ' + e.message);
            setStatus('ERROR');
        }
    }
  };
    
  const handleStopButtonClick = useCallback(() => {
      handleSessionStop();
      setStatus('READY');
  }, [handleSessionStop]);

  const handleSessionStart = useCallback(async () => {
    if (!stream) {
        setError("جریان رسانه در دسترس نیست. نمی‌توان جلسه را شروع کرد.");
        setStatus('ERROR');
        return;
    };
    
    setStatus('LISTENING');
    setDetectedObjects([]);
    setSelectedObject(null);
    setTranscription('');
    transcriptionRef.current = '';
    setGroundingChunks([]);

    try {
        await startLiveSession({
            onOpen: () => {
                console.log("Session opened.");
                isSessionActiveRef.current = true;
                const audioTracks = stream.getAudioTracks();
                if (audioTracks.length > 0) {
                    inputAudioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                    const localStream = new MediaStream([audioTracks[0]]);
                    mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(localStream);
                    scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);

                    scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        streamAudio(inputData);
                    };

                    mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                }

                if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
                frameIntervalRef.current = window.setInterval(() => {
                    if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) return;
                    
                    const video = videoRef.current;
                    if (video.readyState < 2) {
                        return;
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    const base64Data = imageDataUrl.split(',')[1];
                    streamImageFrame(base64Data);
                }, 250);
            },
            onMessage: (message: LiveServerMessage) => {
                if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
                    playAudioResponse(message.serverContent.modelTurn.parts[0].inlineData.data);
                }
                if (message.serverContent?.interrupted) {
                    stopAudioPlayback();
                }
                if (message.serverContent?.inputTranscription) {
                    transcriptionRef.current += message.serverContent.inputTranscription.text;
                    setTranscription(transcriptionRef.current);
                }
                if (message.serverContent?.groundingMetadata?.groundingChunks) {
                    setGroundingChunks(message.serverContent.groundingMetadata.groundingChunks);
                }
                if (message.toolCall) {
                    for (const fc of message.toolCall.functionCalls) {
                        if (fc.name === 'displayDetectedObjects') {
                            const detections = fc.args.detections as DetectedObject[];
                            setDetectedObjects(detections);
                            sendToolResponse(fc.id, fc.name, "اشیاء با موفقیت نمایش داده شدند.");
                        } else if (fc.name === 'clearDetectedObjects') {
                            setDetectedObjects([]);
                            setSelectedObject(null);
                            sendToolResponse(fc.id, fc.name, "کادرها با موفقیت پاک شدند.");
                        }
                    }
                }
                if (message.serverContent?.turnComplete) {
                    // A full interaction cycle (user speaks, model responds) is complete.
                    // Clear the user's last utterance from the display to indicate readiness for the next command.
                    transcriptionRef.current = '';
                    setTranscription('');
                    setGroundingChunks([]);
                }
            },
            onError: (e: ErrorEvent) => {
                console.error("Session error:", e);
                let errorMessage = "خطایی در جلسه زنده رخ داد. این ممکن است به دلیل مشکل در شبکه یا کلید API نامعتبر باشد. لطفاً دوباره امتحان کنید.";
                let nextStatus: AppStatus = 'ERROR';

                if (e.message && (e.message.includes("API key not valid") || e.message.includes("Requested entity was not found"))) {
                    errorMessage = "کلید API انتخاب شده نامعتبر یا منقضی شده است. لطفاً یک کلید جدید انتخاب کنید.";
                    nextStatus = 'SELECT_KEY';
                }
                
                setError(errorMessage);
                handleSessionStop();
                setStatus(nextStatus);
            },
            onClose: (e: CloseEvent) => {
                console.log("Session closed.", e);
                if (isSessionActiveRef.current) { // Prevent setting status if closed intentionally
                    handleSessionStop();
                    setStatus('READY');
                }
            },
        });
    } catch (e: any) {
        console.error("Failed to start session:", e);
        let errorMessage = `شروع جلسه ناموفق بود: ${e.message}`;
        let nextStatus: AppStatus = 'ERROR';

        if (e.message.includes("API key not valid") || e.message.includes("Requested entity was not found")) {
            errorMessage = "کلید API نامعتبر است. لطفاً یک کلید معتبر را انتخاب کنید.";
            nextStatus = 'SELECT_KEY';
        } else if (e.message.includes("quota")) {
            errorMessage = "شما از سهمیه خود فراتر رفته‌اید. لطفاً بعداً دوباره امتحان کنید.";
            nextStatus = 'QUOTA_ERROR';
        }
        
        setError(errorMessage);
        handleSessionStop();
        setStatus(nextStatus);
    }
  }, [stream, handleSessionStop]);

  const ProfessionalMicrophoneButton: React.FC<{ isListening: boolean; onClick: () => void; }> = ({ isListening, onClick }) => {
    const glowColor = isListening ? 'rgba(255, 82, 82, 0.7)' : 'rgba(0, 255, 255, 0.6)';
    const iconColor = isListening ? 'text-red-500' : 'text-cyan-300';

    return (
      <div className="relative">
        <button
          onClick={onClick}
          className="relative z-0 w-20 h-20 bg-black/80 rounded-full flex items-center justify-center transition-all duration-300 transform hover:scale-110"
          style={{ boxShadow: `0 0 10px 2px ${glowColor}` }}
          aria-label={isListening ? "Stop listening" : "Start listening"}
        >
          <svg className={`relative z-10 w-9 h-9 transition-colors ${iconColor}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="22"></line>
          </svg>
        </button>
      </div>
    );
  };


  const renderStatusContent = () => {
    switch(status) {
        case 'IDLE':
        case 'REQUESTING_PERMISSIONS':
            return <div className="text-center"><Spinner /> <p className="mt-4">در حال بارگذاری...</p></div>;
        case 'SELECT_KEY':
            return (
                <div className="text-center p-4 bg-yellow-900/50 rounded-lg max-w-md">
                    <p className="font-bold text-lg mb-2">نیاز به کلید API</p>
                    <p className="mb-4">{error || 'لطفاً برای استفاده از برنامه، یک کلید API را انتخاب کنید.'}</p>
                    <button onClick={handleSelectKey} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                        انتخاب کلید API
                    </button>
                </div>
            );
        case 'READY':
            return (
                <div className="flex flex-col items-center justify-end h-full pb-20">
                    <p className="mb-6 text-xl text-white drop-shadow-lg bg-black/30 px-4 py-2 rounded-lg">برای شروع تشخیص، روی میکروفون ضربه بزنید</p>
                    <ProfessionalMicrophoneButton isListening={false} onClick={handleSessionStart} />
                </div>
            );
        case 'LISTENING':
            return (
                 <div className="flex flex-col items-center justify-end h-full text-center w-full p-4 pb-12">
                     {transcription && (
                        <p className="mb-4 p-3 max-w-2xl w-full text-white text-lg font-semibold drop-shadow-lg">{transcription}</p>
                     )}
                    <ProfessionalMicrophoneButton isListening={true} onClick={handleStopButtonClick} />
                     <p className="text-lg animate-pulse mt-4 text-white drop-shadow-md">در حال گوش دادن... برای توقف ضربه بزنید</p>
                </div>
            );
        case 'ERROR':
        case 'QUOTA_ERROR':
             return (
                <div className="text-center p-4 bg-red-900/50 rounded-lg max-w-md">
                    <p className="font-bold text-lg mb-2">خطا</p>
                    <p className="mb-4">{error}</p>
                    {status === 'QUOTA_ERROR' ? (
                         <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                            مشاهده اطلاعات صورتحساب
                         </a>
                    ) : (
                         <button onClick={initialize} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                            دوباره امتحان کنید
                        </button>
                    )}
                </div>
            );
    }
  };

  const isBlockingOverlayVisible = status !== 'READY' && status !== 'LISTENING';

  return (
    <main className="w-screen h-screen bg-black text-white font-sans overflow-hidden">
      <div className="relative w-full h-full">
        {/* Camera Feed now takes up the whole background */}
        <CameraFeed
          ref={videoRef}
          stream={stream}
          detectedObjects={detectedObjects}
          selectedObject={selectedObject}
          onObjectSelect={setSelectedObject}
        />
        
        {/* Header as overlay */}
        <header className="absolute top-0 left-0 right-0 p-4 pt-6 z-10 bg-gradient-to-b from-black/70 to-transparent">
          <h1 className="text-3xl font-bold text-center text-white drop-shadow-md">SHΞN™ Meta Finder</h1>
        </header>

        {/* Content Overlay */}
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* Full-screen, blocking overlay for initial/error states */}
            {isBlockingOverlayVisible && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 pointer-events-auto">
                {renderStatusContent()}
              </div>
            )}
            
            {/* Non-blocking controls for interactive states */}
            {!isBlockingOverlayVisible && (
                <div className="w-full h-full pointer-events-auto">
                    {renderStatusContent()}
                </div>
            )}
          </div>
        </div>

        {/* Grounding Sources */}
        <div className="absolute bottom-16 left-0 right-0 p-4 z-10 flex justify-center pointer-events-none">
          {groundingChunks.length > 0 && (
            <div className="bg-black/60 backdrop-blur-sm rounded-lg p-3 max-w-md w-full pointer-events-auto">
              <h4 className="text-sm font-semibold text-gray-300 mb-2 text-center">منابع اطلاعاتی</h4>
              <ul className="flex flex-col items-center space-y-1">
                {groundingChunks.map((chunk, index) => (
                  (chunk.web && chunk.web.uri) && (
                    <li key={index} className="truncate w-full text-center">
                      <a 
                        href={chunk.web.uri} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-xs text-cyan-400 hover:text-cyan-200 hover:underline"
                        title={chunk.web.title || chunk.web.uri}
                      >
                        {chunk.web.title || new URL(chunk.web.uri).hostname.replace('www.', '')}
                      </a>
                    </li>
                  )
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer as overlay */}
        <footer className="absolute bottom-0 left-0 right-0 p-3 pb-5 text-center z-10 bg-gradient-to-t from-black/70 to-transparent">
          <a href="https://T.me/shervini" target="_blank" rel="noopener noreferrer" className="shen-link text-sm">
            Exclusive SHΞN™ made
          </a>
        </footer>
      </div>
    </main>
  );
}