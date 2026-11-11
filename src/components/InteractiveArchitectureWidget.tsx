'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTheme } from '@/components/ThemeProvider';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Flame,
  RotateCcw,
  ShieldAlert,
  Zap,
} from 'lucide-react';

export interface SandboxState {
  rps: number;
  cdnEnabled: boolean;
  redisEnabled: boolean;
  dbShards: 1 | 4;
  syncReplica: boolean;
  dbCrashed: boolean;
}

export interface SandboxTelemetry {
  p99Ms: number;
  availabilityPct: number;
  monthlyCostUsd: number;
  cacheHitPct: number;
  dbUtilizationPct: number;
  verdict: 'AC' | 'TLE_LATENCY_SLO' | 'AVAILABILITY_BREACH' | 'MLE_OVER_BUDGET';
  score: number;
  bottleneckNote: string;
}

export function evaluateSandbox(state: SandboxState): SandboxTelemetry {
  const { rps, cdnEnabled, redisEnabled, dbShards, syncReplica, dbCrashed } =
    state;

  const cdnHitRatio = cdnEnabled ? 0.32 : 0;
  const afterCdnRps = rps * (1 - cdnHitRatio);
  const redisHitRatio = redisEnabled ? 0.86 : 0;
  const dbArrivalRps = afterCdnRps * (1 - redisHitRatio);

  const singleShardCap = 9500;
  const totalDbCap = dbShards * singleShardCap;
  const rawDbUtil = dbArrivalRps / Math.max(1, totalDbCap);

  let availabilityPct = 99.99;
  let p99Ms = 9;
  let bottleneckNote = 'All tiers healthy within queueing headroom.';

  if (dbCrashed && !syncReplica) {
    // Unrecovered storage outage for reads/writes missing cache
    const cacheCoveredFraction =
      cdnHitRatio + (1 - cdnHitRatio) * redisHitRatio * 0.85;
    availabilityPct = Number(
      Math.max(12, Math.min(94.5, cacheCoveredFraction * 100)).toFixed(2)
    );
    p99Ms = 420;
    bottleneckNote =
      'Primary DB crashed with no Sync Standby Replica — uncached reads & writes failing with HTTP 503.';
  } else {
    const failoverPenaltyMs = dbCrashed && syncReplica ? 5.5 : 0;
    if (dbCrashed && syncReplica) {
      availabilityPct = 99.95;
    }

    if (rawDbUtil >= 1.0) {
      const overload = rawDbUtil - 1.0;
      p99Ms = Math.min(680, Math.round(62 + overload * 190 + failoverPenaltyMs));
      const droppedFraction = Math.min(0.45, overload * 0.22);
      availabilityPct = Number(
        Math.max(55, (1 - droppedFraction) * 100).toFixed(2)
      );
      bottleneckNote = !redisEnabled
        ? `Uncached ${Math.round(dbArrivalRps / 1000)}k RPS overwhelming Postgres (${Math.round(rawDbUtil * 100)}% load). Enable Redis Cache.`
        : `Cache misses (${Math.round(dbArrivalRps / 1000)}k RPS) saturating single DB shard. Partition into 4x DB Shards.`;
    } else if (rawDbUtil > 0.72) {
      const queueTail = ((rawDbUtil - 0.7) / (1.02 - rawDbUtil)) * 9.5;
      p99Ms = Number((13.5 + queueTail + failoverPenaltyMs).toFixed(1));
      availabilityPct = dbCrashed && syncReplica ? 99.94 : 99.97;
      bottleneckNote =
        p99Ms > 30
          ? `DB queue tail spiking to ${p99Ms} ms (> 30 ms SLO). Add CDN Edge or 4x DB Shards.`
          : 'DB utilization elevated; tail latency nearing 30 ms SLO.';
    } else {
      const edgeSaving = cdnEnabled ? -2.4 : 0;
      const cacheBase = redisEnabled ? 11.8 : 24.5;
      p99Ms = Number(
        Math.max(
          7.2,
          cacheBase + edgeSaving + rawDbUtil * 9.5 + failoverPenaltyMs
        ).toFixed(1)
      );
      if (dbCrashed && syncReplica) {
        bottleneckNote =
          'Automatic Raft failover promoted Sync Standby in 1.4s — SLO preserved under chaos!';
      }
    }
  }

  const baseApiCost = 680;
  const cdnCost = cdnEnabled ? 290 : 0;
  const redisCost = redisEnabled ? 460 : 0;
  const dbCost = dbShards * 320 * (syncReplica ? 1.65 : 1);
  const monthlyCostUsd = Math.round(baseApiCost + cdnCost + redisCost + dbCost);

  let verdict: SandboxTelemetry['verdict'] = 'AC';
  if (availabilityPct < 99.9) {
    verdict = 'AVAILABILITY_BREACH';
  } else if (p99Ms > 30) {
    verdict = 'TLE_LATENCY_SLO';
  } else if (monthlyCostUsd > 3200) {
    verdict = 'MLE_OVER_BUDGET';
  }

  const totalHitRatio = cdnHitRatio + (1 - cdnHitRatio) * redisHitRatio;
  const cacheHitPct = Math.round(totalHitRatio * 100);
  const dbUtilizationPct = dbCrashed && !syncReplica ? 100 : Math.min(100, Math.round(rawDbUtil * 100));

  let score = 380;
  if (verdict === 'AC') {
    const latencyBonus = Math.round(Math.max(0, (30 - p99Ms) * 8));
    const costBonus = Math.round(Math.max(0, (3200 - monthlyCostUsd) / 14));
    const resilienceBonus = syncReplica ? 95 : 25;
    score = Math.min(985, 690 + latencyBonus + costBonus + resilienceBonus);
  } else {
    score = Math.max(
      180,
      Math.min(
        590,
        Math.round(
          (availabilityPct / 100) * 340 + Math.max(0, 180 - p99Ms * 0.4)
        )
      )
    );
  }

  return {
    p99Ms,
    availabilityPct,
    monthlyCostUsd,
    cacheHitPct,
    dbUtilizationPct,
    verdict,
    score,
    bottleneckNote,
  };
}

