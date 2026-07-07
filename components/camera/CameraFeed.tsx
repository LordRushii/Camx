"use client";

import { useEffect, useRef, useState } from "react";

interface CameraFeedProps {
  readonly isCameraActive: boolean;
  readonly label: string;
  readonly deviceId?: string | null;
  readonly videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export function CameraFeed({ isCameraActive, label, deviceId, videoRef: passedVideoRef }: CameraFeedProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = passedVideoRef ?? localVideoRef;
  const [error, setError] = useState<string | null>(null);

  const activeStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isCameraActive) {
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((track) => track.stop());
        activeStreamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      return;
    }

    if (!deviceId || deviceId === "none") {
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((track) => track.stop());
        activeStreamRef.current = null;
      }
      setTimeout(() => {
        setError("Webcam disabled for this feed. Displaying diagnostic template.");
      }, 0);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      return;
    }

    let active = true;
    setTimeout(() => setError(null), 0);

    const constraints: MediaStreamConstraints = {
      video: { deviceId: { exact: deviceId } },
      audio: false,
    };

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((mediaStream) => {
        if (!active) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        if (activeStreamRef.current) {
          activeStreamRef.current.getTracks().forEach((track) => track.stop());
        }

        activeStreamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      })
      .catch((err) => {
        if (active) {
          console.warn("Failed to get webcam stream, using mock feed:", err);
          setError("Webcam permission denied or device busy. Displaying simulated feed.");
        }
      });

    return () => {
      active = false;
    };
  }, [isCameraActive, deviceId]);

  if (!isCameraActive) {
    return (
      <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center text-muted-foreground border border-border/20 rounded-md select-none">
        <span className="text-3xl mb-2">📹</span>
        <span className="text-xs font-semibold uppercase tracking-wider">Feed Inactive</span>
        <span className="text-xxs opacity-70 mt-1">Start camera controls to stream</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center border border-border/20 rounded-md select-none overflow-hidden">
        {/* Animated grid simulation */}
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff05_1px,transparent_1px)] [background-size:16px_16px]" />
        
        {/* Scan lines */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-900/10 to-zinc-950/20 bg-[size:100%_4px] pointer-events-none" />

        <div className="z-10 text-center px-6 space-y-2">
          <div className="flex justify-center items-center gap-1.5 text-xs text-status-warning font-bold uppercase tracking-wider animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-status-warning" />
            SIMULATED FEED ACTIVE
          </div>
          <p className="text-xxs text-muted-foreground font-mono truncate max-w-[280px]">{label}</p>
          <div className="text-[10px] text-muted-foreground/60 leading-normal max-w-[240px]">
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="w-full h-full object-cover scale-x-[-1] rounded-md"
    />
  );
}
