// Notes Panel Component - Speaker notes editor

import React, { useCallback } from 'react';

interface NotesPanelProps {
  notes: string;
  isExpanded: boolean;
  onNotesChange: (notes: string) => void;
  onToggleExpand: () => void;
}

export const NotesPanel: React.FC<NotesPanelProps> = ({
  notes,
  isExpanded,
  onNotesChange,
  onToggleExpand,
}) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onNotesChange(e.target.value);
    },
    [onNotesChange]
  );

  return (
    <div className="bg-slate-800 border-t border-slate-600 flex flex-col transition-[height] duration-200">
      {/* Header */}
      <div
        className="flex items-center justify-between py-1.5 px-3 cursor-pointer select-none"
        onClick={onToggleExpand}
      >
        <span className="text-xs text-slate-500 font-medium">
          Speaker Notes
          {notes && notes.trim() && (
            <span className="ml-2 text-amber-400">●</span>
          )}
        </span>
        <span
          className={`text-[10px] text-slate-500 transition-transform duration-200 ${
            isExpanded ? 'rotate-180' : 'rotate-0'
          }`}
        >
          ▼
        </span>
      </div>

      {/* Notes editor */}
      {isExpanded && (
        <div className="px-3 pb-3">
          <textarea
            value={notes}
            onChange={handleChange}
            placeholder="Add speaker notes here..."
            className="w-full h-[120px] bg-slate-900 border border-slate-600 rounded text-slate-300 text-xs leading-relaxed p-2 resize-y font-inherit"
          />
          <div className="text-[10px] text-slate-500 mt-1 text-right">
            {notes.length} characters
          </div>
        </div>
      )}
    </div>
  );
};

// Presenter view notes display (read-only, larger text)
interface PresenterNotesProps {
  notes: string;
  currentSlide: number;
  totalSlides: number;
}

export const PresenterNotes: React.FC<PresenterNotesProps> = ({
  notes,
  currentSlide,
  totalSlides,
}) => (
  <div className="bg-slate-900 p-4 rounded-lg h-full overflow-auto">
    <div className="flex justify-between items-center mb-3 border-b border-slate-600 pb-2">
      <span className="text-sm text-slate-500 font-medium">
        Speaker Notes
      </span>
      <span className="text-xs text-slate-500">
        Slide {currentSlide} of {totalSlides}
      </span>
    </div>
    {notes && notes.trim() ? (
      <div className="text-base text-slate-300 leading-relaxed whitespace-pre-wrap">
        {notes}
      </div>
    ) : (
      <div className="text-sm text-slate-500 italic">
        No notes for this slide.
      </div>
    )}
  </div>
);
