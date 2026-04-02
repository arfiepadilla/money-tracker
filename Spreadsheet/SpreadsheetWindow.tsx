import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { EventBus } from '../managers/EventBus';

// Types
import { CellData, CellFormat, CellRef, Selection, SearchState, NumberFormat } from './types';

// Constants
import {
  DEFAULT_ROWS,
  DEFAULT_COLS,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  MIN_COL_WIDTH,
  INDEXED_COLORS,
  DEFAULT_THEME_COLORS,
  NUMBER_FORMAT_PRESETS,
  THEMES,
  ThemeMode,
  Theme,
  getButtonStyle,
  getSeparatorStyle,
} from './constants';

// Utilities
import {
  columnToLetter,
  letterToColumn,
  parseCellRef,
  getCellKey,
  parseCellKey,
  formatNumber,
  parseCSV,
  normalizeSelection,
  isCellInSelection,
} from './utils';

// Managers
import { UndoRedoManager, getUndoManager, resetUndoManager } from './managers/UndoRedoManager';
import { GridManager } from './managers/GridManager';
import { SearchManager } from './managers/SearchManager';

// Formula Engine
import { FormulaEngine } from './formulas/FormulaEngine';

// Electron IPC for file operations
const { ipcRenderer } = window.require ? window.require('electron') : { ipcRenderer: null };

// XLSX library for Excel file support (exposed globally by the app)
declare const XLSX: any;
declare const JSZip: any;

