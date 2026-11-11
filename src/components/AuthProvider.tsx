'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import { getFirebaseAuth, getGoogleAuthProvider } from '@/lib/firebase';
import { UserProfileDoc } from '@/lib/dbSchema';
import { clearGuestDrafts } from '@/lib/draftStorage';
import {
  createMockDummyFirebaseUser,
  DEV_DUMMY_UID,
  isClientLocalDummyAllowed,
  isDummySessionActiveInStorage,
  loadOrInitDummyProfile,
  recordSubmissionIntoDummyProfile,
  resetDummyProfileInStorage,
  saveDummyProfile,
  setDummySessionActiveInStorage,
} from '@/lib/dummyAuth';
import {
  ensureUserProfileAndSyncLocal,
  LegacyLocalRunRecord,
  subscribeToUserProfile,
  updateUserPreferencesInCloud,
} from '@/lib/firestoreRepo';
import type { EvaluationResult, SubmissionSnapshot } from '@/types';
import { useTheme, ThemeMode } from '@/components/ThemeProvider';

const LEGACY_STORAGE_DRAFTS_KEY = 'sysjudge_drafts_v1';
const LEGACY_STORAGE_RUNS_KEY = 'sysjudge_runs_meta_v1';
const STORAGE_HEIGHT_KEY = 'sysjudge_canvas_height_v2';

function clearLegacyUnscopedLocalKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_DRAFTS_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_RUNS_KEY);
    // Old per-tab guest drafts only. Guest drafts now live in localStorage (see
    // `draftStorage.ts`) and must survive this call, which runs on every page load.
    window.sessionStorage.removeItem('sysjudge_guest_drafts_v1');
  } catch {
    // Ignore storage access errors
  }
}

export interface AuthContextValue {
  user: User | null;
  profile: UserProfileDoc | null;
  authLoading: boolean;
  signingIn: boolean;
  isDevDummyAvailable: boolean;
  isDummyUser: boolean;
  cloudError: string | null;
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<void>;
  signInAsDummyUser: () => void;
  recordDummySubmission: (evaluation: EvaluationResult) => void;
  resetDummyProfile: () => void;
  signOutUser: () => Promise<void>;
  syncPreferences: (prefs: {
    preferredTheme?: ThemeMode;
    canvasHeight?: number;
  }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  authLoading: true,
  signingIn: false,
  isDevDummyAvailable: false,
  isDummyUser: false,
  cloudError: null,
  authError: null,
  clearAuthError: () => {},
  signInWithGoogle: async () => {},
  signInAsDummyUser: () => {},
  recordDummySubmission: () => {},
  resetDummyProfile: () => {},
  signOutUser: async () => {},
  syncPreferences: async () => {},
});

