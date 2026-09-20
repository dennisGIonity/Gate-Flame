const fs = require('fs');

let code = fs.readFileSync('src/components/GravityParticleCanvas.tsx', 'utf8');

// 1. Change isVisibleRef to state
code = code.replace(
  /const isVisibleRef = useRef<boolean>\(true\);/,
  "const [isVisible, setIsVisible] = React.useState(true);"
);

// 2. Extract intersectionObserver to its own useEffect
const intersectionObserverCode = `
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    if (parentRef.current) {
      observer.observe(parentRef.current);
    } else if (canvasRef.current && canvasRef.current.parentElement) {
      observer.observe(canvasRef.current.parentElement);
    }
    return () => observer.disconnect();
  }, []);
`;

// wait, parentRef is set in the main useEffect, so maybe it's better to observe canvasRef directly.
const intersectionObserverFixedCode = `
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
`;

code = code.replace(
  /useEffect\(\(\) => \{/,
  intersectionObserverFixedCode + "\n\n  useEffect(() => {"
);

// 3. Remove old intersection observer logic
code = code.replace(
  /const intersectionObserver = new IntersectionObserver\([\s\S]*?intersectionObserver\.observe\(canvas\);/,
  ""
);

code = code.replace(
  /intersectionObserver\.disconnect\(\);/,
  ""
);

// 4. Update the render loop to just return early
code = code.replace(
  /if \(!isVisibleRef\.current\) \{\s+animationFrameId = requestAnimationFrame\(render\);\s+return;\s+\}/,
  ""
);

// 5. Add !isVisible early return
code = code.replace(
  /const render = \(\) => \{/,
  "if (!isVisible) return;\n\n    const render = (time: number) => {"
);

// 6. Fix dependencies
code = code.replace(
  /  \}, \[isPaused\]\);/,
  "  }, [isPaused, isVisible]);"
);

fs.writeFileSync('src/components/GravityParticleCanvas.tsx', code);
