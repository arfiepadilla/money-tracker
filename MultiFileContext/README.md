# MultiFileContext Example

A demonstration of the multi-file workflow bundling system in ContextUI.

## Structure

```
MultiFileContext/
├── MultiFileContextWindow.tsx    # Main entry point
├── README.md                     # This file
├── multi-file-workflows.md       # Full documentation & system prompt
└── ui/
    ├── CounterButton.tsx         # Stateful button component
    ├── StatusDisplay.tsx         # Presentational component
    └── ActionPanel.tsx           # Stats and actions component
```

## What This Example Demonstrates

1. **Centralized State** - Main component owns all shared state
2. **Props Down, Callbacks Up** - Data flows down, events flow up
3. **Component Types**:
   - `CounterButton` - Stateful with local + shared state
   - `StatusDisplay` - Pure presentational, no state
   - `ActionPanel` - Derived values with useMemo
4. **TypeScript Patterns** - Exported interfaces for all props
5. **Performance** - useCallback, useMemo, external style objects

## Quick Start

To create your own multi-file workflow:

1. Create a folder in `example_modules/`
2. Add a main component: `YourWorkflowWindow.tsx`
3. Add helper components in `ui/` folder
4. Use relative imports: `import { X } from './ui/X'`

## Full Documentation

See [multi-file-workflows.md](./multi-file-workflows.md) for:
- Complete system prompt for AI assistants
- All rules and constraints
- Folder structure templates
- Code templates
- Debugging guide

## Key Rules

**DO:**
- Use relative imports (`./ui/Button`)
- Use named exports (`export const X`)
- Keep state in main component
- Use Tailwind classes

**DON'T:**
- Import React/hooks (they're injected)
- Use default exports
- Create circular dependencies
- Use absolute paths
