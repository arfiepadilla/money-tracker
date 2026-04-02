# Multi-File Workflow Development Guide

## System Prompt for AI Assistants

```
You are an expert assistant for building React workflows in ContextUI. You help users create organized, multi-file workflows that leverage the automatic bundling system.

## Core Knowledge

### The Bundling System
ContextUI automatically bundles multi-file workflows at load time:
1. Detects local imports (paths starting with `./` or `../`)
2. Resolves all dependencies recursively using topological sort
3. Transforms files: strips imports, removes export keywords, wraps helpers in IIFEs
4. Combines all files in dependency order (dependencies first, main file last)
5. Executes bundled code with injected globals

### Injected Globals (DO NOT IMPORT)
These are available automatically - never import them:
- React: React, useState, useEffect, useRef, useCallback, useMemo
- 3D: WebGLSceneManager, THREE, OrbitControls
- Utilities: XLSX, JSZip
- System: EventBus, WindowManager, ModuleManager, ToolClient
- Icons: PhosphorIcons
- Editor: TiptapReact and all Tiptap extensions

### File Structure Requirements
- Main entry point: *Window.tsx at workflow root
- Helper files: organized in subfolders (ui/, state/, utils/, etc.)
- Only root-level .tsx/.jsx files appear in workflow list
- Subfolder files are bundled automatically when imported

## Your Role
1. Design clean file structures for workflows
2. Write components following the bundling rules
3. Help organize code into logical modules
4. Debug bundling issues
5. Suggest patterns for state management and component composition

## When Writing Code
- Always use relative imports for local files
- Never import React, useState, useEffect, etc. - they are injected globals
- Use named exports only (no default exports)
- Use Tailwind CSS classes for styling
- Keep state centralized in the main component
- Pass data down via props, callbacks up for state changes
```

---

## Rules Reference

### MUST DO

| Rule | Explanation |
|------|-------------|
| Use relative imports | `'./ui/Button'` or `'../utils/helper'` - bundler only processes these |
| Use named exports | `export const Component = ...` - default exports are not supported |
| Export interfaces | `export interface Props { }` - enables TypeScript support |
| Keep main component at root | `WorkflowWindow.tsx` must be at folder root level |
| Organize by purpose | Use folders: `ui/`, `state/`, `utils/`, `hooks/` |
| Lift state up | Main component owns shared state, passes down via props |
| Use Tailwind classes | Globally available, no CSS imports needed |

### MUST NOT DO

| Rule | Reason |
|------|--------|
| Import external packages | React, hooks, THREE etc. are injected - importing causes errors |
| Use absolute paths | `/ui/Button` or `ui/Button` won't resolve |
| Create circular dependencies | File A imports B, B imports A - bundler will throw error |
| Use default exports | `export default Component` - use named exports instead |
| Import type-only in runtime | Type imports should use `import type { }` syntax |

---

## Folder Structure Templates

### Simple Workflow (3-5 files)
```
Workflow/
├── WorkflowWindow.tsx      # Main entry, owns state
├── README.md               # Documentation
└── ui/
    ├── Button.tsx          # Reusable button
    └── Panel.tsx           # Display panel
```

### Medium Workflow (6-15 files)
```
Workflow/
├── WorkflowWindow.tsx
├── README.md
├── ui/
│   ├── buttons/
│   │   ├── ActionButton.tsx
│   │   └── IconButton.tsx
│   └── panels/
│       ├── MainPanel.tsx
│       └── SidePanel.tsx
├── hooks/
│   └── useWorkflowState.ts
└── utils/
    └── helpers.ts
```

### Complex Workflow (15+ files)
```
Workflow/
├── WorkflowWindow.tsx
├── README.md
├── types.ts                # Shared type definitions
├── constants.ts            # Configuration constants
├── components/
│   ├── Editor/
│   │   ├── Editor.tsx
│   │   ├── Toolbar.tsx
│   │   └── Canvas.tsx
│   └── Sidebar/
│       ├── Sidebar.tsx
│       └── Navigation.tsx
├── hooks/
│   ├── useEditor.ts
│   └── useSelection.ts
├── managers/
│   ├── UndoRedoManager.ts
│   └── ClipboardManager.ts
└── utils/
    ├── calculations.ts
    └── formatters.ts
```

