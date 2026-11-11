'use client';

import React, { useEffect, useRef, useState } from 'react';
import type {
  CanvasBoundary,
  CanvasEdge,
  CanvasNode,
  SimEdgeSpec,
  SimNodeSpec,
  SimulationFrame,
} from '@/types';
import { useTheme } from './ThemeProvider';
import CanvasInspector from './canvas/CanvasInspector';
import CanvasViewport from './canvas/CanvasViewport';
import type { CanvasTool } from './canvas/canvasGeometry';

export type { CanvasTool };

interface WhiteboardCanvasProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  boundaries: CanvasBoundary[];
  compiledNodes?: SimNodeSpec[];
  compiledEdges?: SimEdgeSpec[];
  disabled?: boolean;
  authLoading?: boolean;
  signingIn?: boolean;
  onSignIn?: () => void;
  onSignInDummy?: () => void;
  resizable?: boolean;
  canvasHeight?: number;
  onChangeCanvasHeight?: (height: number) => void;
  onChangeNodes: (nodes: CanvasNode[]) => void;
  onChangeEdges: (edges: CanvasEdge[]) => void;
  onChangeBoundaries: (boundaries: CanvasBoundary[]) => void;
  activeFrame: SimulationFrame | null;
  isPlaying: boolean;
}

