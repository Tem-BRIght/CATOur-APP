import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonButtons, IonButton, IonIcon, IonImg, IonModal, IonFooter,
  IonText, IonLoading, IonBadge, IonToast,
} from '@ionic/react';
import {
  arrowBack, location as locationIcon, star, shareSocial,
  heart, heartOutline, time, cash, people, car, refresh,
  chevronForward, create, chevronBack, chevronForwardOutline,
  calendarOutline,
  leafOutline
} from 'ionicons/icons';


import {
  LoadScript,
  GoogleMap,
  MarkerF,
  DirectionsRenderer,
} from '@react-google-maps/api';
import {
  collection, getDocs, query, orderBy, doc, getDoc, onSnapshot,
} from 'firebase/firestore';
import { firestore } from '../../../firebase';
import { Destination, InfoBlock } from '../../../types';
import { fetchDestinationById, fetchDestinations } from '../../../services/destinationService';
import { toggleFavorite, getFavoriteIds } from '../../../services/favoritesService';
import { generateDestinationItinerary, ItineraryDay } from '../../../services/aiService';
import { getTourTypesWithSchedules, TourTypeWithSchedules } from '../../../services/tourScheduleService';
import { useAuth } from '../../../context/AuthContext';
import { getUserProfile } from '../../../services/userProfileService';
import { notifyReviewReply } from '../../../services/notificationsService';
import { useUserLocation } from '../../../services/useUserLocation';
import { formatDistance as haversineFormatDistance, haversineKm } from '../../../services/distance';
import './DestinationDetail.css';
import WriteReviewModal from './writeReview/WriteReviewModal';
import { Share } from '@capacitor/share';

interface NearbyAttraction { name: string; distance: string; icon?: string; }
// Live review shape from Firestore subcollection
interface ReviewReply { authorName: string; userId?: string; avatar?: string; text: string; createdAt?: string; isVenue?: boolean; }
interface Review {
  /** Firestore document ID (= userId so each user has exactly one review) */
  id?: string;
  /** The uid of the reviewer — same as id, kept explicit for clarity */
  userId?: string;
  author: string;
  rating: number;
  text: string;
  avatar?: string;
  anonymous?: boolean;
  feeling?: string;
  visitDate?: string;
  companion?: string;
  duration?: string;
  photos?: string[];
  createdAt?: string;
  replies?: ReviewReply[];
  detailedRatings?: Record<string, number>;
  allowVenueReply?: boolean;
}
interface UpcomingEvent    { month: string; day: string | number; title: string; time: string; }
interface TimelineEntry    { year: string; event: string; }
interface GalleryPhoto    { url: string; caption?: string; }

const StarRating: React.FC<{ value: number; max?: number }> = ({ value, max = 5 }) => (
  <span className="star-row">
    {Array.from({ length: max }).map((_, i) => (
      <IonIcon key={i} icon={star} className={i < Math.round(value) ? 'star filled' : 'star empty'} />
    ))}
  </span>
);

const ProseSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="dd-section">
    <h3 className="dd-section-title">{title}</h3>
    {children}
  </div>
);

