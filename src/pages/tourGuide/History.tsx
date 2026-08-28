import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { 
  IonContent, 
  IonPage, 
  IonHeader,
  IonToolbar,
  IonTitle,
  IonIcon,
  IonCard,
  IonCardContent,
  IonModal,
  IonButton,
  IonList,
  IonItem,
  IonSearchbar,
} from '@ionic/react';
import { 
  arrowBackOutline,
  timeOutline,
  calendarOutline,
  peopleOutline,
  checkmarkCircle,
  timeOutline as pendingIcon,
  personOutline,
  mapOutline,
  cardOutline,
  walkOutline,
  search,
} from 'ionicons/icons';
import './History.css';
import { useAuth } from '../../context/AuthContext';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { firestore } from '../../firebase';

const formatSessionDuration = (session: any) => {
  if (typeof session.durationSeconds === 'number') {
    const hours = Math.floor(session.durationSeconds / 3600);
    const minutes = Math.floor((session.durationSeconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  const start = session.startTime ? new Date(session.startTime).getTime() : 0;
  const end = session.endTime ? new Date(session.endTime).getTime() : Date.now();
  const totalMinutes = Math.max(0, Math.floor((end - start) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

/* ── Tour info block — used only in the modal ── */
const TourInfoBlock: React.FC<{ session: any }> = ({ session }) => (
  <div className="modal-tour-info-card">

    <div className="modal-tour-info-row">
      <IonIcon icon={walkOutline} className="modal-tour-info-icon" />
      <div className="modal-tour-info-text">
        <span className="modal-tour-info-label">Tour Type</span>
        <span className="modal-tour-info-value">{session.tourTypeName || 'Tour'}</span>
      </div>
    </div>

    <div className="modal-tour-info-divider" />

    <div className="modal-tour-info-row modal-tour-info-row--top">
      <IonIcon icon={mapOutline} className="modal-tour-info-icon" />
      <div className="modal-tour-info-text">
        <span className="modal-tour-info-label">Destination</span>
        <span className="modal-tour-info-value">{session.destinationName ?? '—'}</span>
      </div>
    </div>

    <div className="modal-tour-info-divider" />

    <div className="modal-tour-info-row">
      <IonIcon icon={timeOutline} className="modal-tour-info-icon" />
      <div className="modal-tour-info-text">
        <span className="modal-tour-info-label">Duration</span>
        <span className="modal-tour-info-value">{formatSessionDuration(session)}</span>
      </div>
    </div>

    <div className="modal-tour-info-divider" />

    <div className="modal-tour-info-row">
      <IonIcon icon={cardOutline} className="modal-tour-info-icon" />
      <div className="modal-tour-info-text">
        <span className="modal-tour-info-label">ID</span>
        <span
          className={`modal-tour-info-value modal-tour-info-id ${
            session.tourId ? '' : 'modal-tour-info-id--empty'
          }`}
        >
          {session.tourId || 'Not assigned'}
        </span>
      </div>
    </div>

  </div>
);

const History: React.FC = () => {
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [showModal, setShowModal]             = useState(false);
  const [sessions, setSessions]               = useState<any[]>([]);
  const [searchQuery, setSearchQuery]         = useState('');
  const [loading, setLoading]                 = useState(false);
  const history = useHistory();
  const { currentUser } = useAuth();

  const handleViewSession = (sessionId: string) => {
    history.push(`/tourguide/list/${sessionId}`);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!currentUser?.uid) return;
      setLoading(true);
      try {
        const q = query(
          collection(firestore, 'sessions'),
          where('guideId', '==', currentUser.uid)
        );
        const snap = await getDocs(q);
        if (cancelled) return;

        const feedbackSnap = await getDocs(
          query(collection(firestore, 'feedback'), where('guideId', '==', currentUser.uid))
        );
        const reviewedKeys = new Set(
          feedbackSnap.docs.map((feedbackDoc) => {
            const feedback = feedbackDoc.data() as any;
            return `${feedback.sessionId}_${feedback.touristId}`;
          })
        );

        const docs = snap.docs
          .map(d => {
            const data: any = d.data();
            const start = data.startTime ? new Date(data.startTime).getTime() : null;
            const end = data.endTime ? new Date(data.endTime).getTime() : null;
            const durationSeconds = typeof data.durationSeconds === 'number'
              ? data.durationSeconds
              : (start && end ? Math.max(0, Math.floor((end - start) / 1000)) : undefined);

            const tourists = Array.isArray(data.tourists)
              ? data.tourists.map((tourist: any) => ({
                  ...tourist,
                  status: tourist.status || (reviewedKeys.has(`${d.id}_${tourist.uid}`) ? 'Reviewed' : 'Pending'),
                }))
              : [];

            return {
              id: d.id,
              ...data,
              tourists,
              date: data.date || data.startTime || '',
              durationSeconds,
            };
          })
          .filter((doc): doc is any => !!doc)
          .sort((a, b) => {
            const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
            const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
            return bTime - aTime;
          });

        setSessions(docs);
      } catch (err) {
        console.error('[History] failed to load sessions from Firestore', err);
        setSessions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [currentUser?.uid]);

  const formatDateTime = (iso?: string, includeSeconds = false) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDuration = (s: any) => {
    if (typeof s.durationSeconds === 'number') {
      const h   = Math.floor(s.durationSeconds / 3600);
      const m   = Math.floor((s.durationSeconds % 3600) / 60);
      const sec = s.durationSeconds % 60;
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m ${sec}s`;
      return `${sec}s`;
    }
    return `${s.duration?.hours ?? 0}h ${s.duration?.minutes ?? 0}m`;
  };

  const getStatusIcon = (status: string) => {
    if (status === 'Reviewed') return <IonIcon icon={checkmarkCircle} className="status-icon reviewed" />;
    if (status === 'Pending')  return <IonIcon icon={pendingIcon}     className="status-icon pending"  />;
    return null;
  };

  const totalTourists = sessions.reduce((acc: number, s: any) => acc + s.tourists.length, 0);
  const filteredSessions = sessions.filter((session: any) => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return true;
    const searchable = [
      session.id,
      session.tourTypeName,
      session.destinationName,
      session.guideName,
      formatDate(session.date),
      formatDateTime(session.startTime),
      formatDateTime(session.endTime),
      ...session.tourists.map((tourist: any) => tourist.name),
    ].filter(Boolean).join(' ').toLowerCase();
    return searchable.includes(term);
  });

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar className="history-header">
          {/* CHANGED: was a hardcoded routerLink to /tourguide/home.
              Now returns to whatever screen the guide actually came from. */}
          <div onClick={() => history.goBack()} className="back-button">
            <IonIcon icon={arrowBackOutline} />
          </div>
          <IonTitle className="history-title">History</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="history-content">

        {/* ── Summary stats ── */}
        <div className="history-stats">
          <div className="stat-card">
            <div className="stat-value">{sessions.length}</div>
            <div className="stat-label">Total Sessions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{totalTourists}</div>
            <div className="stat-label">Tourists Served</div>
          </div>
        </div>

        <div className="history-list">
          <h3>Tour Sessions</h3>

          <IonSearchbar
            className="session-search"
            value={searchQuery}
            placeholder="Search tour sessions..."
            searchIcon={search}
            debounce={0}
            onIonInput={(event) => setSearchQuery(event.detail.value ?? '')}
          />

          {filteredSessions.length === 0 && (
            <p className="no-sessions">{searchQuery ? 'No matching tour sessions.' : 'No tour sessions yet.'}</p>
          )}

          {filteredSessions.map((session: any) => {
            const hasPendingFeedback = session.tourists.some((tourist: any) => tourist.status !== 'Reviewed');
            return (
              <IonCard
                key={session.id}
                className="history-card"
                onClick={() => { setSelectedSession(session); setShowModal(true); }}
              >
              <IonCardContent>

                {/* Date + Duration */}
                <div className="session-header">
                  <div className="session-date">
                    <IonIcon icon={calendarOutline} />
                    <span>{formatDate(session.date)}</span>
                  </div>
                  <div className="session-duration">
                    <IonIcon icon={timeOutline} />
                    <span>{formatDuration(session)}</span>
                  </div>
                </div>

                {/* Started / Ended */}
                <div className="session-details">
                  <div className="session-time">
                    <span className="time-label">Started:</span>
                    <span className="time-value">{formatDateTime(session.startTime)}</span>
                  </div>
                  <div className="session-time">
                    <span className="time-label">Ended:</span>
                    <span className="time-value">{formatDateTime(session.endTime, true)}</span>
                  </div>
                </div>

                {/* Footer: tourist count + status summary */}
                <div className="session-footer">
                  <div className="tourist-count">
                    <IonIcon icon={peopleOutline} />
                    <span>{session.tourists.length} Tourists</span>
                  </div>
                  <div className="status-summary">
                    <span className="reviewed-count">
                      {session.tourists.filter((t: any) => t.status === 'Reviewed').length} Reviewed
                    </span>
                    <span className="pending-count">
                      {session.tourists.filter((t: any) => t.status === 'Pending').length} Pending
                    </span>
                  </div>
                  <div className="session-actions">
                    {session.status === 'ended' && hasPendingFeedback && (
                      <IonButton fill="clear" onClick={(e) => { e.stopPropagation(); history.push(`/feedback-qr/${session.id}`); }}>
                        Feedback QR
                      </IonButton>
                    )}
                    <IonButton fill="clear" onClick={(e) => { e.stopPropagation(); history.push(`/reviews/${session.id}`); }}>
                      Feedback
                    </IonButton>
                  </div>
                </div>

              </IonCardContent>
            </IonCard>
            );
          })}
        </div>

      </IonContent>

      {/* ── Session Details Modal ── */}
      <IonModal isOpen={showModal} onDidDismiss={() => setShowModal(false)} className="session-modal">
        {selectedSession && (
          <div className="modal-container">

            <div className="modal-header">
              <h2>Session Details</h2>
              <IonButton fill="clear" onClick={() => setShowModal(false)} className="close-button">✕</IonButton>
            </div>

            {/* Tour info card */}
            <TourInfoBlock session={selectedSession} />

            {/* Date / Time row */}
            <div className="modal-datetime-row">
              <div className="modal-dt-item">
                <span className="modal-dt-label">Date</span>
                <span className="modal-dt-value">{formatDate(selectedSession.date)}</span>
              </div>
              <div className="modal-dt-divider" />
              <div className="modal-dt-item">
                <span className="modal-dt-label">Started</span>
                <span className="modal-dt-value">{formatDateTime(selectedSession.startTime)}</span>
              </div>
              <div className="modal-dt-divider" />
              <div className="modal-dt-item">
                <span className="modal-dt-label">Ended</span>
                <span className="modal-dt-value">{formatDateTime(selectedSession.endTime, true)}</span>
              </div>
              <div className="modal-dt-divider" />
              <div className="modal-dt-item">
                <span className="modal-dt-label">Duration</span>
                <span className="modal-dt-value">{formatDuration(selectedSession)}</span>
              </div>
            </div>

            {/* Tourist table */}
            <div className="tourist-table-container">
              <div className="table-header">
                <div className="col-no">No.</div>
                <div className="col-name">Name</div>
                <div className="col-email">Email</div>
                <div className="col-status">Status</div>
              </div>
              <IonList className="tourist-table-list">
                {selectedSession.tourists.map((tourist: any, index: number) => (
                  <IonItem key={tourist.id} className="tourist-table-row" lines="full">
                    <div className="col-no">{index + 1}</div>
                    <div className="col-name">{tourist.name}</div>
                    <div className="col-email">{tourist.email}</div>
                    <div className="col-status">
                      <div className={`status-cell ${tourist.status.toLowerCase()}`}>
                        {getStatusIcon(tourist.status)}
                        <span>{tourist.status}</span>
                      </div>
                    </div>
                  </IonItem>
                ))}
              </IonList>
            </div>

            <div className="modal-footer">  
              {selectedSession.status === 'ended' && selectedSession.tourists.some((tourist: any) => tourist.status !== 'Reviewed') && (
                <IonButton expand="block" className="feedback-modal-btn" onClick={() => { setShowModal(false); history.push(`/feedback-qr/${selectedSession.id}`); }}>
                  Feedback QR
                </IonButton>
              )}
              <IonButton expand="block" className="feedback-modal-btn" onClick={() => { setShowModal(false); history.push(`/reviews/${selectedSession.id}`); }}>
                Feedback
              </IonButton>
              <IonButton expand="block" className="close-modal-btn" onClick={() => setShowModal(false)}>
                Close
              </IonButton>
            </div>

          </div>
        )}
      </IonModal>
    </IonPage>
  );
};

export default History;