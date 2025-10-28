import React, { useRef, useEffect, forwardRef } from 'react';
import { DetectedObject } from '../services/types';

interface CameraFeedProps {
  stream: MediaStream | null;
  detectedObjects: DetectedObject[];
  selectedObject: DetectedObject | null;
  onObjectSelect: (object: DetectedObject | null) => void;
}

const CameraFeed = forwardRef<HTMLVideoElement, CameraFeedProps>(({ stream, detectedObjects, selectedObject, onObjectSelect }, ref) => {
  const videoRef = (ref as React.RefObject<HTMLVideoElement>) || useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, videoRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (event: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        let clickedObject: DetectedObject | null = null;
        // Iterate backwards to select the top-most object
        for (let i = detectedObjects.length - 1; i >= 0; i--) {
            const obj = detectedObjects[i];
            const { x: normX, y: normY, width: normW, height: normH } = obj.box;
            const objX = normX * canvas.width;
            const objY = normY * canvas.height;
            const objWidth = normW * canvas.width;
            const objHeight = normH * canvas.height;

            if (x >= objX && x <= objX + objWidth && y >= objY && y <= objY + objHeight) {
                clickedObject = obj;
                break; 
            }
        }
        onObjectSelect(clickedObject);
    };

    canvas.addEventListener('click', handleClick);
    return () => {
        canvas.removeEventListener('click', handleClick);
    };
}, [detectedObjects, onObjectSelect]);


  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      detectedObjects.forEach(obj => {
        const { x, y, width, height } = obj.box;
        const rectX = x * canvas.width;
        const rectY = y * canvas.height;
        const rectWidth = width * canvas.width;
        const rectHeight = height * canvas.height;
        
        const isSelected = selectedObject && selectedObject.name === obj.name && JSON.stringify(selectedObject.box) === JSON.stringify(obj.box);

        // Draw bounding box
        ctx.strokeStyle = isSelected ? '#FFFF00' : '#00FFFF'; // Yellow if selected, Cyan otherwise
        ctx.lineWidth = isSelected ? 6 : 4;
        ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);

        if (isSelected) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.2)'; // Add a semi-transparent yellow fill
            ctx.fillRect(rectX, rectY, rectWidth, rectHeight);
        }

        // Draw label
        ctx.fillStyle = isSelected ? '#FFFF00' : '#00FFFF';
        ctx.font = '20px sans-serif';
        ctx.textBaseline = 'top';
        const label = obj.name;
        const textMetrics = ctx.measureText(label);
        const textWidth = textMetrics.width;
        const textHeight = 20; 

        ctx.fillRect(rectX, rectY, textWidth + 8, textHeight + 8);
        ctx.fillStyle = '#000000';
        ctx.fillText(label, rectX + 4, rectY + 4);
      });
    };
    
    draw();
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(video);

    return () => {
      resizeObserver.unobserve(video);
    };

  }, [detectedObjects, selectedObject, videoRef]);

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      ></video>
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full cursor-pointer"
      ></canvas>
    </div>
  );
});

export default CameraFeed;