// Toolbar Component - Top menu bar and formatting toolbar

import React from 'react';
import { SlideElement, SlideTemplate } from '../types';
import {
  buttonClass,
  buttonActiveClass,
  selectClass,
  FONTS,
  FONT_SIZES,
  SLIDE_TEMPLATES,
} from '../constants';
import { getShortcutDisplay } from '../hooks/useKeyboardShortcuts';

// Menu Bar Props
interface MenuBarProps {
  fileName: string;
  filePath: string | null;
  isSaved: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportHTML: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPresent: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({
  fileName,
  filePath,
  isSaved,
  canUndo,
  canRedo,
  undoCount,
  redoCount,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onExportHTML,
  onUndo,
  onRedo,
  onPresent,
}) => {
  return (
    <div className="bg-slate-800 py-2 px-3 border-b border-slate-600 flex items-center gap-2.5 flex-wrap">
      {/* File operations */}
      <ButtonWithShortcut label="New" shortcut="new" onClick={onNew} />
      <ButtonWithShortcut label="Open" shortcut="open" onClick={onOpen} />
      <ButtonWithShortcut label="Save" shortcut="save" onClick={onSave} />
      <ButtonWithShortcut label="Save As" shortcut="saveAs" onClick={onSaveAs} />
      <button onClick={onExportHTML} className={buttonClass} title="Export as HTML">
        Export HTML
      </button>

      <Divider />

      {/* Undo/Redo */}
      <button
        onClick={onUndo}
        className={`${buttonClass} ${!canUndo ? 'opacity-50' : ''}`}
        disabled={!canUndo}
        title={`Undo (${getShortcutDisplay('undo')}) - ${undoCount} actions`}
      >
        ↩ Undo
      </button>
      <button
        onClick={onRedo}
        className={`${buttonClass} ${!canRedo ? 'opacity-50' : ''}`}
        disabled={!canRedo}
        title={`Redo (${getShortcutDisplay('redo')}) - ${redoCount} actions`}
      >
        ↪ Redo
      </button>

      <Divider />

      {/* File info */}
      <span className="text-[13px] text-slate-300">{fileName}</span>
      <span className={`text-xs ${isSaved ? 'text-green-500' : 'text-red-500'}`}>
        {isSaved ? '(saved)' : '(unsaved)'}
      </span>
      {filePath && (
        <span
          className="text-[11px] text-slate-500 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap"
          title={filePath}
        >
          {filePath}
        </span>
      )}

      <div className="flex-1" />

      {/* Present button */}
      <button
        onClick={onPresent}
        className={buttonActiveClass}
        title={`Start presentation (${getShortcutDisplay('startPresentation')})`}
      >
        ▶ Present
      </button>
    </div>
  );
};

// Formatting Toolbar Props
interface FormattingToolbarProps {
  selectedElement: SlideElement | null;
  hasClipboard: boolean;
  onAddText: () => void;
  onAddImage: () => void;
  onAddShape: (shapeType: 'rectangle' | 'ellipse' | 'triangle') => void;
  onAddLine: () => void;
  onAddArrow: () => void;
  onAddSlideFromTemplate: (template: SlideTemplate) => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onUpdateElement: (updates: Partial<SlideElement>) => void;
  onToggleListType: (type: 'bullet' | 'numbered') => void;
  onAlignElements: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  multipleSelected: boolean;
}

export const FormattingToolbar: React.FC<FormattingToolbarProps> = ({
  selectedElement,
  hasClipboard,
  onAddText,
  onAddImage,
  onAddShape,
  onAddLine,
  onAddArrow,
  onAddSlideFromTemplate,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  onUpdateElement,
  onToggleListType,
  onAlignElements,
  multipleSelected,
}) => {
  const isTextOrShape =
    selectedElement?.type === 'text' || selectedElement?.type === 'shape';
  const isLineOrArrow =
    selectedElement?.type === 'line' || selectedElement?.type === 'arrow';

  return (
    <div className="bg-[#252525] py-2 px-3 border-b border-slate-600 flex gap-1.5 flex-wrap items-center">
      {/* Add elements */}
      <button onClick={onAddText} className={buttonClass} title="Add text box">
        + Text
      </button>
      <button onClick={onAddImage} className={buttonClass} title="Add image">
        + Image
      </button>
      <button
        onClick={() => onAddShape('rectangle')}
        className={buttonClass}
        title="Add rectangle"
      >
        ▢ Rect
      </button>
      <button
        onClick={() => onAddShape('ellipse')}
        className={buttonClass}
        title="Add ellipse"
      >
        ○ Ellipse
      </button>
      <button
        onClick={() => onAddShape('triangle')}
        className={buttonClass}
        title="Add triangle"
      >
        △ Triangle
      </button>
      <button
        onClick={onAddLine}
        className={buttonClass}
        title="Add line"
      >
        ─ Line
      </button>
      <button
        onClick={onAddArrow}
        className={buttonClass}
        title="Add arrow"
      >
        → Arrow
      </button>

      <Divider />

      {/* Slide templates dropdown */}
      <select
        onChange={(e) => {
          const template = SLIDE_TEMPLATES.find((t) => t.id === e.target.value);
          if (template) {
            onAddSlideFromTemplate(template);
            e.target.value = '';
          }
        }}
        className={selectClass}
        defaultValue=""
      >
        <option value="" disabled>
          + Slide Template
        </option>
        {SLIDE_TEMPLATES.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </select>

      <Divider />

      {/* Clipboard operations */}
      <button
        onClick={onCopy}
        className={`${buttonClass} ${!selectedElement ? 'opacity-50' : ''}`}
        disabled={!selectedElement}
        title={`Copy (${getShortcutDisplay('copy')})`}
      >
        Copy
      </button>
      <button
        onClick={onCut}
        className={`${buttonClass} ${!selectedElement ? 'opacity-50' : ''}`}
        disabled={!selectedElement}
        title={`Cut (${getShortcutDisplay('cut')})`}
      >
        Cut
      </button>
      <button
        onClick={onPaste}
        className={`${buttonClass} ${!hasClipboard ? 'opacity-50' : ''}`}
        disabled={!hasClipboard}
        title={`Paste (${getShortcutDisplay('paste')})`}
      >
        Paste
      </button>

      <Divider />

      {/* Z-ordering */}
      {selectedElement && (
        <>
          <button
            onClick={onBringToFront}
            className={buttonClass}
            title="Bring to front (Ctrl+Shift+])"
          >
            ⬆⬆
          </button>
          <button
            onClick={onBringForward}
            className={buttonClass}
            title="Bring forward (Ctrl+])"
          >
            ⬆
          </button>
          <button
            onClick={onSendBackward}
            className={buttonClass}
            title="Send backward (Ctrl+[)"
          >
            ⬇
          </button>
          <button
            onClick={onSendToBack}
            className={buttonClass}
            title="Send to back (Ctrl+Shift+[)"
          >
            ⬇⬇
          </button>
          <Divider />
        </>
      )}

      {/* Alignment tools (when multiple selected) */}
      {multipleSelected && (
        <>
          <button
            onClick={() => onAlignElements('left')}
            className={buttonClass}
            title="Align left"
          >
            ⫷
          </button>
          <button
            onClick={() => onAlignElements('center')}
            className={buttonClass}
            title="Align center"
          >
            ⫿
          </button>
          <button
            onClick={() => onAlignElements('right')}
            className={buttonClass}
            title="Align right"
          >
            ⫸
          </button>
          <button
            onClick={() => onAlignElements('top')}
            className={buttonClass}
            title="Align top"
          >
            ⫠
          </button>
          <button
            onClick={() => onAlignElements('middle')}
            className={buttonClass}
            title="Align middle"
          >
            ⫟
          </button>
          <button
            onClick={() => onAlignElements('bottom')}
            className={buttonClass}
            title="Align bottom"
          >
            ⫡
          </button>
          <Divider />
        </>
      )}

      {/* Text/Shape formatting */}
      {isTextOrShape && selectedElement && (
        <>
          {/* Font Family */}
          <select
            value={selectedElement.style?.fontFamily || 'Arial'}
            onChange={(e) =>
              onUpdateElement({
                style: { ...selectedElement.style, fontFamily: e.target.value },
              })
            }
            className={selectClass}
          >
            {FONTS.map((font) => (
              <option key={font} value={font} style={{ fontFamily: font }}>
                {font}
              </option>
            ))}
          </select>

          {/* Font Size */}
          <select
            value={selectedElement.style?.fontSize || 24}
            onChange={(e) =>
              onUpdateElement({
                style: {
                  ...selectedElement.style,
                  fontSize: Number(e.target.value),
                },
              })
            }
            className={selectClass}
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>

          {/* Bold */}
          <button
            onClick={() =>
              onUpdateElement({
                style: {
                  ...selectedElement.style,
                  fontWeight:
                    selectedElement.style?.fontWeight === 'bold'
                      ? 'normal'
                      : 'bold',
                },
              })
            }
            className={`${selectedElement.style?.fontWeight === 'bold' ? buttonActiveClass : buttonClass} font-bold`}
            title={`Bold (${getShortcutDisplay('toggleBold')})`}
          >
            B
          </button>

          {/* Italic */}
          <button
            onClick={() =>
              onUpdateElement({
                style: {
                  ...selectedElement.style,
                  fontStyle:
                    selectedElement.style?.fontStyle === 'italic'
                      ? 'normal'
                      : 'italic',
                },
              })
            }
            className={`${selectedElement.style?.fontStyle === 'italic' ? buttonActiveClass : buttonClass} italic`}
            title={`Italic (${getShortcutDisplay('toggleItalic')})`}
          >
            I
          </button>

          <Divider />

          {/* List buttons */}
          <button
            onClick={() => onToggleListType('bullet')}
            className={selectedElement.listType === 'bullet' ? buttonActiveClass : buttonClass}
            title="Bullet list"
          >
            • List
          </button>
          <button
            onClick={() => onToggleListType('numbered')}
            className={selectedElement.listType === 'numbered' ? buttonActiveClass : buttonClass}
            title="Numbered list"
          >
            1. List
          </button>

          <Divider />

          {/* Text alignment */}
          <button
            onClick={() =>
              onUpdateElement({
                style: { ...selectedElement.style, textAlign: 'left' },
              })
            }
            className={selectedElement.style?.textAlign === 'left' ? buttonActiveClass : buttonClass}
            title="Align left"
          >
            Left
          </button>
          <button
            onClick={() =>
              onUpdateElement({
                style: { ...selectedElement.style, textAlign: 'center' },
              })
            }
            className={
              selectedElement.style?.textAlign === 'center' || !selectedElement.style?.textAlign
                ? buttonActiveClass
                : buttonClass
            }
            title="Align center"
          >
            Center
          </button>
          <button
            onClick={() =>
              onUpdateElement({
                style: { ...selectedElement.style, textAlign: 'right' },
              })
            }
            className={selectedElement.style?.textAlign === 'right' ? buttonActiveClass : buttonClass}
            title="Align right"
          >
            Right
          </button>

          <Divider />

          {/* Colors */}
          <label className="flex items-center gap-1 text-xs">
            Text:
            <input
              type="color"
              value={selectedElement.style?.color || '#ffffff'}
              onChange={(e) =>
                onUpdateElement({
                  style: { ...selectedElement.style, color: e.target.value },
                })
              }
              className="w-[30px] h-6 border border-slate-600 rounded cursor-pointer"
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            Fill:
            <input
              type="color"
              value={selectedElement.style?.backgroundColor && selectedElement.style.backgroundColor !== 'transparent' ? selectedElement.style.backgroundColor : '#3b82f6'}
              onChange={(e) =>
                onUpdateElement({
                  style: {
                    ...selectedElement.style,
                    backgroundColor: e.target.value,
                  },
                })
              }
              className="w-[30px] h-6 border border-slate-600 rounded cursor-pointer"
            />
          </label>
        </>
      )}

      {/* Line/Arrow formatting */}
      {isLineOrArrow && selectedElement && (
        <>
          <Divider />
          {/* Stroke width */}
          <select
            value={selectedElement.style?.strokeWidth || 2}
            onChange={(e) =>
              onUpdateElement({
                style: {
                  ...selectedElement.style,
                  strokeWidth: Number(e.target.value),
                },
              })
            }
            className={selectClass}
            title="Line thickness"
          >
            <option value={1}>1px</option>
            <option value={2}>2px</option>
            <option value={3}>3px</option>
            <option value={4}>4px</option>
            <option value={6}>6px</option>
            <option value={8}>8px</option>
          </select>

          {/* Stroke style */}
          <select
            value={selectedElement.style?.strokeStyle || 'solid'}
            onChange={(e) =>
              onUpdateElement({
                style: {
                  ...selectedElement.style,
                  strokeStyle: e.target.value as 'solid' | 'dashed' | 'dotted',
                },
              })
            }
            className={selectClass}
            title="Line style"
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>

          {/* Stroke color */}
          <label className="flex items-center gap-1 text-xs">
            Color:
            <input
              type="color"
              value={selectedElement.style?.strokeColor || '#ffffff'}
              onChange={(e) =>
                onUpdateElement({
                  style: {
                    ...selectedElement.style,
                    strokeColor: e.target.value,
                  },
                })
              }
              className="w-[30px] h-6 border border-slate-600 rounded cursor-pointer"
            />
          </label>

          {/* Arrow head options (only for arrows) */}
          {selectedElement.type === 'arrow' && (
            <select
              value={selectedElement.arrowHead || 'end'}
              onChange={(e) =>
                onUpdateElement({
                  arrowHead: e.target.value as 'none' | 'start' | 'end' | 'both',
                })
              }
              className={selectClass}
              title="Arrow head position"
            >
              <option value="end">Arrow → End</option>
              <option value="start">Arrow ← Start</option>
              <option value="both">Arrow ↔ Both</option>
              <option value="none">No Arrow</option>
            </select>
          )}
        </>
      )}

      {/* Delete button */}
      {selectedElement && (
        <>
          <Divider />
          <button
            onClick={onDelete}
            className="bg-red-600 py-1.5 px-3 border border-red-600 rounded text-white cursor-pointer text-xs hover:bg-red-500 transition-colors"
            title={`Delete (${getShortcutDisplay('delete')})`}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
};

// Helper components
const Divider: React.FC = () => (
  <div className="w-px h-6 bg-slate-600 mx-1" />
);

interface ButtonWithShortcutProps {
  label: string;
  shortcut: string;
  onClick: () => void;
}

const ButtonWithShortcut: React.FC<ButtonWithShortcutProps> = ({
  label,
  shortcut,
  onClick,
}) => {
  const shortcutDisplay = getShortcutDisplay(shortcut);
  return (
    <button
      onClick={onClick}
      className={buttonClass}
      title={shortcutDisplay ? `${label} (${shortcutDisplay})` : label}
    >
      {label}
    </button>
  );
};
