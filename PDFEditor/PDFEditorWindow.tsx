// Dynamic PDF Editor Window
// Uses PDF.js for rendering and canvas for annotations
// Supports: Opening PDFs, continuous scrolling, text annotations, drawing, highlighting, saving as PDF

import React, { useState, useRef, useEffect, useCallback } from 'react';

// Electron IPC for file operations
const { ipcRenderer } = window.require ? window.require('electron') : { ipcRenderer: null };

// PDF.js and jsPDF will be loaded from CDN
declare const pdfjsLib: any;
declare const jspdf: any;

// Available fonts for text annotations
const FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
  'Trebuchet MS',
  'Impact',
  'Comic Sans MS',
  'Palatino Linotype',
] as const;

interface Annotation {
  id: string;
  type: 'text' | 'highlight' | 'drawing' | 'rectangle' | 'image';
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  content?: string;
  color: string;
  fontSize?: number;
  fontFamily?: string;
  opacity?: number; // For highlights (0-1)
  points?: { x: number; y: number }[];
  imageData?: string; // Base64 image data for image annotations
}

interface PDFState {
  document: any;
  numPages: number;
  currentPage: number;
  scale: number;
  fileName: string;
  filePath: string | null;
}

interface PageRenderState {
  rendered: boolean;
  rendering: boolean;
}

interface PageDimensions {
  width: number;
  height: number;
}

