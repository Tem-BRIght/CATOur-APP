// src/context/AuthContext.tsx
import React, {
  createContext, useContext, useEffect, useState, ReactNode,
} from 'react';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, firestore } from '../firebase';

export type UserRole = 'tourguide' | 'user' | null;

interface AuthState {
  currentUser:        User | null;
  user:               User | null;
  role:               UserRole;
  status:             string | null;
  mustChangePassword: boolean;
  authError:         boolean;
  isAuthenticated:    boolean;
  authLoading:        boolean;
  isLoading:          boolean;
  logout:             () => Promise<void>;
}

const AUTH_CACHE_KEY = 'catour:offline-auth-cache';

export const readCachedAuthSession = (): {
  uid: string;
  role: UserRole;
  status: string | null;
  mustChangePassword: boolean;
} | null => {
  if (typeof window === 'undefined' || !('localStorage' in window)) return null;

  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      uid?: string;
      role?: UserRole;
      status?: string | null;
      mustChangePassword?: boolean;
    };

    if (!parsed.uid || !parsed.role) return null;

    return {
      uid: parsed.uid,
      role: parsed.role,
      status: parsed.status ?? null,
      mustChangePassword: parsed.mustChangePassword === true,
    };
  } catch (error) {
    console.warn('[AuthContext] Failed to read cached auth session:', error);
    return null;
  }
};

export const hasCachedOfflineAuthSession = (): boolean => {
  return !!readCachedAuthSession() && navigator.onLine === false;
};

const persistAuthSession = (uid: string, role: UserRole, status: string | null, mustChangePassword: boolean) => {
  if (typeof window === 'undefined' || !('localStorage' in window)) return;

  try {
    window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
      uid,
      role,
      status,
      mustChangePassword,
      updatedAt: Date.now(),
    }));
  } catch (error) {
    console.warn('[AuthContext] Failed to write cached auth session:', error);
  }
};

const clearAuthSession = () => {
  if (typeof window === 'undefined' || !('localStorage' in window)) return;
  window.localStorage.removeItem(AUTH_CACHE_KEY);
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const logout = async () => {
    if (state.currentUser) {
      const collectionName = state.role === 'tourguide' ? 'tourGuides' : 'users';
      const docRef = doc(firestore, collectionName, state.currentUser.uid);
      try {
        await setDoc(docRef, {
          lastActive: serverTimestamp(),
          status: 'offline',
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (error) {
        console.warn(`[AuthContext] Failed to mark ${state.role ?? 'user'} offline on logout:`, error);
      }
    }

    clearAuthSession();
    await signOut(auth);
  };

  const [state, setState] = useState<AuthState>({
    currentUser:        null,
    user:               null,
    role:               null,
    status:             null,
    mustChangePassword: false,
    authError:         false,
    isAuthenticated:    false,
    authLoading:        true,
    isLoading:          true,
    logout,
  });

  useEffect(() => {
    const cachedSession = readCachedAuthSession();
    const offlineWithCachedSession = !navigator.onLine && !!cachedSession;

    if (offlineWithCachedSession) {
      const partialUser = { uid: cachedSession!.uid } as User;
      setState({
        currentUser:        partialUser,
        user:               partialUser,
        role:               cachedSession!.role,
        status:             cachedSession!.status,
        mustChangePassword: cachedSession!.mustChangePassword,
        authError:         false,
        isAuthenticated:    true,
        authLoading:        false,
        isLoading:          false,
        logout,
      });
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        const cachedSessionFallback = readCachedAuthSession();
        if (!navigator.onLine && cachedSessionFallback) {
          const partialUser = { uid: cachedSessionFallback.uid } as User;
          setState({
            currentUser:        partialUser,
            user:               partialUser,
            role:               cachedSessionFallback.role,
            status:             cachedSessionFallback.status,
            mustChangePassword: cachedSessionFallback.mustChangePassword,
            authError:         false,
            isAuthenticated:    true,
            authLoading:        false,
            isLoading:          false,
            logout,
          });
          return;
        }

        clearAuthSession();
        setState({
          currentUser:        null,
          user:               null,
          role:               null,
          status:             null,
          mustChangePassword: false,
          authError:         false,
          isAuthenticated:    false,
          authLoading:        false,
          isLoading:          false,
          logout,
        });
        return;
      }
      try {
        const [userSnap, guideSnap] = await Promise.all([
          getDoc(doc(firestore, 'users', user.uid)),
          getDoc(doc(firestore, 'tourGuides', user.uid)),
        ]);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const userRole = typeof userData?.role === 'string' ? userData.role : undefined;
        const userStatus = typeof userData?.status === 'string' ? userData.status : 'online';
        const mustChangePassword = userData?.mustChangePassword === true;

        let nextRole: UserRole = userRole === 'tourguide' ? 'tourguide' : 'user';
        let status = userStatus;

        if (!userRole && guideSnap.exists()) {
          nextRole = 'tourguide';
          status = typeof guideSnap.data()?.status === 'string' ? guideSnap.data().status : 'online';
        }

        const resolvedMustChangePassword = !userRole && guideSnap.exists()
          ? guideSnap.data()?.mustChangePassword === true
          : mustChangePassword;

        persistAuthSession(user.uid, nextRole, status, resolvedMustChangePassword);

        setState({
          currentUser:        user,
          user:               user,
          role:               nextRole,
          status:             status,
          mustChangePassword: resolvedMustChangePassword,
          authError:         false,
          isAuthenticated:    true,
          authLoading:        false,
          isLoading:          false,
          logout,
        });
      } catch (error) {
        console.error('[AuthContext] Error fetching user role:', error);
        const cachedSessionFallback = readCachedAuthSession();
        if (!navigator.onLine && cachedSessionFallback) {
          const partialUser = { uid: cachedSessionFallback.uid } as User;
          setState({
            currentUser:        partialUser,
            user:               partialUser,
            role:               cachedSessionFallback.role,
            status:             cachedSessionFallback.status,
            mustChangePassword: cachedSessionFallback.mustChangePassword,
            authError:         false,
            isAuthenticated:    true,
            authLoading:        false,
            isLoading:          false,
            logout,
          });
          return;
        }

        setState({
          currentUser:        user,
          user:               user,
          role:               null,
          status:             null,
          mustChangePassword: false,
          authError:         true,
          isAuthenticated:    true,
          authLoading:        false,
          isLoading:          false,
          logout,
        });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!state.currentUser || !['user', 'tourguide'].includes(state.role ?? '')) return;

    const collectionName = state.role === 'tourguide' ? 'tourGuides' : 'users';
    const docRef = doc(firestore, collectionName, state.currentUser.uid);

    const updateHeartbeat = async () => {
      try {
        await setDoc(docRef, {
          lastActive: serverTimestamp(),
          status: 'online',
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (error) {
        console.warn(`[AuthContext] Failed to update ${state.role} heartbeat:`, error);
      }
    };

    updateHeartbeat();

    const intervalId = window.setInterval(() => {
      updateHeartbeat();
    }, 60_000);

    const onVisible = () => {
      if (!document.hidden) {
        updateHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [state.currentUser, state.role]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};

export default AuthContext;
