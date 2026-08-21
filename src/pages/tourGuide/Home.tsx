import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonContent,
  IonPage,
  IonIcon,
  IonGrid,
  IonRow,
  IonCol,
  IonFooter,
  IonToolbar,
  IonButton,
  IonRouterLink,
} from '@ionic/react';
import {
  peopleOutline,
  timeOutline,
  qrCodeOutline,
} from 'ionicons/icons';
import { doc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { firestore } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import './Home.css';

const Home: React.FC = () => {
  const { currentUser } = useAuth();
  const history = useHistory();
  const [guideName, setGuideName] = useState('Tour Guide');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showTouristList, setShowTouristList] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // CHANGED: only show the Tourist List card when an active session exists
  // and at least one tourist has joined the session.

  useEffect(() => {
    if (!currentUser) return;
    const fetchName = async () => {
      try {
        let name = '';
        let avatar = '';
        // 1. Try users collection
        const userSnap = await getDoc(doc(firestore, 'users', currentUser.uid));
        if (userSnap.exists()) {
          const data = userSnap.data();
          const first = data?.name?.firstname || '';
          const last = data?.name?.surname || '';
          if (first || last) name = `${first} ${last}`.trim();
          avatar = data?.img || data?.photoUrl || '';
        }

        // 2. Fallback to tourGuides
        if (!name || !avatar) {
          const guideSnap = await getDoc(doc(firestore, 'tourGuides', currentUser.uid));
          if (guideSnap.exists()) {
            const data = guideSnap.data();
            if (!name) {
              const first = data['firstName'] || data['firstname'] || '';
              const last = data['lastName'] || data['lastname'] || '';
              if (first || last) name = `${first} ${last}`.trim();
            }
            if (!avatar) {
              avatar = data['photoUrl'] || data['img'] || '';
            }
          }
        }

        if (name) setGuideName(name);
        if (avatar) setAvatarUrl(avatar);
      } catch (err) {
        console.error('Failed to load guide name:', err);
      }
    };
    fetchName();
  }, [currentUser]);

  // ── Real-time check for an active session ─────────────────────────────
  // CHANGED: was a one-time getDocs() read (never updated live), and only
  // stored a boolean. Now uses onSnapshot AND stores the session's actual
  // ID, so the "Tourist List" card can link straight to that session
  // instead of relying on TouristList.tsx guessing the "latest" one.
  useEffect(() => {
    if (!currentUser) return;

    const sessionsQuery = query(
      collection(firestore, 'sessions'),
      where('guideId', '==', currentUser.uid),
      where('status', 'in', ['active', 'pending'])
    );

    const unsub = onSnapshot(
      sessionsQuery,
      (snap) => {
        if (snap.empty) {
          setShowTouristList(false);
          setActiveSessionId(null);
          return;
        }

        const activeSessionDoc = snap.docs.find((doc) => (doc.data() as any).status === 'active');
        const pendingJoinedDoc = snap.docs.find((doc) => {
          const data = doc.data() as any;
          return data.status === 'pending' && Array.isArray(data.tourists) && data.tourists.length > 0;
        });

        const selectedDoc = activeSessionDoc || pendingJoinedDoc;
        if (!selectedDoc) {
          setShowTouristList(false);
          setActiveSessionId(null);
          return;
        }

        setActiveSessionId(selectedDoc.id);
        setShowTouristList(true);
      },
      (err) => {
        console.error('Failed to check active session:', err);
        setShowTouristList(false);
        setActiveSessionId(null);
      }
    );

    return () => unsub();
  }, [currentUser]);

  return (
    <IonPage>
      <IonContent className="home-content" fullscreen>

        <div className="home-hero">
          <IonRouterLink routerLink="/tourguide/profile" className="profile-link">
            <div
              className="profile-avatar"
              style={{
                backgroundImage: `url(${avatarUrl || 'https://ionicframework.com/docs/img/demos/avatar.svg'})`,
              }}
            />
          </IonRouterLink>

          <div className="welcome-section">
            <h2>CATOUR</h2>
            <h1>TOURGUIDE</h1>
            <p style={{ color: 'rgba(255,255,255,0.8)', marginTop: '0.5rem', fontSize: '1rem' }}>
            </p>
          </div>
        </div>

        <div className="quick-actions">
          <IonGrid>
            <IonRow>
              {showTouristList && (
                <IonCol size="6">
                  <div
                    className="action-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (activeSessionId) {
                        history.push(`/tourguide/list/${activeSessionId}`);
                      } else {
                        history.push('/tourguide/list');
                      }
                    }}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (activeSessionId ? history.push(`/tourguide/list/${activeSessionId}`) : history.push('/tourguide/list'))}
                  >
                    <div className="action-icon tourist">
                      <IonIcon icon={peopleOutline} />
                    </div>
                    <h4>Tourist List</h4>
                    <p>View all tourists</p>
                  </div>
                </IonCol>
              )}

              <IonCol size={showTouristList ? '6' : '12'}>
                <div className="action-card" role="button" tabIndex={0} onClick={() => history.push('/tourguide/history')} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && history.push('/tourguide/history')}>
                  <div className="action-icon history">
                    <IonIcon icon={timeOutline} />
                  </div>
                  <h4>History</h4>
                  <p>Past activities</p>
                </div>
              </IonCol>
            </IonRow>
          </IonGrid>
        </div>

      </IonContent>

      <IonFooter className="ion-no-border">
        <IonToolbar className="footer-toolbar">
          <div className="qr-scanner-container">
            <IonButton
              className="qr-scanner-circle"
              shape="round"
              routerLink="/tourguide/generateQR"
            >
              <IonIcon icon={qrCodeOutline} />
            </IonButton>
            <p className="qr-scanner-label">Generate QR Code</p>
          </div>
        </IonToolbar>
      </IonFooter>
    </IonPage>
  );
};

export default Home;