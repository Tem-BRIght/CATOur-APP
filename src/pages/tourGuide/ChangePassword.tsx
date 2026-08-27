import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonContent,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonIcon,
  IonButton,
} from '@ionic/react';
import {
  arrowBackOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline,
  checkmarkCircleOutline,
} from 'ionicons/icons';
import {
  getAuth,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
} from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { firestore } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import './ChangePassword.css';
import FeedbackOverlay from '../../components/FeedbackOverlay';

const auth = getAuth();

function strengthOf(pw: string): 'weak' | 'fair' | 'strong' | null {
  if (!pw) return null;
  if (pw.length < 6) return 'weak';
  if (pw.length < 10 || !/[0-9]/.test(pw)) return 'fair';
  return 'strong';
}

interface Props {
  /** Override forced mode; if not provided, uses the auth context's mustChangePassword */
  forced?: boolean;
  /** Called after a successful forced password change */
  onForceComplete?: () => void;
}

const ChangePassword: React.FC<Props> = ({ forced: forcedProp, onForceComplete }) => {
  const history = useHistory();
  const { mustChangePassword: ctxMustChange } = useAuth();
  const forced = forcedProp ?? ctxMustChange ?? false;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const strength = strengthOf(newPassword);

  const handleSave = async () => {
    setErrorMsg('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setErrorMsg('Please fill in all fields.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('New passwords do not match.');
      return;
    }

    const user = auth.currentUser;
    if (!user || !user.email) {
      setErrorMsg('No authenticated user found. Please log in again.');
      return;
    }

    setIsSaving(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      // Clear mustChangePassword flag in both users and tourGuides
      await Promise.all([
        updateDoc(doc(firestore, 'users', user.uid), { mustChangePassword: false }).catch(() => {}),
        updateDoc(doc(firestore, 'tourGuides', user.uid), { mustChangePassword: false }).catch(() => {}),
      ]);

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowSuccessAlert(true);
    } catch (err: any) {
      switch (err.code) {
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          setErrorMsg('Current password is incorrect. Please try again.');
          break;
        case 'auth/too-many-requests':
          setErrorMsg('Too many attempts. Please wait a moment and try again.');
          break;
        case 'auth/requires-recent-login':
          setErrorMsg('Session expired. Please log out and log in again before changing your password.');
          break;
        default:
          setErrorMsg(err.message || 'Failed to update password. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSuccessDismiss = () => {
    setShowSuccessAlert(false);
    if (forced && onForceComplete) {
      onForceComplete();
    } else {
      // If not forced, go back to profile
      window.history.back();
    }
  };

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar className="profile-header">
          {!forced && (
            <div onClick={() => history.goBack()} className="profile-back-btn">
              <IonIcon icon={arrowBackOutline} />
            </div>
          )}
          <IonTitle className="profile-header-title">Change Password</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="profile-content">
        <div className="cp-wrapper">

          {forced && (
            <div className="cp-banner cp-banner--warning">
              <div className="cp-banner-icon" style={{ background: 'linear-gradient(135deg,#c0392b,#e74c3c)' }}>
                <IonIcon icon={lockClosedOutline} />
              </div>
              <p>
                <strong>Action required.</strong> Your account was created with a temporary password.
                Please set a new password before continuing.
              </p>
            </div>
          )}

          {!forced && (
            <div className="cp-banner">
              <div className="cp-banner-icon">
                <IonIcon icon={lockClosedOutline} />
              </div>
              <p>Keep your account secure by using a strong password you don't use elsewhere.</p>
            </div>
          )}

          <div className="cp-section">
            <p className="section-label">
              {forced ? 'Temporary Password (Current)' : 'Current Password'}
            </p>
            <div className="edit-field">
              <div className="edit-input-wrap">
                <IonIcon icon={lockClosedOutline} className="edit-field-icon" />
                <input
                  className="edit-input"
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder={forced ? 'Enter your temporary password' : 'Enter current password'}
                />
                <IonIcon
                  icon={showCurrent ? eyeOffOutline : eyeOutline}
                  className="eye-icon"
                  onClick={() => setShowCurrent(!showCurrent)}
                />
              </div>
            </div>
          </div>

          <div className="cp-section">
            <p className="section-label">New Password</p>
            <div className="edit-field">
              <div className="edit-input-wrap">
                <IonIcon icon={lockClosedOutline} className="edit-field-icon" />
                <input
                  className="edit-input"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min. 8 chars)"
                />
                <IonIcon
                  icon={showNew ? eyeOffOutline : eyeOutline}
                  className="eye-icon"
                  onClick={() => setShowNew(!showNew)}
                />
              </div>

              {strength && (
                <div className="strength-wrap">
                  <div className="strength-bars">
                    <div className={`strength-bar ${['weak','fair','strong'].includes(strength!) ? 'active weak-color' : ''}`} />
                    <div className={`strength-bar ${['fair','strong'].includes(strength!) ? 'active fair-color' : ''}`} />
                    <div className={`strength-bar ${strength === 'strong' ? 'active strong-color' : ''}`} />
                  </div>
                  <span className={`strength-label ${strength}`}>
                    {strength.charAt(0).toUpperCase() + strength.slice(1)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="cp-section">
            <p className="section-label">Confirm New Password</p>
            <div className="edit-field">
              <div className={`edit-input-wrap ${confirmPassword && confirmPassword !== newPassword ? 'input-error' : ''}`}>
                <IonIcon icon={lockClosedOutline} className="edit-field-icon" />
                <input
                  className="edit-input"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                />
                <IonIcon
                  icon={showConfirm ? eyeOffOutline : eyeOutline}
                  className="eye-icon"
                  onClick={() => setShowConfirm(!showConfirm)}
                />
              </div>
              {confirmPassword && confirmPassword === newPassword && (
                <div className="match-msg">
                  <IonIcon icon={checkmarkCircleOutline} />
                  <span>Passwords match</span>
                </div>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="cp-error">
              <span>{errorMsg}</span>
            </div>
          )}

          <IonButton
            expand="block"
            className="save-btn"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save New Password'}
          </IonButton>

        </div>
      </IonContent>

      <FeedbackOverlay
        isOpen={showSuccessAlert}
        onDidDismiss={handleSuccessDismiss}
        header="Password Updated"
        message={
          forced
            ? 'Your password has been changed. Welcome to your guide dashboard!'
            : 'Your password has been changed successfully.'
        }
        buttons={[{ text: 'OK', role: 'confirm' }]}
      />
    </IonPage>
  );
};

export default ChangePassword;
