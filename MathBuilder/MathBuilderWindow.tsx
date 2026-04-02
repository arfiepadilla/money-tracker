import React, { useState, useEffect } from 'react';

interface BlockProps {
  index: number;
  color?: string;
}

const Block: React.FC<BlockProps> = ({ index, color = '#3b82f6' }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), index * 100);
    return () => clearTimeout(timer);
  }, [index]);

  return (
    <div
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'scale(1)' : 'scale(0)',
        transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        width: '50px',
        height: '50px',
        borderRadius: '10px',
        backgroundColor: color,
        boxShadow: '0 6px 12px rgba(0,0,0,0.3)',
        margin: '8px',
      }}
    />
  );
};

interface Confetti {
  id: number;
  left: number;
  delay: number;
  color: string;
}

const Confetti: React.FC<{ confetti: Confetti }> = ({ confetti }) => (
  <div
    key={confetti.id}
    style={{
      position: 'fixed',
      left: `${confetti.left}%`,
      top: '-10px',
      fontSize: '40px',
      animation: `fall 3s linear ${confetti.delay}s infinite`,
      pointerEvents: 'none',
      zIndex: 1000,
    }}
  >
    {['🎉', '⭐', '🎈', '🌟', '✨'][confetti.id % 5]}
  </div>
);

