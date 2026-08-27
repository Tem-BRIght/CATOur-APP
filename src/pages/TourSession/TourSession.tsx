import React, { useState, useEffect, useRef } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonBackButton,
  IonButtons,
  IonSpinner,
  IonIcon,
  IonButton,
} from '@ionic/react';
import { personOutline, calendarOutline, timeOutline, mapOutline, checkmarkCircle, navigateCircleOutline, briefcaseOutline, locationOutline } from 'ionicons/icons';
import { useAuth } from '../../context/AuthContext';
import { getSession, subscribeSession } from '../../services/sessionService';
import type { TourSession } from '../../services/sessionService';
import { collection, getDocs, documentId, query, where } from 'firebase/firestore';
import { firestore } from '../../firebase';
import { DirectionsRenderer, LoadScript, GoogleMap, MarkerF } from '@react-google-maps/api';
import { useUserLocation } from '../../services/useUserLocation';
import './TourSession.css';

// ─────────────────────────────────────────────────────────────────────────────
// Inlined below (no separate component/util files needed):
//   - resolveCoords()  — pulls { lat, lng } out of a destination doc
//   - TourStop         — shape used by the map
//   - TourStopsMap      — Google Maps map showing one pin per stop + the guide's
//                         live GPS marker (see `guideLocation` prop)
// ─────────────────────────────────────────────────────────────────────────────

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

const TourStopsMap: React.FC<{
  stops: TourStop[];
  guideLocation?: LiveLatLng | null;
  routeOrigin?: LiveLatLng | null;
  routeDestination?: LiveLatLng | null;
  height?: number;
}> = ({ stops, guideLocation, routeOrigin, routeDestination, height = 200 }) => {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
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
    map.fitBounds(bounds, { top: 30, bottom: 30, left: 30, right: 30 });
  };

  const handleMapLoad = (map: google.maps.Map) => {
    mapRef.current = map;
    fitMapToPoints();
  };

  useEffect(() => {
    if (!routeOrigin || !routeDestination || !window.google?.maps) {
      setDirections(null);
      return;
    }

    new google.maps.DirectionsService().route({
      origin: routeOrigin,
      destination: routeDestination,
      travelMode: google.maps.TravelMode.WALKING,
    }, (result, status) => {
      if (status === google.maps.DirectionsStatus.OK && result) setDirections(result);
      else setDirections(null);
    });
  }, [routeOrigin?.lat, routeOrigin?.lng, routeDestination?.lat, routeDestination?.lng]);

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
          {directions && <DirectionsRenderer directions={directions} options={{ suppressMarkers: true }} />}
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

interface RouteParams {
  sessionId: string;
}

