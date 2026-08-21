import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { useHistory } from 'react-router-dom';
import {
  IonContent, IonPage, IonButton, IonInput,
  IonItem, IonLabel, IonIcon, IonLoading, IonAlert,
} from '@ionic/react';
import { mailOutline, lockClosedOutline, eyeOutline, eyeOffOutline } from 'ionicons/icons';
import { Link } from 'react-router-dom';
import {
  signInWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  signOut,
} from 'firebase/auth';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, firestore } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useSignup } from '../../context/SignupContext';
import './Login.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type RouteResult =
  | { ok: true;  path: string }
  | { ok: false; header: string; message: string };

// ── Helper: resolve post-login destination ────────────────────────────────────
//
// Priority order:
//   1. role === 'tourguide'  →  /tourguide/change-password  (first login)
//                            →  /tourguide/home             (subsequent logins)
//   2. status === 'inactive' →  block login with clear message
//   3. everything else       →  /home  (regular tourist)
//
// For normal users, only the `users` collection is considered.
// Tour guide accounts are handled separately through their own dedicated route.
const resolveHomeRoute = async (uid: string): Promise<RouteResult> => {
  try {
    const userSnap = await getDoc(doc(firestore, 'users', uid));
    let role: string | undefined;
    let mustChangePassword = false;
    let status = 'active';

    if (userSnap.exists()) {
      const data = userSnap.data();
      role = data?.role;
      mustChangePassword = data?.mustChangePassword === true;
      status = data?.status || 'active';
    }

    if (!role) {
      const guideSnap = await getDoc(doc(firestore, 'tourGuides', uid));
      if (guideSnap.exists()) {
        role = 'tourguide';
        status = guideSnap.data()?.status || 'active';
        mustChangePassword = guideSnap.data()?.mustChangePassword === true;
      }
    }

    if (role === 'tourguide') {
      if (status === 'inactive') {
        await signOut(auth);
        return {
          ok: false,
          header: 'Account Deactivated',
          message: 'Your tour guide account has been deactivated. '
            + 'Please contact your administrator for assistance.',
        };
      }
      if (mustChangePassword) {
        return { ok: true, path: '/tourguide/change-password' };
      }
      return { ok: true, path: '/tourguide/home' };
    }

    // 4. Default to tourist home
    return { ok: true, path: '/home' };
  } catch (error) {
    console.warn('[Login] resolveHomeRoute error, defaulting to /home', error);
    return { ok: true, path: '/home' };
  }
};

// ─────────────────────────────────────────────────────────────────────────────

