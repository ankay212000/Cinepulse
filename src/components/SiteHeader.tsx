'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  LogOut,
  User as UserIcon,
  Terminal,
  X,
} from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { useAuth } from './AuthProvider';
import { deriveRatingProgression } from '@/lib/ratingSystem';
import type { PublicProblemNavLink } from '@/types';

interface SiteHeaderProps {
  activeNav:
    | 'home'
    | 'problemset'
    | 'sheets'
    | 'leaderboard'
    | 'workspace'
    | 'profile'
    | 'community'
    | 'rules';
  currentProblem?: PublicProblemNavLink;
  prevProblem?: PublicProblemNavLink | null;
  nextProblem?: PublicProblemNavLink | null;
  rightActions?: React.ReactNode;
}

function GoogleMark() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v2.98h3.86c2.26-2.09 3.56-5.17 3.56-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-2.98c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.31c-.24-.72-.38-1.49-.38-2.31s.14-1.59.38-2.31V6.6H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.4l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.6l3.98 3.09c.95-2.85 3.6-4.94 6.73-4.94z"
      />
    </svg>
  );
}

function BrandGlyph() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="text-accent shrink-0"
    >
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <polygon
        points="16,4.8 25.7,10.4 25.7,21.6 16,27.2 6.3,21.6 6.3,10.4"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <line
        x1="16"
        y1="4.8"
        x2="16"
        y2="11.5"
        stroke="#ffffff"
        strokeWidth="2.2"
      />
      <line
        x1="6.3"
        y1="21.6"
        x2="12.2"
        y2="18.2"
        stroke="#ffffff"
        strokeWidth="2.2"
      />
      <line
        x1="25.7"
        y1="21.6"
        x2="19.8"
        y2="18.2"
        stroke="#ffffff"
        strokeWidth="2.2"
      />
      <polygon points="16,11 21,16 16,21 11,16" fill="#ffffff" />
    </svg>
  );
}

