import React, { useMemo, useState } from 'react';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToast,
  IonToolbar,
} from '@ionic/react';
import type { AutocompleteTypes } from '@ionic/core';
import { checkmarkOutline, eyeOffOutline, eyeOutline } from 'ionicons/icons';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { useHistory } from 'react-router-dom';
import { auth } from '../../../firebase';
import './ChangePassword.css';

const MIN_PASSWORD_LENGTH = 8;

type FieldName = 'currentPassword' | 'newPassword' | 'confirmPassword';
type FieldState = { value: string; visible: boolean; touched: boolean };

const FIELD_CONFIG: Record<
  FieldName,
  { label: string; placeholder: string; autocomplete: AutocompleteTypes }
> = {
  currentPassword: {
    label: 'Current password',
    placeholder: 'Enter your current password',
    autocomplete: 'current-password',
  },
  newPassword: {
    label: 'New password',
    placeholder: 'Create a new password',
    autocomplete: 'new-password',
  },
  confirmPassword: {
    label: 'Confirm new password',
    placeholder: 'Re-enter your new password',
    autocomplete: 'new-password',
  },
};

const REQUIREMENTS: { key: string; label: string; test: (v: string) => boolean }[] = [
  { key: 'length', label: `${MIN_PASSWORD_LENGTH}+ characters`, test: (v) => v.length >= MIN_PASSWORD_LENGTH },
  { key: 'upper', label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { key: 'number', label: 'One number', test: (v) => /[0-9]/.test(v) },
];

const ChangePassword: React.FC = () => {
  const history = useHistory();
  const user = auth.currentUser;
  const isPasswordProvider = user?.providerData.some((p) => p.providerId === 'password') ?? false;

  const [fields, setFields] = useState<Record<FieldName, FieldState>>({
    currentPassword: { value: '', visible: false, touched: false },
    newPassword: { value: '', visible: false, touched: false },
    confirmPassword: { value: '', visible: false, touched: false },
  });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; color: string } | null>(null);

  const updateField = (field: FieldName, value: string) => {
    setFields((prev) => ({ ...prev, [field]: { ...prev[field], value } }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const markTouched = (field: FieldName) => {
    setFields((prev) => ({ ...prev, [field]: { ...prev[field], touched: true } }));
  };

  const toggleVisibility = (field: FieldName) => {
    setFields((prev) => ({ ...prev, [field]: { ...prev[field], visible: !prev[field].visible } }));
  };

  const requirementsMet = useMemo(
    () => REQUIREMENTS.map((r) => ({ ...r, met: r.test(fields.newPassword.value) })),
    [fields.newPassword.value]
  );
  const metCount = requirementsMet.filter((r) => r.met).length;
  const strength: 'empty' | 'weak' | 'fair' | 'strong' =
    fields.newPassword.value.length === 0
      ? 'empty'
      : metCount <= 1
      ? 'weak'
      : metCount === 2
      ? 'fair'
      : 'strong';

  const strengthCopy: Record<typeof strength, string> = {
    empty: '',
    weak: 'Weak',
    fair: 'Fair',
    strong: 'Strong',
  };

  const validate = () => {
    const nextErrors: Partial<Record<FieldName, string>> = {};
    const { currentPassword, newPassword, confirmPassword } = fields;

    if (!currentPassword.value) nextErrors.currentPassword = 'Enter your current password.';

    if (!newPassword.value) {
      nextErrors.newPassword = 'Enter a new password.';
    } else if (metCount < REQUIREMENTS.length) {
      nextErrors.newPassword = 'Your password doesn\u2019t meet all the requirements below.';
    } else if (newPassword.value === currentPassword.value) {
      nextErrors.newPassword = 'New password must be different from your current password.';
    }

    if (!confirmPassword.value) nextErrors.confirmPassword = 'Confirm your new password.';
    else if (confirmPassword.value !== newPassword.value) nextErrors.confirmPassword = 'Passwords do not match.';

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const firebaseMessage = (code: string) => {
    switch (code) {
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Your current password is incorrect.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'auth/requires-recent-login':
        return 'For security, please sign out and back in, then try again.';
      case 'auth/weak-password':
        return 'Please choose a stronger password.';
      default:
        return 'Something went wrong. Please try again.';
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!user?.email) {
      setToast({ message: 'You need to be signed in to change your password.', color: 'danger' });
      return;
    }
    if (!isPasswordProvider) {
      setToast({
        message: 'This account signs in with Google, so there\u2019s no password to change here.',
        color: 'warning',
      });
      return;
    }
    if (!validate()) return;

    setSubmitting(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, fields.currentPassword.value);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, fields.newPassword.value);

      setFields({
        currentPassword: { value: '', visible: false, touched: false },
        newPassword: { value: '', visible: false, touched: false },
        confirmPassword: { value: '', visible: false, touched: false },
      });
      setToast({ message: 'Password updated.', color: 'success' });
      window.setTimeout(() => history.goBack(), 1100);
    } catch (error: any) {
      setToast({ message: firebaseMessage(error?.code ?? ''), color: 'danger' });
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (field: FieldName) => {
    const cfg = FIELD_CONFIG[field];
    const state = fields[field];
    const error = errors[field];

    return (
      <div className="cp-field">
        <label className="cp-label" htmlFor={`cp-${field}`}>
          {cfg.label}
        </label>
        <IonItem className={`cp-item ${error ? 'cp-item-error' : ''}`} lines="none">
          <IonInput
            id={`cp-${field}`}
            className="cp-input"
            type={state.visible ? 'text' : 'password'}
            value={state.value}
            autocomplete={cfg.autocomplete}
            onIonInput={(e) => updateField(field, e.detail.value ?? '')}
            onIonBlur={() => markTouched(field)}
            placeholder={cfg.placeholder}
          />
          <button
            type="button"
            className="cp-toggle"
            onClick={() => toggleVisibility(field)}
            aria-label={`${state.visible ? 'Hide' : 'Show'} ${cfg.label.toLowerCase()}`}
          >
            <IonIcon icon={state.visible ? eyeOffOutline : eyeOutline} />
          </button>
        </IonItem>

        {field === 'newPassword' && state.value.length > 0 && (
          <div className={`cp-strength cp-strength-${strength}`}>
            <div className="cp-strength-track">
              <span className="cp-strength-fill" />
            </div>
            <span className="cp-strength-label">{strengthCopy[strength]}</span>
          </div>
        )}

        {field === 'newPassword' && (
          <ul className="cp-requirements">
            {requirementsMet.map((r) => (
              <li key={r.key} className={r.met ? 'is-met' : ''}>
                <span className="cp-req-icon">{r.met && <IonIcon icon={checkmarkOutline} />}</span>
                {r.label}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="cp-error">{error}</p>}
      </div>
    );
  };

  if (!user || !isPasswordProvider) {
    return (
      <IonPage className="cp-page">
        <IonHeader className="cp-header">
          <IonToolbar>
            <IonButtons slot="start">
              <IonBackButton defaultHref="/settings" text="" />
            </IonButtons>
            <IonTitle>Password settings</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonContent className="cp-content" fullscreen>
          <div className="cp-card cp-provider-message">
            <div className="cp-intro">
              <span className="cp-eyebrow">Account security</span>
              <h1 className="cp-heading">No password to change</h1>
              <p className="cp-subtext">
                This account uses Google sign-in. Manage your password through your Google account instead.
              </p>
            </div>
            <IonButton expand="block" className="cp-submit" onClick={() => history.goBack()}>
              Back to settings
            </IonButton>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage className="cp-page">
      <IonHeader className="cp-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings" text="" />
          </IonButtons>
          <IonTitle>Change password</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="cp-content" fullscreen>
        
          <form className="cp-card" onSubmit={handleSubmit} noValidate>
            <div className="cp-wrap">
          <div className="cp-intro">
            <span className="cp-eyebrow">Account security</span>
            <h1 className="cp-heading">Update your password</h1>
            <p className="cp-subtext">
              Use a password you don&rsquo;t use anywhere else. You&rsquo;ll stay signed in on this device.
            </p>
          </div>
        </div>
            {renderField('currentPassword')}
            <div className="cp-divider" />
            {renderField('newPassword')}
            {renderField('confirmPassword')}

            <IonButton expand="block" type="submit" className="cp-submit" disabled={submitting}>
              {submitting ? <IonSpinner name="dots" /> : 'Save new password'}
            </IonButton>
          </form>
      </IonContent>

      <IonToast
        isOpen={!!toast}
        message={toast?.message}
        color={toast?.color}
        duration={2500}
        onDidDismiss={() => setToast(null)}
        position="top"
      />
    </IonPage>
  );
};

export default ChangePassword;