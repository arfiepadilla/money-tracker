// MultiFileContext - Example of multi-file workflow with local imports
// See multi-file-workflows.md for complete documentation and system prompt

import React, { useState, useCallback } from 'react';
import { CounterButton } from './ui/CounterButton';
import { StatusDisplay } from './ui/StatusDisplay';
import { ActionPanel } from './ui/ActionPanel';

// Define state interface for type safety
interface WorkflowState {
  lastCount: number;
  totalClicks: number;
  statusType: 'info' | 'success' | 'warning';
  history: number[];
}

const initialState: WorkflowState = {
  lastCount: 0,
  totalClicks: 0,
  statusType: 'info',
  history: []
};

export const MultiFileContextWindow: React.FC = () => {
  // Centralized state - single source of truth
  const [state, setState] = useState<WorkflowState>(initialState);

  // Handler for count changes - demonstrates lifting state up
  const handleCountChange = useCallback((count: number) => {
    setState(prev => ({
      ...prev,
      lastCount: count,
      totalClicks: prev.totalClicks + 1,
      statusType: count % 5 === 0 ? 'success' : count % 3 === 0 ? 'warning' : 'info',
      history: [...prev.history.slice(-9), count] // Keep last 10
    }));
  }, []);

  // Handler for reset action
  const handleReset = useCallback(() => {
    setState(initialState);
  }, []);

  // Derive status message from state (don't store derived data)
  const statusMessage = state.lastCount === 0
    ? 'Click a counter button to start!'
    : state.lastCount % 5 === 0
      ? `Milestone reached: ${state.lastCount}!`
      : `Current count: ${state.lastCount}`;

  return (
    <div className="p-5 flex flex-col gap-5 bg-[#1a1a2e] min-h-full text-white">
      {/* Header */}
      <div>
        <h2 className="m-0 text-[#667eea] text-xl font-bold">
          Multi-File Workflow Example
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Demonstrates the bundling system with organized component files
        </p>
      </div>

      {/* Counter buttons - pass callbacks up */}
      <div className="flex gap-3 flex-wrap">
        <CounterButton
          label="Counter A"
          color="blue"
          onCountChange={handleCountChange}
        />
        <CounterButton
          label="Counter B"
          initialCount={10}
          color="purple"
          onCountChange={handleCountChange}
        />
        <CounterButton
          label="Counter C"
          initialCount={5}
          step={5}
          color="green"
          onCountChange={handleCountChange}
        />
      </div>

      {/* Status display - receives state as props */}
      <StatusDisplay
        message={statusMessage}
        type={state.statusType}
      />

      {/* Action panel - demonstrates more complex child component */}
      <ActionPanel
        totalClicks={state.totalClicks}
        history={state.history}
        onReset={handleReset}
      />

      {/* Info footer */}
      <div className="mt-auto p-3 bg-[#2a2a4e] rounded-md text-xs text-slate-400">
        <strong className="text-slate-300">Multi-File Workflow</strong>
        <br />
        This window is bundled from 4 component files at load time.
        <br />
        See <code className="text-blue-400">multi-file-workflows.md</code> for documentation.
      </div>
    </div>
  );
};
