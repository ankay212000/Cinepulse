'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { ArrowRight, Lock } from 'lucide-react';
import type {
  CanvasBoundary,
  CanvasEdge,
  CanvasNode,
  SimEdgeSpec,
  SimulationFrame,
} from '@/types';
import {
  type CanvasTool,
  getBoxAnchorPoint,
  getNodeCenter,
  type Particle,
  statusColors,
} from './canvasGeometry';

export interface CanvasViewportProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  boundaries: CanvasBoundary[];
  compiledEdges: SimEdgeSpec[];
  disabled: boolean;
  authLoading: boolean;
  signingIn: boolean;
  onSignIn?: () => void;
  onSignInDummy?: () => void;
  resizable: boolean;
  effectiveHeight: number;
  isDark: boolean;
  tool: CanvasTool;
  selectedId: string | null;
  editingId: string | null;
  editValue: string;
  arrowStartNodeId: string | null;
  mousePos: { x: number; y: number } | null;
  showFlowLabels: boolean;
  activeFrame: SimulationFrame | null;
  isPlaying: boolean;
  onCanvasMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasMouseUp: () => void;
  onBoundaryMouseDown: (e: React.MouseEvent, bnd: CanvasBoundary) => void;
  onNodeMouseDown: (e: React.MouseEvent, node: CanvasNode) => void;
  onNodeClick: (e: React.MouseEvent, node: CanvasNode) => void;
  onStartConnectFromNode: (nodeId: string) => void;
  onSelectId: (id: string) => void;
  onStartEdit: (id: string, initialValue: string) => void;
  onChangeEditValue: (val: string) => void;
  onCommitInlineEdit: () => void;
}

