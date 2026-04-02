// StatusDisplay - Presentational status message component
// Demonstrates: pure component, variant styles, no internal state

import React from 'react';

// Export interface for TypeScript consumers
export interface StatusDisplayProps {
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  icon?: boolean;
}

// Style mappings - defined outside component for performance
const typeStyles = {
  info: 'bg-blue-500/20 border-l-blue-500 text-blue-200',
  success: 'bg-green-500/20 border-l-green-500 text-green-200',
  warning: 'bg-yellow-500/20 border-l-yellow-500 text-yellow-200',
  error: 'bg-red-500/20 border-l-red-500 text-red-200',
};

const typeIcons = {
  info: 'i',
  success: '✓',
  warning: '!',
  error: '✕',
};

// Pure presentational component - no internal state
export const StatusDisplay: React.FC<StatusDisplayProps> = ({
  message,
  type = 'info',
  icon = true
}) => {
  return (
    <div
      className={`
        py-3 px-4 border-l-4 rounded text-sm
        flex items-center gap-2
        ${typeStyles[type]}
      `}
    >
      {icon && (
        <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs font-bold">
          {typeIcons[type]}
        </span>
      )}
      <span>{message}</span>
    </div>
  );
};
