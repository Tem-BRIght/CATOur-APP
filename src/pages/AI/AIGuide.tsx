import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonIcon,
  IonModal,
  IonList,
  IonItem,
  IonLabel,
  IonToggle,
  IonSelect,
  IonSelectOption,
  IonButtons,
  IonBackButton,
  IonToast,
  IonButton
} from '@ionic/react';
import {
  mic, micOff, send, settingsOutline, search,
  location, star, close, volumeHighOutline,
  pauseCircleOutline, chatbubblesOutline,
  expandOutline, contractOutline,
  timeOutline, cashOutline, navigateOutline,
  informationCircleOutline
} from 'ionicons/icons';
import { useHistory, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { fetchDestinationById, fetchDestinations } from '../../services/destinationService';
import { Destination } from '../../types';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
// NOTE: this file is named aiService.ts in our project — the header comment
// inside it says "aiGuideService.ts" (leftover from an earlier draft), but
// the import path below matches the REAL filename on disk. If you ever
// rename the file, update this import to match.
import { askAIGuide, recordSearchTerm, recordDestinationView, ChatTurn } from '../../services/aiService';
import { speak as speakTts, stop as stopTts, pause as pauseTts, resume as resumeTts, subscribeTts } from '../../services/ttsService';
import { getProfilePicCache } from '../../utils/profileImageStorage';
import { safeVibrate } from '../../utils/vibration';
import { DirectionsRenderer, GoogleMap, LoadScript, MarkerF } from '@react-google-maps/api';
<<<<<<< HEAD
import { Capacitor } from '@capacitor/core';
=======
>>>>>>> origin/main
import './AIGuide.css';

// ─── Types ────────────────────────────────────────────────────────────────────

type PlaceCategory =
  | 'historical' | 'park' | 'religious' | 'entertainment'
  | 'museum' | 'church' | 'restaurant' | 'mall'
  | 'cultural' | 'nature' | 'family' | 'sports' | 'beach'
  | 'adventure' | 'art' | 'other';


interface ChatMessage {
  text: string;
  sender: 'ai' | 'user';
  timestamp: Date;
  places?: PlaceSuggestion[];
  /** NEW — set when this reply answered a directions question with a real
   *  computed route; lets the bubble show a "View route on map" button. */
  showRouteToId?: string;
}

function getDisplayReply(value: unknown): string {
  let current: unknown = value;

  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      const reply = (current as { reply?: unknown }).reply;
      if (typeof reply === 'string') current = reply;
      else break;
    }

    if (typeof current !== 'string') break;
    const text = current.trim();
    if (!text.startsWith('{')) return text;

    try {
      current = JSON.parse(text);
    } catch {
      return text;
    }
  }

  if (typeof current === 'object' && current !== null) {
    const reply = (current as { reply?: unknown }).reply;
    if (typeof reply === 'string') return reply.trim();
  }

  return typeof current === 'string' ? current.trim() : '';
}

interface PlaceSuggestion {
  id: string;
  title: string;
  image: string;
  rating: number;
  reviews: number;
  distance: string;
  address: string;
  type: string;
  category: PlaceCategory;
  tags: string[];
  lat: number | null;
  lng: number | null;
}

/** Rich shape IntegratedRouteMap supports — includes metadata for the navigation destination card. */
export interface RouteMapDestination {
  id: string;
  title?: string;
  name?: string;
  image?: string;
  imageUrl?: string;
  images?: string[];
  address?: string;
  hours?: string;
  openingHours?: string;
  admission?: string;
  price?: string;
  category?: string;
  rating?: number;
  reviews?: number;
  description?: string;
  desc?: string;
  lat?: number | null;
  lng?: number | null;
  location?: { lat?: number | null; lng?: number | null } | string | null;
  locationCoords?: { lat?: number | null; lng?: number | null } | null;
}

export const destinationCoords = (destination: RouteMapDestination): { lat: number; lng: number } | null => {
  const value = destination as any;
  const lat = value.locationCoords?.lat ?? value.location?.lat ?? value.location?.latitude ?? value.lat;
  const lng = value.locationCoords?.lng ?? value.location?.lng ?? value.location?.longitude ?? value.lng;
  return lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null;
};

export const getCurrentGuideLocation = (): Promise<{ lat: number; lng: number } | null> => {
  if (!navigator.geolocation) return Promise.resolve(null);

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      error => {
        console.warn('[AIGuide] Location unavailable for this request:', error.message);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 300_000 },
    );
  });
};

