/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Ionity Global (Pty) Ltd — Gate^Flame - Mini pop Protection Game
 */

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, RefreshCw, Volume2, VolumeX, ShieldCheck, Zap, Crosshair, Palette, Maximize, Minimize } from 'lucide-react';

interface Bacteria {
  id: number;
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  color: string;
  glowColor: string;
  label: string;
  tentaclesCount: number;
  pulsePhase: number;
  shape: 'circle' | 'square' | 'triangle' | 'hexagon' | 'star';
  rotation: number;
  vRot: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  opacity: number;
}

const THREAT_LABELS = [
  'AdTracker.bot',
  'Spyware.bug',
  'Ransomware.exe',
  'Phishing.phish',
  'Telemetry.leak',
  'CryptoMiner.hash',
  'Bloatware.vbs',
  'CookieSniffer.js',
];

const NEON_COLORS = [
  { main: '#10b981', glow: 'rgba(16, 185, 129, 0.6)' }, // Emerald
  { main: '#0ea5e9', glow: 'rgba(14, 165, 233, 0.6)' }, // Sky Blue
  { main: '#f43f5e', glow: 'rgba(244, 63, 94, 0.6)' },  // Rose
  { main: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.6)' }, // Violet
  { main: '#f59e0b', glow: 'rgba(245, 158, 11, 0.6)' }, // Amber
  { main: '#ef4444', glow: 'rgba(239, 68, 68, 0.6)' },  // Red
  { main: '#3b82f6', glow: 'rgba(59, 130, 246, 0.6)' }, // Blue
  { main: '#a855f7', glow: 'rgba(168, 85, 247, 0.6)' }, // Purple
];