export default function SiteHeader({
  activeNav,
  currentProblem,
  prevProblem = null,
  nextProblem = null,
  rightActions,
}: SiteHeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const {
    user,
    profile,
    authLoading,
    signingIn,
    isDevDummyAvailable,
    isDummyUser,
    authError,
    clearAuthError,
    signInWithGoogle,
    signInAsDummyUser,
    signOutUser,
    syncPreferences,
  } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setImgFailed(false);
  }, [user?.photoURL]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const displayHandle =
    user?.displayName?.split(' ')[0] ||
    user?.email?.split('@')[0] ||
    'Account';
  const initialChar = (
    user?.displayName?.[0] ||
    user?.email?.[0] ||
    'U'
  ).toUpperCase();

  const headerRating = useMemo(
    () =>
      profile
        ? deriveRatingProgression(
            profile.progressSummary,
            null,
            profile.ratingHistory
          )
        : null,
    [profile]
  );

  function handleThemeClick() {
    const nextMode = theme === 'dark' ? 'light' : 'dark';
    toggleTheme();
    void syncPreferences({ preferredTheme: nextMode });
  }

  const isArena = Boolean(currentProblem);
  const hasAuthCluster = Boolean(user) || !authLoading;

  return (
    <>
      {/*
        Below `xl` the header wraps into two rows: brand + account controls on top,
        then the primary nav (or the problem breadcrumb with Run / Submit).
        From `xl` up it is a single row (the six nav links plus a signed-in account
        chip need about 1200px). One DOM tree serves both layouts via flex `order`,
        so element ids such as #run-sample-btn stay unique.

        The background is solid on purpose: the theme colors are plain CSS variables,
        so Tailwind emits nothing for opacity variants such as `bg-app/95`, which left
        the sticky header see-through.

        On very short screens (a phone held sideways) the header scrolls away with
        the page, so it does not take a quarter of the height from the whiteboard.
      */}
      <header
        className={`${
          isArena ? 'sticky' : 'relative md:sticky'
        } [@media(max-height:520px)]:relative top-0 z-30 bg-app border-b border-hairline shrink-0`}
      >
        <div
          className={`${
            isArena
              ? 'px-4 sm:px-6 xl:h-14'
              : 'px-4 min-[380px]:px-6 sm:px-10 lg:px-14 xl:h-16 max-w-[1640px] mx-auto w-full'
          } flex flex-wrap xl:flex-nowrap items-center xl:justify-between gap-x-2 sm:gap-x-3 xl:gap-6`}
        >
          <div className="contents xl:flex xl:items-center xl:gap-7 xl:h-full xl:min-w-0">
            <Link
              href="/"
              className="order-1 xl:order-none mr-auto xl:mr-0 h-12 xl:h-auto inline-flex items-center gap-2.5 font-mono font-semibold text-base tracking-tight text-ink hover:opacity-80 transition-opacity shrink-0"
            >
              <BrandGlyph />
              <span>HLDArena</span>
            </Link>

            <span
              className="hidden xl:inline text-strong text-sm select-none"
              aria-hidden="true"
            >
              /
            </span>

            {currentProblem ? (
              <nav
                aria-label="Question breadcrumb"
                className="order-5 xl:order-none flex-1 xl:flex-initial min-w-0 overflow-hidden h-11 xl:h-auto flex items-center gap-2 sm:gap-2.5 text-sm"
              >
                <Link
                  href="/problemset"
                  aria-label="Back to Problemset"
                  className="sm:hidden -ml-1 p-1 rounded text-secondary hover:text-ink transition-colors shrink-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Link>

                <Link
                  href="/problemset"
                  className="hidden sm:inline text-secondary hover:text-ink font-medium transition-colors shrink-0"
                >
                  Problemset
                </Link>

                <ChevronRight
                  className="hidden sm:block w-4 h-4 text-muted shrink-0"
                  aria-hidden="true"
                />

                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono text-xs font-semibold text-accent shrink-0">
                    {currentProblem.code}
                  </span>
                  {/* Below 360px only a stray letter of the title would fit. */}
                  <span className="hidden min-[360px]:block text-ink font-medium truncate max-w-[180px] sm:max-w-[340px] lg:max-w-[460px]">
                    {currentProblem.title}
                  </span>

                  <div className="hidden sm:flex items-center ml-1 border border-hairline rounded overflow-hidden shrink-0">
                    {prevProblem ? (
                      <Link
                        href={`/problems/${prevProblem.id}`}
                        title={`Previous: ${prevProblem.code} ${prevProblem.title}`}
                        className="p-1.5 text-secondary hover:text-ink hover:bg-subtle transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Link>
                    ) : (
                      <span className="p-1.5 text-strong cursor-not-allowed">
                        <ChevronLeft className="w-4 h-4" />
                      </span>
                    )}
                    {nextProblem ? (
                      <Link
                        href={`/problems/${nextProblem.id}`}
                        title={`Next: ${nextProblem.code} ${nextProblem.title}`}
                        className="p-1.5 border-l border-hairline text-secondary hover:text-ink hover:bg-subtle transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    ) : (
                      <span className="p-1.5 border-l border-hairline text-strong cursor-not-allowed">
                        <ChevronRight className="w-4 h-4" />
                      </span>
                    )}
                  </div>
                </div>
              </nav>
            ) : (
              <nav
                aria-label="Primary navigation"
                className="nav-scroll-x order-5 xl:order-none basis-full xl:basis-auto min-w-0 overflow-x-auto h-11 xl:h-full flex items-center gap-5 sm:gap-6 lg:gap-7 pr-10 xl:pr-0 text-sm sm:text-[15px]"
              >
                {(
                  [
                    ['home', '/', 'Home'],
                    ['problemset', '/problemset', 'Problemset'],
                    ['sheets', '/sheets', 'Sheets'],
                    ['leaderboard', '/leaderboard', 'Leaderboard'],
                    ['community', '/community', 'Community'],
                    ['rules', '/rules', 'Rules'],
                  ] as const
                ).map(([key, href, label]) => {
                  const active = activeNav === key;
                  return (
                    <Link
                      key={key}
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={`relative h-full inline-flex items-center px-1 transition-colors shrink-0 ${
                        active
                          ? 'text-ink font-semibold after:content-[""] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-ink'
                          : 'text-secondary hover:text-ink font-normal'
                      }`}
                    >
                      {label}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>

          <div className="contents xl:flex xl:items-center xl:gap-3 xl:shrink-0">
            <button
              type="button"
              id="theme-toggle-btn"
              onClick={handleThemeClick}
              title={
                theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
              }
              className="order-2 xl:order-none flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded border border-hairline hover:border-strong text-sm text-secondary hover:text-ink transition-colors cursor-pointer shrink-0"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-secondary" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>

            {rightActions && (
              <div className="order-6 xl:order-none flex items-center shrink-0">
                {rightActions}
              </div>
            )}

            {hasAuthCluster && (
              <div className="order-3 xl:order-none flex items-center gap-2 sm:gap-3 shrink-0">
                {process.env.NODE_ENV === 'development' &&
                  !authLoading &&
                  !user &&
                  isDevDummyAvailable && (
                    <button
                      type="button"
                      id="dummy-signin-btn"
                      onClick={signInAsDummyUser}
                      title="Local dev test account (stripped in production)"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20 text-sm font-medium text-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
                    >
                      <Terminal className="w-4 h-4" />
                      <span className="hidden sm:inline">Dummy User</span>
                    </button>
                  )}

                {!authLoading && !user && (
                  <button
                    type="button"
                    id="google-signin-btn"
                    disabled={signingIn}
                    onClick={() => void signInWithGoogle()}
                    className="flex items-center gap-2 px-3.5 py-1.5 rounded border border-strong bg-surface hover:bg-subtle disabled:opacity-60 text-sm font-medium text-ink transition-colors cursor-pointer"
                  >
                    <GoogleMark />
                    <span>{signingIn ? 'Signing in...' : 'Sign in'}</span>
                  </button>
                )}

                {user && (
                  <div className="relative" ref={menuRef}>
                    <button
                      type="button"
                      id="account-menu-btn"
                      onClick={() => setMenuOpen((v) => !v)}
                      className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded border border-hairline hover:border-strong text-sm text-ink transition-colors cursor-pointer"
                    >
                      {user.photoURL && !imgFailed ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={user.photoURL}
                          alt=""
                          referrerPolicy="no-referrer"
                          onError={() => setImgFailed(true)}
                          className="w-5 h-5 rounded-full object-cover"
                        />
                      ) : (
                        <span
                          className={`w-5 h-5 rounded-full font-mono text-[11px] font-semibold flex items-center justify-center ${
                            isDummyUser
                              ? 'bg-amber-600 text-white'
                              : 'bg-accent text-white'
                          }`}
                        >
                          {initialChar}
                        </span>
                      )}
                      <span className="hidden sm:inline font-medium max-w-[120px] truncate">
                        {displayHandle}
                      </span>
                      {process.env.NODE_ENV === 'development' && isDummyUser && (
                        <span className="hidden lg:inline px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-800 dark:text-amber-300 font-mono text-[10px]">
                          DEV
                        </span>
                      )}
                      {profile && headerRating && (
                        <span className="hidden md:inline-flex items-center gap-1.5 font-mono text-xs font-semibold tabular-nums pl-1.5 border-l border-hairline">
                          <span className={headerRating.tier.textClass}>
                            {headerRating.currentRating}
                          </span>
                          <span className="text-muted font-normal">·</span>
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {profile.stats.acceptedCount} AC
                          </span>
                        </span>
                      )}
                    </button>

                    {menuOpen && (
                      <div className="absolute right-0 mt-2 w-72 rounded border border-strong bg-surface shadow-lg py-2.5 z-50 text-sm">
                        <div className="px-4 pb-2.5 border-b border-hairline">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-ink truncate">
                              {user.displayName || 'Signed-in User'}
                            </div>
                            {process.env.NODE_ENV === 'development' && isDummyUser && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 dark:text-amber-300 font-mono text-[10px] shrink-0">
                                Local Dummy
                              </span>
                            )}
                          </div>
                          {user.email && (
                            <div className="text-xs text-muted truncate mt-0.5">
                              {user.email}
                            </div>
                          )}
                        </div>

                        {profile && headerRating && (
                          <div className="px-4 py-2.5 border-b border-hairline grid grid-cols-4 gap-1.5 text-center">
                            <div>
                              <div
                                className={`font-mono font-semibold tabular-nums ${headerRating.tier.textClass}`}
                              >
                                {headerRating.currentRating}
                              </div>
                              <div className="text-[11px] text-muted">Rating</div>
                            </div>
                            <div>
                              <div className="font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                {profile.stats.acceptedCount}
                              </div>
                              <div className="text-[11px] text-muted">Accepted</div>
                            </div>
                            <div>
                              <div className="font-mono font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
                                {profile.stats.attemptedCount}
                              </div>
                              <div className="text-[11px] text-muted">Attempted</div>
                            </div>
                            <div>
                              <div className="font-mono font-semibold text-accent tabular-nums">
                                {profile.stats.totalSubmissions}
                              </div>
                              <div className="text-[11px] text-muted">Runs</div>
                            </div>
                          </div>
                        )}

                        <div className="pt-1.5 px-2 space-y-0.5">
                          <Link
                            href="/profile"
                            onClick={() => setMenuOpen(false)}
                            className="w-full px-2.5 py-2 rounded flex items-center gap-2.5 text-left text-secondary hover:text-ink hover:bg-subtle transition-colors"
                          >
                            <UserIcon className="w-4 h-4 text-accent" />
                            <span>Profile &amp; Activity</span>
                          </Link>

                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false);
                              void signOutUser();
                            }}
                            className="w-full px-2.5 py-2 rounded flex items-center gap-2.5 text-left text-secondary hover:text-ink hover:bg-subtle transition-colors cursor-pointer"
                          >
                            <LogOut className="w-4 h-4 text-red-600 dark:text-red-400" />
                            <span>Sign out</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Forces the wrap between the two rows; removed from xl up */}
          <div aria-hidden="true" className="order-4 basis-full h-0 xl:hidden" />
        </div>
      </header>

      {authError && (
        <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between gap-3 text-sm text-amber-800 dark:text-amber-300">
          <span>{authError}</span>
          <button
            type="button"
            onClick={clearAuthError}
            aria-label="Dismiss authentication message"
            className="p-1 rounded hover:bg-amber-500/20 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  );
}
