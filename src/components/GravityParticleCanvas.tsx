/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame "Gravity Engine" Particle Visualizer
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

import React, { useEffect, useRef } from 'react';

interface GravityParticleCanvasProps {
  isPaused?: boolean;
}

export const GravityParticleCanvas: React.FC<GravityParticleCanvasProps> = React.memo(({ isPaused = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const parentRef = useRef<HTMLElement | null>(null);
  const [isVisible, setIsVisible] = React.useState(true);

  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    if (canvasRef.current) {
      observer.observe(canvasRef.current);
    }
    return () => observer.disconnect();
  }, []);


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    parentRef.current = parent;

    let animationFrameId: number;
    let width = (canvas.width = parent.clientWidth || 600);
    let height = (canvas.height = parent.clientHeight || 200);

    const resizeObserver = new ResizeObserver((entries) => {
      window.requestAnimationFrame(() => {
        for (const entry of entries) {
          if (entry.contentRect) {
            width = canvas.width = entry.contentRect.width;
            height = canvas.height = entry.contentRect.height;
          }
        }
      });
    });
    resizeObserver.observe(parent);

    

    // Particle definitions
    interface Particle {
      x: number;
      y: number;
      targetX: number;
      targetY: number;
      radius: number;
      color: string;
      speed: number;
      type: 'threat' | 'clean';
      label: string;
      alpha: number;
    }

    const threatLabels = ['Telemetry', 'Ad-Tracker', 'Ransomware', 'Phishing', 'Malware', 'Spyware', 'SmartTV-Log'];
    const cleanLabels = ['Root-DNS', 'Unbound', 'HTTPS', 'TLS-Safe'];

    const particles: Particle[] = [];
    const maxParticles = 30;

    const createParticle = (): Particle => {
      const isThreat = Math.random() < 0.7; // 70% blocked threat noise
      const type = isThreat ? 'threat' : 'clean';
      const label = isThreat 
        ? threatLabels[Math.floor(Math.random() * threatLabels.length)] 
        : cleanLabels[Math.floor(Math.random() * cleanLabels.length)];

      const color = isThreat 
        ? (Math.random() > 0.5 ? '#E11D48' : '#F59E0B') // Rose or Amber
        : '#0EA5E9'; // Sky blue for clean DNS

      return {
        x: Math.random() * (width * 0.3),
        y: Math.random() * height,
        targetX: width * 0.5, // Gravity core center
        targetY: height * 0.5,
        radius: Math.random() * 2.5 + 1.5,
        color,
        speed: Math.random() * 1.5 + 1.0,
        type,
        label,
        alpha: 0.9,
      };
    };

    // Pre-populate particles
    for (let i = 0; i < maxParticles; i++) {
      particles.push(createParticle());
    }

    // Core Gravity Ring rotation angle
    let ringAngle = 0;

    if (!isVisible) return;

    let isCancelled = false;
    const render = (time: number) => {
      if (isCancelled) return;
      
      ctx.clearRect(0, 0, width, height);

      // Draw Grid Background lines
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.05)';
      ctx.lineWidth = 1;
      const gridSize = 25;
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

      const coreX = width * 0.5;
      const coreY = height * 0.5;

      // Draw Central "Gravity Sinkhole Engine" Core
      ringAngle += 0.02;

      ctx.save();
      ctx.translate(coreX, coreY);

      // Outer Pulsing Shield Ring
      ctx.beginPath();
      ctx.arc(0, 0, 36 + Math.sin(ringAngle * 2) * 3, 0, Math.PI * 2);
      ctx.strokeStyle = isPaused ? 'rgba(225, 29, 72, 0.4)' : 'rgba(14, 165, 233, 0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.stroke();

      // Inner Rotating Core
      ctx.rotate(ringAngle);
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fillStyle = isPaused ? 'rgba(225, 29, 72, 0.15)' : 'rgba(14, 165, 233, 0.15)';
      ctx.fill();
      ctx.strokeStyle = isPaused ? '#E11D48' : '#0EA5E9';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();

      // Core Symbol
      ctx.fillStyle = isPaused ? '#E11D48' : '#0EA5E9';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isPaused ? 'PAUSED' : 'GRAVITY', 0, 0);

      ctx.restore();

      // Render & Update Particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Move particle towards center
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 30) {
          p.x += (dx / dist) * p.speed;
          p.y += (dy / dist) * p.speed;
        } else {
          // Reaching the Gravity Core:
          if (p.type === 'threat' && !isPaused) {
            // Draw neutralization spark
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
            ctx.fill();
          } else if (p.type === 'clean') {
            // Clean DNS query passes through to the right side
            p.x += p.speed * 2;
          }

          // Reset particle if absorbed or passed out of bounds
          if (dist <= 30 || p.x > width) {
            particles[i] = createParticle();
            continue;
          }
        }

        // Draw particle dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();

        // Connect threat particle line to core if close
        if (dist < 120 && p.type === 'threat' && !isPaused) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(coreX, coreY);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw label for larger particles
        if (p.radius > 2.5 && dist > 50) {
          ctx.fillStyle = p.color;
          ctx.font = '9px monospace';
          ctx.globalAlpha = 0.7;
          ctx.fillText(p.label, p.x + 6, p.y + 3);
        }

        ctx.globalAlpha = 1.0;
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      
    };
  }, [isPaused, isVisible]);

  return (
    <div className="relative w-full h-full bg-slate-950 rounded-[24px] border border-slate-800 overflow-hidden shadow-sm font-sans">
      <canvas ref={canvasRef} className="w-full h-full block" />
      <div className="absolute top-3 left-3 flex items-center gap-2 bg-slate-900/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-800 text-[10px] text-sky-500 font-bold tracking-wider uppercase">
        <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping"></span>
        <span>GRAVITY™ EDGE AI THREAT INTERCEPTOR</span>
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-3 text-[10px] font-medium text-slate-400 bg-slate-900/80 backdrop-blur-sm px-2.5 py-1.5 rounded-lg border border-slate-800 uppercase tracking-wider">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-500"></span> Blocked (37.1%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-sky-500"></span> Clean Recursive DNS
        </span>
      </div>
    </div>
  );
});
