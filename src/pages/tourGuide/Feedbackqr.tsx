import React, { useEffect, useState } from 'react';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useHistory, useParams } from 'react-router-dom';
import { arrowBackOutline, listOutline, timeOutline } from 'ionicons/icons';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '../../firebase';
import './Feedbackqr.css';

const buildQRUrl = (data: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(data)}&color=0d2f6e&bgcolor=ffffff&ecc=H&margin=10`;

const FeedbackQR: React.FC = () => {
  const history = useHistory();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [qrUrl, setQrUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [expiresIn, setExpiresIn] = useState(600);
  const [sessionData, setSessionData] = useState<any>(null);
  const feedbackUrl = sessionId ? `${window.location.origin}/feedback/${sessionId}` : '';

  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        const sessionSnap = await getDoc(doc(firestore, 'sessions', sessionId));
        if (sessionSnap.exists()) setSessionData({ id: sessionSnap.id, ...sessionSnap.data() });
        setQrUrl(buildQRUrl(feedbackUrl));
      } catch (err) {
        console.error('Failed to load session data:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [sessionId, feedbackUrl]);

  useEffect(() => {
    const interval = setInterval(() => {
      setExpiresIn((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainingSeconds}`;
  };

  const isExpired = expiresIn === 0;

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar className="fqr-header">
          <div onClick={() => history.goBack()} className="fqr-back-btn">
            <IonIcon icon={arrowBackOutline} />
          </div>
          <IonTitle className="fqr-title">FEEDBACK QR</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="fqr-content">
        <div className="fqr-wrapper">
          <div className="fqr-hero">
            <h2>Tour Completed!</h2>
            <p>Let your tourists share their experience. Ask them to scan this QR to leave a review.</p>
          </div>
          <div className={`fqr-card ${isExpired ? 'fqr-expired' : ''}`}>
            <div className="fqr-card-inner">
              {isLoading ? <div className="fqr-loading"><IonSpinner name="crescent" /><p>Loading QR…</p></div>
                : isExpired ? <div className="fqr-expired-overlay"><IonIcon icon={timeOutline} /><p>QR Expired</p><span>The feedback window has closed.</span></div>
                : <img src={qrUrl} alt="Feedback QR code" className="fqr-image" />}
            </div>
            {!isLoading && <div className={`fqr-timer ${expiresIn <= 60 ? 'fqr-timer--warning' : ''} ${isExpired ? 'fqr-timer--expired' : ''}`}><IonIcon icon={timeOutline} /><span>{isExpired ? 'Expired' : `Available for ${formatTime(expiresIn)}`}</span></div>}
          </div>
          {sessionId && (
            <div style={{ marginTop: 16 }}>
              <IonButton expand="block" fill="outline" onClick={() => history.push(`/reviews/${sessionId}`)}>
                View feedback status
              </IonButton>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default FeedbackQR;
