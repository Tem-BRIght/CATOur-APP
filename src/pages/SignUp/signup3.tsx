import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonContent, IonPage, IonToolbar,
  IonButtons, IonBackButton, IonButton, IonInput,
  IonItem, IonLabel, IonIcon, IonLoading,
  IonAvatar, IonSelect, IonSelectOption,
} from '@ionic/react';
import { cameraOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../firebase';
import { useSignup } from '../../context/SignupContext';
import { createUserProfile } from '../../services/userProfileService';
import { useIonRouter, useIonViewWillEnter } from '@ionic/react';
import OtherSelect from '../../components/OtherSelect';
import './signup.css';
import FeedbackOverlay from '../../components/FeedbackOverlay';

const RELIGIONS = [
  'Roman Catholic','Islam','Evangelical','Iglesia ni Cristo','Seventh-day Adventist',
  'United Church of Christ','Baptist','Other Christian','Buddhist','Hindu','Non-religious','Other',
];

const NATIONALITIES = [
  'Filipino','American','Japanese','Korean','Chinese',
  'British','Australian','Canadian','Indian','Other',
];

const SignUP3: React.FC = () => {
  const history   = useHistory();
  const ionRouter = useIonRouter();
  const { signupData, updateSignupData, resetSignupData } = useSignup();

  const [username,      setUsername]      = useState(signupData.username    ?? '');
  const [dateOfBirth,   setDateOfBirth]   = useState(signupData.dateOfBirth ?? '');
  const [age,           setAge]           = useState<string>(signupData.age ? String(signupData.age) : '');
  const [nationality,   setNationality]   = useState(signupData.nationality ?? '');
  const [otherNationality, setOtherNationality] = useState('');
  const [gender,        setGender]        = useState(signupData.gender ?? '');
  const [religion,      setReligion]      = useState('');
  const [otherReligion, setOtherReligion] = useState('');
  const [address,       setAddress]       = useState(signupData.address ?? '');
  const [acceptedTerms, setAcceptedTerms] = useState(signupData.acceptedTerms ?? false);
  const [termsError,    setTermsError]    = useState(false);
  const [profilePic,    setProfilePic]    = useState<string | null>(signupData.profilePic);
  const [loading,       setLoading]       = useState(false);
  const [showAlert,     setShowAlert]     = useState(false);
  const [alertHeader,   setAlertHeader]   = useState('');
  const [alertMessage,  setAlertMessage]  = useState('');

  const fileInputRef = React.useRef<HTMLInputElement>(null);



  // ── Auto-calc age from DOB ────────────────────────────────────────────────
  const handleDobChange = (value: string) => {
    setDateOfBirth(value);
    if (value) {
      const today   = new Date();
      const dob     = new Date(value);
      let calcAge   = today.getFullYear() - dob.getFullYear();
      const m       = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) calcAge--;
      if (calcAge >= 0) setAge(String(calcAge));
    }
  };

  const ageValidationLabel = (() => {
    if (!dateOfBirth) return '';
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let calculatedAge = today.getFullYear() - dob.getFullYear();
    const monthDifference = today.getMonth() - dob.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dob.getDate())) calculatedAge--;
    if (Number.isNaN(dob.getTime()) || dob > today) return 'Enter a valid date of birth.';
    if (calculatedAge < 10) return 'You must be at least 10 years old.';
    return `Age: ${calculatedAge} years old`;
  })();

  const ageValidationError = ageValidationLabel === 'Enter a valid date of birth.' ||
    ageValidationLabel === 'You must be at least 10 years old.';

  // ── Photo picker ──────────────────────────────────────────────────────────
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setProfilePic(result);
      updateSignupData({ profilePic: result });
    };
    reader.readAsDataURL(file);
  };

  const handleAcceptedTermsChange = (checked: boolean) => {
    setAcceptedTerms(checked);
    setTermsError(false);
    updateSignupData({ acceptedTerms: checked });
  };

  useIonViewWillEnter(() => {
    setAcceptedTerms(signupData.acceptedTerms ?? false);
    setTermsError(false);
  });

  useEffect(() => {
    setAcceptedTerms(signupData.acceptedTerms ?? false);
  }, [signupData.acceptedTerms]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSignUp = async () => {
    const selectedNationality = nationality === 'other' ? otherNationality.trim() : nationality;
    const selectedReligion = religion === 'Other' ? otherReligion.trim() : religion;

    if (!username.trim() || !dateOfBirth.trim() || !selectedNationality || !gender) {
      setAlertHeader('Missing Fields');
      setAlertMessage('Please fill in all required fields (Username, Date of Birth, Gender, Nationality).');
      setShowAlert(true);
      return;
    }
    if (!selectedReligion) {
      setAlertHeader('Missing Field');
      setAlertMessage('Please select your religion.');
      setShowAlert(true);
      return;
    }
    if (!address.trim()) {
      setAlertHeader('Missing Address');
      setAlertMessage('Please enter your full address.');
      setShowAlert(true);
      return;
    }
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let calculatedAge = today.getFullYear() - dob.getFullYear();
    const monthDifference = today.getMonth() - dob.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dob.getDate())) calculatedAge--;
    if (Number.isNaN(dob.getTime()) || dob > today || calculatedAge < 10) {
      setAlertHeader('Age Requirement');
      setAlertMessage('You must be at least 10 years old to create an account.');
      setShowAlert(true);
      return;
    }
    if (!acceptedTerms) {
      setTermsError(true);
      setAlertHeader('Terms Required');
      setAlertMessage('Please accept the Terms and Conditions to continue.');
      setShowAlert(true);
      return;
    }

    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth, signupData.email, signupData.password,
      );

      await createUserProfile(userCredential.user.uid, {
        name: {
          firstname: signupData.firstName,
          surname:   signupData.surname,
          suffix:    signupData.suffix,
        },
        email:             signupData.email,
        dateOfBirth,
        age,
        gender,
        nationality: selectedNationality,
        nickname:          username,
        img:               profilePic,
        address:           address.trim(),
        religion: selectedReligion,
        isGoogleUser:      false,
        isFullyRegistered: true,
        acceptedTerms,
        emailVerified:     userCredential.user.emailVerified,
        phoneVerified:     false,
      });

      resetSignupData();
      history.push('/home');
    } catch (error: any) {
      setLoading(false);
      setAlertHeader('Sign Up Failed');
      if (error.code === 'auth/email-already-in-use') {
        setAlertMessage('This email is already registered. Please log in or use a different email.');
      } else if (error.code === 'auth/weak-password') {
        setAlertMessage('Your password is too weak. Please choose a stronger one.');
      } else {
        setAlertMessage(error.message || 'An unexpected error occurred. Please try again.');
      }
      setShowAlert(true);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <IonPage>
      <IonContent className="login-content" fullscreen>

        <IonToolbar style={{ '--background': 'transparent', '--border-width': '0' }}>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/signup2" />
          </IonButtons>
        </IonToolbar>

        {/* Branding */}
        <div className="logo-wrap">
          <img src="/assets/images/Pasig Logo.png" alt="Pasig Logo" className="logo" />
        </div>
        <h2 className="title">Catour</h2>
        <p className="subtitle">DISCOVER THE PASIG WITH AI GUIDANCE!</p>

        {/* Progress indicator */}
        <div className="signup-progress">
          <div className="progress-step completed">
            <span className="step-number">1</span>
            <span className="step-label">Personal Info</span>
          </div>
          <div className="progress-line completed"></div>
          <div className="progress-step completed">
            <span className="step-number">2</span>
            <span className="step-label">Account</span>
          </div>
          <div className="progress-line active"></div>
          <div className="progress-step active">
            <span className="step-number">3</span>
            <span className="step-label">Profile</span>
          </div>
        </div>

        {/* ── Card ─────────────────────────────────────────────────────────── */}
        <div className="login-card">
          <div className="form">
            <p className="formSubtitle">Create Profile</p>

            {/* ── Photo upload ─────────────────────────────────────────────── */}
            <div className="photo-upload">
              <div
                className="photo-container"
                onClick={() => fileInputRef.current?.click()}
                style={{ cursor: 'pointer' }}
              >
                <IonAvatar
                  className={`userprofile-avatar  ${profilePic ? 'has-photo' : 'no-photo'}`}
                  style={{
                    width: 90, height: 90,
                    border: profilePic ? '3px solid #0d2f6e' : '3px dashed #ccc',
                    margin: '0 auto',
                  }}
                >
                  {profilePic ? (
                    <img src={profilePic} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div className="placeholder">
                      <IonIcon icon={cameraOutline} className="placeholder-icon" />
                      <span style={{ fontSize: 10 }}>Add Photo</span>
                    </div>
                  )}
                </IonAvatar>

                {/* Camera / check overlay badge */}
                <div
                  style={{
                    position: 'absolute', bottom: 2, right: 2,
                    background: profilePic ? '#28a745' : '#0d2f6e',
                    borderRadius: '50%', width: 28, height: 28,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                    color: '#fff', fontSize: 15,
                  }}
                >
                  <IonIcon icon={profilePic ? checkmarkCircleOutline : cameraOutline} />
                </div>
              </div>

              <input
                name="signup-photo"
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <p className="photo-hint" style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                {profilePic ? 'Tap to change photo' : 'Tap to upload a profile picture'}
              </p>
            </div>

            {/* ── Username ─────────────────────────────────────────────────── */}
            <IonLabel position="stacked" className="signup-3-label">Username *</IonLabel>
            <IonItem className="input-item">
              <IonInput
                placeholder="Enter your username"
                value={username}
                onIonChange={(e) => setUsername(e.detail.value!)}
                className="text-input"
              />
                <IonLabel className={`age-validation-label${ageValidationError ? ' age-validation-label--error' : ''}`}>
                  {ageValidationLabel}
                </IonLabel>
            </IonItem>

            {/* ── Date of Birth + Age (side-by-side) ───────────────────────── */}
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 2 }}>
                <IonLabel position="stacked" className="signup-3-label">Date of Birth *</IonLabel>
                <IonItem className="input-item">
                  <IonInput
                    type="date"
                    value={dateOfBirth}
                    onIonChange={(e) => handleDobChange(e.detail.value!)}
                    className="text-input"
                  />
                </IonItem>
              </div>
              <div style={{ flex: 1 }}>
                <IonLabel position="stacked" className="signup-3-label">Age</IonLabel>
                <IonItem className="input-item">
                  <IonInput
                    type="number"
                    placeholder="—"
                    value={age}
                    onIonChange={(e) => setAge(e.detail.value!)}
                    className="text-input"
                  />
                </IonItem>
              </div>
            </div>

            {/* ── Gender (full width) ──────────────────────────────────────── */}
            <IonLabel position="stacked" className="signup-3-label">Gender *</IonLabel>
            <IonItem className="input-item">
              <IonSelect
                placeholder="Select gender"
                value={gender}
                onIonChange={(e) => setGender(e.detail.value ?? '')}
                className="text-input"
              >
                {['Male', 'Female', 'Non-binary', 'Prefer not to say'].map(g => (
                  <IonSelectOption key={g} value={g}>{g}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>

            {/* ── Nationality + Religion (side-by-side) ────────────────────── */}
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <OtherSelect
                  label="Nationality"
                  options={NATIONALITIES.map(n => n.toLowerCase() === 'other' ? 'Other' : n)}
                  value={nationality}
                  otherValue={otherNationality}
                  onChange={setNationality}
                  onOtherChange={setOtherNationality}
                />
              </div>
              <div style={{ flex: 1 }}>
                <OtherSelect
                  label="Religion"
                  options={RELIGIONS}
                  value={religion}
                  otherValue={otherReligion}
                  onChange={setReligion}
                  onOtherChange={setOtherReligion}
                />
              </div>
            </div>

            {/* ── Address ──────────────────────────────────────────────────── */}
            <IonLabel position="stacked" className="signup-3-label">Address *</IonLabel>
            <IonItem className="input-item">
              <IonInput
                placeholder="Enter your full address"
                value={address}
                onIonChange={(e) => setAddress(e.detail.value!)}
                className="text-input"
              />
            </IonItem>

            {/* ── Terms ────────────────────────────────────────────────────── */}
            <div className="terms-container">
              <div className="checkbox-wrapper">
                <input
                  type="checkbox"
                  id="terms"
                  checked={acceptedTerms}
                  onChange={(e) => {
                    handleAcceptedTermsChange(e.target.checked);
                  }}
                  className="terms-checkbox"
                />
                <label htmlFor="terms" className="terms-label">
                  I agree to the{' '}
                  <a
                    href="#"
                    className="terms-link"
                    onClick={(e) => {
                      e.preventDefault();
                      ionRouter.push('/terms-signup?tab=terms&returnTo=%2Fsignup3', 'forward');
                    }}
                  >Terms and Conditions</a>
                  {' '}and{' '}
                  <a
                    href="#"
                    className="terms-link"
                    onClick={(e) => {
                      e.preventDefault();
                      ionRouter.push('/terms-signup?tab=privacy&returnTo=%2Fsignup3', 'forward');
                    }}
                  >Privacy Policy</a>
                </label>
              </div>
              {termsError && (
                <p className="terms-error">Please accept the terms to continue</p>
              )}
            </div>

            <IonButton
              expand="block"
              className="login-button"
              onClick={handleSignUp}
              disabled={loading}
            >
              Sign Up
            </IonButton>

          </div>
        </div>

        <IonLoading isOpen={loading} message="Creating your account..." />
        <FeedbackOverlay
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

export default SignUP3;
