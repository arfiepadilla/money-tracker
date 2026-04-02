// Element Renderer Component - Renders individual slide elements with selection and resize handles

import React, { useCallback } from 'react';
import { SlideElement } from '../types';
import { RESIZE_HANDLES, RESIZE_HANDLE_CLASSES, DEFAULT_COLORS, DEFAULT_LINE_WIDTH, DEFAULT_ARROW_SIZE } from '../constants';

interface ElementRendererProps {
  element: SlideElement;
  isSelected: boolean;
  isEditing: boolean;
  isDragging: boolean;
  showResizeHandles: boolean;
  zoom?: number;
  onMouseDown: (e: React.MouseEvent, elementId: string) => void;
  onDoubleClick: (elementId: string) => void;
  onResizeStart: (e: React.MouseEvent, handle: string) => void;
  onContentChange: (elementId: string, content: string) => void;
  onEditEnd: () => void;
}

export const ElementRenderer: React.FC<ElementRendererProps> = ({
  element,
  isSelected,
  isEditing,
  isDragging,
  showResizeHandles,
  zoom = 1,
  onMouseDown,
  onDoubleClick,
  onResizeStart,
  onContentChange,
  onEditEnd,
}) => {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEditEnd();
      }
      e.stopPropagation();
    },
    [onEditEnd]
  );

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onContentChange(element.id, e.target.value);
    },
    [element.id, onContentChange]
  );

  // Build element className (static and conditional Tailwind classes)
  const baseClassName = `
    absolute
    flex
    box-border
    overflow-hidden
    select-none
    ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}
    ${element.type === 'image' ? 'items-stretch' : 'items-center'}
    ${element.style?.textAlign === 'left'
      ? 'justify-start'
      : element.style?.textAlign === 'right'
      ? 'justify-end'
      : 'justify-center'}
    ${element.type === 'shape' && element.shapeType === 'ellipse' ? 'rounded-full' : ''}
    ${element.type === 'image' ? 'p-0' : 'p-2'}
  `.trim();

  // Build element inline styles (dynamic values only)
  const baseStyle = {
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    zIndex: element.zIndex || 0,
    fontSize: element.style?.fontSize || 24,
    fontFamily: element.style?.fontFamily || 'Arial',
    fontWeight: element.style?.fontWeight || 'normal',
    fontStyle: element.style?.fontStyle || 'normal',
    color: element.style?.color || '#fff',
    backgroundColor:
      element.type === 'image'
        ? 'transparent'
        : element.style?.backgroundColor || 'transparent',
    textAlign: element.style?.textAlign || 'center',
    outline: isSelected ? `2px solid ${DEFAULT_COLORS.selection}` : 'none',
    ...(element.type === 'shape' && element.shapeType === 'triangle'
      ? { clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }
      : {}),
  };

  // Render line or arrow element
  if (element.type === 'line' || element.type === 'arrow') {
    return (
      <LineArrowElement
        element={element}
        isSelected={isSelected}
        showResizeHandles={showResizeHandles}
        isDragging={isDragging}
        onMouseDown={onMouseDown}
        onResizeStart={onResizeStart}
      />
    );
  }

  // Render image element
  if (element.type === 'image') {
    return (
      <div
        className={baseClassName}
        style={baseStyle}
        onMouseDown={(e) => onMouseDown(e, element.id)}
        onDoubleClick={() => onDoubleClick(element.id)}
      >
        <img
          src={element.imageUrl}
          alt=""
          className="w-full h-full object-contain pointer-events-none"
          draggable={false}
        />
        {isSelected && showResizeHandles && (
          <ResizeHandles onResizeStart={onResizeStart} />
        )}
      </div>
    );
  }

  // Render text/shape element
  return (
    <div
      className={baseClassName}
      style={baseStyle}
      onMouseDown={(e) => onMouseDown(e, element.id)}
      onDoubleClick={() => onDoubleClick(element.id)}
    >
      {isEditing ? (
        <textarea
          autoFocus
          value={element.content || ''}
          onChange={handleContentChange}
          onBlur={onEditEnd}
          onKeyDown={handleKeyDown}
          className="w-full h-full bg-transparent border-none outline-none resize-none p-0 leading-[1.4]"
          style={{
            fontSize: 'inherit',
            fontFamily: 'inherit',
            fontWeight: 'inherit',
            fontStyle: 'inherit',
            color: 'inherit',
            textAlign: element.style?.textAlign || 'center',
          }}
        />
      ) : (
        <span className="whitespace-pre-wrap break-words leading-[1.4] pointer-events-none">
          {element.content}
        </span>
      )}

      {isSelected && showResizeHandles && !isEditing && (
        <ResizeHandles onResizeStart={onResizeStart} />
      )}
    </div>
  );
};

