import React, { useEffect, useRef } from 'react';

interface Props {
  level: string;
  theme: 'light' | 'dark' | 'system';
}

export const LiveBackground: React.FC<Props> = React.memo(({ level, theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

    let animationId: number;
    let time = 0;

    let width = (canvas.width = parent.clientWidth);
    let height = (canvas.height = parent.clientHeight);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          width = canvas.width = entry.contentRect.width;
          height = canvas.height = entry.contentRect.height;
        }
      }
    });
    resizeObserver.observe(parent);

    

    // Create connected nodes for the live background
    const particles = Array.from({ length: 35 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      size: Math.random() * 1.5 + 0.5,
      offset: Math.random() * Math.PI * 2
    }));

    // Create subtle dust particles for light mode
    const dustParticles = Array.from({ length: 15 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.1,
      vy: (Math.random() - 0.5) * 0.1,
      size: Math.random() * 300 + 200,
      offset: Math.random() * Math.PI * 2
    }));

    const checkIsDark = () => {
      if (theme === 'dark') return true;
      if (theme === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    };

    const getColorValues = (isDark: boolean) => {
      if (isDark) {
        return { r: 56, g: 189, b: 248 };
      }
      switch (level) {
        case 'none': return { r: 225, g: 29, b: 72 };
        case 'low': return { r: 5, g: 150, b: 105 };
        case 'medium': return { r: 147, g: 51, b: 234 };
        case 'high': return { r: 2, g: 132, b: 199 };
        default: return { r: 2, g: 132, b: 199 };
      }
    };

    if (!isVisible) return;

    const draw = () => {
      

      time += 0.005;
      ctx.clearRect(0, 0, width, height);

      const isDark = checkIsDark();
      const baseAlpha = isDark ? 0.3 : 0.15;
      const rgb = getColorValues(isDark);
      const colorStr = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
      
      // Draw light purple and orange dust patches in light mode
      if (!isDark) {
        dustParticles.forEach((p, i) => {
          p.x += p.vx;
          p.y += p.vy;

          if (p.x < -100) p.x = width + 100;
          if (p.x > width + 100) p.x = -100;
          if (p.y < -100) p.y = height + 100;
          if (p.y > height + 100) p.y = -100;

          const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          
          // Alternate between soft purple and soft orange
          const dustColorStr = i % 2 === 0 ? '168, 85, 247' : '251, 146, 60';
          gradient.addColorStop(0, `rgba(${dustColorStr}, ${0.08 + Math.sin(time + p.offset) * 0.04})`);
          gradient.addColorStop(1, `rgba(${dustColorStr}, 0)`);
          
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        });
      }

      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + Math.sin(time * 5 + p.offset) * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colorStr}, ${baseAlpha + 0.2})`;
        ctx.fill();
        
        // Connect nearby particles
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 80) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(${colorStr}, ${(1 - dist / 80) * baseAlpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      });
      
      animationId = requestAnimationFrame(draw);
    };
    
    animationId = requestAnimationFrame(draw);

    return () => {
      resizeObserver.disconnect();
      
      cancelAnimationFrame(animationId);
    };
  }, [level, theme, isVisible]);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0 transition-opacity duration-1000" />;
});