export const SpreadsheetWindow: React.FC = () => {
  // File state
  const [fileName, setFileName] = useState('Untitled Spreadsheet');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(true);

  // Data state
  const [data, setData] = useState<Map<string, CellData>>(new Map());
  const [colWidths, setColWidths] = useState<number[]>(Array(DEFAULT_COLS).fill(DEFAULT_COL_WIDTH));
  const [rowHeights, setRowHeights] = useState<number[]>(Array(DEFAULT_ROWS).fill(DEFAULT_ROW_HEIGHT));
  const [rowCount, setRowCount] = useState(DEFAULT_ROWS);
  const [colCount, setColCount] = useState(DEFAULT_COLS);

  // Selection state
  const [selectedCell, setSelectedCell] = useState<CellRef | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editingCell, setEditingCell] = useState<CellRef | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSelecting, setIsSelecting] = useState(false);

  // Clipboard state
  const [copiedCells, setCopiedCells] = useState<Map<string, CellData> | null>(null);
  const [copiedSelection, setCopiedSelection] = useState<Selection | null>(null);

  // Column resize state
  const [resizingCol, setResizingCol] = useState<number | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);

  // Search state
  const [searchState, setSearchState] = useState<SearchState>(SearchManager.createInitialState());

  // Undo/Redo state tracking
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  // Theme state
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const theme = THEMES[themeMode];
  const buttonStyle = getButtonStyle(theme);
  const separatorStyle = getSeparatorStyle(theme);

  // Refs
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Get undo manager instance
  const undoManager = useMemo(() => getUndoManager(), []);

  // Formula engine with current data
  const formulaEngine = useMemo(() => {
    return new FormulaEngine((row, col) => data.get(getCellKey(row, col)) || { value: '' });
  }, [data]);

  // Clear formula cache when data changes
  useEffect(() => {
    formulaEngine.clearCache();
  }, [data, formulaEngine]);

  // Cell data helpers
  const getCellData = useCallback((row: number, col: number): CellData => {
    return data.get(getCellKey(row, col)) || { value: '' };
  }, [data]);

  const setCellDataWithUndo = useCallback((row: number, col: number, cellData: Partial<CellData>, actionType: 'cell_edit' | 'format_change' = 'cell_edit') => {
    const key = getCellKey(row, col);

    // Create undo action before making changes
    const action = UndoRedoManager.createAction(actionType, data, [key]);
    undoManager.pushAction(action);
    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());

    setData(prev => {
      const newData = new Map(prev);
      const existing = newData.get(key) || { value: '' };
      newData.set(key, { ...existing, ...cellData });
      return newData;
    });
    setIsSaved(false);
  }, [data, undoManager]);

  const setCellDataNoUndo = useCallback((row: number, col: number, cellData: Partial<CellData>) => {
    const key = getCellKey(row, col);
    setData(prev => {
      const newData = new Map(prev);
      const existing = newData.get(key) || { value: '' };
      newData.set(key, { ...existing, ...cellData });
      return newData;
    });
    setIsSaved(false);
  }, []);

  // Get display value for a cell (evaluates formulas)
  const getDisplayValue = useCallback((row: number, col: number): string => {
    const cell = getCellData(row, col);
    let value: string | number;

    if (cell.formula) {
      value = formulaEngine.evaluate(cell.formula);
    } else {
      value = cell.value;
    }

    // Apply number formatting
    if (cell.format?.numberFormat && typeof value === 'number') {
      return formatNumber(value, cell.format.numberFormat);
    }

    const numValue = parseFloat(String(value));
    if (!isNaN(numValue) && cell.format?.numberFormat) {
      return formatNumber(numValue, cell.format.numberFormat);
    }

    return String(value);
  }, [getCellData, formulaEngine]);

  // Undo/Redo handlers
  const handleUndo = useCallback(() => {
    const action = undoManager.undo();
    if (!action) return;

    // Save current state for redo
    const affectedKeys = action.cellData.map(([key]) => key);
    const currentState = UndoRedoManager.createAction(action.type, data, affectedKeys);

    // Restore the old state
    setData(prev => {
      const newData = new Map(prev);

      // Clear affected cells first
      for (const key of affectedKeys) {
        newData.delete(key);
      }

      // Restore old values
      for (const [key, cell] of action.cellData) {
        if (cell.value !== '' || cell.formula || cell.format) {
          newData.set(key, cell);
        }
      }

      return newData;
    });

    // Restore row/col sizes if applicable
    if (action.colWidths) setColWidths(action.colWidths);
    if (action.rowHeights) setRowHeights(action.rowHeights);

    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);

    EventBus.getInstance().publish('log-message', 'Undo');
  }, [data, undoManager]);

  const handleRedo = useCallback(() => {
    const action = undoManager.redo();
    if (!action) return;

    // The action in redo stack has the state we want to restore TO
    // We need to swap - save current state to undo, restore redo state
    setData(prev => {
      const newData = new Map(prev);
      const affectedKeys = action.cellData.map(([key]) => key);

      // Clear affected cells
      for (const key of affectedKeys) {
        newData.delete(key);
      }

      // Restore redo values
      for (const [key, cell] of action.cellData) {
        if (cell.value !== '' || cell.formula || cell.format) {
          newData.set(key, cell);
        }
      }

      return newData;
    });

    if (action.colWidths) setColWidths(action.colWidths);
    if (action.rowHeights) setRowHeights(action.rowHeights);

    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);

    EventBus.getInstance().publish('log-message', 'Redo');
  }, [undoManager]);

  // Row/Column operations
  const handleInsertRow = useCallback((above: boolean = true) => {
    if (!selectedCell) return;

    const rowIndex = above ? selectedCell.row : selectedCell.row + 1;

    // Save state for undo
    const action = UndoRedoManager.createFullSnapshot('row_insert', data, {
      rowHeights: [...rowHeights],
      rowIndex,
    });
    undoManager.pushAction(action);

    // Insert row
    const newData = GridManager.insertRow(data, rowIndex, rowCount);
    const newHeights = GridManager.insertRowHeight(rowHeights, rowIndex, DEFAULT_ROW_HEIGHT);

    setData(newData);
    setRowHeights(newHeights);
    setRowCount(prev => prev + 1);
    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);

    EventBus.getInstance().publish('log-message', `Inserted row ${above ? 'above' : 'below'}`);
  }, [selectedCell, data, rowHeights, rowCount, undoManager]);

  const handleDeleteRow = useCallback(() => {
    if (!selectedCell) return;
    if (rowCount <= 1) return; // Don't delete last row

    // Save state for undo
    const action = UndoRedoManager.createFullSnapshot('row_delete', data, {
      rowHeights: [...rowHeights],
      rowIndex: selectedCell.row,
    });
    undoManager.pushAction(action);

    // Delete row
    const newData = GridManager.deleteRow(data, selectedCell.row);
    const newHeights = GridManager.deleteRowHeight(rowHeights, selectedCell.row);

    setData(newData);
    setRowHeights(newHeights);
    setRowCount(prev => prev - 1);

    // Adjust selection
    if (selectedCell.row >= rowCount - 1) {
      setSelectedCell({ row: Math.max(0, rowCount - 2), col: selectedCell.col });
    }

    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);

    EventBus.getInstance().publish('log-message', `Deleted row ${selectedCell.row + 1}`);
  }, [selectedCell, data, rowHeights, rowCount, undoManager]);

  const handleInsertColumn = useCallback((left: boolean = true) => {
    if (!selectedCell) return;

    const colIndex = left ? selectedCell.col : selectedCell.col + 1;

    // Save state for undo
    const action = UndoRedoManager.createFullSnapshot('col_insert', data, {
      colWidths: [...colWidths],
      colIndex,
    });
    undoManager.pushAction(action);

    // Insert column
    const newData = GridManager.insertColumn(data, colIndex, colCount);
    const newWidths = GridManager.insertColWidth(colWidths, colIndex, DEFAULT_COL_WIDTH);

    setData(newData);
    setColWidths(newWidths);
    setColCount(prev => prev + 1);
    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);

    EventBus.getInstance().publish('log-message', `Inserted column ${left ? 'left' : 'right'}`);
  }, [selectedCell, data, colWidths, colCount, undoManager]);

  const handleDeleteColumn = useCallback(() => {
    if (!selectedCell) return;
    if (colCount <= 1) return; // Don't delete last column

    // Save state for undo
    const action = UndoRedoManager.createFullSnapshot('col_delete', data, {
      colWidths: [...colWidths],
      colIndex: selectedCell.col,
    });
    undoManager.pushAction(action);

    // Delete column
    const newData = GridManager.deleteColumn(data, selectedCell.col);
    const newWidths = GridManager.deleteColWidth(colWidths, selectedCell.col);

    setData(newData);
    setColWidths(newWidths);
    setColCount(prev => prev - 1);

    // Adjust selection
    if (selectedCell.col >= colCount - 1) {
      setSelectedCell({ row: selectedCell.row, col: Math.max(0, colCount - 2) });
    }

    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);

    EventBus.getInstance().publish('log-message', `Deleted column ${columnToLetter(selectedCell.col)}`);
  }, [selectedCell, data, colWidths, colCount, undoManager]);

  // Handle cell click
  const handleCellClick = (row: number, col: number, e: React.MouseEvent) => {
    if (e.shiftKey && selectedCell) {
      setSelection({ start: selectedCell, end: { row, col } });
    } else {
      setSelectedCell({ row, col });
      setSelection(null);
    }
  };

  // Handle cell double-click to edit
  const handleCellDoubleClick = (row: number, col: number) => {
    const cell = getCellData(row, col);
    setEditingCell({ row, col });
    setEditValue(cell.formula || cell.value);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Handle edit completion
  const handleEditComplete = useCallback(() => {
    if (!editingCell) return;

    const { row, col } = editingCell;
    if (editValue.startsWith('=')) {
      setCellDataWithUndo(row, col, { formula: editValue, value: '' });
    } else {
      setCellDataWithUndo(row, col, { value: editValue, formula: undefined });
    }

    setEditingCell(null);
    setEditValue('');
  }, [editingCell, editValue, setCellDataWithUndo]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Global shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      handleRedo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      setSearchState(prev => ({ ...prev, isOpen: true }));
      setTimeout(() => searchInputRef.current?.focus(), 0);
      return;
    }

    if (!selectedCell) return;

    const { row, col } = selectedCell;

    if (editingCell) {
      if (e.key === 'Enter') {
        handleEditComplete();
        setSelectedCell({ row: row + 1, col });
      } else if (e.key === 'Escape') {
        setEditingCell(null);
        setEditValue('');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        handleEditComplete();
        setSelectedCell({ row, col: col + 1 });
      }
      return;
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (e.shiftKey && selection) {
          setSelection(prev => prev ? { ...prev, end: { row: Math.max(0, prev.end.row - 1), col: prev.end.col } } : null);
        } else if (e.shiftKey) {
          setSelection({ start: { row, col }, end: { row: Math.max(0, row - 1), col } });
        } else {
          setSelectedCell({ row: Math.max(0, row - 1), col });
          setSelection(null);
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (e.shiftKey && selection) {
          setSelection(prev => prev ? { ...prev, end: { row: Math.min(rowCount - 1, prev.end.row + 1), col: prev.end.col } } : null);
        } else if (e.shiftKey) {
          setSelection({ start: { row, col }, end: { row: Math.min(rowCount - 1, row + 1), col } });
        } else {
          setSelectedCell({ row: Math.min(rowCount - 1, row + 1), col });
          setSelection(null);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey && selection) {
          setSelection(prev => prev ? { ...prev, end: { row: prev.end.row, col: Math.max(0, prev.end.col - 1) } } : null);
        } else if (e.shiftKey) {
          setSelection({ start: { row, col }, end: { row, col: Math.max(0, col - 1) } });
        } else {
          setSelectedCell({ row, col: Math.max(0, col - 1) });
          setSelection(null);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey && selection) {
          setSelection(prev => prev ? { ...prev, end: { row: prev.end.row, col: Math.min(colCount - 1, prev.end.col + 1) } } : null);
        } else if (e.shiftKey) {
          setSelection({ start: { row, col }, end: { row, col: Math.min(colCount - 1, col + 1) } });
        } else {
          setSelectedCell({ row, col: Math.min(colCount - 1, col + 1) });
          setSelection(null);
        }
        break;
      case 'Enter':
        handleCellDoubleClick(row, col);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (selection) {
          // Delete all cells in selection
          const normalized = normalizeSelection(selection);
          const affectedKeys: string[] = [];
          for (let r = normalized.start.row; r <= normalized.end.row; r++) {
            for (let c = normalized.start.col; c <= normalized.end.col; c++) {
              affectedKeys.push(getCellKey(r, c));
            }
          }
          const action = UndoRedoManager.createAction('clear', data, affectedKeys);
          undoManager.pushAction(action);

          setData(prev => {
            const newData = new Map(prev);
            for (const key of affectedKeys) {
              newData.delete(key);
            }
            return newData;
          });
        } else {
          setCellDataWithUndo(row, col, { value: '', formula: undefined });
        }
        setUndoCount(undoManager.getUndoCount());
        setRedoCount(undoManager.getRedoCount());
        break;
      case 'c':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          handleCopy();
        }
        break;
      case 'v':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          handlePaste();
        }
        break;
      case 'x':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          handleCut();
        }
        break;
      default:
        // Start typing in cell
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setEditingCell({ row, col });
          setEditValue(e.key);
        }
    }
  }, [selectedCell, editingCell, selection, rowCount, colCount, data, handleEditComplete, handleUndo, handleRedo, setCellDataWithUndo, undoManager]);

  // Mouse selection
  const handleMouseDown = (row: number, col: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsSelecting(true);
    setSelectedCell({ row, col });
    setSelection({ start: { row, col }, end: { row, col } });
  };

  const handleMouseEnter = (row: number, col: number) => {
    if (!isSelecting || !selection) return;
    setSelection(prev => prev ? { ...prev, end: { row, col } } : null);
  };

  const handleMouseUp = () => {
    setIsSelecting(false);
    setResizingCol(null);
  };

  // Column resize handlers
  const handleColResizeStart = (col: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingCol(col);
    setResizeStartX(e.clientX);
    setResizeStartWidth(colWidths[col]);
  };

  const handleColResizeMove = useCallback((e: MouseEvent) => {
    if (resizingCol === null) return;
    const delta = e.clientX - resizeStartX;
    const newWidth = Math.max(MIN_COL_WIDTH, resizeStartWidth + delta);
    setColWidths(prev => {
      const newWidths = [...prev];
      newWidths[resizingCol] = newWidth;
      return newWidths;
    });
  }, [resizingCol, resizeStartX, resizeStartWidth]);

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    if (resizingCol !== null) {
      document.addEventListener('mousemove', handleColResizeMove);
    }
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousemove', handleColResizeMove);
    };
  }, [resizingCol, handleColResizeMove]);

  // Copy/Cut/Paste
  const handleCopy = useCallback(() => {
    if (!selection && !selectedCell) return;
    const sel = selection || { start: selectedCell!, end: selectedCell! };
    const normalized = normalizeSelection(sel);
    const copied = new Map<string, CellData>();

    for (let r = normalized.start.row; r <= normalized.end.row; r++) {
      for (let c = normalized.start.col; c <= normalized.end.col; c++) {
        const cell = getCellData(r, c);
        const relKey = getCellKey(r - normalized.start.row, c - normalized.start.col);
        copied.set(relKey, { ...cell, format: cell.format ? { ...cell.format } : undefined });
      }
    }

    setCopiedCells(copied);
    setCopiedSelection(sel);
    EventBus.getInstance().publish('log-message', 'Cells copied');
  }, [selection, selectedCell, getCellData]);

  const handleCut = useCallback(() => {
    handleCopy();
    if (!selection && !selectedCell) return;
    const sel = selection || { start: selectedCell!, end: selectedCell! };
    const normalized = normalizeSelection(sel);

    // Create undo action
    const affectedKeys: string[] = [];
    for (let r = normalized.start.row; r <= normalized.end.row; r++) {
      for (let c = normalized.start.col; c <= normalized.end.col; c++) {
        affectedKeys.push(getCellKey(r, c));
      }
    }
    const action = UndoRedoManager.createAction('cut', data, affectedKeys);
    undoManager.pushAction(action);

    setData(prev => {
      const newData = new Map(prev);
      for (const key of affectedKeys) {
        newData.delete(key);
      }
      return newData;
    });

    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);
    EventBus.getInstance().publish('log-message', 'Cells cut');
  }, [handleCopy, selection, selectedCell, data, undoManager]);

  const handlePaste = useCallback(() => {
    if (!copiedCells || !selectedCell) return;

    // Create undo action
    const affectedKeys: string[] = [];
    copiedCells.forEach((_, relKey) => {
      const { row: relRow, col: relCol } = parseCellKey(relKey);
      affectedKeys.push(getCellKey(selectedCell.row + relRow, selectedCell.col + relCol));
    });
    const action = UndoRedoManager.createAction('paste', data, affectedKeys);
    undoManager.pushAction(action);

    setData(prev => {
      const newData = new Map(prev);
      copiedCells.forEach((cellData, relKey) => {
        const { row: relRow, col: relCol } = parseCellKey(relKey);
        const newRow = selectedCell.row + relRow;
        const newCol = selectedCell.col + relCol;
        const newKey = getCellKey(newRow, newCol);
        newData.set(newKey, { ...cellData });
      });
      return newData;
    });

    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);
    EventBus.getInstance().publish('log-message', 'Cells pasted');
  }, [copiedCells, selectedCell, data, undoManager]);

  // Check if cell is in selection
  const isInSelection = (row: number, col: number): boolean => {
    if (!selection) return false;
    return isCellInSelection({ row, col }, selection);
  };

  // Search handlers
  const handleSearch = useCallback(() => {
    const matches = SearchManager.findAll(data, searchState.query, searchState.options, selection);
    setSearchState(prev => ({
      ...prev,
      matches,
      currentMatchIndex: matches.length > 0 ? 0 : -1,
    }));

    if (matches.length > 0) {
      setSelectedCell(matches[0]);
      setSelection(null);
    }

    EventBus.getInstance().publish('log-message', `Found ${matches.length} match(es)`);
  }, [data, searchState.query, searchState.options, selection]);

  const handleFindNext = useCallback(() => {
    if (searchState.matches.length === 0) {
      handleSearch();
      return;
    }

    const nextIndex = SearchManager.findNext(searchState.matches, searchState.currentMatchIndex, selectedCell);
    setSearchState(prev => ({ ...prev, currentMatchIndex: nextIndex }));

    if (nextIndex >= 0) {
      setSelectedCell(searchState.matches[nextIndex]);
      setSelection(null);
    }
  }, [searchState.matches, searchState.currentMatchIndex, selectedCell, handleSearch]);

  const handleFindPrevious = useCallback(() => {
    if (searchState.matches.length === 0) return;

    const prevIndex = SearchManager.findPrevious(searchState.matches, searchState.currentMatchIndex, selectedCell);
    setSearchState(prev => ({ ...prev, currentMatchIndex: prevIndex }));

    if (prevIndex >= 0) {
      setSelectedCell(searchState.matches[prevIndex]);
      setSelection(null);
    }
  }, [searchState.matches, searchState.currentMatchIndex, selectedCell]);

  const handleReplace = useCallback(() => {
    if (searchState.currentMatchIndex < 0 || searchState.matches.length === 0) return;

    const match = searchState.matches[searchState.currentMatchIndex];
    const key = getCellKey(match.row, match.col);

    // Create undo action
    const action = UndoRedoManager.createAction('cell_edit', data, [key]);
    undoManager.pushAction(action);

    const newData = SearchManager.replaceOne(data, match, searchState.query, searchState.replaceWith, searchState.options);
    setData(newData);
    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);

    // Re-search and move to next
    const matches = SearchManager.findAll(newData, searchState.query, searchState.options, selection);
    setSearchState(prev => ({
      ...prev,
      matches,
      currentMatchIndex: Math.min(prev.currentMatchIndex, matches.length - 1),
    }));

    EventBus.getInstance().publish('log-message', 'Replaced 1 occurrence');
  }, [searchState, data, selection, undoManager]);

  const handleReplaceAll = useCallback(() => {
    // Create undo action for all matches
    const affectedKeys = searchState.matches.map(m => getCellKey(m.row, m.col));
    const action = UndoRedoManager.createAction('cell_edit', data, affectedKeys);
    undoManager.pushAction(action);

    const { data: newData, count } = SearchManager.replaceAll(data, searchState.query, searchState.replaceWith, searchState.options, selection);
    setData(newData);
    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);

    setSearchState(prev => ({
      ...prev,
      matches: [],
      currentMatchIndex: -1,
    }));

    EventBus.getInstance().publish('log-message', `Replaced ${count} occurrence(s)`);
  }, [searchState, data, selection, undoManager]);

  // Format cell
  const formatCell = useCallback((format: Partial<CellFormat>) => {
    if (!selection && !selectedCell) return;
    const sel = selection || { start: selectedCell!, end: selectedCell! };
    const normalized = normalizeSelection(sel);

    // Create undo action
    const affectedKeys: string[] = [];
    for (let r = normalized.start.row; r <= normalized.end.row; r++) {
      for (let c = normalized.start.col; c <= normalized.end.col; c++) {
        affectedKeys.push(getCellKey(r, c));
      }
    }
    const action = UndoRedoManager.createAction('format_change', data, affectedKeys);
    undoManager.pushAction(action);

    setData(prev => {
      const newData = new Map(prev);
      for (let r = normalized.start.row; r <= normalized.end.row; r++) {
        for (let c = normalized.start.col; c <= normalized.end.col; c++) {
          const key = getCellKey(r, c);
          const existing = newData.get(key) || { value: '' };
          newData.set(key, {
            ...existing,
            format: { ...existing.format, ...format },
          });
        }
      }
      return newData;
    });

    setUndoCount(undoManager.getUndoCount());
    setRedoCount(undoManager.getRedoCount());
    setIsSaved(false);
  }, [selection, selectedCell, data, undoManager]);

  // Apply number format
  const applyNumberFormat = useCallback((formatType: keyof typeof NUMBER_FORMAT_PRESETS) => {
    formatCell({ numberFormat: NUMBER_FORMAT_PRESETS[formatType] as NumberFormat });
  }, [formatCell]);

  // File operations
  const saveSpreadsheet = async () => {
    if (!ipcRenderer) {
      const saveData = {
        data: Array.from(data.entries()),
        colWidths,
        rowHeights,
        fileName,
        rowCount,
        colCount,
      };
      localStorage.setItem(`spreadsheet_${fileName}`, JSON.stringify(saveData));
      setIsSaved(true);
      EventBus.getInstance().publish('log-message', `Spreadsheet "${fileName}" saved to browser storage`);
      return;
    }

    try {
      let savePath = filePath;

      if (!savePath) {
        const result = await ipcRenderer.invoke('show-save-dialog', {
          title: 'Save Spreadsheet',
          defaultPath: `${fileName}.sheet`,
          filters: [
            { name: 'Spreadsheet Files', extensions: ['sheet'] },
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (!result.success || result.canceled) return;
        savePath = result.filePath;
      }

      const saveData = JSON.stringify({
        data: Array.from(data.entries()),
        colWidths,
        rowHeights,
        fileName,
        rowCount,
        colCount,
      }, null, 2);

      const writeResult = await ipcRenderer.invoke('write-file', { filePath: savePath, content: saveData });

      if (writeResult.success) {
        setFilePath(savePath);
        setIsSaved(true);
        const name = savePath.split(/[/\\]/).pop()?.replace(/\.(sheet|json)$/, '') || fileName;
        setFileName(name);
        EventBus.getInstance().publish('log-message', `Saved to ${savePath}`);
      } else {
        EventBus.getInstance().publish('log-message', `Error saving: ${writeResult.error}`);
      }
    } catch (error) {
      EventBus.getInstance().publish('log-message', `Error saving: ${error}`);
    }
  };

  const saveAsSpreadsheet = async () => {
    if (!ipcRenderer) {
      saveSpreadsheet();
      return;
    }

    const oldPath = filePath;
    setFilePath(null);

    try {
      const result = await ipcRenderer.invoke('show-save-dialog', {
        title: 'Save Spreadsheet As',
        defaultPath: `${fileName}.sheet`,
        filters: [
          { name: 'Spreadsheet Files', extensions: ['sheet'] },
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.success || result.canceled) {
        setFilePath(oldPath);
        return;
      }

      const savePath = result.filePath;
      const saveData = JSON.stringify({
        data: Array.from(data.entries()),
        colWidths,
        rowHeights,
        fileName,
        rowCount,
        colCount,
      }, null, 2);

      const writeResult = await ipcRenderer.invoke('write-file', { filePath: savePath, content: saveData });

      if (writeResult.success) {
        setFilePath(savePath);
        setIsSaved(true);
        const name = savePath.split(/[/\\]/).pop()?.replace(/\.(sheet|json)$/, '') || fileName;
        setFileName(name);
        EventBus.getInstance().publish('log-message', `Saved to ${savePath}`);
      } else {
        setFilePath(oldPath);
        EventBus.getInstance().publish('log-message', `Error saving: ${writeResult.error}`);
      }
    } catch (error) {
      setFilePath(oldPath);
      EventBus.getInstance().publish('log-message', `Error saving: ${error}`);
    }
  };

  const loadSpreadsheet = async () => {
    if (!ipcRenderer) {
      const saved = localStorage.getItem(`spreadsheet_${fileName}`);
      if (saved) {
        const saveData = JSON.parse(saved);
        setData(new Map(saveData.data));
        if (saveData.colWidths) setColWidths(saveData.colWidths);
        if (saveData.rowHeights) setRowHeights(saveData.rowHeights);
        if (saveData.rowCount) setRowCount(saveData.rowCount);
        if (saveData.colCount) setColCount(saveData.colCount);
        setIsSaved(true);
        resetUndoManager();
        setUndoCount(0);
        setRedoCount(0);
        EventBus.getInstance().publish('log-message', `Spreadsheet "${fileName}" loaded from browser storage`);
      }
      return;
    }

    try {
      const result = await ipcRenderer.invoke('show-open-dialog', {
        title: 'Open Spreadsheet',
        filters: [
          { name: 'All Spreadsheet Files', extensions: ['xlsx', 'xls', 'sheet', 'csv'] },
          { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
          { name: 'Spreadsheet Files', extensions: ['sheet'] },
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (!result.success || result.canceled) return;

      const loadPath = result.filePaths[0];
      const lowerPath = loadPath.toLowerCase();

      // Handle Excel files (xlsx, xls)
      if (lowerPath.endsWith('.xlsx') || lowerPath.endsWith('.xls')) {
        const readResult = await ipcRenderer.invoke('read-file', { filePath: loadPath, encoding: 'base64' });

        if (readResult.success) {
          if (typeof XLSX === 'undefined') {
            EventBus.getInstance().publish('log-message', 'XLSX library not available. Please rebuild the app.');
            return;
          }

          const workbook = XLSX.read(readResult.content, { type: 'base64' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];

          // Parse styles (simplified - full implementation in original code)
          let cellStyles: Map<string, { bgColor?: string; fgColor?: string; bold?: boolean; italic?: boolean; align?: string }> = new Map();

          if (typeof JSZip !== 'undefined' && lowerPath.endsWith('.xlsx')) {
            try {
              const binaryString = atob(readResult.content);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }

              const zip = await JSZip.loadAsync(bytes);
              const stylesXml = await zip.file('xl/styles.xml')?.async('string');
              const sheetXml = await zip.file('xl/worksheets/sheet1.xml')?.async('string');

              if (stylesXml && sheetXml) {
                // Parse fills
                const fills: (string | null)[] = [];
                const fillMatches = stylesXml.matchAll(/<fill[^>]*>([\s\S]*?)<\/fill>/g);
                for (const match of fillMatches) {
                  const fillContent = match[1];
                  const rgbMatch = fillContent.match(/fgColor[^>]*rgb="([A-Fa-f0-9]{6,8})"/);
                  const indexedMatch = fillContent.match(/fgColor[^>]*indexed="(\d+)"/);
                  const themeMatch = fillContent.match(/fgColor[^>]*theme="(\d+)"(?:[^>]*tint="([^"]+)")?/);

                  if (rgbMatch) {
                    fills.push('#' + rgbMatch[1].slice(-6).toUpperCase());
                  } else if (indexedMatch) {
                    const idx = parseInt(indexedMatch[1]);
                    fills.push(INDEXED_COLORS[idx] ? '#' + INDEXED_COLORS[idx] : null);
                  } else if (themeMatch) {
                    const themeIdx = parseInt(themeMatch[1]);
                    let color = DEFAULT_THEME_COLORS[themeIdx] || 'FFFFFF';
                    if (themeMatch[2]) {
                      const tint = parseFloat(themeMatch[2]);
                      const r = parseInt(color.slice(0, 2), 16);
                      const g = parseInt(color.slice(2, 4), 16);
                      const b = parseInt(color.slice(4, 6), 16);
                      const applyTint = (c: number) => {
                        if (tint < 0) return Math.round(c * (1 + tint));
                        return Math.round(c + (255 - c) * tint);
                      };
                      color = applyTint(r).toString(16).padStart(2, '0') +
                              applyTint(g).toString(16).padStart(2, '0') +
                              applyTint(b).toString(16).padStart(2, '0');
                    }
                    fills.push('#' + color.toUpperCase());
                  } else {
                    fills.push(null);
                  }
                }

                // Parse fonts
                const fonts: { color?: string; bold?: boolean; italic?: boolean }[] = [];
                const fontMatches = stylesXml.matchAll(/<font[^>]*>([\s\S]*?)<\/font>/g);
                for (const match of fontMatches) {
                  const fontContent = match[1];
                  const font: { color?: string; bold?: boolean; italic?: boolean } = {};
                  if (/<b\s*\/>|<b>/.test(fontContent)) font.bold = true;
                  if (/<i\s*\/>|<i>/.test(fontContent)) font.italic = true;
                  const colorRgbMatch = fontContent.match(/<color[^>]*rgb="([A-Fa-f0-9]{6,8})"/);
                  if (colorRgbMatch) {
                    font.color = '#' + colorRgbMatch[1].slice(-6).toUpperCase();
                  }
                  fonts.push(font);
                }

                // Parse cellXfs
                const cellXfs: { fontId: number; fillId: number; align?: string }[] = [];
                const cellXfsSection = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
                if (cellXfsSection) {
                  const xfMatches = cellXfsSection[1].matchAll(/<xf[^>]*(?:\/>|>([\s\S]*?)<\/xf>)/g);
                  for (const match of xfMatches) {
                    const xfTag = match[0];
                    const fontIdMatch = xfTag.match(/fontId="(\d+)"/);
                    const fillIdMatch = xfTag.match(/fillId="(\d+)"/);
                    const alignMatch = match[1]?.match(/<alignment[^>]*horizontal="([^"]+)"/);
                    cellXfs.push({
                      fontId: fontIdMatch ? parseInt(fontIdMatch[1]) : 0,
                      fillId: fillIdMatch ? parseInt(fillIdMatch[1]) : 0,
                      align: alignMatch ? alignMatch[1] : undefined
                    });
                  }
                }

                // Parse cell style references
                const cellMatches = sheetXml.matchAll(/<c\s+r="([A-Z]+\d+)"[^>]*(?:s="(\d+)")?[^>]*>/g);
                for (const match of cellMatches) {
                  const cellRef = match[0];
                  const cellAddr = match[1];
                  const styleIdMatch = cellRef.match(/s="(\d+)"/);

                  if (styleIdMatch) {
                    const styleId = parseInt(styleIdMatch[1]);
                    const xf = cellXfs[styleId];
                    if (xf) {
                      const style: { bgColor?: string; fgColor?: string; bold?: boolean; italic?: boolean; align?: string } = {};
                      if (xf.fillId >= 2 && fills[xf.fillId]) {
                        style.bgColor = fills[xf.fillId]!;
                      }
                      const font = fonts[xf.fontId];
                      if (font) {
                        if (font.color && font.color !== '#000000') style.fgColor = font.color;
                        if (font.bold) style.bold = true;
                        if (font.italic) style.italic = true;
                      }
                      if (xf.align) style.align = xf.align;
                      if (Object.keys(style).length > 0) {
                        cellStyles.set(cellAddr, style);
                      }
                    }
                  }
                }
              }
            } catch (zipError) {
              console.error('[XLSX Import] Error parsing styles:', zipError);
            }
          }

          // Convert to our data format
          const newData = new Map<string, CellData>();
          const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

          for (let row = range.s.r; row <= range.e.r; row++) {
            for (let col = range.s.c; col <= range.e.c; col++) {
              const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
              const cell = worksheet[cellAddress];
              const style = cellStyles.get(cellAddress);

              if ((cell && cell.v !== undefined && cell.v !== null && cell.v !== '') || style) {
                const value = cell ? String(cell.v ?? '') : '';
                const formula = cell?.f ? `=${cell.f}` : undefined;

                const format: CellFormat = {};
                if (style) {
                  if (style.bgColor && style.bgColor !== '#FFFFFF') {
                    format.backgroundColor = style.bgColor;
                  }
                  if (style.fgColor) {
                    format.textColor = style.fgColor;
                  }
                  if (style.bold) format.bold = true;
                  if (style.italic) format.italic = true;
                  if (style.align === 'left' || style.align === 'center' || style.align === 'right') {
                    format.textAlign = style.align;
                  }
                }

                newData.set(`${row},${col}`, {
                  value,
                  formula,
                  format: Object.keys(format).length > 0 ? format : undefined
                });
              }
            }
          }

          setData(newData);

          if (worksheet['!cols']) {
            const importedWidths = worksheet['!cols'].map((col: any) =>
              col?.wch ? col.wch * 7 : DEFAULT_COL_WIDTH
            );
            while (importedWidths.length < DEFAULT_COLS) {
              importedWidths.push(DEFAULT_COL_WIDTH);
            }
            setColWidths(importedWidths);
          } else {
            setColWidths(Array(DEFAULT_COLS).fill(DEFAULT_COL_WIDTH));
          }
          setRowHeights(Array(DEFAULT_ROWS).fill(DEFAULT_ROW_HEIGHT));
          setRowCount(Math.max(DEFAULT_ROWS, range.e.r + 1));
          setColCount(Math.max(DEFAULT_COLS, range.e.c + 1));

          const name = loadPath.split(/[/\\]/).pop()?.replace(/\.(xlsx|xls)$/i, '') || 'Untitled';
          setFileName(name);
          setFilePath(null);
          setSelectedCell(null);
          setSelection(null);
          resetUndoManager();
          setUndoCount(0);
          setRedoCount(0);
          setIsSaved(false);
          EventBus.getInstance().publish('log-message', `Imported Excel file: ${loadPath}`);
        } else {
          EventBus.getInstance().publish('log-message', `Error loading: ${readResult.error}`);
        }
        return;
      }

      const readResult = await ipcRenderer.invoke('read-file', loadPath);

      if (readResult.success) {
        if (lowerPath.endsWith('.csv')) {
          const rows = parseCSV(readResult.content);
          const newData = new Map<string, CellData>();
          rows.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
              if (cell) {
                newData.set(`${rowIndex},${colIndex}`, { value: cell });
              }
            });
          });
          setData(newData);
          setColWidths(Array(Math.max(DEFAULT_COLS, rows[0]?.length || 0)).fill(DEFAULT_COL_WIDTH));
          setRowHeights(Array(Math.max(DEFAULT_ROWS, rows.length)).fill(DEFAULT_ROW_HEIGHT));
          setRowCount(Math.max(DEFAULT_ROWS, rows.length));
          setColCount(Math.max(DEFAULT_COLS, rows[0]?.length || 0));
        } else {
          const saveData = JSON.parse(readResult.content);
          setData(new Map(saveData.data));
          if (saveData.colWidths) setColWidths(saveData.colWidths);
          if (saveData.rowHeights) setRowHeights(saveData.rowHeights);
          if (saveData.rowCount) setRowCount(saveData.rowCount);
          if (saveData.colCount) setColCount(saveData.colCount);
        }

        const name = loadPath.split(/[/\\]/).pop()?.replace(/\.(sheet|json|csv)$/, '') || 'Untitled';
        setFileName(name);
        setFilePath(loadPath);
        setSelectedCell(null);
        setSelection(null);
        resetUndoManager();
        setUndoCount(0);
        setRedoCount(0);
        setIsSaved(true);
        EventBus.getInstance().publish('log-message', `Loaded from ${loadPath}`);
      } else {
        EventBus.getInstance().publish('log-message', `Error loading: ${readResult.error}`);
      }
    } catch (error) {
      EventBus.getInstance().publish('log-message', `Error loading: ${error}`);
    }
  };

  const newSpreadsheet = () => {
    if (!isSaved) {
      if (!confirm('You have unsaved changes. Create a new spreadsheet anyway?')) {
        return;
      }
    }
    setData(new Map());
    setFileName('Untitled Spreadsheet');
    setFilePath(null);
    setColWidths(Array(DEFAULT_COLS).fill(DEFAULT_COL_WIDTH));
    setRowHeights(Array(DEFAULT_ROWS).fill(DEFAULT_ROW_HEIGHT));
    setRowCount(DEFAULT_ROWS);
    setColCount(DEFAULT_COLS);
    setSelectedCell(null);
    setSelection(null);
    resetUndoManager();
    setUndoCount(0);
    setRedoCount(0);
    setIsSaved(true);
  };

  const exportAsCSV = () => {
    let csv = '';
    let maxRow = 0;
    let maxCol = 0;
    data.forEach((_, key) => {
      const { row, col } = parseCellKey(key);
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
    });

    for (let r = 0; r <= maxRow; r++) {
      const row: string[] = [];
      for (let c = 0; c <= maxCol; c++) {
        let val = getDisplayValue(r, c);
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        row.push(val);
      }
      csv += row.join(',') + '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    EventBus.getInstance().publish('log-message', `Exported as ${fileName}.csv`);
  };

  const exportAsXLSX = async () => {
    if (typeof XLSX === 'undefined') {
      EventBus.getInstance().publish('log-message', 'XLSX library not available. Please rebuild the app.');
      return;
    }

    let maxRow = 0;
    let maxCol = 0;
    data.forEach((_, key) => {
      const { row, col } = parseCellKey(key);
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
    });

    const wsData: (string | number)[][] = [];
    for (let r = 0; r <= maxRow; r++) {
      const row: (string | number)[] = [];
      for (let c = 0; c <= maxCol; c++) {
        const displayValue = getDisplayValue(r, c);
        const num = parseFloat(displayValue);
        row.push(isNaN(num) ? displayValue : num);
      }
      wsData.push(row);
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(wsData);

    data.forEach((cell, key) => {
      const { row, col } = parseCellKey(key);
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      if (!worksheet[cellAddress]) {
        worksheet[cellAddress] = { v: '', t: 's' };
      }
      if (cell.formula) {
        worksheet[cellAddress].f = cell.formula.substring(1);
      }
    });

    worksheet['!cols'] = colWidths.slice(0, maxCol + 1).map(w => ({ wch: Math.round(w / 7) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' });

    if (ipcRenderer) {
      try {
        const result = await ipcRenderer.invoke('show-save-dialog', {
          title: 'Export as Excel',
          defaultPath: `${fileName}.xlsx`,
          filters: [
            { name: 'Excel Files', extensions: ['xlsx'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (!result.success || result.canceled) return;

        const writeResult = await ipcRenderer.invoke('write-file', {
          filePath: result.filePath,
          content: wbout,
          encoding: 'base64'
        });

        if (writeResult.success) {
          EventBus.getInstance().publish('log-message', `Exported as ${result.filePath}`);
        } else {
          EventBus.getInstance().publish('log-message', `Error exporting: ${writeResult.error}`);
        }
      } catch (error) {
        EventBus.getInstance().publish('log-message', `Error exporting: ${error}`);
      }
    } else {
      const binary = atob(wbout);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      EventBus.getInstance().publish('log-message', `Exported as ${fileName}.xlsx`);
    }
  };

  // Get selection info for status bar
  const getSelectionInfo = (): string => {
    if (!selection && !selectedCell) return '';

    const sel = selection || { start: selectedCell!, end: selectedCell! };
    const normalized = normalizeSelection(sel);

    let sum = 0;
    let count = 0;

    for (let r = normalized.start.row; r <= normalized.end.row; r++) {
      for (let c = normalized.start.col; c <= normalized.end.col; c++) {
        const val = parseFloat(getDisplayValue(r, c));
        if (!isNaN(val)) {
          sum += val;
          count++;
        }
      }
    }

    if (count > 1) {
      return `Sum: ${sum.toFixed(2)} | Average: ${(sum / count).toFixed(2)} | Count: ${count}`;
    }
    return '';
  };

  // Check if cell is a search match
  const isSearchMatch = (row: number, col: number): boolean => {
    return searchState.matches.some(m => m.row === row && m.col === col);
  };

  const isCurrentSearchMatch = (row: number, col: number): boolean => {
    if (searchState.currentMatchIndex < 0) return false;
    const current = searchState.matches[searchState.currentMatchIndex];
    return current?.row === row && current?.col === col;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: theme.background,
        color: theme.text,
      }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Top Menu Bar */}
      <div style={{
        background: theme.backgroundHeader,
        padding: '8px 12px',
        borderBottom: `1px solid ${theme.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
      }}>
        <button onClick={newSpreadsheet} style={buttonStyle}>New</button>
        <button onClick={loadSpreadsheet} style={buttonStyle}>Open</button>
        <button onClick={saveSpreadsheet} style={buttonStyle}>Save</button>
        <button onClick={saveAsSpreadsheet} style={buttonStyle}>Save As</button>

        <div style={separatorStyle} />

        <button onClick={handleUndo} disabled={undoCount === 0} style={{ ...buttonStyle, opacity: undoCount === 0 ? 0.5 : 1 }}>Undo</button>
        <button onClick={handleRedo} disabled={redoCount === 0} style={{ ...buttonStyle, opacity: redoCount === 0 ? 0.5 : 1 }}>Redo</button>

        <div style={separatorStyle} />

        <button onClick={exportAsCSV} style={buttonStyle}>Export CSV</button>
        <button onClick={exportAsXLSX} style={buttonStyle}>Export XLSX</button>

        <div style={separatorStyle} />

        <button onClick={() => setSearchState(prev => ({ ...prev, isOpen: !prev.isOpen }))} style={buttonStyle}>
          Find
        </button>

        <div style={separatorStyle} />

        <button
          onClick={() => setThemeMode(prev => prev === 'dark' ? 'light' : 'dark')}
          style={buttonStyle}
          title={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} theme`}
        >
          {themeMode === 'dark' ? 'Light' : 'Dark'}
        </button>

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: '13px', color: theme.textMuted }}>{fileName}</span>
        <span style={{ color: isSaved ? theme.savedColor : theme.unsavedColor, fontSize: '12px' }}>
          {isSaved ? '(saved)' : '(unsaved)'}
        </span>
      </div>

      {/* Search Bar */}
      {searchState.isOpen && (
        <div style={{
          background: theme.backgroundAlt,
          padding: '8px 12px',
          borderBottom: `1px solid ${theme.border}`,
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Find..."
            value={searchState.query}
            onChange={(e) => setSearchState(prev => ({ ...prev, query: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) handleFindPrevious();
                else handleFindNext();
              } else if (e.key === 'Escape') {
                setSearchState(prev => ({ ...prev, isOpen: false }));
              }
            }}
            style={{
              background: theme.inputBackground,
              border: `1px solid ${theme.inputBorder}`,
              padding: '4px 8px',
              borderRadius: '4px',
              color: theme.inputText,
              width: '150px',
            }}
          />
          <input
            type="text"
            placeholder="Replace with..."
            value={searchState.replaceWith}
            onChange={(e) => setSearchState(prev => ({ ...prev, replaceWith: e.target.value }))}
            style={{
              background: theme.inputBackground,
              border: `1px solid ${theme.inputBorder}`,
              padding: '4px 8px',
              borderRadius: '4px',
              color: theme.inputText,
              width: '150px',
            }}
          />
          <button onClick={handleFindNext} style={buttonStyle}>Find Next</button>
          <button onClick={handleFindPrevious} style={buttonStyle}>Find Prev</button>
          <button onClick={handleReplace} style={buttonStyle}>Replace</button>
          <button onClick={handleReplaceAll} style={buttonStyle}>Replace All</button>

          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
            <input
              type="checkbox"
              checked={searchState.options.caseSensitive}
              onChange={(e) => setSearchState(prev => ({
                ...prev,
                options: { ...prev.options, caseSensitive: e.target.checked }
              }))}
            />
            Case
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
            <input
              type="checkbox"
              checked={searchState.options.wholeCell}
              onChange={(e) => setSearchState(prev => ({
                ...prev,
                options: { ...prev.options, wholeCell: e.target.checked }
              }))}
            />
            Whole cell
          </label>

          <span style={{ fontSize: '11px', color: theme.textMuted }}>
            {searchState.matches.length > 0
              ? `${searchState.currentMatchIndex + 1} of ${searchState.matches.length}`
              : 'No matches'}
          </span>

          <button
            onClick={() => setSearchState(prev => ({ ...prev, isOpen: false, matches: [], currentMatchIndex: -1 }))}
            style={{ ...buttonStyle, padding: '4px 8px' }}
          >
            X
          </button>
        </div>
      )}

      {/* Formatting Toolbar */}
      <div style={{
        background: theme.backgroundAlt,
        padding: '8px 12px',
        borderBottom: `1px solid ${theme.border}`,
        display: 'flex',
        gap: '6px',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <button
          onClick={() => formatCell({ bold: !getCellData(selectedCell?.row || 0, selectedCell?.col || 0).format?.bold })}
          style={{ ...buttonStyle, fontWeight: 'bold' }}
        >
          B
        </button>
        <button
          onClick={() => formatCell({ italic: !getCellData(selectedCell?.row || 0, selectedCell?.col || 0).format?.italic })}
          style={{ ...buttonStyle, fontStyle: 'italic' }}
        >
          I
        </button>

        <div style={separatorStyle} />

        <button onClick={() => formatCell({ textAlign: 'left' })} style={buttonStyle}>Left</button>
        <button onClick={() => formatCell({ textAlign: 'center' })} style={buttonStyle}>Center</button>
        <button onClick={() => formatCell({ textAlign: 'right' })} style={buttonStyle}>Right</button>

        <div style={separatorStyle} />

        <select
          onChange={(e) => applyNumberFormat(e.target.value as keyof typeof NUMBER_FORMAT_PRESETS)}
          style={{ ...buttonStyle, padding: '4px 8px' }}
          value=""
        >
          <option value="" disabled>Format</option>
          <option value="general">General</option>
          <option value="number">Number</option>
          <option value="currency">Currency ($)</option>
          <option value="percentage">Percentage (%)</option>
          <option value="scientific">Scientific</option>
        </select>

        <div style={separatorStyle} />

        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
          Fill:
          <input
            type="color"
            onChange={(e) => formatCell({ backgroundColor: e.target.value })}
            style={{ width: '30px', height: '24px', border: `1px solid ${theme.border}`, borderRadius: '4px' }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
          Text:
          <input
            type="color"
            defaultValue={themeMode === 'dark' ? '#ffffff' : '#000000'}
            onChange={(e) => formatCell({ textColor: e.target.value })}
            style={{ width: '30px', height: '24px', border: `1px solid ${theme.border}`, borderRadius: '4px' }}
          />
        </label>

        <div style={separatorStyle} />

        <button onClick={handleCopy} style={buttonStyle}>Copy</button>
        <button onClick={handleCut} style={buttonStyle}>Cut</button>
        <button onClick={handlePaste} style={buttonStyle}>Paste</button>

        <div style={separatorStyle} />

        <button onClick={() => handleInsertRow(true)} style={buttonStyle} disabled={!selectedCell}>+ Row</button>
        <button onClick={handleDeleteRow} style={buttonStyle} disabled={!selectedCell}>- Row</button>
        <button onClick={() => handleInsertColumn(true)} style={buttonStyle} disabled={!selectedCell}>+ Col</button>
        <button onClick={handleDeleteColumn} style={buttonStyle} disabled={!selectedCell}>- Col</button>
      </div>

      {/* Formula Bar */}
      <div style={{
        background: theme.backgroundAlt,
        padding: '6px 12px',
        borderBottom: `1px solid ${theme.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <span style={{
          background: theme.inputBackground,
          padding: '4px 8px',
          borderRadius: '4px',
          minWidth: '60px',
          textAlign: 'center',
          fontSize: '14px',
          border: `1px solid ${theme.border}`,
        }}>
          {selectedCell ? `${columnToLetter(selectedCell.col)}${selectedCell.row + 1}` : ''}
        </span>
        <span style={{ color: theme.textMuted }}>fx</span>
        <input
          ref={inputRef}
          type="text"
          value={editingCell ? editValue : (selectedCell ? (getCellData(selectedCell.row, selectedCell.col).formula || getCellData(selectedCell.row, selectedCell.col).value) : '')}
          onChange={(e) => {
            if (editingCell) {
              setEditValue(e.target.value);
            } else if (selectedCell) {
              setEditingCell(selectedCell);
              setEditValue(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleEditComplete();
            } else if (e.key === 'Escape') {
              setEditingCell(null);
              setEditValue('');
            }
          }}
          style={{
            flex: 1,
            background: theme.inputBackground,
            border: `1px solid ${theme.inputBorder}`,
            padding: '4px 8px',
            borderRadius: '4px',
            color: theme.inputText,
            fontSize: '14px',
          }}
        />
      </div>

      {/* Spreadsheet Grid */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          background: theme.background,
        }}
      >
        <table style={{
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}>
          <thead>
            <tr>
              <th style={{
                position: 'sticky',
                top: 0,
                left: 0,
                zIndex: 3,
                background: theme.cellBackgroundAlt,
                border: `1px solid ${theme.border}`,
                width: '50px',
                minWidth: '50px',
              }} />
              {Array.from({ length: colCount }, (_, col) => (
                <th
                  key={col}
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    background: theme.cellBackgroundAlt,
                    border: `1px solid ${theme.border}`,
                    padding: '6px',
                    width: `${colWidths[col] || DEFAULT_COL_WIDTH}px`,
                    minWidth: `${colWidths[col] || DEFAULT_COL_WIDTH}px`,
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'default',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    {columnToLetter(col)}
                    <div
                      onMouseDown={(e) => handleColResizeStart(col, e)}
                      style={{
                        position: 'absolute',
                        right: -3,
                        top: -6,
                        width: 6,
                        height: '100%',
                        minHeight: 24,
                        cursor: 'col-resize',
                        background: resizingCol === col ? theme.selectionBorder : 'transparent',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = theme.selectionBorder)}
                      onMouseLeave={(e) => {
                        if (resizingCol !== col) e.currentTarget.style.background = 'transparent';
                      }}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, row) => (
              <tr key={row}>
                <td style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 1,
                  background: theme.cellBackgroundAlt,
                  border: `1px solid ${theme.border}`,
                  padding: '4px 8px',
                  textAlign: 'center',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  height: `${rowHeights[row] || DEFAULT_ROW_HEIGHT}px`,
                }}>
                  {row + 1}
                </td>
                {Array.from({ length: colCount }, (_, col) => {
                  const cell = getCellData(row, col);
                  const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                  const isEditing = editingCell?.row === row && editingCell?.col === col;
                  const inSelection = isInSelection(row, col);
                  const isMatch = isSearchMatch(row, col);
                  const isCurrentMatch = isCurrentSearchMatch(row, col);

                  let bgColor = cell.format?.backgroundColor || theme.cellBackground;
                  if (isCurrentMatch) {
                    bgColor = theme.searchMatchCurrent;
                  } else if (isMatch) {
                    bgColor = theme.searchMatch;
                  } else if (inSelection && !isSelected) {
                    bgColor = theme.selectionBackground;
                  }

                  return (
                    <td
                      key={col}
                      onClick={(e) => handleCellClick(row, col, e)}
                      onDoubleClick={() => handleCellDoubleClick(row, col)}
                      onMouseDown={(e) => handleMouseDown(row, col, e)}
                      onMouseEnter={() => handleMouseEnter(row, col)}
                      style={{
                        border: isSelected ? `2px solid ${theme.selectionBorder}` : `1px solid ${theme.border}`,
                        padding: isEditing ? 0 : '2px 4px',
                        background: bgColor,
                        color: isMatch ? theme.searchMatchText : (cell.format?.textColor || theme.text),
                        fontWeight: cell.format?.bold ? 'bold' : 'normal',
                        fontStyle: cell.format?.italic ? 'italic' : 'normal',
                        textAlign: cell.format?.textAlign || 'left',
                        width: `${colWidths[col] || DEFAULT_COL_WIDTH}px`,
                        height: `${rowHeights[row] || DEFAULT_ROW_HEIGHT}px`,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        fontSize: '13px',
                        cursor: 'cell',
                      }}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleEditComplete}
                          autoFocus
                          style={{
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            outline: 'none',
                            background: theme.inputBackground,
                            color: theme.inputText,
                            padding: '2px 4px',
                            fontSize: '13px',
                          }}
                        />
                      ) : (
                        getDisplayValue(row, col)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status Bar */}
      <div style={{
        background: theme.backgroundHeader,
        padding: '6px 12px',
        borderTop: `1px solid ${theme.border}`,
        fontSize: '12px',
        color: theme.textMuted,
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>
          {selectedCell ? `${columnToLetter(selectedCell.col)}${selectedCell.row + 1}` : 'Ready'}
          {undoCount > 0 && ` | Undo: ${undoCount}`}
          {redoCount > 0 && ` | Redo: ${redoCount}`}
        </span>
        <span>{getSelectionInfo()}</span>
      </div>
    </div>
  );
};