// Line/Arrow element component
interface LineArrowElementProps {
  element: SlideElement;
  isSelected: boolean;
  showResizeHandles: boolean;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent, elementId: string) => void;
  onResizeStart: (e: React.MouseEvent, handle: string) => void;
}

const LineArrowElement: React.FC<LineArrowElementProps> = ({
  element,
  isSelected,
  showResizeHandles,
  isDragging,
  onMouseDown,
  onResizeStart,
}) => {
  const strokeColor = element.style?.strokeColor || DEFAULT_COLORS.line;
  const strokeWidth = element.style?.strokeWidth || DEFAULT_LINE_WIDTH;
  const strokeStyle = element.style?.strokeStyle || 'solid';
  const arrowSize = DEFAULT_ARROW_SIZE;

  // Calculate line points (from top-left to bottom-right of bounding box by default)
  const startX = element.startPoint?.x ?? 0;
  const startY = element.startPoint?.y ?? 0;
  const endX = element.endPoint?.x ?? element.width;
  const endY = element.endPoint?.y ?? element.height;

  // Calculate stroke dash array for different stroke styles
  const getStrokeDashArray = () => {
    switch (strokeStyle) {
      case 'dashed':
        return `${strokeWidth * 4},${strokeWidth * 2}`;
      case 'dotted':
        return `${strokeWidth},${strokeWidth * 2}`;
      default:
        return 'none';
    }
  };

  // Calculate arrow head points
  const calculateArrowHead = (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): string => {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const arrowAngle = Math.PI / 6; // 30 degrees

    const x1 = toX - arrowSize * Math.cos(angle - arrowAngle);
    const y1 = toY - arrowSize * Math.sin(angle - arrowAngle);
    const x2 = toX - arrowSize * Math.cos(angle + arrowAngle);
    const y2 = toY - arrowSize * Math.sin(angle + arrowAngle);

    return `M ${toX} ${toY} L ${x1} ${y1} M ${toX} ${toY} L ${x2} ${y2}`;
  };

  // Add some padding to the bounding box for easier selection
  const padding = Math.max(strokeWidth * 2, 8);

  return (
    <div
      className="absolute select-none"
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        cursor: isDragging ? 'grabbing' : 'grab',
        zIndex: element.zIndex || 0,
      }}
      onMouseDown={(e) => onMouseDown(e, element.id)}
    >
      <svg
        width={element.width}
        height={element.height}
        className="absolute top-0 left-0 overflow-visible"
      >
        {/* Invisible wider stroke for easier selection */}
        <line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke="transparent"
          strokeWidth={padding * 2}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        />

        {/* Main line */}
        <line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={getStrokeDashArray()}
          strokeLinecap="round"
        />

        {/* Arrow heads */}
        {element.type === 'arrow' && (element.arrowHead === 'end' || element.arrowHead === 'both') && (
          <path
            d={calculateArrowHead(startX, startY, endX, endY)}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {element.type === 'arrow' && (element.arrowHead === 'start' || element.arrowHead === 'both') && (
          <path
            d={calculateArrowHead(endX, endY, startX, startY)}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {/* Selection outline */}
      {isSelected && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: -2,
            left: -2,
            right: -2,
            bottom: -2,
            border: `2px solid ${DEFAULT_COLORS.selection}`,
          }}
        />
      )}

      {/* Endpoint handles for lines/arrows */}
      {isSelected && showResizeHandles && (
        <>
          {/* Start point handle */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeStart(e, 'line-start');
            }}
            className="absolute w-2.5 h-2.5 rounded-full border border-white cursor-move"
            style={{
              left: startX - 5,
              top: startY - 5,
              background: DEFAULT_COLORS.selection,
            }}
          />
          {/* End point handle */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeStart(e, 'line-end');
            }}
            className="absolute w-2.5 h-2.5 rounded-full border border-white cursor-move"
            style={{
              left: endX - 5,
              top: endY - 5,
              background: DEFAULT_COLORS.selection,
            }}
          />
        </>
      )}
    </div>
  );
};

// Resize handles component
interface ResizeHandlesProps {
  onResizeStart: (e: React.MouseEvent, handle: string) => void;
}

const ResizeHandles: React.FC<ResizeHandlesProps> = ({ onResizeStart }) => (
  <>
    {RESIZE_HANDLES.map((handle) => (
      <div
        key={handle}
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart(e, handle);
        }}
        className={`absolute w-2 h-2 border border-white ${RESIZE_HANDLE_CLASSES[handle]}`}
        style={{ background: DEFAULT_COLORS.selection }}
      />
    ))}
  </>
);

// Presentation mode renderer (simpler, no interaction)
interface PresentationElementProps {
  element: SlideElement;
  slideWidth: number;
  slideHeight: number;
}