export default function MathBuilderWindow() {
  const [num1, setNum1] = useState(5);
  const [num2, setNum2] = useState(3);
  const [operation, setOperation] = useState<'+' | '-'>('+');
  const [userAnswer, setUserAnswer] = useState('');
  const [showCelebration, setShowCelebration] = useState(false);
  const [confetti, setConfetti] = useState<Confetti[]>([]);
  const [questionCount, setQuestionCount] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'incorrect' | null>(null);

  const generateQuestion = () => {
    const ops = ['+', '-'] as const;
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a = Math.floor(Math.random() * 10) + 1;
    let b = Math.floor(Math.random() * 10) + 1;

    if (op === '-' && a < b) {
      [a, b] = [b, a];
    }

    setNum1(a);
    setNum2(b);
    setOperation(op);
  };

  const correctAnswer = operation === '+' ? num1 + num2 : num1 - num2;

  const handleAnswerClick = (digit: number) => {
    setUserAnswer(userAnswer + digit.toString());
    setFeedback(null);
  };

  const handleClear = () => {
    setUserAnswer('');
    setFeedback(null);
  };

  const handleSubmit = () => {
    const answer = parseInt(userAnswer);
    if (answer === correctAnswer) {
      setFeedback('correct');
      setShowCelebration(true);

      // Create confetti
      const newConfetti = Array.from({ length: 15 }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        color: ['#ff6b6b', '#ffd93d', '#6bcf7f', '#4d96ff', '#ff6b9d'][i % 5],
      }));
      setConfetti(newConfetti);

      setTimeout(() => {
        setShowCelebration(false);
        setFeedback(null);
        setUserAnswer('');
        setQuestionCount(questionCount + 1);
        generateQuestion();
      }, 3000);
    } else {
      setFeedback('incorrect');
    }
  };

  useEffect(() => {
    if (questionCount === 0) {
      generateQuestion();
    }
  }, []);

  const buttonStyle: React.CSSProperties = {
    fontSize: '28px',
    fontWeight: 'bold',
    padding: '15px 25px',
    margin: '8px',
    borderRadius: '15px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 6px 12px rgba(0,0,0,0.2)',
    color: '#fff',
  };

  const totalBlocks = operation === '+' ? num1 + num2 : num1;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '30px',
        fontFamily: 'Arial, sans-serif',
        overflow: 'auto',
        position: 'relative',
      }}
    >
      {/* Confetti */}
      {confetti.map((c) => (
        <Confetti key={c.id} confetti={c} />
      ))}

      {/* Title */}
      <div style={{ fontSize: '44px', fontWeight: 'bold', color: '#fff', marginBottom: '20px' }}>
        🎓 Math Builder
      </div>

      {/* Question */}
      <div
        style={{
          fontSize: '64px',
          fontWeight: 'bold',
          color: '#fff',
          textShadow: '3px 3px 6px rgba(0,0,0,0.3)',
          marginBottom: '30px',
          textAlign: 'center',
        }}
      >
        {num1} {operation} {num2} = ?
      </div>

      {/* Blocks Visualization */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '120px',
          maxWidth: '600px',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '25px',
          padding: '25px',
          backdropFilter: 'blur(10px)',
          marginBottom: '30px',
          gap: '5px',
        }}
      >
        {operation === '+' ? (
          <>
            {Array.from({ length: num1 }).map((_, i) => (
              <Block key={`a-${i}`} index={i} color="#3b82f6" />
            ))}
            <div style={{ fontSize: '32px', color: '#fff', margin: '0 10px', fontWeight: 'bold' }}>
              +
            </div>
            {Array.from({ length: num2 }).map((_, i) => (
              <Block key={`b-${i}`} index={i + num1} color="#10b981" />
            ))}
          </>
        ) : (
          <>
            {Array.from({ length: num1 }).map((_, i) => (
              <Block key={`a-${i}`} index={i} color="#3b82f6" />
            ))}
            <div style={{ fontSize: '32px', color: '#fff', margin: '0 10px', fontWeight: 'bold' }}>
              −
            </div>
            {Array.from({ length: num2 }).map((_, i) => (
              <Block key={`b-${i}`} index={i} color="#ef4444" />
            ))}
          </>
        )}
      </div>

      {/* Answer Display */}
      <div
        style={{
          fontSize: '56px',
          fontWeight: 'bold',
          color: '#fff',
          backgroundColor: 'rgba(255, 255, 255, 0.2)',
          padding: '20px 40px',
          borderRadius: '20px',
          minWidth: '200px',
          textAlign: 'center',
          marginBottom: '30px',
          minHeight: '80px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {userAnswer || '?'}
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: feedback === 'correct' ? '#4ade80' : '#ef4444',
            marginBottom: '20px',
            animation: 'bounce 0.6s ease',
          }}
        >
          {feedback === 'correct' ? '✅ Correct!' : '❌ Try again!'}
        </div>
      )}

      {/* Celebration Message */}
      {showCelebration && (
        <div
          style={{
            fontSize: '48px',
            fontWeight: 'bold',
            color: '#ffd93d',
            textShadow: '3px 3px 6px rgba(0,0,0,0.4)',
            animation: 'bounce 0.6s ease infinite',
            marginBottom: '20px',
          }}
        >
          🎉 Awesome! 🎉
        </div>
      )}

      {/* Number Buttons */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '10px',
          marginBottom: '20px',
          maxWidth: '500px',
        }}
      >
        {Array.from({ length: 10 }).map((_, i) => (
          <button
            key={i}
            onClick={() => handleAnswerClick(i)}
            disabled={showCelebration}
            style={{
              ...buttonStyle,
              backgroundColor: '#3b82f6',
              opacity: showCelebration ? 0.5 : 1,
              cursor: showCelebration ? 'not-allowed' : 'pointer',
              fontSize: '24px',
              padding: '15px',
            }}
          >
            {i}
          </button>
        ))}
      </div>

      {/* Control Buttons */}
      <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={handleClear}
          disabled={showCelebration}
          style={{
            ...buttonStyle,
            backgroundColor: '#f59e0b',
            opacity: showCelebration ? 0.5 : 1,
            cursor: showCelebration ? 'not-allowed' : 'pointer',
          }}
        >
          🔄 Clear
        </button>

        <button
          onClick={handleSubmit}
          disabled={userAnswer === '' || showCelebration}
          style={{
            ...buttonStyle,
            backgroundColor: userAnswer && !showCelebration ? '#4ade80' : '#9ca3af',
            cursor: userAnswer && !showCelebration ? 'pointer' : 'not-allowed',
            fontSize: '32px',
          }}
        >
          ✓ Check
        </button>
      </div>

      {/* Questions Solved Counter */}
      <div
        style={{
          marginTop: '30px',
          fontSize: '20px',
          color: 'rgba(255, 255, 255, 0.8)',
          fontWeight: 'bold',
        }}
      >
        {questionCount > 0 && `Problems solved: ${questionCount}`}
      </div>

      <style>{`
        @keyframes fall {
          to {
            transform: translateY(100vh) rotate(360deg);
            opacity: 0;
          }
        }
        @keyframes bounce {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.2);
          }
        }
      `}</style>
    </div>
  );
}