export default function CanvasViewport({
  containerRef,
  nodes,
  edges,
  boundaries,
  compiledEdges,
  disabled,
  authLoading,
  signingIn,
  onSignIn,
  onSignInDummy,
  resizable,
  effectiveHeight,
  isDark,
  tool,
  selectedId,
  editingId,
  editValue,
  arrowStartNodeId,
  mousePos,
  showFlowLabels,
  activeFrame,
  isPlaying,
  onCanvasMouseDown,
  onCanvasMouseMove,
  onCanvasMouseUp,
  onBoundaryMouseDown,
  onNodeMouseDown,
  onNodeClick,
  onStartConnectFromNode,
  onSelectId,
  onStartEdit,
  onChangeEditValue,
  onCommitInlineEdit,
}: CanvasViewportProps) {
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const frameRef = useRef<SimulationFrame | null>(activeFrame);
  const nodesRef = useRef<CanvasNode[]>(nodes);
  const edgesRef = useRef<CanvasEdge[]>(edges);
  const isDarkRef = useRef<boolean>(isDark);

  frameRef.current = activeFrame;
  nodesRef.current = nodes;
  edgesRef.current = edges;
  isDarkRef.current = isDark;

  const compiledEdgeMap = useMemo(
    () => new Map(compiledEdges.map((ce) => [ce.canvasEdgeId, ce])),
    [compiledEdges]
  );

  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes]
  );

  // 60fps Particle Animation Engine on HTML5 Canvas
  useEffect(() => {
    let rafId = 0;
    let lastTs = performance.now();

    const tickParticles = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;

      const canvas = particleCanvasRef.current;
      const host = containerRef.current;
      if (canvas && host) {
        const rect = host.getBoundingClientRect();
        if (
          canvas.width !== Math.floor(rect.width) ||
          canvas.height !== Math.floor(rect.height)
        ) {
          canvas.width = Math.floor(rect.width);
          canvas.height = Math.floor(rect.height);
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const curFrame = frameRef.current;
          const curNodes = nodesRef.current;
          const curEdges = edgesRef.current;
          const dark = isDarkRef.current;

          const okColor = dark ? '#10b981' : '#059669';
          const errColor = dark ? '#ef4444' : '#dc2626';
          const returnColor = dark ? '#f59e0b' : '#d97706';

          if (curFrame) {
            const curNodeMap = new Map(curNodes.map((n) => [n.id, n]));

            for (const edge of curEdges) {
              const eTel = curFrame.edges[edge.id];
              if (
                !eTel ||
                (eTel.rps <= 0 && eTel.errorRps <= 0 && eTel.returnHitRps <= 0)
              ) {
                continue;
              }

              const totalFlow = eTel.rps + eTel.errorRps;
              const spawnPerSec = Math.min(
                24,
                2.2 + Math.log10(Math.max(1, totalFlow)) * 4.0
              );
              const expected =
                totalFlow > 0 ? spawnPerSec * dt * (isPlaying ? 1 : 0.35) : 0;

              const whole = Math.floor(expected);
              const frac = expected - whole;
              const count = whole + (Math.random() < frac ? 1 : 0);

              const speedBase = Math.max(
                0.35,
                Math.min(
                  1.85,
                  1.35 - Math.log10(Math.max(1, eTel.hopLatencyMs)) * 0.35
                )
              );
              const errProb = totalFlow > 0 ? eTel.errorRps / totalFlow : 0;
              const hasReturnLane = eTel.returnHitRps > 0;

              for (let i = 0; i < count; i++) {
                if (particlesRef.current.length > 480) break;
                const isErr = Math.random() < errProb || eTel.retryAmplified;
                particlesRef.current.push({
                  edgeId: edge.id,
                  progress: Math.random() * 0.06,
                  speed: speedBase * (0.9 + Math.random() * 0.2),
                  isError: isErr,
                  isReverse: false,
                  color: isErr ? errColor : okColor,
                  offsetJitter: hasReturnLane
                    ? -2.8
                    : (Math.random() - 0.5) * 3.5,
                });
              }

              if (hasReturnLane) {
                const retSpawnPerSec = Math.min(
                  18,
                  1.8 + Math.log10(Math.max(1, eTel.returnHitRps)) * 3.4
                );
                const retExpected =
                  retSpawnPerSec * dt * (isPlaying ? 1 : 0.35);
                const retCount =
                  Math.floor(retExpected) +
                  (Math.random() < retExpected % 1 ? 1 : 0);
                for (let i = 0; i < retCount; i++) {
                  if (particlesRef.current.length > 480) break;
                  particlesRef.current.push({
                    edgeId: edge.id,
                    progress: Math.random() * 0.06,
                    speed: speedBase * 1.12,
                    isError: false,
                    isReverse: true,
                    color: returnColor,
                    offsetJitter: 3.2,
                  });
                }
              }
            }

            const surviving: Particle[] = [];
            const edgeMap = new Map(curEdges.map((e) => [e.id, e]));
            const edgeKeySet = new Set(
              curEdges.map((e) => `${e.from}->${e.to}`)
            );

            for (const p of particlesRef.current) {
              const rate = isPlaying ? 1 : 0.28;
              const nextProg = p.progress + p.speed * dt * rate;
              if (nextProg >= 1.0) continue;

              const edge = edgeMap.get(p.edgeId);
              if (!edge) continue;
              const src = curNodeMap.get(edge.from);
              const dst = curNodeMap.get(edge.to);
              if (!src || !dst) continue;

              const dstC = getNodeCenter(dst);
              const srcC = getNodeCenter(src);
              const rawStart = getBoxAnchorPoint(src, dstC);
              const rawEnd = getBoxAnchorPoint(dst, srcC);

              const segDx = rawEnd.x - rawStart.x;
              const segDy = rawEnd.y - rawStart.y;
              const segLen = Math.max(1, Math.hypot(segDx, segDy));
              const normX = -segDy / segLen;
              const normY = segDx / segLen;
              const laneShift = edgeKeySet.has(`${edge.to}->${edge.from}`)
                ? 9
                : 0;

              const start = {
                x: rawStart.x + normX * laneShift,
                y: rawStart.y + normY * laneShift,
              };
              const t = p.isReverse ? 1 - nextProg : nextProg;
              const px = start.x + segDx * t + normX * p.offsetJitter;
              const py = start.y + segDy * t + normY * p.offsetJitter;

              ctx.beginPath();
              ctx.arc(
                px,
                py,
                p.isError ? 3.1 : p.isReverse ? 2.3 : 2.6,
                0,
                Math.PI * 2
              );
              ctx.fillStyle = p.color;
              ctx.fill();

              p.progress = nextProg;
              surviving.push(p);
            }
            particlesRef.current = surviving;
          } else {
            particlesRef.current = [];
          }
        }
      }

      rafId = requestAnimationFrame(tickParticles);
    };

    rafId = requestAnimationFrame(tickParticles);
    return () => cancelAnimationFrame(rafId);
  }, [containerRef, isPlaying]);

  const replayActive = activeFrame !== null;
  const accentHex = isDark ? '#e06d2e' : '#c85217';
  const neutralStroke = isDark ? '#7d786d' : '#706a5f';
  const activeStroke = isDark ? '#10b981' : '#059669';
  const errorStroke = isDark ? '#ef4444' : '#dc2626';

  return (
    <div
      ref={containerRef}
      style={resizable ? { height: `${effectiveHeight}px` } : undefined}
      onMouseDown={onCanvasMouseDown}
      onMouseMove={onCanvasMouseMove}
      onMouseUp={onCanvasMouseUp}
      className={`relative w-full overflow-hidden select-none ${
        resizable ? '' : 'flex-1 min-h-[420px] xl:min-h-0'
      } ${
        disabled
          ? 'bg-subtle/60 cursor-not-allowed'
          : tool === 'box' || tool === 'boundary'
            ? 'cursor-crosshair'
            : tool === 'arrow' || arrowStartNodeId
              ? 'cursor-pointer'
              : 'cursor-default'
      }`}
    >
      {disabled && !authLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-subtle/75 dark:bg-canvas/80 backdrop-blur-[1.5px] px-6 text-center">
          <div className="max-w-xs flex flex-col items-center gap-2.5 p-5 rounded-md bg-surface/95 border border-hairline shadow-sm">
            <div className="w-9 h-9 rounded-full bg-subtle border border-hairline flex items-center justify-center text-muted">
              <Lock className="w-4 h-4" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-ink">
                Sign in to continue
              </p>
              <p className="text-[11px] text-muted leading-relaxed">
                The architecture whiteboard is locked. Sign in with Google to draw and simulate your design.
              </p>
            </div>
            <div className="mt-1 flex items-center gap-2 flex-wrap justify-center">
              {onSignIn && (
                <button
                  type="button"
                  disabled={signingIn}
                  onClick={onSignIn}
                  className="px-3.5 py-1.5 rounded bg-ink text-surface hover:opacity-90 disabled:opacity-50 text-xs font-medium transition-opacity cursor-pointer"
                >
                  {signingIn ? 'Signing in...' : 'Sign in to continue'}
                </button>
              )}
              {process.env.NODE_ENV === 'development' && onSignInDummy && (
                <button
                  type="button"
                  onClick={onSignInDummy}
                  className="px-3 py-1.5 rounded border border-dashed border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-medium text-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
                >
                  Use Dummy User (Local)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {!disabled && nodes.length === 0 && boundaries.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6 text-center">
          <p className="text-xs text-muted">
            Press{' '}
            <kbd className="px-1 py-0.5 bg-surface border border-hairline rounded font-mono text-secondary">
              B
            </kbd>{' '}
            to add a component, double-click to name,{' '}
            <kbd className="px-1 py-0.5 bg-surface border border-hairline rounded font-mono text-secondary">
              C
            </kbd>{' '}
            to connect.
          </p>
        </div>
      )}

      {boundaries.map((bnd) => {
        const isSelected = selectedId === bnd.id;
        return (
          <div
            key={bnd.id}
            style={{
              left: bnd.x,
              top: bnd.y,
              width: bnd.width,
              height: bnd.height,
            }}
            onMouseDown={(e) => onBoundaryMouseDown(e, bnd)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartEdit(bnd.id, bnd.label);
            }}
            className={`absolute rounded border border-dashed transition-colors ${
              isSelected
                ? 'border-accent bg-accent/[0.03]'
                : 'border-strong bg-subtle/30'
            }`}
          >
            <div className="px-2 py-1 text-[11px] font-mono text-secondary">
              {editingId === bnd.id ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => onChangeEditValue(e.target.value)}
                  onBlur={onCommitInlineEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onCommitInlineEdit();
                  }}
                  placeholder="Group label..."
                  className="bg-surface border border-accent rounded px-1.5 py-0.5 text-xs text-ink outline-none w-40"
                />
              ) : (
                <span>{bnd.label}</span>
              )}
            </div>
          </div>
        );
      })}

      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          <marker
            id="arrow-neutral"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6.5"
            markerHeight="6.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill={neutralStroke} />
          </marker>
          <marker
            id="arrow-active"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6.5"
            markerHeight="6.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill={activeStroke} />
          </marker>
          <marker
            id="arrow-selected"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6.5"
            markerHeight="6.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill={accentHex} />
          </marker>
          <marker
            id="arrow-error"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6.5"
            markerHeight="6.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill={errorStroke} />
          </marker>
        </defs>

        {edges.map((edge) => {
          const src = nodeMap.get(edge.from);
          const dst = nodeMap.get(edge.to);
          if (!src || !dst) return null;

          const dstCenter = getNodeCenter(dst);
          const srcCenter = getNodeCenter(src);
          const rawStart = getBoxAnchorPoint(src, dstCenter);
          const rawEnd = getBoxAnchorPoint(dst, srcCenter);

          const dx = rawEnd.x - rawStart.x;
          const dy = rawEnd.y - rawStart.y;
          const rawLen = Math.max(1, Math.hypot(dx, dy));
          const normX = -dy / rawLen;
          const normY = dx / rawLen;
          const hasReversePair = edges.some(
            (other) => other.from === edge.to && other.to === edge.from
          );
          const laneShift = hasReversePair ? 9 : 0;
          const pillExtraShift = hasReversePair ? 6 : 0;

          const start = {
            x: rawStart.x + normX * laneShift,
            y: rawStart.y + normY * laneShift,
          };
          const end = {
            x: rawEnd.x + normX * laneShift,
            y: rawEnd.y + normY * laneShift,
          };

          const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
          const midX = (start.x + end.x) / 2 + normX * pillExtraShift;
          const midY = (start.y + end.y) / 2 + normY * pillExtraShift;

          const simEdge = compiledEdgeMap.get(edge.id);
          const eTel = activeFrame?.edges[edge.id];
          const hasErrors =
            eTel && (eTel.errorRps > 10 || eTel.retryAmplified);
          const hasFlow = eTel && eTel.rps > 0;

          let strokeColor = neutralStroke;
          let marker = 'url(#arrow-neutral)';

          if (selectedId === edge.id) {
            strokeColor = accentHex;
            marker = 'url(#arrow-selected)';
          } else if (hasErrors) {
            strokeColor = errorStroke;
            marker = 'url(#arrow-error)';
          } else if (hasFlow) {
            strokeColor = activeStroke;
            marker = 'url(#arrow-active)';
          }

          const scenarioText =
            edge.label?.trim() || simEdge?.scenarioFlowLabel || '';
          const rpsText =
            replayActive && eTel && eTel.rps > 0
              ? `${
                  eTel.rps >= 1000
                    ? `${(eTel.rps / 1000).toFixed(1)}k`
                    : eTel.rps
                } rps`
              : '';

          const shouldRenderPill =
            editingId === edge.id ||
            (showFlowLabels && Boolean(scenarioText)) ||
            Boolean(rpsText);

          const chev1X = start.x + dx * 0.28;
          const chev1Y = start.y + dy * 0.28;
          const chev2X = start.x + dx * 0.74;
          const chev2Y = start.y + dy * 0.74;
          const segLen = Math.hypot(dx, dy);

          return (
            <g key={edge.id} className="pointer-events-auto">
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke="transparent"
                strokeWidth={16}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectId(edge.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onStartEdit(edge.id, edge.label ?? '');
                }}
              />
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={strokeColor}
                strokeWidth={
                  selectedId === edge.id ? 2.2 : hasFlow ? 1.8 : 1.4
                }
                markerEnd={marker}
              />

              {segLen > 95 && (
                <>
                  <path
                    d="M -3.5 -3 L 2.5 0 L -3.5 3"
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    transform={`translate(${chev1X}, ${chev1Y}) rotate(${angleDeg})`}
                  />
                  <path
                    d="M -3.5 -3 L 2.5 0 L -3.5 3"
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    transform={`translate(${chev2X}, ${chev2Y}) rotate(${angleDeg})`}
                  />
                </>
              )}

              {shouldRenderPill && (
                <foreignObject
                  x={midX - 120}
                  y={midY - 15}
                  width={240}
                  height={32}
                  className="overflow-visible"
                >
                  <div className="flex justify-center items-center">
                    {editingId === edge.id ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => onChangeEditValue(e.target.value)}
                        onBlur={onCommitInlineEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onCommitInlineEdit();
                        }}
                        placeholder="Edge label..."
                        className="bg-surface border border-accent rounded px-2 py-0.5 text-[10px] text-ink outline-none w-44 text-center"
                      />
                    ) : (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectId(edge.id);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          onStartEdit(edge.id, edge.label ?? '');
                        }}
                        title="Double-click to edit label"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface border border-strong text-[10px] font-mono text-secondary whitespace-nowrap cursor-pointer shadow-sm"
                      >
                        <ArrowRight
                          className="w-2.5 h-2.5 shrink-0"
                          style={{
                            color: strokeColor,
                            transform: `rotate(${Math.round(angleDeg)}deg)`,
                          }}
                        />
                        {showFlowLabels && scenarioText && (
                          <span className="tracking-tight text-ink">
                            {scenarioText}
                          </span>
                        )}
                        {rpsText && (
                          <span
                            className={`tabular-nums text-emerald-700 dark:text-emerald-400 font-medium ${
                              showFlowLabels && scenarioText
                                ? 'pl-1 ml-0.5 border-l border-hairline'
                                : ''
                            }`}
                          >
                            {rpsText}
                          </span>
                        )}
                        {replayActive && eTel && eTel.returnHitRps > 0 && (
                          <span className="tabular-nums text-amber-700 dark:text-amber-400 pl-1 ml-0.5 border-l border-hairline">
                            ↩{' '}
                            {eTel.returnHitRps >= 1000
                              ? `${(eTel.returnHitRps / 1000).toFixed(1)}k`
                              : eTel.returnHitRps}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </foreignObject>
              )}
            </g>
          );
        })}

        {arrowStartNodeId && mousePos && nodeMap.get(arrowStartNodeId) && (
          <line
            x1={getNodeCenter(nodeMap.get(arrowStartNodeId)!).x}
            y1={getNodeCenter(nodeMap.get(arrowStartNodeId)!).y}
            x2={mousePos.x}
            y2={mousePos.y}
            stroke={accentHex}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}
      </svg>

      <canvas
        ref={particleCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {nodes.map((node) => {
        const tel = activeFrame?.nodes[node.id];
        const palette = statusColors(tel, replayActive, isDark);
        const isSelected =
          selectedId === node.id || arrowStartNodeId === node.id;
        const utilPct = tel
          ? Math.min(100, Math.round(tel.utilization * 100))
          : 0;

        return (
          <div
            key={node.id}
            style={{
              left: node.x,
              top: node.y,
              width: node.width,
              minHeight: node.height,
              backgroundColor: palette.bg,
              borderColor: isSelected ? accentHex : palette.border,
            }}
            onMouseDown={(e) => onNodeMouseDown(e, node)}
            onClick={(e) => onNodeClick(e, node)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartEdit(node.id, node.label);
            }}
            className={`absolute rounded border px-2.5 py-2 flex flex-col justify-between shadow-sm transition-colors ${
              tool === 'select'
                ? 'cursor-grab active:cursor-grabbing'
                : 'cursor-pointer'
            }`}
          >
            {replayActive && tel?.symptomBadge && (
              <div
                className={`absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap border pointer-events-none z-20 ${
                  tel.status === 'crashed' || tel.status === 'saturated'
                    ? 'bg-red-50 dark:bg-[#2a1215] border-red-400 dark:border-red-500 text-red-800 dark:text-red-300'
                    : 'bg-amber-50 dark:bg-[#241c0e] border-amber-400 dark:border-amber-500 text-amber-900 dark:text-amber-200'
                }`}
              >
                {tel.symptomBadge}
              </div>
            )}

            <button
              type="button"
              title="Connect arrow from this component"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onStartConnectFromNode(node.id);
              }}
              className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-surface border border-strong hover:border-accent hover:bg-accent transition-colors"
            />

            <div className="flex items-center justify-center text-center min-h-[24px]">
              {editingId === node.id ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => onChangeEditValue(e.target.value)}
                  onBlur={onCommitInlineEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onCommitInlineEdit();
                  }}
                  placeholder="Component name..."
                  className="w-full bg-surface border border-accent rounded px-1.5 py-0.5 text-xs text-center text-ink outline-none"
                />
              ) : (
                <span
                  style={{ color: palette.text }}
                  className="text-xs font-medium leading-tight break-words"
                >
                  {node.label}
                </span>
              )}
            </div>

            {replayActive && tel && (
              <div
                style={{ borderTopColor: palette.divider }}
                className="mt-1.5 pt-1 border-t flex flex-col gap-1"
              >
                <div
                  style={{ color: palette.text }}
                  className="flex items-center justify-between text-[10px] font-mono tabular-nums"
                >
                  <span>
                    {tel.servedRps >= 1000
                      ? `${(tel.servedRps / 1000).toFixed(1)}k`
                      : tel.servedRps}{' '}
                    rps
                  </span>
                  <span>
                    {tel.status === 'crashed'
                      ? 'OFFLINE'
                      : `${tel.localP99Ms.toFixed(1)}ms`}
                  </span>
                </div>
                <div
                  style={{ color: palette.subtext }}
                  className="flex items-center justify-between text-[9px] font-mono tabular-nums"
                >
                  {tel.cacheHitRate !== undefined ? (
                    <>
                      <span>Hit {(tel.cacheHitRate * 100).toFixed(0)}%</span>
                      <span>Load {utilPct}%</span>
                    </>
                  ) : (
                    <>
                      <span>Load {utilPct}%</span>
                      {tel.queueDepth > 0 && <span>Q:{tel.queueDepth}</span>}
                    </>
                  )}
                </div>
                <div className="w-full h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                  <div
                    style={{
                      width: `${utilPct}%`,
                      backgroundColor: palette.bar,
                    }}
                    className="h-full transition-all duration-100"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