const DestinationDetail: React.FC = () => {
  const history  = useHistory();
  const location = useLocation();
  const { id: routeId } = useParams<{ id: string }>();
  // Support QR scan deep-link: /destination?id=<docId>
  const searchParams = new URLSearchParams(location.search);
  const qrId = searchParams.get('id') || '';
  const id   = routeId || qrId;
  const { user } = useAuth();
  const { coords, locationError: locationGpsError } = useUserLocation();

  const [dest, setDest] = useState<Destination | null>((location.state as Destination) || null);

  const mapInstanceRef  = useRef<google.maps.Map | null>(null);
  const [routeResult,    setRouteResult]    = useState<google.maps.DirectionsResult | null>(null);

  const [showItinerary,   setShowItinerary]   = useState(false);
  const [itinerary,       setItinerary]       = useState('');
  const [itineraryData,   setItineraryData]   = useState<ItineraryDay[] | null>(null);
  const [generating,      setGenerating]      = useState(false);
  const [showMap,         setShowMap]         = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [routeError,      setRouteError]      = useState('');
  const [navMode,         setNavMode]         = useState<'walking' | 'driving' | null>(null);
  const [routeInfo,       setRouteInfo]       = useState<{ distance: string; duration: string } | null>(null);
  const [routeActive,     setRouteActive]     = useState(false);
  const [isFavorite,      setIsFavorite]      = useState(false);
  const [favLoading,      setFavLoading]      = useState(false);
  const [toastMsg,        setToastMsg]        = useState('');
  const [destLoading,     setDestLoading]     = useState(!location.state);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const heroRef = useRef<HTMLDivElement>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  /** Non-null → WriteReviewModal opens in edit mode pre-filled with this review */
  const [editingReview,    setEditingReview]    = useState<Review | null>(null);
  /** ID of the review currently being deleted (shows spinner on that card) */
  const [deletingReviewId, setDeletingReviewId] = useState<string | null>(null);
  // Reply state: maps review id → { open: bool, text: string, submitting: bool }
  const [replyMap, setReplyMap] = useState<Record<string, { open: boolean; text: string; submitting: boolean }>>({}); 
  // Lightbox: unified gallery of destination + review photos
  const [lightbox, setLightbox] = useState<{ photos: GalleryPhoto[]; index: number } | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);

  // ── Live reviews loaded from Firestore subcollection ─────────────────────
  const [liveReviews,     setLiveReviews]     = useState<Review[]>([]);
  const [reviewsLoading,  setReviewsLoading]  = useState(false);
  // Local mirror of aggregate values so they update without a page reload
  const [liveRating,      setLiveRating]      = useState<number | null>(null);
  const [liveCount,       setLiveCount]       = useState<number | null>(null);
  // Live rank computed from the visits collection (QR scans)
  const [liveRank,        setLiveRank]        = useState<number | null>(null);
  // Cache of user profiles for review avatars + names (from /users/{uid})
  const [userProfileMap,  setUserProfileMap]  = useState<Record<string, { name?: string; img?: string }>>({});
  // Nearby destinations fetched from Firestore
  const [computedNearby,  setComputedNearby]  = useState<Destination[]>([]);
  const [destinationTourTypes, setDestinationTourTypes] = useState<TourTypeWithSchedules[]>([]);
  const [destinationTourTypesLoading, setDestinationTourTypesLoading] = useState(false);

  // ── Load destination if not in router state (also handles QR scan) ────────
  useEffect(() => {
    if (dest || !id) return;
    setDestLoading(true);
    fetchDestinationById(id)
      .then(raw => {
        if (!raw) return;
        const r = raw as any;
        // Normalise admin field names → app field names
        const normalised: any = {
          ...r,
          // name: admin uses 'title', app uses 'name'
          name:        r.name        || r.title        || '',
          // description: admin uses 'shortDescription'/'fullDescription'
          description: r.description || r.fullDescription || r.shortDescription || '',
          // address: admin stores as string 'location' field
          address:     r.address     || (typeof r.location === 'string' ? r.location : '') || '',
          // hours / admission
          hours:       r.hours       || r.openingHours || '',
          admission:   r.admission   || r.entranceFee  || r.fee || '',
          // suitableFor: admin uses 'goodFor' array
          suitableFor: r.suitableFor || r.visitorTypes ||
                       (Array.isArray(r.goodFor) ? r.goodFor.join(', ') : '') || '',
          parking:     r.parking     || '',
          // location coords from admin locationCoords field
          location:    r.location?.lat
                         ? r.location
                         : r.locationCoords
                           ? { lat: r.locationCoords.lat, lng: r.locationCoords.lng }
                           : r.location,
          // status: admin uses tempStatus for temporary closure
          status:      r.tempStatus === 'Temporarily Closed' ? 'Temporarily Closed' : (r.status || ''),
          closeReason: r.closeReason || '',
          // image
          imageUrl:    r.imageUrl || r.image || '',
          image:       r.image    || r.imageUrl || '',
        };
        setDest(normalised);
      })
      .catch(console.error)
      .finally(() => setDestLoading(false));
  }, [id, dest]);

  useEffect(() => {
    if (!dest?.id && !dest?.name) {
      setDestinationTourTypes([]);
      return;
    }

    let cancelled = false;
    const loadDestinationTourTypes = async () => {
      setDestinationTourTypesLoading(true);
      try {
        const allTypes = await getTourTypesWithSchedules();
        const targetName = (dest?.name || '').trim().toLowerCase();
        const targetId = dest?.id || '';

        const filtered = allTypes.filter((type) => {
          const matchesDestinationId = !!targetId && type.guides.some((guide) => guide.destinationId === targetId);
          if (matchesDestinationId) return true;
          if (!targetName) return false;
          return type.places.some((place) => {
            const normalized = place.trim().toLowerCase();
            return normalized === targetName || normalized.includes(targetName) || targetName.includes(normalized);
          });
        });

        if (!cancelled) setDestinationTourTypes(filtered);
      } catch (err) {
        console.error('[DestinationDetail] Failed to load tour types for destination:', err);
        if (!cancelled) setDestinationTourTypes([]);
      } finally {
        if (!cancelled) setDestinationTourTypesLoading(false);
      }
    };

    void loadDestinationTourTypes();
    return () => {
      cancelled = true;
    };
  }, [dest?.id, dest?.name]);

  // ── Load reviews from Firestore subcollection ────────────────────────────
  const loadReviews = async (destId: string) => {
    setReviewsLoading(true);
    try {
      const reviewsRef = collection(firestore, 'destinations', destId, 'reviews');
      const q          = query(reviewsRef, orderBy('createdAt', 'desc'));
      const snap       = await getDocs(q);

      // Batch-fetch unique user profiles (skip duplicates & anon reviews)
      const uniqueUserIds = new Set<string>();
      snap.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (!data.anonymous && data.userId) uniqueUserIds.add(data.userId as string);
        if (Array.isArray(data.replies)) {
          data.replies.forEach((reply: any) => {
            if (reply.userId) uniqueUserIds.add(reply.userId as string);
          });
        }
      });

      const profileCache: Record<string, { name: string; img: string }> = {};
      await Promise.all(
        Array.from(uniqueUserIds).map(async uid => {
          try {
            const userSnap = await getDoc(doc(firestore, 'users', uid));
            if (userSnap.exists()) {
              const ud  = userSnap.data();
              const fn  = ud.name?.firstname || '';
              const sn  = ud.name?.surname   || '';
              const full = [fn, sn].filter(Boolean).join(' ') || ud.nickname || '';
              profileCache[uid] = {
                name: full || (ud.email ? ud.email.split('@')[0] : 'Traveller'),
                img: ud.img || '',
              };
            }
          } catch { /* silent */ }
        })
      );
      setUserProfileMap(profileCache);

      const loaded: Review[] = snap.docs.map(d => {
        const data   = d.data();
        const isAnon = !!data.anonymous;
        const uid    = data.userId as string | undefined;

        // Prefer Firestore user profile image + name (from /users/{uid}) over review-saved data.
        const cachedProfile = uid && !isAnon ? profileCache[uid] : undefined;
        const authorName   = isAnon
          ? 'Anonymous'
          : cachedProfile?.name || data.authorName || 'Traveller';
        const authorAvatar = isAnon
          ? undefined
          : cachedProfile?.img || data.authorAvatar || data.avatar || undefined;

        const remapReply = (reply: any): ReviewReply => {
          const replyUid = reply.userId as string | undefined;
          const replyProfile = replyUid ? profileCache[replyUid] : undefined;
          const name = replyProfile?.name || reply.authorName || 'Traveller';
          const avatar = replyProfile?.img || reply.avatar || '';

          return {
            authorName: name,
            userId:     replyUid,
            avatar:     avatar || undefined,
            text:       reply.text || '',
            createdAt:  reply.createdAt || '',
            isVenue:    reply.isVenue || false,
          };
        };

        return {
          id:              d.id,
          userId:          uid,
          author:          authorName,
          rating:          data.overallRating || 0,
          text:            data.review || data.title || '',
          avatar:          authorAvatar,
          anonymous:       isAnon,
          feeling:         data.feeling         || '',
          visitDate:       data.visitDate        || '',
          companion:       data.companion        || '',
          duration:        data.duration         || '',
          createdAt:       data.createdAt?.toDate?.()?.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) || '',
          photos:           Array.isArray(data.photoBase64s) ? data.photoBase64s : (Array.isArray(data.photos) ? data.photos : []),
          destinationName: data.destinationName || data.destName || '',
          destinationImage: data.destinationImage || data.destImage || '',
          replies:         Array.isArray(data.replies) ? data.replies.map(remapReply) : [],
          detailedRatings: data.detailedRatings  || {},
          allowVenueReply: data.allowVenueReply  ?? true,
        };
      });
      setLiveReviews(loaded);
    } catch (err) {
      console.error('Failed to load reviews:', err);
    } finally {
      setReviewsLoading(false);
    }
  };

  useEffect(() => {
    const destId = id || dest?.id;
    if (!destId) return;
    loadReviews(destId);
  }, [id, dest?.id]);

  // ── Compute live rank from visits collection ──────────────────────────────
  useEffect(() => {
    const destName = (dest as any)?.title || (dest as any)?.name || '';
    if (!destName) return;
    (async () => {
      try {
        const snap     = await getDocs(collection(firestore, 'visits'));
        const countMap = new Map<string, number>();
        snap.forEach(d => {
          const name: string = (d.data() as any).destinationTop ?? '';
          if (name) countMap.set(name, (countMap.get(name) ?? 0) + 1);
        });
        if (!countMap.size) return;
        const sorted = Array.from(countMap.entries()).sort((a, b) => b[1] - a[1]);
        const rank   = sorted.findIndex(([name]) => name === destName) + 1;
        if (rank > 0) setLiveRank(rank);
      } catch (err) { console.error('[DestinationDetail] visits rank fetch:', err); }
    })();
  }, [dest]);

  // ── Load initial favorite state from RTDB ────────────────────────────────
  useEffect(() => {
    if (!user?.uid || !dest?.id) return;
    getFavoriteIds(user.uid)
      .then(ids => setIsFavorite(ids.has(dest.id)))
      .catch(console.error);
  }, [user?.uid, dest?.id]);

  // ── Compute nearby destinations from Firestore (real-time updates) ─────────
  useEffect(() => {
    if (!dest) return;
    const raw = dest as any;
    const cLat: number | undefined = raw.location?.lat ?? raw.locationCoords?.lat;
    const cLng: number | undefined = raw.location?.lng ?? raw.locationCoords?.lng;
    if (!cLat || !cLng) return;

    const unsubscribe = onSnapshot(collection(firestore, 'destinations'), snap => {
      const all: Destination[] = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      const nearby = all
        .filter(d => d.id !== (dest.id || id))
        .map(d => {
          const dr = d as any;
          const dLat: number | undefined = dr.location?.lat ?? dr.locationCoords?.lat;
          const dLng: number | undefined = dr.location?.lng ?? dr.locationCoords?.lng;
          if (dLat == null || dLng == null) return null;
          const km = haversineKm(cLat, cLng, dLat, dLng);
          return km <= 5 ? { dest: d, km } : null;
        })
        .filter((x): x is { dest: Destination; km: number } => x !== null)
        .sort((a, b) => a.km - b.km)
        .slice(0, 8)
        .map(x => x.dest);
      setComputedNearby(nearby);
    }, err => {
      console.error('[DestinationDetail] nearby snapshot failed:', err);
    });

    return () => unsubscribe();
  }, [dest, id]);

  // ── Clean up map on modal close ──────────────────────────────────────────
  useEffect(() => {
    if (!showMap && mapInstanceRef.current) {
      if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        setWatchId(null);
      }
      mapInstanceRef.current = null;
      setRouteResult(null);
      setRouteInfo(null);
      setRouteActive(false);
    }
  }, [showMap, watchId]);

  const destCenter = useMemo(() => {
    if (!dest) return null;
    const raw = dest as any;
    return {
      lat: raw.location?.lat ?? raw.locationCoords?.lat ?? 14.5776,
      lng: raw.location?.lng ?? raw.locationCoords?.lng ?? 121.0858,
    };
  }, [dest]);

  const handleMapLoad = (map: google.maps.Map) => {
    mapInstanceRef.current = map;
  };

  // ── Favorite toggle ──────────────────────────────────────────────────────
  const handleFavoriteToggle = async () => {
    if (!user?.uid || !dest) return;

    const currentlyFavorite = isFavorite;
    setFavLoading(true);
    setIsFavorite(!currentlyFavorite);

    try {
      const next = await toggleFavorite(user.uid, dest, currentlyFavorite);
      setIsFavorite(next);
      setToastMsg(next ? 'Added to Favorites' : 'Removed from Favorites');
    } catch (err) {
      setIsFavorite(currentlyFavorite);
      console.error('Favorite toggle failed', err);
      setToastMsg('Something went wrong. Please try again.');
    } finally {
      setFavLoading(false);
    }
  };

  // ── Format seconds → "X min" / "X hr Y min" ────────────────────────────
  const formatDuration = (seconds: number): string => {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
  };

  const formatDistance = (meters: number): string => {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  // ── Routing config per mode ──────────────────────────────────────────────
  // Each mode hits a different OSRM backend so paths are genuinely distinct:
  //   walking → routed-foot  : uses footpaths, alleys, pedestrian shortcuts
  //   driving → routed-car   : roads/streets only, no pedestrian ways
  const modeColor = (mode: 'walking' | 'driving') => {
    if (mode === 'walking') return '#10b981';  // green
    return '#1a8fe3';                           // blue
  };

  const handleGetDirections = (mode?: 'walking' | 'driving') => {
    if (!dest) return;
    const activeMode = mode ?? navMode;
    if (!activeMode) {
      setRouteError('Choose Walk/Drive before getting directions.');
      return;
    }

    const raw = dest as any;
    const destLat = raw.location?.lat ?? raw.locationCoords?.lat ?? 14.5776;
    const destLng = raw.location?.lng ?? raw.locationCoords?.lng ?? 121.0858;
    const destination = { lat: destLat, lng: destLng };

    setRouteError('');
    setRouteInfo(null);
    setRouteActive(false);
    setLoadingLocation(true);
    setNavMode(activeMode);
    setRouteResult(null);

    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
    }

    const routeFrom = (latitude: number, longitude: number) => {
      const service = new google.maps.DirectionsService();
      const request: google.maps.DirectionsRequest = {
        origin: { lat: latitude, lng: longitude },
        destination,
        travelMode: activeMode === 'walking'
          ? google.maps.TravelMode.WALKING
          : google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.METRIC,
      };

      service.route(request, (result, status) => {
        setLoadingLocation(false);
        if (status === google.maps.DirectionsStatus.OK && result) {
          const leg = result.routes?.[0]?.legs?.[0];
          setRouteResult(result);
          setRouteInfo({
            distance: leg?.distance?.text ?? '—',
            duration: leg?.duration?.text ?? '—',
          });
          setRouteActive(true);
          if (mapInstanceRef.current) {
            mapInstanceRef.current.fitBounds(new google.maps.LatLngBounds(), {
              top: 40,
              bottom: 40,
              left: 40,
              right: 40,
            });
          }
        } else {
          console.error('[DestinationDetail] Directions request failed:', status, result);
          setRouteError('Could not load directions. Please try again.');
        }
      });
    };

    if (coords?.latitude && coords?.longitude) {
      routeFrom(coords.latitude, coords.longitude);
      return;
    }

    const watchHandle = navigator.geolocation.watchPosition(
      (position) => {
        routeFrom(position.coords.latitude, position.coords.longitude);
      },
      (err) => {
        console.error('Geolocation error:', err);
        setLoadingLocation(false);
        setRouteError('Location access denied or timeout. Please enable GPS and try again.');
      },
      { enableHighAccuracy: true, timeout: 20000 }
    );
    setWatchId(watchHandle);
  };

  // ── Clear route & reset map to destination ───────────────────────────────
  const handleClearRoute = () => {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
    }
    setRouteResult(null);
    setRouteInfo(null);
    setRouteError('');
    setRouteActive(false);
  };

  // ── Reply helpers ────────────────────────────────────────────────────────
  const toggleReply = (reviewId: string) => {
    setReplyMap(prev => ({
      ...prev,
      [reviewId]: { open: !prev[reviewId]?.open, text: prev[reviewId]?.text || '', submitting: false },
    }));
  };

  const setReplyText = (reviewId: string, text: string) => {
    setReplyMap(prev => ({ ...prev, [reviewId]: { ...prev[reviewId], text } }));
  };

  const submitReply = async (reviewId: string, review?: Review) => {
    const state = replyMap[reviewId];
    const reviewEntry = review || liveReviews.find(r => r.id === reviewId) || reviews.find(r => r.id === reviewId);
    if (!state?.text.trim() || state.submitting) return;
    if (!user) { setToastMsg('Please log in to reply.'); return; }

    // For static fallback reviews we might not have live Firestore ID; prefer userId if available.
    let targetReviewId = reviewId;
    if (targetReviewId.startsWith('external-')) {
      targetReviewId = reviewEntry?.userId || '';
    }
    if (!targetReviewId) {
      setToastMsg('Could not submit reply for this review.');
      setReplyMap(prev => ({ ...prev, [reviewId]: { ...prev[reviewId], submitting: false } }));
      return;
    }

    setReplyMap(prev => ({ ...prev, [reviewId]: { ...prev[reviewId], submitting: true } }));
    try {
      const {
        doc: firestoreDoc,
        getDoc: firestoreGetDoc,
        setDoc: firestoreSetDoc,
        updateDoc,
        arrayUnion,
      } = await import('firebase/firestore');
      const reviewRef = firestoreDoc(firestore, 'destinations', id || dest!.id, 'reviews', targetReviewId);

      let resolvedName = user.displayName || 'You';
      let resolvedAvatar = user.photoURL || '';
      try {
        const profile = await getUserProfile(user.uid);
        if (profile) {
          const fn = profile.name?.firstname || '';
          const sn = profile.name?.surname || '';
          resolvedName = [fn, sn].filter(Boolean).join(' ') || profile.nickname || resolvedName;
          resolvedAvatar = profile.img || resolvedAvatar;
        }
      } catch {
        // fallback to auth profile
      }

      const newReply: ReviewReply = {
        authorName: resolvedName,
        userId:     user.uid,
        avatar:     resolvedAvatar || undefined,
        text:       state.text.trim(),
        createdAt:  new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
        isVenue:    false,
      };

      const existingReviewDoc = await firestoreGetDoc(reviewRef);
      if (existingReviewDoc.exists()) {
        await updateDoc(reviewRef, { replies: arrayUnion(newReply) });
      } else {
        await firestoreSetDoc(reviewRef, {
          replies: [newReply],
          createdAt: new Date(),
          updatedAt: new Date(),
        }, { merge: true });
      }

      // Optimistic UI update
      setLiveReviews(prev => prev.map(r =>
        (r.id === reviewId || r.id === targetReviewId)
          ? { ...r, replies: [...(r.replies || []), newReply] }
          : r
      ));

      // Notify review owner (if not replying to your own review)
      const reviewOwnerId = reviewEntry?.userId;
      const replierId = user.uid;
      if (reviewOwnerId && reviewOwnerId !== replierId) {
        await notifyReviewReply({
          recipientUid:  reviewOwnerId,
          replierName:   newReply.authorName || 'Someone',
          destinationId: dest?.id || id || '',
          destinationName: destName || dest?.title || dest?.name || 'this destination',
          reviewId:      reviewId,
          replyId:       `${reviewId}-${Date.now()}`,
          replySnippet:  newReply.text.slice(0, 80),
        });
      }

      setReplyMap(prev => ({ ...prev, [reviewId]: { open: false, text: '', submitting: false } }));
      setToastMsg('Reply posted!');
    } catch (err) {
      console.error('Reply failed:', err);
      setToastMsg('Failed to post reply. Please try again.');
      setReplyMap(prev => ({ ...prev, [reviewId]: { ...prev[reviewId], submitting: false } }));
    }
  };

  // ── Delete own review ────────────────────────────────────────────────────
  const handleDeleteReview = async (reviewId: string) => {
    if (!user?.uid || !dest) return;
    if (!window.confirm('Delete your review? This cannot be undone.')) return;

    setDeletingReviewId(reviewId);
    try {
      const { doc: fsDoc, deleteDoc: fsDeleteDoc, updateDoc: fsUpdateDoc } = await import('firebase/firestore');
      const destDocId = id || dest.id;

      // 1. Delete the review document
      await fsDeleteDoc(fsDoc(firestore, 'destinations', destDocId, 'reviews', reviewId));

      // 2. Remove the pointer under users/{uid}/reviews/{destId}
      await fsDeleteDoc(fsDoc(firestore, 'users', user.uid, 'reviews', destDocId)).catch(() => {});

      // 3. Recalculate destination aggregate
      const deleted = liveReviews.find(r => r.id === reviewId);
      if (deleted) {
        const prevCount  = liveCount  ?? (Number(dest.reviews) || 0);
        const prevRating = liveRating ?? (parseFloat(dest.rating as any) || 0);
        const newCount   = Math.max(0, prevCount - 1);
        const newRating  = newCount > 0
          ? parseFloat(((prevRating * prevCount - deleted.rating) / newCount).toFixed(1))
          : 0;

        await fsUpdateDoc(fsDoc(firestore, 'destinations', destDocId), {
          reviewCount: newCount,
          rating:      newRating,
        });

        // Optimistic live state
        setLiveCount(newCount);
        setLiveRating(newRating);
        setLiveReviews(prev => prev.filter(r => r.id !== reviewId));
      }

      setToastMsg('Review deleted.');
    } catch (err) {
      console.error('Delete review failed:', err);
      setToastMsg('Could not delete review. Please try again.');
    } finally {
      setDeletingReviewId(null);
    }
  };

  const handleBack = () => history.length > 1 ? history.goBack() : history.push('/home');

  const handleShare = async () => {
    try {
      await Share.share({
        title: destName,
        text: `Check out ${destName} on Catour!`,
        url: `${window.location.origin}/destination/${id}`,
      });
    } catch (error) {
      console.error('Share failed', error);
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(`${window.location.origin}/destination/${id}`);
      setToastMsg('Link copied to clipboard!');
    }
  };

