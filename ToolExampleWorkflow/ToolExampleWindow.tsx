/**
 * Tool Example Workflow
 *
 * Demonstrates how TSX workflows can register MCP tools that:
 * - Appear in the Tool Manager
 * - Are accessible via MCP to Claude Code and other MCP clients
 *
 * Note: React, useState, useEffect, useCallback, PhosphorIcons, and ToolClient
 * are provided by DynamicModuleLoader - no imports needed.
 */

interface TestResult {
  toolName: string;
  input: any;
  output: any;
  success: boolean;
  timestamp: Date;
}

const ToolExampleWindow: React.FC = () => {
  // Get icons from PhosphorIcons
  const { Wrench, Play, Stop, CheckCircle, XCircle, Lightning, ArrowClockwise } = PhosphorIcons;

  // Create ToolClient instance for this workflow
  const [toolClient] = useState(() => new ToolClient('tool-example-workflow'));
  const [published, setPublished] = useState(false);
  const [registeredTools, setRegisteredTools] = useState<string[]>([]);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testInput, setTestInput] = useState('Hello from TSX workflow!');
  const [numberA, setNumberA] = useState(10);
  const [numberB, setNumberB] = useState(5);

  // Register tools on mount
  useEffect(() => {
    // Register a simple greeting tool
    toolClient.registerTool({
      name: 'greet',
      namespace: 'tsxexample',
      description: 'Generate a greeting message from the TSX workflow',
      parameters: {
        properties: {
          name: {
            type: 'string',
            description: 'Name to greet',
            default: 'World'
          },
          style: {
            type: 'string',
            description: 'Greeting style: formal, casual, or enthusiastic',
            default: 'casual'
          }
        },
        required: []
      },
      handler: async (args) => {
        const name = args.name || 'World';
        const style = args.style || 'casual';

        let greeting;
        switch (style) {
          case 'formal':
            greeting = `Good day, ${name}. It is a pleasure to meet you.`;
            break;
          case 'enthusiastic':
            greeting = `WOW! Hey ${name}!!! So GREAT to see you! :D`;
            break;
          case 'casual':
          default:
            greeting = `Hey ${name}! How's it going?`;
        }

        return {
          greeting,
          style,
          timestamp: new Date().toISOString(),
          source: 'TSX workflow'
        };
      }
    });

    // Register a calculator tool
    toolClient.registerTool({
      name: 'calculate',
      namespace: 'tsxexample',
      description: 'Perform arithmetic calculations',
      parameters: {
        properties: {
          operation: {
            type: 'string',
            description: 'Operation: add, subtract, multiply, divide'
          },
          a: {
            type: 'number',
            description: 'First operand'
          },
          b: {
            type: 'number',
            description: 'Second operand'
          }
        },
        required: ['operation', 'a', 'b']
      },
      handler: (args) => {
        const { operation, a, b } = args;
        let result;

        switch (operation) {
          case 'add':
            result = a + b;
            break;
          case 'subtract':
            result = a - b;
            break;
          case 'multiply':
            result = a * b;
            break;
          case 'divide':
            if (b === 0) {
              return { success: false, error: 'Division by zero' };
            }
            result = a / b;
            break;
          default:
            return { success: false, error: `Unknown operation: ${operation}` };
        }

        return {
          operation,
          a,
          b,
          result,
          expression: `${a} ${operation} ${b} = ${result}`
        };
      }
    });

    // Register a text transformation tool
    toolClient.registerTool({
      name: 'transform_text',
      namespace: 'tsxexample',
      description: 'Transform text in various ways',
      parameters: {
        properties: {
          text: {
            type: 'string',
            description: 'Text to transform'
          },
          transformation: {
            type: 'string',
            description: 'Transformation: uppercase, lowercase, reverse, wordcount'
          }
        },
        required: ['text', 'transformation']
      },
      handler: (args) => {
        const { text, transformation } = args;
        let result;

        switch (transformation) {
          case 'uppercase':
            result = text.toUpperCase();
            break;
          case 'lowercase':
            result = text.toLowerCase();
            break;
          case 'reverse':
            result = text.split('').reverse().join('');
            break;
          case 'wordcount':
            result = text.split(/\s+/).filter(Boolean).length;
            break;
          default:
            return { success: false, error: `Unknown transformation: ${transformation}` };
        }

        return {
          original: text,
          transformation,
          result,
          length: text.length
        };
      }
    });

    // Update registered tools list
    setRegisteredTools(toolClient.getRegisteredTools());

    // Cleanup on unmount
    return () => {
      toolClient.unregisterTools();
    };
  }, [toolClient]);

  // Publish tools to registry
  const handlePublish = async () => {
    const success = await toolClient.publishTools();
    setPublished(success);
    if (success) {
      setRegisteredTools(toolClient.getRegisteredTools());
    }
  };

  // Unregister tools
  const handleUnregister = async () => {
    await toolClient.unregisterTools();
    setPublished(false);
    setRegisteredTools([]);
  };

  // Test a tool locally
  const testTool = async (toolName: string, args: any) => {
    // For local testing, we can invoke the registry directly
    try {
      const response = await fetch('http://127.0.0.1:8800/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName,
          namespace: 'tsxexample',
          arguments: args
        })
      });

      const result = await response.json();

      setTestResults(prev => [...prev.slice(-9), {
        toolName,
        input: args,
        output: result,
        success: result.success !== false,
        timestamp: new Date()
      }]);
    } catch (error: any) {
      setTestResults(prev => [...prev.slice(-9), {
        toolName,
        input: args,
        output: { error: error.message },
        success: false,
        timestamp: new Date()
      }]);
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-900 text-zinc-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-700">
        <div className="flex items-center gap-3">
          <Wrench size={24} className="text-purple-400" />
          <div>
            <h1 className="text-lg font-semibold">TSX Tool Example</h1>
            <p className="text-xs text-zinc-500">
              Demonstrates TSX workflow MCP tool registration
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {published ? (
            <span className="flex items-center gap-1.5 text-emerald-400 text-sm">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              Tools Published
            </span>
          ) : (
            <span className="text-zinc-500 text-sm">Not Published</span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Tool Registration */}
        <div className="w-1/2 flex flex-col border-r border-zinc-700 overflow-y-auto">
          {/* Controls */}
          <div className="p-4 border-b border-zinc-700/50 bg-zinc-800/30">
            <h2 className="text-sm font-medium text-zinc-400 mb-3">Tool Registration</h2>
            <div className="flex gap-2">
              {!published ? (
                <button
                  onClick={handlePublish}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded transition-colors"
                >
                  <Play size={18} weight="fill" />
                  Publish Tools
                </button>
              ) : (
                <button
                  onClick={handleUnregister}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded transition-colors"
                >
                  <Stop size={18} weight="fill" />
                  Unregister
                </button>
              )}
            </div>
          </div>

          {/* Registered Tools */}
          <div className="p-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Registered Tools ({registeredTools.length})</h3>
            <div className="space-y-2">
              {registeredTools.map(tool => (
                <div
                  key={tool}
                  className="p-3 bg-zinc-800/50 rounded border border-zinc-700"
                >
                  <div className="flex items-center gap-2">
                    <Lightning size={16} className="text-purple-400" />
                    <span className="font-mono text-sm text-purple-400">{tool}</span>
                  </div>
                </div>
              ))}
              {registeredTools.length === 0 && (
                <div className="text-zinc-500 text-sm p-3 bg-zinc-800/30 rounded">
                  No tools registered yet. Click "Publish Tools" to register.
                </div>
              )}
            </div>
          </div>

          {/* Tool Testing Section */}
          <div className="p-4 border-t border-zinc-700/50">
            <h3 className="text-sm font-medium text-zinc-400 mb-3">Test Tools</h3>

            {/* Greet Tool Test */}
            <div className="mb-4 p-3 bg-zinc-800/30 rounded border border-zinc-700/50">
              <div className="text-xs text-zinc-500 mb-2">tsx_example:greet</div>
              <input
                type="text"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Enter name..."
                className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-600 rounded text-sm mb-2"
              />
              <button
                onClick={() => testTool('greet', { name: testInput, style: 'casual' })}
                disabled={!published}
                className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded text-sm transition-colors disabled:opacity-50"
              >
                Test Greet
              </button>
            </div>

            {/* Calculate Tool Test */}
            <div className="mb-4 p-3 bg-zinc-800/30 rounded border border-zinc-700/50">
              <div className="text-xs text-zinc-500 mb-2">tsx_example:calculate</div>
              <div className="flex gap-2 mb-2">
                <input
                  type="number"
                  value={numberA}
                  onChange={(e) => setNumberA(Number(e.target.value))}
                  className="w-20 px-3 py-1.5 bg-zinc-800 border border-zinc-600 rounded text-sm"
                />
                <span className="text-zinc-500 self-center">+</span>
                <input
                  type="number"
                  value={numberB}
                  onChange={(e) => setNumberB(Number(e.target.value))}
                  className="w-20 px-3 py-1.5 bg-zinc-800 border border-zinc-600 rounded text-sm"
                />
              </div>
              <button
                onClick={() => testTool('calculate', { operation: 'add', a: numberA, b: numberB })}
                disabled={!published}
                className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded text-sm transition-colors disabled:opacity-50"
              >
                Test Calculate
              </button>
            </div>

            {/* Transform Tool Test */}
            <div className="p-3 bg-zinc-800/30 rounded border border-zinc-700/50">
              <div className="text-xs text-zinc-500 mb-2">tsx_example:transform_text</div>
              <button
                onClick={() => testTool('transform_text', { text: testInput, transformation: 'uppercase' })}
                disabled={!published}
                className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded text-sm transition-colors disabled:opacity-50 mr-2"
              >
                Uppercase
              </button>
              <button
                onClick={() => testTool('transform_text', { text: testInput, transformation: 'reverse' })}
                disabled={!published}
                className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded text-sm transition-colors disabled:opacity-50"
              >
                Reverse
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel - Test Results */}
        <div className="w-1/2 flex flex-col overflow-y-auto">
          <div className="p-4 border-b border-zinc-700/50 bg-zinc-800/30 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-400">Test Results</h2>
            <button
              onClick={() => setTestResults([])}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Clear
            </button>
          </div>

          <div className="flex-1 p-4 space-y-2 overflow-y-auto">
            {testResults.length === 0 ? (
              <div className="text-zinc-500 text-sm text-center py-8">
                Test results will appear here
              </div>
            ) : (
              testResults.map((result, i) => (
                <div
                  key={i}
                  className={`p-3 rounded border ${
                    result.success
                      ? 'bg-emerald-900/20 border-emerald-700'
                      : 'bg-red-900/20 border-red-700'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {result.success ? (
                      <CheckCircle size={16} className="text-emerald-400" weight="fill" />
                    ) : (
                      <XCircle size={16} className="text-red-400" weight="fill" />
                    )}
                    <span className="font-mono text-sm">{result.toolName}</span>
                    <span className="text-xs text-zinc-500 ml-auto">
                      {result.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-xs font-mono">
                    <div className="text-zinc-500">Input:</div>
                    <pre className="text-zinc-300 overflow-x-auto">
                      {JSON.stringify(result.input, null, 2)}
                    </pre>
                    <div className="text-zinc-500 mt-2">Output:</div>
                    <pre className={result.success ? 'text-emerald-300' : 'text-red-300'}>
                      {JSON.stringify(result.output, null, 2)}
                    </pre>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-zinc-700 bg-zinc-800/30 text-xs text-zinc-500">
        <p>
          <strong>Usage:</strong> Click "Publish Tools" to register the tools with the central registry.
          They will appear in the Tool Manager and be accessible via MCP.
        </p>
      </div>
    </div>
  );
};

ToolExampleWindow;