function formatAuthError(err: unknown): string | null {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';

  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request'
  ) {
    return null;
  }

  if (code === 'auth/unauthorized-domain') {
    const host =
      typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Domain "${host}" is not yet authorized for Google Sign-In. Add "${host}" (hostname only, no protocol or port) in Firebase Console → Authentication → Settings → Authorized domains.`;
  }

  if (
    code === 'auth/operation-not-allowed' ||
    code === 'auth/configuration-not-found'
  ) {
    return 'Google Sign-In is not enabled yet in project judge-system-9837a. Enable the Google provider in Firebase Console → Authentication → Sign-in method.';
  }

  if (err instanceof Error) {
    return err.message;
  }
  return 'Google Sign-In failed. Please try again.';
}

function formatFirestoreError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  if (code === 'permission-denied') {
    return 'Firestore rules blocked access (deploy firestore.rules to judge-system-9837a). Local progress remains active.';
  }
  if (code === 'not-found' || code === 'failed-precondition') {
    return 'Firestore database is not provisioned yet on judge-system-9837a. Local progress remains active.';
  }
  return err instanceof Error ? err.message : 'Cloud sync unavailable';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileDoc | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [isDevDummyAvailable, setIsDevDummyAvailable] = useState<boolean>(false);
  const [isDummyUser, setIsDummyUser] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (typeof window === 'undefined' || !isClientLocalDummyAllowed()) return;
    if (new URLSearchParams(window.location.search).get('dummy') === '1' && !isDummyUser) {
      setDummySessionActiveInStorage(true);
      setUser(createMockDummyFirebaseUser());
      setProfile(loadOrInitDummyProfile());
      setIsDummyUser(true);
      setCloudError(null);
      setAuthLoading(false);
    }
  }, [pathname, isDummyUser]);

  useEffect(() => {
    const dummyAllowed =
      process.env.NODE_ENV === 'development' && isClientLocalDummyAllowed();
    setIsDevDummyAvailable(dummyAllowed);

    const urlForcesDummy =
      process.env.NODE_ENV === 'development' &&
      dummyAllowed &&
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('dummy') === '1';

    if (process.env.NODE_ENV === 'development' && urlForcesDummy) {
      setDummySessionActiveInStorage(true);
      const mockUser = createMockDummyFirebaseUser();
      const dummyProfile = loadOrInitDummyProfile();
      setUser(mockUser);
      setProfile(dummyProfile);
      setIsDummyUser(true);
      setCloudError(null);
      setAuthLoading(false);
    }

    const auth = getFirebaseAuth();
    let unsubProfile: (() => void) | null = null;
    let cancelled = false;

    getRedirectResult(auth).catch((err) => {
      if (cancelled) return;
      const msg = formatAuthError(err);
      if (msg) setAuthError(msg);
    });

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (cancelled) return;

      if (!firebaseUser || urlForcesDummy) {
        if (
          process.env.NODE_ENV === 'development' &&
          dummyAllowed &&
          isDummySessionActiveInStorage()
        ) {
          const mockUser = createMockDummyFirebaseUser();
          const dummyProfile = loadOrInitDummyProfile();
          setUser(mockUser);
          setProfile(dummyProfile);
          setIsDummyUser(true);
          setCloudError(null);
          setAuthLoading(false);
          return;
        }

        clearLegacyUnscopedLocalKeys();
        setUser(null);
        setProfile(null);
        setIsDummyUser(false);
        setCloudError(null);
        setAuthLoading(false);
        return;
      }

      setDummySessionActiveInStorage(false);
      setIsDummyUser(false);
      setUser(firebaseUser);

      try {
        let localDrafts: Record<string, SubmissionSnapshot> = {};
        let localRuns: Record<string, LegacyLocalRunRecord[]> = {};
        let savedHeight: number | undefined;

        try {
          const rawDrafts =
            window.localStorage.getItem(`sysjudge_drafts_v2:${firebaseUser.uid}`) ??
            window.localStorage.getItem(LEGACY_STORAGE_DRAFTS_KEY);
          if (rawDrafts) localDrafts = JSON.parse(rawDrafts);
          const rawRuns =
            window.localStorage.getItem(`sysjudge_runs_meta_v2:${firebaseUser.uid}`) ??
            window.localStorage.getItem(LEGACY_STORAGE_RUNS_KEY);
          if (rawRuns) localRuns = JSON.parse(rawRuns);
          clearLegacyUnscopedLocalKeys();
          const rawH = window.localStorage.getItem(STORAGE_HEIGHT_KEY);
          if (rawH && Number.isFinite(Number(rawH))) {
            savedHeight = Number(rawH);
          }
        } catch {
          // Ignore malformed localStorage
        }

        const syncedProfile = await ensureUserProfileAndSyncLocal(
          firebaseUser,
          localDrafts,
          localRuns,
          theme,
          savedHeight
        );

        if (!cancelled) {
          setProfile(syncedProfile);
          setCloudError(null);
          if (
            syncedProfile.preferredTheme &&
            syncedProfile.preferredTheme !== theme
          ) {
            setTheme(syncedProfile.preferredTheme);
          }
        }

        unsubProfile = subscribeToUserProfile(
          firebaseUser.uid,
          (liveProfile) => {
            if (!cancelled && liveProfile) {
              setProfile(liveProfile);
              setCloudError(null);
            }
          },
          (err) => {
            if (!cancelled) {
              setCloudError(formatFirestoreError(err));
            }
          }
        );
      } catch (err) {
        if (!cancelled) {
          setCloudError(formatFirestoreError(err));
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    setSigningIn(true);
    const auth = getFirebaseAuth();
    const provider = getGoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      if (code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, provider);
        return;
      }
      const msg = formatAuthError(err);
      if (msg) setAuthError(msg);
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signInAsDummyUser = useCallback(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (!isClientLocalDummyAllowed()) return;
    setAuthError(null);
    setCloudError(null);
    setDummySessionActiveInStorage(true);
    const mockUser = createMockDummyFirebaseUser();
    const dummyProfile = loadOrInitDummyProfile();
    setUser(mockUser);
    setProfile(dummyProfile);
    setIsDummyUser(true);
    setAuthLoading(false);
  }, []);

  const recordDummySubmission = useCallback(
    (evaluation: EvaluationResult) => {
      if (process.env.NODE_ENV !== 'development') return;
      if (!isClientLocalDummyAllowed()) return;
      setProfile((prev) => recordSubmissionIntoDummyProfile(prev, evaluation));
    },
    []
  );

  const resetDummyProfile = useCallback(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (!isClientLocalDummyAllowed()) return;
    const fresh = resetDummyProfileInStorage();
    setProfile(fresh);
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthError(null);
    clearLegacyUnscopedLocalKeys();
    // Signing out leaves a clean guest workspace on this browser
    clearGuestDrafts();
    if (
      process.env.NODE_ENV === 'development' &&
      (isDummyUser || user?.uid === DEV_DUMMY_UID)
    ) {
      setDummySessionActiveInStorage(false);
      setIsDummyUser(false);
      setUser(null);
      setProfile(null);
      return;
    }
    const auth = getFirebaseAuth();
    await signOut(auth);
  }, [isDummyUser, user?.uid]);

  const syncPreferences = useCallback(
    async (prefs: { preferredTheme?: ThemeMode; canvasHeight?: number }) => {
      if (!user || !profile) return;
      if (
        process.env.NODE_ENV === 'development' &&
        (isDummyUser || user.uid === DEV_DUMMY_UID)
      ) {
        const updated: UserProfileDoc = {
          ...profile,
          ...(prefs.preferredTheme ? { preferredTheme: prefs.preferredTheme } : {}),
          ...(typeof prefs.canvasHeight === 'number'
            ? { canvasHeight: Math.round(prefs.canvasHeight) }
            : {}),
        };
        saveDummyProfile(updated);
        setProfile(updated);
        return;
      }
      try {
        await updateUserPreferencesInCloud(user, profile, prefs);
      } catch {
        // Non-blocking UI preference update
      }
    },
    [user, profile, isDummyUser]
  );

  const clearAuthError = useCallback(() => setAuthError(null), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authLoading,
        signingIn,
        isDevDummyAvailable,
        isDummyUser,
        cloudError,
        authError,
        clearAuthError,
        signInWithGoogle,
        signInAsDummyUser,
        recordDummySubmission,
        resetDummyProfile,
        signOutUser,
        syncPreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
