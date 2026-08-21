import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { 
  IonContent, IonPage, IonToolbar, 
  IonButtons, IonBackButton, IonButton, IonInput, 
  IonItem, IonLabel, IonIcon, IonAlert,
  InputCustomEvent, InputChangeEventDetail
} from '@ionic/react';
import { mailOutline, lockClosedOutline, eyeOutline, eyeOffOutline } from 'ionicons/icons';
import { useSignup } from '../../context/SignupContext';
import { useAuth } from '../../context/AuthContext';
import { functions } from '../../firebase';
import './signup.css';

const SignUP2: React.FC = () => {
  const history = useHistory();
  const { signupData, updateSignupData } = useSignup();
  const { isAuthenticated } = useAuth();
  const [email,           setEmail]           = useState(signupData.email    ?? '');
  const [password,        setPassword]        = useState(signupData.password ?? '');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword,    setShowPassword]    = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [showAlert,       setShowAlert]       = useState(false);
  const [alertHeader,     setAlertHeader]     = useState('');
  const [alertMessage,    setAlertMessage]    = useState('');
  const [checkingEmail,   setCheckingEmail]  = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) {
      history.replace('/home');
    }
  }, [isAuthenticated, history]);

  const isValidEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (value && value === confirmPassword && alertMessage === 'Please confirm your password.') {
      setShowAlert(false);
    }
  };

  const handleConfirmPasswordChange = (value: string) => {
    setConfirmPassword(value);
    if (value && value === password && alertMessage === 'Please confirm your password.') {
      setShowAlert(false);
    }
  };

  const handleNext = async () => {
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
    if (!password) {
      setAlertHeader('Password Required');
      setAlertMessage('Please enter a password.');
      setShowAlert(true);
      return;
    }
    if (password.length < 6) {
      setAlertHeader('Password Too Short');
      setAlertMessage('Password must be at least 6 characters long.');
      setShowAlert(true);
      return;
    }
    if (password !== confirmPassword) {
      setAlertHeader('Passwords Do Not Match');
      setAlertMessage('Your passwords do not match. Please re-enter them carefully.');
      setShowAlert(true);
      return;
    }

    setCheckingEmail(true);
    try {
      const normalizedEmail = email.trim();
      const checkEmailRegistered = httpsCallable<{ email: string }, { registered: boolean }>(
        functions,
        'checkEmailRegistered',
      );
      const result = await checkEmailRegistered({ email: normalizedEmail });
      if (result.data.registered) {
        setAlertHeader('Email Already Registered');
        setAlertMessage('This email is already registered. Please log in or use a different email.');
        setShowAlert(true);
        return;
      }

      updateSignupData({ email: normalizedEmail, password });
      history.push('/signup3');
    } catch {
      setAlertHeader('Email Check Failed');
      setAlertMessage('We could not verify this email right now. Please try again.');
      setShowAlert(true);
    } finally {
      setCheckingEmail(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="login-content" fullscreen>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/signUp1" />
          </IonButtons>
        </IonToolbar>

        <div className="logo-wrap">
          <img src="/assets/images/Pasig Logo.png" alt="Pasig Logo" className="logo" />
        </div>
        <h2 className="title">Catour</h2>
        <p className="subtitle">DISCOVER THE PASIG WITH AI GUIDANCE!</p>

        {/* Progress Indicator */}
        <div className="signup-progress">
          <div className="progress-step completed">
            <span className="step-number">1</span>
            <span className="step-label">Personal Info</span>
          </div>
          <div className="progress-line active"></div>
          <div className="progress-step active">
            <span className="step-number">2</span>
            <span className="step-label">Account</span>
          </div>
          <div className="progress-line not"></div>
          <div className="progress-step not">
            <span className="step-number">3</span>
            <span className="step-label">Profile</span>
          </div>
        </div>

        <div className="login-card">
          <div className="form">
            <p className="formSubtitle">Create Account</p>

            <IonLabel position="stacked">Email</IonLabel>
            <IonItem className="input-item">
              <IonIcon icon={mailOutline} slot="start" className="input-icon" />
              <IonInput
                placeholder="Enter your email"
                type="email"
                className="text-input"
                value={email}
                onIonInput={(e: InputCustomEvent<InputChangeEventDetail>) => setEmail(e.detail.value ?? '')}
              />
            </IonItem>

            <IonLabel position="stacked">Password</IonLabel>
            <IonItem className="input-item">
              <IonIcon icon={lockClosedOutline} slot="start" className="input-icon" />
              <IonInput
                placeholder="At least 6 characters"
                type={showPassword ? 'text' : 'password'}
                className="text-input"
                value={password}
                onIonInput={(e: InputCustomEvent<InputChangeEventDetail>) => handlePasswordChange(e.detail.value ?? '')}
              />
              <IonIcon
                icon={showPassword ? eyeOffOutline : eyeOutline}
                slot="end"
                style={{ cursor: 'pointer', color: '#9aa4b2', fontSize: 20 }}
                onClick={() => setShowPassword(p => !p)}
              />
            </IonItem>

            <IonLabel position="stacked">Confirm Password</IonLabel>
            <IonItem className="input-item">
              <IonIcon icon={lockClosedOutline} slot="start" className="input-icon" />
              <IonInput
                placeholder="Re-enter your password"
                type={showConfirm ? 'text' : 'password'}
                className="text-input"
                value={confirmPassword}
                onIonInput={(e: InputCustomEvent<InputChangeEventDetail>) => handleConfirmPasswordChange(e.detail.value ?? '')}
              />
              <IonIcon
                icon={showConfirm ? eyeOffOutline : eyeOutline}
                slot="end"
                style={{ cursor: 'pointer', color: '#9aa4b2', fontSize: 20 }}
                onClick={() => setShowConfirm(p => !p)}
              />
            </IonItem>

            <IonButton expand="block" className="login-button" onClick={handleNext} disabled={checkingEmail}>
              Next
            </IonButton>
          </div>
        </div>

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

export default SignUP2;