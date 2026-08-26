// TouristList.tsx (full file with timer fix)
import React, { useState, useEffect, useRef } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import {
  IonContent,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonIcon,
  IonCard,
  IonCardContent,
  IonList,
  IonItem,
  IonSearchbar,
  IonButton,
  IonModal,
  IonAvatar,
  IonImg,
  IonSpinner,
  IonToast,
} from '@ionic/react';
import {
  arrowBackOutline,
  searchOutline,
  mailOutline,
  closeOutline,
  playOutline,
  stopOutline,
  timeOutline,
  peopleOutline,
  checkmarkCircleOutline,
  walkOutline,
  sendOutline,
} from 'ionicons/icons';
import { useAuth } from '../../context/AuthContext';
import { subscribeSession, updateSessionStatus, markStopVisited, unmarkStopVisited } from '../../services/sessionService';
import type { TourSession, Tourist } from '../../services/sessionService';
import { getOrCreateChat, sendMessage, subscribeMessages, ChatMessage } from '../../services/chatService';
import { collection, doc, getDoc, getDocs, documentId, orderBy, query, where, setDoc, serverTimestamp } from 'firebase/firestore';
import { firestore } from '../../firebase';
import './TouristList.css';

// ─────────────────────────────────────────────────────────────────────────────
// Inlined below (no separate component/util files needed):
//   - resolveCoords()  — pulls { lat, lng } out of a destination doc
//   - TourStop         — shape used by the map
//   - TourStopsMap      — Google Maps map showing one pin per stop
// ─────────────────────────────────────────────────────────────────────────────
import { LoadScript, GoogleMap, MarkerF } from '@react-google-maps/api';

const resolveCoords = (dest: any): { lat: number; lng: number } | null => {
  const lat =
    dest?.locationCoords?.lat ??
    dest?.location?.lat ??
    dest?.location?.latitude ??
    dest?.lat ??
    null;
  const lng =
    dest?.locationCoords?.lng ??
    dest?.location?.lng ??
    dest?.location?.longitude ??
    dest?.lng ??
    null;
  if (lat == null || lng == null) return null;
  return { lat: Number(lat), lng: Number(lng) };
};

interface TourStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface LiveLatLng {
  lat: number;
  lng: number;
}

const TourStopsMap: React.FC<{ stops: TourStop[]; guideLocation?: LiveLatLng | null; height?: number }> = ({ stops, guideLocation, height = 200 }) => {
  const mapRef = useRef<google.maps.Map | null>(null);
  const points = [
    ...stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    ...(guideLocation ? [guideLocation] : []),
  ].filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  if (points.length === 0) return null;

  const center = points[0];
  const fitMapToPoints = () => {
    const map = mapRef.current;
    if (!map) return;

    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(14);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 });
  };

  const handleMapLoad = (map: google.maps.Map) => {
    mapRef.current = map;
    fitMapToPoints();
  };

  useEffect(() => {
    fitMapToPoints();
  }, [points.map((point) => `${point.lat.toFixed(5)}:${point.lng.toFixed(5)}`).join('|')]);

  return (
    <div className="tsm-map-wrap" style={{ height }}>
      <LoadScript googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          key={points.map((point) => `${point.lat.toFixed(5)}:${point.lng.toFixed(5)}`).join('|')}
          mapContainerStyle={{ height: '100%', width: '100%' }}
          center={center}
          zoom={14}
          options={{
            disableDefaultUI: true,
            zoomControl: true,
            streetViewControl: false,
            fullscreenControl: false,
          }}
          onLoad={handleMapLoad}
        >
          {stops.map((stop, i) => (
            <MarkerF
              key={stop.id || `${stop.name}-${i}`}
              position={{ lat: stop.lat, lng: stop.lng }}
              label={{ text: String(i + 1), color: '#ffffff', fontWeight: '700' }}
              title={stop.name}
            />
          ))}
          {guideLocation && (
            <MarkerF
              position={guideLocation}
              icon={{
                path: 0,
                scale: 8,
                fillColor: '#0d2f6e',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 3,
              }}
              title="Guide location"
            />
          )}
        </GoogleMap>
      </LoadScript>
    </div>
  );
};

