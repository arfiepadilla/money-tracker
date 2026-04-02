import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';

// Types
import { Slide, SlideElement, GridSettings, SlideTemplate } from './types';

// Constants
import {
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
  MIN_ELEMENT_WIDTH,
  MIN_ELEMENT_HEIGHT,
  DEFAULT_COLORS,
  DEFAULT_GRID_SIZE,
  generateId,
  createDefaultSlide,
  SLIDE_TEMPLATES,
} from './constants';

// Utils
import {
  cloneElement,
  cloneSlide,
  createSlideFromTemplate,
  formatContentWithList,
  removeListMarkers,
  constrainToSlide,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
  alignElements,
  distributeElements,
  sortByZIndex,
} from './utils';

// Managers
import {
  UndoRedoManager,
  createAddElementAction,
  createDeleteElementAction,
  createUpdateElementAction,
  createMoveElementAction,
  createResizeElementAction,
  createAddSlideAction,
  createDeleteSlideAction,
  createUpdateSlideAction,
  createReorderSlidesAction,
  createUpdateNotesAction,
  createZOrderAction,
} from './managers/UndoRedoManager';
import { ClipboardManager } from './managers/ClipboardManager';

// Hooks
import { useKeyboardShortcuts, KeyboardActions } from './hooks/useKeyboardShortcuts';

// Components
import { MenuBar, FormattingToolbar } from './components/Toolbar';
import { SlidePanel } from './components/SlidePanel';
import { SlideEditor, PresentationSlide } from './components/SlideEditor';
import { PropertiesPanel } from './components/PropertiesPanel';
import { NotesPanel } from './components/NotesPanel';

// Global EventBus (exposed by ContextUI)
const eventBus = (window as any).EventBus;

// Electron IPC for file operations
const { ipcRenderer } = (window as any).require ? (window as any).require('electron') : { ipcRenderer: null };

