import React, { useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  IonButton,
  IonTextarea,
  IonInput,
  IonToast,
  IonAlert,
} from '@ionic/react';
import {
  bugOutline,
  mapOutline,
  personOutline,
  wifiOutline,
  imageOutline,
  closeOutline,
  flagOutline,
  alertCircleOutline,
  cameraOutline,
  checkmarkCircleOutline,
} from 'ionicons/icons';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useAuth } from '../../../context/AuthContext';
import { firestore, storage } from '../../../firebase';

import './ReportProblem.css';

type Category = 'Bug / Crash' | 'Map Issue' | 'Account' | 'Connectivity' | 'Other' | '';
type Severity = 'Low' | 'Medium' | 'High' | '';

const CATEGORIES: { label: Category; icon: string }[] = [
  { label: 'Bug / Crash',   icon: bugOutline       },
  { label: 'Map Issue',     icon: mapOutline       },
  { label: 'Account',       icon: personOutline    },
  { label: 'Connectivity',  icon: wifiOutline      },
  { label: 'Other',         icon: flagOutline      },
];

const ReportProblem: React.FC = () => {
  const [category, setCategory]     = useState<Category>('');
  const [severity, setSeverity]     = useState<Severity>('');
  const [subject,  setSubject]      = useState('');
  const [details,  setDetails]      = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [preview,  setPreview]      = useState<string | null>(null);
  const [showToast, setShowToast]   = useState(false);
  const [toastMsg,  setToastMsg]    = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const { user } = useAuth();

  const handleAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setAttachment(file);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    if (!category) {
      setToastMsg('Please select a problem category.');
      setShowToast(true);
      return;
    }
    if (!subject.trim()) {
      setToastMsg('Please enter a subject for your report.');
      setShowToast(true);
      return;
    }
    if (!details.trim()) {
      setToastMsg('Please describe the problem in more detail.');
      setShowToast(true);
      return;
    }
    setShowConfirm(true);
  };

  const submitReport = async () => {
    try {
      const reportRef = doc(collection(firestore, 'problemReports'));
      let screenshotUrl: string | null = null;

      if (attachment) {
        const imageRef = storageRef(storage, `profilePictures/${user?.uid}/problemReports/${reportRef.id}/screenshot`);
        await uploadBytes(imageRef, attachment, { contentType: attachment.type });
        screenshotUrl = await getDownloadURL(imageRef);
      }

      await setDoc(reportRef, {
        category,
        severity: severity || 'Medium',
        subject: subject.trim(),
        details: details.trim(),
        message: details.trim(),
        screenshotAttached: !!screenshotUrl,
        screenshotUrl,
        userId: user?.uid || null,
        userEmail: user?.email || null,
        userName: user?.displayName || user?.email?.split('@')[0] || 'Tourist',
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      setToastMsg('Report submitted! Thank you for helping us improve.');
      setShowToast(true);
      setCategory('');
      setSeverity('');
      setSubject('');
      setDetails('');
      setAttachment(null);
      setPreview(null);
      setShowConfirm(false);
    } catch (err) {
      console.error('[ReportProblem] submitReport failed', err);
      setToastMsg('Unable to submit your report right now. Please try again later.');
      setShowToast(true);
      setShowConfirm(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings" />
          </IonButtons>
          <IonTitle>Report a Problem</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent>

        {/* Category picker */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={flagOutline} slot="start" />
            <IonLabel><strong>What type of problem?</strong></IonLabel>
          </IonItem>
        </IonList>

        <div className="category-grid">
          {CATEGORIES.map(c => (
            <button
              key={c.label}
              className={`category-chip${category === c.label ? ' category-chip--selected' : ''}`}
              onClick={() => setCategory(c.label)}
            >
              <IonIcon icon={c.icon} />
              {c.label}
            </button>
          ))}
        </div>

        {/* Severity */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={alertCircleOutline} slot="start" />
            <IonLabel><strong>Severity</strong></IonLabel>
          </IonItem>
        </IonList>

        <div className="severity-row">
          {(['Low', 'Medium', 'High'] as Severity[]).map(s => (
            <button
              key={s}
              className={`severity-btn severity-btn--${s.toLowerCase()}${severity === s ? ` severity-btn--selected severity-btn--${s.toLowerCase()}` : ''}`}
              onClick={() => setSeverity(s)}
            >
              {s === 'Low' && '🟢 '}
              {s === 'Medium' && '🟡 '}
              {s === 'High' && '🔴 '}
              {s}
            </button>
          ))}
        </div>

        {/* Subject + details */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={bugOutline} slot="start" />
            <IonLabel><strong>Details</strong></IonLabel>
          </IonItem>
        </IonList>

        <div className="report-form-area">
          <IonInput
            placeholder="Subject (e.g. App crashes on map screen)"
            value={subject}
            onIonInput={e => setSubject(e.detail.value ?? '')}
          />
          <IonTextarea
            placeholder="Describe the problem — what happened, what you expected, and steps to reproduce…"
            rows={6}
            value={details}
            onIonInput={e => setDetails(e.detail.value ?? '')}
          />
        </div>

        {/* Screenshot attach */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={cameraOutline} slot="start" />
            <IonLabel><strong>Attach Screenshot (optional)</strong></IonLabel>
          </IonItem>
          <IonItem lines="none">
            <label className="category-chip" style={{ width: '100%', flexDirection: 'row', gap: 8 }}>
              <IonIcon icon={imageOutline} />
              Choose Image
              <input name="support-screenshot" type="file" accept="image/*" onChange={handleAttach} style={{ display: 'none' }} />
            </label>
          </IonItem>
        </IonList>

        {preview && (
          <div className="attach-preview">
            <img src={preview} alt="Screenshot preview" />
            <button className="attach-remove" onClick={() => { setAttachment(null); setPreview(null); }}>
              <IonIcon icon={closeOutline} />
            </button>
          </div>
        )}

        {/* Submit */}
        <div style={{ padding: '8px 16px 32px' }}>
          <IonButton expand="block" onClick={handleSubmit}>
            <IonIcon icon={checkmarkCircleOutline} slot="start" />
            Submit Report
          </IonButton>
        </div>

        {/* Confirmation alert */}
        <IonAlert
          isOpen={showConfirm}
          onDidDismiss={() => setShowConfirm(false)}
          header="Submit Report"
          message={`Submit a "${severity || 'General'}" report for "${category}"?`}
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            { text: 'Submit', handler: submitReport },
          ]}
        />

        <IonToast
          isOpen={showToast}
          message={toastMsg}
          duration={2800}
          position="bottom"
          onDidDismiss={() => setShowToast(false)}
        />

      </IonContent>
    </IonPage>
  );
};

export default ReportProblem;
