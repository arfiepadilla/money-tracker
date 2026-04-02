// NO IMPORTS - This is a dynamic window!
// All dependencies are provided globally by the app

/**
 * Multi-Color Workflow Template
 *
 * This workflow demonstrates using MULTIPLE color families in a single workflow.
 * This approach is great for dashboards, creative tools, or apps with distinct feature sections.
 *
 * KEY PRINCIPLE: Use a neutral base (slate) so accent colors pop, and assign each color a PURPOSE.
 *
 * WHEN TO USE THIS TEMPLATE:
 * - Dashboards with multiple distinct sections/metrics
 * - Creative tools where different tools/modes need color coding
 * - Apps with multiple feature categories that benefit from visual distinction
 * - Games or entertainment apps where variety enhances the experience
 *
 * WHEN NOT TO USE:
 * - Professional/focused tools (docs, terminals) - use single-color template
 * - When calm, cohesive aesthetic is more important than visual variety
 */

const MultiColorWorkflowWindow: React.FC = () => {
  const [activeSection, setActiveSection] = React.useState('dashboard');
  const [metrics] = React.useState({
    dataProcessed: 1234,
    aiRequests: 567,
    systemHealth: 98,
    activeUsers: 89
  });

  return (
    // Neutral slate base - lets colorful sections stand out
    <div className="min-h-full bg-slate-950 text-slate-100 p-6 overflow-auto">

      {/* Header - can use gradient for visual interest */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
          Multi-Color Dashboard
        </h1>
        <p className="text-slate-400 text-sm">
          Demonstrates using multiple color families with purpose
        </p>
      </div>

      {/* Navigation - each section gets its own color */}
      <div className="flex flex-wrap gap-2 mb-6 bg-slate-900 p-2 rounded-lg">
        <button
          onClick={() => setActiveSection('dashboard')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeSection === 'dashboard'
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          📊 Dashboard
        </button>
        <button
          onClick={() => setActiveSection('ai')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeSection === 'ai'
              ? 'bg-purple-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          🤖 AI Tools
        </button>
        <button
          onClick={() => setActiveSection('data')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeSection === 'data'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          📈 Analytics
        </button>
        <button
          onClick={() => setActiveSection('creative')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeSection === 'creative'
              ? 'bg-pink-600 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          🎨 Creative
        </button>
      </div>

      {/* Dashboard View - Multiple metric cards with different colors */}
      {activeSection === 'dashboard' && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-slate-100 mb-4">System Overview</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Blue - Data/Analytics metric */}
            <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-blue-100 font-semibold">Data Processed</h3>
                <div className="text-2xl">📊</div>
              </div>
              <div className="text-3xl font-bold text-blue-400 mb-1">{metrics.dataProcessed}</div>
              <div className="text-blue-300 text-sm">records today</div>
              <button className="mt-4 w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">
                View Details
              </button>
            </div>

            {/* Purple - AI metric */}
            <div className="bg-purple-900/30 border border-purple-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-purple-100 font-semibold">AI Requests</h3>
                <div className="text-2xl">🤖</div>
              </div>
              <div className="text-3xl font-bold text-purple-400 mb-1">{metrics.aiRequests}</div>
              <div className="text-purple-300 text-sm">processed today</div>
              <button className="mt-4 w-full px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors">
                View Models
              </button>
            </div>

            {/* Emerald - System health metric */}
            <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-emerald-100 font-semibold">System Health</h3>
                <div className="text-2xl">💚</div>
              </div>
              <div className="text-3xl font-bold text-emerald-400 mb-1">{metrics.systemHealth}%</div>
              <div className="text-emerald-300 text-sm">all systems operational</div>
              <button className="mt-4 w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors">
                View Status
              </button>
            </div>

            {/* Pink - User metric */}
            <div className="bg-pink-900/30 border border-pink-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-pink-100 font-semibold">Active Users</h3>
                <div className="text-2xl">👥</div>
              </div>
              <div className="text-3xl font-bold text-pink-400 mb-1">{metrics.activeUsers}</div>
              <div className="text-pink-300 text-sm">online now</div>
              <button className="mt-4 w-full px-4 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-lg font-medium transition-colors">
                View Users
              </button>
            </div>

          </div>

          {/* Status indicators - always use semantic colors */}
          <div className="bg-slate-900 rounded-lg border border-slate-700 p-6">
            <h3 className="text-slate-100 font-semibold mb-4">Recent Activity</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-green-400 text-sm font-medium">Success:</span>
                <span className="text-slate-300 text-sm">Data backup completed</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span className="text-blue-400 text-sm font-medium">Info:</span>
                <span className="text-slate-300 text-sm">System update available</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg">
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                <span className="text-yellow-400 text-sm font-medium">Warning:</span>
                <span className="text-slate-300 text-sm">High memory usage detected</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Tools View - Purple theme dominant */}
      {activeSection === 'ai' && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-purple-100 mb-4">AI Tools</h2>

          <div className="bg-purple-900 rounded-lg border border-purple-700 p-6">
            <h3 className="text-purple-100 font-semibold mb-4">Text Generation</h3>

            <textarea
              className="w-full bg-purple-950 border border-purple-700 text-purple-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 mb-4"
              rows={4}
              placeholder="Enter your prompt here..."
            />

            <div className="flex gap-2">
              <button className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors">
                Generate
              </button>
              <button className="px-4 py-2 bg-purple-800 hover:bg-purple-700 text-purple-200 rounded-lg font-medium transition-colors">
                Clear
              </button>
            </div>
          </div>

          <div className="bg-purple-900 rounded-lg border border-purple-700 p-6">
            <h3 className="text-purple-100 font-semibold mb-4">Available Models</h3>

            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-purple-800 rounded-lg">
                <div>
                  <div className="text-purple-100 font-medium">GPT-4</div>
                  <div className="text-purple-400 text-xs">Most capable model</div>
                </div>
                <span className="px-2 py-1 bg-emerald-600 text-white text-xs rounded-full">Active</span>
              </div>

              <div className="flex items-center justify-between p-3 bg-purple-800 rounded-lg">
                <div>
                  <div className="text-purple-100 font-medium">Claude</div>
                  <div className="text-purple-400 text-xs">Long context specialist</div>
                </div>
                <span className="px-2 py-1 bg-slate-600 text-slate-300 text-xs rounded-full">Offline</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Data Analytics View - Emerald theme dominant */}
      {activeSection === 'data' && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-emerald-100 mb-4">Data Analytics</h2>

          <div className="bg-emerald-900 rounded-lg border border-emerald-700 p-6">
            <h3 className="text-emerald-100 font-semibold mb-4">Query Builder</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-emerald-200 text-sm font-medium mb-2">
                  Data Source
                </label>
                <select className="w-full bg-emerald-950 border border-emerald-700 text-emerald-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <option>Database A</option>
                  <option>Database B</option>
                  <option>API Endpoint</option>
                </select>
              </div>

              <div>
                <label className="block text-emerald-200 text-sm font-medium mb-2">
                  Time Range
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium">
                    Last 24h
                  </button>
                  <button className="px-3 py-2 bg-emerald-800 hover:bg-emerald-700 text-emerald-200 rounded-lg text-sm font-medium transition-colors">
                    Last 7d
                  </button>
                </div>
              </div>

              <button className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors">
                Run Query
              </button>
            </div>
          </div>

          <div className="bg-emerald-900 rounded-lg border border-emerald-700 p-6">
            <h3 className="text-emerald-100 font-semibold mb-4">Recent Exports</h3>

            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-emerald-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">📄</div>
                  <div>
                    <div className="text-emerald-100 text-sm">report_2024.csv</div>
                    <div className="text-emerald-400 text-xs">2.4 MB</div>
                  </div>
                </div>
                <button className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs transition-colors">
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Creative Tools View - Pink theme dominant */}
      {activeSection === 'creative' && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-pink-100 mb-4">Creative Tools</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Color Palette Generator */}
            <div className="bg-pink-900 rounded-lg border border-pink-700 p-6">
              <h3 className="text-pink-100 font-semibold mb-4">Color Palette</h3>

              <div className="flex gap-2 mb-4">
                <div className="flex-1 h-16 bg-pink-600 rounded"></div>
                <div className="flex-1 h-16 bg-purple-600 rounded"></div>
                <div className="flex-1 h-16 bg-blue-600 rounded"></div>
                <div className="flex-1 h-16 bg-emerald-600 rounded"></div>
              </div>

              <button className="w-full px-4 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-lg font-medium transition-colors">
                Generate New
              </button>
            </div>

            {/* Gradient Builder */}
            <div className="bg-pink-900 rounded-lg border border-pink-700 p-6">
              <h3 className="text-pink-100 font-semibold mb-4">Gradient Builder</h3>

              <div className="h-16 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 rounded mb-4"></div>

              <div className="flex gap-2">
                <button className="flex-1 px-3 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-lg text-sm font-medium transition-colors">
                  Linear
                </button>
                <button className="flex-1 px-3 py-2 bg-pink-800 hover:bg-pink-700 text-pink-200 rounded-lg text-sm font-medium transition-colors">
                  Radial
                </button>
              </div>
            </div>

          </div>

          {/* Design Tools */}
          <div className="bg-pink-900 rounded-lg border border-pink-700 p-6">
            <h3 className="text-pink-100 font-semibold mb-4">Quick Actions</h3>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button className="p-4 bg-pink-800 hover:bg-pink-700 rounded-lg transition-colors text-center">
                <div className="text-2xl mb-2">✏️</div>
                <div className="text-pink-200 text-sm font-medium">Draw</div>
              </button>

              <button className="p-4 bg-purple-800 hover:bg-purple-700 rounded-lg transition-colors text-center">
                <div className="text-2xl mb-2">🖼️</div>
                <div className="text-purple-200 text-sm font-medium">Image</div>
              </button>

              <button className="p-4 bg-blue-800 hover:bg-blue-700 rounded-lg transition-colors text-center">
                <div className="text-2xl mb-2">🔤</div>
                <div className="text-blue-200 text-sm font-medium">Text</div>
              </button>

              <button className="p-4 bg-orange-800 hover:bg-orange-700 rounded-lg transition-colors text-center">
                <div className="text-2xl mb-2">⭐</div>
                <div className="text-orange-200 text-sm font-medium">Shapes</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer with tips */}
      <div className="mt-8 pt-6 border-t border-slate-700">
        <div className="bg-slate-900 rounded-lg border border-slate-700 p-4">
          <h4 className="text-slate-100 font-semibold mb-2 text-sm">💡 Multi-Color Design Tips</h4>
          <ul className="text-slate-400 text-xs space-y-1">
            <li>• Use neutral slate base (950/900) to let accent colors stand out</li>
            <li>• Assign each color a specific PURPOSE (blue=data, purple=AI, etc.)</li>
            <li>• Keep semantic colors consistent (green=success, red=error)</li>
            <li>• Use /30 or /50 opacity for subtle colored backgrounds</li>
            <li>• Don't use too many colors at once - 3-5 is the sweet spot</li>
          </ul>
        </div>
      </div>

    </div>
  );
};

// Required default export for dynamic loading
export default MultiColorWorkflowWindow;
