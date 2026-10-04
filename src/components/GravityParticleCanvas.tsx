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

import { useConnection } from '../hooks/useConnection';
import { useReducedMotion } from './kiosk/charts';

/**
 * Why the field is stopped, when it is.
 *
 *   owner     the owner paused filtering        the core says PAUSED
 *   fault     bypass / degraded / unconfigured  the core says nothing
 *   unknown   the box has not answered          the core says nothing
 *
 * Until 2026-10-03 every stopped field said PAUSED, so a box that had FAILED,
 * or one the phone simply could not reach, carried the word for a choice
 * nobody made - underneath a hero reading "Not filtering" or "Cannot see your
 * box". The field still stops in all three; only the owner's own pause is named.
 */
export type GravityStoppedBy = 'owner' | 'fault' | 'unknown';

interface GravityParticleCanvasProps {
  isPaused?: boolean;
  /** Read only while `isPaused`. Omitted means the owner paused (the old meaning). */
  stoppedBy?: GravityStoppedBy;
  /**
   * Real blocked-domain names observed by the node. When non-empty these are
   * the ONLY labels drawn.
   */
  threatFeed?: string[];
  /** Real allowed-domain names observed by the node. */
  cleanFeed?: string[];
  /**
   * Real block rate, 0-100, used for the threat/clean particle mix. Omitted
   * means unknown, and the mix carries no meaning.
   */
  blockPercentage?: number | null;
  /**
   * Overrides the live connection state. Normally omitted - the component
   * reads the real one from useConnection(), so a caller cannot accidentally
   * tell it that a live node is a demo.
   */
  dataSource?: 'live' | 'offline' | 'connecting' | 'error';
}

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

/** What the simulation reads each frame. Held in a ref so a new reading moves
 *  the picture instead of restarting it - see the note on the effect below. */
interface LiveInputs {
  isPaused: boolean;
  stoppedBy: GravityStoppedBy;
  blockPercentage: number | null;
  threatFeed: string[];
  cleanFeed: string[];
}

const MAX_PARTICLES = 30;

/** The word on the core, or '' for none. See GravityStoppedBy. */
const coreLabel = (isPaused: boolean, stoppedBy: GravityStoppedBy): string =>
  !isPaused ? 'GRAVITY' : stoppedBy === 'owner' ? 'PAUSED' : '';

