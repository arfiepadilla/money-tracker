// Slide Panel Component - Left sidebar with slide thumbnails and management

import React, { useCallback, useState } from 'react';
import { Slide } from '../types';
import { SLIDE_WIDTH, SLIDE_HEIGHT, buttonClass } from '../constants';
import { ThumbnailElement } from './ElementRenderer';

interface SlidePanelProps {
  slides: Slide[];
  currentSlideIndex: number;
  onSlideSelect: (index: number) => void;
  onAddSlide: () => void;
  onDuplicateSlide: () => void;
  onDeleteSlide: () => void;
  onReorderSlides?: (fromIndex: number, toIndex: number) => void;
}

export const SlidePanel: React.FC<SlidePanelProps> = ({
  slides,
  currentSlideIndex,
  onSlideSelect,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onReorderSlides,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      setDraggedIndex(index);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const fromIndex = draggedIndex;
      setDraggedIndex(null);
      setDragOverIndex(null);

      if (fromIndex !== null && fromIndex !== toIndex && onReorderSlides) {
        onReorderSlides(fromIndex, toIndex);
      }
    },
    [draggedIndex, onReorderSlides]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  return (
    <div className="w-[160px] bg-[#252525] border-r border-slate-600 overflow-auto p-2.5 flex flex-col">
      {/* Slide thumbnails */}
      <div className="flex flex-col gap-2.5 flex-1">
        {slides.map((slide, index) => (
          <SlideThumbnail
            key={slide.id}
            slide={slide}
            index={index}
            isSelected={index === currentSlideIndex}
            isDragging={draggedIndex === index}
            isDragOver={dragOverIndex === index}
            onClick={() => onSlideSelect(index)}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            draggable={!!onReorderSlides}
          />
        ))}
      </div>

      {/* Slide management buttons */}
      <div className="mt-2.5 flex gap-1 flex-wrap">
        <button
          onClick={onAddSlide}
          className={`${buttonClass} text-[11px] py-1 px-2`}
          title="Add new slide"
        >
          + Add
        </button>
        <button
          onClick={onDuplicateSlide}
          className={`${buttonClass} text-[11px] py-1 px-2`}
          title="Duplicate current slide"
        >
          Dup
        </button>
        <button
          onClick={onDeleteSlide}
          className={`${buttonClass} text-[11px] py-1 px-2 ${slides.length <= 1 ? 'opacity-50' : ''}`}
          title="Delete current slide"
          disabled={slides.length <= 1}
        >
          Del
        </button>
      </div>
    </div>
  );
};

// Individual slide thumbnail
interface SlideThumbnailProps {
  slide: Slide;
  index: number;
  isSelected: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  draggable: boolean;
}

const SlideThumbnail: React.FC<SlideThumbnailProps> = ({
  slide,
  index,
  isSelected,
  isDragging,
  isDragOver,
  onClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  draggable,
}) => {
  const borderClass = isSelected
    ? 'border-2 border-blue-500'
    : isDragOver
    ? 'border-2 border-green-500'
    : 'border-2 border-slate-600';

  return (
    <div
      className={`relative overflow-hidden rounded transition-[border-color,opacity] duration-150 ${borderClass} ${
        isDragging ? 'opacity-50' : ''
      } ${draggable ? 'cursor-grab' : 'cursor-pointer'}`}
      style={{
        background: slide.background,
        aspectRatio: `${SLIDE_WIDTH}/${SLIDE_HEIGHT}`,
      }}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* Mini preview with scaled elements */}
      <div
        className="relative"
        style={{
          transform: 'scale(0.15)',
          transformOrigin: 'top left',
          width: SLIDE_WIDTH,
          height: SLIDE_HEIGHT,
        }}
      >
        {slide.elements.map((el) => (
          <ThumbnailElement key={el.id} element={el} />
        ))}
      </div>

      {/* Slide number */}
      <div className="absolute bottom-0.5 left-1 text-[10px] text-slate-500 bg-black/50 py-px px-1 rounded-sm">
        {index + 1}
      </div>

      {/* Notes indicator */}
      {slide.notes && slide.notes.trim() && (
        <div
          className="absolute bottom-0.5 right-1 text-[10px] text-amber-400"
          title="Has speaker notes"
        >
          📝
        </div>
      )}
    </div>
  );
};
