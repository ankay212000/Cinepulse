'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import InteractiveArchitectureWidget, {
  SandboxState,
  SandboxTelemetry,
} from '@/components/InteractiveArchitectureWidget';
import { PUBLIC_JUDGE_FACTS } from '@/lib/scoringScale';
import type { PublicProblemSummary } from '@/types';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Layers,
  Play,
} from 'lucide-react';

interface SandboxScenario {
  step: number;
  shortTitle: string;
  title: string;
  summary: string;
  presetLabel: string;
  preset: Partial<SandboxState>;
}

const SANDBOX_SCENARIOS: SandboxScenario[] = [
  {
    step: 1,
    shortTitle: 'See a Bottleneck',
    title: 'Watch a single database slow down under heavy traffic',
    summary:
      'Every question gives you clear traffic, latency, and budget targets. Try sending 85,000 requests/sec into a single database shard to see latency spike past the 30 ms target.',
    presetLabel: 'Test 85k Traffic Spike',
    preset: {
      rps: 85000,
      cdnEnabled: false,
      redisEnabled: true,
      dbShards: 1,
      syncReplica: false,
      dbCrashed: false,
    },
  },
  {
    step: 2,
    shortTitle: 'Scale & Cache',
    title: 'Add a CDN and split the database into 4 shards',
    summary:
      'In the arena, you draw boxes, connect arrows, and explain your choices in plain English. Adding edge caching and 4 database shards brings latency right back under budget.',
    presetLabel: 'Add CDN + 4 DB Shards',
    preset: {
      rps: 105000,
      cdnEnabled: true,
      redisEnabled: true,
      dbShards: 4,
      syncReplica: false,
      dbCrashed: false,
    },
  },
  {
    step: 3,
    shortTitle: 'Test Failover',
    title: 'Keep the system online when a primary database crashes',
    summary:
      'Real interviews ask what happens when hardware fails. With a standby replica enabled, traffic automatically fails over in 1.4 seconds instead of dropping requests.',
    presetLabel: 'Simulate DB Crash + Failover',
    preset: {
      rps: 105000,
      cdnEnabled: true,
      redisEnabled: true,
      dbShards: 4,
      syncReplica: true,
      dbCrashed: true,
    },
  },
  {
    step: 4,
    shortTitle: 'Earn Accepted (AC)',
    title: 'Pass all checks within the monthly cloud budget',
    summary:
      'When your diagram and write-up meet latency, availability, and cost targets, you earn an Accepted (AC) verdict and unlock verified community solutions.',
    presetLabel: 'Run Passing Design',
    preset: {
      rps: 105000,
      cdnEnabled: true,
      redisEnabled: true,
      dbShards: 4,
      syncReplica: true,
      dbCrashed: false,
    },
  },
];

/*
  "How scoring works, and what it cannot judge".

  Every sentence here is a claim about the judge, so keep it true: the numbers come
  from PUBLIC_JUDGE_FACTS (checked against the engine by publicJudgeFacts.test.ts),
  and nothing goes beyond what /rules already publishes.
*/
const { totalTestCases, hiddenTestCases, writeupSharePct } = PUBLIC_JUDGE_FACTS;

const SCORING_STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Your diagram is simulated.',
    body: `Boxes and arrows become a graph. ${totalTestCases} test cases push traffic through it, including hot-key spikes, crashed nodes and peak load, and check p99 latency, availability and monthly cost against the question's limits. ${hiddenTestCases} of the ${totalTestCases} are hidden.`,
  },
  {
    title: 'Your write-up is checked by fixed rules.',
    body: 'You earn marks for explaining each functional requirement, your data keys, failure handling and every box you drew, in full sentences. Keyword lists, copied prompt text and unfilled templates fail.',
  },
  {
    title: `Marks are ${writeupSharePct}% write-up, ${100 - writeupSharePct}% simulation.`,
    body: `Accepted needs both: the write-up check and every limit in all ${totalTestCases} test cases.`,
  },
];

const SCORING_LIMITS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Whether your reasoning is right.',
    body: 'The write-up check is pattern matching, not understanding. It can tell that a requirement was explained, not that the explanation is correct.',
  },
  {
    title: 'What a real cloud would do.',
    body: 'The simulator recognises a fixed set of component types by their labels and prices them from a fixed cost table. The numbers compare designs; they do not predict production.',
  },
  {
    title: 'The interview conversation.',
    body: 'No follow-up questions, and no credit for trade-offs you would argue out loud.',
  },
];