const TourSession: React.FC = () => {
  const { sessionId } = useParams<RouteParams>();
  const history = useHistory();
  const { currentUser } = useAuth();
  const { coords: userCoords } = useUserLocation();

  const [session, setSession] = useState<TourSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [tourTypeName, setTourTypeName] = useState<string>('');
  const [tourStops, setTourStops] = useState<TourStop[]>([]);
  const [endingRedirect, setEndingRedirect] = useState(false);

  // ── Subscribe to session ──────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;

    const unsub = subscribeSession(sessionId, (data) => {
      setSession(data);
      setLoading(false);
    });

    return () => unsub();
  }, [sessionId]);

  // ── NEW: live guide location, derived from session.liveLocation ────────
  // TouristList.tsx (guide's screen) writes `liveLocation: { lat, lng,
  // updatedAt }` onto this same session doc every 5 seconds while the tour
  // is active. Since we're already subscribed to the whole session doc
  // above, this just reads that field back out — no separate listener
  // needed. `TourSession` (sessionService.ts) doesn't declare this field on
  // its type yet, so it's read via a loose cast rather than widening the
  // shared interface here.
  const guideLocation: LiveLatLng | null = (() => {
    const live = (session as any)?.liveLocation;
    if (!live || typeof live.lat !== 'number' || typeof live.lng !== 'number') return null;
    return { lat: live.lat, lng: live.lng };
  })();
  const isCheckedIn = !!currentUser && !!session?.checkedInUids?.includes(currentUser.uid);
  const nextStop = tourStops.find((stop) => !(session?.completedStops || []).includes(stop.id));
  const routeOrigin = session?.status === 'active' && isCheckedIn && userCoords
    ? { lat: userCoords.latitude, lng: userCoords.longitude }
    : null;

  // ── Load pinned destinations for this session's tour type ──
  // Real schema (confirmed from the admin's destinations.page.ts):
  //   tourTypes/{id}.destinations   -> string[] of destination IDs
  //   destinations/{id}.title       -> stop name
  //   destinations/{id}.locationCoords -> { lat, lng }
  // NOTE: this still assumes `session.tourTypeId` is present on the
  // TourSession type (GenerateQR.tsx already saves it when the session is
  // created — if the sessionService.ts interface doesn't declare it yet,
  // add `tourTypeId?: string` there).
  useEffect(() => {
    const tourTypeId = (session as any)?.tourTypeId as string | undefined;
    if (!tourTypeId) {
      setTourTypeName('');
      setTourStops([]);
      return;
    }

    let cancelled = false;
    const loadStops = async () => {
      try {
        const typeSnap = await getDocs(
          query(collection(firestore, 'tourTypes'), where(documentId(), 'in', [tourTypeId]))
        );
        if (cancelled) return;

        const typeData = typeSnap.docs[0]?.data() as any;
        setTourTypeName(typeData?.name || '');

        const destIds: string[] = typeData?.destinations || [];
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
        console.error('[TourSession] Failed to load tour stops:', err);
        if (!cancelled) {
          setTourTypeName('');
          setTourStops([]);
        }
      }
    };

    loadStops();
    return () => { cancelled = true; };
  }, [session]);

  // ── Resolve registration from the session record ──────
  useEffect(() => {
    if (!session || !currentUser) return;
    setJoined(Array.isArray(session.touristUids) && session.touristUids.includes(currentUser.uid));
  }, [session, currentUser, sessionId]);

  // ── Auto-redirect to the feedback form once the guide ends the tour ──
  // Previously the only way to reach TourGuideFeedback was scanning a
  // second "feedback QR" (see extractFeedbackSessionId in Scan.tsx). That
  // meant a tourist could finish a tour and never see the feedback form
  // unless the guide handed them another QR code. Since we're already
  // subscribed live to this session (subscribeSession above), we can just
  // watch for status flipping to 'ended' and take them straight there.
  const hasRedirectedRef = React.useRef(false);
  useEffect(() => {
    if (!session || !sessionId) return;
    if (session.status !== 'ended') return;
    if (hasRedirectedRef.current) return;
    // Don't redirect the guide's own view of the session, only tourists.
    if (currentUser && session.guideId && currentUser.uid === session.guideId) return;
    if (!currentUser || !session.checkedInUids?.includes(currentUser.uid)) return;

    hasRedirectedRef.current = true;
    setEndingRedirect(true);

    const timer = setTimeout(() => {
      history.replace(`/feedback/${sessionId}`);
    }, 1500);

    return () => clearTimeout(timer);
  }, [session, sessionId, currentUser, history]);

  // ── Render helpers ──────────────────────────────────────────
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (startTime: string, endTime?: string) => {
    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : Date.now();
    const totalMinutes = Math.max(0, Math.floor((end - start) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  if (loading) {
    return (
      <IonPage>
        <IonContent className="ts-loading">
          <IonSpinner name="crescent" />
        </IonContent>
      </IonPage>
    );
  }

  if (!session) {
    return (
      <IonPage>
        <IonContent className="ts-error">
          <p>Session not found. Please scan a valid QR code.</p>
          <IonButton onClick={() => history.push('/home')}>Go Home</IonButton>
        </IonContent>
      </IonPage>
    );
  }

  const guideProfile = session.guideProfile;
  const guideAddress = [guideProfile?.address, guideProfile?.barangay, guideProfile?.district, guideProfile?.city, guideProfile?.region]
    .filter(Boolean)
    .join(', ');
  const guideBirthdate = guideProfile?.birthdate || guideProfile?.dateOfBirth;

  const statusText = session.status === 'pending'
    ? 'Not started'
    : session.status === 'active'
      ? 'Active'
      : session.status === 'Cancelled'
        ? 'Cancelled'
        : 'Ended';

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar className="ts-header">
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" />
          </IonButtons>
          <IonTitle>Tour Session</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ts-content">
        {/* Session info */}
        <div className="ts-hero">
          <h1>{session.tourTypeName || 'Tour Session'}</h1>
          <p className="ts-destination">{session.destinationName}</p>
          <p className="ts-guide">
            <IonIcon icon={personOutline} /> Tour Guide Profile: {session.guideName}
          </p>
          <div className="ts-guide-details">
            <span><IonIcon icon={briefcaseOutline} /> Age: {guideProfile?.age || 'Not provided'}</span>
            <span><IonIcon icon={calendarOutline} /> Birthday: {guideBirthdate || 'Not provided'}</span>
            <span><IonIcon icon={locationOutline} /> Address: {guideAddress || 'Not provided'}</span>
            <span><IonIcon icon={personOutline} /> Nationality: {guideProfile?.nationality || 'Not provided'}</span>
          </div>
          <div className="ts-datetime">
            <span><IonIcon icon={calendarOutline} /> {formatDate(session.startTime)}</span>
            <span><IonIcon icon={timeOutline} /> {formatTime(session.startTime)}</span>
            <span><IonIcon icon={timeOutline} /> {formatDuration(session.startTime, session.endTime)}</span>
          </div>
        </div>

        {/* Pinned destinations for this tour + guide's live location */}
        {isCheckedIn && (tourStops.length > 0 || guideLocation) && (
          <div className="ts-section">
            <div className="ts-section-title">
              <IonIcon icon={mapOutline} />
              <span>Tour Stops{tourTypeName ? ` — ${tourTypeName}` : ''}</span>
            </div>

            {/* NEW — live indicator, only shown while the guide is actively
                sharing location (session.status === 'active' and a fix has
                come in). */}
            {guideLocation && session.status === 'active' && (
              <p className="ts-live-indicator">
                <IonIcon icon={navigateCircleOutline} />
                <span>Guide's location is live</span>
              </p>
            )}

            <TourStopsMap
              stops={tourStops}
              guideLocation={guideLocation}
              routeOrigin={routeOrigin}
              routeDestination={nextStop ? { lat: nextStop.lat, lng: nextStop.lng } : null}
            />

            {tourStops.length > 0 && (
              <ul className="ts-stops-list">
                {tourStops.map((stop, i) => {
                  const isVisited = (session?.completedStops || []).includes(stop.id);
                  return (
                    <li key={stop.id || `${stop.name}-${i}`} className={isVisited ? 'ts-stop-visited' : ''}>
                      {isVisited && <IonIcon icon={checkmarkCircle} className="ts-stop-check" />}
                      {stop.name}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Status */}
        <div className="ts-status">
          {session.status === 'pending' ? (
            <span className="ts-status-Notstarted">● Not started</span>
          ) : session.status === 'active' ? (
            <span className="ts-status-active">● The session is started</span>
          ) : session.status === 'Cancelled' ? (
            <span className="ts-status-ended">● The session was cancelled</span>
          ) : (
            <span className="ts-status-ended">● The session is ended</span>
          )}
          {session.status === 'Cancelled' && (
            <p style={{ marginTop: '10px', color: '#b91c1c', lineHeight: 1.5 }}>
              <strong>Reason:</strong> {session.cancelReason || 'No reason provided'}
            </p>
          )}
          {!endingRedirect && session.status === 'ended' && (
            <p className="ts-redirect-msg">
              <IonSpinner name="crescent" /> Taking you to the feedback form…
            </p>
          )}
        </div>

      </IonContent>
    </IonPage>
  );
};

export default TourSession;