export const BacteriaPopGame: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [poppedCount, setPoppedCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const bacteriaList = useRef<Bacteria[]>([]);
  const particles = useRef<Particle[]>([]);
  const floatingTexts = useRef<FloatingText[]>([]);
  const nextId = useRef(1);

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Resize Observer for Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const resizeCanvas = () => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      
      // Initialize or add bacteria if empty after resize
      if (bacteriaList.current.length === 0) {
        for (let i = 0; i < 15; i++) {
          bacteriaList.current.push(createSingleBacteria(canvas.width, canvas.height));
        }
      }
    };

    let animationFrameId: number;
    const resizeObserver = new ResizeObserver(() => {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = window.requestAnimationFrame(() => {
        resizeCanvas();
      });
    });

    resizeObserver.observe(parent);
    resizeCanvas();

    return () => {
      resizeObserver.disconnect();
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);

  // Synthesize satisfying audio pop via Web Audio API
  const playPopSound = () => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(400 + Math.random() * 300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {
      // Audio fallback
    }
  };

  const createSingleBacteria = (width: number, height: number): Bacteria => {
    const colorObj = NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
    const radius = 10 + Math.random() * 12; // Smaller size
    const shapes = ['circle', 'square', 'triangle', 'hexagon', 'star'] as const;
    return {
      id: nextId.current++,
      x: radius + Math.random() * (width - radius * 2),
      y: radius + Math.random() * (height - radius * 2),
      radius,
      vx: (Math.random() - 0.5) * 2.5, // slightly faster
      vy: (Math.random() - 0.5) * 2.5,
      color: colorObj.main,
      glowColor: colorObj.glow,
      label: THREAT_LABELS[Math.floor(Math.random() * THREAT_LABELS.length)],
      tentaclesCount: 3 + Math.floor(Math.random() * 5),
      pulsePhase: Math.random() * Math.PI * 2,
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      rotation: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.1,
    };
  };

  // Main Render Loop
  useEffect(() => {
    let animationFrameId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;

      // Clear Canvas with subtle trail background
      ctx.fillStyle = document.documentElement.classList.contains('theme-light') ? 'rgba(4, 30, 58, 0.4)' : 'rgba(11, 15, 25, 0.4)';
      ctx.fillRect(0, 0, width, height);

      // Draw Grid lines background (Optional, can be disabled for cleaner look)
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.4)';
      ctx.lineWidth = 1;
      const gridSize = 60;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Update & Render Bacteria
      bacteriaList.current.forEach((b) => {
        b.x += b.vx;
        b.y += b.vy;
        b.rotation += b.vRot;

        // Bounce walls
        if (b.x - b.radius < 0) { b.x = b.radius; b.vx *= -1; }
        if (b.x + b.radius > width) { b.x = width - b.radius; b.vx *= -1; }
        if (b.y - b.radius < 0) { b.y = b.radius; b.vy *= -1; }
        if (b.y + b.radius > height) { b.y = height - b.radius; b.vy *= -1; }

        b.pulsePhase += 0.05;
        const currentRadius = b.radius + Math.sin(b.pulsePhase) * 1.5;

        // Save context for rotation
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rotation);

        // Draw Tentacles first so they go behind
        ctx.strokeStyle = b.glowColor;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < b.tentaclesCount; i++) {
          const angle = (i / b.tentaclesCount) * Math.PI * 2;
          const tentacleLength = currentRadius + 5 + Math.sin(b.pulsePhase * 2 + i) * 4;
          const tx = Math.cos(angle) * tentacleLength;
          const ty = Math.sin(angle) * tentacleLength;

          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * currentRadius, Math.sin(angle) * currentRadius);
          // Curve tentacle
          ctx.quadraticCurveTo(
              Math.cos(angle + 0.5) * (tentacleLength * 0.5), 
              Math.sin(angle + 0.5) * (tentacleLength * 0.5), 
              tx, ty
          );
          ctx.stroke();

          // Tentacle tip bulb
          ctx.fillStyle = b.color;
          ctx.beginPath();
          ctx.arc(tx, ty, 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw Main Body Glow & Shape
        ctx.shadowColor = b.glowColor;
        ctx.shadowBlur = 15;
        ctx.fillStyle = b.color;
        
        ctx.beginPath();
        if (b.shape === 'circle') {
            ctx.arc(0, 0, currentRadius, 0, Math.PI * 2);
        } else if (b.shape === 'square') {
            ctx.rect(-currentRadius, -currentRadius, currentRadius * 2, currentRadius * 2);
        } else if (b.shape === 'triangle') {
            ctx.moveTo(0, -currentRadius * 1.2);
            ctx.lineTo(currentRadius * 1.1, currentRadius * 0.8);
            ctx.lineTo(-currentRadius * 1.1, currentRadius * 0.8);
            ctx.closePath();
        } else if (b.shape === 'hexagon') {
            for (let i = 0; i < 6; i++) {
                ctx.lineTo(currentRadius * 1.1 * Math.cos(i * Math.PI / 3), currentRadius * 1.1 * Math.sin(i * Math.PI / 3));
            }
            ctx.closePath();
        } else if (b.shape === 'star') {
            const rot = Math.PI / 2 * 3;
            let x = 0, y = 0;
            let step = Math.PI / 5;
            for (let i = 0; i < 5; i++) {
                x = Math.cos(rot + i * step * 2) * currentRadius * 1.3;
                y = Math.sin(rot + i * step * 2) * currentRadius * 1.3;
                ctx.lineTo(x, y);
                x = Math.cos(rot + i * step * 2 + step) * currentRadius * 0.5;
                y = Math.sin(rot + i * step * 2 + step) * currentRadius * 0.5;
                ctx.lineTo(x, y);
            }
            ctx.closePath();
        }
        ctx.fill();

        // Inner Core Nucleus
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        if (b.shape === 'square' || b.shape === 'hexagon') {
            ctx.rect(-currentRadius * 0.3, -currentRadius * 0.3, currentRadius * 0.6, currentRadius * 0.6);
        } else {
            ctx.arc(-currentRadius * 0.2, -currentRadius * 0.2, currentRadius * 0.25, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.restore(); // Restore context to draw un-rotated text

        // Label
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(243, 244, 246, 0.7)';
        ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(b.label, b.x, b.y + currentRadius + 14);
      });

      // Update & Render Burst Particles
      particles.current.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;

        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        // Star or circle particles
        if (idx % 2 === 0) {
            ctx.arc(p.x, p.y, Math.max(1, p.size * (p.life / p.maxLife)), 0, Math.PI * 2);
        } else {
            ctx.rect(p.x, p.y, Math.max(1, p.size * (p.life / p.maxLife)), Math.max(1, p.size * (p.life / p.maxLife)));
        }
        ctx.fill();

        if (p.life <= 0) {
          particles.current.splice(idx, 1);
        }
      });

      // Update & Render Floating Pop Text
      ctx.shadowBlur = 0;
      floatingTexts.current.forEach((ft, idx) => {
        ft.y -= 1.2;
        ft.opacity -= 0.02;

        ctx.fillStyle = ft.color;
        ctx.globalAlpha = Math.max(0, ft.opacity);
        ctx.font = 'bold 12px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.globalAlpha = 1;

        if (ft.opacity <= 0) {
          floatingTexts.current.splice(idx, 1);
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Handle Canvas Tap / Click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const clickY = (e.clientY - rect.top) * (canvas.height / rect.height);

    let poppedAny = false;

    // Check hit test
    // Iterate backwards to pop top-most items first
    for (let i = bacteriaList.current.length - 1; i >= 0; i--) {
        const b = bacteriaList.current[i];
        const dist = Math.hypot(clickX - b.x, clickY - b.y);
        if (dist <= b.radius + 12) {
            poppedAny = true;
            playPopSound();

            // Spawn 16 explosion particles
            for (let j = 0; j < 24; j++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 2 + Math.random() * 5;
            particles.current.push({
                id: Math.random(),
                x: b.x,
                y: b.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: b.color,
                size: 2 + Math.random() * 4,
                life: 30 + Math.random() * 20,
                maxLife: 50,
            });
            }

            // Spawn floating pop text
            const popPhrases = ['POP! -48kB', 'PURGED!', 'BLOCKED!', 'ZAPPED!', 'CLEARED!', 'DEFENDED!'];
            floatingTexts.current.push({
            id: Math.random(),
            x: b.x,
            y: b.y - 10,
            text: popPhrases[Math.floor(Math.random() * popPhrases.length)],
            color: b.color,
            opacity: 1,
            });

            // Replace with new bacteria
            bacteriaList.current[i] = createSingleBacteria(canvas.width, canvas.height);
            setPoppedCount((prev) => prev + 1);
            break; // only pop one per click
        }
    }

    if (!poppedAny) {
      // Tap empty space effect
      particles.current.push({
        id: Math.random(),
        x: clickX,
        y: clickY,
        vx: 0,
        vy: 0,
        color: '#38BDF8',
        size: 8,
        life: 15,
        maxLife: 15,
      });
    }
  };

  return (
    <div 
        ref={containerRef}
        className={`bg-slate-950 rounded-[24px] border border-slate-800 text-sky-500 shadow-sm space-y-4 font-sans flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 p-6 m-0 border-none rounded-none' : 'p-4 sm:p-5'}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3 shrink-0">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" /> Gate^Flame - Mini pop Protection
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Tap floating malware & ad trackers to pop them into zero-day defense particles
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 font-medium">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-slate-400">Popped:</span>
            <strong className="text-white font-bold">{poppedCount}</strong>
          </div>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:text-white transition-colors text-slate-400"
            title="Toggle Pop Audio"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-sky-500" /> : <VolumeX className="w-4 h-4 text-slate-600" />}
          </button>
          
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:text-white transition-colors text-slate-400"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize className="w-4 h-4 text-sky-500" /> : <Maximize className="w-4 h-4 text-sky-500" />}
          </button>
        </div>
      </div>

      {/* Interactive Game Canvas */}
      <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 cursor-crosshair flex-1 min-h-[300px]">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="w-full h-full block"
        />

        <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-medium text-sky-400 flex items-center gap-1.5 pointer-events-none shadow-sm">
          <Crosshair className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
          <span>Interactive Node Canvas &bull; Touch or Click Bacteria</span>
        </div>
      </div>

      {/* Footer Controls & Copyright */}
      <div className="flex flex-col sm:flex-row items-center justify-end gap-3 text-xs pt-1 text-slate-400 shrink-0">
        <div className="text-[11px] text-slate-500 font-medium">
          Zero-stress infinite threat sandbox &bull; Ionity Global (Pty) Ltd
        </div>
      </div>
    </div>
  );
};

