import React, { useState, useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonContent, IonPage, IonToolbar, IonButtons,
  IonBackButton, IonButton, IonInput, IonItem, IonLabel,
  IonIcon, IonLoading, IonAlert, IonAvatar, IonSelect, IonSelectOption,
} from '@ionic/react';
import { useIonViewWillEnter } from '@ionic/react';
import { arrowBackOutline, cameraOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { createUserWithEmailAndPassword, deleteUser, signOut } from "firebase/auth";
import { auth } from "../../../firebase";
import { useSignup } from '../../../context/SignupContext';
import { useAuth } from '../../../context/AuthContext';
import { createUserProfile } from '../../../services/userProfileService';
import OtherSelect from '../../../components/OtherSelect';
import '../signup.css';
import './googleUser.css';

const RELIGIONS = [
  'Roman Catholic','Islam','Evangelical','Iglesia ni Cristo','Seventh-day Adventist',
  'United Church of Christ','Baptist','Other Christian','Buddhist','Hindu','Non-religious','Other',
];

const GoogleUserProfile: React.FC = () => {
  const history  = useHistory();
  const { signupData, updateSignupData, resetSignupData } = useSignup();
  const { user: authUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [firstName,    setFirstName]    = useState(signupData.firstName ?? '');
  const [surname,      setSurname]      = useState(signupData.surname   ?? '');
  const [dateOfBirth,  setDateOfBirth]  = useState(signupData.dateOfBirth || '');
  const [age,          setAge]          = useState<string>(signupData.age ? String(signupData.age) : '');
  const [username,     setUsername]     = useState(signupData.username || signupData.firstName || '');
  const [nationality,  setNationality]  = useState(signupData.nationality || '');
  const [otherNationality, setOtherNationality] = useState('');
  const [gender,       setGender]       = useState(signupData.gender || '');
  const [religion,     setReligion]     = useState('');
  const [otherReligion, setOtherReligion] = useState('');
  const [address,      setAddress]      = useState(signupData.address ?? '');
  const [acceptedTerms,setAcceptedTerms]= useState(signupData.acceptedTerms ?? false);
  const [profilePic,   setProfilePic]   = useState<string | null>(signupData.profilePic);
  const [loading,      setLoading]      = useState(false);
  const [alert,        setAlert]        = useState<{ header: string; message: string; show: boolean }>({ header: '', message: '', show: false });
  const [showCancelAlert, setShowCancelAlert] = useState(false);

  useIonViewWillEnter(() => {
    setAcceptedTerms(signupData.acceptedTerms ?? false);
  });

  useEffect(() => {
    setAcceptedTerms(signupData.acceptedTerms ?? false);
  }, [signupData.acceptedTerms]);

  const isGoogleUser = signupData.isGoogleUser;



  useEffect(() => {
    if (!isGoogleUser && !signupData.email) history.push('/login');
  }, [isGoogleUser, signupData.email, history]);

  const handleCancel = async () => {
    setShowCancelAlert(false);
    setLoading(true);
    try {
      // A Google account on this screen has authenticated but does not yet
      // have a completed profile. Remove it so cancel really abandons signup.
      if (isGoogleUser && auth.currentUser?.uid === signupData.uid) {
        await deleteUser(auth.currentUser);
      }
    } catch (error) {
      console.error('[GoogleUserProfile] Could not delete incomplete Google account', error);
      // Sign out even if Firebase requires a fresh login before deletion.
    } finally {
      await signOut(auth).catch(() => undefined);
      resetSignupData();
      setLoading(false);
      history.replace('/login');
    }
  };

  const handleDobChange = (value: string) => {
    setDateOfBirth(value);
    if (value) {
      const today = new Date();
      const dob   = new Date(value);
      let calcAge = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setProfilePic(result);
      updateSignupData({ profilePic: result });
    };
    reader.readAsDataURL(file);
  };

  const handleSignUp = async () => {
    const selectedNationality = nationality === 'other' ? otherNationality.trim() : nationality;
    const selectedReligion = religion === 'Other' ? otherReligion.trim() : religion;
    const required = [
      { field: firstName.trim(), name: 'First Name' },
      { field: surname.trim(),   name: 'Surname' },
      { field: dateOfBirth.trim(),name: 'Date of Birth' },
      { field: gender,          name: 'Gender' },
      { field: selectedNationality, name: 'Nationality' },
    ];
    const missing = required.find(item => !item.field);
    if (missing) {
      setAlert({ header: 'Missing Field', message: `Please enter your ${missing.name}.`, show: true });
      return;
    }
    if (!address.trim()) {
      setAlert({ header: 'Missing Address', message: 'Please enter your full address.', show: true });
      return;
    }
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let calculatedAge = today.getFullYear() - dob.getFullYear();
    const monthDifference = today.getMonth() - dob.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dob.getDate())) calculatedAge--;
    if (Number.isNaN(dob.getTime()) || dob > today || calculatedAge < 10) {
      setAlert({ header: 'Age Requirement', message: 'You must be at least 10 years old to create an account.', show: true });
      return;
    }
    if (!selectedReligion) {
      setAlert({ header: 'Missing Field', message: 'Please select your religion.', show: true });
      return;
    }
    if (!acceptedTerms) {
      setAlert({ header: 'Terms Required', message: 'Please accept the Terms and Conditions to continue.', show: true });
      return;
    }

    setLoading(true);
    try {
      let userId = signupData.uid || authUser?.uid;
      const email = signupData.email || authUser?.email || '';

      if (isGoogleUser) {
        if (!userId) {
          throw new Error('Unable to get Google user ID. Please sign in again.');
        }
      } else {
        if (!email || !signupData.password) {
          throw new Error('Missing signup credentials. Please start again from the account creation step.');
        }
        const userCredential = await createUserWithEmailAndPassword(auth, email, signupData.password);
        userId = userCredential.user.uid;
      }

      if (!userId) throw new Error('Unable to get user ID');

      const userData = {
        name:      { firstname: firstName, surname, suffix: signupData.suffix || '' },
        email,
        dateOfBirth,
        age:       age || '',
        nationality: selectedNationality,
        nickname:  username,
        img:       profilePic,
        address:   address.trim(),
        gender,
        religion: selectedReligion,
        isGoogleUser,
        isFullyRegistered: true,
        emailVerified: auth.currentUser?.emailVerified ?? false,
        phoneVerified: false,
        createdAt: new Date().toISOString(),
      };

      await createUserProfile(userId, userData);
      resetSignupData();
      history.push('/home');
    } catch (error: any) {
      const message =
        error.code === 'auth/email-already-in-use'
          ? 'This email is already registered. Please log in or use a different email.'
          : error.code === 'auth/weak-password'
          ? 'Password is too weak. Please choose a stronger password.'
          : error.message || 'An error occurred during profile setup.';
      setAlert({ header: 'Profile Setup Failed', message, show: true });
    } finally {
      setLoading(false);
    }
  };

  const pageTitle    = isGoogleUser ? 'Complete Your Profile' : 'Create Profile';
  const pageSubtitle = isGoogleUser ? 'Finish setting up your account' : 'Create your profile';

  return (
    <IonPage>
      <IonContent className="login-content google-profile-content" fullscreen>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton
              aria-label="Cancel profile setup"
              fill="clear"
              className="google-profile-back-button"
              onClick={() => setShowCancelAlert(true)}
              disabled={loading}
            >
              <IonIcon icon={arrowBackOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>

        <div className="logo-wrap">
          <img src="/assets/images/Pasig Logo.png" alt="Pasig Logo" className="logo" />
        </div>
        <h2 className="title">Catour</h2>
        <p className="subtitle">DISCOVER THE PASIG WITH AI GUIDANCE!</p>

        <div className="login-card google-profile-card">
          <div className="form google-profile-form">
            <p className="formSubtitle">{pageSubtitle}</p>

            {/* Photo Upload */}
            <div className="photo-upload">
              <div className="photo-container">
                <IonAvatar className={`profile-avatar ${profilePic ? 'has-photo' : 'no-photo'}`}>
                  {profilePic ? (
                    <img src={profilePic} alt="Profile" />
                  ) : (
                    <div className="placeholder">
                      <IonIcon icon={cameraOutline} className="placeholder-icon" />
                      <span>Add Photo</span>
                    </div>
                  )}
                </IonAvatar>
                <input name="googleuser-photo" type="file" ref={fileInputRef} accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
                <IonButton fill="clear" className="camera-button" onClick={() => fileInputRef.current?.click()} disabled={loading}>
                  <IonIcon icon={profilePic ? checkmarkCircleOutline : cameraOutline} />
                </IonButton>
              </div>
              <p className="photo-hint">{profilePic ? 'Tap to change photo' : 'Tap the camera icon to upload a profile picture'}</p>
            </div>

            {/* Name fields */}
            <IonLabel position="stacked" className="signup-3-label">First Name *</IonLabel>
            <IonItem className="input-item">
              <IonInput placeholder="Enter your first name" value={firstName} onIonChange={(e) => setFirstName(e.detail.value!)} className="text-input" />
            </IonItem>

            <IonLabel position="stacked" className="signup-3-label">Surname *</IonLabel>
            <IonItem className="input-item">
              <IonInput placeholder="Enter your surname" value={surname} onIonChange={(e) => setSurname(e.detail.value!)} className="text-input" />
            </IonItem>

            {/* Date of Birth */}
            <IonLabel position="stacked" className="signup-3-label">Date of Birth *</IonLabel>
            <IonItem className="input-item">
              <IonInput placeholder="YYYY-MM-DD" type="date" value={dateOfBirth} onIonChange={(e) => handleDobChange(e.detail.value!)} className="text-input" />
            </IonItem>

            {/* Age */}
            <IonLabel position="stacked" className="signup-3-label">Age</IonLabel>
            <IonItem className="input-item">
              <IonInput placeholder="Auto-filled from date of birth" type="number" value={age} onIonChange={(e) => setAge(e.detail.value!)} className="text-input" />
            </IonItem>
            <IonLabel className={`age-validation-label${ageValidationError ? ' age-validation-label--error' : ''}`}>
              {ageValidationLabel}
            </IonLabel>

            {/* Username */}
            <IonLabel position="stacked" className="signup-3-label">Username</IonLabel>
            <IonItem className="input-item">
              <IonInput placeholder="Enter your username" value={username} onIonChange={(e) => setUsername(e.detail.value!)} className="text-input" />
            </IonItem>

            {/* Gender */}
            <IonLabel position="stacked" className="signup-3-label">Gender *</IonLabel>
            <IonItem className="input-item">
              <IonSelect placeholder="Select your gender" value={gender} onIonChange={e => setGender(e.detail.value ?? '')}>
                <IonSelectOption value="Male">Male</IonSelectOption>
                <IonSelectOption value="Female">Female</IonSelectOption>
                <IonSelectOption value="Non-binary">Non-binary</IonSelectOption>
                <IonSelectOption value="Prefer not to say">Prefer not to say</IonSelectOption>
              </IonSelect>
            </IonItem>

            {/* Nationality */}
            <OtherSelect
              label="Nationality"
              options={['filipino', 'american', 'japanese', 'korean', 'chinese', 'Other'].map(value => (
                value === 'Other' ? value : value.charAt(0).toUpperCase() + value.slice(1)
              ))}
              value={nationality}
              otherValue={otherNationality}
              onChange={setNationality}
              onOtherChange={setOtherNationality}
            />

            {/* Religion */}
            <OtherSelect
              label="Religion"
              options={RELIGIONS}
              value={religion}
              otherValue={otherReligion}
              onChange={setReligion}
              onOtherChange={setOtherReligion}
            />

            {/* Address */}
            <IonLabel position="stacked" className="signup-3-label">Address *</IonLabel>
            <IonItem className="input-item">
              <IonInput
                placeholder="Enter your full address"
                value={address}
                onIonChange={(e) => setAddress(e.detail.value!)}
                className="text-input"
              />
            </IonItem>

            {/* Terms */}
            <div className="terms-container">
              <div className="checkbox-wrapper">
                <input
                  type="checkbox"
                  id="terms"
                  checked={acceptedTerms}
                  onChange={e => {
                    setAcceptedTerms(e.target.checked);
                    updateSignupData({ acceptedTerms: e.target.checked });
                  }}
                  className="terms-checkbox"
                />
                <label htmlFor="terms" className="terms-label">
                  I agree to the{' '}
                  <a
                    href="#"
                    className="terms-link"
                    onClick={e => {
                      e.preventDefault();
                      history.push('/terms-signup?tab=terms&returnTo=%2FgoogleUser');
                    }}
                  >Terms and Conditions</a>
                  {' '}and{' '}
                  <a
                    href="#"
                    className="terms-link"
                    onClick={e => {
                      e.preventDefault();
                      history.push('/terms-signup?tab=privacy&returnTo=%2FgoogleUser');
                    }}
                  >Privacy Policy</a>
                </label>
              </div>
              {!acceptedTerms && <p className="terms-error">Please accept the terms to continue</p>}
            </div>

            <IonButton expand="block" className="login-button" onClick={handleSignUp} disabled={loading}>
              {isGoogleUser ? 'Complete Profile' : 'Sign Up'}
            </IonButton>
          </div>
        </div>

        <IonLoading isOpen={loading} message={isGoogleUser ? 'Completing your profile...' : 'Creating your account...'} />
        <IonAlert
          isOpen={alert.show}
          onDidDismiss={() => setAlert(prev => ({ ...prev, show: false }))}
          header={alert.header}
          message={alert.message}
          buttons={['OK']}
        />
        <IonAlert
          isOpen={showCancelAlert}
          onDidDismiss={() => setShowCancelAlert(false)}
          header="Cancel profile setup?"
          message={isGoogleUser
            ? 'Your incomplete Google sign-up will be removed.'
            : 'Your unsaved profile details will be discarded.'}
          buttons={[
            { text: 'Keep editing', role: 'cancel' },
            { text: 'Cancel setup', role: 'destructive', handler: handleCancel },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default GoogleUserProfile;
