// Slide Editor Component - Main canvas area for editing slides

import React, { useRef, useCallback } from 'react';
import { Slide, SlideElement, GridSettings } from '../types';
import { SLIDE_WIDTH, SLIDE_HEIGHT, DEFAULT_COLORS } from '../constants';
import { ElementRenderer } from './ElementRenderer';
import { sortByZIndex } from '../utils';

interface SlideEditorProps {
  slide: Slide;
  selectedElements: string[];
  editingElement: string | null;
  zoom: number;
  gridSettings: GridSettings;
  isDragging: boolean;
  isResizing: boolean;
  onElementSelect: (elementId: string, addToSelection?: boolean) => void;
  onElementDeselect: () => void;
  onElementDoubleClick: (elementId: string) => void;
  onDragStart: (e: React.MouseEvent, elementId: string) => void;
  onResizeStart: (e: React.MouseEvent, handle: string) => void;
  onContentChange: (elementId: string, content: string) => void;
  onEditEnd: () => void;
  slideRef: React.RefObject<HTMLDivElement>;
}

export const SlideEditor: React.FC<SlideEditorProps> = ({
  slide,
  selectedElements,
  editingElement,
  zoom,
  gridSettings,
  isDragging,
  isResizing,
  onElementSelect,
  onElementDeselect,
  onElementDoubleClick,
  onDragStart,
  onResizeStart,
  onContentChange,
  onEditEnd,
  slideRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click on canvas background
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      // Only deselect if clicking directly on the canvas, not on an element
      if (e.target === e.currentTarget) {
        onElementDeselect();
      }
    },
    [onElementDeselect]
  );

  // Handle element mouse down with modifier key support
  const handleElementMouseDown = useCallback(
    (e: React.MouseEvent, elementId: string) => {
      e.stopPropagation();
      const addToSelection = e.shiftKey || e.ctrlKey || e.metaKey;
      onElementSelect(elementId, addToSelection);
      onDragStart(e, elementId);
    },
    [onElementSelect, onDragStart]
  );

  // Sort elements by z-index for rendering
  const sortedElements = sortByZIndex(slide.elements);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto flex items-center justify-center p-5 bg-slate-900"
      onClick={handleCanvasClick}
    >
      <div
        ref={slideRef}
        className="relative shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
        style={{
          width: SLIDE_WIDTH,
          height: SLIDE_HEIGHT,
          background: slide.background,
          transform: `scale(${zoom})`,
          transformOrigin: 'center center',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grid overlay */}
        {gridSettings.visible && (
          <GridOverlay gridSize={gridSettings.gridSize} />
        )}

        {/* Render elements */}
        {sortedElements.map((element) => (
          <ElementRenderer
            key={element.id}
            element={element}
            isSelected={selectedElements.includes(element.id)}
            isEditing={editingElement === element.id}
            isDragging={isDragging && selectedElements.includes(element.id)}
            showResizeHandles={
              selectedElements.includes(element.id) &&
              selectedElements.length === 1
            }
            zoom={zoom}
            onMouseDown={handleElementMouseDown}
            onDoubleClick={onElementDoubleClick}
            onResizeStart={onResizeStart}
            onContentChange={onContentChange}
            onEditEnd={onEditEnd}
          />
        ))}

        {/* Selection box for multiple elements */}
        {selectedElements.length > 1 && (
          <MultiSelectionBox
            elements={slide.elements.filter((el) =>
              selectedElements.includes(el.id)
            )}
          />
        )}
      </div>
    </div>
  );
};

// Grid overlay component
interface GridOverlayProps {
  gridSize: number;
}

const GridOverlay: React.FC<GridOverlayProps> = ({ gridSize }) => {
  const patternId = `grid-${gridSize}`;

  return (
    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
      <defs>
        <pattern
          id={patternId}
          width={gridSize}
          height={gridSize}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
            fill="none"
            stroke={DEFAULT_COLORS.grid}
            strokeWidth="0.5"
            opacity="0.5"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
};

// Multi-selection bounding box
interface MultiSelectionBoxProps {
  elements: SlideElement[];
}

const MultiSelectionBox: React.FC<MultiSelectionBoxProps> = ({ elements }) => {
  if (elements.length < 2) return null;

  const minX = Math.min(...elements.map((el) => el.x));
  const minY = Math.min(...elements.map((el) => el.y));
  const maxX = Math.max(...elements.map((el) => el.x + el.width));
  const maxY = Math.max(...elements.map((el) => el.y + el.height));

  return (
    <div
      className="absolute border-2 border-dashed border-blue-500 pointer-events-none box-border"
      style={{
        left: minX - 2,
        top: minY - 2,
        width: maxX - minX + 4,
        height: maxY - minY + 4,
      }}
    />
  );
};

// Presentation mode slide display
interface PresentationSlideProps {
  slide: Slide;
  onExit: () => void;
  onPrevSlide: () => void;
  onNextSlide: () => void;
  currentIndex: number;
  totalSlides: number;
}

export const PresentationSlide: React.FC<PresentationSlideProps> = ({
  slide,
  currentIndex,
  totalSlides,
}) => {
  const sortedElements = sortByZIndex(slide.elements);

  return (
    <div
      className="w-full h-full relative"
      style={{
        maxWidth: `${(SLIDE_WIDTH / SLIDE_HEIGHT) * 100}vh`,
        maxHeight: `${(SLIDE_HEIGHT / SLIDE_WIDTH) * 100}vw`,
        background: slide.background,
      }}
    >
      {sortedElements.map((el) => (
        <div
          key={el.id}
          className="absolute flex box-border"
          style={{
            left: `${(el.x / SLIDE_WIDTH) * 100}%`,
            top: `${(el.y / SLIDE_HEIGHT) * 100}%`,
            width: `${(el.width / SLIDE_WIDTH) * 100}%`,
            height: `${(el.height / SLIDE_HEIGHT) * 100}%`,
            alignItems: el.type === 'image' ? 'stretch' : 'center',
            justifyContent:
              el.style?.textAlign === 'left'
                ? 'flex-start'
                : el.style?.textAlign === 'right'
                ? 'flex-end'
                : 'center',
            fontSize: `${((el.style?.fontSize || 24) / SLIDE_WIDTH) * 100}vw`,
            fontFamily: el.style?.fontFamily || 'Arial',
            fontWeight: el.style?.fontWeight || 'normal',
            fontStyle: el.style?.fontStyle || 'normal',
            color: el.style?.color || '#fff',
            backgroundColor:
              el.type === 'image'
                ? 'transparent'
                : el.style?.backgroundColor || 'transparent',
            borderRadius:
              el.type === 'shape' && el.shapeType === 'ellipse' ? '50%' : 0,
            clipPath:
              el.type === 'shape' && el.shapeType === 'triangle'
                ? 'polygon(50% 0%, 0% 100%, 100% 100%)'
                : undefined,
            padding: el.type === 'image' ? 0 : '1%',
            textAlign: el.style?.textAlign || 'center',
            zIndex: el.zIndex || 0,
          }}
        >
          {el.type === 'image' ? (
            <img
              src={el.imageUrl}
              alt=""
              className="w-full h-full object-contain"
            />
          ) : (
            <span className="whitespace-pre-wrap leading-[1.4]">
              {el.content}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
