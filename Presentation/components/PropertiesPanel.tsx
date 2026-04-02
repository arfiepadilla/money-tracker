// Properties Panel Component - Right sidebar for slide and element properties

import React from 'react';
import { Slide, SlideElement, GridSettings } from '../types';
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from '../constants';

interface PropertiesPanelProps {
  currentSlide: Slide;
  selectedElement: SlideElement | null;
  zoom: number;
  gridSettings: GridSettings;
  onSlideBackgroundChange: (color: string) => void;
  onZoomChange: (zoom: number) => void;
  onGridSettingsChange: (settings: Partial<GridSettings>) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  currentSlide,
  selectedElement,
  zoom,
  gridSettings,
  onSlideBackgroundChange,
  onZoomChange,
  onGridSettingsChange,
}) => {
  return (
    <div className="w-[200px] bg-[#252525] border-l border-slate-600 overflow-auto p-2.5">
      {/* Slide Properties */}
      <SectionHeader title="Slide Properties" />

      <PropertyRow label="Background:">
        <input
          type="color"
          value={currentSlide.background}
          onChange={(e) => onSlideBackgroundChange(e.target.value)}
          className="w-full h-[30px] mt-1 border border-slate-600 rounded cursor-pointer"
        />
      </PropertyRow>

      {/* View Settings */}
      <SectionHeader title="View" />

      <PropertyRow label={`Zoom: ${Math.round(zoom * 100)}%`}>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={ZOOM_STEP}
          value={zoom}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          className="w-full mt-1"
        />
      </PropertyRow>

      {/* Grid Settings */}
      <SectionHeader title="Grid" />

      <PropertyRow label="">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={gridSettings.visible}
            onChange={(e) =>
              onGridSettingsChange({ visible: e.target.checked })
            }
          />
          Show grid
        </label>
      </PropertyRow>

      <PropertyRow label="">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={gridSettings.snapToGrid}
            onChange={(e) =>
              onGridSettingsChange({ snapToGrid: e.target.checked })
            }
          />
          Snap to grid
        </label>
      </PropertyRow>

      <PropertyRow label="Grid size:">
        <select
          value={gridSettings.gridSize}
          onChange={(e) =>
            onGridSettingsChange({ gridSize: Number(e.target.value) })
          }
          className="w-full mt-1 bg-slate-700 border border-slate-600 rounded text-white p-1 text-xs"
        >
          <option value={5}>5px</option>
          <option value={10}>10px</option>
          <option value={20}>20px</option>
          <option value={40}>40px</option>
        </select>
      </PropertyRow>

      {/* Element Properties (when selected) */}
      {selectedElement && (
        <>
          <SectionHeader title="Element Properties" />
          <ElementProperties element={selectedElement} />
        </>
      )}
    </div>
  );
};

// Section header component
interface SectionHeaderProps {
  title: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ title }) => (
  <h4 className="mt-4 mb-2.5 text-sm text-slate-500 border-b border-slate-600 pb-1">
    {title}
  </h4>
);

// Property row component
interface PropertyRowProps {
  label: string;
  children: React.ReactNode;
}

const PropertyRow: React.FC<PropertyRowProps> = ({ label, children }) => (
  <label className="block mb-2.5 text-xs">
    {label}
    {children}
  </label>
);

// Element properties display
interface ElementPropertiesProps {
  element: SlideElement;
}

const ElementProperties: React.FC<ElementPropertiesProps> = ({ element }) => (
  <div className="text-xs text-slate-500">
    <PropertyInfo label="Type" value={element.type} />
    <PropertyInfo label="X" value={`${Math.round(element.x)}px`} />
    <PropertyInfo label="Y" value={`${Math.round(element.y)}px`} />
    <PropertyInfo label="Width" value={`${Math.round(element.width)}px`} />
    <PropertyInfo label="Height" value={`${Math.round(element.height)}px`} />
    {element.style?.fontFamily && (
      <PropertyInfo label="Font" value={element.style.fontFamily} />
    )}
    {element.style?.fontSize && (
      <PropertyInfo label="Size" value={`${element.style.fontSize}px`} />
    )}
    {element.shapeType && (
      <PropertyInfo label="Shape" value={element.shapeType} />
    )}
    {element.zIndex !== undefined && (
      <PropertyInfo label="Z-Index" value={element.zIndex.toString()} />
    )}
  </div>
);

// Property info line
interface PropertyInfoProps {
  label: string;
  value: string;
}

const PropertyInfo: React.FC<PropertyInfoProps> = ({ label, value }) => (
  <div className="flex justify-between py-0.5">
    <span className="text-slate-500">{label}:</span>
    <span className="text-slate-400">{value}</span>
  </div>
);
