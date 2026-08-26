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
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
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
