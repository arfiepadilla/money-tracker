// ActionPanel - Component with actions and derived display
// Demonstrates: callback props, derived values, conditional rendering

import React, { useMemo } from 'react';

export interface ActionPanelProps {
  totalClicks: number;
  history: number[];
  onReset: () => void;
}

export const ActionPanel: React.FC<ActionPanelProps> = ({
  totalClicks,
  history,
  onReset
}) => {
  // useMemo for expensive calculations - only recalculates when history changes
  const stats = useMemo(() => {
    if (history.length === 0) {
      return { average: 0, max: 0, min: 0 };
    }
    const sum = history.reduce((a, b) => a + b, 0);
    return {
      average: Math.round(sum / history.length),
      max: Math.max(...history),
      min: Math.min(...history),
    };
  }, [history]);

  return (
    <div className="p-4 bg-slate-800/50 rounded-lg space-y-3">
      {/* Stats row */}
      <div className="flex gap-4 text-sm">
        <div className="flex flex-col">
          <span className="text-slate-500 text-xs">Total Clicks</span>
          <span className="text-white font-mono">{totalClicks}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-slate-500 text-xs">Average</span>
          <span className="text-white font-mono">{stats.average}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-slate-500 text-xs">Max</span>
          <span className="text-green-400 font-mono">{stats.max}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-slate-500 text-xs">Min</span>
          <span className="text-orange-400 font-mono">{stats.min}</span>
        </div>
      </div>

      {/* History display - conditional rendering */}
      {history.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          <span className="text-slate-500 text-xs mr-2">History:</span>
          {history.map((value, index) => (
            <span
              key={index}
              className="px-1.5 py-0.5 bg-slate-700 rounded text-xs text-slate-300 font-mono"
            >
              {value}
            </span>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-2 border-t border-slate-700">
        <button
          onClick={onReset}
          disabled={totalClicks === 0}
          className={`
            px-3 py-1.5 rounded text-xs font-medium
            transition-colors duration-150
            ${totalClicks === 0
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            }
          `}
        >
          Reset All
        </button>
      </div>
    </div>
  );
};
