import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Crosshair, Sparkles, ShieldAlert } from 'lucide-react';

interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  type: 'threat' | 'clean';
  popped: boolean;
  spawnTime: number;
  wobbleOffset: number;
  wobbleSpeed: number;
}

export const IonicrobesGame: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const [gameOver, setGameOver] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Neon glowing colors
  const colors = [
    '225, 29, 72',   // Rose
    '244, 63, 94',   // Pink-Rose
    '245, 158, 11',  // Amber
    '239, 68, 68',   // Red
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      if (containerRef.current) {
        observer.unobserve(containerRef.current);
      }
    };
  }, []);

  const startGame = () => {
    setScore(0);
    setIsPlaying(true);
    setGameOver(false);
    particlesRef.current = [];
  };

  useEffect(() => {
    if (!isPlaying || !isVisible) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = canvas.width = canvas.parentElement?.clientWidth || 400;
    let height = canvas.height = canvas.parentElement?.clientHeight || 400;

    const handleResize = () => {
      width = canvas.width = canvas.parentElement?.clientWidth || 400;
      height = canvas.height = canvas.parentElement?.clientHeight || 400;
    };
    window.addEventListener('resize', handleResize);

    let lastSpawn = 0;
    let spawnRate = 900; // ms

    let isCancelled = false;
    const render = (time: number) => {
      if (isCancelled) return;
      ctx.clearRect(0, 0, width, height);

      // Grid background
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.03)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      // Draw center core
      const coreX = width / 2;
      const coreY = height / 2;
      
      const coreGradient = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, 50);
      coreGradient.addColorStop(0, 'rgba(14, 165, 233, 0.4)');
      coreGradient.addColorStop(0.5, 'rgba(14, 165, 233, 0.1)');
      coreGradient.addColorStop(1, 'rgba(14, 165, 233, 0)');
      
      ctx.beginPath();
      ctx.arc(coreX, coreY, 50, 0, Math.PI * 2);
      ctx.fillStyle = coreGradient;
      ctx.fill();

      ctx.strokeStyle = 'rgba(14, 165, 233, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(coreX, coreY, 25, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(coreX, coreY, 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(14, 165, 233, 0.2)';
      ctx.fill();
      
      // Gradually increase difficulty
      spawnRate = Math.max(300, 900 - (score / 100) * 20);

      // Spawn new particles
      if (time - lastSpawn > spawnRate && particlesRef.current.length < 25) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.max(width, height) / 2 + 60;
        
        particlesRef.current.push({
          id: Math.random().toString(),
          x: coreX + Math.cos(angle) * dist,
          y: coreY + Math.sin(angle) * dist,
          vx: -Math.cos(angle) * (0.4 + Math.random() * 0.6),
          vy: -Math.sin(angle) * (0.4 + Math.random() * 0.6),
          radius: 12 + Math.random() * 10,
          color: colors[Math.floor(Math.random() * colors.length)],
          type: 'threat',
          popped: false,
          spawnTime: time,
          wobbleOffset: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.002 + Math.random() * 0.003
        });
        lastSpawn = time;
      }

      // Update and draw
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        if (p.popped) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        p.x += p.vx;
        p.y += p.vy;

        // Check if reached core
        const dx = coreX - p.x;
        const dy = coreY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 25) {
          setGameOver(true);
          setIsPlaying(false);
          particlesRef.current.splice(i, 1);
          continue;
        }

        // Biomorphic wobble effect
        const currentRadius = p.radius + Math.sin(time * p.wobbleSpeed + p.wobbleOffset) * 2;
        
        // Draw ambient glow
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, currentRadius * 2);
        gradient.addColorStop(0, `rgba(${p.color}, 0.5)`);
        gradient.addColorStop(0.5, `rgba(${p.color}, 0.2)`);
        gradient.addColorStop(1, `rgba(${p.color}, 0)`);
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentRadius * 2, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw membrane
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentRadius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, 0.15)`;
        ctx.fill();
        
        ctx.strokeStyle = `rgba(${p.color}, 0.8)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Inner nucleus
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(time * 0.005) * 2, p.y + Math.sin(time * 0.005) * 2, currentRadius * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, 0.4)`;
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      isCancelled = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", handleResize);
    };
  }, [isPlaying, score, isVisible]);

  const handleInteraction = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isPlaying) return;
    
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    let hit = false;
    for (let i = particlesRef.current.length - 1; i >= 0; i--) {
      const p = particlesRef.current[i];
      const dx = p.x - x;
      const dy = p.y - y;
      
      if (Math.sqrt(dx * dx + dy * dy) < p.radius + 20) { // generous hitbox
        p.popped = true;
        hit = true;
      }
    }

    if (hit) {
      setScore(s => s + 100);
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${embedded ? "h-full" : "h-[400px]"} bg-slate-950/80 rounded-2xl border border-slate-800 overflow-hidden font-sans flex flex-col shadow-inner`}>
      {/* Header */}
      <div className="absolute top-0 inset-x-0 p-3 flex justify-between items-center z-10 bg-gradient-to-b from-slate-950 to-transparent pointer-events-none">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-bold text-sky-100 tracking-widest uppercase">Ionicrobes</span>
        </div>
        <div className="bg-slate-900/60 backdrop-blur-md px-3 py-1 rounded-full border border-sky-900/50 flex items-center gap-2 shadow-[0_0_10px_rgba(14,165,233,0.1)]">
          <Crosshair className="w-3 h-3 text-emerald-400" />
          <span className="text-[10px] font-mono font-bold text-emerald-50">{score}</span>
        </div>
      </div>

      {!isPlaying && !gameOver && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/40 backdrop-blur-md">
          <div className="bg-slate-900/80 backdrop-blur-xl border border-sky-500/20 p-8 rounded-3xl flex flex-col items-center text-center shadow-[0_0_40px_rgba(14,165,233,0.15)] max-w-[280px]">
            <Sparkles className="w-10 h-10 text-sky-400 mb-4 animate-pulse drop-shadow-[0_0_10px_rgba(56,189,248,0.5)]" />
            <h3 className="text-lg font-display font-medium text-white mb-2">Threat Neutralizer</h3>
            <p className="text-xs text-sky-100/70 mb-6 leading-relaxed">
              Tap the Ionicrobes before they breach the core network.
            </p>
            <button 
              onClick={startGame}
              className="px-6 py-2.5 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/50 text-sky-300 text-sm font-medium rounded-full transition-all active:scale-95 hover:shadow-[0_0_20px_rgba(14,165,233,0.3)]"
            >
              Start Defense
            </button>
          </div>
        </div>
      )}

      {gameOver && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-md">
          <div className="bg-rose-950/40 backdrop-blur-xl border border-rose-500/30 p-8 rounded-3xl flex flex-col items-center text-center shadow-[0_0_40px_rgba(225,29,72,0.2)] max-w-[280px]">
            <ShieldAlert className="w-12 h-12 text-rose-500 mb-4 drop-shadow-[0_0_15px_rgba(244,63,94,0.6)]" />
            <h3 className="text-xl font-display font-medium text-white mb-1">Core Breached</h3>
            <p className="text-sm text-rose-200/80 mb-6 font-mono tracking-wider">SCORE: {score}</p>
            <button 
              onClick={startGame}
              className="px-6 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/50 text-rose-300 text-sm font-medium rounded-full transition-all active:scale-95 hover:shadow-[0_0_20px_rgba(225,29,72,0.4)] tracking-wide"
            >
              Reboot System
            </button>
          </div>
        </div>
      )}

      <canvas 
        ref={canvasRef} 
        className="flex-1 w-full block cursor-crosshair touch-none"
        onMouseDown={handleInteraction}
        onTouchStart={handleInteraction}
      />
    </div>
  );
};