---

## Code Templates

### Helper Component Template

```typescript
// ui/ExampleComponent.tsx

// Note: React hooks are injected globals - import statement is for TypeScript only
import React, { useState, useCallback } from 'react';

export interface ExampleComponentProps {
  label: string;
  value?: number;
  onChange?: (value: number) => void;
}

export const ExampleComponent: React.FC<ExampleComponentProps> = ({
  label,
  value = 0,
  onChange
}) => {
  const [localState, setLocalState] = useState(value);

  const handleAction = useCallback(() => {
    const newValue = localState + 1;
    setLocalState(newValue);
    onChange?.(newValue);
  }, [localState, onChange]);

  return (
    <div className="p-4 bg-slate-800 rounded-lg">
      <span className="text-white">{label}: {localState}</span>
      <button
        onClick={handleAction}
        className="ml-2 px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
      >
        Increment
      </button>
    </div>
  );
};
```

### Main Window Template

```typescript
// WorkflowWindow.tsx

import React, { useState } from 'react';
import { ComponentA } from './ui/ComponentA';
import { ComponentB } from './ui/ComponentB';

// Define your state type
interface WorkflowState {
  data: string;
  value: number;
}

const initialState: WorkflowState = {
  data: '',
  value: 0
};

export const WorkflowWindow: React.FC = () => {
  // Centralized state - single source of truth
  const [state, setState] = useState<WorkflowState>(initialState);

  // Handlers for child components
  const handleDataChange = (newData: string) => {
    setState(prev => ({ ...prev, data: newData }));
  };

  const handleValueChange = (newValue: number) => {
    setState(prev => ({ ...prev, value: newValue }));
  };

  return (
    <div className="p-5 flex flex-col gap-4 bg-[#1a1a2e] min-h-full text-white">
      <h2 className="text-xl font-bold text-blue-400">Workflow Title</h2>

      <p className="text-slate-400 text-sm">
        Description of what this workflow does.
      </p>

      {/* Pass state down, receive updates via callbacks */}
      <ComponentA
        data={state.data}
        onDataChange={handleDataChange}
      />

      <ComponentB
        value={state.value}
        onValueChange={handleValueChange}
      />

      {/* Status footer */}
      <div className="mt-auto p-3 bg-slate-800/50 rounded text-xs text-slate-500">
        Current state: {JSON.stringify(state)}
      </div>
    </div>
  );
};
```

### Custom Hook Template

```typescript
// hooks/useWorkflowState.ts

import { useState, useCallback } from 'react';

export interface UseWorkflowStateOptions {
  initialValue?: number;
  maxValue?: number;
}

export interface UseWorkflowStateReturn {
  value: number;
  increment: () => void;
  decrement: () => void;
  reset: () => void;
  setValue: (value: number) => void;
}

export const useWorkflowState = (
  options: UseWorkflowStateOptions = {}
): UseWorkflowStateReturn => {
  const { initialValue = 0, maxValue = 100 } = options;
  const [value, setValueInternal] = useState(initialValue);

  const setValue = useCallback((newValue: number) => {
    setValueInternal(Math.min(Math.max(0, newValue), maxValue));
  }, [maxValue]);

  const increment = useCallback(() => {
    setValue(value + 1);
  }, [value, setValue]);

  const decrement = useCallback(() => {
    setValue(value - 1);
  }, [value, setValue]);

  const reset = useCallback(() => {
    setValueInternal(initialValue);
  }, [initialValue]);

  return { value, increment, decrement, reset, setValue };
};
```

### Utility Functions Template

```typescript
// utils/helpers.ts

export const formatNumber = (num: number): string => {
  return num.toLocaleString();
};

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

export const debounce = <T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};
```

---

## Bundling Process Explained

### What Happens at Load Time

1. **Detection**: Bundler scans main file for local imports (`./` or `../`)

2. **Resolution**: Builds dependency graph, detects circular dependencies

3. **Ordering**: Topological sort ensures dependencies load before dependents

4. **Transformation**: For each file:
   - Strips all import statements
   - Removes `export` keywords (keeps the code)
   - Wraps helper files in IIFEs that return exports

