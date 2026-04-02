// Dynamic Word Processor Window
// Uses OS file dialogs for saving/loading documents
// Supports: HTML, TXT, DOCX, RTF, Markdown, PDF
import React, { useState, useRef, useEffect } from 'react';
import { EventBus } from '../managers/EventBus';

// Electron IPC for file operations
const { ipcRenderer } = window.require ? window.require('electron') : { ipcRenderer: null };

// JSZip for DOCX parsing (exposed globally by the app)
declare const JSZip: any;

// jsPDF for PDF export (exposed globally by the app)
declare const jspdf: any;

// PDF.js for PDF import (exposed globally by the app)
declare const pdfjsLib: any;

// Additional TipTap extensions
declare const TiptapLink: any;
declare const TiptapHighlight: any;
declare const TiptapSubscript: any;
declare const TiptapSuperscript: any;

// Find & Replace Dialog Component
const FindReplaceDialog: React.FC<{
  editor: any;
  onClose: () => void;
}> = ({ editor, onClose }) => {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);

  const findInEditor = () => {
    if (!findText || !editor) return;

    const content = editor.getText();
    const searchRegex = new RegExp(findText, caseSensitive ? 'g' : 'gi');
    const foundMatches = content.match(searchRegex);
    setMatches(foundMatches ? foundMatches.length : 0);
    setCurrentMatch(foundMatches ? 1 : 0);

    // Highlight search term (using basic search)
    if (foundMatches && foundMatches.length > 0) {
      editor.commands.focus();
    }
  };

  const replaceOne = () => {
    if (!editor || !findText) return;
    const html = editor.getHTML();
    const searchRegex = new RegExp(findText, caseSensitive ? '' : 'i');
    const newHtml = html.replace(searchRegex, replaceText);
    editor.commands.setContent(newHtml);
    findInEditor();
  };

  const replaceAll = () => {
    if (!editor || !findText) return;
    const html = editor.getHTML();
    const searchRegex = new RegExp(findText, caseSensitive ? 'g' : 'gi');
    const newHtml = html.replace(searchRegex, replaceText);
    editor.commands.setContent(newHtml);
    setMatches(0);
    setCurrentMatch(0);
  };

  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800 border border-slate-600 rounded-lg p-5 z-[1000] min-w-[400px] shadow-xl">
      <h3 className="m-0 mb-4 text-white text-base">Find & Replace</h3>

      <div className="mb-2.5">
        <input
          type="text"
          placeholder="Find..."
          value={findText}
          onChange={(e) => setFindText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && findInEditor()}
          className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white text-sm"
        />
      </div>

      <div className="mb-2.5">
        <input
          type="text"
          placeholder="Replace with..."
          value={replaceText}
          onChange={(e) => setReplaceText(e.target.value)}
          className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white text-sm"
        />
      </div>

      <div className="mb-4">
        <label className="text-slate-300 text-[13px] flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Case sensitive
        </label>
      </div>

      {matches > 0 && (
        <div className="mb-2.5 text-slate-500 text-xs">
          Found {matches} match{matches !== 1 ? 'es' : ''}
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <button
          onClick={findInEditor}
          className="py-1.5 px-3 bg-blue-500 border-none rounded text-white cursor-pointer text-xs hover:bg-blue-400 transition-colors"
        >
          Find
        </button>
        <button
          onClick={replaceOne}
          className="py-1.5 px-3 bg-emerald-500 border-none rounded text-white cursor-pointer text-xs hover:bg-emerald-400 transition-colors"
        >
          Replace
        </button>
        <button
          onClick={replaceAll}
          className="py-1.5 px-3 bg-emerald-500 border-none rounded text-white cursor-pointer text-xs hover:bg-emerald-400 transition-colors"
        >
          Replace All
        </button>
      </div>

      <button
        onClick={onClose}
        className="py-1.5 px-3 bg-slate-600 border-none rounded text-white cursor-pointer text-xs hover:bg-slate-500 transition-colors"
      >
        Close
      </button>
    </div>
  );
};

// Link Dialog Component
const LinkDialog: React.FC<{
  editor: any;
  onClose: () => void;
  initialUrl?: string;
}> = ({ editor, onClose, initialUrl = '' }) => {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState('');

  const insertLink = () => {
    if (!url) return;

    if (text) {
      editor.chain().focus().insertContent(`<a href="${url}">${text}</a>`).run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
    onClose();
  };

  const removeLink = () => {
    editor.chain().focus().unsetLink().run();
    onClose();
  };

  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800 border border-slate-600 rounded-lg p-5 z-[1000] min-w-[400px] shadow-xl">
      <h3 className="m-0 mb-4 text-white text-base">Insert Link</h3>

      <div className="mb-2.5">
        <label className="text-slate-300 text-[13px] block mb-1">
          URL
        </label>
        <input
          type="text"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && insertLink()}
          autoFocus
          className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white text-sm"
        />
      </div>

      <div className="mb-4">
        <label className="text-slate-300 text-[13px] block mb-1">
          Link Text (optional)
        </label>
        <input
          type="text"
          placeholder="Click here"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && insertLink()}
          className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white text-sm"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={insertLink}
          className="py-1.5 px-3 bg-blue-500 border-none rounded text-white cursor-pointer text-xs hover:bg-blue-400 transition-colors"
        >
          Insert
        </button>
        {initialUrl && (
          <button
            onClick={removeLink}
            className="py-1.5 px-3 bg-red-500 border-none rounded text-white cursor-pointer text-xs hover:bg-red-400 transition-colors"
          >
            Remove Link
          </button>
        )}
        <button
          onClick={onClose}
          className="py-1.5 px-3 bg-slate-600 border-none rounded text-white cursor-pointer text-xs hover:bg-slate-500 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// Image resize overlay component