export default function HomeView({
  problems,
}: {
  problems: PublicProblemSummary[];
}) {
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Record<number, boolean>>(
    {}
  );
  const [presetCounter, setPresetCounter] = useState(0);
  const [activePreset, setActivePreset] =
    useState<Partial<SandboxState> | null>(null);
  const [lastSimulatedStep, setLastSimulatedStep] = useState<number | null>(
    null
  );

  const currentScenario = SANDBOX_SCENARIOS[activeStepIdx];

  function handleSandboxInteract(
    state: SandboxState,
    telemetry: SandboxTelemetry
  ) {
    setCompletedSteps((prev) => {
      const next: Record<number, boolean> = { ...prev, 1: true };
      if (state.dbShards === 4 || state.cdnEnabled) next[2] = true;
      if (state.dbCrashed && state.syncReplica) next[3] = true;
      if (telemetry.verdict === 'AC') next[4] = true;
      return next;
    });
  }

  function applyScenario(scenario: SandboxScenario) {
    setActivePreset(scenario.preset);
    setPresetCounter((c) => c + 1);
    setCompletedSteps((prev) => ({ ...prev, [scenario.step]: true }));
    setLastSimulatedStep(scenario.step);
  }

  return (
    <div className="min-h-screen flex flex-col bg-app text-ink">
      <SiteHeader activeNav="home" />

      <main className="flex-1 w-full max-w-[1480px] mx-auto px-6 sm:px-10 lg:px-14 py-12 sm:py-16 space-y-16">
        {/* 1. Calm, Welcoming Hero + Product Preview */}
        <section className="grid grid-cols-1 xl:grid-cols-12 gap-10 xl:gap-14 items-center">
          {/* Left 6 Columns: Clear Value Prop & Simple Actions */}
          <div className="xl:col-span-6 space-y-7">
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-accent font-semibold">
              <span>Free System Design Practice</span>
              <span className="text-muted">&middot;</span>
              <span className="text-secondary">Try Sample Runs Without Login</span>
            </div>

            <div className="space-y-4">
              <h1 className="text-3xl sm:text-4xl lg:text-[2.65rem] font-semibold tracking-tight text-ink leading-[1.16]">
                Practice System Design by actually testing your architecture.
              </h1>
              <p className="text-base sm:text-[17px] text-secondary leading-relaxed max-w-xl">
                Sketch boxes and arrows on a clean whiteboard, explain how your system works in plain English, and run a 60-second traffic simulation for instant feedback across {problems.length} interview questions.
              </p>
            </div>

            {/* Clean, Focused Primary Actions */}
            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              <Link
                href="/problemset"
                className="inline-flex items-center gap-2.5 px-5 py-3 rounded bg-accent hover:bg-accent-hover text-white text-[15px] font-medium transition-colors"
              >
                <Layers className="w-4 h-4" />
                <span>Browse Problemset</span>
                <ArrowRight className="w-4 h-4" />
              </Link>

              <Link
                href="/sheets"
                className="inline-flex items-center gap-2 px-5 py-3 rounded border border-strong hover:border-ink text-[15px] font-medium text-ink transition-colors"
              >
                <BookOpen className="w-4 h-4 text-accent" />
                <span>Must-Do 30 Sheet</span>
              </Link>

              <Link
                href="/problems/distributed-rate-limiter"
                className="inline-flex items-center gap-1.5 px-2 py-2 text-[15px] font-medium text-secondary hover:text-ink transition-colors"
              >
                <Play className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Try an Easy Question</span>
              </Link>
            </div>

            {/* Simple 3-Step Plain-English Summary */}
            <div className="pt-6 border-t border-hairline grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-ink">
                  1. Pick a question
                </div>
                <p className="text-sm text-secondary leading-relaxed">
                  Start with beginner prompts or follow curated company sheets.
                </p>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-semibold text-ink">
                  2. Sketch &amp; explain
                </div>
                <p className="text-sm text-secondary leading-relaxed">
                  Draw components on the canvas and write simple design notes.
                </p>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-semibold text-ink">
                  3. Simulate traffic
                </div>
                <p className="text-sm text-secondary leading-relaxed">
                  See latency, failovers, and cloud cost tested in seconds.
                </p>
              </div>
            </div>
          </div>

          {/* Right 6 Columns: Clean Product Walkthrough GIF */}
          <div className="xl:col-span-6 space-y-2.5">
            <div className="flex items-center justify-between gap-3 px-0.5">
              <span className="text-xs font-mono uppercase tracking-wider text-muted">
                Workspace Preview
              </span>

              <Link
                href="/problems/url-shortener"
                className="text-xs sm:text-sm font-medium text-secondary hover:text-ink inline-flex items-center gap-1 transition-colors"
              >
                <span>Open URL Shortener</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="rounded-md border border-hairline overflow-hidden bg-canvas shadow-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/judgesystem-walkthrough.gif"
                alt="HLDArena workspace preview showing architecture diagramming, plain-English notes, and traffic simulation"
                className="w-full h-auto block select-none"
              />
            </div>
          </div>
        </section>

        {/* 2. Interactive Mini Sandbox — Calm, Hands-On & Optional */}
        <section className="border-t border-hairline pt-14 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="space-y-1">
              <div className="font-mono text-xs uppercase tracking-wider text-accent font-semibold">
                Interactive Sandbox
              </div>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">
                Try a Live Traffic Simulation
              </h2>
            </div>

            <p className="text-sm text-secondary">
              Toggle components directly or click through the 4 quick scenarios below.
            </p>
          </div>

          {/* Clean 4-Scenario Tabs */}
          <div className="flex items-center gap-8 overflow-x-auto border-b border-hairline">
            {SANDBOX_SCENARIOS.map((s, idx) => {
              const active = idx === activeStepIdx;
              const done = Boolean(completedSteps[s.step]);
              return (
                <button
                  key={s.step}
                  type="button"
                  onClick={() => setActiveStepIdx(idx)}
                  className={`relative pb-3.5 text-left shrink-0 transition-colors cursor-pointer ${
                    active
                      ? 'text-ink after:content-[""] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-ink'
                      : 'text-secondary hover:text-ink'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <span
                      className={
                        active ? 'text-accent font-semibold' : 'text-muted'
                      }
                    >
                      0{s.step}
                    </span>
                    {done && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    )}
                  </div>
                  <div
                    className={`text-[15px] mt-0.5 ${
                      active ? 'font-semibold text-ink' : 'font-medium'
                    }`}
                  >
                    {s.shortTitle}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Side-by-Side: Concise Plain-English Explanation (Left) + Live Sandbox (Right) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-10 xl:gap-12 items-start">
            <div className="xl:col-span-4 space-y-5 pt-1">
              <div className="space-y-2.5">
                <div className="font-mono text-xs text-muted uppercase tracking-wider">
                  Scenario 0{currentScenario.step} of 04
                </div>
                <h3 className="text-xl font-semibold text-ink leading-snug">
                  {currentScenario.title}
                </h3>
                <p className="text-[15px] text-secondary leading-relaxed">
                  {currentScenario.summary}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => applyScenario(currentScenario)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{currentScenario.presetLabel}</span>
                </button>

                {lastSimulatedStep === currentScenario.step && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Running in Sandbox</span>
                  </span>
                )}
              </div>

              <div className="pt-4 border-t border-hairline flex items-center justify-between gap-3">
                {activeStepIdx < SANDBOX_SCENARIOS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setActiveStepIdx((i) => i + 1)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-secondary hover:text-ink transition-colors cursor-pointer"
                  >
                    <span>
                      Next: {SANDBOX_SCENARIOS[activeStepIdx + 1].shortTitle}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <Link
                    href="/problemset"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline underline-offset-4"
                  >
                    <span>Ready? Pick your first question</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                )}
              </div>
            </div>

            <div className="xl:col-span-8 xl:pl-10 xl:border-l border-hairline">
              <InteractiveArchitectureWidget
                externalPresetCounter={presetCounter}
                externalPreset={activePreset}
                onInteract={handleSandboxInteract}
              />
            </div>
          </div>
        </section>

        {/* 3. How scoring works, and what it cannot judge */}
        <section
          id="how-scoring-works"
          aria-labelledby="how-scoring-works-heading"
          className="border-t border-hairline pt-14 space-y-8"
        >
          <div className="space-y-2">
            <div className="font-mono text-xs uppercase tracking-wider text-accent font-semibold">
              Scoring
            </div>
            <h2
              id="how-scoring-works-heading"
              className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink"
            >
              How scoring works, and what it cannot judge
            </h2>
            <p className="text-[15px] text-secondary leading-relaxed">
              No AI model and nothing random: the same design always gets the
              same score.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-0">
            <div className="space-y-4 lg:pr-12">
              <h3 className="text-lg font-semibold text-ink">
                How a submission is scored
              </h3>
              <ol className="space-y-4">
                {SCORING_STEPS.map((step, idx) => (
                  <li key={step.title} className="space-y-1">
                    <div className="text-[15px] font-semibold text-ink">
                      {idx + 1}. {step.title}
                    </div>
                    <p className="text-[15px] text-secondary leading-relaxed">
                      {step.body}
                    </p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-4 lg:pl-12 lg:border-l border-hairline">
              <h3 className="text-lg font-semibold text-ink">
                What it cannot judge
              </h3>
              <ul className="space-y-4">
                {SCORING_LIMITS.map((limit) => (
                  <li key={limit.title} className="space-y-1">
                    <div className="text-[15px] font-semibold text-ink">
                      {limit.title}
                    </div>
                    <p className="text-[15px] text-secondary leading-relaxed">
                      {limit.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <Link
            href="/rules"
            id="how-scoring-rules-link"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline underline-offset-4"
          >
            <span>Full rules: marks, cost table and verdict codes</span>
            <ArrowRight className="w-4 h-4 shrink-0" />
          </Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
