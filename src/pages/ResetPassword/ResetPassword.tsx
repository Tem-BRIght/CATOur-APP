import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonContent, IonPage, IonButton, IonInput,
  IonItem, IonLabel, IonIcon, IonLoading, IonAlert,
  IonToolbar, IonButtons, IonBackButton,
} from '@ionic/react';
import { lockClosedOutline, mailOutline } from 'ionicons/icons';
import {
  confirmPasswordReset,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { auth, getAuthActionCodeSettings } from '../../firebase';
import './reset-password.css';

const ResetPassword: React.FC = () => {
  const history = useHistory();
  const [email,        setEmail]        = useState('');
  const [newPassword,  setNewPassword]  = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode,    setResetCode]    = useState<string | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [showLoading,  setShowLoading]  = useState(false);
  const [showAlert,    setShowAlert]    = useState(false);
  const [alertHeader,  setAlertHeader]  = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const isValidEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const code = params.get('oobCode');
    if (mode !== 'resetPassword' || !code) return;

    setCheckingCode(true);
    verifyPasswordResetCode(auth, code)
      .then(setEmail)
      .then(() => setResetCode(code))
      .catch(() => {
        setAlertHeader('Invalid Reset Link');
        setAlertMessage('This password reset link is invalid or has expired. Please request a new one.');
        setShowAlert(true);
      })
      .finally(() => setCheckingCode(false));
  }, []);

  const handleReset = async () => {
    if (!email.trim()) {
      setAlertHeader('Email Required');
      setAlertMessage('Please enter your email address.');
      setShowAlert(true);
      return;
    }
    if (!isValidEmail(email)) {
      setAlertHeader('Invalid Email');
      setAlertMessage('Please enter a valid email address (e.g. name@example.com).');
      setShowAlert(true);
      return;
    }

    setShowLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim(), getAuthActionCodeSettings('/reset-password'));
      setAlertHeader('Reset Link Sent');
      setAlertMessage(
        `A password reset link has been sent to ${email.trim()}. Please check your inbox (and spam folder).`
      );
      setShowAlert(true);
    } catch (error: any) {
      setAlertHeader('Reset Failed');
      switch (error.code) {
        case 'auth/user-not-found':
          setAlertMessage('No account found with this email address.');
          break;
        case 'auth/invalid-email':
          setAlertMessage('The email address format is invalid.');
          break;
        case 'auth/too-many-requests':
          setAlertMessage('Too many requests. Please wait a moment and try again.');
          break;
        case 'auth/network-request-failed':
          setAlertMessage('Network error. Please check your internet connection.');
          break;
        default:
          setAlertMessage(error.message || 'An unexpected error occurred. Please try again.');
      }
      setShowAlert(true);
    } finally {
      setShowLoading(false);
    }
  };

  const handlePasswordUpdate = async () => {
    if (!resetCode) return;
    if (newPassword.length < 6) {
      setAlertHeader('Password Too Short');
      setAlertMessage('Your new password must be at least 6 characters long.');
      setShowAlert(true);
      return;
    }
    if (newPassword !== confirmPassword) {
      setAlertHeader('Passwords Do Not Match');
      setAlertMessage('Please enter the same password in both fields.');
      setShowAlert(true);
      return;
    }

    setShowLoading(true);
    try {
      await confirmPasswordReset(auth, resetCode, newPassword);
      setAlertHeader('Password Updated');
      setAlertMessage('Your password has been changed. You can now sign in.');
      setShowAlert(true);
    } catch (error: any) {
      setAlertHeader('Reset Failed');
      setAlertMessage(error.code === 'auth/expired-action-code'
        ? 'This password reset link has expired. Please request a new one.'
        : error.message || 'Unable to update your password. Please try again.');
      setShowAlert(true);
    } finally {
      setShowLoading(false);
    }
  };

  const handleAlertDismiss = () => {
    setShowAlert(false);
    // Navigate back to login after a successful reset email
    if (alertHeader === 'Reset Link Sent' || alertHeader === 'Password Updated') {
      history.replace('/login');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleReset();
  };

  return (
    <IonPage>
      <IonContent className="login-content" fullscreen>

        {/* Back button */}
        <IonToolbar style={{ '--background': 'transparent', '--border-width': '0' }}>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/login" />
          </IonButtons>
        </IonToolbar>

        {/* Logo & branding — identical to Login */}
        <div className="logo-wrap">
          <img src="/assets/images/Pasig Logo.png" alt="Pasig Logo" className="logo" />
        </div>
        <h2 className="title">Catour</h2>
        <p className="subtitle">DISCOVER THE PASIG WITH AI GUIDANCE!</p>

        {/* Card */}
        <div className="login-card">
          <div className="form">

            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>
                {resetCode ? 'Choose a New Password' : 'Forgot Password?'}
              </h3>
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
                {resetCode ? 'Enter your new password below.' : "Enter your registered email and we'll send you a reset link."}
              </p>
            </div>

            {!resetCode && (
              <>
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
              </>
            )}

            {resetCode && (
              <>
                <IonLabel position="stacked">New password</IonLabel>
                <IonItem className="input-item">
                  <IonIcon icon={lockClosedOutline} slot="start" className="input-icon" />
                  <IonInput
                    placeholder="Enter a new password"
                    type="password"
                    className="text-input"
                    value={newPassword}
                    onIonInput={e => setNewPassword(e.detail.value ?? '')}
                    onKeyDown={e => e.key === 'Enter' && handlePasswordUpdate()}
                  />
                </IonItem>
                <IonLabel position="stacked">Confirm password</IonLabel>
                <IonItem className="input-item">
                  <IonIcon icon={lockClosedOutline} slot="start" className="input-icon" />
                  <IonInput
                    placeholder="Confirm your new password"
                    type="password"
                    className="text-input"
                    value={confirmPassword}
                    onIonInput={e => setConfirmPassword(e.detail.value ?? '')}
                    onKeyDown={e => e.key === 'Enter' && handlePasswordUpdate()}
                  />
                </IonItem>
              </>
            )}

            <IonButton
              expand="block"
              className="login-button"
              onClick={resetCode ? handlePasswordUpdate : handleReset}
              disabled={showLoading || checkingCode}
            >
              {checkingCode ? 'Checking link...' : resetCode ? 'Update Password' : 'Send Reset Link'}
            </IonButton>
          </div>
        </div>

        <IonLoading isOpen={showLoading} message="Sending reset link..." />

        <IonAlert
          isOpen={showAlert}
          onDidDismiss={handleAlertDismiss}
          header={alertHeader}
          message={alertMessage}
          buttons={['OK']}
        />
      </IonContent>
    </IonPage>
  );
};

export default ResetPassword;