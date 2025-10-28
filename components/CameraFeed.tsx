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

    // Helper to draw rounded rectangles for labels
    const drawRoundedRect = (
        x: number,
        y: number,
        width: number,
        height: number,
        radius: number
    ) => {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
    };


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

        const color = isSelected ? '#FFFF00' : '#00FFFF';
        const lineWidth = isSelected ? 4 : 2;
        
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        
        // --- Draw High-Tech Corner Brackets ---
        const cornerSize = Math.min(rectWidth, rectHeight) * 0.15;
        
        ctx.beginPath();
        // Top-left corner
        ctx.moveTo(rectX, rectY + cornerSize);
        ctx.lineTo(rectX, rectY);
        ctx.lineTo(rectX + cornerSize, rectY);
        // Top-right corner
        ctx.moveTo(rectX + rectWidth - cornerSize, rectY);
        ctx.lineTo(rectX + rectWidth, rectY);
        ctx.lineTo(rectX + rectWidth, rectY + cornerSize);
        // Bottom-right corner
        ctx.moveTo(rectX + rectWidth, rectY + rectHeight - cornerSize);
        ctx.lineTo(rectX + rectWidth, rectY + rectHeight);
        ctx.lineTo(rectX + rectWidth - cornerSize, rectY + rectHeight);
        // Bottom-left corner
        ctx.moveTo(rectX + cornerSize, rectY + rectHeight);
        ctx.lineTo(rectX, rectY + rectHeight);
        ctx.lineTo(rectX, rectY + rectHeight - cornerSize);
        ctx.stroke();

        if (isSelected) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.1)';
            ctx.fillRect(rectX, rectY, rectWidth, rectHeight);
        }

        ctx.shadowBlur = 0; // Reset shadow for text

        // --- Draw Label Above the Box ---
        const label = obj.name;
        const fontSize = 18;
        ctx.font = `bold ${fontSize}px Inter, sans-serif`;
        ctx.textBaseline = 'bottom';
        const textMetrics = ctx.measureText(label);
        const textWidth = textMetrics.width;
        const textHeight = fontSize;
        const padding = 8;
        
        const labelX = rectX;
        const labelY = rectY - textHeight - padding;
        const labelWidth = textWidth + padding * 2;
        const labelHeight = textHeight + padding;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        drawRoundedRect(labelX, labelY, labelWidth, labelHeight, 8);
        
        ctx.fillStyle = color;
        ctx.fillText(label, labelX + padding, labelY + textHeight + (padding/2));
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