const ImageResizeOverlay: React.FC<{
  image: HTMLImageElement;
  onResize: (width: number, height: number) => void;
}> = ({ image, onResize }) => {
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [initialSize, setInitialSize] = useState({ width: 0, height: 0 });
  const [initialMouse, setInitialMouse] = useState({ x: 0, y: 0 });
  const [overlayPos, setOverlayPos] = useState({ top: 0, left: 0, width: 0, height: 0 });

  // Update overlay position when image changes or resizes
  useEffect(() => {
    const updatePosition = () => {
      const rect = image.getBoundingClientRect();
      const containerRect = image.closest('.editor-scroll-container')?.getBoundingClientRect();
      if (containerRect) {
        setOverlayPos({
          top: rect.top - containerRect.top + (image.closest('.editor-scroll-container')?.scrollTop || 0),
          left: rect.left - containerRect.left + (image.closest('.editor-scroll-container')?.scrollLeft || 0),
          width: rect.width,
          height: rect.height,
        });
      }
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [image, image.width, image.height]);

  const handleMouseDown = (e: React.MouseEvent, handle: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeHandle(handle);
    setInitialMouse({ x: e.clientX, y: e.clientY });
    setInitialSize({
      width: image.offsetWidth || image.width || 300,
      height: image.offsetHeight || image.height || 200
    });
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !resizeHandle) return;

      const deltaX = e.clientX - initialMouse.x;
      const deltaY = e.clientY - initialMouse.y;

      let newWidth = initialSize.width;
      let newHeight = initialSize.height;
      const aspectRatio = initialSize.width / initialSize.height;

      if (resizeHandle.includes('e')) {
        newWidth = Math.max(50, initialSize.width + deltaX);
      }
      if (resizeHandle.includes('w')) {
        newWidth = Math.max(50, initialSize.width - deltaX);
      }
      if (resizeHandle.includes('s')) {
        newHeight = Math.max(30, initialSize.height + deltaY);
      }
      if (resizeHandle.includes('n')) {
        newHeight = Math.max(30, initialSize.height - deltaY);
      }

      // Maintain aspect ratio for corner handles
      if (resizeHandle.length === 2) {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          newHeight = newWidth / aspectRatio;
        } else {
          newWidth = newHeight * aspectRatio;
        }
      }

      onResize(Math.round(newWidth), Math.round(newHeight));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeHandle(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeHandle, initialMouse, initialSize, onResize]);

  const handlePositions = {
    nw: { top: -4, left: -4, cursor: 'nwse-resize' },
    n: { top: -4, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
    ne: { top: -4, right: -4, cursor: 'nesw-resize' },
    e: { top: '50%', right: -4, transform: 'translateY(-50%)', cursor: 'ew-resize' },
    se: { bottom: -4, right: -4, cursor: 'nwse-resize' },
    s: { bottom: -4, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
    sw: { bottom: -4, left: -4, cursor: 'nesw-resize' },
    w: { top: '50%', left: -4, transform: 'translateY(-50%)', cursor: 'ew-resize' },
  };

  return (
    <div
      className="absolute outline outline-3 outline-blue-500 pointer-events-none z-[100] shadow-[0_0_0_1px_rgba(59,130,246,0.3)]"
      style={{
        top: overlayPos.top,
        left: overlayPos.left,
        width: overlayPos.width,
        height: overlayPos.height,
      }}
    >
      {Object.entries(handlePositions).map(([handle, style]) => (
        <div
          key={handle}
          className="absolute w-[10px] h-[10px] bg-blue-500 border-2 border-white rounded-sm pointer-events-auto"
          onMouseDown={(e) => handleMouseDown(e, handle)}
          style={style}
        />
      ))}
    </div>
  );
};

export const WordProcessorWindow: React.FC = () => {
  const [fileName, setFileName] = useState('Untitled Document');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(true);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkDialogUrl, setLinkDialogUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lineSpacing, setLineSpacing] = useState<string>('1.6');
  const [jsPdfLoaded, setJsPdfLoaded] = useState(false);
  const [pdfJsLoaded, setPdfJsLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<'continuous' | 'pages'>('continuous');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const editor = TiptapReact.useEditor({
    extensions: [
      TiptapStarterKit,
      TiptapUnderline,
      TiptapTextStyle,
      TiptapColor,
      TiptapFontFamily,
      TiptapTextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TiptapTable.configure({
        resizable: true,
      }),
      TiptapTableRow,
      TiptapTableHeader,
      TiptapTableCell,
      TiptapImage.configure({
        inline: true,
        allowBase64: true,
      }),
      ...(typeof TiptapLink !== 'undefined' ? [TiptapLink.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'editor-link',
        },
      })] : []),
      ...(typeof TiptapHighlight !== 'undefined' ? [TiptapHighlight.configure({
        multicolor: true,
      })] : []),
      ...(typeof TiptapSubscript !== 'undefined' ? [TiptapSubscript] : []),
      ...(typeof TiptapSuperscript !== 'undefined' ? [TiptapSuperscript] : []),
    ],
    content: '<p>Start typing your document...</p>',
    onUpdate: () => {
      setIsSaved(false);
      // Clear selection when content changes (image might have been deleted)
      setSelectedImage(null);
    },
    editorProps: {
      attributes: {
        spellcheck: 'true',
      },
    },
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Ctrl/Cmd shortcuts
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (!modifier) return;

      switch (e.key.toLowerCase()) {
        case 's':
          e.preventDefault();
          saveDocument();
          break;
        case 'o':
          e.preventDefault();
          loadDocument();
          break;
        case 'p':
          e.preventDefault();
          handlePrint();
          break;
        case 'f':
          if (!e.shiftKey) {
            e.preventDefault();
            setShowFindReplace(true);
          }
          break;
        case 'k':
          e.preventDefault();
          handleInsertLink();
          break;
        case 'b':
          if (editor && !e.shiftKey) {
            e.preventDefault();
            editor.chain().focus().toggleBold().run();
          }
          break;
        case 'i':
          if (editor && !e.shiftKey) {
            e.preventDefault();
            editor.chain().focus().toggleItalic().run();
          }
          break;
        case 'u':
          if (editor && !e.shiftKey) {
            e.preventDefault();
            editor.chain().focus().toggleUnderline().run();
          }
          break;
        case 'z':
          if (editor) {
            e.preventDefault();
            if (e.shiftKey) {
              editor.chain().focus().redo().run();
            } else {
              editor.chain().focus().undo().run();
            }
          }
          break;
        case 'y':
          if (editor && !e.shiftKey) {
            e.preventDefault();
            editor.chain().focus().redo().run();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editor]);

  // Load jsPDF from CDN
  useEffect(() => {
    if ((window as any).jspdf) {
      setJsPdfLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = () => {
      setJsPdfLoaded(true);
    };
    document.head.appendChild(script);
  }, []);

  // Load PDF.js from CDN
  useEffect(() => {
    if ((window as any).pdfjsLib) {
      setPdfJsLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      // Set worker source
      if ((window as any).pdfjsLib) {
        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        setPdfJsLoaded(true);
      }
    };
    document.head.appendChild(script);
  }, []);

  // Handle clicking on images to select them
  useEffect(() => {
    if (!editorContainerRef.current) return;

    const container = editorContainerRef.current;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG') {
        e.preventDefault();
        setSelectedImage(target as HTMLImageElement);
      } else if (!target.closest('.resize-handle')) {
        setSelectedImage(null);
      }
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, []);

  // Handle resize
  const handleImageResize = (newWidth: number, newHeight: number) => {
    if (!selectedImage) return;
    selectedImage.style.width = `${newWidth}px`;
    selectedImage.style.height = `${newHeight}px`;
    selectedImage.setAttribute('width', String(newWidth));
    selectedImage.setAttribute('height', String(newHeight));
    setIsSaved(false);
  };

  // Delete selected image with Delete/Backspace key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedImage && (e.key === 'Delete' || e.key === 'Backspace')) {
        // Don't delete if focus is in an input or editable area
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

        // Find and remove the image from the editor
        if (editor) {
          const pos = editor.view.posAtDOM(selectedImage, 0);
          if (pos !== undefined) {
            e.preventDefault();
            editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run();
            setSelectedImage(null);
            setIsSaved(false);
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage, editor]);

  // Parse PDF file to HTML
  const parsePdf = async (base64Content: string): Promise<string> => {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library not available');
    }

    // Decode base64 to array buffer
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;

    let htmlContent = '';

    // Extract text from each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Group text items by vertical position to detect paragraphs
      const lines: { y: number; text: string }[] = [];
      let currentY = -1;
      let currentLine = '';

      for (const item of textContent.items) {
        const textItem = item as any;
        const y = Math.round(textItem.transform[5]); // Y coordinate

        // Check if this is a new line (different Y coordinate)
        if (currentY === -1 || Math.abs(y - currentY) > 2) {
          if (currentLine.trim()) {
            lines.push({ y: currentY, text: currentLine.trim() });
          }
          currentLine = textItem.str;
          currentY = y;
        } else {
          // Same line - add space if needed
          if (currentLine && !currentLine.endsWith(' ') && !textItem.str.startsWith(' ')) {
            currentLine += ' ';
          }
          currentLine += textItem.str;
        }
      }

      // Add the last line
      if (currentLine.trim()) {
        lines.push({ y: currentY, text: currentLine.trim() });
      }

      // Convert lines to HTML paragraphs
      // Detect headings (larger font or bold text typically appears at different Y spacing)
      let prevY = -1;
      for (const line of lines) {
        const spacing = prevY === -1 ? 0 : Math.abs(prevY - line.y);

        // Heuristic: large spacing before text might indicate a heading
        if (spacing > 20 && line.text.length < 100) {
          htmlContent += `<h2>${line.text}</h2>`;
        } else if (line.text.trim()) {
          htmlContent += `<p>${line.text}</p>`;
        }
        prevY = line.y;
      }

      // Add page break except for last page
      if (pageNum < pdf.numPages) {
        htmlContent += '<hr style="page-break-after: always; border: none; margin: 20px 0;">';
      }
    }

    return htmlContent || '<p>No text content found in PDF</p>';
  };

  // Parse DOCX file to HTML
  const parseDocx = async (base64Content: string): Promise<string> => {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library not available');
    }

    // Decode base64 to array buffer
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const zip = await JSZip.loadAsync(bytes);
    console.log('[DOCX Import] ZIP loaded, files:', Object.keys(zip.files));

    // Get the main document content
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) {
      throw new Error('Could not find document.xml in DOCX file');
    }

    // Parse document relationships to find image references
    const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
    const imageRels = new Map<string, string>();

    if (relsXml) {
      console.log('[DOCX Import] Relationships XML:', relsXml.substring(0, 500));
      // Parse each Relationship element individually
      const relMatches = relsXml.matchAll(/<Relationship[^>]+\/>/gi);
      for (const match of relMatches) {
        const relTag = match[0];
        // Check if it's an image relationship
        if (/Type="[^"]*\/image"/.test(relTag) || /Type="[^"]*image[^"]*"/.test(relTag)) {
          const idMatch = relTag.match(/Id="([^"]+)"/);
          const targetMatch = relTag.match(/Target="([^"]+)"/);
          if (idMatch && targetMatch) {
            imageRels.set(idMatch[1], targetMatch[1]);
            console.log('[DOCX Import] Found image relationship:', idMatch[1], '->', targetMatch[1]);
          }
        }
      }
      console.log('[DOCX Import] Image relationships:', Array.from(imageRels.entries()));
    }

    // Extract images and convert to base64 data URLs
    const imageDataUrls = new Map<string, string>();
    for (const [relId, target] of imageRels) {
      // Target is relative to word/ folder, e.g., "media/image1.png"
      const imagePath = target.startsWith('/') ? target.slice(1) : `word/${target}`;
      const imageFile = zip.file(imagePath);

      if (imageFile) {
        try {
          const imageData = await imageFile.async('base64');
          // Determine MIME type from extension
          const ext = target.split('.').pop()?.toLowerCase();
          let mimeType = 'image/png';
          if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
          else if (ext === 'gif') mimeType = 'image/gif';
          else if (ext === 'bmp') mimeType = 'image/bmp';
          else if (ext === 'svg') mimeType = 'image/svg+xml';

          imageDataUrls.set(relId, `data:${mimeType};base64,${imageData}`);
          console.log('[DOCX Import] Loaded image:', relId, imagePath);
        } catch (e) {
          console.error('[DOCX Import] Error loading image:', imagePath, e);
        }
      }
    }

    // Parse numbering definitions to determine list types
    const numberingXml = await zip.file('word/numbering.xml')?.async('string');
    const numIdToType = new Map<string, 'ol' | 'ul'>(); // Maps numId to list type

    if (numberingXml) {
      console.log('[DOCX Import] Found numbering.xml');
      // Parse abstract numbering definitions
      const abstractNums = new Map<string, 'ol' | 'ul'>();
      const abstractMatches = numberingXml.matchAll(/<w:abstractNum[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g);
      for (const match of abstractMatches) {
        const abstractNumId = match[1];
        const content = match[2];
        // Check first level (ilvl="0") for numFmt
        const lvlMatch = content.match(/<w:lvl[^>]*w:ilvl="0"[^>]*>([\s\S]*?)<\/w:lvl>/);
        if (lvlMatch) {
          const lvlContent = lvlMatch[1];
          const numFmtMatch = lvlContent.match(/<w:numFmt[^>]*w:val="([^"]+)"/);
          if (numFmtMatch) {
            const numFmt = numFmtMatch[1];
            // decimal, lowerLetter, upperLetter, lowerRoman, upperRoman = ordered list
            // bullet, none = unordered list (none = no visible marker)
            if (numFmt === 'bullet' || numFmt === 'none') {
              abstractNums.set(abstractNumId, 'ul');
            } else {
              abstractNums.set(abstractNumId, 'ol');
            }
            console.log('[DOCX Import] Abstract num', abstractNumId, '-> format:', numFmt);
          }
        }
      }

      // Map numId to abstractNumId - parse each <w:num> element
      const numElements = numberingXml.matchAll(/<w:num\s[^>]*>([\s\S]*?)<\/w:num>/g);
      for (const numEl of numElements) {
        const fullTag = numEl[0];
        const content = numEl[1];
        // Extract numId from the opening tag
        const numIdMatch = fullTag.match(/w:numId="(\d+)"/);
        // Extract abstractNumId from the content
        const abstractNumIdMatch = content.match(/<w:abstractNumId[^>]*w:val="(\d+)"/);

        if (numIdMatch && abstractNumIdMatch) {
          const numId = numIdMatch[1];
          const abstractNumId = abstractNumIdMatch[1];
          const listType = abstractNums.get(abstractNumId) || 'ul';
          numIdToType.set(numId, listType);
          console.log('[DOCX Import] NumId', numId, '-> abstractNum', abstractNumId, '->', listType);
        }
      }
      console.log('[DOCX Import] Final numIdToType map:', Array.from(numIdToType.entries()));
    }

    // Parse styles if available
    const stylesXml = await zip.file('word/styles.xml')?.async('string');
    const styleMap = new Map<string, { bold?: boolean; italic?: boolean; underline?: boolean; fontSize?: string; color?: string }>();

    if (stylesXml) {
      // Parse style definitions
      const styleMatches = stylesXml.matchAll(/<w:style[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g);
      for (const match of styleMatches) {
        const styleId = match[1];
        const styleContent = match[2];
        const style: any = {};

        if (/<w:b\s*\/>|<w:b\s|<w:b>/.test(styleContent)) style.bold = true;
        if (/<w:i\s*\/>|<w:i\s|<w:i>/.test(styleContent)) style.italic = true;
        if (/<w:u\s/.test(styleContent)) style.underline = true;

        const colorMatch = styleContent.match(/<w:color[^>]*w:val="([^"]+)"/);
        if (colorMatch && colorMatch[1] !== 'auto') {
          style.color = '#' + colorMatch[1];
        }

        const szMatch = styleContent.match(/<w:sz[^>]*w:val="(\d+)"/);
        if (szMatch) {
          // Size is in half-points, convert to points
          style.fontSize = (parseInt(szMatch[1]) / 2) + 'pt';
        }

        if (Object.keys(style).length > 0) {
          styleMap.set(styleId, style);
        }
      }
    }

    // Helper to parse a run element
    const parseRun = (runContent: string, pStyle: any): string => {
      let runHtml = '';

      // Check for images in the run
      const drawingMatches = runContent.matchAll(/<w:drawing>([\s\S]*?)<\/w:drawing>/g);
      for (const drawMatch of drawingMatches) {
        const drawingContent = drawMatch[1];
        // Look for image embed reference
        const embedMatch = drawingContent.match(/r:embed="([^"]+)"/);
        console.log('[DOCX Import] Found drawing, embed:', embedMatch?.[1], 'has data URL:', embedMatch ? imageDataUrls.has(embedMatch[1]) : false);
        if (embedMatch && imageDataUrls.has(embedMatch[1])) {
          const dataUrl = imageDataUrls.get(embedMatch[1])!;
          // Try to get dimensions
          const cxMatch = drawingContent.match(/cx="(\d+)"/);
          const cyMatch = drawingContent.match(/cy="(\d+)"/);
          let widthAttr = '';
          let heightAttr = '';
          if (cxMatch && cyMatch) {
            // Convert EMUs to pixels (914400 EMUs per inch, 96 pixels per inch)
            const widthPx = Math.round(parseInt(cxMatch[1]) / 914400 * 96);
            const heightPx = Math.round(parseInt(cyMatch[1]) / 914400 * 96);
            widthAttr = ` width="${widthPx}"`;
            heightAttr = ` height="${heightPx}"`;
          }
          // Use proper <img> tag - TipTap Image extension will handle it
          runHtml += `<img src="${dataUrl}"${widthAttr}${heightAttr} />`;
          console.log('[DOCX Import] Added image tag');
        }
      }

      // Check for VML images (older format)
      const imageDataMatches = runContent.matchAll(/r:id="([^"]+)"[^>]*o:title/gi);
      for (const imgMatch of imageDataMatches) {
        if (imageDataUrls.has(imgMatch[1])) {
          const dataUrl = imageDataUrls.get(imgMatch[1])!;
          runHtml += `<img src="${dataUrl}" style="max-width: 100%; height: auto;" />`;
        }
      }

      // Get all text content (there can be multiple w:t elements)
      const textMatches = runContent.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
      let text = '';
      for (const textMatch of textMatches) {
        text += textMatch[1];
      }

      // Handle tabs
      if (/<w:tab\s*\/>/.test(runContent)) {
        text = '\t' + text;
      }

      // Handle line breaks
      if (/<w:br\s*\/>/.test(runContent)) {
        text += '<br>';
      }

      if (text) {
        // Escape HTML entities (but preserve <br>)
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        text = text.replace(/&lt;br&gt;/g, '<br>');
        text = text.replace(/\t/g, '&emsp;');

        // Check run properties
        const isBold = /<w:b\s*\/>|<w:b\s|<w:b>/.test(runContent) || pStyle?.bold;
        const isItalic = /<w:i\s*\/>|<w:i\s|<w:i>/.test(runContent) || pStyle?.italic;
        const isUnderline = /<w:u\s/.test(runContent) || pStyle?.underline;
        const isStrike = /<w:strike\s*\/>|<w:strike\s/.test(runContent);
        const isSuperscript = /<w:vertAlign[^>]*w:val="superscript"/.test(runContent);
        const isSubscript = /<w:vertAlign[^>]*w:val="subscript"/.test(runContent);

        // Check for color
        const colorMatch = runContent.match(/<w:color[^>]*w:val="([^"]+)"/);
        // Check for font size
        const szMatch = runContent.match(/<w:sz[^>]*w:val="(\d+)"/);

        let styles: string[] = [];
        if (colorMatch && colorMatch[1] !== 'auto') {
          styles.push(`color: #${colorMatch[1]}`);
        } else if (pStyle?.color) {
          styles.push(`color: ${pStyle.color}`);
        }
        if (szMatch) {
          const fontSize = parseInt(szMatch[1]) / 2;
          styles.push(`font-size: ${fontSize}pt`);
        } else if (pStyle?.fontSize) {
          styles.push(`font-size: ${pStyle.fontSize}`);
        }

        // Apply formatting
        if (isBold) text = `<strong>${text}</strong>`;
        if (isItalic) text = `<em>${text}</em>`;
        if (isUnderline) text = `<u>${text}</u>`;
        if (isStrike) text = `<s>${text}</s>`;
        if (isSuperscript) text = `<sup>${text}</sup>`;
        if (isSubscript) text = `<sub>${text}</sub>`;
        if (styles.length > 0) text = `<span style="${styles.join('; ')}">${text}</span>`;

        runHtml += text;
      }

      return runHtml;
    };

    // Convert OOXML to HTML
    let html = '';
    let inList = false;
    let listType = 'ul';

    // Process document body - handle both paragraphs and tables in order
    const bodyContent = documentXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/)?.[1] || documentXml;

    // Split into top-level elements (paragraphs and tables)
    const elementMatches = bodyContent.matchAll(/<(w:p|w:tbl)[^>]*>[\s\S]*?<\/\1>/g);

    for (const elMatch of elementMatches) {
      const element = elMatch[0];

      if (element.startsWith('<w:tbl')) {
        // Close any open list
        if (inList) {
          html += `</${listType}>`;
          inList = false;
        }

        // Parse table
        let tableHtml = '<table style="border-collapse: collapse; width: 100%;"><tbody>';
        const rowMatches = element.matchAll(/<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g);

        for (const rowMatch of rowMatches) {
          tableHtml += '<tr>';
          const cellMatches = rowMatch[1].matchAll(/<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g);

          for (const cellMatch of cellMatches) {
            const cellContent = cellMatch[1];
            let cellHtml = '';

            // Parse paragraphs within cell
            const cellParagraphs = cellContent.matchAll(/<w:p[^>]*>([\s\S]*?)<\/w:p>/g);
            for (const cpMatch of cellParagraphs) {
              const runMatches = cpMatch[1].matchAll(/<w:r[^>]*>([\s\S]*?)<\/w:r>/g);
              for (const rMatch of runMatches) {
                cellHtml += parseRun(rMatch[1], null);
              }
            }

            tableHtml += `<td style="border: 1px solid #ddd; padding: 8px;">${cellHtml || '&nbsp;'}</td>`;
          }
          tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table>';
        html += tableHtml;

      } else if (element.startsWith('<w:p')) {
        // Parse paragraph
        const paragraphContent = element;

        // Check paragraph properties for style
        const pStyleMatch = paragraphContent.match(/<w:pStyle[^>]*w:val="([^"]+)"/);
        const pStyle = pStyleMatch ? styleMap.get(pStyleMatch[1]) : null;

        // Check for heading styles
        const isHeading1 = pStyleMatch && /heading\s*1/i.test(pStyleMatch[1]);
        const isHeading2 = pStyleMatch && /heading\s*2/i.test(pStyleMatch[1]);
        const isHeading3 = pStyleMatch && /heading\s*3/i.test(pStyleMatch[1]);
        const isTitle = pStyleMatch && /^title$/i.test(pStyleMatch[1]);

        // Check for list
        const isListItem = /<w:numPr>/.test(paragraphContent);
        const numIdMatch = paragraphContent.match(/<w:numId[^>]*w:val="(\d+)"/);
        // Use numbering.xml to determine list type - default to 'ul' if not found
        const listTypeFromNum = numIdMatch ? numIdToType.get(numIdMatch[1]) : undefined;
        const isNumberedList = listTypeFromNum === 'ol';

        if (isListItem && numIdMatch) {
          console.log('[DOCX Import] List item - numId:', numIdMatch[1], 'type from numbering.xml:', listTypeFromNum);
        }

        // Check alignment
        const alignMatch = paragraphContent.match(/<w:jc[^>]*w:val="([^"]+)"/);
        let styleAttrs: string[] = [];
        if (alignMatch) {
          if (alignMatch[1] === 'center') styleAttrs.push('text-align: center');
          else if (alignMatch[1] === 'right') styleAttrs.push('text-align: right');
          else if (alignMatch[1] === 'both') styleAttrs.push('text-align: justify');
        }

        // Check spacing
        const spacingMatch = paragraphContent.match(/<w:spacing[^>]*w:after="(\d+)"/);
        if (spacingMatch) {
          const spacingPt = parseInt(spacingMatch[1]) / 20; // twentieths of a point
          styleAttrs.push(`margin-bottom: ${spacingPt}pt`);
        }

        const styleAttr = styleAttrs.length > 0 ? ` style="${styleAttrs.join('; ')}"` : '';

        // Parse runs (text segments) within paragraph
        let paragraphHtml = '';
        const runMatches = paragraphContent.matchAll(/<w:r[^>]*>([\s\S]*?)<\/w:r>/g);

        for (const rMatch of runMatches) {
          paragraphHtml += parseRun(rMatch[1], pStyle);
        }

        // Handle list state
        if (isListItem) {
          const newListType = isNumberedList ? 'ol' : 'ul';
          if (!inList) {
            html += `<${newListType}>`;
            inList = true;
            listType = newListType;
          } else if (listType !== newListType) {
            html += `</${listType}><${newListType}>`;
            listType = newListType;
          }
          html += `<li>${paragraphHtml}</li>`;
        } else {
          // Close any open list
          if (inList) {
            html += `</${listType}>`;
            inList = false;
          }

          // Wrap in appropriate tag
          if (paragraphHtml.trim() === '') {
            html += '<p><br></p>';
          } else if (isTitle) {
            html += `<h1${styleAttr}>${paragraphHtml}</h1>`;
          } else if (isHeading1) {
            html += `<h1${styleAttr}>${paragraphHtml}</h1>`;
          } else if (isHeading2) {
            html += `<h2${styleAttr}>${paragraphHtml}</h2>`;
          } else if (isHeading3) {
            html += `<h3${styleAttr}>${paragraphHtml}</h3>`;
          } else {
            html += `<p${styleAttr}>${paragraphHtml}</p>`;
          }
        }
      }
    }

    // Close any remaining open list
    if (inList) {
      html += `</${listType}>`;
    }

    console.log('[DOCX Import] Converted HTML:', html.substring(0, 500) + '...');
    return html || '<p></p>';
  };

  // Parse RTF file to HTML
  const parseRtf = (content: string): string => {
    let html = '';
    let currentText = '';
    let isBold = false;
    let isItalic = false;
    let isUnderline = false;

    // Remove RTF header noise
    content = content.replace(/^\{\\rtf1[\s\S]*?\\viewkind\d+/i, '');
    content = content.replace(/\{\\colortbl[^}]*\}/g, '');
    content = content.replace(/\{\\fonttbl[^}]*\}/g, '');
    content = content.replace(/\{\\stylesheet[^}]*\}/g, '');

    // Simple RTF parsing
    const tokens = content.split(/(\\[a-z]+\d*\s?|\{|\})/i);

    for (const token of tokens) {
      if (token === '\\par ' || token === '\\par') {
        if (currentText.trim()) {
          let text = currentText;
          if (isBold) text = `<strong>${text}</strong>`;
          if (isItalic) text = `<em>${text}</em>`;
          if (isUnderline) text = `<u>${text}</u>`;
          html += `<p>${text}</p>`;
        } else {
          html += '<p><br></p>';
        }
        currentText = '';
      } else if (token === '\\b ' || token === '\\b') {
        isBold = true;
      } else if (token === '\\b0 ' || token === '\\b0') {
        isBold = false;
      } else if (token === '\\i ' || token === '\\i') {
        isItalic = true;
      } else if (token === '\\i0 ' || token === '\\i0') {
        isItalic = false;
      } else if (token === '\\ul ' || token === '\\ul') {
        isUnderline = true;
      } else if (token === '\\ulnone ' || token === '\\ulnone') {
        isUnderline = false;
      } else if (!token.startsWith('\\') && token !== '{' && token !== '}') {
        currentText += token;
      }
    }

    // Add remaining text
    if (currentText.trim()) {
      let text = currentText;
      if (isBold) text = `<strong>${text}</strong>`;
      if (isItalic) text = `<em>${text}</em>`;
      if (isUnderline) text = `<u>${text}</u>`;
      html += `<p>${text}</p>`;
    }

    return html || '<p></p>';
  };

  // Parse Markdown to HTML
  const parseMarkdown = (content: string): string => {
    let html = content;

    // Escape HTML first
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

    // Code blocks
    html = html.replace(/```[\s\S]*?```/g, (match) => {
      const code = match.slice(3, -3).replace(/^\w+\n/, '');
      return `<pre><code>${code}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Unordered lists
    html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)+/g, (match) => `<ul>${match}</ul>`);

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rules
    html = html.replace(/^---+$/gm, '<hr>');
    html = html.replace(/^\*\*\*+$/gm, '<hr>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Paragraphs - wrap remaining lines
    const lines = html.split('\n');
    html = lines.map(line => {
      if (line.trim() === '') return '';
      if (line.startsWith('<h') || line.startsWith('<ul') || line.startsWith('<ol') ||
          line.startsWith('<li') || line.startsWith('<blockquote') || line.startsWith('<hr') ||
          line.startsWith('<pre')) {
        return line;
      }
      return `<p>${line}</p>`;
    }).join('');

    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');

    return html || '<p></p>';
  };

  // New document
  const newDocument = () => {
    if (!isSaved) {
      if (!confirm('You have unsaved changes. Create a new document anyway?')) {
        return;
      }
    }
    if (editor) {
      editor.commands.setContent('<p>Start typing your document...</p>');
    }
    setFileName('Untitled Document');
    setFilePath(null);
    setIsSaved(true);
  };

  // Save document
  const saveDocument = async () => {
    if (!editor) return;

    if (!ipcRenderer) {
      // Fallback to localStorage if not in Electron
      const content = editor.getHTML();
      localStorage.setItem(`doc_${fileName}`, content);
      setIsSaved(true);
      EventBus.getInstance().publish('log-message', `Document "${fileName}" saved to browser storage`);
      return;
    }

    try {
      setIsLoading(true);
      let savePath = filePath;

      // If no file path yet, show save dialog
      if (!savePath) {
        const result = await ipcRenderer.invoke('show-save-dialog', {
          title: 'Save Document',
          defaultPath: `${fileName}.html`,
          filters: [
            { name: 'HTML Files', extensions: ['html', 'htm'] },
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'Markdown Files', extensions: ['md'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (!result.success || result.canceled) {
          setIsLoading(false);
          return;
        }
        savePath = result.filePath;
      }

      // Determine save format based on extension
      const lowerPath = savePath.toLowerCase();
      let content: string;

      if (lowerPath.endsWith('.md')) {
        // Convert HTML to Markdown for .md files
        content = htmlToMarkdown(editor.getHTML());
      } else if (lowerPath.endsWith('.txt')) {
        // Plain text
        content = editor.getText();
      } else {
        // HTML
        content = editor.getHTML();
      }

      const writeResult = await ipcRenderer.invoke('write-file', { filePath: savePath, content });

      if (writeResult.success) {
        setFilePath(savePath);
        setIsSaved(true);
        // Update filename from path
        const name = savePath.split(/[/\\]/).pop()?.replace(/\.(html|htm|txt|md)$/i, '') || fileName;
        setFileName(name);
        EventBus.getInstance().publish('log-message', `Saved to ${savePath}`);
      } else {
        EventBus.getInstance().publish('log-message', `Error saving: ${writeResult.error}`);
      }
    } catch (error) {
      EventBus.getInstance().publish('log-message', `Error saving: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Convert HTML to Markdown
  const htmlToMarkdown = (html: string): string => {
    let md = html;

    // Headers
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');

    // Bold and italic
    md = md.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**');
    md = md.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');
    md = md.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*');
    md = md.replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*');

    // Strikethrough
    md = md.replace(/<s>([\s\S]*?)<\/s>/gi, '~~$1~~');
    md = md.replace(/<strike>([\s\S]*?)<\/strike>/gi, '~~$1~~');

    // Lists
    md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '$1\n');
    md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '$1\n');
    md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

    // Links
    md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

    // Paragraphs
    md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
    md = md.replace(/<br\s*\/?>/gi, '\n');

    // Remove remaining tags
    md = md.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    md = md.replace(/&nbsp;/g, ' ');
    md = md.replace(/&amp;/g, '&');
    md = md.replace(/&lt;/g, '<');
    md = md.replace(/&gt;/g, '>');

    // Clean up extra whitespace
    md = md.replace(/\n{3,}/g, '\n\n');

    return md.trim();
  };

  // Export document to PDF
  const exportToPDF = async (savePath: string) => {
    if (!editor || !jsPdfLoaded) {
      EventBus.getInstance().publish('log-message', 'jsPDF not loaded yet. Please try again in a moment.');
      return;
    }

    try {
      setIsLoading(true);
      EventBus.getInstance().publish('log-message', 'Generating PDF...');

      const { jsPDF } = (window as any).jspdf;

      // Create a temporary container to render the HTML content
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'absolute';
      tempContainer.style.left = '-9999px';
      tempContainer.style.width = '210mm'; // A4 width
      tempContainer.style.padding = '20mm';
      tempContainer.style.backgroundColor = '#ffffff';
      tempContainer.style.fontFamily = 'Arial, sans-serif';
      tempContainer.style.fontSize = '12pt';
      tempContainer.style.lineHeight = lineSpacing;
      tempContainer.style.color = '#000000';

      // Add the editor content with inline styles preserved
      tempContainer.innerHTML = editor.getHTML();
      document.body.appendChild(tempContainer);

      // Create PDF (A4 size)
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Convert the HTML content to canvas using html2canvas if available, or use text rendering
      // For now, we'll use a simpler approach: render text content with basic formatting

      // Get the text content and basic structure
      const pageWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const margin = 20;
      const usableWidth = pageWidth - (margin * 2);
      const usableHeight = pageHeight - (margin * 2);

      let currentY = margin;
      let currentPage = 1;

      // Simple text extraction with basic formatting
      const elements = tempContainer.querySelectorAll('h1, h2, h3, p, ul, ol, table, img');

      for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLElement;
        const tagName = element.tagName.toLowerCase();

        if (tagName === 'h1') {
          // Check if heading fits, if not start new page
          if (currentY + 12 > pageHeight - margin) {
            pdf.addPage();
            currentPage++;
            currentY = margin;
          }
          pdf.setFontSize(24);
          pdf.setFont('helvetica', 'bold');
          const text = element.textContent || '';
          pdf.text(text, margin, currentY);
          currentY += 12;
        } else if (tagName === 'h2') {
          if (currentY + 10 > pageHeight - margin) {
            pdf.addPage();
            currentPage++;
            currentY = margin;
          }
          pdf.setFontSize(18);
          pdf.setFont('helvetica', 'bold');
          const text = element.textContent || '';
          pdf.text(text, margin, currentY);
          currentY += 10;
        } else if (tagName === 'h3') {
          if (currentY + 8 > pageHeight - margin) {
            pdf.addPage();
            currentPage++;
            currentY = margin;
          }
          pdf.setFontSize(14);
          pdf.setFont('helvetica', 'bold');
          const text = element.textContent || '';
          pdf.text(text, margin, currentY);
          currentY += 8;
        } else if (tagName === 'p') {
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'normal');
          const text = element.textContent || '';
          if (text.trim()) {
            const lines = pdf.splitTextToSize(text, usableWidth);
            const textHeight = lines.length * 7 + 3;

            // Check if paragraph fits on current page
            if (currentY + textHeight > pageHeight - margin) {
              pdf.addPage();
              currentPage++;
              currentY = margin;
            }

            pdf.text(lines, margin, currentY);
            currentY += lines.length * 7;
          }
          currentY += 3; // Paragraph spacing
        } else if (tagName === 'ul' || tagName === 'ol') {
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'normal');
          const items = element.querySelectorAll('li');
          items.forEach((item, index) => {
            const prefix = tagName === 'ol' ? `${index + 1}. ` : '• ';
            const text = item.textContent || '';
            const lines = pdf.splitTextToSize(prefix + text, usableWidth - 10);
            const itemHeight = lines.length * 7;

            // Check if list item fits on current page
            if (currentY + itemHeight > pageHeight - margin) {
              pdf.addPage();
              currentPage++;
              currentY = margin;
            }

            pdf.text(lines, margin + 5, currentY);
            currentY += itemHeight;
          });
          currentY += 3;
        } else if (tagName === 'img') {
          const img = element as HTMLImageElement;
          try {
            // Get image data
            const imgData = img.src;
            const imgWidth = Math.min(img.width * 0.26458, usableWidth); // Convert px to mm
            const imgHeight = img.height * (imgWidth / img.width);

            // Check if image fits on current page
            if (currentY + imgHeight > usableHeight + margin) {
              pdf.addPage();
              currentPage++;
              currentY = margin;
            }

            pdf.addImage(imgData, 'JPEG', margin, currentY, imgWidth, imgHeight);
            currentY += imgHeight + 5;
          } catch (e) {
            EventBus.getInstance().publish('log-message', 'Warning: Could not embed image in PDF');
          }
        } else if (tagName === 'table') {
          // Basic table rendering
          pdf.setFontSize(10);
          const rows = element.querySelectorAll('tr');
          rows.forEach((row) => {
            // Check if row fits on current page
            if (currentY + 7 > pageHeight - margin) {
              pdf.addPage();
              currentPage++;
              currentY = margin;
            }

            const cells = row.querySelectorAll('td, th');
            let cellX = margin;
            const cellWidth = usableWidth / cells.length;

            cells.forEach((cell) => {
              const text = cell.textContent || '';
              const isHeader = cell.tagName.toLowerCase() === 'th';
              pdf.setFont('helvetica', isHeader ? 'bold' : 'normal');
              pdf.text(text.substring(0, 30), cellX + 2, currentY); // Truncate long text
              cellX += cellWidth;
            });
            currentY += 7;
          });
          currentY += 5;
        }
      }

      // Remove temp container
      document.body.removeChild(tempContainer);

      // Save the PDF
      if (ipcRenderer) {
        // Get PDF as arraybuffer and convert to binary string for writing
        const pdfArrayBuffer = pdf.output('arraybuffer');
        const pdfBytes = new Uint8Array(pdfArrayBuffer);
        let binaryString = '';
        for (let i = 0; i < pdfBytes.length; i++) {
          binaryString += String.fromCharCode(pdfBytes[i]);
        }

        // Write using base64 encoding
        const writeResult = await ipcRenderer.invoke('write-file', {
          filePath: savePath,
          content: btoa(binaryString),
          encoding: 'base64'
        });

        if (writeResult.success) {
          EventBus.getInstance().publish('log-message', `PDF saved to: ${savePath}`);
          setIsSaved(true);
        } else {
          EventBus.getInstance().publish('log-message', `Error saving PDF: ${writeResult.error}`);
        }
      } else {
        // Browser download
        pdf.save(fileName + '.pdf');
        EventBus.getInstance().publish('log-message', 'PDF downloaded');
      }
    } catch (error) {
      EventBus.getInstance().publish('log-message', `Error generating PDF: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Save As document
  const saveAsDocument = async () => {
    if (!editor) return;

    if (!ipcRenderer) {
      saveDocument();
      return;
    }

    try {
      setIsLoading(true);
      const result = await ipcRenderer.invoke('show-save-dialog', {
        title: 'Save Document As',
        defaultPath: `${fileName}.html`,
        filters: [
          { name: 'HTML Files', extensions: ['html', 'htm'] },
          { name: 'PDF Files', extensions: ['pdf'] },
          { name: 'Markdown Files', extensions: ['md'] },
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.success || result.canceled) {
        setIsLoading(false);
        return;
      }

      const savePath = result.filePath;
      const lowerPath = savePath.toLowerCase();

      // Handle PDF export separately
      if (lowerPath.endsWith('.pdf')) {
        setIsLoading(false);
        await exportToPDF(savePath);
        return;
      }

      let content: string;

      if (lowerPath.endsWith('.md')) {
        content = htmlToMarkdown(editor.getHTML());
      } else if (lowerPath.endsWith('.txt')) {
        content = editor.getText();
      } else {
        content = editor.getHTML();
      }

      const writeResult = await ipcRenderer.invoke('write-file', { filePath: savePath, content });

      if (writeResult.success) {
        setFilePath(savePath);
        setIsSaved(true);
        const name = savePath.split(/[/\\]/).pop()?.replace(/\.(html|htm|txt|md|pdf)$/i, '') || fileName;
        setFileName(name);
        EventBus.getInstance().publish('log-message', `Saved to ${savePath}`);
      } else {
        EventBus.getInstance().publish('log-message', `Error saving: ${writeResult.error}`);
      }
    } catch (error) {
      EventBus.getInstance().publish('log-message', `Error saving: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Load document
  const loadDocument = async () => {
    if (!editor) return;

    if (!ipcRenderer) {
      // Fallback to localStorage if not in Electron
      const content = localStorage.getItem(`doc_${fileName}`);
      if (content) {
        editor.commands.setContent(content);
        setIsSaved(true);
        EventBus.getInstance().publish('log-message', `Document "${fileName}" loaded from browser storage`);
      }
      return;
    }

    try {
      setIsLoading(true);
      const result = await ipcRenderer.invoke('show-open-dialog', {
        title: 'Open Document',
        filters: [
          { name: 'All Supported', extensions: ['html', 'htm', 'txt', 'docx', 'rtf', 'md', 'pdf'] },
          { name: 'HTML Files', extensions: ['html', 'htm'] },
          { name: 'Word Documents', extensions: ['docx'] },
          { name: 'PDF Files', extensions: ['pdf'] },
          { name: 'Rich Text Format', extensions: ['rtf'] },
          { name: 'Markdown Files', extensions: ['md'] },
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (!result.success || result.canceled) {
        setIsLoading(false);
        return;
      }

      const loadPath = result.filePaths[0];
      const lowerPath = loadPath.toLowerCase();

      let htmlContent = '';

      if (lowerPath.endsWith('.pdf')) {
        // Read as binary for PDF
        const readResult = await ipcRenderer.invoke('read-file', { filePath: loadPath, encoding: 'base64' });
        if (!readResult.success) {
          EventBus.getInstance().publish('log-message', `Error loading: ${readResult.error}`);
          setIsLoading(false);
          return;
        }

        try {
          htmlContent = await parsePdf(readResult.content);
          EventBus.getInstance().publish('log-message', 'PDF file imported successfully');
        } catch (err) {
          EventBus.getInstance().publish('log-message', `Error parsing PDF: ${err}`);
          setIsLoading(false);
          return;
        }
      } else if (lowerPath.endsWith('.docx')) {
        // Read as binary for DOCX
        const readResult = await ipcRenderer.invoke('read-file', { filePath: loadPath, encoding: 'base64' });
        if (!readResult.success) {
          EventBus.getInstance().publish('log-message', `Error loading: ${readResult.error}`);
          setIsLoading(false);
          return;
        }

        try {
          htmlContent = await parseDocx(readResult.content);
          EventBus.getInstance().publish('log-message', 'DOCX file imported successfully');
        } catch (err) {
          EventBus.getInstance().publish('log-message', `Error parsing DOCX: ${err}`);
          setIsLoading(false);
          return;
        }
      } else {
        // Read as text for other formats
        const readResult = await ipcRenderer.invoke('read-file', loadPath);
        if (!readResult.success) {
          EventBus.getInstance().publish('log-message', `Error loading: ${readResult.error}`);
          setIsLoading(false);
          return;
        }

        if (lowerPath.endsWith('.txt')) {
          // Wrap plain text in paragraph tags
          const lines = readResult.content.split('\n');
          htmlContent = lines.map((line: string) => `<p>${line || '<br>'}</p>`).join('');
        } else if (lowerPath.endsWith('.rtf')) {
          htmlContent = parseRtf(readResult.content);
          EventBus.getInstance().publish('log-message', 'RTF file imported successfully');
        } else if (lowerPath.endsWith('.md')) {
          htmlContent = parseMarkdown(readResult.content);
          EventBus.getInstance().publish('log-message', 'Markdown file imported successfully');
        } else {
          // Assume HTML
          htmlContent = readResult.content;
        }
      }

      console.log('[DOCX Import] Setting editor content, HTML length:', htmlContent.length);
      console.log('[DOCX Import] HTML contains <ol>:', htmlContent.includes('<ol>'));
      console.log('[DOCX Import] HTML contains <li>:', htmlContent.includes('<li>'));
      console.log('[DOCX Import] HTML preview:', htmlContent.substring(0, 1000));
      editor.commands.setContent(htmlContent);
      // Log what TipTap actually rendered
      setTimeout(() => {
        console.log('[DOCX Import] TipTap output:', editor.getHTML().substring(0, 1000));
      }, 100);
      const name = loadPath.split(/[/\\]/).pop()?.replace(/\.(html|htm|txt|docx|rtf|md|pdf)$/i, '') || 'Document';
      setFileName(name);
      setFilePath(lowerPath.endsWith('.docx') || lowerPath.endsWith('.rtf') || lowerPath.endsWith('.pdf') ? null : loadPath);
      setIsSaved(lowerPath.endsWith('.docx') || lowerPath.endsWith('.rtf') || lowerPath.endsWith('.pdf') ? false : true);
      EventBus.getInstance().publish('log-message', `Loaded from ${loadPath}`);
    } catch (error) {
      EventBus.getInstance().publish('log-message', `Error loading: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Export as HTML (download)
  const exportAsHTML = () => {
    if (!editor) return;

    const content = editor.getHTML();
    const fullHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${fileName}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
    blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding-left: 1em; color: #666; }
    pre { background: #f5f5f5; padding: 1em; overflow-x: auto; }
    code { background: #f5f5f5; padding: 0.2em 0.4em; border-radius: 3px; }
    .editor-link { color: #3b82f6; text-decoration: underline; }
  </style>
</head>
<body>
${content}
</body>
</html>`;

    const blob = new Blob([fullHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.html`;
    a.click();
    URL.revokeObjectURL(url);

    EventBus.getInstance().publish('log-message', `Document exported as ${fileName}.html`);
  };

  // Print document
  const handlePrint = () => {
    if (!editor) return;
    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) return;

    const content = editor.getHTML();
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${fileName}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #000; padding: 8px; }
          th { background-color: #f0f0f0; }
          @media print {
            body { margin: 0; }
          }
        </style>
      </head>
      <body>
        ${content}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  // Handle image upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const imageUrl = event.target?.result as string;
      if (imageUrl) {
        editor.chain().focus().setImage({ src: imageUrl }).run();
        setIsSaved(false);
        EventBus.getInstance().publish('log-message', `Image inserted: ${file.name}`);
      }
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle insert link
  const handleInsertLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href || '';
    setLinkDialogUrl(previousUrl);
    setShowLinkDialog(true);
  };

  if (!editor) {
    return <div className="p-5 text-white">Loading editor...</div>;
  }

  // Tailwind class helpers
  const buttonClass = 'bg-slate-700 py-1.5 px-3 border border-slate-600 rounded text-white cursor-pointer text-xs hover:bg-slate-600 transition-colors';
  const activeButtonClass = (isActive: boolean) =>
    `${buttonClass} ${isActive ? 'bg-blue-500 hover:bg-blue-400' : ''}`;
  const selectClass = 'bg-slate-700 py-1.5 px-2 border border-slate-600 rounded text-white cursor-pointer text-xs';

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Hidden file input for images */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
        aria-label="Upload image"
      />

      {/* Find & Replace Dialog */}
      {showFindReplace && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[999]" onClick={() => setShowFindReplace(false)} />
          <FindReplaceDialog editor={editor} onClose={() => setShowFindReplace(false)} />
        </>
      )}

      {/* Link Dialog */}
      {showLinkDialog && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[999]" onClick={() => setShowLinkDialog(false)} />
          <LinkDialog editor={editor} onClose={() => setShowLinkDialog(false)} initialUrl={linkDialogUrl} />
        </>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[2000]">
          <div className="text-white text-lg">Loading...</div>
        </div>
      )}

      {/* Top Menu Bar */}
      <div className="bg-slate-800 py-2 px-3 border-b border-slate-600 flex items-center gap-2.5 flex-wrap">
        <button onClick={newDocument} className={buttonClass} aria-label="New document">New</button>
        <button onClick={loadDocument} className={buttonClass} aria-label="Open document">Open</button>
        <button onClick={saveDocument} className={buttonClass} aria-label="Save document">Save</button>
        <button onClick={saveAsDocument} className={buttonClass} aria-label="Save document as">Save As</button>
        <button onClick={exportAsHTML} className={buttonClass} aria-label="Export as HTML">Export HTML</button>
        <button onClick={handlePrint} className={buttonClass} aria-label="Print document">Print</button>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        <button
          onClick={() => setViewMode(viewMode === 'continuous' ? 'pages' : 'continuous')}
          className={activeButtonClass(viewMode === 'pages')}
          aria-label="Toggle view mode"
          title={viewMode === 'continuous' ? 'Switch to Page View' : 'Switch to Continuous View'}
        >
          {viewMode === 'continuous' ? '📄 Pages' : '📜 Continuous'}
        </button>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        <span className="text-[13px] text-slate-300">{fileName}</span>
        <span className={`text-xs ${isSaved ? 'text-green-500' : 'text-red-500'}`}>
          {isSaved ? '(saved)' : '(unsaved)'}
        </span>
        {filePath && (
          <span className="text-[11px] text-slate-500 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
            {filePath}
          </span>
        )}
      </div>

      {/* Formatting Toolbar */}
      <div className="bg-slate-800 py-2 px-3 border-b border-slate-600 flex gap-1.5 flex-wrap items-center">
        {/* Font Family */}
        <select
          onChange={(e) => {
            if (e.target.value === 'default') {
              editor.chain().focus().unsetFontFamily().run();
            } else {
              editor.chain().focus().setFontFamily(e.target.value).run();
            }
          }}
          value={editor.getAttributes('textStyle').fontFamily || 'default'}
          className={selectClass}
          aria-label="Font family"
        >
          <option value="default">Default</option>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Georgia">Georgia</option>
          <option value="Verdana">Verdana</option>
          <option value="Comic Sans MS">Comic Sans MS</option>
        </select>

        {/* Font Size */}
        <select
          onChange={(e) => {
            const size = e.target.value;
            if (size === 'default') {
              editor.chain().focus().unsetMark('textStyle').run();
            } else {
              editor.chain().focus().setMark('textStyle', { fontSize: size }).run();
            }
          }}
          className={selectClass}
          aria-label="Font size"
        >
          <option value="default">Size</option>
          <option value="8pt">8pt</option>
          <option value="10pt">10pt</option>
          <option value="12pt">12pt</option>
          <option value="14pt">14pt</option>
          <option value="16pt">16pt</option>
          <option value="18pt">18pt</option>
          <option value="24pt">24pt</option>
          <option value="36pt">36pt</option>
          <option value="48pt">48pt</option>
          <option value="72pt">72pt</option>
        </select>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Text Style Buttons */}
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          className={activeButtonClass(editor.isActive('bold'))}
          aria-label="Bold"
          title="Bold (Ctrl+B)"
        >
          <strong>B</strong>
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          className={activeButtonClass(editor.isActive('italic'))}
          aria-label="Italic"
          title="Italic (Ctrl+I)"
        >
          <em>I</em>
        </button>
        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          disabled={!editor.can().chain().focus().toggleUnderline().run()}
          className={activeButtonClass(editor.isActive('underline'))}
          aria-label="Underline"
          title="Underline (Ctrl+U)"
        >
          <u>U</u>
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editor.can().chain().focus().toggleStrike().run()}
          className={activeButtonClass(editor.isActive('strike'))}
          aria-label="Strikethrough"
        >
          <s>S</s>
        </button>

        {typeof TiptapSubscript !== 'undefined' && (
          <button
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            className={activeButtonClass(editor.isActive('subscript'))}
            aria-label="Subscript"
          >
            X<sub>2</sub>
          </button>
        )}

        {typeof TiptapSuperscript !== 'undefined' && (
          <button
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            className={activeButtonClass(editor.isActive('superscript'))}
            aria-label="Superscript"
          >
            X<sup>2</sup>
          </button>
        )}

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Heading Buttons */}
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={activeButtonClass(editor.isActive('heading', { level: 1 }))}
          aria-label="Heading 1"
        >
          H1
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={activeButtonClass(editor.isActive('heading', { level: 2 }))}
          aria-label="Heading 2"
        >
          H2
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={activeButtonClass(editor.isActive('heading', { level: 3 }))}
          aria-label="Heading 3"
        >
          H3
        </button>
        <button
          onClick={() => editor.chain().focus().setParagraph().run()}
          className={activeButtonClass(editor.isActive('paragraph'))}
          aria-label="Paragraph"
        >
          P
        </button>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* List Buttons */}
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={activeButtonClass(editor.isActive('bulletList'))}
          aria-label="Bullet list"
        >
          • List
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={activeButtonClass(editor.isActive('orderedList'))}
          aria-label="Numbered list"
        >
          1. List
        </button>

        {/* Indent Controls */}
        <button
          onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
          disabled={!editor.can().sinkListItem('listItem')}
          className={buttonClass}
          aria-label="Increase indent"
          title="Increase indent"
        >
          →
        </button>
        <button
          onClick={() => editor.chain().focus().liftListItem('listItem').run()}
          disabled={!editor.can().liftListItem('listItem')}
          className={buttonClass}
          aria-label="Decrease indent"
          title="Decrease indent"
        >
          ←
        </button>

        {typeof TiptapHighlight !== 'undefined' && (
          <>
            <button
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={activeButtonClass(editor.isActive('blockquote'))}
              aria-label="Blockquote"
            >
              " "
            </button>
          </>
        )}

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Alignment Buttons */}
        <button
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={activeButtonClass(editor.isActive({ textAlign: 'left' }))}
          aria-label="Align left"
        >
          ‹Left
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={activeButtonClass(editor.isActive({ textAlign: 'center' }))}
          aria-label="Align center"
        >
          Center
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={activeButtonClass(editor.isActive({ textAlign: 'right' }))}
          aria-label="Align right"
        >
          Right›
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          className={activeButtonClass(editor.isActive({ textAlign: 'justify' }))}
          aria-label="Justify"
        >
          Justify
        </button>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Line Spacing */}
        <select
          onChange={(e) => {
            const spacing = e.target.value;
            if (spacing === '1') {
              setLineSpacing('1.0');
            } else if (spacing === '1.5') {
              setLineSpacing('1.5');
            } else if (spacing === '2') {
              setLineSpacing('2.0');
            } else {
              setLineSpacing('1.6');
            }
          }}
          value={lineSpacing === '1.0' ? '1' : lineSpacing === '1.5' ? '1.5' : lineSpacing === '2.0' ? '2' : 'default'}
          className={selectClass}
          aria-label="Line spacing"
        >
          <option value="default">Line Spacing (Normal)</option>
          <option value="1">Single (1.0)</option>
          <option value="1.5">1.5 Lines</option>
          <option value="2">Double (2.0)</option>
        </select>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Color Pickers */}
        <input
          type="color"
          onInput={(event) => editor.chain().focus().setColor((event.target as HTMLInputElement).value).run()}
          value={editor.getAttributes('textStyle').color || '#000000'}
          className="w-10 h-8 border border-slate-600 rounded cursor-pointer"
          title="Text Color"
          aria-label="Text color"
        />

        {typeof TiptapHighlight !== 'undefined' && (
          <input
            type="color"
            onInput={(event) => editor.chain().focus().toggleHighlight({ color: (event.target as HTMLInputElement).value }).run()}
            value="#ffff00"
            className="w-10 h-8 border border-slate-600 rounded cursor-pointer"
            title="Highlight Color"
            aria-label="Highlight color"
          />
        )}

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Table Controls */}
        <button
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          className={buttonClass}
          aria-label="Insert table"
        >
          Table
        </button>

        {editor.isActive('table') && (
          <>
            <button
              onClick={() => editor.chain().focus().addColumnBefore().run()}
              className={buttonClass}
              aria-label="Add column before"
              title="Add column before"
            >
              +Col←
            </button>
            <button
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              className={buttonClass}
              aria-label="Add column after"
              title="Add column after"
            >
              +Col→
            </button>
            <button
              onClick={() => editor.chain().focus().deleteColumn().run()}
              className={buttonClass}
              aria-label="Delete column"
              title="Delete column"
            >
              -Col
            </button>
            <button
              onClick={() => editor.chain().focus().addRowBefore().run()}
              className={buttonClass}
              aria-label="Add row before"
              title="Add row before"
            >
              +Row↑
            </button>
            <button
              onClick={() => editor.chain().focus().addRowAfter().run()}
              className={buttonClass}
              aria-label="Add row after"
              title="Add row after"
            >
              +Row↓
            </button>
            <button
              onClick={() => editor.chain().focus().deleteRow().run()}
              className={buttonClass}
              aria-label="Delete row"
              title="Delete row"
            >
              -Row
            </button>
            <button
              onClick={() => editor.chain().focus().deleteTable().run()}
              className={buttonClass}
              aria-label="Delete table"
              title="Delete table"
            >
              -Table
            </button>
          </>
        )}

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Image Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className={buttonClass}
          aria-label="Insert image"
        >
          Image
        </button>

        {/* Link Button */}
        {typeof TiptapLink !== 'undefined' && (
          <button
            onClick={handleInsertLink}
            className={activeButtonClass(editor.isActive('link'))}
            aria-label="Insert link"
            title="Insert link (Ctrl+K)"
          >
            Link
          </button>
        )}

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Find & Replace */}
        <button
          onClick={() => setShowFindReplace(true)}
          className={buttonClass}
          aria-label="Find and replace"
          title="Find & Replace (Ctrl+F)"
        >
          Find
        </button>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Undo/Redo */}
        <button
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().chain().focus().undo().run()}
          className={buttonClass}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().chain().focus().redo().run()}
          className={buttonClass}
          aria-label="Redo"
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>
      </div>

      {/* Editor Content */}
      <div
        ref={editorContainerRef}
        className="editor-scroll-container flex-1 overflow-auto bg-white p-10 relative"
      >
        <style>{`
          .ProseMirror ul {
            list-style-type: disc;
            padding-left: 24px;
            margin: 1em 0;
          }
          .ProseMirror ol {
            list-style-type: decimal;
            padding-left: 24px;
            margin: 1em 0;
          }
          .ProseMirror li {
            margin: 0.25em 0;
          }
          .ProseMirror ul ul {
            list-style-type: circle;
          }
          .ProseMirror ul ul ul {
            list-style-type: square;
          }
          .ProseMirror p {
            margin: 0.5em 0;
          }
          .ProseMirror h1 {
            font-size: 2em;
            font-weight: bold;
            margin: 0.67em 0;
          }
          .ProseMirror h2 {
            font-size: 1.5em;
            font-weight: bold;
            margin: 0.75em 0;
          }
          .ProseMirror h3 {
            font-size: 1.17em;
            font-weight: bold;
            margin: 0.83em 0;
          }
          .ProseMirror blockquote {
            border-left: 4px solid #ddd;
            margin: 1em 0;
            padding-left: 1em;
            color: #666;
          }
          .ProseMirror table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
          }
          .ProseMirror table td,
          .ProseMirror table th {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
          }
          .ProseMirror table th {
            background-color: #f2f2f2;
            font-weight: bold;
          }
          .ProseMirror img {
            max-width: 100%;
            height: auto;
          }
          .ProseMirror .editor-link {
            color: #3b82f6;
            text-decoration: underline;
            cursor: pointer;
          }
        `}</style>
        {viewMode === 'continuous' ? (
          // Continuous view - single page
          <div className="max-w-[816px] mx-auto bg-white min-h-[1056px] p-24 shadow-lg relative">
            <TiptapReact.EditorContent
              editor={editor}
              className="text-black text-base"
              style={{
                lineHeight: lineSpacing,
              }}
            />
          </div>
        ) : (
          // Page view - single scrollable page with page break indicators
          <div className="max-w-[816px] mx-auto relative">
            <div
              className="bg-white min-h-[1056px] p-24 shadow-lg relative"
              style={{
                backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 1055px, #e0e0e0 1055px, #e0e0e0 1057px)',
                backgroundSize: '100% 1056px',
              }}
            >
              <TiptapReact.EditorContent
                editor={editor}
                className="text-black text-base"
                style={{
                  lineHeight: lineSpacing,
                }}
              />
            </div>
            {/* Page indicator overlays */}
            <div className="absolute right-[-50px] top-0 flex flex-col gap-[1056px]">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="text-slate-500 text-[11px] py-1 px-2 bg-slate-800 rounded whitespace-nowrap">
                  Page {i + 1}
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Image resize overlay */}
        {selectedImage && (
          <ImageResizeOverlay
            image={selectedImage}
            onResize={handleImageResize}
          />
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-slate-800 py-1.5 px-3 border-t border-slate-600 text-xs text-slate-500 flex gap-5">
        <span>Characters: {editor.getText().length}</span>
        <span>Words: {editor.getText().split(/\s+/).filter(Boolean).length}</span>
        {editor.state.selection && editor.state.selection.from !== editor.state.selection.to && (
          <span>Selected: {editor.state.selection.to - editor.state.selection.from} chars</span>
        )}
      </div>
    </div>
  );
};