interface Particle {
  progress: number;
  speed: number;
  lane: 'edgeToApi' | 'apiToCache' | 'apiToDb' | 'cacheReturn' | 'drop';
  offsetY: number;
}

export default function InteractiveArchitectureWidget({
  externalPresetCounter = 0,
  externalPreset,
  onInteract,
}: {
  externalPresetCounter?: number;
  externalPreset?: Partial<SandboxState> | null;
  onInteract?: (state: SandboxState, telemetry: SandboxTelemetry) => void;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Start intentionally in a stressed viral surge so first-time visitors immediately see a real bottleneck they can fix in 1 click!
  const [state, setState] = useState<SandboxState>({
    rps: 85000,
    cdnEnabled: false,
    redisEnabled: true,
    dbShards: 1,
    syncReplica: false,
    dbCrashed: false,
  });

  useEffect(() => {
    if (externalPresetCounter > 0 && externalPreset) {
      setState((prev) => ({ ...prev, ...externalPreset }));
    }
  }, [externalPresetCounter, externalPreset]);

  const telemetry = useMemo(() => evaluateSandbox(state), [state]);

  function updateState(patch: Partial<SandboxState>) {
    setState((prev) => {
      const next = { ...prev, ...patch };
      const nextTel = evaluateSandbox(next);
      onInteract?.(next, nextTel);
      return next;
    });
  }

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const telRef = useRef(telemetry);
  stateRef.current = state;
  telRef.current = telemetry;

  // Live 60fps request-particle simulation canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const particles: Particle[] = [];
    let animId = 0;

    function spawnParticles() {
      const s = stateRef.current;
      const t = telRef.current;
      const intensity = Math.max(1, Math.round(s.rps / 24000));

      for (let i = 0; i < intensity; i++) {
        if (particles.length > 130) break;
        const offsetY = (Math.random() - 0.5) * 14;
        particles.push({
          progress: 0,
          speed: 0.016 + Math.random() * 0.012,
          lane: 'edgeToApi',
          offsetY,
        });

        if (s.redisEnabled && Math.random() < 0.78) {
          particles.push({
            progress: 0,
            speed: 0.02 + Math.random() * 0.012,
            lane: Math.random() < 0.5 ? 'apiToCache' : 'cacheReturn',
            offsetY: (Math.random() - 0.5) * 10,
          });
        } else {
          const willDrop =
            (s.dbCrashed && !s.syncReplica) ||
            (t.dbUtilizationPct >= 100 && Math.random() < 0.45);
          particles.push({
            progress: 0,
            speed: willDrop ? 0.011 : 0.015 + Math.random() * 0.01,
            lane: willDrop ? 'drop' : 'apiToDb',
            offsetY: (Math.random() - 0.5) * 12,
          });
        }
      }
    }

    let frameCounter = 0;

    function render() {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 680;
      const h = canvas.clientHeight || 220;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      frameCounter += 1;
      if (frameCounter % 5 === 0) {
        spawnParticles();
      }

      const s = stateRef.current;
      const t = telRef.current;

      // Normalized anchor coordinates matching the 4-tier layout
      const pEdge = { x: w * 0.14, y: h * 0.5 };
      const pApi = { x: w * 0.43, y: h * 0.5 };
      const pCache = { x: w * 0.77, y: h * 0.25 };
      const pDb = { x: w * 0.77, y: h * 0.75 };

      const lineMuted = isDark ? 'rgba(168,162,148,0.22)' : 'rgba(90,84,72,0.22)';
      const lineActive = isDark ? 'rgba(16,185,129,0.45)' : 'rgba(5,150,105,0.4)';
      const lineWarn = isDark ? 'rgba(239,68,68,0.5)' : 'rgba(220,38,38,0.45)';

      // Draw structural wires
      ctx.lineWidth = 1.5;

      // Edge -> API
      ctx.strokeStyle = lineActive;
      ctx.beginPath();
      ctx.moveTo(pEdge.x, pEdge.y);
      ctx.lineTo(pApi.x, pApi.y);
      ctx.stroke();

      // API -> Cache
      ctx.strokeStyle = s.redisEnabled ? lineActive : lineMuted;
      ctx.setLineDash(s.redisEnabled ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(pApi.x, pApi.y - 6);
      ctx.lineTo(pCache.x, pCache.y);
      ctx.stroke();

      // API -> DB
      ctx.setLineDash([]);
      ctx.strokeStyle =
        (s.dbCrashed && !s.syncReplica) || t.dbUtilizationPct >= 98
          ? lineWarn
          : lineActive;
      ctx.beginPath();
      ctx.moveTo(pApi.x, pApi.y + 6);
      ctx.lineTo(pDb.x, pDb.y);
      ctx.stroke();

      // Advance & draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.progress += pt.speed;
        if (pt.progress >= 1) {
          particles.splice(i, 1);
          continue;
        }

        let x = 0;
        let y = 0;
        let color = isDark ? '#10b981' : '#059669';

        if (pt.lane === 'edgeToApi') {
          x = pEdge.x + (pApi.x - pEdge.x) * pt.progress;
          y = pEdge.y + (pApi.y - pEdge.y) * pt.progress + pt.offsetY * 0.4;
        } else if (pt.lane === 'apiToCache') {
          x = pApi.x + (pCache.x - pApi.x) * pt.progress;
          y = pApi.y - 6 + (pCache.y - (pApi.y - 6)) * pt.progress + pt.offsetY * 0.3;
        } else if (pt.lane === 'cacheReturn') {
          x = pCache.x + (pApi.x - pCache.x) * pt.progress;
          y = pCache.y + (pApi.y - 6 - pCache.y) * pt.progress + pt.offsetY * 0.3;
          color = isDark ? '#f59e0b' : '#d97706';
        } else if (pt.lane === 'apiToDb') {
          x = pApi.x + (pDb.x - pApi.x) * pt.progress;
          y = pApi.y + 6 + (pDb.y - (pApi.y + 6)) * pt.progress + pt.offsetY * 0.3;
        } else {
          const stopProgress = Math.min(0.86, pt.progress);
          x = pApi.x + (pDb.x - pApi.x) * stopProgress;
          y = pApi.y + 6 + (pDb.y - (pApi.y + 6)) * stopProgress + pt.offsetY * 0.5;
          color = isDark ? '#ef4444' : '#dc2626';
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 2.7, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = window.requestAnimationFrame(render);
    }

    animId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(animId);
  }, [isDark]);

  const isAc = telemetry.verdict === 'AC';

  return (
    <div className="space-y-5">
      {/* Top Bar: Live Verdict + Preset Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-hairline">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-accent font-semibold">
            <Activity className="w-4 h-4" />
            <span>Live Simulator · HLD-201</span>
          </span>
          <span className="text-muted text-xs hidden sm:inline">
            Click components or drag traffic to test live
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              updateState({
                rps: 105000,
                cdnEnabled: true,
                redisEnabled: true,
                dbShards: 4,
                syncReplica: true,
                dbCrashed: false,
              })
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-medium text-emerald-800 dark:text-emerald-300 transition-colors cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Auto-Fix to AC</span>
          </button>

          <button
            type="button"
            onClick={() =>
              updateState({
                rps: 85000,
                cdnEnabled: false,
                redisEnabled: true,
                dbShards: 1,
                syncReplica: false,
                dbCrashed: false,
              })
            }
            title="Reset sandbox"
            className="p-1.5 rounded border border-hairline hover:border-strong text-secondary hover:text-ink transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Interactive Topology Stage */}
      <div
        className="relative h-[230px] sm:h-[245px] rounded border border-hairline bg-canvas overflow-hidden select-none"
        style={{
          backgroundImage: isDark
            ? 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)'
            : 'radial-gradient(rgba(23,22,20,0.08) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {/* Node 1: Ingress / CDN Edge */}
        <button
          type="button"
          onClick={() => updateState({ cdnEnabled: !state.cdnEnabled })}
          style={{ left: '3%', top: '50%' }}
          className={`absolute -translate-y-1/2 w-[23%] min-w-[108px] text-left p-2.5 rounded border transition-all cursor-pointer ${
            state.cdnEnabled
              ? 'bg-surface border-emerald-500/60 shadow-xs'
              : 'bg-surface/90 border-strong hover:border-accent'
          }`}
        >
          <div className="flex items-center justify-between gap-1 text-[11px] font-mono text-muted">
            <span>INGRESS</span>
            <span
              className={
                state.cdnEnabled
                  ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                  : 'text-amber-700 dark:text-amber-400'
              }
            >
              {state.cdnEnabled ? 'CDN ON' : '+ CDN'}
            </span>
          </div>
          <div className="text-xs sm:text-sm font-semibold text-ink mt-0.5 truncate">
            {state.cdnEnabled ? 'CDN + L7 ALB' : 'L7 Load Balancer'}
          </div>
          <div className="text-[11px] font-mono text-secondary mt-0.5 tabular-nums">
            {(state.rps / 1000).toFixed(0)}k RPS in
          </div>
        </button>

        {/* Node 2: Stateless API Tier */}
        <div
          style={{ left: '32%', top: '50%' }}
          className="absolute -translate-y-1/2 w-[23%] min-w-[112px] p-2.5 rounded border border-hairline bg-surface"
        >
          <div className="text-[11px] font-mono text-muted">COMPUTE</div>
          <div className="text-xs sm:text-sm font-semibold text-ink mt-0.5 truncate">
            API Fleet x8
          </div>
          <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 mt-0.5">
            Stateless · Healthy
          </div>
        </div>

        {/* Node 3: Redis Cache (Clickable Toggle) */}
        <button
          type="button"
          onClick={() => updateState({ redisEnabled: !state.redisEnabled })}
          style={{ right: '3%', top: '24%' }}
          className={`absolute -translate-y-1/2 w-[31%] min-w-[138px] text-left p-2.5 rounded border transition-all cursor-pointer ${
            state.redisEnabled
              ? 'bg-surface border-emerald-500/60 shadow-xs'
              : 'bg-surface/65 border-dashed border-strong opacity-75 hover:opacity-100'
          }`}
        >
          <div className="flex items-center justify-between gap-1 text-[11px] font-mono">
            <span className="text-muted">CACHE</span>
            <span
              className={
                state.redisEnabled
                  ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                  : 'text-muted'
              }
            >
              {state.redisEnabled ? `${telemetry.cacheHitPct}% HIT` : 'BYPASSED'}
            </span>
          </div>
          <div className="text-xs sm:text-sm font-semibold text-ink mt-0.5 truncate">
            Redis 64GB Cluster
          </div>
        </button>

        {/* Node 4: Primary Sharded Storage (Clickable Shard Toggle) */}
        <button
          type="button"
          onClick={() =>
            updateState({ dbShards: state.dbShards === 1 ? 4 : 1 })
          }
          style={{ right: '3%', top: '76%' }}
          className={`absolute -translate-y-1/2 w-[31%] min-w-[138px] text-left p-2.5 rounded border transition-all cursor-pointer ${
            (state.dbCrashed && !state.syncReplica) ||
            telemetry.dbUtilizationPct >= 98
              ? 'bg-red-500/10 border-red-500/70'
              : telemetry.dbUtilizationPct > 75
                ? 'bg-amber-500/10 border-amber-500/60'
                : 'bg-surface border-emerald-500/60'
          }`}
        >
          <div className="flex items-center justify-between gap-1 text-[11px] font-mono">
            <span className="text-muted">STORAGE</span>
            <span
              className={
                (state.dbCrashed && !state.syncReplica) ||
                telemetry.dbUtilizationPct >= 98
                  ? 'text-red-700 dark:text-red-400 font-semibold'
                  : 'text-secondary'
              }
            >
              {state.dbCrashed && !state.syncReplica
                ? 'CRASHED'
                : `${telemetry.dbUtilizationPct}% LOAD`}
            </span>
          </div>
          <div className="text-xs sm:text-sm font-semibold text-ink mt-0.5 truncate">
            Postgres Primary x{state.dbShards}
            {state.syncReplica ? ' + Sync' : ''}
          </div>
        </button>
      </div>

      {/* Interactive Controls Bar: Traffic Slider + Component Switches + Chaos Fault */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="flex items-center gap-3 flex-1 min-w-0 text-sm">
            <span className="font-medium text-ink shrink-0">
              Offered Traffic:
            </span>
            <input
              type="range"
              min={15000}
              max={120000}
              step={5000}
              value={state.rps}
              onChange={(e) => updateState({ rps: Number(e.target.value) })}
              className="flex-1 min-w-0 accent-accent h-1.5 bg-subtle rounded-lg cursor-pointer"
            />
            <span className="font-mono font-semibold text-ink tabular-nums w-24 text-right">
              {(state.rps / 1000).toFixed(0)},000 RPS
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          <button
            type="button"
            onClick={() => updateState({ cdnEnabled: !state.cdnEnabled })}
            className={`px-3 py-1.5 rounded border transition-colors cursor-pointer ${
              state.cdnEnabled
                ? 'border-ink bg-ink text-surface font-medium'
                : 'border-hairline text-secondary hover:text-ink hover:border-strong'
            }`}
          >
            {state.cdnEnabled ? '✓ CDN Edge' : '+ CDN Edge'}
          </button>

          <button
            type="button"
            onClick={() => updateState({ redisEnabled: !state.redisEnabled })}
            className={`px-3 py-1.5 rounded border transition-colors cursor-pointer ${
              state.redisEnabled
                ? 'border-ink bg-ink text-surface font-medium'
                : 'border-hairline text-secondary hover:text-ink hover:border-strong'
            }`}
          >
            {state.redisEnabled ? '✓ Redis Cache' : '+ Redis Cache'}
          </button>

          <button
            type="button"
            onClick={() =>
              updateState({ dbShards: state.dbShards === 1 ? 4 : 1 })
            }
            className={`px-3 py-1.5 rounded border transition-colors cursor-pointer ${
              state.dbShards === 4
                ? 'border-ink bg-ink text-surface font-medium'
                : 'border-hairline text-secondary hover:text-ink hover:border-strong'
            }`}
          >
            {state.dbShards === 4 ? '✓ 4x Salted Shards' : '1x DB -> Shard 4x'}
          </button>

          <button
            type="button"
            onClick={() => updateState({ syncReplica: !state.syncReplica })}
            className={`px-3 py-1.5 rounded border transition-colors cursor-pointer ${
              state.syncReplica
                ? 'border-ink bg-ink text-surface font-medium'
                : 'border-hairline text-secondary hover:text-ink hover:border-strong'
            }`}
          >
            {state.syncReplica ? '✓ Sync Replica' : '+ Sync Replica'}
          </button>

          <button
            type="button"
            onClick={() => updateState({ dbCrashed: !state.dbCrashed })}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border transition-colors cursor-pointer ml-auto ${
              state.dbCrashed
                ? 'border-red-500 bg-red-600 text-white font-medium'
                : 'border-red-500/40 text-red-700 dark:text-red-400 hover:bg-red-500/10'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>
              {state.dbCrashed ? 'Primary Crashed (Active)' : 'Inject DB Crash'}
            </span>
          </button>
        </div>
      </div>

      {/* Open Pageless Live Telemetry Readout */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-hairline border-y border-hairline py-3.5">
        <div className="pr-4 pb-2 sm:pb-0">
          <div className="text-xs text-muted">Tail Latency (SLO &le; 30ms)</div>
          <div
            className={`text-lg font-mono font-semibold tabular-nums mt-0.5 ${
              telemetry.p99Ms <= 30
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {telemetry.p99Ms} ms
          </div>
        </div>

        <div className=" sm:px-4 pb-2 sm:pb-0">
          <div className="text-xs text-muted">Availability (&ge; 99.9%)</div>
          <div
            className={`text-lg font-mono font-semibold tabular-nums mt-0.5 ${
              telemetry.availabilityPct >= 99.9
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {telemetry.availabilityPct}%
          </div>
        </div>

        <div className="pt-2 sm:pt-0 sm:px-4">
          <div className="text-xs text-muted">Cloud Cost (&le; $3,200)</div>
          <div
            className={`text-lg font-mono font-semibold tabular-nums mt-0.5 ${
              telemetry.monthlyCostUsd <= 3200
                ? 'text-ink'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            ${telemetry.monthlyCostUsd.toLocaleString()}/mo
          </div>
        </div>

        <div className="pt-2 sm:pt-0 sm:pl-4">
          <div className="text-xs text-muted">Live Judge Verdict</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span
              className={`text-base font-mono font-bold ${
                isAc
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {/* Zero-width break after each underscore so long verdict codes such as
                  AVAILABILITY_BREACH wrap inside the cell on narrow phones. */}
              {telemetry.verdict === 'AC'
                ? `AC · ${telemetry.score}pt`
                : telemetry.verdict.replace(/_/g, '_\u200b')}
            </span>
          </div>
        </div>
      </div>

      {/* Diagnostic Line + Direct Open in Full Arena */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2 text-secondary">
          {isAc ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <span>{telemetry.bottleneckNote}</span>
        </div>

        <Link
          href="/problems/url-shortener"
          className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline underline-offset-4 shrink-0"
        >
          <span>Solve HLD-201 in Full Arena</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
