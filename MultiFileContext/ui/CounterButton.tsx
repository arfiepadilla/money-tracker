// CounterButton - Reusable stateful button component
// Demonstrates: props interface, default values, useCallback, color variants

import React, { useState, useCallback } from 'react';

// Always export interfaces for TypeScript support
export interface CounterButtonProps {
  label: string;
  initialCount?: number;
  step?: number;
  color?: 'blue' | 'purple' | 'green' | 'orange';
  onCountChange?: (count: number) => void;
}

// Color variant styles - defined outside component for performance
const colorStyles = {
  blue: 'bg-blue-500 hover:bg-blue-600',
  purple: 'bg-purple-500 hover:bg-purple-600',
  green: 'bg-green-500 hover:bg-green-600',
  orange: 'bg-orange-500 hover:bg-orange-600',
};

export const CounterButton: React.FC<CounterButtonProps> = ({
  label,
  initialCount = 0,
  step = 1,
  color = 'blue',
  onCountChange
}) => {
  // Local state for this component's count
  const [count, setCount] = useState(initialCount);

  // useCallback prevents unnecessary re-renders of child components
  const handleClick = useCallback(() => {
    const newCount = count + step;
    setCount(newCount);
    // Notify parent via callback (lifting state up pattern)
    onCountChange?.(newCount);
  }, [count, step, onCountChange]);

  return (
    <button
      onClick={handleClick}
      className={`
        py-2.5 px-5
        ${colorStyles[color]}
        text-white border-none rounded-md
        cursor-pointer text-sm font-medium
        transition-colors duration-150
        active:scale-95
      `}
    >
      {label}: {count}
    </button>
  );
};
