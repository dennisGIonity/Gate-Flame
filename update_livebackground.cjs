const fs = require('fs');
let code = fs.readFileSync('src/components/LiveBackground.tsx', 'utf8');

// 1. Change isVisibleRef to state
code = code.replace(
  /const isVisibleRef = useRef<boolean>\(true\);/,
  "const [isVisible, setIsVisible] = React.useState(true);"
);

// 2. Add IntersectionObserver useEffect
const intersectionObserverCode = `
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
  intersectionObserverCode + "\n\n  useEffect(() => {"
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
  /if \(!isVisibleRef\.current\) \{\s+animationId = requestAnimationFrame\(draw\);\s+return;\s+\}/,
  ""
);

// 5. Add !isVisible early return
code = code.replace(
  /const draw = \(\) => \{/,
  "if (!isVisible) return;\n\n    const draw = () => {"
);

// 6. Fix `draw()` initial call to `requestAnimationFrame`
code = code.replace(
  /draw\(\);/,
  "animationId = requestAnimationFrame(draw);"
);

// 7. Fix dependencies
code = code.replace(
  /  \}, \[level, theme\]\);/,
  "  }, [level, theme, isVisible]);"
);

fs.writeFileSync('src/components/LiveBackground.tsx', code);
