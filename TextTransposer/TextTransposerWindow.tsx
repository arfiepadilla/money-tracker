/**
 * Text Transposer Workflow
 *
 * A TSX frontend for transposing text. Converts text arranged in rows/columns
 * into a transposed format where rows become columns and vice versa.
 *
 * Features:
 * - Input text area for source text
 * - Two transpose modes: by lines or by words
 * - Real-time output preview
 * - Copy to clipboard
 * - Server status monitoring
 *
 * React, useState, useEffect, useCallback, and PhosphorIcons are provided by DynamicModuleLoader
 */

const TextTransposerWindow = () => {
  // State
  const [inputText, setInputText] = React.useState("ABC\nDEF\nGHI");
  const [outputText, setOutputText] = React.useState("");
  const [mode, setMode] = React.useState("lines"); // "lines" or "words"
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [serverStatus, setServerStatus] = React.useState("checking");
  const [copied, setCopied] = React.useState(false);

  // Check server status on mount
  React.useEffect(() => {
    checkServerStatus();
  }, []);

  // Auto-transpose when input changes
  React.useEffect(() => {
    if (inputText) {
      performTranspose();
    }
  }, [inputText, mode]);

  const checkServerStatus = async () => {
    try {
      const response = await fetch("http://127.0.0.1:8796/health");
      setServerStatus(response.ok ? "running" : "error");
    } catch {
      setServerStatus("offline");
    }
  };

  const performTranspose = async () => {
    if (!inputText.trim()) {
      setOutputText("");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const toolName =
        mode === "lines" ? "transpose_by_lines" : "transpose_by_words";

      const response = await fetch("http://127.0.0.1:8796/tools/" + toolName + "/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          arguments: {
            text: inputText,
          },
        }),
      });

      const data = await response.json();

      if (data.success) {
        setOutputText(data.result);
      } else {
        setError(data.error || "Transposition failed");
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
      setServerStatus("offline");
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(outputText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy to clipboard");
    }
  };

  const clearText = () => {
    setInputText("");
    setOutputText("");
    setError("");
  };

  // Status indicator color
  const getStatusColor = () => {
    switch (serverStatus) {
      case "running":
        return "#10b981";
      case "offline":
        return "#ef4444";
      default:
        return "#f59e0b";
    }
  };

  const getStatusText = () => {
    switch (serverStatus) {
      case "running":
        return "Server Running";
      case "offline":
        return "Server Offline";
      default:
        return "Checking...";
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#1e1e1e",
        color: "#e0e0e0",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid #333",
          backgroundColor: "#252526",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>
            Text Transposer
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                backgroundColor: getStatusColor(),
              }}
            />
            <span style={{ fontSize: "12px", color: "#888" }}>
              {getStatusText()}
            </span>
          </div>
        </div>

        {/* Mode selector */}
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={() => setMode("lines")}
            style={{
              padding: "8px 16px",
              backgroundColor: mode === "lines" ? "#0ea5e9" : "#333",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 500,
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (mode !== "lines") e.target.style.backgroundColor = "#444";
            }}
            onMouseLeave={(e) => {
              if (mode !== "lines") e.target.style.backgroundColor = "#333";
            }}
          >
            By Lines
          </button>
          <button
            onClick={() => setMode("words")}
            style={{
              padding: "8px 16px",
              backgroundColor: mode === "words" ? "#0ea5e9" : "#333",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 500,
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (mode !== "words") e.target.style.backgroundColor = "#444";
            }}
            onMouseLeave={(e) => {
              if (mode !== "words") e.target.style.backgroundColor = "#333";
            }}
          >
            By Words
          </button>
        </div>
      </div>

      {/* Main content */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px",
          padding: "24px",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* Input section */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: "13px", fontWeight: 600, color: "#aaa" }}>
            Input Text
          </label>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Enter text to transpose..."
            style={{
              flex: 1,
              padding: "12px",
              backgroundColor: "#1e1e1e",
              color: "#e0e0e0",
              border: "1px solid #333",
              borderRadius: "4px",
              fontFamily: "monospace",
              fontSize: "13px",
              resize: "none",
              outline: "none",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#0ea5e9")}
            onBlur={(e) => (e.target.style.borderColor = "#333")}
          />
        </div>

        {/* Output section */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: "13px", fontWeight: 600, color: "#aaa" }}>
            Transposed Output
          </label>
          <textarea
            value={outputText}
            readOnly
            placeholder="Transposed result will appear here..."
            style={{
              flex: 1,
              padding: "12px",
              backgroundColor: "#1a1a1a",
              color: "#a0d468",
              border: "1px solid #333",
              borderRadius: "4px",
              fontFamily: "monospace",
              fontSize: "13px",
              resize: "none",
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            padding: "12px 24px",
            backgroundColor: "#3b2c2c",
            borderTop: "1px solid #663333",
            color: "#ff9999",
            fontSize: "13px",
          }}
        >
          {error}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          padding: "12px 24px",
          borderTop: "1px solid #333",
          backgroundColor: "#252526",
          display: "flex",
          gap: "8px",
          justifyContent: "flex-end",
        }}
      >
        <button
          onClick={copyToClipboard}
          disabled={!outputText || isLoading}
          style={{
            padding: "8px 16px",
            backgroundColor: copied ? "#10b981" : "#0ea5e9",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: isLoading || !outputText ? "not-allowed" : "pointer",
            fontSize: "13px",
            fontWeight: 500,
            opacity: isLoading || !outputText ? 0.5 : 1,
            transition: "background-color 0.2s",
          }}
          onMouseEnter={(e) => {
            if (!isLoading && outputText) {
              e.target.style.backgroundColor = "#0284c7";
            }
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = copied ? "#10b981" : "#0ea5e9";
          }}
        >
          {copied ? "Copied!" : "Copy Output"}
        </button>
        <button
          onClick={clearText}
          style={{
            padding: "8px 16px",
            backgroundColor: "#666",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 500,
            transition: "background-color 0.2s",
          }}
          onMouseEnter={(e) => (e.target.style.backgroundColor = "#777")}
          onMouseLeave={(e) => (e.target.style.backgroundColor = "#666")}
        >
          Clear
        </button>
      </div>
    </div>
  );
};