// ── Offline cache (localStorage) ──────────────────────────────────────────
// Keeps the last-known-good destinations list (and individual docs) around
// so Home and DestinationDetail can still render when the device has no
// connectivity. Cache is best-effort: any read/write failure (private
// browsing, storage quota, etc.) just degrades to "no cache" rather than
// throwing, since destinations are non-critical, re-fetchable data.

// const CACHE_KEY_ALL          = 'catour:cache:destinations:all';
// const CACHE_KEY_BY_ID_PREFIX = 'catour:cache:destinations:byId:';
// /** How stale a cache entry is allowed to be before we stop trusting it
//  *  as a "fresh enough" fallback — still shown if it's all we have, but
//  *  callers can check `isStale` to warn the user. */
// const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// interface CacheEnvelope<T> {
//   data: T;
//   cachedAt: number;
// }

// function writeCache<T>(key: string, data: T): void {
//   try {
//     const envelope: CacheEnvelope<T> = { data, cachedAt: Date.now() };
//     localStorage.setItem(key, JSON.stringify(envelope));
//   } catch (err) {
//     console.warn('[destinationService] cache write failed (non-fatal):', err);
//   }
// }

// function readCache<T>(key: string): { data: T; isStale: boolean } | null {
//   try {
//     const raw = localStorage.getItem(key);
//     if (!raw) return null;
//     const envelope = JSON.parse(raw) as CacheEnvelope<T>;
//     if (!envelope || envelope.data === undefined) return null;
//     const isStale = Date.now() - envelope.cachedAt > CACHE_MAX_AGE_MS;
//     return { data: envelope.data, isStale };
//   } catch {
//     return null;
//   }
// }