export const PresentationWindow: React.FC = () => {
  // File state
  const [fileName, setFileName] = useState('Untitled Presentation');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(true);

  // Presentation state
  const [slides, setSlides] = useState<Slide[]>([createDefaultSlide()]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  // Selection state
  const [selectedElements, setSelectedElements] = useState<string[]>([]);
  const [editingElement, setEditingElement] = useState<string | null>(null);

  // Drag/resize state
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStartMouse, setDragStartMouse] = useState({ x: 0, y: 0 });
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [initialDragPositions, setInitialDragPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  // View state
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showNotes, setShowNotes] = useState(false);
  const [gridSettings, setGridSettings] = useState<GridSettings>({
    visible: false,
    snapToGrid: false,
    gridSize: DEFAULT_GRID_SIZE,
  });

  // Undo/redo state tracking
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [hasClipboard, setHasClipboard] = useState(false);

  // Refs
  const slideRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Managers
  const undoManager = useMemo(() => UndoRedoManager.getInstance(), []);
  const clipboardManager = useMemo(() => ClipboardManager.getInstance(), []);

  // Current slide
  const currentSlide = slides[currentSlideIndex];

  // Selected element (first selected for formatting)
  const selectedElement = useMemo(() => {
    if (selectedElements.length === 0) return null;
    return currentSlide.elements.find(el => el.id === selectedElements[0]) || null;
  }, [currentSlide.elements, selectedElements]);

  // Subscribe to manager updates
  useEffect(() => {
    const unsubUndo = undoManager.subscribe(() => {
      setUndoCount(undoManager.getUndoCount());
      setRedoCount(undoManager.getRedoCount());
    });
    const unsubClipboard = clipboardManager.subscribe(() => {
      setHasClipboard(clipboardManager.hasContent());
    });
    return () => {
      unsubUndo();
      unsubClipboard();
    };
  }, [undoManager, clipboardManager]);

  // Log helper
  const log = useCallback((message: string) => {
    eventBus?.getInstance()?.publish?.('log-message', message);
  }, []);

  // Mark as unsaved
  const markUnsaved = useCallback(() => {
    setIsSaved(false);
  }, []);

  // Update slide helper
  const updateSlide = useCallback((updater: (slide: Slide) => Slide, recordUndo = true) => {
    setSlides(prev => {
      const newSlides = [...prev];
      const oldSlide = newSlides[currentSlideIndex];
      const newSlide = updater(oldSlide);
      newSlides[currentSlideIndex] = newSlide;

      if (recordUndo) {
        undoManager.pushAction(createUpdateSlideAction(currentSlideIndex, oldSlide, newSlide));
      }

      return newSlides;
    });
    markUnsaved();
  }, [currentSlideIndex, markUnsaved, undoManager]);

  // Update element helper
  const updateElement = useCallback((elementId: string, updates: Partial<SlideElement>, recordUndo = true) => {
    const element = currentSlide.elements.find(el => el.id === elementId);
    if (!element) return;

    const newElement = { ...element, ...updates, style: { ...element.style, ...updates.style } };

    if (recordUndo) {
      undoManager.pushAction(createUpdateElementAction(currentSlideIndex, element, newElement, currentSlide));
    }

    updateSlide(slide => ({
      ...slide,
      elements: slide.elements.map(el => el.id === elementId ? newElement : el),
    }), false);
  }, [currentSlide, currentSlideIndex, undoManager, updateSlide]);

  // Add element
  const addElement = useCallback((type: SlideElement['type'], shapeType?: SlideElement['shapeType']) => {
    // Determine dimensions and properties based on type
    const isLineOrArrow = type === 'line' || type === 'arrow';
    const width = type === 'image' ? 300 : isLineOrArrow ? 150 : 200;
    const height = type === 'image' ? 200 : isLineOrArrow ? 80 : 100;

    const newElement: SlideElement = {
      id: generateId(),
      type,
      x: SLIDE_WIDTH / 2 - width / 2,
      y: SLIDE_HEIGHT / 2 - height / 2,
      width,
      height,
      content: type === 'text' ? 'Click to edit' : '',
      shapeType,
      listType: 'none',
      zIndex: currentSlide.elements.length,
      style: {
        fontSize: 24,
        fontFamily: 'Arial',
        color: '#ffffff',
        backgroundColor: type === 'shape' ? DEFAULT_COLORS.shape : 'transparent',
        textAlign: type === 'text' ? 'left' : 'center',
        // Line/Arrow specific styles
        ...(isLineOrArrow && {
          strokeColor: DEFAULT_COLORS.line,
          strokeWidth: 2,
          strokeStyle: 'solid' as const,
        }),
      },
      // Line/Arrow specific properties
      ...(isLineOrArrow && {
        startPoint: { x: 0, y: height },
        endPoint: { x: width, y: 0 },
        arrowHead: type === 'arrow' ? 'end' as const : 'none' as const,
      }),
    };

    const newSlide = {
      ...currentSlide,
      elements: [...currentSlide.elements, newElement],
    };

    undoManager.pushAction(createAddElementAction(currentSlideIndex, newElement, newSlide));

    setSlides(prev => {
      const newSlides = [...prev];
      newSlides[currentSlideIndex] = newSlide;
      return newSlides;
    });
    setSelectedElements([newElement.id]);
    markUnsaved();
  }, [currentSlide, currentSlideIndex, markUnsaved, undoManager]);

  // Add image from file
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const imageUrl = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const aspectRatio = img.width / img.height;
        const maxWidth = 400;
        const width = Math.min(img.width, maxWidth);
        const height = width / aspectRatio;

        const newElement: SlideElement = {
          id: generateId(),
          type: 'image',
          x: SLIDE_WIDTH / 2 - width / 2,
          y: SLIDE_HEIGHT / 2 - height / 2,
          width,
          height,
          imageUrl,
          listType: 'none',
          zIndex: currentSlide.elements.length,
          style: { backgroundColor: 'transparent' },
        };

        const newSlide = {
          ...currentSlide,
          elements: [...currentSlide.elements, newElement],
        };

        undoManager.pushAction(createAddElementAction(currentSlideIndex, newElement, newSlide));

        setSlides(prev => {
          const newSlides = [...prev];
          newSlides[currentSlideIndex] = newSlide;
          return newSlides;
        });
        setSelectedElements([newElement.id]);
        markUnsaved();
      };
      img.src = imageUrl;
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [currentSlide, currentSlideIndex, markUnsaved, undoManager]);

  // Delete selected elements
  const deleteSelectedElements = useCallback(() => {
    if (selectedElements.length === 0) return;

    const elementsToDelete = currentSlide.elements.filter(el => selectedElements.includes(el.id));
    undoManager.pushAction(createDeleteElementAction(currentSlideIndex, elementsToDelete, currentSlide));

    updateSlide(slide => ({
      ...slide,
      elements: slide.elements.filter(el => !selectedElements.includes(el.id)),
    }), false);
    setSelectedElements([]);
  }, [currentSlide, currentSlideIndex, selectedElements, undoManager, updateSlide]);

  // Slide management
  const addSlide = useCallback((template?: SlideTemplate) => {
    const newSlide = template ? createSlideFromTemplate(template) : createDefaultSlide();

    setSlides(prev => {
      const newSlides = [...prev];
      newSlides.splice(currentSlideIndex + 1, 0, newSlide);
      undoManager.pushAction(createAddSlideAction(currentSlideIndex + 1, newSlide, newSlides));
      return newSlides;
    });
    setCurrentSlideIndex(currentSlideIndex + 1);
    setSelectedElements([]);
    markUnsaved();
  }, [currentSlideIndex, markUnsaved, undoManager]);

  const deleteSlide = useCallback(() => {
    if (slides.length <= 1) return;

    undoManager.pushAction(createDeleteSlideAction(currentSlideIndex, currentSlide, slides));

    setSlides(prev => prev.filter((_, i) => i !== currentSlideIndex));
    setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1));
    setSelectedElements([]);
    markUnsaved();
  }, [currentSlide, currentSlideIndex, markUnsaved, slides, undoManager]);

  const duplicateSlide = useCallback(() => {
    const duplicate = cloneSlide(currentSlide);

    setSlides(prev => {
      const newSlides = [...prev];
      newSlides.splice(currentSlideIndex + 1, 0, duplicate);
      undoManager.pushAction(createAddSlideAction(currentSlideIndex + 1, duplicate, newSlides));
      return newSlides;
    });
    setCurrentSlideIndex(currentSlideIndex + 1);
    setSelectedElements([]);
    markUnsaved();
  }, [currentSlide, currentSlideIndex, markUnsaved, undoManager]);

  const reorderSlides = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;

    setSlides(prev => {
      const newSlides = [...prev];
      const [removed] = newSlides.splice(fromIndex, 1);
      newSlides.splice(toIndex, 0, removed);
      undoManager.pushAction(createReorderSlidesAction(prev, newSlides, fromIndex, toIndex));
      return newSlides;
    });
    setCurrentSlideIndex(toIndex);
    markUnsaved();
  }, [markUnsaved, undoManager]);

  // Clipboard operations
  const copyElements = useCallback(() => {
    if (selectedElements.length === 0) return;
    const elements = currentSlide.elements.filter(el => selectedElements.includes(el.id));
    clipboardManager.copy(elements, currentSlideIndex);
    log(`Copied ${elements.length} element(s)`);
  }, [clipboardManager, currentSlide.elements, currentSlideIndex, log, selectedElements]);

  const cutElements = useCallback(() => {
    if (selectedElements.length === 0) return;
    const elements = currentSlide.elements.filter(el => selectedElements.includes(el.id));
    clipboardManager.cut(elements, currentSlideIndex);
    deleteSelectedElements();
    log(`Cut ${elements.length} element(s)`);
  }, [clipboardManager, currentSlide.elements, currentSlideIndex, deleteSelectedElements, log, selectedElements]);

  const pasteElements = useCallback(() => {
    const elements = clipboardManager.paste(currentSlideIndex);
    if (!elements || elements.length === 0) return;

    // Assign new z-indices
    const maxZ = Math.max(...currentSlide.elements.map(el => el.zIndex || 0), -1);
    const newElements = elements.map((el, i) => ({ ...el, zIndex: maxZ + i + 1 }));

    const newSlide = {
      ...currentSlide,
      elements: [...currentSlide.elements, ...newElements],
    };

    undoManager.pushAction({
      type: 'PASTE_ELEMENTS',
      slideIndex: currentSlideIndex,
      previousState: { slide: currentSlide },
      newState: { slide: newSlide, elements: newElements },
      timestamp: Date.now(),
      description: `Paste ${newElements.length} element(s)`,
    });

    setSlides(prev => {
      const newSlides = [...prev];
      newSlides[currentSlideIndex] = newSlide;
      return newSlides;
    });
    setSelectedElements(newElements.map(el => el.id));
    markUnsaved();
    log(`Pasted ${newElements.length} element(s)`);
  }, [clipboardManager, currentSlide, currentSlideIndex, log, markUnsaved, undoManager]);

  const duplicateElements = useCallback(() => {
    if (selectedElements.length === 0) return;
    const elements = currentSlide.elements.filter(el => selectedElements.includes(el.id));
    const duplicates = elements.map(el => cloneElement(el));

    // Assign z-indices
    const maxZ = Math.max(...currentSlide.elements.map(el => el.zIndex || 0), -1);
    duplicates.forEach((el, i) => { el.zIndex = maxZ + i + 1; });

    const newSlide = {
      ...currentSlide,
      elements: [...currentSlide.elements, ...duplicates],
    };

    undoManager.pushAction({
      type: 'PASTE_ELEMENTS',
      slideIndex: currentSlideIndex,
      previousState: { slide: currentSlide },
      newState: { slide: newSlide, elements: duplicates },
      timestamp: Date.now(),
      description: `Duplicate ${duplicates.length} element(s)`,
    });

    setSlides(prev => {
      const newSlides = [...prev];
      newSlides[currentSlideIndex] = newSlide;
      return newSlides;
    });
    setSelectedElements(duplicates.map(el => el.id));
    markUnsaved();
  }, [currentSlide, currentSlideIndex, markUnsaved, selectedElements, undoManager]);

  // Z-ordering
  const handleBringToFront = useCallback(() => {
    if (selectedElements.length === 0) return;
    const element = currentSlide.elements.find(el => el.id === selectedElements[0]);
    if (!element) return;

    const oldElements = [...currentSlide.elements];
    const newElement = bringToFront(element, currentSlide.elements);
    const newElements = currentSlide.elements.map(el => el.id === element.id ? newElement : el);

    undoManager.pushAction(createZOrderAction(currentSlideIndex, oldElements, newElements, 'Bring to front'));
    updateSlide(slide => ({ ...slide, elements: newElements }), false);
  }, [currentSlide.elements, currentSlideIndex, selectedElements, undoManager, updateSlide]);

  const handleSendToBack = useCallback(() => {
    if (selectedElements.length === 0) return;
    const element = currentSlide.elements.find(el => el.id === selectedElements[0]);
    if (!element) return;

    const oldElements = [...currentSlide.elements];
    const newElement = sendToBack(element, currentSlide.elements);
    const newElements = currentSlide.elements.map(el => el.id === element.id ? newElement : el);

    undoManager.pushAction(createZOrderAction(currentSlideIndex, oldElements, newElements, 'Send to back'));
    updateSlide(slide => ({ ...slide, elements: newElements }), false);
  }, [currentSlide.elements, currentSlideIndex, selectedElements, undoManager, updateSlide]);

  const handleBringForward = useCallback(() => {
    if (selectedElements.length === 0) return;
    const element = currentSlide.elements.find(el => el.id === selectedElements[0]);
    if (!element) return;

    const oldElements = [...currentSlide.elements];
    const newElement = bringForward(element, currentSlide.elements);
    const newElements = currentSlide.elements.map(el => el.id === element.id ? newElement : el);

    undoManager.pushAction(createZOrderAction(currentSlideIndex, oldElements, newElements, 'Bring forward'));
    updateSlide(slide => ({ ...slide, elements: newElements }), false);
  }, [currentSlide.elements, currentSlideIndex, selectedElements, undoManager, updateSlide]);

  const handleSendBackward = useCallback(() => {
    if (selectedElements.length === 0) return;
    const element = currentSlide.elements.find(el => el.id === selectedElements[0]);
    if (!element) return;

    const oldElements = [...currentSlide.elements];
    const newElement = sendBackward(element, currentSlide.elements);
    const newElements = currentSlide.elements.map(el => el.id === element.id ? newElement : el);

    undoManager.pushAction(createZOrderAction(currentSlideIndex, oldElements, newElements, 'Send backward'));
    updateSlide(slide => ({ ...slide, elements: newElements }), false);
  }, [currentSlide.elements, currentSlideIndex, selectedElements, undoManager, updateSlide]);

  // Alignment
  const handleAlignElements = useCallback((alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (selectedElements.length < 2) return;

    const elements = currentSlide.elements.filter(el => selectedElements.includes(el.id));
    const aligned = alignElements(elements, alignment);

    const oldElements = [...currentSlide.elements];
    const newElements = currentSlide.elements.map(el => {
      const alignedEl = aligned.find(a => a.id === el.id);
      return alignedEl || el;
    });

    undoManager.pushAction(createZOrderAction(currentSlideIndex, oldElements, newElements, `Align ${alignment}`));
    updateSlide(slide => ({ ...slide, elements: newElements }), false);
  }, [currentSlide.elements, currentSlideIndex, selectedElements, undoManager, updateSlide]);

  // Nudge elements
  const nudgeElements = useCallback((dx: number, dy: number) => {
    if (selectedElements.length === 0) return;

    setSlides(prev => {
      const newSlides = [...prev];
      const slide = newSlides[currentSlideIndex];
      newSlides[currentSlideIndex] = {
        ...slide,
        elements: slide.elements.map(el => {
          if (!selectedElements.includes(el.id)) return el;
          const { x, y } = constrainToSlide(el.x + dx, el.y + dy, el.width, el.height);
          return { ...el, x, y };
        }),
      };
      return newSlides;
    });
    markUnsaved();
  }, [currentSlideIndex, markUnsaved, selectedElements]);

  // Toggle list type
  const toggleListType = useCallback((type: 'bullet' | 'numbered') => {
    if (!selectedElement || (selectedElement.type !== 'text' && selectedElement.type !== 'shape')) return;

    const newListType = selectedElement.listType === type ? 'none' : type;
    const cleanContent = removeListMarkers(selectedElement.content || '');
    const newContent = formatContentWithList(cleanContent, newListType);

    updateElement(selectedElement.id, { listType: newListType, content: newContent });
  }, [selectedElement, updateElement]);

  // Undo/Redo
  const handleUndo = useCallback(() => {
    const action = undoManager.undo();
    if (!action) return;

    // Restore previous state based on action type
    if (action.previousState.slides) {
      setSlides(action.previousState.slides);
    } else if (action.previousState.slide) {
      setSlides(prev => {
        const newSlides = [...prev];
        newSlides[action.slideIndex] = action.previousState.slide!;
        return newSlides;
      });
    }
    setSelectedElements([]);
    markUnsaved();
  }, [markUnsaved, undoManager]);

  const handleRedo = useCallback(() => {
    const action = undoManager.redo();
    if (!action) return;

    // Restore new state based on action type
    if (action.newState.slides) {
      setSlides(action.newState.slides);
    } else if (action.newState.slide) {
      setSlides(prev => {
        const newSlides = [...prev];
        newSlides[action.slideIndex] = action.newState.slide!;
        return newSlides;
      });
    }
    setSelectedElements([]);
    markUnsaved();
  }, [markUnsaved, undoManager]);

  // File operations
  const savePresentation = useCallback(async () => {
    if (!ipcRenderer) {
      const data = { slides, fileName };
      localStorage.setItem(`presentation_${fileName}`, JSON.stringify(data));
      setIsSaved(true);
      log(`Saved to browser storage`);
      return;
    }

    try {
      let savePath = filePath;

      if (!savePath) {
        const result = await ipcRenderer.invoke('show-save-dialog', {
          title: 'Save Presentation',
          defaultPath: `${fileName}.pres`,
          filters: [
            { name: 'Presentation Files', extensions: ['pres'] },
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (!result.success || result.canceled) return;
        savePath = result.filePath;
      }

      const data = JSON.stringify({ slides, fileName }, null, 2);
      const writeResult = await ipcRenderer.invoke('write-file', { filePath: savePath, content: data });

      if (writeResult.success) {
        setFilePath(savePath);
        setIsSaved(true);
        const name = savePath.split(/[/\\]/).pop()?.replace(/\.(pres|json)$/, '') || fileName;
        setFileName(name);
        log(`Saved to ${savePath}`);
      } else {
        log(`Error saving: ${writeResult.error}`);
      }
    } catch (error) {
      log(`Error saving: ${error}`);
    }
  }, [fileName, filePath, log, slides]);

  const saveAsPresentation = useCallback(async () => {
    if (!ipcRenderer) {
      savePresentation();
      return;
    }

    try {
      const result = await ipcRenderer.invoke('show-save-dialog', {
        title: 'Save Presentation As',
        defaultPath: `${fileName}.pres`,
        filters: [
          { name: 'Presentation Files', extensions: ['pres'] },
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.success || result.canceled) return;

      const savePath = result.filePath;
      const data = JSON.stringify({ slides, fileName }, null, 2);
      const writeResult = await ipcRenderer.invoke('write-file', { filePath: savePath, content: data });

      if (writeResult.success) {
        setFilePath(savePath);
        setIsSaved(true);
        const name = savePath.split(/[/\\]/).pop()?.replace(/\.(pres|json)$/, '') || fileName;
        setFileName(name);
        log(`Saved to ${savePath}`);
      } else {
        log(`Error saving: ${writeResult.error}`);
      }
    } catch (error) {
      log(`Error saving: ${error}`);
    }
  }, [fileName, log, savePresentation, slides]);

  const loadPresentation = useCallback(async () => {
    if (!ipcRenderer) {
      const saved = localStorage.getItem(`presentation_${fileName}`);
      if (saved) {
        const data = JSON.parse(saved);
        setSlides(data.slides);
        setCurrentSlideIndex(0);
        setIsSaved(true);
        undoManager.clear();
        log(`Loaded from browser storage`);
      }
      return;
    }

    try {
      const result = await ipcRenderer.invoke('show-open-dialog', {
        title: 'Open Presentation',
        filters: [
          { name: 'Presentation Files', extensions: ['pres'] },
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (!result.success || result.canceled) return;

      const loadPath = result.filePaths[0];
      const readResult = await ipcRenderer.invoke('read-file', loadPath);

      if (readResult.success) {
        const data = JSON.parse(readResult.content);
        setSlides(data.slides);
        setFileName(data.fileName || loadPath.split(/[/\\]/).pop()?.replace(/\.(pres|json)$/, '') || 'Untitled');
        setFilePath(loadPath);
        setCurrentSlideIndex(0);
        setSelectedElements([]);
        setIsSaved(true);
        undoManager.clear();
        log(`Loaded from ${loadPath}`);
      } else {
        log(`Error loading: ${readResult.error}`);
      }
    } catch (error) {
      log(`Error loading: ${error}`);
    }
  }, [fileName, log, undoManager]);

  const newPresentation = useCallback(() => {
    if (!isSaved) {
      if (!confirm('You have unsaved changes. Create a new presentation anyway?')) {
        return;
      }
    }
    setSlides([createDefaultSlide()]);
    setFileName('Untitled Presentation');
    setFilePath(null);
    setCurrentSlideIndex(0);
    setSelectedElements([]);
    setIsSaved(true);
    undoManager.clear();
  }, [isSaved, undoManager]);

  // Export as HTML
  const exportAsHTML = useCallback(() => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${fileName}</title>
  <style>
    body { margin: 0; background: #000; overflow: hidden; }
    .slide { width: 100vw; height: 100vh; display: none; position: relative; }
    .slide.active { display: block; }
    .element { position: absolute; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
    .element img { width: 100%; height: 100%; object-fit: contain; }
  </style>
</head>
<body>
  ${slides.map((slide, i) => `
    <div class="slide${i === 0 ? ' active' : ''}" style="background: ${slide.background}">
      ${sortByZIndex(slide.elements).map(el => `
        <div class="element" style="
          left: ${(el.x / SLIDE_WIDTH) * 100}%;
          top: ${(el.y / SLIDE_HEIGHT) * 100}%;
          width: ${(el.width / SLIDE_WIDTH) * 100}%;
          height: ${(el.height / SLIDE_HEIGHT) * 100}%;
          font-size: ${el.style?.fontSize || 24}px;
          font-family: ${el.style?.fontFamily || 'Arial'};
          font-weight: ${el.style?.fontWeight || 'normal'};
          font-style: ${el.style?.fontStyle || 'normal'};
          color: ${el.style?.color || '#fff'};
          background: ${el.style?.backgroundColor || 'transparent'};
          text-align: ${el.style?.textAlign || 'center'};
          white-space: pre-wrap;
          ${el.type === 'shape' && el.shapeType === 'ellipse' ? 'border-radius: 50%;' : ''}
          ${el.type === 'shape' && el.shapeType === 'triangle' ? 'clip-path: polygon(50% 0%, 0% 100%, 100% 100%);' : ''}
        ">${el.type === 'image' ? `<img src="${el.imageUrl}" />` : (el.content || '')}</div>
      `).join('')}
    </div>
  `).join('')}
  <script>
    let current = 0;
    const slides = document.querySelectorAll('.slide');
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { current = Math.min(slides.length - 1, current + 1); }
      if (e.key === 'ArrowLeft') { current = Math.max(0, current - 1); }
      if (e.key === 'Escape') { /* could handle exit */ }
      slides.forEach((s, i) => s.classList.toggle('active', i === current));
    });
  </script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.html`;
    a.click();
    URL.revokeObjectURL(url);
    log(`Exported as ${fileName}.html`);
  }, [fileName, log, slides]);

  // Mouse event handlers for drag/resize
  const handleDragStart = useCallback((e: React.MouseEvent, elementId: string) => {
    if (!slideRef.current) return;

    const rect = slideRef.current.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / zoom;
    const mouseY = (e.clientY - rect.top) / zoom;

    // Store initial mouse position
    setDragStartMouse({ x: mouseX, y: mouseY });

    // Store initial positions of all selected elements
    const positions = new Map<string, { x: number; y: number }>();
    currentSlide.elements.forEach(el => {
      if (selectedElements.includes(el.id)) {
        positions.set(el.id, { x: el.x, y: el.y });
      }
    });
    setInitialDragPositions(positions);

    setIsDragging(true);
  }, [currentSlide.elements, selectedElements, zoom]);

  const handleResizeStart = useCallback((e: React.MouseEvent, handle: string) => {
    setIsResizing(true);
    setResizeHandle(handle);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!slideRef.current) return;

    const rect = slideRef.current.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / zoom;
    const mouseY = (e.clientY - rect.top) / zoom;

    if (isDragging && selectedElements.length > 0) {
      // Calculate how far the mouse has moved from the start position
      const deltaX = mouseX - dragStartMouse.x;
      const deltaY = mouseY - dragStartMouse.y;

      // Move all selected elements
      setSlides(prev => {
        const newSlides = [...prev];
        const slide = newSlides[currentSlideIndex];
        newSlides[currentSlideIndex] = {
          ...slide,
          elements: slide.elements.map(el => {
            if (!selectedElements.includes(el.id)) return el;
            const initialPos = initialDragPositions.get(el.id);
            if (!initialPos) return el;

            const newX = Math.max(0, Math.min(SLIDE_WIDTH - el.width, initialPos.x + deltaX));
            const newY = Math.max(0, Math.min(SLIDE_HEIGHT - el.height, initialPos.y + deltaY));

            return { ...el, x: newX, y: newY };
          }),
        };
        return newSlides;
      });
    }

    if (isResizing && selectedElements.length === 1 && resizeHandle) {
      const element = currentSlide.elements.find(el => el.id === selectedElements[0]);
      if (!element) return;

      // Handle line/arrow endpoint resizing
      if ((element.type === 'line' || element.type === 'arrow') && resizeHandle.startsWith('line-')) {
        // Get current start and end points in absolute coordinates
        const currentStartX = element.x + (element.startPoint?.x ?? 0);
        const currentStartY = element.y + (element.startPoint?.y ?? 0);
        const currentEndX = element.x + (element.endPoint?.x ?? element.width);
        const currentEndY = element.y + (element.endPoint?.y ?? element.height);

        // Determine new absolute positions
        let newStartX = currentStartX;
        let newStartY = currentStartY;
        let newEndX = currentEndX;
        let newEndY = currentEndY;

        if (resizeHandle === 'line-start') {
          // Constrain to slide bounds
          newStartX = Math.max(0, Math.min(SLIDE_WIDTH, mouseX));
          newStartY = Math.max(0, Math.min(SLIDE_HEIGHT, mouseY));
        } else if (resizeHandle === 'line-end') {
          newEndX = Math.max(0, Math.min(SLIDE_WIDTH, mouseX));
          newEndY = Math.max(0, Math.min(SLIDE_HEIGHT, mouseY));
        }

        // Calculate new bounding box
        const minX = Math.min(newStartX, newEndX);
        const minY = Math.min(newStartY, newEndY);
        const maxX = Math.max(newStartX, newEndX);
        const maxY = Math.max(newStartY, newEndY);

        // Ensure minimum size for the bounding box
        const padding = 10;
        const newX = minX;
        const newY = minY;
        const newWidth = Math.max(padding, maxX - minX);
        const newHeight = Math.max(padding, maxY - minY);

        // Convert back to local coordinates
        const localStartX = newStartX - newX;
        const localStartY = newStartY - newY;
        const localEndX = newEndX - newX;
        const localEndY = newEndY - newY;

        setSlides(prev => {
          const newSlides = [...prev];
          const slide = newSlides[currentSlideIndex];
          newSlides[currentSlideIndex] = {
            ...slide,
            elements: slide.elements.map(el => {
              if (el.id !== element.id) return el;
              return {
                ...el,
                x: newX,
                y: newY,
                width: newWidth,
                height: newHeight,
                startPoint: { x: localStartX, y: localStartY },
                endPoint: { x: localEndX, y: localEndY },
              };
            }),
          };
          return newSlides;
        });
        return;
      }

      // Standard element resizing
      let newWidth = element.width;
      let newHeight = element.height;
      let newX = element.x;
      let newY = element.y;

      if (resizeHandle.includes('e')) {
        newWidth = Math.max(MIN_ELEMENT_WIDTH, mouseX - element.x);
      }
      if (resizeHandle.includes('w')) {
        const diff = element.x - mouseX;
        newWidth = Math.max(MIN_ELEMENT_WIDTH, element.width + diff);
        if (newWidth > MIN_ELEMENT_WIDTH) newX = mouseX;
      }
      if (resizeHandle.includes('s')) {
        newHeight = Math.max(MIN_ELEMENT_HEIGHT, mouseY - element.y);
      }
      if (resizeHandle.includes('n')) {
        const diff = element.y - mouseY;
        newHeight = Math.max(MIN_ELEMENT_HEIGHT, element.height + diff);
        if (newHeight > MIN_ELEMENT_HEIGHT) newY = mouseY;
      }

      setSlides(prev => {
        const newSlides = [...prev];
        const slide = newSlides[currentSlideIndex];
        newSlides[currentSlideIndex] = {
          ...slide,
          elements: slide.elements.map(el =>
            el.id === element.id ? { ...el, x: newX, y: newY, width: newWidth, height: newHeight } : el
          ),
        };
        return newSlides;
      });
    }
  }, [isDragging, isResizing, selectedElements, dragStartMouse, resizeHandle, zoom, currentSlideIndex, currentSlide.elements, initialDragPositions]);

  const handleMouseUp = useCallback(() => {
    if (isDragging && selectedElements.length > 0) {
      // Record undo action for move
      const newPositions = new Map<string, { x: number; y: number }>();
      currentSlide.elements.forEach(el => {
        if (selectedElements.includes(el.id)) {
          newPositions.set(el.id, { x: el.x, y: el.y });
        }
      });

      const elements = currentSlide.elements.filter(el => selectedElements.includes(el.id));
      if (elements.length > 0) {
        undoManager.pushAction(createMoveElementAction(currentSlideIndex, initialDragPositions, newPositions, elements));
      }
      markUnsaved();
    }

    setIsDragging(false);
    setIsResizing(false);
    setResizeHandle(null);
    setInitialDragPositions(new Map());
  }, [isDragging, selectedElements, currentSlide.elements, currentSlideIndex, initialDragPositions, undoManager, markUnsaved]);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Selection handlers
  const handleElementSelect = useCallback((elementId: string, addToSelection = false) => {
    if (addToSelection) {
      setSelectedElements(prev =>
        prev.includes(elementId)
          ? prev.filter(id => id !== elementId)
          : [...prev, elementId]
      );
    } else {
      setSelectedElements([elementId]);
    }
    setEditingElement(null);
  }, []);

  const handleElementDeselect = useCallback(() => {
    setSelectedElements([]);
    setEditingElement(null);
  }, []);

  const handleElementDoubleClick = useCallback((elementId: string) => {
    const element = currentSlide.elements.find(el => el.id === elementId);
    if (element?.type === 'text' || element?.type === 'shape') {
      setEditingElement(elementId);
    }
  }, [currentSlide.elements]);

  const handleContentChange = useCallback((elementId: string, content: string) => {
    const element = currentSlide.elements.find(el => el.id === elementId);
    if (!element) return;

    let newContent = content;
    if (element.listType && element.listType !== 'none') {
      const oldLines = (element.content || '').split('\n').length;
      const newLines = content.split('\n').length;
      if (newLines > oldLines) {
        newContent = formatContentWithList(
          removeListMarkers(content),
          element.listType
        );
      }
    }

    setSlides(prev => {
      const newSlides = [...prev];
      const slide = newSlides[currentSlideIndex];
      newSlides[currentSlideIndex] = {
        ...slide,
        elements: slide.elements.map(el =>
          el.id === elementId ? { ...el, content: newContent } : el
        ),
      };
      return newSlides;
    });
    markUnsaved();
  }, [currentSlide.elements, currentSlideIndex, markUnsaved]);

  const handleEditEnd = useCallback(() => {
    setEditingElement(null);
  }, []);

  // Notes handler
  const handleNotesChange = useCallback((notes: string) => {
    const oldNotes = currentSlide.notes || '';
    undoManager.pushAction(createUpdateNotesAction(currentSlideIndex, oldNotes, notes, currentSlide));
    updateSlide(slide => ({ ...slide, notes }), false);
  }, [currentSlide, currentSlideIndex, undoManager, updateSlide]);

  // Keyboard shortcuts
  const keyboardActions: KeyboardActions = useMemo(() => ({
    save: savePresentation,
    saveAs: saveAsPresentation,
    open: loadPresentation,
    new: newPresentation,
    undo: handleUndo,
    redo: handleRedo,
    copy: copyElements,
    paste: pasteElements,
    cut: cutElements,
    duplicate: duplicateElements,
    selectAll: () => setSelectedElements(currentSlide.elements.map(el => el.id)),
    delete: deleteSelectedElements,
    deselect: () => {
      if (isPresentationMode) {
        setIsPresentationMode(false);
      } else {
        handleElementDeselect();
      }
    },
    nudge: nudgeElements,
    bringToFront: handleBringToFront,
    sendToBack: handleSendToBack,
    bringForward: handleBringForward,
    sendBackward: handleSendBackward,
    prevSlide: () => setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1)),
    nextSlide: () => setCurrentSlideIndex(Math.min(slides.length - 1, currentSlideIndex + 1)),
    startPresentation: () => setIsPresentationMode(true),
    toggleBold: () => {
      if (selectedElement && (selectedElement.type === 'text' || selectedElement.type === 'shape')) {
        updateElement(selectedElement.id, {
          style: {
            ...selectedElement.style,
            fontWeight: selectedElement.style?.fontWeight === 'bold' ? 'normal' : 'bold',
          },
        });
      }
    },
    toggleItalic: () => {
      if (selectedElement && (selectedElement.type === 'text' || selectedElement.type === 'shape')) {
        updateElement(selectedElement.id, {
          style: {
            ...selectedElement.style,
            fontStyle: selectedElement.style?.fontStyle === 'italic' ? 'normal' : 'italic',
          },
        });
      }
    },
  }), [
    savePresentation, saveAsPresentation, loadPresentation, newPresentation,
    handleUndo, handleRedo, copyElements, pasteElements, cutElements, duplicateElements,
    currentSlide.elements, deleteSelectedElements, handleElementDeselect,
    nudgeElements, handleBringToFront, handleSendToBack, handleBringForward, handleSendBackward,
    currentSlideIndex, slides.length, selectedElement, updateElement, isPresentationMode,
  ]);

  useKeyboardShortcuts(keyboardActions, {
    enabled: true,
    isEditing: editingElement !== null,
    isPresentationMode,
    hasSelection: selectedElements.length > 0,
  });

  // Presentation mode
  if (isPresentationMode) {
    return (
      <div
        className="fixed top-0 left-0 w-screen h-screen bg-black z-[9999] flex items-center justify-center"
        tabIndex={0}
        autoFocus
      >
        <PresentationSlide
          slide={currentSlide}
          onExit={() => setIsPresentationMode(false)}
          onPrevSlide={() => setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1))}
          onNextSlide={() => setCurrentSlideIndex(Math.min(slides.length - 1, currentSlideIndex + 1))}
          currentIndex={currentSlideIndex + 1}
          totalSlides={slides.length}
        />
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 text-slate-500 text-sm">
          {currentSlideIndex + 1} / {slides.length} - Press Esc to exit
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 text-white">
      {/* Hidden file input for images */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />

      {/* Menu Bar */}
      <MenuBar
        fileName={fileName}
        filePath={filePath}
        isSaved={isSaved}
        canUndo={undoCount > 0}
        canRedo={redoCount > 0}
        undoCount={undoCount}
        redoCount={redoCount}
        onNew={newPresentation}
        onOpen={loadPresentation}
        onSave={savePresentation}
        onSaveAs={saveAsPresentation}
        onExportHTML={exportAsHTML}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onPresent={() => setIsPresentationMode(true)}
      />

      {/* Formatting Toolbar */}
      <FormattingToolbar
        selectedElement={selectedElement}
        hasClipboard={hasClipboard}
        onAddText={() => addElement('text')}
        onAddImage={() => fileInputRef.current?.click()}
        onAddShape={(shapeType) => addElement('shape', shapeType)}
        onAddLine={() => addElement('line')}
        onAddArrow={() => addElement('arrow')}
        onAddSlideFromTemplate={addSlide}
        onCopy={copyElements}
        onCut={cutElements}
        onPaste={pasteElements}
        onDelete={deleteSelectedElements}
        onBringToFront={handleBringToFront}
        onSendToBack={handleSendToBack}
        onBringForward={handleBringForward}
        onSendBackward={handleSendBackward}
        onUpdateElement={(updates) => selectedElement && updateElement(selectedElement.id, updates)}
        onToggleListType={toggleListType}
        onAlignElements={handleAlignElements}
        multipleSelected={selectedElements.length > 1}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Slide Panel */}
        <SlidePanel
          slides={slides}
          currentSlideIndex={currentSlideIndex}
          onSlideSelect={(index) => {
            setCurrentSlideIndex(index);
            setSelectedElements([]);
          }}
          onAddSlide={() => addSlide()}
          onDuplicateSlide={duplicateSlide}
          onDeleteSlide={deleteSlide}
          onReorderSlides={reorderSlides}
        />

        {/* Slide Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <SlideEditor
            slide={currentSlide}
            selectedElements={selectedElements}
            editingElement={editingElement}
            zoom={zoom}
            gridSettings={gridSettings}
            isDragging={isDragging}
            isResizing={isResizing}
            onElementSelect={handleElementSelect}
            onElementDeselect={handleElementDeselect}
            onElementDoubleClick={handleElementDoubleClick}
            onDragStart={handleDragStart}
            onResizeStart={handleResizeStart}
            onContentChange={handleContentChange}
            onEditEnd={handleEditEnd}
            slideRef={slideRef}
          />

          {/* Notes Panel */}
          <NotesPanel
            notes={currentSlide.notes || ''}
            isExpanded={showNotes}
            onNotesChange={handleNotesChange}
            onToggleExpand={() => setShowNotes(!showNotes)}
          />
        </div>

        {/* Properties Panel */}
        <PropertiesPanel
          currentSlide={currentSlide}
          selectedElement={selectedElement}
          zoom={zoom}
          gridSettings={gridSettings}
          onSlideBackgroundChange={(color) => updateSlide(slide => ({ ...slide, background: color }))}
          onZoomChange={setZoom}
          onGridSettingsChange={(settings) => setGridSettings(prev => ({ ...prev, ...settings }))}
        />
      </div>

      {/* Status Bar */}
      <div className="bg-slate-800 py-1.5 px-3 border-t border-slate-600 text-xs text-slate-500 flex justify-between">
        <span>Slide {currentSlideIndex + 1} of {slides.length}</span>
        <span>
          {currentSlide.elements.length} element(s)
          {selectedElements.length > 0 && ` • ${selectedElements.length} selected`}
        </span>
        <span>
          Undo: {undoCount} | Redo: {redoCount}
        </span>
      </div>
    </div>
  );
};

export default PresentationWindow;