export const GravityParticleCanvas: React.FC<GravityParticleCanvasProps> = React.memo(({
  isPaused = false,
  stoppedBy = 'owner',
  threatFeed,
  cleanFeed,
  blockPercentage = null,
  dataSource: dataSourceOverride,
}) => {
  const connection = useConnection();
  // Kept for callers that pass it; the picture no longer differs by source,
  // because the invented-label pools that once keyed off it are gone.
  void (dataSourceOverride ?? connection.dataSource);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = React.useState(true);
  const reduced = useReducedMotion();

  /*
   * The simulation used to be rebuilt on every prop change. HomeScreen passes
   * `threatFeed={[]}` - a fresh array each render - and `blockPercentage`
   * changes with every 4 s poll, so all thirty particles respawned at random
   * positions every few seconds: a visible stutter on the one screen a
   * customer opens most. The live values now travel through a ref that the
   * running loop reads each frame, and the effect depends only on whether
   * the canvas is on screen and whether motion is allowed.
   */
  const live = useRef<LiveInputs>({
    isPaused,
    stoppedBy,
    blockPercentage,
    threatFeed: threatFeed ?? [],
    cleanFeed: cleanFeed ?? [],
  });
  live.current = {
    isPaused,
    stoppedBy,
    blockPercentage,
    threatFeed: threatFeed ?? [],
    cleanFeed: cleanFeed ?? [],
  };

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 },
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
    if (!isVisible) return;

    // Device-pixel aware: at 2-3x on a phone a 1x canvas renders its labels
    // and rings blurry. Capped at 2 so a tablet does not pay for pixels nobody
    // can see.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let width = 0;
    let height = 0;
    const fit = (w: number, h: number) => {
      width = Math.max(1, w);
      height = Math.max(1, h);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit(parent.clientWidth || 600, parent.clientHeight || 200);

    let animationFrameId = 0;
    let isCancelled = false;

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            for (const entry of entries) {
              if (entry.contentRect) fit(entry.contentRect.width, entry.contentRect.height);
            }
            if (reduced) drawFrame();
          })
        : null;
    resizeObserver?.observe(parent);

    // Labels are only ever drawn from REAL data.
    //
    // This canvas used to invent them: a 70% "threat" rate with names picked
    // at random from a list - Ransomware, Phishing, Malware - drawn streaming
    // into the core. On the first hardware deployment the node's threat log
    // was EMPTY and Pi-hole was not installed, and the kiosk still showed a
    // steady flow of blocked malware. That is not a placeholder, it is a
    // fabricated security event on a security product's own display.
    //
    // The motion stays: it is decoration and reads as decoration. The words do
    // not, because a domain name on a threat dashboard is a claim. With no
    // real feed the particles fly unlabelled.
    const pickLabel = (isThreat: boolean): string => {
      const pool = isThreat ? live.current.threatFeed : live.current.cleanFeed;
      if (pool.length === 0) return '';
      return pool[Math.floor(Math.random() * pool.length)];
    };

    const createParticle = (): Particle => {
      // Ratio comes from the real block rate when we have one. Falling back to
      // a fixed 70% "threat" mix made an idle network look besieged.
      const bp = live.current.blockPercentage;
      const threatRatio = typeof bp === 'number' && bp >= 0 && bp <= 100 ? bp / 100 : 0.5;
      const isThreat = Math.random() < threatRatio;
      const type = isThreat ? 'threat' : 'clean';
      const label = pickLabel(isThreat);
      const color = isThreat
        ? Math.random() > 0.5
          ? '#E11D48'
          : '#F59E0B' // Rose or Amber
        : '#0EA5E9'; // Sky blue for clean DNS

      return {
        x: Math.random() * (width * 0.3),
        y: Math.random() * height,
        targetX: width * 0.5, // Gravity core centre
        targetY: height * 0.5,
        radius: Math.random() * 2.5 + 1.5,
        color,
        speed: Math.random() * 1.5 + 1.0,
        type,
        label,
        alpha: 0.9,
      };
    };

    const particles: Particle[] = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      particles.push(createParticle());
    }

    let ringAngle = 0;

    /** One frame. `advance` false draws the scene without moving anything. */
    const drawFrame = (advance = false) => {
      const paused = live.current.isPaused;
      ctx.clearRect(0, 0, width, height);

      // Grid
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

      if (advance) ringAngle += 0.02;

      ctx.save();
      ctx.translate(coreX, coreY);

      // Outer pulsing shield ring
      ctx.beginPath();
      ctx.arc(0, 0, 36 + Math.sin(ringAngle * 2) * 3, 0, Math.PI * 2);
      ctx.strokeStyle = paused ? 'rgba(225, 29, 72, 0.4)' : 'rgba(14, 165, 233, 0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.stroke();

      // Inner rotating core
      ctx.rotate(ringAngle);
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fillStyle = paused ? 'rgba(225, 29, 72, 0.15)' : 'rgba(14, 165, 233, 0.15)';
      ctx.fill();
      ctx.strokeStyle = paused ? '#E11D48' : '#0EA5E9';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();

      // Core symbol. Decoration naming the core; "PAUSED" only for the owner's
      // own pause - see GravityStoppedBy.
      const word = coreLabel(paused, live.current.stoppedBy);
      if (word) {
        ctx.fillStyle = paused ? '#E11D48' : '#0EA5E9';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(word, 0, 0);
      }

      ctx.restore();

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (advance) {
          if (dist > 30) {
            p.x += (dx / dist) * p.speed;
            p.y += (dy / dist) * p.speed;
          } else {
            if (p.type === 'threat' && !paused) {
              // Neutralisation spark
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
              ctx.fill();
            } else if (p.type === 'clean') {
              // A clean lookup passes through to the right side
              p.x += p.speed * 2;
            }
            if (dist <= 30 || p.x > width) {
              particles[i] = createParticle();
              continue;
            }
          }
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();

        if (dist < 120 && p.type === 'threat' && !paused) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(coreX, coreY);
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        if (p.label && p.radius > 2.5 && dist > 50) {
          ctx.fillStyle = p.color;
          ctx.font = '9px monospace';
          ctx.globalAlpha = 0.7;
          ctx.fillText(p.label, p.x + 6, p.y + 3);
        }

        ctx.globalAlpha = 1.0;
      }
    };

    if (reduced) {
      // Someone who asked for less movement gets the finished picture: the
      // grid, the core and the field, standing still. Never a blank panel.
      drawFrame(false);
    } else {
      const render = () => {
        if (isCancelled) return;
        drawFrame(true);
        animationFrameId = requestAnimationFrame(render);
      };
      animationFrameId = requestAnimationFrame(render);
    }

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animationFrameId);
      resizeObserver?.disconnect();
    };
  }, [isVisible, reduced]);

  return (
    <div className="relative w-full h-full bg-slate-950 rounded-[24px] border border-slate-800 overflow-hidden shadow-sm font-sans">
      <canvas ref={canvasRef} className="w-full h-full block" aria-hidden="true" />
      {/*
        A caption badge stood here until 2026-10-03: "GRAVITY™ EDGE AI THREAT
        INTERCEPTOR" beside a permanently pinging dot. Removed on Dennis's call.
        The box is a DNS blocklist filter; "AI threat interceptor" was a claim
        it cannot back, on the one screen whose job is telling the truth, and a
        dot that pings forever is a timer dressed as a live feed (charts.tsx,
        rule 2). The legend below carries the real figure and stays.
      */}
      <div className="absolute bottom-3 right-3 flex items-center gap-3 text-[10px] font-medium text-slate-400 bg-slate-900/80 backdrop-blur-sm px-2.5 py-1.5 rounded-lg border border-slate-800 uppercase tracking-wider">
        {/*
          THIS FIGURE WAS HARDCODED AS "37.1%" — found by screenshot, 2026-08-25.

          It sat on the customer's home screen, two inches below the real block
          share, and disagreed with it. The particles were already driven by the
          real `blockPercentage`; only the caption was invented, which is the
          worst possible split: the picture told the truth and the number beside
          it did not. A customer reading 7% above and 37.1% here has no way to
          know which one to believe, and every reason to stop believing both.

          Now it renders the same prop the simulation uses, and an em-dash when
          there is no reading — the rule that governs every other figure in this
          product finally applied to the one that was exempt from it.
        */}
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-500"></span> Blocked (
          {typeof blockPercentage === 'number' ? `${blockPercentage.toFixed(1)}%` : '—'})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-sky-500"></span> Clean Recursive DNS
        </span>
      </div>
    </div>
  );
});