const TouristList: React.FC = () => {
  const history = useHistory();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { currentUser } = useAuth();
  const [searchText, setSearchText] = useState('');
  const [selectedTourist, setSelectedTourist] = useState<Tourist | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const chatUnsubRef = useRef<(() => void) | null>(null);

  const [session, setSession] = useState<TourSession | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [sessionActive, setSessionActive] = useState(false);
  const [isCompletedSession, setIsCompletedSession] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [finalDuration, setFinalDuration] = useState(0);
  const isEndedSession = session?.status === 'ended';
  const [toastMsg, setToastMsg] = useState('');
  const [tourTypeNames, setTourTypeNames] = useState<string[]>([]);
  const [tourStops, setTourStops] = useState<TourStop[]>([]);
  const [togglingStop, setTogglingStop] = useState<string | null>(null);
  const [reviewedTouristIds, setReviewedTouristIds] = useState<Set<string>>(new Set());

  // ── Timer fix: state for current time, compute elapsed from startTime ──
  const [currentTime, setCurrentTime] = useState(Date.now());

  // ── NEW: live location sharing refs ─────────────────────────────────────
  // watchIdRef tracks the geolocation.watchPosition subscription so it can be
  // cleared on cleanup. liveCoordsRef always holds the MOST RECENT fix from
  // the watch — we don't write to Firestore on every GPS tick (that could be
  // several times a second), instead a 5s interval reads whatever's in this
  // ref and writes it once. liveIntervalRef is that interval's handle.
  const watchIdRef = useRef<number | null>(null);
  const liveCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Subscribe to session if sessionId is provided ──────────
  useEffect(() => {
    if (sessionId) {
      setLoading(true);
      const unsub = subscribeSession(sessionId, (data) => {
        setSession(data);
        const currentStatus = data?.status ?? 'pending';
        const isEndedLike = currentStatus === 'ended' || currentStatus === 'Cancelled';
        setSessionActive(currentStatus === 'active');
        setIsCompletedSession(isEndedLike);
        setLoading(false);
      });
      return () => unsub();
    }

    // ── Fallback: load the latest session for the guide ──────
    if (!currentUser?.uid) {
      setSession(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const loadLatestGuideSession = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(firestore, 'sessions'),
          where('guideId', '==', currentUser.uid),
          where('status', 'in', ['active', 'pending']),
          orderBy('createdAt', 'desc')
        );
        const snap = await getDocs(q);
        if (cancelled) return;

        const latestDoc = snap.docs[0];
        if (!latestDoc) {
          setSession(null);
          setSessionActive(false);
          setLoading(false);
          return;
        }

        const latest = { id: latestDoc.id, ...latestDoc.data() } as TourSession;
        setSession(latest);
        const isEndedLike = latest.status === 'ended' || latest.status === 'Cancelled';
        setSessionActive(latest.status === 'active');
        setIsCompletedSession(isEndedLike);
      } catch (error) {
        console.error('Failed to load guide session:', error);
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadLatestGuideSession();
    return () => { cancelled = true; };
  }, [sessionId, currentUser?.uid]);

  // ── Resolve Type(s) of Tour assigned to this guide ──────────
  useEffect(() => {
    const guideId = session?.guideId;
    if (!guideId) {
      setTourTypeNames([]);
      return;
    }

    let cancelled = false;
    const loadTourTypes = async () => {
      try {
        const guideSnap = await getDoc(doc(firestore, 'tourGuides', guideId));
        if (cancelled) return;
        if (!guideSnap.exists()) { setTourTypeNames([]); return; }

        const tourTypeIds: string[] = (guideSnap.data() as any)?.tourTypeIds || [];
        if (tourTypeIds.length === 0) { setTourTypeNames([]); return; }

        const typesSnap = await getDocs(
          query(collection(firestore, 'tourTypes'), where(documentId(), 'in', tourTypeIds.slice(0, 30)))
        );
        if (cancelled) return;

        const names = typesSnap.docs.map(d => (d.data() as any)?.name).filter(Boolean);
        setTourTypeNames(names);

        // Real schema: tourTypes/{id}.destinations is an array of destination
        // IDs — the actual stop name/coords live on the destinations docs.
        const destIds = Array.from(
          new Set(typesSnap.docs.flatMap((d) => (d.data() as any)?.destinations || []))
        ) as string[];

        if (destIds.length === 0) {
          setTourStops([]);
          return;
        }

        const destsSnap = await getDocs(
          query(collection(firestore, 'destinations'), where(documentId(), 'in', destIds.slice(0, 30)))
        );
        if (cancelled) return;

        const destinationById = new Map(destsSnap.docs.map((d) => [d.id, d]));
        const stops: TourStop[] = destIds
          .map((destinationId) => destinationById.get(destinationId))
          .map((d) => {
            if (!d) return null;
            const data = d.data() as any;
            const coords = resolveCoords(data);
            if (!coords) return null;
            return { id: d.id, name: data.title || data.name || 'Untitled', lat: coords.lat, lng: coords.lng };
          })
          .filter((s): s is TourStop => s !== null);
        setTourStops(stops);
      } catch (err) {
        console.error('[TouristList] Failed to resolve tour types for guide:', err);
        if (!cancelled) {
          setTourTypeNames([]);
          setTourStops([]);
        }
      }
    };

    loadTourTypes();
    return () => { cancelled = true; };
  }, [session?.guideId]);

  useEffect(() => {
    if (!session || session.status !== 'ended') {
      setReviewedTouristIds(new Set());
      return;
    }

    let cancelled = false;
    getDocs(query(collection(firestore, 'feedback'), where('sessionId', '==', session.id)))
      .then((snapshot) => {
        if (!cancelled) {
          setReviewedTouristIds(new Set(snapshot.docs.map((feedbackDoc) => String(feedbackDoc.data()['touristId'] || ''))));
        }
      })
      .catch((error) => console.error('Failed to load feedback status:', error));

    return () => { cancelled = true; };
  }, [session?.id, session?.status]);

  // ── Timer: update currentTime every second only when active ──
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (sessionActive && session?.startTime) {
      interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [sessionActive, session?.startTime]);

  // ── NEW: live location sharing ──────────────────────────────────────────
  // While the session is active, watch the guide's GPS continuously (so we
  // always have a fresh fix ready), but only WRITE to Firestore once every
  // 5 seconds — writing on every watchPosition tick would be excessive and
  // costly. The write goes onto the session doc itself as a `liveLocation`
  // field so TourSession.tsx (which already subscribes to the whole
  // session doc) picks it up automatically with no extra listener needed.
  useEffect(() => {
    if (!sessionActive || !session?.id) {
      if (watchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
      liveCoordsRef.current = null;
      return;
    }

    if (!navigator.geolocation) {
      console.warn('[TouristList] Geolocation not supported — live location sharing disabled.');
      return;
    }

    const activeSessionId = session.id;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        liveCoordsRef.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
      },
      (err) => {
        console.warn('[TouristList] Live location watch error:', err.message);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    watchIdRef.current = watchId;

    const intervalId = setInterval(() => {
      const coords = liveCoordsRef.current;
      if (!coords) return;
      setDoc(
        doc(firestore, 'sessions', activeSessionId),
        {
          liveLocation: {
            lat: coords.lat,
            lng: coords.lng,
            updatedAt: serverTimestamp(),
          },
        },
        { merge: true }
      ).catch((err) => {
        console.warn('[TouristList] Failed to write live location:', err);
      });
    }, 5000);
    liveIntervalRef.current = intervalId;

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
      liveCoordsRef.current = null;
    };
  }, [sessionActive, session?.id]);

  // ── Compute elapsed seconds from session.startTime (use currentTime and clamp >= 0)
  const elapsed = (session?.startTime && sessionActive)
    ? Math.max(0, Math.floor((currentTime - new Date(session.startTime).getTime()) / 1000))
    : 0;

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '—';
    const date = new Date(iso);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const handleStart = async () => {
    if (!session) {
      setToastMsg('No session found. Generate a QR code first.');
      return;
    }

    if (isCompletedSession) {
      setToastMsg('This session has already ended and can only be viewed in history.');
      return;
    }

    try {
      await updateSessionStatus(session.id, 'active');
      // No need to reset elapsed; it will auto-compute from startTime
      setSessionActive(true);
      setIsCompletedSession(false);
    } catch (err) {
      console.error('Failed to start session:', err);
      setToastMsg('Could not start session.');
    }
  };

  const handleEnd = async () => {
    if (!session) return;
    try {
      await updateSessionStatus(session.id, 'ended');
      setSessionActive(false);
      setFinalDuration(elapsed); // elapsed is already correct
      setShowSummary(true);
    } catch (err) {
      console.error('Failed to end session:', err);
      setToastMsg('Could not end session.');
    }
  };

  // Guide taps this per-stop to flag a destination as visited/done — it's
  // written to the session doc and shows up live on the tourist's own
  // TourSession view via subscribeSession.
  const handleToggleStopVisited = async (stopId: string, isVisited: boolean) => {
    if (!session) return;
    setTogglingStop(stopId);
    try {
      if (isVisited) {
        await unmarkStopVisited(session.id, stopId);
      } else {
        await markStopVisited(session.id, stopId);
      }
    } catch (err) {
      console.error('Failed to update stop status:', err);
      setToastMsg('Could not update stop status.');
    } finally {
      setTogglingStop(null);
    }
  };

  const handleSendChatMessage = async () => {
    if (!chatId || !currentUser || !chatText.trim() || sendingChat) return;
    setSendingChat(true);
    try {
      await sendMessage({
        chatId,
        senderId: currentUser.uid,
        senderName: `${(session?.guideName || 'Guide')}`,
        text: chatText,
      });
      setChatText('');
    } catch (err) {
      console.error('Failed to send message:', err);
      setToastMsg('Could not send message. Please try again.');
    } finally {
      setSendingChat(false);
    }
  };

  useEffect(() => {
    if (!showModal) {
      chatUnsubRef.current?.();
      chatUnsubRef.current = null;
    }
  }, [showModal]);

  useEffect(() => () => {
    chatUnsubRef.current?.();
  }, []);

  const tourists = session?.tourists ?? [];
  const filteredTourists = tourists.filter((tourist) =>
    tourist.name.toLowerCase().includes(searchText.toLowerCase()) ||
    tourist.email.toLowerCase().includes(searchText.toLowerCase())
  );

  const handleTouristClick = (tourist: Tourist) => {
    setSelectedTourist(tourist);
    setShowModal(true);

    chatUnsubRef.current?.();
    setChatMessages([]);
    setChatText('');
    setChatId(null);

    if (session && currentUser) {
      (async () => {
        const id = await getOrCreateChat({
          sessionId: session.id,
          guideId: currentUser.uid,
          guideName: session.guideName || 'Tour Guide',
          touristId: tourist.uid,
          touristName: tourist.name,
        });
        setChatId(id);
        chatUnsubRef.current = subscribeMessages(id, setChatMessages);
      })();
    }
  };

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar className="list-page-header">
          {/* CHANGED: was a hardcoded routerLink to /tourguide/generateQR.
              Now goes back to whichever screen the guide actually came
              from (Home, GenerateQR, History, etc.) using real nav history. */}
          <div onClick={() => history.goBack()} className="back-button">
            <IonIcon icon={arrowBackOutline} />
          </div>
          <IonTitle className="list-page-title">Tourist List</IonTitle>
          <div className="header-placeholder"></div>
        </IonToolbar>
      </IonHeader>

      <IonContent className="list-page-content">

        {/* ── BEFORE START: search bar first, stats card shows tourists + type of tour ── */}
        {!sessionActive && (
          <>
            <div className="search-container">
              <IonSearchbar
                value={searchText}
                onIonInput={(e) => setSearchText(e.detail.value!)}
                placeholder="Search by name or email"
                className="custom-searchbar"
                animated
              />
            </div>

            <div className="stats-card">
              <div className="stat-item">
                <div className="stat-number">{tourists.length}</div>
                <div className="stat-label">Total Tourists</div>
              </div>
              {session && (
                <>
                  <div className="stat-divider" />
                  <div className="stat-item stat-item--wide">
                    <div className="stat-number stat-number--small">
                      {session.tourTypeName || session.destinationName || 'Not set'}
                    </div>
                    <div className="stat-label">Tour Type</div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ── AFTER START: simplified stats card, then the pinned-destinations map ── */}
        {sessionActive && (
          <>
            <div className="stats-card stats-card--single">
              <div className="stat-item">
                <div className="stat-number">{tourists.length}</div>
                <div className="stat-label">Total Tourists</div>
              </div>
            </div>

            {tourStops.length > 0 && (
              <div className="stops-card">
                <TourStopsMap stops={tourStops} />
                <div className="stops-heading">
                  Tour Type: <span>{session?.tourTypeName || tourTypeNames.join(', ')}</span>
                </div>
                <ul className="stops-list stops-list--interactive">
                  {tourStops.map((stop, i) => {
                    const isVisited = (session?.completedStops || []).includes(stop.id);
                    return (
                      <li key={stop.id || `${stop.name}-${i}`} className="stop-row">
                        <span className={`stop-row-name ${isVisited ? 'stop-row-name--done' : ''}`}>
                          {stop.name}
                        </span>
                        <button
                          className={`stop-visit-btn ${isVisited ? 'stop-visit-btn--done' : ''}`}
                          onClick={() => handleToggleStopVisited(stop.id, isVisited)}
                          disabled={togglingStop === stop.id}
                        >
                          <IonIcon icon={checkmarkCircleOutline} />
                          {isVisited ? 'Visited' : 'Mark as visited'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="search-container">
              <IonSearchbar
                value={searchText}
                onIonInput={(e) => setSearchText(e.detail.value!)}
                placeholder="Search by name or email"
                className="custom-searchbar"
                animated
              />
            </div>
          </>
        )}

        <IonCard className="tourist-page-card">
          <IonCardContent>
            <div className={`tourist-table-header ${isEndedSession ? 'tourist-table-header--completed' : ''}`}>
              <div className="header-col-id">#</div>
              <div className="header-col-name">Name</div>
              <div className="header-col-gender">Gender</div>
              <div className="header-col-nationality">Nationality</div>
              <div className="header-col-religion">Religion</div>
              <div className="header-col-email">Email</div>
              {isEndedSession && <div className="header-col-feedback">Feedback</div>}
            </div>

            {loading ? (
              <div className="no-results">
                <IonSpinner name="crescent" />
                <p>Loading tour session…</p>
              </div>
            ) : (
              <IonList className="tourist-page-list">
                {filteredTourists.length > 0 ? (
                  filteredTourists.map((tourist, index) => (
                    <IonItem
                      key={`${tourist.uid}-${index}`}
                      className={`tourist-page-row ${isEndedSession ? 'tourist-page-row--completed' : ''}`}
                      lines="full"
                      button
                      onClick={() => handleTouristClick(tourist)}
                    >
                      <div className="row-col-id">{index + 1}</div>
                      <div className="row-col-name">
                        <IonAvatar className="tourist-avatar">
                          <IonImg src="https://ionicframework.com/docs/img/demos/avatar.svg" />
                        </IonAvatar>
                        <span className="tourist-name">
                          {tourist.name}
                          {currentUser?.uid === tourist.uid && ' (You)'}
                        </span>
                      </div>
                      <div className="row-col-gender">{tourist.gender || '—'}</div>
                      <div className="row-col-nationality">{tourist.nationality || '—'}</div>
                      <div className="row-col-religion">{tourist.religion || '—'}</div>
                      <div className="row-col-email">{tourist.email}</div>
                      {isEndedSession && (
                        <div className={`row-col-feedback ${reviewedTouristIds.has(tourist.uid) ? 'feedback-reviewed' : 'feedback-pending'}`}>
                          {reviewedTouristIds.has(tourist.uid) ? (
                            <IonButton
                              fill="clear"
                              size="small"
                              onClick={(event) => {
                                event.stopPropagation();
                                history.push(`/reviews/${session.id}?touristId=${encodeURIComponent(tourist.uid)}`);
                              }}
                            >
                              View Feedback
                            </IonButton>
                          ) : 'Pending'}
                        </div>
                      )}
                    </IonItem>
                  ))
                ) : (
                  <div className="no-results">
                    <IonIcon icon={searchOutline} />
                    <p>{sessionId ? 'No tourists have joined this tour yet.' : 'Generate a QR code first to track tourists.'}</p>
                  </div>
                )}
              </IonList>
            )}
          </IonCardContent>
        </IonCard>

        {/* Session FAB */}
        <div className="session-fab-wrap">
          {sessionActive && (
            <div className="session-timer-pill">
              <IonIcon icon={timeOutline} />
              <span>{formatTime(elapsed)}</span>
            </div>
          )}

          <button
            className={`session-fab ${sessionActive ? 'session-fab--end' : 'session-fab--start'}`}
            onClick={sessionActive ? handleEnd : handleStart}
            disabled={!session || loading || isCompletedSession}
          >
            <IonIcon icon={sessionActive ? stopOutline : playOutline} />
            <span>{isCompletedSession ? 'Completed' : sessionActive ? 'End' : 'Start'}</span>
          </button>
        </div>
      </IonContent>

      {/* Tourist Details Modal */}
      <IonModal
        isOpen={showModal}
        onDidDismiss={() => setShowModal(false)}
        className="tourist-detail-modal"
        breakpoints={[0, 0.4]}
        initialBreakpoint={0.4}
      >
        {selectedTourist && (
          <div className="detail-modal-content">
            <div className="detail-modal-header">
              <IonButton fill="clear" onClick={() => setShowModal(false)} className="detail-close-btn">
                <IonIcon icon={closeOutline} />
              </IonButton>
            </div>

            <div className="detail-avatar-container">
              <IonAvatar className="detail-avatar">
                <IonImg src="https://ionicframework.com/docs/img/demos/avatar.svg" />
              </IonAvatar>
              <h2>{selectedTourist.name}</h2>
            </div>

            <div className="detail-info">
              <div className="detail-info-item">
                <IonIcon icon={mailOutline} />
                <div className="detail-info-text">
                  <span className="detail-label">Email</span>
                  <span className="detail-value">{selectedTourist.email}</span>
                </div>
              </div>
              <div className="detail-info-item">
                <IonIcon icon={timeOutline} />
                <div className="detail-info-text">
                  <span className="detail-label">Joined</span>
                  <span className="detail-value">{selectedTourist.joinedAt ? formatDate(selectedTourist.joinedAt) : '—'}</span>
                </div>
              </div>
              <div className="detail-info-item">
                <IonIcon icon={walkOutline} />
                <div className="detail-info-text">
                  <span className="detail-label">Gender</span>
                  <span className="detail-value">{selectedTourist.gender || '—'}</span>
                </div>
              </div>
              <div className="detail-info-item">
                <IonIcon icon={walkOutline} />
                <div className="detail-info-text">
                  <span className="detail-label">Nationality</span>
                  <span className="detail-value">{selectedTourist.nationality || '—'}</span>
                </div>
              </div>
              <div className="detail-info-item">
                <IonIcon icon={walkOutline} />
                <div className="detail-info-text">
                  <span className="detail-label">Religion</span>
                  <span className="detail-value">{selectedTourist.religion || '—'}</span>
                </div>
              </div>
              <div className="detail-info-item">
                <IonIcon icon={walkOutline} />
                <div className="detail-info-text">
                  <span className="detail-label">Tour Type</span>
                  <span className="detail-value">
                    {session?.tourTypeName || (tourTypeNames.length > 0 ? tourTypeNames.join(', ') : 'Tour Type not set')}
                  </span>
                </div>
              </div>
            </div>

            <div className="detail-chat-section">
              <h3 className="detail-chat-title">Messages</h3>

              <div className="detail-chat-messages">
                {chatMessages.length === 0 ? (
                  <p className="detail-chat-empty">No messages yet. Say hello!</p>
                ) : (
                  chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`detail-chat-bubble ${msg.senderId === currentUser?.uid ? 'detail-chat-bubble--mine' : ''}`}
                    >
                      <span className="detail-chat-bubble-text">{msg.text}</span>
                      <span className="detail-chat-bubble-time">
                        {new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="detail-chat-input-row">
                <input
                  name="chat-message"
                  className="detail-chat-input"
                  placeholder={`Message ${selectedTourist?.name || 'tourist'}…`}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendChatMessage()}
                  maxLength={500}
                />
                <button
                  className="detail-chat-send-btn"
                  onClick={handleSendChatMessage}
                  disabled={!chatText.trim() || sendingChat || !chatId}
                  aria-label="Send message"
                >
                  <IonIcon icon={sendOutline} />
                </button>
              </div>
            </div>
          </div>
        )}
      </IonModal>

      {/* Session Summary Modal */}
      <IonModal
        isOpen={showSummary}
        onDidDismiss={() => setShowSummary(false)}
        className="summary-modal"
        breakpoints={[0, 0.55]}
        initialBreakpoint={0.55}
      >
        <div className="summary-content">
          <div className="summary-icon">
            <IonIcon icon={checkmarkCircleOutline} />
          </div>

          <h2>Session Ended</h2>
          <p>Here's a summary of your completed tour session.</p>

          <div className="summary-stats">
            <div className="summary-stat">
              <div className="summary-stat-icon">
                <IonIcon icon={timeOutline} />
              </div>
              <span className="summary-stat-value">{formatTime(finalDuration)}</span>
              <span className="summary-stat-label">Duration</span>
            </div>

            <div className="summary-stat-divider" />

            <div className="summary-stat">
              <div className="summary-stat-icon">
                <IonIcon icon={peopleOutline} />
              </div>
              <span className="summary-stat-value">{tourists.length}</span>
              <span className="summary-stat-label">Tourists</span>
            </div>
          </div>

          <IonButton
            expand="block"
            className="summary-close-btn"
            onClick={() => {
              setShowSummary(false);
              if (session) {
                // CHANGED: App.tsx registers this route as
                // "/feedback-qr/:sessionId" (hyphen, no "/tourguide/" prefix).
                // The old path "/tourguide/feedbackqr/..." matched no <Route>,
                // so react-router fell through to the catch-all
                // <Redirect to="/login" /> at the bottom of App.tsx — that's
                // the "nabalik sa simula" bug.
                history.push(`/feedback-qr/${session.id}`);
              } else {
                history.push('/tourguide/history');
              }
            }}
          >
            Open Feedback QR
          </IonButton>
        </div>
      </IonModal>

      <IonToast
        isOpen={!!toastMsg}
        message={toastMsg}
        duration={3000}
        position="bottom"
        onDidDismiss={() => setToastMsg('')}
      />
    </IonPage>
  );
};

export default TouristList;