export default function WhiteboardCanvas({
  nodes,
  edges,
  boundaries,
  compiledEdges = [],
  disabled = false,
  authLoading = false,
  signingIn = false,
  onSignIn,
  onSignInDummy,
  resizable = false,
  canvasHeight = 560,
  onChangeCanvasHeight,
  onChangeNodes,
  onChangeEdges,
  onChangeBoundaries,
  activeFrame,
  isPlaying,
}: WhiteboardCanvasProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [tool, setTool] = useState<CanvasTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [arrowStartNodeId, setArrowStartNodeId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(
    null
  );
  const [showFlowLabels, setShowFlowLabels] = useState<boolean>(true);
  const [internalHeight, setInternalHeight] = useState<number>(canvasHeight);
  const [isResizingHeight, setIsResizingHeight] = useState<boolean>(false);

  const effectiveHeight = onChangeCanvasHeight ? canvasHeight : internalHeight;
  const setHeight = (next: number) => {
    const clamped = Math.max(320, Math.min(1600, Math.round(next)));
    if (onChangeCanvasHeight) {
      onChangeCanvasHeight(clamped);
    } else {
      setInternalHeight(clamped);
    }
  };

  const resizeDragRef = useRef<{ startY: number; startHeight: number } | null>(
    null
  );
  const dragRef = useRef<{
    kind: 'node' | 'boundary';
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isResizingHeight) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const onWinMove = (ev: MouseEvent) => {
      if (!resizeDragRef.current) return;
      const deltaY = ev.clientY - resizeDragRef.current.startY;
      setHeight(resizeDragRef.current.startHeight + deltaY);
    };
    const onWinUp = () => {
      resizeDragRef.current = null;
      setIsResizingHeight(false);
    };

    window.addEventListener('mousemove', onWinMove);
    window.addEventListener('mouseup', onWinUp);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('mousemove', onWinMove);
      window.removeEventListener('mouseup', onWinUp);
    };
  }, [isResizingHeight]);

  function deleteById(id: string) {
    onChangeNodes(nodes.filter((n) => n.id !== id));
    onChangeEdges(
      edges.filter((e) => e.id !== id && e.from !== id && e.to !== id)
    );
    onChangeBoundaries(boundaries.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) setEditingId(null);
  }

  function commitInlineEdit() {
    if (!editingId) return;
    const trimmed = editValue.trim();
    if (nodes.some((n) => n.id === editingId)) {
      onChangeNodes(
        nodes.map((n) =>
          n.id === editingId ? { ...n, label: trimmed || 'Service' } : n
        )
      );
    } else if (edges.some((e) => e.id === editingId)) {
      onChangeEdges(
        edges.map((e) => (e.id === editingId ? { ...e, label: trimmed } : e))
      );
    } else if (boundaries.some((b) => b.id === editingId)) {
      onChangeBoundaries(
        boundaries.map((b) =>
          b.id === editingId ? { ...b, label: trimmed || 'Group' } : b
        )
      );
    }
    setEditingId(null);
  }

  // Keyboard shortcuts for authoring
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (disabled || editingId) return;
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'textarea' || activeTag === 'input') return;

      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'b' || e.key === 'B') setTool('box');
      if (e.key === 'c' || e.key === 'C') {
        setTool('arrow');
        setArrowStartNodeId(null);
      }
      if (e.key === 'g' || e.key === 'G') setTool('boundary');
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteById(selectedId);
      }
      if (e.key === 'Escape') {
        setArrowStartNodeId(null);
        setSelectedId(null);
        setTool('select');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function getRelativeCoords(e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    if (
      e.target !== e.currentTarget &&
      (e.target as HTMLElement).tagName !== 'svg'
    ) {
      return;
    }
    if (editingId) {
      commitInlineEdit();
    }

    const pos = getRelativeCoords(e);

    if (tool === 'box' || tool === 'boundary') {
      // Keep focus on the name field that mounts for the new element. Without this,
      // the browser's default mousedown focus change blurs that field immediately,
      // which commits an empty name and leaves every new box labelled "Service".
      e.preventDefault();
    }

    if (tool === 'box') {
      const id = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
      const width = 152;
      const height = 60;
      const newNode: CanvasNode = {
        id,
        label: `Component ${nodes.length + 1}`,
        x: Math.max(12, Math.round(pos.x - width / 2)),
        y: Math.max(12, Math.round(pos.y - height / 2)),
        width,
        height,
      };
      onChangeNodes([...nodes, newNode]);
      setSelectedId(id);
      setEditingId(id);
      setEditValue('');
      setTool('select');
      return;
    }

    if (tool === 'boundary') {
      const id = `bnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
      const newBnd: CanvasBoundary = {
        id,
        label: 'Region / Group',
        x: Math.max(12, Math.round(pos.x - 140)),
        y: Math.max(12, Math.round(pos.y - 95)),
        width: 280,
        height: 190,
      };
      onChangeBoundaries([...boundaries, newBnd]);
      setSelectedId(id);
      setEditingId(id);
      setEditValue('');
      setTool('select');
      return;
    }

    setSelectedId(null);
    setArrowStartNodeId(null);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    const pos = getRelativeCoords(e);
    setMousePos(pos);

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === 'node') {
      const targetNode = nodes.find((n) => n.id === drag.id);
      const nextY = Math.max(8, Math.round(pos.y - drag.offsetY));
      if (
        resizable &&
        targetNode &&
        nextY + targetNode.height + 28 > effectiveHeight
      ) {
        setHeight(nextY + targetNode.height + 36);
      }
      onChangeNodes(
        nodes.map((n) =>
          n.id === drag.id
            ? {
                ...n,
                x: Math.max(8, Math.round(pos.x - drag.offsetX)),
                y: nextY,
              }
            : n
        )
      );
    } else if (drag.kind === 'boundary') {
      onChangeBoundaries(
        boundaries.map((b) =>
          b.id === drag.id
            ? {
                ...b,
                x: Math.max(8, Math.round(pos.x - drag.offsetX)),
                y: Math.max(8, Math.round(pos.y - drag.offsetY)),
              }
            : b
        )
      );
    }
  }

  function handleNodeClick(e: React.MouseEvent, node: CanvasNode) {
    e.stopPropagation();
    if (disabled) return;
    if (tool === 'arrow' || arrowStartNodeId) {
      if (!arrowStartNodeId) {
        setArrowStartNodeId(node.id);
      } else if (arrowStartNodeId !== node.id) {
        const exists = edges.some(
          (ed) => ed.from === arrowStartNodeId && ed.to === node.id
        );
        if (!exists) {
          const id = `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
          onChangeEdges([
            ...edges,
            { id, from: arrowStartNodeId, to: node.id, label: '' },
          ]);
          setSelectedId(id);
        }
        setArrowStartNodeId(null);
        setTool('select');
      }
      return;
    }
    setSelectedId(node.id);
  }

  function handleNodeMouseDown(e: React.MouseEvent, node: CanvasNode) {
    e.stopPropagation();
    if (disabled || tool !== 'select' || editingId === node.id) return;
    const pos = getRelativeCoords(e);
    setSelectedId(node.id);
    dragRef.current = {
      kind: 'node',
      id: node.id,
      offsetX: pos.x - node.x,
      offsetY: pos.y - node.y,
    };
  }

  function handleBoundaryMouseDown(e: React.MouseEvent, bnd: CanvasBoundary) {
    e.stopPropagation();
    if (disabled || tool !== 'select') return;
    const pos = getRelativeCoords(e);
    setSelectedId(bnd.id);
    dragRef.current = {
      kind: 'boundary',
      id: bnd.id,
      offsetX: pos.x - bnd.x,
      offsetY: pos.y - bnd.y,
    };
  }

  return (
    <div
      className={`flex flex-col bg-canvas overflow-hidden ${
        resizable ? '' : 'h-full flex-1 min-h-0'
      }`}
    >
      <CanvasInspector
        tool={tool}
        arrowStartNodeId={arrowStartNodeId}
        selectedId={selectedId}
        disabled={disabled}
        authLoading={authLoading}
        hasEdges={edges.length > 0}
        hasElements={nodes.length > 0 || boundaries.length > 0}
        showFlowLabels={showFlowLabels}
        onSelectTool={(nextTool) => {
          setTool(nextTool);
          setArrowStartNodeId(null);
        }}
        onToggleFlowLabels={() => setShowFlowLabels((v) => !v)}
        onDeleteSelected={() => {
          if (selectedId) deleteById(selectedId);
        }}
        onClearAll={() => {
          onChangeNodes([]);
          onChangeEdges([]);
          onChangeBoundaries([]);
          setSelectedId(null);
          setArrowStartNodeId(null);
        }}
      />

      <CanvasViewport
        containerRef={containerRef}
        nodes={nodes}
        edges={edges}
        boundaries={boundaries}
        compiledEdges={compiledEdges}
        disabled={disabled}
        authLoading={authLoading}
        signingIn={signingIn}
        onSignIn={onSignIn}
        onSignInDummy={onSignInDummy}
        resizable={resizable}
        effectiveHeight={effectiveHeight}
        isDark={isDark}
        tool={tool}
        selectedId={selectedId}
        editingId={editingId}
        editValue={editValue}
        arrowStartNodeId={arrowStartNodeId}
        mousePos={mousePos}
        showFlowLabels={showFlowLabels}
        activeFrame={activeFrame}
        isPlaying={isPlaying}
        onCanvasMouseDown={handleCanvasMouseDown}
        onCanvasMouseMove={handleMouseMove}
        onCanvasMouseUp={() => {
          dragRef.current = null;
        }}
        onBoundaryMouseDown={handleBoundaryMouseDown}
        onNodeMouseDown={handleNodeMouseDown}
        onNodeClick={handleNodeClick}
        onStartConnectFromNode={(nodeId) => {
          setArrowStartNodeId(nodeId);
          setTool('arrow');
        }}
        onSelectId={setSelectedId}
        onStartEdit={(id, val) => {
          setEditingId(id);
          setEditValue(val);
        }}
        onChangeEditValue={setEditValue}
        onCommitInlineEdit={commitInlineEdit}
      />

      {resizable && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            const currentH =
              containerRef.current?.getBoundingClientRect().height ??
              effectiveHeight;
            resizeDragRef.current = {
              startY: e.clientY,
              startHeight: currentH,
            };
            setIsResizingHeight(true);
          }}
          className={`h-2 border-t border-hairline flex items-center justify-center select-none cursor-ns-resize transition-colors group ${
            isResizingHeight ? 'bg-subtle' : 'bg-surface hover:bg-subtle'
          }`}
        >
          <div
            className={`w-10 h-0.5 rounded-full transition-colors ${
              isResizingHeight
                ? 'bg-accent'
                : 'bg-strong group-hover:bg-secondary'
            }`}
          />
        </div>
      )}
    </div>
  );
}
