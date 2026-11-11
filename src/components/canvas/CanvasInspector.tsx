'use client';

import React from 'react';
import {
  ArrowUpRight,
  BoxSelect,
  Lock,
  MousePointer2,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import type { CanvasTool } from './canvasGeometry';

export interface CanvasInspectorProps {
  tool: CanvasTool;
  arrowStartNodeId: string | null;
  selectedId: string | null;
  disabled: boolean;
  authLoading: boolean;
  hasEdges: boolean;
  hasElements: boolean;
  showFlowLabels: boolean;
  onSelectTool: (tool: CanvasTool) => void;
  onToggleFlowLabels: () => void;
  onDeleteSelected: () => void;
  onClearAll: () => void;
}

export default function CanvasInspector({
  tool,
  arrowStartNodeId,
  selectedId,
  disabled,
  authLoading,
  hasEdges,
  hasElements,
  showFlowLabels,
  onSelectTool,
  onToggleFlowLabels,
  onDeleteSelected,
  onClearAll,
}: CanvasInspectorProps) {
  return (
    <div className="scrollbar-none h-12 flex items-center justify-between gap-3 px-4 bg-app border-b border-hairline text-sm overflow-x-auto">
      <div
        className={`flex items-center gap-0.5 shrink-0 ${
          disabled ? 'opacity-40 pointer-events-none select-none grayscale' : ''
        }`}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelectTool('select')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors cursor-pointer ${
            tool === 'select' && !arrowStartNodeId
              ? 'bg-subtle text-ink font-medium'
              : 'text-secondary hover:text-ink hover:bg-subtle/60'
          }`}
          title="Select & Move (V)"
        >
          <MousePointer2 className="w-3.5 h-3.5" />
          <span>Select</span>
          <kbd className="hidden sm:inline text-[10px] font-mono text-muted">V</kbd>
        </button>

        <button
          type="button"
          onClick={() => onSelectTool('box')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors cursor-pointer ${
            tool === 'box'
              ? 'bg-subtle text-ink font-medium'
              : 'text-secondary hover:text-ink hover:bg-subtle/60'
          }`}
          title="Add Component Box (B)"
        >
          <Square className="w-3.5 h-3.5" />
          <span>Box</span>
          <kbd className="hidden sm:inline text-[10px] font-mono text-muted">B</kbd>
        </button>

        <button
          type="button"
          onClick={() => onSelectTool('arrow')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors cursor-pointer ${
            tool === 'arrow' || arrowStartNodeId
              ? 'bg-subtle text-ink font-medium'
              : 'text-secondary hover:text-ink hover:bg-subtle/60'
          }`}
          title="Connect Directed Arrow (C)"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>{arrowStartNodeId ? 'Select target...' : 'Connect'}</span>
          {!arrowStartNodeId && (
            <kbd className="hidden sm:inline text-[10px] font-mono text-muted">C</kbd>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectTool('boundary')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors cursor-pointer ${
            tool === 'boundary'
              ? 'bg-subtle text-ink font-medium'
              : 'text-secondary hover:text-ink hover:bg-subtle/60'
          }`}
          title="Add Grouping Frame (G)"
        >
          <BoxSelect className="w-3.5 h-3.5" />
          <span>Frame</span>
          <kbd className="hidden sm:inline text-[10px] font-mono text-muted">G</kbd>
        </button>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {disabled && !authLoading ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-subtle border border-hairline text-[11px] font-mono text-muted select-none">
            <Lock className="w-3 h-3" />
            <span>Locked</span>
          </span>
        ) : (
          <>
            {hasEdges && (
              <button
                type="button"
                onClick={onToggleFlowLabels}
                className={`px-2 py-1 rounded text-[11px] transition-colors cursor-pointer ${
                  showFlowLabels
                    ? 'bg-subtle text-ink font-medium'
                    : 'text-muted hover:text-ink'
                }`}
                title="Show or hide directional flow labels on arrows"
              >
                {showFlowLabels ? 'Hide labels' : 'Show labels'}
              </button>
            )}
            {selectedId && (
              <button
                type="button"
                onClick={onDeleteSelected}
                className="flex items-center gap-1 px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                title="Delete Selected (Del)"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            )}
            {hasElements && (
              <button
                type="button"
                onClick={onClearAll}
                className="flex items-center gap-1 px-2 py-1 rounded text-secondary hover:text-ink hover:bg-subtle transition-colors cursor-pointer"
                title="Clear Diagram"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
