import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { sendEmailVerification } from 'firebase/auth';
import { auth, getAuthActionCodeSettings } from '../../../firebase';

const VerifyEmail: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState<number>(0);
  const timerRef = useRef<number | null>(null);

  const currentUser = auth.currentUser;
  const isVerified = useMemo(() => currentUser?.emailVerified ?? false, [currentUser?.emailVerified]);

  const handleResend = async () => {
    if (!currentUser) {
      setStatus('error');
      setMessage('Please sign in first.');
      return;
    }
    // Prevent manual double-clicks while already sending or in cooldown
    if (status === 'sending' || cooldown > 0) return;

    try {
      setStatus('sending');
      await sendEmailVerification(currentUser, getAuthActionCodeSettings());
      setStatus('sent');
      setMessage('A verification email has been sent. Please check your inbox and refresh the page after confirming.');
      // Start a short cooldown to avoid accidental spamming
      setCooldown(60);
    } catch (err: any) {
      console.error('[VerifyEmail] sendEmailVerification failed:', err);
      setStatus('error');
      // Friendly messages for common auth errors
      if (err?.code === 'auth/too-many-requests') {
        setMessage('Too many requests. Please wait a minute before trying again.');
        setCooldown(60);
      } else if (err?.code === 'auth/invalid-email') {
        setMessage('Invalid email address. Please check your account email.');
      } else {
        setMessage(err?.message || 'Unable to send the verification email right now.');
      }
    }
  };

  // Countdown timer for cooldown state
  useEffect(() => {
    if (cooldown <= 0) return;
    timerRef.current = window.setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [cooldown]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/profile" />
          </IonButtons>
          <IonTitle>Verify Email</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: '1rem' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Email verification</h2>
          <p>
            {isVerified
              ? 'Your email address has already been verified.'
              : 'Before you can join a tour session, your email must be verified.'}
          </p>

          {!isVerified && (
            <>
              <IonButton
                expand="block"
                onClick={handleResend}
                disabled={status === 'sending' || cooldown > 0}
              >
                {status === 'sending' ? 'Sending…' : (cooldown > 0 ? `Try again in ${cooldown}s` : 'Send verification email')}
              </IonButton>

              {message && (
                <p style={{ marginTop: '1rem', color: status === 'error' ? '#d93025' : '#1e8e3e' }}>
                  {message}
                  {status === 'error' && cooldown > 0 && (
                    <span> Please wait {cooldown}s before retrying.</span>
                  )}
                </p>
              )}
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default VerifyEmail;