export const IntegratedRouteMap: React.FC<{
  destination: RouteMapDestination;
  origin: { lat: number; lng: number } | null;
  onClose?: () => void;
}> = ({ destination, origin, onClose }) => {
  const history = useHistory();
  const coords = destinationCoords(destination);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [travelMode, setTravelMode] = useState<'walking' | 'driving'>('walking');
  const [showDetails, setShowDetails] = useState(true);

  const destData = destination as any;
  const title = destData.title || destData.name || 'Destination';
  const image = destData.image || destData.imageUrl || (Array.isArray(destData.images) ? destData.images[0] : null) || '/assets/images/placeholder.jpg';
  const address = destData.address || (typeof destData.location === 'string' ? destData.location : '');
  const hours = destData.hours || destData.openingHours || '';
  const admission = destData.admission || destData.price || '';
  const rating = destData.rating != null ? Number(destData.rating) : null;
  const reviews = destData.reviews != null ? Number(destData.reviews) : null;
  const category = destData.category || '';

  const leg = directions?.routes[0]?.legs[0];
  const durationText = leg?.duration?.text;
  const distanceText = leg?.distance?.text;

  const center = coords ?? origin ?? { lat: 14.5764, lng: 121.0851 };

  const fitMapToRoute = useCallback((result: google.maps.DirectionsResult) => {
    const bounds = new google.maps.LatLngBounds();
    result.routes[0]?.overview_path.forEach(point => bounds.extend(point));
    mapRef.current?.fitBounds(bounds, { top: 50, right: 40, bottom: showDetails ? 160 : 60, left: 40 });
  }, [showDetails]);

  useEffect(() => {
    if (!mapsReady || !coords || !origin) return;

    const directionsService = new google.maps.DirectionsService();
    directionsService.route({
      origin,
      destination: coords,
      travelMode: travelMode === 'walking'
        ? google.maps.TravelMode.WALKING
        : google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      if (status === google.maps.DirectionsStatus.OK && result) {
        setDirections(result);
        fitMapToRoute(result);
      }
    });
  }, [coords?.lat, coords?.lng, fitMapToRoute, mapsReady, origin?.lat, origin?.lng, travelMode]);

  const openGoogleMaps = () => {
    if (!coords) return;
    const modeParam = travelMode === 'walking' ? 'walking' : 'driving';
    const url = `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}&travelmode=${modeParam}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openDestinationPage = () => {
    if (!destination.id) return;
    if (onClose) onClose();
    history.push(`/destination/${destination.id}`, destination);
  };

  return (
    <div className="ai-route-map-content">
      {/* Top Header bar with mode switch + ETA */}
      <div className="ai-route-top-bar">
        <div className="ai-route-mode-switch" role="group" aria-label="Travel mode">
          <button
            className={travelMode === 'walking' ? 'active' : ''}
            onClick={() => setTravelMode('walking')}
            aria-pressed={travelMode === 'walking'}
          >
            🚶 Walk
          </button>
          <button
            className={travelMode === 'driving' ? 'active' : ''}
            onClick={() => setTravelMode('driving')}
            aria-pressed={travelMode === 'driving'}
          >
            🚗 Drive
          </button>
        </div>

        {durationText && (
          <div className="ai-route-eta-badge">
            <span className="ai-route-eta-time">{durationText}</span>
            <span className="ai-route-eta-dist">({distanceText})</span>
          </div>
        )}
      </div>

      <LoadScript googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
        <GoogleMap
          mapContainerClassName="ai-route-map-frame"
          center={center}
          zoom={15}
          onLoad={map => { mapRef.current = map; setMapsReady(true); }}
          options={{
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: 'greedy',
            clickableIcons: true,
            styles: [
              {
                featureType: 'poi',
                stylers: [{ visibility: 'off' }],
              },
            ],
          }}
        >
          {origin && <MarkerF position={origin} label="You" />}
          {coords && <MarkerF position={coords} label="Destination" />}
          {directions && (
            <DirectionsRenderer
              directions={directions}
              options={{ suppressMarkers: true, polylineOptions: { strokeColor: '#1555ad', strokeWeight: 5 } }}
            />
          )}
        </GoogleMap>
      </LoadScript>

      {/* Destination Info Card at bottom of AI Navigation */}
      <div className={`ai-route-dest-card${showDetails ? '' : ' collapsed'}`}>
        <button
          className="ai-route-card-toggle"
          onClick={() => setShowDetails(prev => !prev)}
          aria-label={showDetails ? 'Collapse destination card' : 'Expand destination card'}
        >
          <span className="ai-route-card-handle" />
        </button>

        <div className="ai-route-card-header" onClick={openDestinationPage} role="button" tabIndex={0}>
          <img
            src={image}
            alt={title}
            className="ai-route-card-img"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/assets/images/placeholder.jpg'; }}
          />
          <div className="ai-route-card-meta">
            <div className="ai-route-card-title-row">
              <h4 className="ai-route-card-title">{title}</h4>
              {category && <span className="ai-route-card-cat">{category}</span>}
            </div>
            {address && (
              <p className="ai-route-card-addr">
                <IonIcon icon={location} /> {address}
              </p>
            )}
            <div className="ai-route-card-tags">
              {hours && (
                <span className="ai-route-card-tag">
                  <IonIcon icon={timeOutline} /> {hours}
                </span>
              )}
              {admission && (
                <span className="ai-route-card-tag fee">
                  <IonIcon icon={cashOutline} /> {admission}
                </span>
              )}
              {rating != null && rating > 0 && (
                <span className="ai-route-card-tag rating">
                  <IonIcon icon={star} /> {rating.toFixed(1)} {reviews ? `(${reviews})` : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {showDetails && (
          <div className="ai-route-card-actions">
            <button className="ai-route-btn primary" onClick={openDestinationPage}>
              <IonIcon icon={informationCircleOutline} />
              <span>View Details</span>
            </button>
            <button className="ai-route-btn secondary" onClick={openGoogleMaps}>
              <IonIcon icon={navigateOutline} />
              <span>Turn-by-Turn GPS</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Constants ────────────────────────────────────────────────────────────────

const WELCOME_MESSAGE = "Mabuhay! I'm ALI, your official AI Tour Guide for Pasig City.\nWhere are you exploring today, or what would you like to discover?";

const SUGGESTED_QUESTIONS = [
  'What are the top 5 must-see places in Pasig?',
  'Recommend historical landmarks & heritage churches',
  'Where are the best local food and dining spots?',
  'Find family-friendly parks and nature areas',
  'What are the entrance fees and opening hours for key attractions?',
  'What are some practical safety tips and etiquette for visiting?'
];

const QUICK_TOPIC_CHIPS = [
  { label: 'Top 5 Places', prompt: 'What are the top 5 must-see attractions in Pasig City?' },
  { label: 'Food & Cafes', prompt: 'What are the best food spots, cafes, and restaurants in Pasig?' },
  { label: 'Heritage & Churches', prompt: 'What historical landmarks and churches should I visit in Pasig?' },
  { label: 'Parks & Family', prompt: 'Recommend family-friendly parks and relaxing spots in Pasig.' },
  { label: 'Hours & Fees', prompt: 'What are the general opening hours and admission fees for attractions in Pasig?' },
  { label: 'Safety & Tips', prompt: 'What local etiquette, dress codes, and safety tips should I know while touring Pasig?' },
];

const FALLBACK_PROFILE_PIC = '/assets/images/Temporary.png';
const AI_AVATAR            = '/assets/images/AI/ALI 2.png';
const PLACEHOLDER_IMAGE    = '/assets/images/placeholder.jpg';

// ─── Geolocation helpers ───────────────────────────────────────────────────────

/** Haversine formula — returns distance in km between two lat/lng points */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

// ─── Message formatter ─────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*{1,2}[^*]+\*{1,2})/g);
  return parts.map((part, i) => {
    if (/^\*\*(.+)\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*(.+)\*$/.test(part))     return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function formatAIMessage(text: string): React.ReactNode {
  // Pre-process: if text contains inline numbered items (e.g. "Intro: 1 Spot A 2 Spot B" or "1. A 2. B"),
  // split them into distinct lines so each item renders on its own row.
  let normalizedText = text
    .replace(/:\s+(\d+[.)]\s+)/g, ':\n\n$1')
    .replace(/([.!?])\s+(\d+[.)]\s+)/g, '$1\n$2');

  // Handle case where numbers have no period/paren after intro (e.g. "intro: 1 Name – desc 2 Name – desc")
  normalizedText = normalizedText.replace(/([.!?])\s+(\d+)\s+([A-Z][^\n]+?\s*[–—-]\s*)/g, '$1\n$2. $3');

  const lines = normalizedText.split('\n');
  const elements: React.ReactNode[] = [];
  const numberedItems: { num: string; content: string }[] = [];
  const bulletItems: string[] = [];
  let listKey = 0;

  const flushNumbered = () => {
    if (numberedItems.length === 0) return;
    elements.push(
      <ol key={`ol-${listKey++}`} className="ai-msg-numbered">
        {numberedItems.map((item, i) => (
          <li key={i} className="ai-msg-numbered-item">
            <span className="ai-num-badge">{item.num}</span>
            <span>{renderInline(item.content)}</span>
          </li>
        ))}
      </ol>
    );
    numberedItems.length = 0;
  };

  const flushBullets = () => {
    if (bulletItems.length === 0) return;
    elements.push(
      <ul key={`ul-${listKey++}`} className="ai-msg-list">
        {bulletItems.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
      </ul>
    );
    bulletItems.length = 0;
  };

  lines.forEach((line, idx) => {
    const t = line.trim();

    // Numbered list item: "1. ..." or "1) ..." or "1 - ..."
    const numMatch = t.match(/^(\d+)[.)\-]\s+(.+)$/);
    if (numMatch) {
      flushBullets();
      numberedItems.push({ num: numMatch[1], content: numMatch[2] });
      return;
    }

    // Bullet item
    if (/^[-*•]\s+/.test(t)) {
      flushNumbered();
      bulletItems.push(t.replace(/^[-*•]\s+/, ''));
      return;
    }

    // Flush any pending lists before rendering text
    flushNumbered();
    flushBullets();

    if (!t) return;

    // Detect a question at the end — render with a distinct style
    if (t.endsWith('?')) {
      elements.push(
        <p key={idx} className="ai-msg-question">
          {renderInline(t)}
        </p>
      );
      return;
    }

    // Heading line (e.g. "Here are some places:")
    if (/^[A-Z].{0,60}:$/.test(t)) {
      elements.push(<p key={idx} className="ai-msg-heading">{t}</p>);
      return;
    }

    elements.push(<p key={idx} className="ai-msg-para">{renderInline(t)}</p>);
  });

  flushNumbered();
  flushBullets();
  return <>{elements}</>;
}

// ─── Component ────────────────────────────────────────────────────────────────

const AIGuide: React.FC = () => {
  const history = useHistory();
  const routerLocation = useLocation();
  const {  user } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────

  const [messages, setMessages] = useState<ChatMessage[]>([
    { text: WELCOME_MESSAGE, sender: 'ai', timestamp: new Date() },
  ]);
  const [input, setInput]               = useState('');
  const [isTyping, setIsTyping]         = useState(false);
  const [isSpeaking, setIsSpeaking]     = useState(false);
  const [isPaused, setIsPaused]         = useState(false);
  const [isSearching, setIsSearching]   = useState(false);
  const [isThinking, setIsThinking]     = useState(false);
  const [voiceSpeed, setVoiceSpeed]     = useState(1.0);
  const [showSettings, setShowSettings] = useState(false);
  const [isMuted, setIsMuted]           = useState(false);
  const [voiceGender, setVoiceGender]   = useState<'female' | 'male'>('female');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showErrorToast, setShowErrorToast] = useState(false);
  const [voiceActive, setVoiceActive]               = useState(false);  // true during a vibration pulse
  const [speakingMessageId, setSpeakingMessageId]   = useState<number | null>(null);
  const [pausedMessageId, setPausedMessageId]       = useState<number | null>(null);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  const [routeMapOpen, setRouteMapOpen] = useState(false);
  const [routeMapMinimized, setRouteMapMinimized] = useState(false);
  const [routeMapMaximized, setRouteMapMaximized] = useState(false);
  const [routeDestination, setRouteDestination] = useState<Destination | null>(null);

  // Destinations — raw Firestore docs, passed straight into askAIGuide()
  const [destinations, setDestinations]   = useState<Destination[]>([]);
  const [, setPlacesLoading] = useState(true);
  const [, setPlacesError]   = useState<string | null>(null);

  // User geolocation
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────────

  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLInputElement>(null);
  const mountedRef      = useRef(true);
  const isSendingRef    = useRef(false);
  const initialQuerySentRef = useRef(false);

  // Audio-level refs for vibration feedback during voice input
  const audioContextRef   = useRef<AudioContext | null>(null);
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const micStreamRef      = useRef<MediaStream | null>(null);
  const vibrationFrameRef = useRef<number | null>(null);
  const lastVibratedRef   = useRef<number>(0);

  // Stable refs for values used inside callbacks/effects
  const isMutedRef      = useRef(isMuted);
  const voiceSpeedRef   = useRef(voiceSpeed);
  const voiceGenderRef  = useRef(voiceGender);
  const messagesRef     = useRef(messages);

  useEffect(() => { isMutedRef.current    = isMuted;    }, [isMuted]);
  useEffect(() => { voiceSpeedRef.current  = voiceSpeed;  }, [voiceSpeed]);
  useEffect(() => { voiceGenderRef.current = voiceGender; }, [voiceGender]);
  useEffect(() => { messagesRef.current    = messages;    }, [messages]);

  useEffect(() => {
    const unsubscribe = subscribeTts(({ isSpeaking, isPaused, speakingId }) => {
      setIsSpeaking(isSpeaking);
      setIsPaused(isPaused);

      if (speakingId == null) {
        setSpeakingMessageId(null);
        setPausedMessageId(null);
        return;
      }

      const parsed = Number(speakingId);
      const nextMessageId = Number.isFinite(parsed) ? parsed : null;
      setSpeakingMessageId(nextMessageId);
      setPausedMessageId(isPaused ? nextMessageId : null);
    });

    return unsubscribe;
  }, []);

  // ── Load voices once & auto-speak welcome ─────────────────────────────────

  useEffect(() => {
<<<<<<< HEAD
    const speakWelcome = () => {
      if (!mountedRef.current || isMutedRef.current) return;
      // Small delay so the UI has settled before speaking
      setTimeout(() => {
        if (mountedRef.current && !isMutedRef.current) speakMessage(WELCOME_MESSAGE, 0);
      }, 600);
    };

    if (Capacitor.isNativePlatform()) {
      speakWelcome();
      return;
    }

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        speakWelcome();
      } else {
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.getVoices();
          speakWelcome();
          window.speechSynthesis.onvoiceschanged = null; // fire once only
        };
      }
=======
    if (!window.speechSynthesis) return;

    const speakWelcome = () => {
      if (!mountedRef.current) return;
      // Small delay so the UI has settled before speaking
      setTimeout(() => {
        if (mountedRef.current) speakMessage(WELCOME_MESSAGE, 0);
      }, 600);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      speakWelcome();
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
        speakWelcome();
        window.speechSynthesis.onvoiceschanged = null; // fire once only
      };
>>>>>>> origin/main
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Request user location once ────────────────────────────────────────────

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (!mountedRef.current) return;
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      err => console.warn('Geolocation unavailable:', err.message),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch destinations ─────────────────────────────────────────────────────
  // Kept as raw Destination[] so it can be passed directly into askAIGuide(),
  // which does its own popularity/proximity ranking server-side.

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setPlacesLoading(true);
        const data = await fetchDestinations();
        if (cancelled) return;
        setDestinations(data);
        setPlacesError(null);
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading destinations:', err);
          setPlacesError('Failed to load places.');
        }
      } finally {
        if (!cancelled) setPlacesLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Derived: PlaceSuggestion[] for card rendering, recomputed whenever
  //    destinations load or userLocation changes (so distances stay live) ────

  const places = useMemo<PlaceSuggestion[]>(() => {
    return destinations.map(dest => {
      const lat = dest.location?.lat ?? null;
      const lng = dest.location?.lng ?? null;
      const distanceKm =
        userLocation && lat !== null && lng !== null
          ? haversineKm(userLocation.lat, userLocation.lng, lat, lng)
          : null;

      return {
        id:       dest.id,
        title:    dest.name || dest.title || 'Unknown Place',
        image:    dest.imageUrl || dest.image || PLACEHOLDER_IMAGE,
        rating:   dest.rating   ?? 0,
        reviews:  dest.reviews  ?? 0,
        distance: distanceKm !== null ? formatDistance(distanceKm) : (dest.distance ?? ''),
        address:  dest.address  || '',
        type:     dest.category || 'attraction',
        category: (dest.category as PlaceCategory) || 'historical',
        tags:     [],
        lat,
        lng,
      };
    });
  }, [destinations, userLocation]);

  /** Fast lookup for turning askAIGuide's recommendedDestinationIds into cards. */
  const placesById = useMemo(() => {
    return new Map(places.map(p => [p.id, p]));
  }, [places]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopSpeaking();
      stopVibrationDetector();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll ────────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, isThinking, isSearching]);

  // ── Profile pic ────────────────────────────────────────────────────────────

  const userProfilePic = getProfilePicCache() || FALLBACK_PROFILE_PIC;

  const handleImageError = useCallback((placeId: string) => {
    setImageErrors(prev => new Set(prev).add(placeId));
  }, []);

  // ── Vibration / audio-level detection ────────────────────────────────────

  /** Start monitoring microphone volume; vibrate device when speech is detected */
  /*
  const startVibrationDetector = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    if (!('vibrate' in navigator)) return; // device doesn't support vibration

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);

      const SILENCE_THRESHOLD = 20;   // 0–255 scale; below this = silence
      const VIBRATE_COOLDOWN_MS = 400; // minimum ms between vibration pulses

      const tick = () => {
        if (!mountedRef.current) return;
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((s, v) => s + v, 0) / data.length;

        if (avg > SILENCE_THRESHOLD) {
          const now = Date.now();
          if (now - lastVibratedRef.current > VIBRATE_COOLDOWN_MS) {
            lastVibratedRef.current = now;
            if (safeVibrate(navigator, 60)) {
              // Flash voiceActive for 350 ms to trigger CSS animation
              setVoiceActive(true);
              setTimeout(() => { if (mountedRef.current) setVoiceActive(false); }, 350);
            }
          }
        }

        vibrationFrameRef.current = requestAnimationFrame(tick);
      };

      vibrationFrameRef.current = requestAnimationFrame(tick);
    } catch {
      // Permission denied or AudioContext unavailable — fail silently
    }
  }, []);
  */

  /** Stop monitoring and tear down AudioContext */
  const stopVibrationDetector = useCallback(() => {
    if (vibrationFrameRef.current !== null) {
      cancelAnimationFrame(vibrationFrameRef.current);
      vibrationFrameRef.current = null;
    }
    analyserRef.current?.disconnect();
    audioContextRef.current?.close().catch(() => {});
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    audioContextRef.current = null;
    analyserRef.current     = null;
    micStreamRef.current    = null;
    if (safeVibrate(navigator, 0)) {
      // cancel any pending vibration when allowed
    }
    setVoiceActive(false);
  }, []);

  // ── Speech synthesis ───────────────────────────────────────────────────────

  const stopSpeaking = useCallback(() => {
    stopTts();
    setIsSpeaking(false);
    setIsPaused(false);
    setSpeakingMessageId(null);
    setPausedMessageId(null);
  }, []);

  const speakMessage = useCallback((rawText: string, messageIndex: number) => {
    if (isMutedRef.current) return;

    speakTts(rawText, {
      id: String(messageIndex),
      rate: voiceSpeedRef.current,
      gender: voiceGenderRef.current,
      muted: isMutedRef.current,
<<<<<<< HEAD
      lang: 'en-US',
=======
      lang: 'fil-PH',
>>>>>>> origin/main
      onEnd: () => {
        if (!mountedRef.current) return;
        setSpeakingMessageId(null);
        setPausedMessageId(null);
      },
    });
  }, []);

  const togglePlayPause = useCallback((messageIndex: number, messageText?: string) => {
    const isThisMessage = speakingMessageId === messageIndex || pausedMessageId === messageIndex;

    if (isThisMessage) {
      if (isPaused) {
        resumeTts();
        setIsSpeaking(true);
        setIsPaused(false);
        setSpeakingMessageId(messageIndex);
        setPausedMessageId(null);
      } else if (isSpeaking) {
        pauseTts();
        setIsSpeaking(false);
        setIsPaused(true);
        setSpeakingMessageId(null);
        setPausedMessageId(messageIndex);
      }
    } else if (messageText) {
      stopSpeaking();
      speakMessage(messageText, messageIndex);
    }
  }, [speakingMessageId, pausedMessageId, isSpeaking, isPaused, stopSpeaking, speakMessage]);

  // ── Error helper ───────────────────────────────────────────────────────────

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setShowErrorToast(true);
  };

  // ── AI response ────────────────────────────────────────────────────────────
  // All ranking (popularity/reviews/rating), personalization (past searches +
  // visits), proximity, and Pasig-City scoping now live server-side in
  // askAIGuide() (services/aiService.ts) — this component just supplies the
  // raw destination catalog + coords + short chat history and renders
  // whatever it grounds its answer in.

  const generateAIResponse = useCallback(async (
    userMessage: string,
    conversationHistory: ChatMessage[]
  ): Promise<{ text: string; places: PlaceSuggestion[]; showRouteToId?: string }> => {
    setIsSearching(true);
    setIsThinking(true);

    try {
      // Keep last 6 turns for context, excluding the message we're about to
      // send (askAIGuide takes that separately as `message`).
      const chatHistory: ChatTurn[] = conversationHistory
        .slice(0, -1)
        .slice(-6)
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          text: msg.text,
        }));

      const coords = userLocation
        ? { latitude: userLocation.lat, longitude: userLocation.lng }
        : null;

      const response = await askAIGuide({
        uid: user?.uid || 'anonymous',
        message: userMessage,
        history: chatHistory,
        destinations,
        coords,
      });

      const suggestedPlaces = response.recommendedDestinationIds
        .map(id => placesById.get(id))
        .filter((p): p is PlaceSuggestion => !!p);

      return { text: getDisplayReply(response.reply), places: suggestedPlaces, showRouteToId: response.showRouteToId };
    } catch (error) {
      console.error('Error generating AI response:', error);
      return {
        text: "Hmm, I'm having trouble connecting right now. Please check your internet and try again.",
        places: [],
      };
    } finally {
      setIsSearching(false);
      setIsThinking(false);
    }
  }, [user, userLocation, destinations, placesById]);

  // ── Send message ───────────────────────────────────────────────────────────

  // Use a ref-wrapped version so the voice recognition onresult can call it without
  // capturing a stale closure (recognition is set up in a one-time effect).
  const sendMessageImpl = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSendingRef.current) return;

    isSendingRef.current = true;
    stopSpeaking();
    setInput('');

    const userMessage: ChatMessage = { text: trimmed, sender: 'user', timestamp: new Date() };
    const updatedMessages = [...messagesRef.current, userMessage];
    setMessages(updatedMessages);
    setIsTyping(true);

    // Fire-and-forget: feeds the tourist's own aiGuideHistory doc so future
    // turns (and the proximity/home recommendations elsewhere in the app)
    // get more personalized over time.
    if (user?.uid) recordSearchTerm(user.uid, trimmed);

    try {
      const { text: aiText, places: suggestedPlaces, showRouteToId } =
        await generateAIResponse(trimmed, updatedMessages);

      if (!mountedRef.current) return;

      const aiMessage: ChatMessage = {
        text:      aiText,
        sender:    'ai',
        timestamp: new Date(),
        places:    suggestedPlaces,
        showRouteToId,
      };

      setMessages(prev => {
        const updated = [...prev, aiMessage];
        return updated;
      });

      if (showRouteToId) {
        let destination = destinations.find(place => place.id === showRouteToId) ?? null;
        if (!destination) {
          try {
            destination = await fetchDestinationById(showRouteToId);
          } catch (err) {
            console.warn('Failed to fetch destination for showRouteToId:', err);
          }
        }
        if (destination && mountedRef.current) {
          setRouteDestination(destination);
          setRouteMapOpen(true);
          setRouteMapMinimized(false);
          setRouteMapMaximized(false);
        }
      }

      // Speak after state is queued — index = current messages + 1 (the new AI message)
      if (!isMutedRef.current) {
        const nextIndex = messagesRef.current.length + 1; // +1 for userMessage already pushed
        setTimeout(() => {
          if (mountedRef.current) speakMessage(aiText, nextIndex);
        }, 80);
      }
    } catch (err) {
      console.error('Send message error:', err);
      if (mountedRef.current) {
        showError('Something went wrong. Please try again.');
      }
    } finally {
      if (mountedRef.current) {
        setIsTyping(false);
        setIsSearching(false);
        setIsThinking(false);
      }
      isSendingRef.current = false;
    }
  }, [generateAIResponse, speakMessage, stopSpeaking, user]);

  const sendMessageRef = useRef(sendMessageImpl);
  useEffect(() => { sendMessageRef.current = sendMessageImpl; }, [sendMessageImpl]);

  // Stable wrapper for JSX onClick / recognition onresult
  const sendMessage = useCallback((text: string) => {
    sendMessageRef.current(text);
  }, []);

  // ── Voice input controls ─────────────────────────────────────────────────
  // useSpeechRecognition picks the right engine automatically: the Web Speech
  // API in a browser tab, and the native OS speech recognizer (via
  // @capacitor-community/speech-recognition) when running inside the APK —
  // which is what fixes the "not supported" toast you were seeing on device.

  const handleFinalTranscript = useCallback((transcript: string) => {
    setInput(transcript);
    sendMessageRef.current(transcript);
  }, []);

  const {
    isListening,
    liveTranscript,
    start: startListening,
    stop: stopListeningInternal,
  } = useSpeechRecognition({
<<<<<<< HEAD
    lang: 'en-US',
=======
    lang: 'fil-PH',
>>>>>>> origin/main
    onFinalResult: handleFinalTranscript,
    onError: showError,
  });

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListeningInternal();
      stopVibrationDetector();
    } else {
      stopSpeaking();
      stopVibrationDetector();
      setInput('');
      startListening();
    }
  }, [isListening, startListening, stopListeningInternal, stopSpeaking, stopVibrationDetector]);

  const stopVoiceInput = useCallback(() => {
    stopListeningInternal();
  }, [stopListeningInternal]);

  // ── Navigation ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(routerLocation.search);
    const query = params.get('q')?.trim();
    if (query && !initialQuerySentRef.current) {
      initialQuerySentRef.current = true;
      setInput(query);
      // Slight delay to allow state sync before sendMessage if not already typing
      setTimeout(() => sendMessage(query), 50);
    }
  }, [routerLocation.search, sendMessage]);

  const handlePlaceClick = useCallback((place: PlaceSuggestion) => {
    stopSpeaking();
    if (user?.uid) recordDestinationView(user.uid, place.id);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    history.push(`/destination/${place.id}`, place);
  }, [history, stopSpeaking, user]);

  // ── Message tap (play/pause) ───────────────────────────────────────────────

  const handleMessageClick = useCallback((msg: ChatMessage, index: number) => {
    if (msg.sender !== 'ai') return;
    togglePlayPause(index, msg.text);
  }, [togglePlayPause]);

  // ── Keyboard handler ───────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }, [input, sendMessage]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const isBusy    = isTyping || isThinking || isSearching;
  const canSend   = input.trim().length > 0 && !isBusy && !isListening;

  // ── Route-map overlay controls ────────────────────────────────────────────
  // Minimizing and maximizing are mutually exclusive — collapsing to the
  // small circle or expanding to fullscreen each clears the other state so
  // the overlay never ends up with conflicting `minimized maximized`
  // classes. The map content itself only renders while expanded.

  const toggleRouteMapMinimized = () => {
    if (routeMapMinimized) {
      setRouteMapMinimized(false);
    } else {
      setRouteMapMinimized(true);
      setRouteMapMaximized(false);
    }
  };

  const toggleRouteMapMaximized = () => {
    if (routeMapMaximized) {
      setRouteMapMaximized(false);
    } else {
      setRouteMapMaximized(true);
      setRouteMapMinimized(false);
    }
  };

  const closeRouteMap = () => {
    setRouteMapOpen(false);
    setRouteMapMinimized(false);
    setRouteMapMaximized(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <IonPage>
      {/* Header */}
      <IonHeader className="ai-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/Home" />
          </IonButtons>
          <IonTitle>
            <div className="title">AI Pasig Guide</div>
            <div className="subtitle">Assistant for Pasig City</div>
          </IonTitle>
          <IonButtons slot="end">
            <IonButton fill="clear" onClick={() => setShowSettings(true)} aria-label="Open settings">
              <IonIcon icon={settingsOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      {/* Voice indicator overlay */}
      {isListening && (
        <div
          className={`voice-indicator${voiceActive ? ' voice-active' : ''}`}
          role="status"
          aria-live="polite"
        >
          <div className="voice-wave" aria-hidden="true">
            <span /><span /><span /><span /><span />
          </div>
          <span className="voice-text">
            {liveTranscript ? liveTranscript : 'Listening…'}
          </span>
          <button className="voice-stop-btn" onClick={stopVoiceInput} aria-label="Stop voice input">
            <IonIcon icon={close} />
          </button>
        </div>
      )}

      {/* Settings modal */}
      <IonModal isOpen={showSettings} onDidDismiss={() => setShowSettings(false)}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Settings</IonTitle>
            <IonButtons slot="end">
              <IonButton fill="clear" onClick={() => setShowSettings(false)}>Close</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <IonList>
            <IonItem>
              <IonLabel>Mute Voice</IonLabel>
              <IonToggle
                checked={isMuted}
                onIonChange={e => {
                  setIsMuted(e.detail.checked);
                  if (e.detail.checked) stopSpeaking();
                }}
              />
            </IonItem>
            <IonItem>
              <IonLabel>Voice Gender</IonLabel>
              <IonSelect value={voiceGender} onIonChange={e => setVoiceGender(e.detail.value)}>
                <IonSelectOption value="any">Any</IonSelectOption>
                <IonSelectOption value="male">Male</IonSelectOption>
                <IonSelectOption value="female">Female</IonSelectOption>
              </IonSelect>
            </IonItem>
            <IonItem>
              <IonLabel>Voice Speed</IonLabel>
              <IonSelect value={voiceSpeed} onIonChange={e => setVoiceSpeed(parseFloat(e.detail.value))}>
                <IonSelectOption value={0.8}>Slow</IonSelectOption>
                <IonSelectOption value={1.0}>Normal</IonSelectOption>
                <IonSelectOption value={1.2}>Fast</IonSelectOption>
              </IonSelect>
            </IonItem>
          </IonList>
        </IonContent>
      </IonModal>

      {/* Main content */}
      <IonContent className="chat-content">
        <div className="chat-area">
          {messages.map((msg, i) => (
            <div key={i}>
              <div className={`message-container ${msg.sender}${i === 0 && msg.sender === 'ai' ? ' welcome' : ''}`}>
                {msg.sender === 'ai' && (
                  <img src={AI_AVATAR} alt="ALI, your AI guide" className="profile-img" />
                )}

                <div className="bubble-col">
                  {/* Speaking / paused pill */}
                  {msg.sender === 'ai' && (speakingMessageId === i || pausedMessageId === i) && (
                    <div className="speaking-indicator" aria-live="polite">
                      <IonIcon
                        icon={isPaused && pausedMessageId === i ? pauseCircleOutline : volumeHighOutline}
                      />
                      <span>{isPaused && pausedMessageId === i ? 'Paused' : 'Speaking'}</span>
                    </div>
                  )}

                  <div
                    className={`bubble ${msg.sender}${
                      (isSpeaking && speakingMessageId === i) || (isPaused && pausedMessageId === i)
                        ? ' speaking'
                        : ''
                    }`}
                    onClick={() => handleMessageClick(msg, i)}
                    role={msg.sender === 'ai' ? 'button' : undefined}
                    tabIndex={msg.sender === 'ai' ? 0 : undefined}
                    onKeyDown={e => msg.sender === 'ai' && e.key === 'Enter' && handleMessageClick(msg, i)}
                    aria-label={
                      msg.sender === 'ai'
                        ? `AI message. Tap to ${speakingMessageId === i ? 'pause' : 'play'}.`
                        : undefined
                    }
                  >
                    <div className="bubble-content">
                      {msg.sender === 'ai' ? formatAIMessage(msg.text) : <span className="user-text">{msg.text}</span>}
                    </div>

                    <time
                      className="message-timestamp"
                      dateTime={msg.timestamp.toISOString()}
                      aria-label={`Sent at ${msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    >
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                </div>

                {msg.sender === 'user' && (
                  <img src={userProfilePic} alt="You" className="profile-img" />
                )}
              </div>

              {/* Place cards */}
              {msg.places && msg.places.length > 0 && (
                <div className="place-suggestion-container">
                  <div className="place-suggestion-header">
                    <IonIcon aria-hidden="true" /> Recommended Places
                  </div>
                  {msg.places.map(place => (
                    <div
                      key={place.id}
                      className="place-card"
                      onClick={() => handlePlaceClick(place)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && handlePlaceClick(place)}
                      aria-label={`View details for ${place.title}`}
                    >
                      <img
                        src={imageErrors.has(place.id) ? PLACEHOLDER_IMAGE : place.image}
                        alt={place.title}
                        className="place-card-image"
                        onError={() => handleImageError(place.id)}
                        loading="lazy"
                      />
                      <div className="place-card-info">
                        <h4>{place.title}</h4>
                        <p>
                          <IonIcon icon={location} aria-hidden="true" /> {place.address}
                        </p>
                        <div className="place-card-rating">
                          <IonIcon icon={star} aria-hidden="true" /> {place.rating}
                          <span>({place.reviews} reviews) · {place.distance}</span>
                        </div>
                        <span className="place-badge">{place.type}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* NEW — "View route" action: only rendered when aiService.ts
                  actually computed a real walking route for this reply
                  (see AIGuideResponse.showRouteToId). Opens the floating
                  route-map overlay pre-loaded with this destination, so
                  the chat stays usable while the map is minimized. */}
              {msg.showRouteToId && (
                <button
                  className="place-card"
                  style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={async () => {
                    const destinationId = msg.showRouteToId!;
                    let destination = destinations.find(place => place.id === destinationId) ?? null;
                    if (!destination) destination = await fetchDestinationById(destinationId);
                    if (!destination) {
                      showError('Unable to load that destination for directions.');
                      return;
                    }
                    setRouteDestination(destination);
                    setRouteMapOpen(true);
                    setRouteMapMinimized(false);
                    setRouteMapMaximized(false);
                  }}
                >
                  <IonIcon icon={location} aria-hidden="true" />
                  View route on map
                </button>
              )}
            </div>
          ))}

          {routeMapOpen && routeDestination && (
            <div
              className={`ai-route-map-overlay${routeMapMinimized ? ' minimized' : ''}${routeMapMaximized ? ' maximized' : ''}`}
              onClick={routeMapMinimized ? toggleRouteMapMinimized : undefined}
            >
              <button
                className="ai-route-map-toggle"
                aria-label={routeMapMinimized ? 'Expand route map' : 'Minimize route map'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleRouteMapMinimized();
                }}
              >
                {routeMapMinimized ? '+' : '−'}
              </button>
              {!routeMapMinimized && (
                <button
                  className="ai-route-map-maximize"
                  aria-label={routeMapMaximized ? 'Restore route map size' : 'Maximize route map'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleRouteMapMaximized();
                  }}
                >
                  <IonIcon icon={routeMapMaximized ? contractOutline : expandOutline} />
                </button>
              )}
              {!routeMapMinimized && (
                <button
                  className="ai-route-map-close"
                  aria-label="Close route map"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeRouteMap();
                  }}
                >
                  <IonIcon icon={close} />
                </button>
              )}
              {!routeMapMinimized && <IntegratedRouteMap destination={routeDestination} origin={userLocation} />}
            </div>
          )}

          {/* State indicators — only show one at a time (priority: searching > thinking > typing) */}
          {isSearching && (
            <div className="message-container ai" role="status" aria-live="polite">
              <img src={AI_AVATAR} alt="" className="profile-img" aria-hidden="true" />
              <div className="searching-state">
                <IonIcon icon={search} className="searching-pulse" aria-hidden="true" />
                <span>Searching for places…</span>
              </div>
            </div>
          )}

          {isThinking && !isSearching && (
            <div className="message-container ai" role="status" aria-live="polite">
              <img src={AI_AVATAR} alt="" className="profile-img" aria-hidden="true" />
              <div className="thinking-indicator">
                <div className="thinking-spinner" aria-hidden="true" />
                <span>Thinking…</span>
              </div>
            </div>
          )}

          {isTyping && !isThinking && !isSearching && (
            <div className="message-container ai" role="status" aria-live="polite">
              <img src={AI_AVATAR} alt="" className="profile-img" aria-hidden="true" />
              <div className="bubble ai typing" aria-label="ALI is typing">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
            </div>
          )}

          {/* Suggested questions — only on fresh conversation */}
          {messages.length === 1 && !isBusy && (
            <div className="suggestions" role="complementary" aria-label="Suggested questions">
              <p className="suggest-title">
                <IonIcon icon={chatbubblesOutline} aria-hidden="true" /> Try asking…
              </p>
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button key={i} onClick={() => sendMessage(q)} disabled={isBusy}>
                  {q}
                </button>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick topic chips row */}
        {!isBusy && (
          <div className="ai-chat-quick-chips-row" role="toolbar" aria-label="Quick topic prompts">
            {QUICK_TOPIC_CHIPS.map((chip, idx) => (
              <button
                key={idx}
                className="ai-chat-quick-chip"
                onClick={() => sendMessage(chip.prompt)}
                disabled={isBusy}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {/* Input bar */}
        <div className="input-area" role="search" aria-label="Chat input">
          <button
            className={`icon-btn${isListening ? ' listening' : ''}`}
            onClick={toggleListening}
            aria-label={isListening ? 'Stop listening' : 'Start voice input'}
            aria-pressed={isListening}
            disabled={isBusy && !isListening}
          >
            <IonIcon icon={isListening ? micOff : mic} />
          </button>

          <input
            ref={inputRef}
            name="ai-guide-message"
            value={input}
            onChange={e => !isListening && setInput(e.target.value)}
            placeholder={isListening ? 'Listening…' : 'Ask about Pasig City…'}
            onKeyDown={handleKeyDown}
            readOnly={isListening}
            aria-label="Message input"
            maxLength={500}
          />

          <button
            className="send-btn"
            onClick={() => sendMessage(input)}
            disabled={!canSend}
            aria-label="Send message"
          >
            <IonIcon icon={send} />
          </button>
        </div>

        <IonToast
          isOpen={showErrorToast}
          onDidDismiss={() => { setShowErrorToast(false); setErrorMessage(null); }}
          message={errorMessage ?? 'An error occurred'}
          duration={4000}
          color="danger"
          buttons={[{ text: 'Dismiss', role: 'cancel' }]}
        />
      </IonContent>
    </IonPage>
  );
};

export default AIGuide;