// /** Cache the full destinations list, and mirror each doc into its own
//  *  by-id entry so fetchDestinationById() can serve a single-item cache
//  *  hit without needing the full list to have loaded first. */
// function cacheDestinationsList(destinations: Destination[]): void {
//   writeCache(CACHE_KEY_ALL, destinations);
//   destinations.forEach(d => {
//     writeCache(`${CACHE_KEY_BY_ID_PREFIX}${d.id}`, d);
//   });
// }

// function getCachedDestinationsList(): { data: Destination[]; isStale: boolean } | null {
//   return readCache<Destination[]>(CACHE_KEY_ALL);
// }

// function getCachedDestinationById(id: string): { data: Destination; isStale: boolean } | null {
//   return readCache<Destination>(`${CACHE_KEY_BY_ID_PREFIX}${id}`);
// }

// /**
//  * isOffline
//  * Small helper so callers/UI can check connectivity without importing
//  * the Network API directly. Exported for use in home.tsx / DestinationDetail.
//  */
// export function isOffline(): boolean {
//   return typeof navigator !== 'undefined' && navigator.onLine === false;
// }

// /**
//  * clearDestinationsCache
//  * Exposed in case Settings ever wants a "Clear offline data" action.
//  */
// export function clearDestinationsCache(): void {
//   try {
//     const keysToRemove: string[] = [];
//     for (let i = 0; i < localStorage.length; i++) {
//       const key = localStorage.key(i);
//       if (key && (key === CACHE_KEY_ALL || key.startsWith(CACHE_KEY_BY_ID_PREFIX))) {
//         keysToRemove.push(key);
//       }
//     }
//     keysToRemove.forEach(k => localStorage.removeItem(k));
//   } catch (err) {
//     console.warn('[destinationService] clearDestinationsCache failed:', err);
//   }
// }

// export const fetchDestinationById = async (id: string): Promise<Destination | null> => {
//   try {
//     const snap = await getDoc(doc(firestore, COLLECTION, id));
//     if (!snap.exists()) return null;
//     const destination = normalise(snap.id, snap.data());
//     writeCache(`${CACHE_KEY_BY_ID_PREFIX}${id}`, destination); // ← cache on success
//     return destination;
//   } catch (err) {
//     console.error('[destinationService] fetchDestinationById failed:', err);
//     // Offline (or any network failure) — fall back to whatever we cached
//     // last time this destination was successfully fetched.
//     const cached = getCachedDestinationById(id);
//     if (cached) {
//       console.warn('[destinationService] serving cached destination (offline fallback):', id);
//       return cached.data;
//     }
//     return null;
//   }
// };

// export const fetchDestinations = async (): Promise<Destination[]> => {
//   try {
//     const snap = await getDocs(col());
//     const destinations = fromSnapshot(snap);
//     cacheDestinationsList(destinations); // ← cache on success
//     return destinations;
//   } catch (err) {
//     console.error('[destinationService] fetchDestinations failed:', err);
//     const cached = getCachedDestinationsList();
//     if (cached) {
//       console.warn('[destinationService] serving cached destinations (offline fallback), stale:', cached.isStale);
//       return cached.data;
//     }
//     return [];
//   }
// };