const Login: React.FC = () => {
  const history = useHistory();
  const { isAuthenticated } = useAuth();
  const { updateSignupData } = useSignup();
  const navigationInProgressRef = useRef(false);

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showLoading,  setShowLoading]  = useState(false);
  const [showAlert,    setShowAlert]    = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [alertHeader,  setAlertHeader]  = useState('');
  const [checkingGoogleRedirect, setCheckingGoogleRedirect] = useState(true);

  // ── Redirect if already logged in ──────────────────────────────────────────
  // Must check role — tourguides go to /tourguide/home, not /home
  useEffect(() => {
    if (!isAuthenticated || checkingGoogleRedirect || navigationInProgressRef.current) return;
    const { currentUser } = auth;
    if (!currentUser) { history.replace('/home'); return; }
    handlePostAuth(currentUser.uid);
  }, [isAuthenticated, history, checkingGoogleRedirect]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const isValidEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const showError = (header: string, message: string) => {
    setAlertHeader(header);
    setAlertMessage(message);
    setShowAlert(true);
  };

  // ── Shared post-auth routing ─────────────────────────────────────────────────
  const handlePostAuth = async (uid: string) => {
    if (navigationInProgressRef.current) return;
    navigationInProgressRef.current = true;
    const result = await resolveHomeRoute(uid);
    if (!result.ok) {
      showError(result.header, result.message);
      navigationInProgressRef.current = false;
    } else {
      history.replace(result.path);
    }
  };

  const completeGoogleLogin = async (user: any) => {
    if (!user?.uid) {
      throw new Error('Unable to complete Google sign-in. Please try again.');
    }

    const snap = await getDoc(doc(firestore, 'users', user.uid));
    if (snap.exists() && snap.data()?.role === 'tourguide') {
      await handlePostAuth(user.uid);
      return;
    }

    if (!snap.exists() || !snap.data()?.isFullyRegistered) {
      const displayNameParts = user.displayName?.trim().split(' ') ?? [];
      updateSignupData({
        email: user.email ?? '',
        uid: user.uid,
        isGoogleUser: true,
        firstName: displayNameParts[0] ?? '',
        surname: displayNameParts.slice(1).join(' ') ?? '',
      });
      navigationInProgressRef.current = true;
      history.replace('/googleUser');
      return;
    }

    await handlePostAuth(user.uid);
  };

  useEffect(() => {
    let mounted = true;
    const resumeGoogleRedirect = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) await completeGoogleLogin(result.user);
      } catch (error: any) {
        console.error('[Login] Google redirect error', error);
        showError('Google Sign-In Failed', error.message || 'Could not complete Google sign-in. Please try again.');
      } finally {
        if (mounted) setCheckingGoogleRedirect(false);
      }
    };
    resumeGoogleRedirect();
    return () => { mounted = false; };
  }, []);

  // ── Email / Password Login ──────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!email.trim() && !password)
      return showError('Missing Fields', 'Please enter your email address and password.');
    if (!email.trim())
      return showError('Email Required', 'Please enter your email address.');
    if (!isValidEmail(email))
      return showError('Invalid Email', 'Please enter a valid email address (e.g. name@example.com).');
    if (!password)
      return showError('Password Required', 'Please enter your password.');
    if (password.length < 6)
      return showError('Password Too Short', 'Password must be at least 6 characters long.');

    setShowLoading(true);
    try {
      const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
      await handlePostAuth(user.uid);
    } catch (error: any) {
      let message: string;
      switch (error.code) {
        case 'auth/user-not-found':
          message = 'No account found with this email address. Please check the email or sign up for a new account.'; break;
        case 'auth/wrong-password':
          message = 'Incorrect password. Please try again or tap "Forgot password?" to reset it.'; break;
        case 'auth/invalid-credential':
          message = 'Invalid email or password. Please double-check your credentials and try again.'; break;
        case 'auth/invalid-email':
          message = 'The email address format is invalid. Please enter a valid email (e.g. name@example.com).'; break;
        case 'auth/user-disabled':
          message = 'This account has been disabled. Please contact support for assistance.'; break;
        case 'auth/too-many-requests':
          message = 'Too many failed login attempts. Your account has been temporarily locked. Please wait a few minutes or reset your password.'; break;
        case 'auth/network-request-failed':
          message = 'Network error. Please check your internet connection and try again.'; break;
        case 'auth/operation-not-allowed':
          message = 'Email/password login is not enabled. Please contact support.'; break;
        default:
          message = error.message || 'An unexpected error occurred. Please try again later.';
      }
      showError('Login Failed', message);
    } finally {
      setShowLoading(false);
    }
  };

  // ── Google Login ────────────────────────────────────────────────────────────
  const handleGoogleLogin = async () => {
    setShowLoading(true);
    try {
      const isNative = Capacitor.isNativePlatform?.() ?? Capacitor.getPlatform() !== 'web';
      let user: any;
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      if (isNative) {
        const nativeClientId = import.meta.env.VITE_GOOGLE_ANDROID_CLIENT_ID
          || import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!nativeClientId) {
          throw new Error('Google Client ID is missing. Check environment variables.');
        }
        await GoogleAuth.initialize({
          scopes: ['profile', 'email'],
          grantOfflineAccess: false,
          clientId: nativeClientId,
        });
        const googleUser = await GoogleAuth.signIn();
        const idToken = googleUser?.authentication?.idToken ?? (googleUser as any)?.idToken;
        if (!idToken) {
          throw new Error('Google sign-in returned no ID token. Please try again.');
        }
        const credential = GoogleAuthProvider.credential(idToken);
        const result = await signInWithCredential(auth, credential);
        user = result.user;
      } else {
        try {
          const result = await signInWithPopup(auth, provider);
          user = result.user;
        } catch (popupError: any) {
          if (popupError.code === 'auth/popup-blocked' || popupError.code === 'auth/popup-closed-by-user') {
            await signInWithRedirect(auth, provider);
            return;
          }
          throw popupError;
        }
      }

      await completeGoogleLogin(user);
    } catch (error: any) {
      console.error('[Login] Google sign-in error', error);
      if (error.code === 'auth/popup-closed-by-user') return;
      const message = error.code === 'auth/network-request-failed'
        ? 'Network error. Please check your internet connection and try again.'
        : error.code === 'auth/unauthorized-domain'
        ? 'This domain is not authorized for Google sign-in. Check Firebase Console settings.'
        : error.code === 'auth/operation-not-allowed'
        ? 'Google sign-in is not enabled. Please contact support.'
        : error.message?.includes('DEVELOPER_ERROR') || error.message?.includes('10')
        ? 'Google Sign-In configuration is invalid on this device. Check your Android OAuth client ID and SHA-1 setup.'
        : (error.code ? `${error.code}: ${error.message || 'Could not sign in with Google.'}` : error.message || 'Could not sign in with Google. Please try again.');
      showError('Google Sign-In Failed', message);
    } finally {
      setShowLoading(false);
    }
  };

  // ── Enter key ──────────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <IonPage>
      <IonContent className="login-content" fullscreen>
        <div className="logo-wrap">
          <img src="/assets/images/Pasig Logo.png" alt="Pasig Logo" className="logo" />
        </div>
        <h2 className="title">Catour</h2>
        <p className="subtitle">DISCOVER THE PASIG WITH AI GUIDANCE!</p>

        <div className="login-card">
          <div className="form">

            <IonLabel position="stacked">Email</IonLabel>
            <IonItem className="input-item">
              <IonIcon icon={mailOutline} slot="start" className="input-icon" />
              <IonInput
                placeholder="Enter your email"
                type="email"
                className="text-input"
                value={email}
                onIonInput={e => setEmail(e.detail.value ?? '')}
                onKeyDown={handleKeyDown}
              />
            </IonItem>

            <IonLabel position="stacked">Password</IonLabel>
            <IonItem className="input-item">
              <IonIcon icon={lockClosedOutline} slot="start" className="input-icon" />
              <IonInput
                placeholder="Enter your password"
                type={showPassword ? 'text' : 'password'}
                className="text-input"
                value={password}
                onIonInput={e => setPassword(e.detail.value ?? '')}
                onKeyDown={handleKeyDown}
              />
              <IonIcon
                icon={showPassword ? eyeOffOutline : eyeOutline}
                slot="end"
                style={{ cursor: 'pointer', color: '#9aa4b2', fontSize: 20 }}
                onClick={() => setShowPassword(prev => !prev)}
              />
            </IonItem>

            <IonButton expand="block" className="login-button" onClick={handleLogin}>
              Log In
            </IonButton>

            <div className="forgot">
              <Link to="/reset-password">Forgot password?</Link>
            </div>

            <div className="divider"><span>Or continue with</span></div>

            <IonButton fill="outline" className="google-button" onClick={handleGoogleLogin}>
              <img src="/assets/images/google Logo.png" alt="google" />
              Continue with Google
            </IonButton>

            <div className="signup">
              <Link to="/signUp1">Don't have an account? Sign up</Link>
            </div>

          </div>
        </div>

        <IonLoading isOpen={showLoading} message="Logging you in..." />

        <IonAlert
          isOpen={showAlert}
          onDidDismiss={() => setShowAlert(false)}
          header={alertHeader}
          message={alertMessage}
          buttons={['OK']}
        />
      </IonContent>
    </IonPage>
  );
};

export default Login;
