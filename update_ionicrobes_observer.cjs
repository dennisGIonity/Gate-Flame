const fs = require('fs');

let code = fs.readFileSync('src/components/IonicrobesGame.tsx', 'utf8');

// 1. Add isVisible state
code = code.replace(
  /const \[gameOver, setGameOver\] = useState\(false\);/,
  "const [gameOver, setGameOver] = useState(false);\n  const [isVisible, setIsVisible] = useState(true);"
);

// 2. Add IntersectionObserver useEffect
code = code.replace(
  /const startGame = \(\) => \{/,
  `useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    if (canvasRef.current) {
      observer.observe(canvasRef.current);
    }

    return () => {
      if (canvasRef.current) {
        observer.unobserve(canvasRef.current);
      }
    };
  }, []);

  const startGame = () => {`
);

// 3. Add !isVisible return to the main useEffect
code = code.replace(
  /useEffect\(\(\) => \{\n    if \(!isPlaying\) return;/,
  "useEffect(() => {\n    if (!isPlaying || !isVisible) return;"
);

// 4. Update the dependencies of the main useEffect
code = code.replace(
  /  \}, \[isPlaying, score\]\);/,
  "  }, [isPlaying, score, isVisible]);"
);

fs.writeFileSync('src/components/IonicrobesGame.tsx', code);
