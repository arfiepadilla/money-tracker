// NO IMPORTS - This is a dynamic window!
// All dependencies are provided globally by the app

/**
 * Themed Workflow Template
 *
 * This workflow demonstrates proper color theming using pure Tailwind CSS.
 * It serves as a copy-paste template for creating new workflows with consistent styling.
 *
 * INSTRUCTIONS:
 * 1. Copy this entire file to your new workflow directory
 * 2. Choose a color family from COLOR_THEME_GUIDE.md (purple, cyan, emerald, amber, slate, pink, red, orange, lime, indigo)
 * 3. Find and replace 'cyan' with your chosen color throughout this file
 * 4. Customize the content and functionality
 * 5. Test your workflow to ensure good contrast and readability
 *
 * CURRENT THEME: Cyan (Communication/Analysis)
 * Replace 'cyan' with your color: purple, emerald, amber, slate, pink, red, orange, lime, indigo
 */

const ThemedWorkflowWindow: React.FC = () => {
  // State management
  const [activeTab, setActiveTab] = React.useState(0);
  const [inputValue, setInputValue] = React.useState('');
  const [textareaValue, setTextareaValue] = React.useState('');
  const [selectValue, setSelectValue] = React.useState('option1');
  const [checkboxValue, setCheckboxValue] = React.useState(false);
  const [showSuccess, setShowSuccess] = React.useState(false);

  const handleSubmit = () => {
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  return (
    // Main container - use {color}-950 for the darkest background
    <div className="min-h-full bg-cyan-950 text-cyan-100 p-6 overflow-auto">

      {/* Header Section */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-cyan-100 mb-2">
          Themed Workflow Template
        </h1>
        <p className="text-cyan-400 text-sm">
          This demonstrates the cyan color theme using pure Tailwind classes.
          Replace 'cyan' with your chosen color family.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-cyan-800/50 p-1 rounded-lg w-fit mb-6">
        {['Buttons', 'Forms', 'Components', 'States'].map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === i
                ? 'bg-cyan-600 text-white shadow-lg'
                : 'text-cyan-400 hover:text-white hover:bg-cyan-700/50'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-6">

        {/* Buttons Tab */}
        {activeTab === 0 && (
          <div className="space-y-6">

            {/* Button Variants */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Button Variants
              </h2>

              <div className="flex flex-wrap gap-3">
                {/* Primary button - use {color}-600 with hover:{color}-500 */}
                <button className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors">
                  Primary Action
                </button>

                {/* Secondary button - use {color}-800 with hover:{color}-700 */}
                <button className="px-4 py-2 bg-cyan-800 hover:bg-cyan-700 text-cyan-200 rounded-lg font-medium transition-colors">
                  Secondary Action
                </button>

                {/* Outline button - use border-{color}-600 */}
                <button className="px-4 py-2 bg-transparent border border-cyan-600 text-cyan-400 hover:bg-cyan-800 rounded-lg font-medium transition-colors">
                  Outline Button
                </button>

                {/* Success button - always use green for success */}
                <button className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors">
                  Success
                </button>

                {/* Danger button - always use red for danger/delete */}
                <button className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors">
                  Delete
                </button>

                {/* Warning button - always use yellow for warnings */}
                <button className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-black rounded-lg font-medium transition-colors">
                  Warning
                </button>

                {/* Disabled button - use opacity-50 and cursor-not-allowed */}
                <button
                  className="px-4 py-2 bg-cyan-600 text-white rounded-lg font-medium opacity-50 cursor-not-allowed"
                  disabled
                >
                  Disabled
                </button>
              </div>
            </div>

            {/* Button Sizes */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Button Sizes
              </h2>

              <div className="flex flex-wrap items-center gap-3">
                <button className="px-2 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium transition-colors">
                  Extra Small
                </button>

                <button className="px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded-md font-medium transition-colors">
                  Small
                </button>

                <button className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors">
                  Medium (Default)
                </button>

                <button className="px-6 py-3 text-lg bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-medium transition-colors">
                  Large
                </button>
              </div>
            </div>

            {/* Icon Buttons */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Icon Buttons (Example - no actual icons)
              </h2>

              <div className="flex gap-2">
                <button className="p-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors" title="Play">
                  ▶
                </button>
                <button className="p-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors" title="Pause">
                  ⏸
                </button>
                <button className="p-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors" title="Stop">
                  ⏹
                </button>
                <button className="p-2 bg-cyan-800 hover:bg-cyan-700 text-cyan-200 rounded-lg transition-colors" title="Settings">
                  ⚙
                </button>
              </div>
            </div>

          </div>
        )}

        {/* Forms Tab */}
        {activeTab === 1 && (
          <div className="space-y-6">

            {/* Text Inputs */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Form Elements
              </h2>

              <div className="space-y-4">
                {/* Text input */}
                <div>
                  <label className="block text-cyan-200 text-sm font-medium mb-2">
                    Text Input
                  </label>
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-full bg-cyan-900 border border-cyan-700 text-cyan-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 placeholder-cyan-500"
                    placeholder="Enter text here..."
                  />
                  <p className="text-cyan-400 text-xs mt-1">Helper text goes here</p>
                </div>

                {/* Textarea */}
                <div>
                  <label className="block text-cyan-200 text-sm font-medium mb-2">
                    Textarea
                  </label>
                  <textarea
                    value={textareaValue}
                    onChange={(e) => setTextareaValue(e.target.value)}
                    className="w-full bg-cyan-900 border border-cyan-700 text-cyan-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 placeholder-cyan-500"
                    rows={4}
                    placeholder="Enter multi-line text here..."
                  />
                </div>

                {/* Select dropdown */}
                <div>
                  <label className="block text-cyan-200 text-sm font-medium mb-2">
                    Select Dropdown
                  </label>
                  <select
                    value={selectValue}
                    onChange={(e) => setSelectValue(e.target.value)}
                    className="w-full bg-cyan-900 border border-cyan-700 text-cyan-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="option1">Option 1</option>
                    <option value="option2">Option 2</option>
                    <option value="option3">Option 3</option>
                    <option value="option4">Option 4</option>
                  </select>
                </div>

                {/* Checkbox */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checkboxValue}
                      onChange={(e) => setCheckboxValue(e.target.checked)}
                      className="w-4 h-4 bg-cyan-900 border border-cyan-700 rounded focus:ring-2 focus:ring-cyan-500 cursor-pointer"
                    />
                    <span className="text-cyan-200 text-sm">I agree to the terms and conditions</span>
                  </label>
                </div>

                {/* Radio buttons */}
                <div>
                  <label className="block text-cyan-200 text-sm font-medium mb-2">
                    Radio Buttons
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="radio-example"
                        className="w-4 h-4 bg-cyan-900 border border-cyan-700 cursor-pointer"
                        defaultChecked
                      />
                      <span className="text-cyan-200 text-sm">Option A</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="radio-example"
                        className="w-4 h-4 bg-cyan-900 border border-cyan-700 cursor-pointer"
                      />
                      <span className="text-cyan-200 text-sm">Option B</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="radio-example"
                        className="w-4 h-4 bg-cyan-900 border border-cyan-700 cursor-pointer"
                      />
                      <span className="text-cyan-200 text-sm">Option C</span>
                    </label>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  onClick={handleSubmit}
                  className="w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors"
                >
                  Submit Form
                </button>
              </div>
            </div>

          </div>
        )}

        {/* Components Tab */}
        {activeTab === 2 && (
          <div className="space-y-6">

            {/* Cards */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Cards & Panels
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-cyan-800 rounded-lg p-4 border border-cyan-600">
                  <h3 className="text-cyan-100 font-semibold mb-2">Card Title 1</h3>
                  <p className="text-cyan-200 text-sm">Card content goes here. This is an example of a card component.</p>
                </div>

                <div className="bg-cyan-800 rounded-lg p-4 border border-cyan-600">
                  <h3 className="text-cyan-100 font-semibold mb-2">Card Title 2</h3>
                  <p className="text-cyan-200 text-sm">Another card with different content.</p>
                </div>
              </div>
            </div>

            {/* Badges */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Badges & Tags
              </h2>

              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-600 text-white">
                  Primary
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-800 text-cyan-200">
                  Secondary
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-600 text-white">
                  Success
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-600 text-black">
                  Warning
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-600 text-white">
                  Error
                </span>
              </div>
            </div>

            {/* Dividers */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Dividers
              </h2>

              <div className="space-y-4">
                <p className="text-cyan-200">Content above divider</p>
                <hr className="border-cyan-700" />
                <p className="text-cyan-200">Content below divider</p>
                <hr className="border-cyan-600" />
                <p className="text-cyan-200">Content with different divider color</p>
              </div>
            </div>

            {/* Lists */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Lists
              </h2>

              <div className="space-y-2">
                <div className="flex items-center gap-3 p-2 bg-cyan-800/50 rounded hover:bg-cyan-800 transition-colors cursor-pointer">
                  <div className="w-8 h-8 bg-cyan-600 rounded flex items-center justify-center text-white text-sm">
                    1
                  </div>
                  <div className="flex-1">
                    <div className="text-cyan-100 font-medium">List Item 1</div>
                    <div className="text-cyan-400 text-xs">Item description</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-2 bg-cyan-800/50 rounded hover:bg-cyan-800 transition-colors cursor-pointer">
                  <div className="w-8 h-8 bg-cyan-600 rounded flex items-center justify-center text-white text-sm">
                    2
                  </div>
                  <div className="flex-1">
                    <div className="text-cyan-100 font-medium">List Item 2</div>
                    <div className="text-cyan-400 text-xs">Item description</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-2 bg-cyan-800/50 rounded hover:bg-cyan-800 transition-colors cursor-pointer">
                  <div className="w-8 h-8 bg-cyan-600 rounded flex items-center justify-center text-white text-sm">
                    3
                  </div>
                  <div className="flex-1">
                    <div className="text-cyan-100 font-medium">List Item 3</div>
                    <div className="text-cyan-400 text-xs">Item description</div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* States Tab */}
        {activeTab === 3 && (
          <div className="space-y-6">

            {/* Status Indicators */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Status Indicators (Always use semantic colors)
              </h2>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-400">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm">Success - Operation completed successfully</span>
                </div>

                <div className="flex items-center gap-2 text-blue-400">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-sm">Info - Additional information available</span>
                </div>

                <div className="flex items-center gap-2 text-yellow-400">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                  <span className="text-sm">Warning - Proceeding requires caution</span>
                </div>

                <div className="flex items-center gap-2 text-red-400">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-sm">Error - Operation failed, please try again</span>
                </div>
              </div>
            </div>

            {/* Alert Boxes */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Alert Boxes
              </h2>

              <div className="space-y-3">
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                  <div className="text-green-400 font-semibold mb-1">Success</div>
                  <div className="text-green-300 text-sm">Your changes have been saved successfully.</div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                  <div className="text-blue-400 font-semibold mb-1">Information</div>
                  <div className="text-blue-300 text-sm">This is some important information you should know.</div>
                </div>

                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                  <div className="text-yellow-400 font-semibold mb-1">Warning</div>
                  <div className="text-yellow-300 text-sm">Please review your input before proceeding.</div>
                </div>

                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                  <div className="text-red-400 font-semibold mb-1">Error</div>
                  <div className="text-red-300 text-sm">An error occurred while processing your request.</div>
                </div>
              </div>
            </div>

            {/* Loading States */}
            <div className="bg-cyan-900 rounded-lg border border-cyan-700 p-6">
              <h2 className="text-lg font-semibold text-cyan-100 mb-4">
                Loading States
              </h2>

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 border-2 border-cyan-600 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-cyan-200">Loading spinner</span>
                </div>

                <div className="flex items-center gap-3">
                  <button className="px-4 py-2 bg-cyan-600 text-white rounded-lg font-medium opacity-50 cursor-not-allowed flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Processing...
                  </button>
                  <span className="text-cyan-200">Button with spinner</span>
                </div>

                <div className="space-y-2">
                  <div className="text-cyan-200 text-sm">Progress bar:</div>
                  <div className="w-full bg-cyan-800 rounded-full h-2">
                    <div className="bg-cyan-600 h-2 rounded-full" style={{ width: '60%' }}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Success Message (conditional) */}
            {showSuccess && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 animate-fade-in">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <div className="text-green-400 font-semibold">Form submitted successfully!</div>
                </div>
              </div>
            )}

          </div>
        )}

      </div>

      {/* Footer */}
      <div className="mt-8 pt-6 border-t border-cyan-700">
        <div className="text-cyan-400 text-xs space-y-1">
          <p>💡 Tip: To use this template, replace 'cyan' with your chosen color family</p>
          <p>📚 Available colors: purple, cyan, emerald, amber, slate, pink, red, orange, lime, indigo</p>
          <p>📖 See COLOR_THEME_GUIDE.md for complete documentation</p>
        </div>
      </div>

    </div>
  );
};

// Required default export for dynamic loading
export default ThemedWorkflowWindow;