// export const fetchRecommendedDestinations = async (): Promise<Destination[]> => {
//   try {
//     const recSnap = await getDocs(
//       query(col(), where('recommended', '==', true), orderBy('rating', 'desc'), limit(20))
//     );
//     if (!recSnap.empty) {
//       const data = fromSnapshot(recSnap).filter(d => (d as any).status !== 'draft');
//       cacheDestinationsList(data);
//       return data;
//     }
//     // ...existing published/rating fallbacks unchanged...
//   } catch (err: any) {
//     console.warn('[destinationService] fetchRecommendedDestinations fallback:', err?.message);
//     try {
//       const snap = await getDocs(query(col(), limit(20)));
//       const data = fromSnapshot(snap).filter(d => (d as any).status !== 'draft');
//       cacheDestinationsList(data);
//       return data;
//     } catch (e) {
//       console.error('[destinationService] fetchRecommendedDestinations failed:', e);
//       // NEW — final offline fallback before giving up entirely
//       const cached = getCachedDestinationsList();
//       return cached ? cached.data : [];
//     }
//   }
// };

  const generateItinerary = async () => {
    if (!dest) return;
    setGenerating(true);
    setItineraryData(null);
    setItinerary('');

    try {
      const days = await generateDestinationItinerary(dest);
      setItineraryData(days);
    } catch (err) {
      console.error('Itinerary generation failed:', err);
      setItinerary('Failed to generate itinerary. Please try again later.');
    } finally {
      setGenerating(false);
      setShowItinerary(true);
    }
  };


  // ── Extended fields ──────────────────────────────────────────────────────
  const d = (dest || {}) as any;
  // Normalize Firestore field names (admin uses 'title', app uses 'name' etc.)
  const destName    = dest?.name    || d.title        || '';
  const destAddress = dest?.address || (typeof d.location === 'string' ? d.location : '') || '';
  const destDesc    = dest?.description || d.fullDescription || d.shortDescription || dest?.desc || '';
  const destImageUrl = d.imageUrl  || d.image        || '';

  const images: string[] = d.images?.length ? d.images : [destImageUrl].filter(Boolean);

  const tagline         = d.tagline         || '';
  const hours           = d.hours           || d.openingHours  || '';
  const admission       = d.admission       || d.entranceFee  || d.price || d.fee || '';
  const suitableFor     = d.suitableFor     || d.audience     || d.visitorTypes ||
                       (Array.isArray(d.goodFor) ? d.goodFor.join(', ') : '') || '';
  const parking         = d.parking         || '';
  const lastUpdated     = d.lastUpdated     || '';
  const mostVisitedRank = liveRank ? String(liveRank) : (d.mostVisitedRank || '');
  const visitDuration   = d.visitDuration   || '';
  const bestTimeToVisit = d.bestTimeToVisit || '';
  const whatToBring     = d.whatToBring     || '';
  const historySummary  = d.historySummary  || '';
  const timeline: TimelineEntry[]              = d.timeline          || [];
  const nearbyAttractions: NearbyAttraction[]  = d.nearbyAttractions || [];
  const photoGallery: string[]                 = d.photoGallery       || [];

  const nearbySource = computedNearby.length > 0 ? computedNearby : nearbyAttractions;
  const nearbyList = nearbySource.slice(0, 3);

  // Use live values when available, fall back to Firestore document fields
  const ratingValue = liveRating  ?? (parseFloat(dest?.rating as any) || 0);
  const reviewCount = liveCount   ?? (dest?.reviews || 0);
  const isClosed    = d.status === 'Temporarily Closed' || d.tempStatus === 'Temporarily Closed';
  const closeReason = d.closeReason || '';

  // Displayed reviews: live Firestore subcollection first, then static fallback
  const reviews: Review[] = liveReviews.length > 0
    ? liveReviews
    : ((d.reviews_list || []) as any[]).map((r, idx) => ({
        id:         r.id || r.userId || `external-${idx}`,
        userId:     r.userId,
        author:     r.author || r.authorName || 'Traveller',
        rating:     r.rating || r.overallRating || 0,
        text:       r.text || r.review || '',
        avatar:     r.avatar || r.authorAvatar || '',
        anonymous:  r.anonymous ?? false,
        feeling:    r.feeling || '',
        visitDate:  r.visitDate || '',
        companion:  r.companion || '',
        duration:   r.duration || '',
        photos:     r.photos || r.photoBase64s || [],
        createdAt:  r.createdAt || '',
        replies:    Array.isArray(r.replies) ? r.replies : [],
        detailedRatings: r.detailedRatings || {},
        allowVenueReply: r.allowVenueReply ?? true,
      }));

  // ── Live straight-line distance (updates as user moves via watchPosition) ─
  const destLat = d.location?.lat || d.locationCoords?.lat;
  const destLng = d.location?.lng || d.locationCoords?.lng;
  const liveDistance = coords && destLat != null && destLng != null
    ? haversineFormatDistance(coords.latitude, coords.longitude, destLat, destLng)
    : null;

  return (
    <IonPage>
      <IonLoading isOpen={destLoading} message="Loading..." />
      <IonHeader className="dd-header ion-no-border">
        <IonToolbar className="dd-toolbar">
          <IonButtons slot="start">
            <IonButton className="dd-icon-btn" onClick={handleBack}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton className="dd-icon-btn" onClick={handleShare}>
              <IonIcon icon={shareSocial} />
            </IonButton>
            <IonButton className="dd-icon-btn" onClick={handleFavoriteToggle} disabled={favLoading}>
              <IonIcon icon={isFavorite ? heart : heartOutline} className={isFavorite ? 'heart-active' : ''} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen scrollY>
        {/* Hero Carousel */}
        <div className="dd-hero">
          <div className="dd-hero-slides" ref={heroRef}>
            {images.map((src: string, i: number) => (
              <img key={i} src={src} alt={destName} className="dd-hero-img" />
            ))}
          </div>
          {images.length > 1 && (
            <>
              <button
                className="dd-slide-btn dd-slide-prev"
                aria-label="Previous image"
                title="Previous image"
                onClick={() => {
                  const next = Math.max(0, currentImageIndex - 1);
                  setCurrentImageIndex(next);
                  const target = heroRef.current?.children[next] as HTMLElement | undefined;
                  if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'center' });
                }}
              >
                <IonIcon icon={chevronBack} />
              </button>
              <button
                className="dd-slide-btn dd-slide-next"
                aria-label="Next image"
                title="Next image"
                onClick={() => {
                  const next = Math.min(images.length - 1, currentImageIndex + 1);
                  setCurrentImageIndex(next);
                  const target = heroRef.current?.children[next] as HTMLElement | undefined;
                  if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'center' });
                }}
              >
                <IonIcon icon={chevronForwardOutline} />
              </button>
              <span className="dd-image-counter">{currentImageIndex + 1}/{images.length}</span>
            </>
          )}
        </div>

        {isClosed && (
          <div className="dd-closed-banner">
            <span className="dd-closed-icon">⚠</span>
            <div>
              <strong>Temporarily Closed</strong>
              {closeReason && <p className="dd-closed-reason">{closeReason}</p>}
            </div>
          </div>
        )}

        <div className="dd-card">
          <div className="dd-name-row">
            <h1 className="dd-name">{destName}</h1>
            {tagline && <p className="dd-tagline">{tagline}</p>}
          </div>

          <div className="dd-rating-row">
            <StarRating value={ratingValue} />
            <span className="dd-rating-val">{ratingValue}</span>
            <span className="dd-review-count">({reviewCount} reviews)</span>
            {mostVisitedRank && <span className="dd-rank-badge">#{mostVisitedRank} most visit</span>}
          </div>

          <div className="dd-meta-list">
            {destAddress  && <div className="dd-meta-item"><IonIcon icon={locationIcon} className="dd-meta-icon" /><span>{destAddress}</span></div>}
            {hours        && <div className="dd-meta-item"><IonIcon icon={time}         className="dd-meta-icon" /><span>{hours}</span></div>}
            {admission    && <div className="dd-meta-item"><IonIcon icon={cash}         className="dd-meta-icon" /><span>{admission}</span></div>}
            {suitableFor  && <div className="dd-meta-item"><IonIcon icon={people}       className="dd-meta-icon" /><span>{suitableFor}</span></div>}
            {parking      && <div className="dd-meta-item"><IonIcon icon={car}          className="dd-meta-icon" /><span>{parking}</span></div>}
            {lastUpdated  && <div className="dd-meta-item"><IonIcon icon={refresh}      className="dd-meta-icon" /><span>Last Updated: {lastUpdated}</span></div>}
          </div>

          <div className="dd-action-row">
            <button className="dd-action-btn" onClick={() => setShowMap(true)} disabled={isClosed}>
              <IonIcon icon={locationIcon} /><span>Navigate</span>
            </button>
            <button className="dd-action-btn" onClick={generateItinerary} disabled={generating || isClosed}>
              <IonIcon icon={calendarOutline} /><span>Itinerary</span>
            </button>
            <button
              className="dd-action-btn"
              onClick={() => document.getElementById('destination-tour-types')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <IonIcon icon={people} /><span>Tour</span>
            </button>
          </div>

          {destDesc && (
            <ProseSection title={`About ${destName}`}>
              {d.aboutBullets?.length ? (
                <>
                  <p className="dd-body-text">{destDesc}</p>
                  <ul className="dd-icon-list">
                    {d.aboutBullets.map((b: any, i: number) => (
                      <li key={i} className="dd-icon-list-item">
                        {b.icon && <span className="dd-list-icon">{b.icon}</span>}
                        <span>{b.text || b}</span>
                      </li>
                    ))}
                  </ul>
                  {d.aboutFooter && <p className="dd-body-text">{d.aboutFooter}</p>}
                </>
              ) : (
                <p className="dd-body-text">{destDesc}</p>
              )}
              {(visitDuration || bestTimeToVisit || whatToBring) && (
                <div className="dd-visit-strip">
                  {visitDuration    && <div className="dd-visit-item"><IonIcon icon={time} className="dd-visit-icon" /><div><span className="dd-visit-label">Suggested Visit Duration</span><span className="dd-visit-value">{visitDuration}</span></div></div>}
                  {bestTimeToVisit  && <div className="dd-visit-item"><span className="dd-visit-icon">⚙</span><div><span className="dd-visit-label">Best Time to Visit</span><span className="dd-visit-value">{bestTimeToVisit}</span></div></div>}
                  {whatToBring      && <div className="dd-visit-item"><span className="dd-visit-icon">?</span><div><span className="dd-visit-label">What to Bring</span><span className="dd-visit-value">{whatToBring}</span></div></div>}
                </div>
              )}
            </ProseSection>
          )}

          {dest?.infoBlocks && dest?.infoBlocks.map((block: InfoBlock, idx: number) => (
            <ProseSection key={idx} title={block.title}>
              {block.type === 'none'   && <p className="dd-body-text">{block.plainText}</p>}
              {block.type === 'bullet' && <ul className="dd-bullet-list">{block.items.map((it, i) => it && <li key={i}>{it}</li>)}</ul>}
              {block.type === 'check'  && <ul className="dd-check-list">{block.items.map((it, i) => it && <li key={i}>{it}</li>)}</ul>}
            </ProseSection>
          ))}

          {(destinationTourTypesLoading || destinationTourTypes.length > 0) && (
            <div id="destination-tour-types">
              <ProseSection title="Tour Types">
                {destinationTourTypesLoading && <p className="dd-body-text">Loading tour types…</p>}
                {!destinationTourTypesLoading && destinationTourTypes.map((type) => (
                  <div key={type.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <div>
                        <h4 style={{ margin: 0, color: '#0d2f6e', fontSize: 17 }}>{type.name}</h4>
                        {type.duration && <p style={{ margin: '4px 0 0', color: '#475569', fontSize: 12 }}>{type.duration}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => history.push('/tour')}
                        style={{ border: 'none', borderRadius: 999, background: '#0d2f6e', color: '#fff', padding: '8px 12px', fontWeight: 700 }}
                      >
                        View tours
                      </button>
                    </div>
                    {type.description && <p className="dd-body-text" style={{ marginTop: 10 }}>{type.description}</p>}
                    {type.places.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                        {type.places.slice(0, 3).map((place, i) => (
                          <span key={i} style={{ background: '#e0f2fe', color: '#075985', borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 600 }}>
                            {place}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </ProseSection>
            </div>
          )}

          {nearbyList.length > 0 && (
            <ProseSection title="Nearby Attractions">
              <div className="dd-nearby-list">
                {nearbyList.map((place: any, i: number) => {
                  const isDestination = !!place.id;
                  const name = isDestination ? (place.title || place.name) : place.name;
                  const dr = place as any;
                  const dLat: number | undefined = dr.location?.lat ?? dr.locationCoords?.lat;
                  const dLng: number | undefined = dr.location?.lng ?? dr.locationCoords?.lng;
                  const raw = dest as any;
                  const cLat: number | undefined = raw.location?.lat ?? raw.locationCoords?.lat;
                  const cLng: number | undefined = raw.location?.lng ?? raw.locationCoords?.lng;
                  const distText = isDestination
                    ? (cLat && cLng && dLat && dLng
                        ? (() => {
                            const km = haversineKm(cLat, cLng, dLat, dLng);
                            return km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`;
                          })()
                        : '—')
                    : `${place.distance} away`;

                  return (
                    <div
                      key={place.id || i}
                      className="dd-nearby-item"
                      role="button"
                      onClick={() => isDestination && history.push(`/destination/${place.id}`, place)}
                    >
                      <div className="dd-nearby-info">
                        <span className="dd-nearby-name">{name}</span>
                        <span className="dd-nearby-dist">{distText}</span>
                      </div>
                      {isDestination && (
                        <IonIcon icon={chevronForward} className="dd-nearby-arrow" />
                      )}
                    </div>
                  );
                })}
              </div>
            </ProseSection>
          )}

          {/* ── Reviews ── */}
          <ProseSection title="Reviews">
            <div className="dd-reviews-header">
              <div className="dd-reviews-summary">
                <StarRating value={ratingValue} />
                <span className="dd-rating-val">{ratingValue}</span>
                <span className="dd-review-count">({reviewCount} reviews)</span>
              </div>
              <button className="dd-write-review-btn" onClick={() => setShowReviewModal(true)}>
                <IonIcon icon={create} />Write Review
              </button>
            </div>

            {/* ── Who's been here ── */}
            {reviews.length > 0 && (
              <div className="dd-been-here">
                <div className="dd-been-here-avatars">
                  {reviews.slice(0, 6).map((rev, i) => {
                    const sourceAvatar = rev.userId ? userProfileMap[rev.userId]?.img : undefined;
                    const displayAvatar = rev.anonymous ? undefined : (sourceAvatar || rev.avatar);
                    return (
                      <div
                        key={i}
                        className={`dd-been-here-avatar ${rev.anonymous ? 'dd-been-here-avatar--anon' : ''}`}
                        title={rev.anonymous ? 'Anonymous' : rev.author}
                      >
                        {rev.anonymous ? (
                          <span>?</span>
                        ) : displayAvatar ? (
                          <img src={displayAvatar} alt={rev.author} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <span>{rev.author[0]?.toUpperCase()}</span>
                        )}
                      </div>
                    );
                  })}
                  {reviews.length > 6 && (
                    <div className="dd-been-here-avatar dd-been-here-avatar--more">
                      +{reviews.length - 6}
                    </div>
                  )}
                </div>
                <p className="dd-been-here-label">
                  <strong>{reviews.length}</strong> {reviews.length === 1 ? 'person has' : 'people have'} reviewed this place
                </p>
              </div>
            )}

            {reviewsLoading ? (
              <p className="dd-loading-reviews">
                Loading reviews…
              </p>
            ) : reviews.length === 0 ? (
              <div className="dd-reviews-empty">
                <span className="dd-reviews-empty-icon">💬</span>
                <p>No reviews yet. Be the first to share your experience!</p>
              </div>
            ) : (
              <div className="dd-review-list">
                {reviews.map((rev: Review, i: number) => {
                  const replyState = replyMap[rev.id || String(i)] || { open: false, text: '', submitting: false };
                  const isCurrentUser = user?.uid && rev.id === user.uid;
                  return (
                    <div key={i} className="dd-review-item">
                      {/* ── Reviewer header ── */}
                      <div className="dd-review-top">
                        <div className={`dd-reviewer-avatar ${rev.anonymous ? 'dd-reviewer-avatar--anon' : ''}`}>
                          {(() => {
                            if (rev.anonymous) return <span className="dd-anon-icon">A</span>;
                            const profileImg = rev.userId ? userProfileMap[rev.userId]?.img : undefined;
                            const displayAvatar = profileImg || rev.avatar;
                            if (displayAvatar) {
                              return <img src={displayAvatar} alt={rev.author} />;
                            }
                            return <span>{rev.author[0]?.toUpperCase()}</span>;
                          })()}
                        </div>
                        <div className="dd-reviewer-meta">
                          <div className="dd-reviewer-name-row">
                            <p className="dd-reviewer-name">{rev.author}</p>
                            {isCurrentUser && <span className="dd-reviewer-you-badge">You</span>}
                          </div>
                          <div className="dd-reviewer-sub-row">
                            <StarRating value={rev.rating} />
                            {rev.createdAt && <span className="dd-review-date">{rev.createdAt}</span>}
                          </div>
                          {(rev.companion || rev.duration || rev.visitDate) && (
                            <div className="dd-review-meta-tags">
                              {rev.companion && <span className="dd-review-tag">
                                {rev.companion === 'Solo' ? '👤' : rev.companion === 'Couple' ? '👫' : rev.companion === 'Family' ? '👨‍👩‍👧' : '👥'} {rev.companion}
                              </span>}
                              {rev.duration && <span className="dd-review-tag"> {rev.duration}</span>}
                              {rev.visitDate && <span className="dd-review-tag"> {new Date(rev.visitDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Review feeling (title) ── */}
                      {rev.feeling && <p className="dd-review-feeling">"{rev.feeling}"</p>}

                      {/* ── Review body ── */}
                      {rev.text && <p className="dd-review-text">{rev.text}</p>}

                      {/* ── Existing replies ── */}
                      {(rev.replies || []).length > 0 && (
                        <div className="dd-reply-thread">
                          {(rev.replies || []).map((reply, ri) => (
                            <div key={ri} className="dd-reply-item">
                              <div className="dd-reply-avatar">
                                {reply.avatar ? (
                                  <img src={reply.avatar} alt={reply.authorName} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                ) : (
                                  <span>{reply.authorName?.[0]?.toUpperCase() || 'U'}</span>
                                )}
                              </div>
                              <div className="dd-reply-body">
                                <div className="dd-reply-header">
                                  <span className="dd-reply-author">{reply.authorName}</span>
                                  {reply.isVenue && <span className="dd-reply-venue-badge">Venue</span>}
                                  {reply.createdAt && <span className="dd-reply-date">{reply.createdAt}</span>}
                                </div>
                                <p className="dd-reply-text">{reply.text}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── Reply + owner actions ── */}
                      {user && (
                        <div className="dd-review-actions">
                          <button
                            className={`dd-reply-toggle-btn ${replyState.open ? 'dd-reply-toggle-btn--active' : ''}`}
                            onClick={() => toggleReply(rev.id || String(i))}
                          >
                             {replyState.open ? 'Cancel' : 'Reply'}
                          </button>

                          {/* Only the author sees Edit / Delete */}
                          {isCurrentUser && (
                            <>
                              <button
                                className="dd-review-edit-btn"
                                onClick={() => {
                                  setEditingReview(rev);
                                  setShowReviewModal(true);
                                }}
                              >
                                 Edit
                              </button>
                              <button
                                className="dd-review-delete-btn"
                                disabled={deletingReviewId === rev.id}
                                onClick={() => handleDeleteReview(rev.id!)}
                              >
                                {deletingReviewId === rev.id ? '…' : 'Delete'}
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {/* ── Reply input ── */}
                      {replyState.open && (
                        <div className="dd-reply-compose">
                          <div className="dd-reply-compose-avatar">
                            {user?.photoURL
                              ? <img src={user.photoURL} alt="You" />
                              : <span>{(user?.displayName || 'Y')[0].toUpperCase()}</span>
                            }
                          </div>
                          <div className="dd-reply-compose-right">
                            <textarea
                              name="reply-message"
                              className="dd-reply-input"
                              placeholder={`Reply to ${rev.author}…`}
                              rows={2}
                              value={replyState.text}
                              onChange={e => setReplyText(rev.id || String(i), e.target.value)}
                            />
                            <button
                              className={`dd-reply-send-btn ${(!replyState.text.trim() || replyState.submitting) ? 'dd-reply-send-btn--disabled' : ''}`}
                              onClick={() => submitReply(rev.id || String(i), rev)}
                              disabled={!replyState.text.trim() || replyState.submitting}
                            >
                              {replyState.submitting ? 'Posting…' : 'Post Reply'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ProseSection>

          {(() => {
            const reviewPhotos = reviews.flatMap(r => r.photos || []);
            const baseGallery = photoGallery.length > 0 ? photoGallery : images;
            const gallery = Array.from(new Set([...baseGallery, ...reviewPhotos].filter(Boolean)));
            return gallery.length > 0 ? (
              <ProseSection title="Photo">
                <div className="dd-gallery-grid">
                  {gallery.slice(0, 6).map((src: string, i: number) => (
                    <img
                      key={i}
                      src={src}
                      alt={`Gallery ${i + 1}`}
                      className="dd-gallery-img"
                      role="button"
                      tabIndex={0}
                      onClick={() => setLightbox({ photos: gallery.map(url => ({ url })), index: i })}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setLightbox({ photos: gallery.map(url => ({ url })), index: i }); }}
                    />
                  ))}
                </div>
              </ProseSection>
            ) : null;
          })()}
          <div className="dd-spacer" />
        </div>

        {/* ── Modals ── */}
        <IonModal isOpen={showItinerary} onDidDismiss={() => setShowItinerary(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Itinerary — {destName}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setShowItinerary(false)}>Close</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding itin-content">
            {itineraryData && itineraryData.length > 0 ? (
              <div className="itin-wrapper">
                {itineraryData.map((day) => (
                  <div key={day.day} className="itin-day-card">
                    <div className="itin-day-header">
                      <span className="itin-day-badge">Day {day.day}</span>
                      <span className="itin-day-theme">{day.theme}</span>
                    </div>
                    <div className="itin-slots">
                      {day.slots.map((slot, si) => (
                        <div key={si} className="itin-slot">
                          <div className="itin-slot-time-col">
                            <span className="itin-slot-time">{slot.time}</span>
                            {si < day.slots.length - 1 && <div className="itin-slot-line" />}
                          </div>
                          <div className="itin-slot-body">
                            <p className="itin-slot-activity">{slot.activity}</p>
                            {slot.tip && (
                              <div className="itin-slot-tip">
                                <span className="itin-tip-icon">💡</span>
                                <span>{slot.tip}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : itinerary ? (
              <IonText><pre className="itinerary-text">{itinerary}</pre></IonText>
            ) : null}
          </IonContent>
        </IonModal>

        <IonModal isOpen={showMap} onDidDismiss={() => { setShowMap(false); setRouteError(''); }}>
          <IonHeader><IonToolbar><IonTitle>{destName} Location</IonTitle><IonButtons slot="end"><IonButton onClick={() => setShowMap(false)}>Close</IonButton></IonButtons></IonToolbar></IonHeader>
          <IonContent scrollY={false}>
            <div className="map-container">
              <LoadScript googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
                {destCenter && (
                  <GoogleMap
                    mapContainerStyle={{ width: '100%', height: '100%' }}
                    center={destCenter}
                    zoom={14}
                    options={{
                      disableDefaultUI: true,
                      zoomControl: true,
                      streetViewControl: false,
                      fullscreenControl: false,
                    }}
                    onLoad={handleMapLoad}
                  >
                    <MarkerF
                      position={destCenter}
                      title={destName}
                    />
                    {routeResult && (
                      <DirectionsRenderer
                        directions={routeResult}
                        options={{
                          suppressMarkers: true,
                          polylineOptions: {
                            strokeColor: modeColor(navMode || 'walking'),
                            strokeWeight: 5,
                            strokeOpacity: 0.9,
                          },
                        }}
                      />
                    )}
                  </GoogleMap>
                )}
              </LoadScript>
            </div>
          </IonContent>
          <IonFooter className="ion-no-border">
            <div className="map-directions-bar">
              {/* Transport mode tabs */}
              <div className="nav-mode-tabs">
                <button
                  className={`nav-mode-tab ${navMode === 'walking' ? 'active walking' : ''}`}
                  onClick={() => { setNavMode('walking'); setRouteError(''); setRouteInfo(null); }}
                  disabled={loadingLocation}
                >
                  <span className="nav-mode-icon">🚶</span>
                  <span>Walk</span>
                </button>
                <button
                  className={`nav-mode-tab ${navMode === 'driving' ? 'active driving' : ''}`}
                  onClick={() => { setNavMode('driving'); setRouteError(''); setRouteInfo(null); }}
                  disabled={loadingLocation}
                >
                  <span className="nav-mode-icon">🚗</span>
                  <span>Drive</span>
                </button>
              </div>

              {/* Route info pill */}
              {routeInfo && (
                <div className="nav-route-info">
                  <span className="nav-route-duration">🕐 {routeInfo.duration}</span>
                  <span className="nav-route-sep">·</span>
                  <span className="nav-route-distance">📍 {routeInfo.distance}</span>
                </div>
              )}

              {routeError && <p className="route-error">{routeError}</p>}

              {routeActive ? (
                <IonButton expand="block" fill="outline" className="directions-btn directions-btn--off" onClick={handleClearRoute}>
                  <IonIcon icon={locationIcon} slot="start" />
                  Clear Directions
                </IonButton>
              ) : (
                <IonButton
                  expand="block"
                  fill="solid"
                  className="directions-btn"
                  onClick={() => handleGetDirections()}
                  disabled={loadingLocation || !navMode}
                >
                  <IonIcon icon={locationIcon} slot="start" />
                  {loadingLocation ? 'Getting location…' : (!navMode ? 'Select mode first' : 'Get Directions')}
                </IonButton>
              )}
            </div>
          </IonFooter>
        </IonModal>

        {/* ── WriteReviewModal wired to Firestore ── */}
        <WriteReviewModal
          isOpen={showReviewModal}
          onDidDismiss={() => {
            setShowReviewModal(false);
            setEditingReview(null);
          }}
          destinationId={id || dest?.id || ''}
          destinationName={destName || 'Unknown Destination'}
          destinationCity={destAddress}
          destinationRank={mostVisitedRank || undefined}
          destinationDuration={visitDuration || undefined}
          destinationThumbnail={d.images?.[0] || destImageUrl}
          userId={user?.uid}
          userName={user?.displayName || undefined}
          userAvatar={user?.photoURL || undefined}
          existingReview={editingReview ? {
            overallRating:   editingReview.rating,
            detailedRatings: editingReview.detailedRatings,
            feeling:         editingReview.feeling,
            review:          editingReview.text,
            visitDate:       editingReview.visitDate,
            companion:       editingReview.companion,
            duration:        editingReview.duration,
            anonymous:       editingReview.anonymous,
            allowVenueReply: editingReview.allowVenueReply,
          } : null}
          onSubmit={(data) => {
            const isEdit     = !!editingReview;
            const prevCount  = liveCount  ?? (Number(dest?.reviews) || 0);
            const prevRating = liveRating ?? (parseFloat(dest?.rating as any) || 0);

            let newCount: number;
            let newRating: number;

            if (isEdit) {
              // Swap old rating out, new rating in — count unchanged
              const oldRating = editingReview!.rating;
              newCount  = prevCount;
              newRating = prevCount > 1
                ? parseFloat(((prevRating * prevCount - oldRating + data.overallRating) / prevCount).toFixed(1))
                : data.overallRating;
            } else {
              newCount  = prevCount + 1;
              newRating = parseFloat(((prevRating * prevCount + data.overallRating) / newCount).toFixed(1));
            }

            setLiveCount(newCount);
            setLiveRating(newRating);

            const d2 = data as any;
            const updatedEntry: Review = {
              id:              user?.uid,
              userId:          user?.uid,
              author:          data.anonymous ? 'Anonymous' : (d2.resolvedName || user?.displayName || 'You'),
              avatar:          data.anonymous ? undefined : (d2.resolvedAvatar || user?.photoURL || undefined),
              anonymous:       data.anonymous,
              rating:          data.overallRating,
              text:            data.review || '',
              feeling:         data.feeling || '',
              visitDate:       data.visitDate || '',
              companion:       data.companion || '',
              duration:        data.duration || '',
              photos:          (d2.photoBase64s || []) as string[],
              detailedRatings: data.detailedRatings || {},
              allowVenueReply: data.allowVenueReply,
              createdAt:       isEdit
                                 ? (editingReview!.createdAt || '')
                                 : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
              replies: isEdit ? (editingReview!.replies || []) : [],
            };

            if (isEdit) {
              setLiveReviews(prev => prev.map(r => r.id === user?.uid ? updatedEntry : r));
            } else {
              setLiveReviews(prev => [updatedEntry, ...prev]);
            }

            setToastMsg(isEdit ? 'Review updated!' : 'Review submitted — thank you!');
            setEditingReview(null);
          }}
        />

        <IonToast isOpen={!!toastMsg} message={toastMsg} duration={2000} position="bottom" onDidDismiss={() => setToastMsg('')} />

        {lightbox && (
          <div className="dd-lightbox-overlay" onClick={() => setLightbox(null)}>
            <div className="dd-lightbox-inner" onClick={(e) => e.stopPropagation()}>
              <button className="dd-lightbox-close" onClick={() => setLightbox(null)} aria-label="Close">×</button>
              <button
                className="dd-lightbox-arrow dd-lightbox-arrow--prev"
                onClick={() => setLightbox(prev => prev ? { ...prev, index: (prev.index - 1 + prev.photos.length) % prev.photos.length } : null)}
                aria-label="Previous"
              >‹</button>
              <button
                className="dd-lightbox-arrow dd-lightbox-arrow--next"
                onClick={() => setLightbox(prev => prev ? { ...prev, index: (prev.index + 1) % prev.photos.length } : null)}
                aria-label="Next"
              >›</button>
              <div className="dd-lightbox-img-wrap">
                <img className="dd-lightbox-img" src={lightbox.photos[lightbox.index].url} alt={`Photo ${lightbox.index + 1}`} />
              </div>
            </div>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
};

export default DestinationDetail;