export const PDFEditorWindow: React.FC = () => {
  const [pdfState, setPdfState] = useState<PDFState | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedTool, setSelectedTool] = useState<'select' | 'text' | 'highlight' | 'draw' | 'rectangle' | 'image'>('select');
  const [selectedColor, setSelectedColor] = useState('#ffff00');
  const [fontSize, setFontSize] = useState(14);
  const [fontFamily, setFontFamily] = useState<string>('Arial');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<{ x: number; y: number }[]>([]);
  const [drawingPage, setDrawingPage] = useState<number | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number; page: number; visible: boolean }>({ x: 0, y: 0, page: 1, visible: false });
  const [loading, setLoading] = useState(false);
  const [pdfJsLoaded, setPdfJsLoaded] = useState(false);
  const [jsPdfLoaded, setJsPdfLoaded] = useState(false);
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pageRenderStates, setPageRenderStates] = useState<Map<number, PageRenderState>>(new Map());
  const [viewMode, setViewMode] = useState<'single' | 'continuous'>('continuous');
  const [pageDimensions, setPageDimensions] = useState<Map<number, PageDimensions>>(new Map());
  const [highlightOpacity, setHighlightOpacity] = useState(0.3);

  // Drag state for moving annotations
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragAnnotationStart, setDragAnnotationStart] = useState<{ x: number; y: number } | null>(null);

  // Undo/Redo history
  const [annotationHistory, setAnnotationHistory] = useState<Annotation[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageCanvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const annotationCanvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const loadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Load PDF.js from CDN
  useEffect(() => {
    if ((window as any).pdfjsLib) {
      setPdfJsLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      const pdfjsLib = (window as any).pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      setPdfJsLoaded(true);
    };
    document.head.appendChild(script);
  }, []);

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

  // Push annotations to history (for undo/redo)
  const pushToHistory = useCallback((newAnnotations: Annotation[]) => {
    setAnnotationHistory(prev => {
      // Remove any future states if we're not at the end
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push([...newAnnotations]);
      // Limit history to 50 states
      if (newHistory.length > 50) {
        newHistory.shift();
        return newHistory;
      }
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex]);

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setAnnotations(annotationHistory[newIndex] || []);
      setSelectedAnnotation(null);
    }
  }, [historyIndex, annotationHistory]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < annotationHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setAnnotations(annotationHistory[newIndex] || []);
      setSelectedAnnotation(null);
    }
  }, [historyIndex, annotationHistory]);

  // Update annotations with history tracking
  const updateAnnotations = useCallback((updater: (prev: Annotation[]) => Annotation[]) => {
    setAnnotations(prev => {
      const newAnnotations = updater(prev);
      pushToHistory(newAnnotations);
      return newAnnotations;
    });
  }, [pushToHistory]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          setTextInputPos(prev => ({ ...prev, visible: false }));
        }
        return;
      }

      // Delete selected annotation
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotation) {
        e.preventDefault();
        updateAnnotations(prev => prev.filter(a => a.id !== selectedAnnotation));
        setSelectedAnnotation(null);
      }

      // Undo: Ctrl+Z
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
          (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault();
        redo();
      }

      // Escape: Deselect
      if (e.key === 'Escape') {
        setSelectedAnnotation(null);
        setTextInputPos(prev => ({ ...prev, visible: false }));
      }

      // Zoom in: + or =
      if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey && pdfState) {
        e.preventDefault();
        setScale((pdfState.scale || 1) + 0.25);
      }

      // Zoom out: -
      if (e.key === '-' && !e.ctrlKey && !e.metaKey && pdfState) {
        e.preventDefault();
        setScale((pdfState.scale || 1) - 0.25);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnnotation, pdfState, undo, redo, updateAnnotations]);

  // Render a specific page
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfState?.document) return;

    const canvas = pageCanvasRefs.current.get(pageNum);
    if (!canvas) return;

    // Check if already rendering or rendered
    const state = pageRenderStates.get(pageNum);
    if (state?.rendered || state?.rendering) return;

    // Mark as rendering
    setPageRenderStates(prev => {
      const newMap = new Map(prev);
      newMap.set(pageNum, { rendered: false, rendering: true });
      return newMap;
    });

    try {
      const page = await pdfState.document.getPage(pageNum);
      const viewport = page.getViewport({ scale: pdfState.scale });

      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Also resize annotation canvas
      const annotationCanvas = annotationCanvasRefs.current.get(pageNum);
      if (annotationCanvas) {
        annotationCanvas.width = viewport.width;
        annotationCanvas.height = viewport.height;
      }

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      // Mark as rendered
      setPageRenderStates(prev => {
        const newMap = new Map(prev);
        newMap.set(pageNum, { rendered: true, rendering: false });
        return newMap;
      });

      // Render annotations for this page
      renderAnnotationsForPage(pageNum);
    } catch (error) {
      console.error(`Error rendering page ${pageNum}:`, error);
      setPageRenderStates(prev => {
        const newMap = new Map(prev);
        newMap.set(pageNum, { rendered: false, rendering: false });
        return newMap;
      });
    }
  }, [pdfState]);

  // Render annotations for a specific page
  const renderAnnotationsForPage = useCallback((pageNum: number) => {
    if (!pdfState) return;

    const canvas = annotationCanvasRefs.current.get(pageNum);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scale = pdfState.scale;
    const pageAnnotations = annotations.filter(a => a.page === pageNum);

    for (const ann of pageAnnotations) {
      ctx.save();

      const isSelected = ann.id === selectedAnnotation;

      switch (ann.type) {
        case 'text':
          ctx.font = `${(ann.fontSize || 14) * scale}px ${ann.fontFamily || 'Arial'}`;
          ctx.fillStyle = ann.color;
          ctx.fillText(ann.content || '', ann.x * scale, ann.y * scale);
          if (isSelected) {
            const metrics = ctx.measureText(ann.content || '');
            ctx.strokeStyle = '#0066ff';
            ctx.lineWidth = 2;
            ctx.strokeRect(ann.x * scale - 2, ann.y * scale - (ann.fontSize || 14) * scale, metrics.width + 4, (ann.fontSize || 14) * scale + 4);
          }
          break;

        case 'highlight':
          ctx.fillStyle = ann.color;
          ctx.globalAlpha = ann.opacity ?? highlightOpacity;
          ctx.fillRect(ann.x * scale, ann.y * scale, (ann.width || 100) * scale, (ann.height || 20) * scale);
          ctx.globalAlpha = 1;
          if (isSelected) {
            ctx.strokeStyle = '#0066ff';
            ctx.lineWidth = 2;
            ctx.strokeRect(ann.x * scale, ann.y * scale, (ann.width || 100) * scale, (ann.height || 20) * scale);
          }
          break;

        case 'rectangle':
          ctx.strokeStyle = ann.color;
          ctx.lineWidth = 2 * scale;
          ctx.strokeRect(ann.x * scale, ann.y * scale, (ann.width || 100) * scale, (ann.height || 100) * scale);
          if (isSelected) {
            ctx.strokeStyle = '#0066ff';
            ctx.lineWidth = 3;
            ctx.strokeRect(ann.x * scale - 2, ann.y * scale - 2, (ann.width || 100) * scale + 4, (ann.height || 100) * scale + 4);
          }
          break;

        case 'drawing':
          if (ann.points && ann.points.length > 1) {
            ctx.strokeStyle = ann.color;
            ctx.lineWidth = 2 * scale;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(ann.points[0].x * scale, ann.points[0].y * scale);
            for (let i = 1; i < ann.points.length; i++) {
              ctx.lineTo(ann.points[i].x * scale, ann.points[i].y * scale);
            }
            ctx.stroke();
          }
          break;

        case 'image':
          if (ann.imageData) {
            // Check if image is already loaded
            let img = loadedImagesRef.current.get(ann.id);
            if (!img) {
              img = new Image();
              img.src = ann.imageData;
              loadedImagesRef.current.set(ann.id, img);
              img.onload = () => renderAnnotationsForPage(pageNum);
            }
            if (img.complete) {
              ctx.drawImage(img, ann.x * scale, ann.y * scale, (ann.width || 100) * scale, (ann.height || 100) * scale);
              if (isSelected) {
                ctx.strokeStyle = '#0066ff';
                ctx.lineWidth = 2;
                ctx.strokeRect(ann.x * scale - 2, ann.y * scale - 2, (ann.width || 100) * scale + 4, (ann.height || 100) * scale + 4);
              }
            }
          }
          break;
      }

      ctx.restore();
    }

    // Draw current drawing in progress for this page
    if (isDrawing && drawingPage === pageNum && currentDrawing.length > 1) {
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(currentDrawing[0].x, currentDrawing[0].y);
      for (let i = 1; i < currentDrawing.length; i++) {
        ctx.lineTo(currentDrawing[i].x, currentDrawing[i].y);
      }
      ctx.stroke();
    }
  }, [annotations, pdfState, selectedAnnotation, isDrawing, drawingPage, currentDrawing, selectedColor]);

  // Re-render annotations when they change
  useEffect(() => {
    if (!pdfState) return;
    for (let i = 1; i <= pdfState.numPages; i++) {
      if (pageRenderStates.get(i)?.rendered) {
        renderAnnotationsForPage(i);
      }
    }
  }, [annotations, selectedAnnotation, pdfState, pageRenderStates, renderAnnotationsForPage]);

  // Re-render current drawing preview
  useEffect(() => {
    if (isDrawing && drawingPage) {
      renderAnnotationsForPage(drawingPage);
    }
  }, [currentDrawing, isDrawing, drawingPage, renderAnnotationsForPage]);

  // Setup Intersection Observer for lazy loading
  useEffect(() => {
    if (!pdfState) return;

    // Clean up previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.getAttribute('data-page') || '0');
            if (pageNum > 0) {
              renderPage(pageNum);
            }
          }
        });
      },
      {
        root: containerRef.current,
        rootMargin: '200px', // Load pages 200px before they come into view
        threshold: 0
      }
    );

    // Observe all page containers
    pageContainerRefs.current.forEach((container, pageNum) => {
      if (observerRef.current) {
        observerRef.current.observe(container);
      }
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [pdfState, renderPage]);

  // Update current page based on scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfState) return;

    const handleScroll = () => {
      const containerRect = container.getBoundingClientRect();
      const containerCenter = containerRect.top + containerRect.height / 2;

      let closestPage = 1;
      let closestDistance = Infinity;

      pageContainerRefs.current.forEach((pageContainer, pageNum) => {
        const pageRect = pageContainer.getBoundingClientRect();
        const pageCenter = pageRect.top + pageRect.height / 2;
        const distance = Math.abs(pageCenter - containerCenter);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = pageNum;
        }
      });

      if (closestPage !== pdfState.currentPage) {
        setPdfState(prev => prev ? { ...prev, currentPage: closestPage } : null);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [pdfState]);

  // Re-render all pages when scale changes
  useEffect(() => {
    if (!pdfState) return;

    // Clear render states to force re-render
    setPageRenderStates(new Map());

    // Recalculate page dimensions for new scale
    const recalcDimensions = async () => {
      if (!pdfState?.document) return;
      const dims = new Map<number, PageDimensions>();
      for (let i = 1; i <= pdfState.numPages; i++) {
        const page = await pdfState.document.getPage(i);
        const viewport = page.getViewport({ scale: pdfState.scale });
        dims.set(i, { width: viewport.width, height: viewport.height });
      }
      setPageDimensions(dims);
    };
    recalcDimensions();

    // Small delay to let the DOM update
    setTimeout(() => {
      pageContainerRefs.current.forEach((container) => {
        if (observerRef.current) {
          observerRef.current.unobserve(container);
          observerRef.current.observe(container);
        }
      });
    }, 50);
  }, [pdfState?.scale, pdfState?.document, pdfState?.numPages]);

  // Open PDF file
  const openPDF = async () => {
    if (!pdfJsLoaded) {
      EventBus.getInstance().publish('log-message', 'PDF.js still loading...');
      return;
    }

    if (ipcRenderer) {
      try {
        const result = await ipcRenderer.invoke('show-open-dialog', {
          title: 'Open PDF',
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
          properties: ['openFile']
        });

        if (!result.success || result.canceled) return;

        const filePath = result.filePaths[0];
        setLoading(true);

        const readResult = await ipcRenderer.invoke('read-file', { filePath, encoding: 'base64' });
        if (!readResult.success) {
          EventBus.getInstance().publish('log-message', `Error reading PDF: ${readResult.error}`);
          setLoading(false);
          return;
        }

        const pdfData = atob(readResult.content);
        const pdfArray = new Uint8Array(pdfData.length);
        for (let i = 0; i < pdfData.length; i++) {
          pdfArray[i] = pdfData.charCodeAt(i);
        }

        const pdfjsLib = (window as any).pdfjsLib;
        const doc = await pdfjsLib.getDocument({ data: pdfArray }).promise;

        const fileName = filePath.split(/[/\\]/).pop() || 'document.pdf';

        // Reset state for new document
        pageCanvasRefs.current.clear();
        annotationCanvasRefs.current.clear();
        pageContainerRefs.current.clear();
        setPageRenderStates(new Map());
        setAnnotations([]);
        setAnnotationHistory([[]]);
        setHistoryIndex(0);
        setSelectedAnnotation(null);

        // Calculate dimensions for all pages
        const defaultScale = 1.5;
        const dims = new Map<number, PageDimensions>();
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: defaultScale });
          dims.set(i, { width: viewport.width, height: viewport.height });
        }
        setPageDimensions(dims);

        setPdfState({
          document: doc,
          numPages: doc.numPages,
          currentPage: 1,
          scale: defaultScale,
          fileName,
          filePath,
        });
        setLoading(false);
        EventBus.getInstance().publish('log-message', `Opened: ${fileName} (${doc.numPages} pages)`);
      } catch (error) {
        EventBus.getInstance().publish('log-message', `Error opening PDF: ${error}`);
        setLoading(false);
      }
    } else {
      // Browser fallback with file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        setLoading(true);
        const arrayBuffer = await file.arrayBuffer();
        const pdfjsLib = (window as any).pdfjsLib;
        const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        // Reset state for new document
        pageCanvasRefs.current.clear();
        annotationCanvasRefs.current.clear();
        pageContainerRefs.current.clear();
        setPageRenderStates(new Map());
        setAnnotations([]);
        setAnnotationHistory([[]]);
        setHistoryIndex(0);
        setSelectedAnnotation(null);

        // Calculate dimensions for all pages
        const defaultScale = 1.5;
        const dims = new Map<number, PageDimensions>();
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: defaultScale });
          dims.set(i, { width: viewport.width, height: viewport.height });
        }
        setPageDimensions(dims);

        setPdfState({
          document: doc,
          numPages: doc.numPages,
          currentPage: 1,
          scale: defaultScale,
          fileName: file.name,
          filePath: null,
        });
        setLoading(false);
        EventBus.getInstance().publish('log-message', `Opened: ${file.name} (${doc.numPages} pages)`);
      };
      input.click();
    }
  };

  // Export annotated PDF as images or save annotations
  const exportAnnotations = async () => {
    if (!pdfState) return;

    const annotationsJson = JSON.stringify(annotations, null, 2);

    if (ipcRenderer) {
      const result = await ipcRenderer.invoke('show-save-dialog', {
        title: 'Save Annotations',
        defaultPath: pdfState.fileName.replace('.pdf', '_annotations.json'),
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });

      if (!result.success || result.canceled) return;

      const writeResult = await ipcRenderer.invoke('write-file', {
        filePath: result.filePath,
        content: annotationsJson
      });

      if (writeResult.success) {
        EventBus.getInstance().publish('log-message', `Annotations saved to: ${result.filePath}`);
      }
    } else {
      // Browser download
      const blob = new Blob([annotationsJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfState.fileName.replace('.pdf', '_annotations.json');
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Load annotations from file
  const loadAnnotations = async () => {
    if (ipcRenderer) {
      const result = await ipcRenderer.invoke('show-open-dialog', {
        title: 'Load Annotations',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile']
      });

      if (!result.success || result.canceled) return;

      const readResult = await ipcRenderer.invoke('read-file', result.filePaths[0]);
      if (readResult.success) {
        try {
          const loaded = JSON.parse(readResult.content);
          setAnnotations(loaded);
          pushToHistory(loaded);
          EventBus.getInstance().publish('log-message', `Loaded ${loaded.length} annotations`);
        } catch {
          EventBus.getInstance().publish('log-message', 'Error parsing annotations file');
        }
      }
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const text = await file.text();
        try {
          const loaded = JSON.parse(text);
          setAnnotations(loaded);
          pushToHistory(loaded);
          EventBus.getInstance().publish('log-message', `Loaded ${loaded.length} annotations`);
        } catch {
          EventBus.getInstance().publish('log-message', 'Error parsing annotations file');
        }
      };
      input.click();
    }
  };

  // Export current page as image with annotations
  const exportAsImage = async () => {
    if (!pdfState) return;

    const pageCanvas = pageCanvasRefs.current.get(pdfState.currentPage);
    const annotationCanvas = annotationCanvasRefs.current.get(pdfState.currentPage);
    if (!pageCanvas || !annotationCanvas) return;

    // Create combined canvas
    const combined = document.createElement('canvas');
    combined.width = pageCanvas.width;
    combined.height = pageCanvas.height;
    const ctx = combined.getContext('2d');
    if (!ctx) return;

    // Draw PDF
    ctx.drawImage(pageCanvas, 0, 0);
    // Draw annotations
    ctx.drawImage(annotationCanvas, 0, 0);

    if (ipcRenderer) {
      const result = await ipcRenderer.invoke('show-save-dialog', {
        title: 'Export Page as Image',
        defaultPath: `${pdfState.fileName.replace('.pdf', '')}_page${pdfState.currentPage}.png`,
        filters: [{ name: 'PNG Images', extensions: ['png'] }]
      });

      if (!result.success || result.canceled) return;

      const dataUrl = combined.toDataURL('image/png');
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

      const writeResult = await ipcRenderer.invoke('write-file', {
        filePath: result.filePath,
        content: base64Data,
        encoding: 'base64'
      });

      if (writeResult.success) {
        EventBus.getInstance().publish('log-message', `Page exported to: ${result.filePath}`);
      } else {
        EventBus.getInstance().publish('log-message', `Error exporting: ${writeResult.error}`);
      }
    } else {
      const dataUrl = combined.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${pdfState.fileName.replace('.pdf', '')}_page${pdfState.currentPage}.png`;
      a.click();
    }
  };

  // Save as PDF with annotations baked in
  const saveAsPDF = async () => {
    if (!pdfState || !jsPdfLoaded) {
      EventBus.getInstance().publish('log-message', 'jsPDF not loaded yet...');
      return;
    }

    setSaving(true);
    EventBus.getInstance().publish('log-message', 'Generating PDF with annotations...');

    try {
      const { jsPDF } = (window as any).jspdf;

      // Get first page to determine dimensions
      const firstPage = await pdfState.document.getPage(1);
      const viewport = firstPage.getViewport({ scale: 2 }); // Higher scale for quality

      // Determine orientation based on page dimensions
      const orientation = viewport.width > viewport.height ? 'landscape' : 'portrait';

      // Create PDF with proper dimensions (convert pixels to mm at 72 DPI)
      const pdfWidth = viewport.width * 25.4 / 72 / 2; // Divide by 2 because we used scale 2
      const pdfHeight = viewport.height * 25.4 / 72 / 2;

      const pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format: [pdfWidth, pdfHeight]
      });

      // Process each page
      for (let pageNum = 1; pageNum <= pdfState.numPages; pageNum++) {
        if (pageNum > 1) {
          pdf.addPage([pdfWidth, pdfHeight], orientation);
        }

        // Render page to canvas
        const page = await pdfState.document.getPage(pageNum);
        const pageViewport = page.getViewport({ scale: 2 });

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = pageViewport.width;
        tempCanvas.height = pageViewport.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) continue;

        await page.render({
          canvasContext: tempCtx,
          viewport: pageViewport,
        }).promise;

        // Draw annotations for this page
        // Annotations are stored in normalized coordinates (scale 1.0)
        // Multiply by output scale (2) to render at correct position
        const pageAnnotations = annotations.filter(a => a.page === pageNum);
        const outputScale = 2;

        for (const ann of pageAnnotations) {
          switch (ann.type) {
            case 'text':
              tempCtx.font = `${(ann.fontSize || 14) * outputScale}px ${ann.fontFamily || 'Arial'}`;
              tempCtx.fillStyle = ann.color;
              tempCtx.fillText(ann.content || '', ann.x * outputScale, ann.y * outputScale);
              break;

            case 'highlight':
              tempCtx.fillStyle = ann.color;
              tempCtx.globalAlpha = ann.opacity ?? 0.3;
              tempCtx.fillRect(ann.x * outputScale, ann.y * outputScale, (ann.width || 100) * outputScale, (ann.height || 20) * outputScale);
              tempCtx.globalAlpha = 1;
              break;

            case 'rectangle':
              tempCtx.strokeStyle = ann.color;
              tempCtx.lineWidth = 2 * outputScale;
              tempCtx.strokeRect(ann.x * outputScale, ann.y * outputScale, (ann.width || 100) * outputScale, (ann.height || 100) * outputScale);
              break;

            case 'drawing':
              if (ann.points && ann.points.length > 1) {
                tempCtx.strokeStyle = ann.color;
                tempCtx.lineWidth = 2 * outputScale;
                tempCtx.lineCap = 'round';
                tempCtx.lineJoin = 'round';
                tempCtx.beginPath();
                tempCtx.moveTo(ann.points[0].x * outputScale, ann.points[0].y * outputScale);
                for (let i = 1; i < ann.points.length; i++) {
                  tempCtx.lineTo(ann.points[i].x * outputScale, ann.points[i].y * outputScale);
                }
                tempCtx.stroke();
              }
              break;

            case 'image':
              if (ann.imageData) {
                const img = loadedImagesRef.current.get(ann.id);
                if (img && img.complete) {
                  tempCtx.drawImage(img, ann.x * outputScale, ann.y * outputScale, (ann.width || 100) * outputScale, (ann.height || 100) * outputScale);
                }
              }
              break;
          }
        }

        // Add page image to PDF
        const imgData = tempCanvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

        EventBus.getInstance().publish('log-message', `Processing page ${pageNum}/${pdfState.numPages}...`);
      }

      // Save the PDF
      if (ipcRenderer) {
        const result = await ipcRenderer.invoke('show-save-dialog', {
          title: 'Save PDF',
          defaultPath: pdfState.fileName.replace('.pdf', '_annotated.pdf'),
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
        });

        if (!result.success || result.canceled) {
          setSaving(false);
          return;
        }

        // Get PDF as arraybuffer and convert to binary string for writing
        const pdfArrayBuffer = pdf.output('arraybuffer');
        const pdfBytes = new Uint8Array(pdfArrayBuffer);
        let binaryString = '';
        for (let i = 0; i < pdfBytes.length; i++) {
          binaryString += String.fromCharCode(pdfBytes[i]);
        }

        // Write using base64 encoding parameter
        const writeResult = await ipcRenderer.invoke('write-file', {
          filePath: result.filePath,
          content: btoa(binaryString),
          encoding: 'base64'
        });

        if (writeResult.success) {
          EventBus.getInstance().publish('log-message', `PDF saved to: ${result.filePath}`);
        } else {
          EventBus.getInstance().publish('log-message', `Error saving PDF: ${writeResult.error}`);
        }
      } else {
        // Browser download
        pdf.save(pdfState.fileName.replace('.pdf', '_annotated.pdf'));
        EventBus.getInstance().publish('log-message', 'PDF downloaded');
      }
    } catch (error) {
      EventBus.getInstance().publish('log-message', `Error generating PDF: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  // Handle canvas click for a specific page
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>, pageNum: number) => {
    if (!pdfState) return;

    const canvas = annotationCanvasRefs.current.get(pageNum);
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const scale = pdfState.scale;
    const x = screenX / scale;
    const y = screenY / scale;

    if (selectedTool === 'select') {
      const pageAnnotations = annotations.filter(a => a.page === pageNum);
      let found = false;

      for (const ann of pageAnnotations.reverse()) {
        let hit = false;

        switch (ann.type) {
          case 'text':
            const textWidth = (ann.content?.length || 0) * (ann.fontSize || 14) * 0.6;
            hit = x >= ann.x && x <= ann.x + textWidth &&
                  y >= ann.y - (ann.fontSize || 14) && y <= ann.y;
            break;
          case 'highlight':
          case 'rectangle':
            hit = x >= ann.x && x <= ann.x + (ann.width || 100) &&
                  y >= ann.y && y <= ann.y + (ann.height || 20);
            break;
          case 'drawing':
            if (ann.points) {
              for (const pt of ann.points) {
                if (Math.abs(pt.x - x) < 10 / scale && Math.abs(pt.y - y) < 10 / scale) {
                  hit = true;
                  break;
                }
              }
            }
            break;
          case 'image':
            hit = x >= ann.x && x <= ann.x + (ann.width || 100) &&
                  y >= ann.y && y <= ann.y + (ann.height || 100);
            break;
        }

        if (hit) {
          setSelectedAnnotation(ann.id);
          found = true;
          break;
        }
      }

      if (!found) {
        setSelectedAnnotation(null);
      }
    } else if (selectedTool === 'text') {
      setTextInputPos({ x: screenX, y: screenY, page: pageNum, visible: true });
      setTextInput('');
    }
  };

  // Handle mouse down for drawing and highlighting
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>, pageNum: number) => {
    if (!pdfState) return;

    const canvas = annotationCanvasRefs.current.get(pageNum);
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scale = pdfState.scale;

    // Check if we're clicking on a selected annotation to drag it
    if (selectedTool === 'select' && selectedAnnotation) {
      const ann = annotations.find(a => a.id === selectedAnnotation);
      if (ann && ann.page === pageNum) {
        const normX = x / scale;
        const normY = y / scale;
        let isOnAnnotation = false;

        // Check if click is on the annotation
        switch (ann.type) {
          case 'text':
            const textWidth = (ann.content?.length || 0) * (ann.fontSize || 14) * 0.6;
            isOnAnnotation = normX >= ann.x && normX <= ann.x + textWidth &&
                            normY >= ann.y - (ann.fontSize || 14) && normY <= ann.y;
            break;
          case 'highlight':
          case 'rectangle':
          case 'image':
            isOnAnnotation = normX >= ann.x && normX <= ann.x + (ann.width || 100) &&
                            normY >= ann.y && normY <= ann.y + (ann.height || 100);
            break;
          case 'drawing':
            if (ann.points) {
              for (const pt of ann.points) {
                if (Math.abs(pt.x - normX) < 15 && Math.abs(pt.y - normY) < 15) {
                  isOnAnnotation = true;
                  break;
                }
              }
            }
            break;
        }

        if (isOnAnnotation) {
          setIsDragging(true);
          setDragStart({ x: normX, y: normY });
          setDragAnnotationStart({ x: ann.x, y: ann.y });
          setDrawingPage(pageNum);
          return;
        }
      }
    }

    if (selectedTool !== 'draw' && selectedTool !== 'highlight' && selectedTool !== 'rectangle') return;

    if (selectedTool === 'draw') {
      setIsDrawing(true);
      setDrawingPage(pageNum);
      setCurrentDrawing([{ x, y }]);
    } else if (selectedTool === 'highlight' || selectedTool === 'rectangle') {
      setRectStart({ x, y });
      setDrawingPage(pageNum);
      setIsDrawing(true);
    }
  };

  // Handle mouse move for drawing and dragging
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>, pageNum: number) => {
    const canvas = annotationCanvasRefs.current.get(pageNum);
    if (!canvas || !pdfState) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scale = pdfState.scale;

    // Handle dragging annotation
    if (isDragging && dragStart && dragAnnotationStart && selectedAnnotation && drawingPage === pageNum) {
      const normX = x / scale;
      const normY = y / scale;
      const deltaX = normX - dragStart.x;
      const deltaY = normY - dragStart.y;

      setAnnotations(prev => prev.map(ann => {
        if (ann.id !== selectedAnnotation) return ann;

        if (ann.type === 'drawing' && ann.points) {
          // Move all points for drawing annotations
          const pointDeltaX = dragAnnotationStart.x + deltaX - ann.x;
          const pointDeltaY = dragAnnotationStart.y + deltaY - ann.y;
          return {
            ...ann,
            x: dragAnnotationStart.x + deltaX,
            y: dragAnnotationStart.y + deltaY,
            points: ann.points.map(pt => ({
              x: pt.x + pointDeltaX,
              y: pt.y + pointDeltaY,
            })),
          };
        }

        return {
          ...ann,
          x: dragAnnotationStart.x + deltaX,
          y: dragAnnotationStart.y + deltaY,
        };
      }));
      return;
    }

    if (!isDrawing || drawingPage !== pageNum) return;

    if (selectedTool === 'draw') {
      setCurrentDrawing(prev => [...prev, { x, y }]);
    } else if ((selectedTool === 'highlight' || selectedTool === 'rectangle') && rectStart) {
      // Preview rectangle
      const ctx = canvas.getContext('2d');
      if (ctx) {
        renderAnnotationsForPage(pageNum);
        ctx.save();
        if (selectedTool === 'highlight') {
          ctx.fillStyle = selectedColor;
          ctx.globalAlpha = highlightOpacity;
          ctx.fillRect(rectStart.x, rectStart.y, x - rectStart.x, y - rectStart.y);
        } else {
          ctx.strokeStyle = selectedColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(rectStart.x, rectStart.y, x - rectStart.x, y - rectStart.y);
        }
        ctx.restore();
      }
    }
  };

  // Handle mouse up for drawing and dragging
  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>, pageNum: number) => {
    // Handle end of drag
    if (isDragging) {
      setIsDragging(false);
      setDragStart(null);
      setDragAnnotationStart(null);
      setDrawingPage(null);
      // Push to history after drag completes
      pushToHistory(annotations);
      return;
    }

    if (!isDrawing || !pdfState || drawingPage !== pageNum) return;

    const scale = pdfState.scale;
    const canvas = annotationCanvasRefs.current.get(pageNum);

    if (selectedTool === 'draw' && currentDrawing.length > 1) {
      const normalizedPoints = currentDrawing.map(pt => ({
        x: pt.x / scale,
        y: pt.y / scale
      }));
      const newAnnotation: Annotation = {
        id: `ann_${Date.now()}`,
        type: 'drawing',
        page: pageNum,
        x: normalizedPoints[0].x,
        y: normalizedPoints[0].y,
        color: selectedColor,
        points: normalizedPoints,
      };
      updateAnnotations(prev => [...prev, newAnnotation]);
    } else if ((selectedTool === 'highlight' || selectedTool === 'rectangle') && rectStart && canvas) {
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const width = screenX - rectStart.x;
      const height = screenY - rectStart.y;

      if (Math.abs(width) > 5 && Math.abs(height) > 5) {
        const newAnnotation: Annotation = {
          id: `ann_${Date.now()}`,
          type: selectedTool,
          page: pageNum,
          x: (width > 0 ? rectStart.x : screenX) / scale,
          y: (height > 0 ? rectStart.y : screenY) / scale,
          width: Math.abs(width) / scale,
          height: Math.abs(height) / scale,
          color: selectedColor,
          opacity: selectedTool === 'highlight' ? highlightOpacity : undefined,
        };
        updateAnnotations(prev => [...prev, newAnnotation]);
      }
    }

    setIsDrawing(false);
    setCurrentDrawing([]);
    setRectStart(null);
    setDrawingPage(null);
  };

  // Add text annotation
  const addTextAnnotation = () => {
    if (!textInput.trim() || !pdfState) return;

    const scale = pdfState.scale;
    const newAnnotation: Annotation = {
      id: `ann_${Date.now()}`,
      type: 'text',
      page: textInputPos.page,
      x: textInputPos.x / scale,
      y: textInputPos.y / scale,
      content: textInput,
      color: selectedColor,
      fontSize: fontSize,
      fontFamily: fontFamily,
    };

    updateAnnotations(prev => [...prev, newAnnotation]);
    setTextInputPos({ ...textInputPos, visible: false });
    setTextInput('');
  };

  // Delete selected annotation
  const deleteSelected = () => {
    if (!selectedAnnotation) return;
    updateAnnotations(prev => prev.filter(a => a.id !== selectedAnnotation));
    setSelectedAnnotation(null);
  };

  // Handle image file selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pdfState) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const imageData = event.target?.result as string;
      if (!imageData) return;

      // Create image to get dimensions
      const img = new Image();
      img.onload = () => {
        // Scale image to fit reasonably on page (max 300px width at scale 1)
        const maxWidth = 300;
        const scale = pdfState.scale;
        let width = img.width / scale;
        let height = img.height / scale;

        if (width > maxWidth) {
          const ratio = maxWidth / width;
          width = maxWidth;
          height = height * ratio;
        }

        const newAnnotation: Annotation = {
          id: `ann_${Date.now()}`,
          type: 'image',
          page: pdfState.currentPage,
          x: 50, // Default position
          y: 50,
          width: width,
          height: height,
          color: '', // Not used for images
          imageData: imageData,
        };

        // Pre-load the image
        loadedImagesRef.current.set(newAnnotation.id, img);

        updateAnnotations(prev => [...prev, newAnnotation]);
      };
      img.src = imageData;
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Trigger image file picker
  const importImage = () => {
    imageInputRef.current?.click();
  };

  // Navigation - scroll to page (continuous) or change page (single)
  const goToPage = (page: number) => {
    if (!pdfState) return;
    const targetPage = Math.max(1, Math.min(page, pdfState.numPages));

    if (viewMode === 'single') {
      // In single mode, just update the current page
      setPdfState({ ...pdfState, currentPage: targetPage });
    } else {
      // In continuous mode, scroll to the page
      // Update current page state immediately for UI feedback
      setPdfState({ ...pdfState, currentPage: targetPage });

      // Try to scroll to the page container
      const pageContainer = pageContainerRefs.current.get(targetPage);
      if (pageContainer && containerRef.current) {
        pageContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        // If the container isn't available yet, use a fallback scroll calculation
        // based on page dimensions
        if (containerRef.current) {
          let scrollTop = 0;
          for (let i = 1; i < targetPage; i++) {
            const dims = pageDimensions.get(i);
            scrollTop += (dims?.height || 792 * pdfState.scale) + 20; // 20px margin between pages
          }
          containerRef.current.scrollTo({ top: scrollTop, behavior: 'smooth' });
        }
      }
    }
  };

  // Clean up refs and states when view mode changes
  useEffect(() => {
    if (!pdfState) return;

    // Disconnect the observer before clearing refs
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // Clear all canvas refs - they will be re-set when new elements mount
    pageCanvasRefs.current.clear();
    annotationCanvasRefs.current.clear();
    pageContainerRefs.current.clear();

    // Clear render states to force re-render of visible pages
    setPageRenderStates(new Map());

    // Small delay to let React unmount old elements and mount new ones
    const timer = setTimeout(() => {
      if (viewMode === 'single') {
        // In single mode, render the current page
        renderPage(pdfState.currentPage);
      } else {
        // In continuous mode, the Intersection Observer will handle rendering
        // We need to re-observe the page containers
        pageContainerRefs.current.forEach((container: HTMLDivElement) => {
          if (observerRef.current) {
            observerRef.current.observe(container);
          }
        });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [viewMode]);

  // Render current page in single mode when page or scale changes
  useEffect(() => {
    if (viewMode === 'single' && pdfState) {
      // Small delay to ensure canvas refs are set
      setTimeout(() => {
        renderPage(pdfState.currentPage);
      }, 50);
    }
  }, [pdfState?.currentPage, pdfState?.scale, renderPage]);

  const setScale = (scale: number) => {
    if (!pdfState) return;
    setPdfState({ ...pdfState, scale: Math.max(0.5, Math.min(3, scale)) });
  };

  // Styles - base button class
  const buttonClass = 'py-1.5 px-3 border border-slate-600 rounded bg-slate-700 text-white cursor-pointer text-xs hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  const toolButtonClass = (tool: string) =>
    `py-1.5 px-3 border rounded text-white cursor-pointer text-xs min-w-[60px] transition-colors disabled:opacity-50 ${
      selectedTool === tool
        ? 'bg-blue-500 border-blue-500'
        : 'bg-slate-700 border-slate-600 hover:bg-slate-600'
    }`;

  // Get estimated page dimensions for placeholder
  const getPageDimensions = useCallback(async (pageNum: number) => {
    if (!pdfState?.document) return { width: 612, height: 792 }; // Default US Letter
    try {
      const page = await pdfState.document.getPage(pageNum);
      const viewport = page.getViewport({ scale: pdfState.scale });
      return { width: viewport.width, height: viewport.height };
    } catch {
      return { width: 612 * pdfState.scale, height: 792 * pdfState.scale };
    }
  }, [pdfState]);

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Hidden file input for image import */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageSelect}
        className="hidden"
      />

      {/* Top Menu Bar */}
      <div className="bg-slate-800 py-2 px-3 border-b border-slate-600 flex items-center gap-2 flex-wrap">
        <button onClick={openPDF} className={buttonClass} disabled={!pdfJsLoaded}>
          {loading ? 'Loading...' : 'Open PDF'}
        </button>
        <button onClick={saveAsPDF} className={`${buttonClass} bg-green-600 hover:bg-green-500`} disabled={!pdfState || !jsPdfLoaded || saving}>
          {saving ? 'Saving...' : 'Save as PDF'}
        </button>
        <button onClick={exportAnnotations} className={buttonClass} disabled={!pdfState}>
          Save Annotations
        </button>
        <button onClick={loadAnnotations} className={buttonClass} disabled={!pdfState}>
          Load Annotations
        </button>
        <button onClick={exportAsImage} className={buttonClass} disabled={!pdfState}>
          Export Page
        </button>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Undo/Redo buttons */}
        <button onClick={undo} className={buttonClass} disabled={historyIndex <= 0} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={redo} className={buttonClass} disabled={historyIndex >= annotationHistory.length - 1} title="Redo (Ctrl+Y)">
          Redo
        </button>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {pdfState && (
          <>
            <span className="text-xs text-slate-300">{pdfState.fileName}</span>
            <span className="text-[11px] text-slate-500">
              ({annotations.length} annotations total)
            </span>
          </>
        )}
      </div>

      {/* Tools Bar */}
      <div className="bg-[#252525] py-2 px-3 border-b border-slate-600 flex gap-1.5 flex-wrap items-center">
        <button onClick={() => setSelectedTool('select')} className={toolButtonClass('select')}>
          Select
        </button>
        <button onClick={() => setSelectedTool('text')} className={toolButtonClass('text')}>
          Text
        </button>
        <button onClick={() => setSelectedTool('highlight')} className={toolButtonClass('highlight')}>
          Highlight
        </button>
        <button onClick={() => setSelectedTool('rectangle')} className={toolButtonClass('rectangle')}>
          Rectangle
        </button>
        <button onClick={() => setSelectedTool('draw')} className={toolButtonClass('draw')}>
          Draw
        </button>
        <button onClick={importImage} className={buttonClass} disabled={!pdfState} title="Import Image">
          Image
        </button>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        <input
          type="color"
          value={selectedColor}
          onChange={(e) => setSelectedColor(e.target.value)}
          className="w-8 h-7 border border-slate-600 rounded cursor-pointer"
          title="Color"
        />

        {selectedTool === 'text' && (
          <>
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="py-1 px-2 border border-slate-600 rounded bg-slate-700 text-white text-xs cursor-pointer"
            >
              {FONTS.map(font => (
                <option key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">Size:</span>
            <input
              type="number"
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value) || 14)}
              min={8}
              max={72}
              className="w-[50px] p-1 border border-slate-600 rounded bg-slate-700 text-white text-xs"
            />
          </>
        )}

        {selectedTool === 'highlight' && (
          <>
            <span className="text-xs text-slate-500">Opacity:</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={highlightOpacity}
              onChange={(e) => setHighlightOpacity(parseFloat(e.target.value))}
              className="w-20 cursor-pointer"
              title={`Opacity: ${Math.round(highlightOpacity * 100)}%`}
            />
            <span className="text-[11px] text-slate-500 min-w-[35px]">
              {Math.round(highlightOpacity * 100)}%
            </span>
          </>
        )}

        <div className="w-px h-6 bg-slate-600 mx-1" />

        <button
          onClick={deleteSelected}
          className={`${buttonClass} ${selectedAnnotation ? 'bg-red-600 hover:bg-red-500' : ''}`}
          disabled={!selectedAnnotation}
          title="Delete (Del)"
        >
          Delete
        </button>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* Zoom controls */}
        <button onClick={() => setScale((pdfState?.scale || 1) - 0.25)} className={buttonClass} disabled={!pdfState} title="Zoom out (-)">
          -
        </button>
        <span className="text-xs text-slate-500 min-w-[50px] text-center">
          {Math.round((pdfState?.scale || 1) * 100)}%
        </span>
        <button onClick={() => setScale((pdfState?.scale || 1) + 0.25)} className={buttonClass} disabled={!pdfState} title="Zoom in (+)">
          +
        </button>

        <div className="w-px h-6 bg-slate-600 mx-1" />

        {/* View mode toggle */}
        <button
          onClick={() => setViewMode(viewMode === 'single' ? 'continuous' : 'single')}
          className={`${buttonClass} min-w-[80px] ${viewMode === 'continuous' ? 'bg-blue-500 hover:bg-blue-400' : ''}`}
          disabled={!pdfState}
          title="Toggle view mode"
        >
          {viewMode === 'continuous' ? 'Continuous' : 'Single Page'}
        </button>
      </div>

      {/* PDF Viewer */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-slate-600 flex flex-col items-center p-5"
      >
        {!pdfState ? (
          <div className="flex flex-col items-center justify-center text-slate-500 gap-2.5 h-full">
            {!pdfJsLoaded ? (
              <span>Loading PDF.js...</span>
            ) : (
              <>
                <span className="text-5xl">📄</span>
                <span>Click "Open PDF" to load a document</span>
              </>
            )}
          </div>
        ) : viewMode === 'single' ? (
          // Single page mode - only render current page
          <div
            key={pdfState.currentPage}
            ref={el => { if (el) pageContainerRefs.current.set(pdfState.currentPage, el); }}
            data-page={pdfState.currentPage}
            className="relative"
            style={{
              width: pageDimensions.get(pdfState.currentPage)?.width || 612 * pdfState.scale,
              height: pageDimensions.get(pdfState.currentPage)?.height || 792 * pdfState.scale,
            }}
          >
            {/* PDF Canvas */}
            <canvas
              ref={el => { if (el) pageCanvasRefs.current.set(pdfState.currentPage, el); }}
              className="block bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]"
            />

            {/* Annotation Canvas (overlay) */}
            <canvas
              ref={el => { if (el) annotationCanvasRefs.current.set(pdfState.currentPage, el); }}
              onClick={(e) => handleCanvasClick(e, pdfState.currentPage)}
              onMouseDown={(e) => handleMouseDown(e, pdfState.currentPage)}
              onMouseMove={(e) => handleMouseMove(e, pdfState.currentPage)}
              onMouseUp={(e) => handleMouseUp(e, pdfState.currentPage)}
              onMouseLeave={(e) => handleMouseUp(e, pdfState.currentPage)}
              className={`absolute top-0 left-0 ${
                selectedTool === 'select' ? 'cursor-default' :
                selectedTool === 'text' ? 'cursor-text' : 'cursor-crosshair'
              }`}
            />

            {/* Text input overlay */}
            {textInputPos.visible && textInputPos.page === pdfState.currentPage && (
              <div
                className="absolute flex gap-1 z-10"
                style={{ left: textInputPos.x, top: textInputPos.y }}
              >
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addTextAnnotation()}
                  autoFocus
                  className="py-1 px-2 border-2 border-blue-500 rounded bg-white min-w-[150px] outline-none"
                  style={{ fontSize: `${fontSize}px`, color: selectedColor }}
                  placeholder="Type text..."
                />
                <button
                  onClick={addTextAnnotation}
                  className="py-1 px-2 bg-blue-500 text-white border-none rounded cursor-pointer"
                >
                  Add
                </button>
                <button
                  onClick={() => setTextInputPos({ ...textInputPos, visible: false })}
                  className="py-1 px-2 bg-slate-500 text-white border-none rounded cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ) : (
          // Continuous scroll mode - render all pages in a vertical stack
          Array.from({ length: pdfState.numPages }, (_, i) => i + 1).map(pageNum => {
            const dims = pageDimensions.get(pageNum);
            const width = dims?.width || 612 * pdfState.scale;
            const height = dims?.height || 792 * pdfState.scale;

            return (
              <div
                key={pageNum}
                ref={el => { if (el) pageContainerRefs.current.set(pageNum, el); }}
                data-page={pageNum}
                className="relative mb-5 flex-shrink-0"
                style={{ width, height }}
              >
                {/* Page number label */}
                <div className="absolute -top-5 left-0 text-[11px] text-slate-500">
                  Page {pageNum}
                </div>

                {/* PDF Canvas */}
                <canvas
                  ref={el => { if (el) pageCanvasRefs.current.set(pageNum, el); }}
                  className="block bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]"
                  style={{ width, height }}
                />

                {/* Annotation Canvas (overlay) */}
                <canvas
                  ref={el => { if (el) annotationCanvasRefs.current.set(pageNum, el); }}
                  onClick={(e) => handleCanvasClick(e, pageNum)}
                  onMouseDown={(e) => handleMouseDown(e, pageNum)}
                  onMouseMove={(e) => handleMouseMove(e, pageNum)}
                  onMouseUp={(e) => handleMouseUp(e, pageNum)}
                  onMouseLeave={(e) => handleMouseUp(e, pageNum)}
                  className={`absolute top-0 left-0 ${
                    selectedTool === 'select' ? 'cursor-default' :
                    selectedTool === 'text' ? 'cursor-text' : 'cursor-crosshair'
                  }`}
                  style={{ width, height }}
                />

                {/* Text input overlay for this page */}
                {textInputPos.visible && textInputPos.page === pageNum && (
                  <div
                    className="absolute flex gap-1 z-10"
                    style={{ left: textInputPos.x, top: textInputPos.y }}
                  >
                    <input
                      type="text"
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && addTextAnnotation()}
                      autoFocus
                      className="py-1 px-2 border-2 border-blue-500 rounded bg-white min-w-[150px] outline-none"
                      style={{ fontSize: `${fontSize}px`, color: selectedColor }}
                      placeholder="Type text..."
                    />
                    <button
                      onClick={addTextAnnotation}
                      className="py-1 px-2 bg-blue-500 text-white border-none rounded cursor-pointer"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => setTextInputPos({ ...textInputPos, visible: false })}
                      className="py-1 px-2 bg-slate-500 text-white border-none rounded cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Loading placeholder if page not rendered */}
                {!pageRenderStates.get(pageNum)?.rendered && (
                  <div
                    className="absolute top-0 left-0 flex items-center justify-center bg-white text-slate-500 shadow-[0_0_10px_rgba(0,0,0,0.5)]"
                    style={{ width, height }}
                  >
                    {pageRenderStates.get(pageNum)?.rendering ? 'Rendering...' : 'Loading page...'}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Navigation */}
      {pdfState && (
        <div className="bg-slate-800 py-2 px-3 border-t border-slate-600 flex items-center justify-center gap-2.5">
          <button
            onClick={() => goToPage(1)}
            className={buttonClass}
            disabled={pdfState.currentPage === 1}
          >
            First
          </button>
          <button
            onClick={() => goToPage(pdfState.currentPage - 1)}
            className={buttonClass}
            disabled={pdfState.currentPage === 1}
          >
            Prev
          </button>

          <span className="text-[13px] text-slate-300">
            Page{' '}
            <input
              type="number"
              value={pdfState.currentPage}
              onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
              min={1}
              max={pdfState.numPages}
              className="w-[50px] p-1 border border-slate-600 rounded bg-slate-700 text-white text-center text-xs"
            />
            {' '}of {pdfState.numPages}
          </span>

          <button
            onClick={() => goToPage(pdfState.currentPage + 1)}
            className={buttonClass}
            disabled={pdfState.currentPage === pdfState.numPages}
          >
            Next
          </button>
          <button
            onClick={() => goToPage(pdfState.numPages)}
            className={buttonClass}
            disabled={pdfState.currentPage === pdfState.numPages}
          >
            Last
          </button>

          <div className="w-px h-6 bg-slate-600 mx-1" />

          <span className="text-[11px] text-slate-500">
            Shortcuts: Del=Delete, Ctrl+Z=Undo, Ctrl+Y=Redo, +/-=Zoom
          </span>
        </div>
      )}
    </div>
  );
};