export const PresentationElement: React.FC<PresentationElementProps> = ({
  element,
  slideWidth,
  slideHeight,
}) => {
  const className = `
    absolute
    flex
    box-border
    ${element.type === 'image' ? 'items-stretch' : 'items-center'}
    ${element.style?.textAlign === 'left'
      ? 'justify-start'
      : element.style?.textAlign === 'right'
      ? 'justify-end'
      : 'justify-center'}
    ${element.type === 'shape' && element.shapeType === 'ellipse' ? 'rounded-full' : ''}
  `.trim();

  const style = {
    left: `${(element.x / slideWidth) * 100}%`,
    top: `${(element.y / slideHeight) * 100}%`,
    width: `${(element.width / slideWidth) * 100}%`,
    height: `${(element.height / slideHeight) * 100}%`,
    fontSize: `${((element.style?.fontSize || 24) / slideWidth) * 100}vw`,
    fontFamily: element.style?.fontFamily || 'Arial',
    fontWeight: element.style?.fontWeight || 'normal',
    fontStyle: element.style?.fontStyle || 'normal',
    color: element.style?.color || '#fff',
    backgroundColor:
      element.type === 'image'
        ? 'transparent'
        : element.style?.backgroundColor || 'transparent',
    textAlign: element.style?.textAlign || 'center',
    zIndex: element.zIndex || 0,
    padding: element.type === 'image' ? 0 : '1%',
    ...(element.type === 'shape' && element.shapeType === 'triangle'
      ? { clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }
      : {}),
  };

  if (element.type === 'image') {
    return (
      <div className={className} style={style}>
        <img
          src={element.imageUrl}
          alt=""
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  return (
    <div className={className} style={style}>
      <span className="whitespace-pre-wrap leading-[1.4]">
        {element.content}
      </span>
    </div>
  );
};

// Thumbnail renderer (simplified for slide panel)
interface ThumbnailElementProps {
  element: SlideElement;
}

export const ThumbnailElement: React.FC<ThumbnailElementProps> = ({
  element,
}) => {
  const style = {
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    backgroundColor:
      element.type === 'image'
        ? 'transparent'
        : element.style?.backgroundColor || 'transparent',
    borderRadius: element.shapeType === 'ellipse' ? '50%' : 0,
    clipPath: element.shapeType === 'triangle'
      ? 'polygon(50% 0%, 0% 100%, 100% 100%)'
      : undefined,
    zIndex: element.zIndex || 0,
  };

  if (element.type === 'image' && element.imageUrl) {
    return (
      <div className="absolute overflow-hidden" style={style}>
        <img
          src={element.imageUrl}
          alt=""
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  // Render line/arrow in thumbnail
  if (element.type === 'line' || element.type === 'arrow') {
    const strokeColor = element.style?.strokeColor || DEFAULT_COLORS.line;
    const strokeWidth = element.style?.strokeWidth || DEFAULT_LINE_WIDTH;
    const startX = element.startPoint?.x ?? 0;
    const startY = element.startPoint?.y ?? 0;
    const endX = element.endPoint?.x ?? element.width;
    const endY = element.endPoint?.y ?? element.height;

    return (
      <div className="absolute overflow-hidden" style={{ ...style, backgroundColor: 'transparent' }}>
        <svg width={element.width} height={element.height} className="overflow-visible">
          <line
            x1={startX}
            y1={startY}
            x2={endX}
            y2={endY}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
          {element.type === 'arrow' && (element.arrowHead === 'end' || element.arrowHead === 'both') && (
            <ThumbnailArrowHead
              fromX={startX}
              fromY={startY}
              toX={endX}
              toY={endY}
              color={strokeColor}
              strokeWidth={strokeWidth}
            />
          )}
        </svg>
      </div>
    );
  }

  return <div className="absolute overflow-hidden" style={style} />;
};

// Helper component for thumbnail arrow heads
const ThumbnailArrowHead: React.FC<{
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  strokeWidth: number;
}> = ({ fromX, fromY, toX, toY, color, strokeWidth }) => {
  const arrowSize = DEFAULT_ARROW_SIZE * 0.6; // Smaller for thumbnails
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const arrowAngle = Math.PI / 6;

  const x1 = toX - arrowSize * Math.cos(angle - arrowAngle);
  const y1 = toY - arrowSize * Math.sin(angle - arrowAngle);
  const x2 = toX - arrowSize * Math.cos(angle + arrowAngle);
  const y2 = toY - arrowSize * Math.sin(angle + arrowAngle);

  return (
    <path
      d={`M ${toX} ${toY} L ${x1} ${y1} M ${toX} ${toY} L ${x2} ${y2}`}
      stroke={color}
      strokeWidth={strokeWidth}
      fill="none"
    />
  );
};