5. **Bundling**: Combines all transformed code into single bundle

6. **Execution**: Bundle runs with injected globals (React, hooks, etc.)

### Example Transformation

**Before (ui/Counter.tsx):**
```typescript
import React, { useState } from 'react';

export interface CounterProps {
  initial: number;
}

export const Counter: React.FC<CounterProps> = ({ initial }) => {
  const [count, setCount] = useState(initial);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
};
```

**After (in bundle):**
```javascript
const { Counter } = (() => {
  const Counter = ({ initial }) => {
    const [count, setCount] = useState(initial);
    return React.createElement('button',
      { onClick: () => setCount(c => c + 1) },
      count
    );
  };
  return { Counter };
})();
```

---

## Debugging Guide

### Checklist When Workflow Fails to Load

1. **Check browser console (F12)** - Look for bundler or runtime errors

2. **Verify import paths** - Must start with `./` or `../`
   ```typescript
   // Correct
   import { Button } from './ui/Button';

   // Wrong
   import { Button } from 'ui/Button';
   import { Button } from '/ui/Button';
   ```

3. **Check for circular dependencies**
   ```
   // This will fail:
   // FileA.tsx imports from FileB.tsx
   // FileB.tsx imports from FileA.tsx
   ```

4. **Confirm files exist** - Typos in filenames cause failures

5. **Use named exports only**
   ```typescript
   // Correct
   export const MyComponent = () => {};

   // Wrong
   export default MyComponent;
   ```

6. **Don't import external packages** - React/hooks are injected globals

### Console Messages

**Success:**
```
[Bundler] Bundling module: WorkflowName
[Bundler] Files bundled: 5
[Bundle] Included files: ui/A.tsx, ui/B.tsx, WorkflowWindow.tsx
```

**Failure - Circular Dependency:**
```
[Bundler] Error: Circular dependency detected: FileA.tsx -> FileB.tsx -> FileA.tsx
```

**Failure - File Not Found:**
```
[Bundler] Error: Cannot resolve module './ui/NonExistent' from 'WorkflowWindow.tsx'
```

---

## Best Practices

### Component Design

1. **Single Responsibility** - Each component does one thing well
2. **Props Interface** - Always define TypeScript interfaces for props
3. **Sensible Defaults** - Use default values for optional props
4. **Callback Naming** - Use `onXxx` for callback props (onSelect, onChange, onClick)

### State Management

1. **Lift State Up** - Keep shared state in the nearest common ancestor
2. **Single Source of Truth** - Don't duplicate state across components
3. **Immutable Updates** - Always create new objects/arrays when updating state
4. **Derived State** - Calculate values from state rather than storing duplicates

### File Organization

1. **Group by Feature** - Keep related files together
2. **Clear Naming** - Use descriptive names (UserProfileCard, not Card1)
3. **Index Files** - Use index.ts to re-export from folders (optional)
4. **Flat When Possible** - Don't over-nest; 2-3 levels is usually enough

### Performance

1. **useCallback** - Wrap callbacks passed to children
2. **useMemo** - Memoize expensive calculations
3. **Key Props** - Always provide stable keys for lists
4. **Avoid Inline Objects** - Define styles/configs outside render

---

## Quick Reference Card

```
IMPORTS:
  ./ui/Button         Local file (bundled)
  ../utils/helper     Parent folder (bundled)
  react               INJECTED - don't import

EXPORTS:
  export const X      Named export (supported)
  export interface Y  Type export (supported)
  export default Z    Default export (NOT supported)

GLOBALS AVAILABLE:
  React, useState, useEffect, useRef, useCallback, useMemo
  THREE, OrbitControls, WebGLSceneManager
  XLSX, JSZip
  EventBus, WindowManager, ModuleManager, ToolClient
  PhosphorIcons

STYLING:
  className="..."     Tailwind CSS classes (supported)
  style={{...}}       Inline styles (supported)
  import './style.css' CSS imports (NOT supported)

FILE NAMING:
  *Window.tsx         Main entry point (visible in workflow list)
  *.tsx               Helper files (hidden, bundled when imported)
  *.meta.json         Icon/color metadata (optional)
```
