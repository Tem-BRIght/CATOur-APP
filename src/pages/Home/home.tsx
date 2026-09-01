// src/pages/Home/home.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  IonContent, IonHeader, IonPage, IonToolbar,
  IonSearchbar, IonButtons, IonButton, IonIcon,
  IonGrid, IonRow, IonCol, IonCard,
  IonImg, IonAvatar, IonToast, IonAlert,
} from '@ionic/react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useHistory } from 'react-router-dom';
import {
  search, personCircle, notifications,
  location, star, heart, heartOutline,
  cloudOfflineOutline,
} from 'ionicons/icons';
import { collection, doc, limit, onSnapshot, query } from 'firebase/firestore';
import { firestore } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import {
  subscribePopularDestinations,
} from '../../services/destinationService';
import { AppNotification, subscribeNotifications } from '../../services/notificationsService';
import { toggleFavorite, subscribeFavoriteIds } from '../../services/favoritesService';
import { Destination } from '../../types';
import { useUserLocation } from '../../services/useUserLocation';
import { formatDistance } from '../../services/distance';
import { useProximityAI } from '../../context/Proximityaicontext';
import './Home.css';


const truncate = (text: string = '', maxLength = 60) =>
  text.length <= maxLength ? text : text.substring(0, maxLength) + '…';



/* ─── Main component ──────────────────────────────────────────────────── */
const Home: React.FC = () => {
  const history = useHistory();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const { coords } = useUserLocation();
  const { triggerGeneric } = useProximityAI();

  const [profilePic, setProfilePic]   = useState('/assets/images/Temporary.png');
  const [firstName, setFirstName]     = useState('');
  const [favorites, setFavorites]     = useState<Set<string>>(new Set());
  const [recommended, setRecommended] = useState<Destination[]>([]);
  const [popular, setPopular]         = useState<Destination[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toastMsg, setToastMsg]       = useState('');
  const [showExitAlert, setShowExitAlert] = useState(false);
  // rank map: destination title → rank number (1 = most visited)
  const [visitRanks, setVisitRanks]   = useState<Map<string, number>>(new Map());
  // ── Offline detection ────────────────────────────────────────────────────
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false);

  useEffect(() => {
    const handleOnline  = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── auth guard ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !isAuthenticated) history.replace('/login');
  }, [isAuthenticated, authLoading, history]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const backButtonListener = App.addListener('backButton', ({ canGoBack }) => {
      const currentPath = history.location.pathname.toLowerCase();
      const isHomeRoot = currentPath === '/home' || currentPath === '/';

      if (canGoBack && !isHomeRoot) {
        history.goBack();
        return;
      }

      setShowExitAlert(true);
    });

    return () => {
      void backButtonListener.then((listener) => listener.remove());
    };
  }, [history]);

  // ── profile ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && isAuthenticated && user?.uid) {
      const userRef = doc(firestore, 'users', user.uid);
      const unsubscribe = onSnapshot(userRef,
        (snapshot) => {
          if (!snapshot.exists()) return;
          const data = snapshot.data() as any;
          setProfilePic(data.img || '/assets/images/Temporary.png');
          const first = data.name?.firstname || data.nickname || '';
          setFirstName(first);
        },
        (error) => {
          console.error('[Home] user profile onSnapshot error:', error);
        }
      );
      return () => unsubscribe();
    }
  }, [authLoading, isAuthenticated, user?.uid]);

  // ── real-time destinations ───────────────────────────────────────────────
  // Both sections use the same collection, so derive them from one listener.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    const unsubscribe = subscribePopularDestinations((data) => {
      const destinations = data ?? [];
      setPopular(destinations);
      setRecommended(
        destinations
          .sort((a, b) => Number((b as any).recommended) - Number((a as any).recommended) || (b.rating || 0) - (a.rating || 0))
          .slice(0, 20),
      );
    });

    return () => unsubscribe();
  }, [authLoading, isAuthenticated]);

  // ── real-time visit ranks ────────────────────────────────────────────────
  // Listen to the visits collection live so the #rank ribbons update whenever
  // a new QR scan is recorded anywhere in the app.
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    const unsubscribe = onSnapshot(
      query(collection(firestore, 'visits'), limit(500)),
      (snap) => {
        const countMap = new Map<string, number>();
        snap.forEach(d => {
          const name: string = (d.data() as any).destinationTop ?? '';
          if (name) countMap.set(name, (countMap.get(name) ?? 0) + 1);
        });
        const ranked = Array.from(countMap.entries()).sort((a, b) => b[1] - a[1]);
        const rankMap = new Map<string, number>();
        ranked.forEach(([name], i) => rankMap.set(name, i + 1));
        setVisitRanks(rankMap);
      },
      (err) => console.error('[Home] visits onSnapshot error:', err),
    );

    return () => {
      unsubscribe();
    };
  }, [authLoading, isAuthenticated]);

  // ── real-time RTDB favorites listener ────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeFavoriteIds(user.uid, ids => setFavorites(ids));
    return () => unsub();
  }, [user?.uid]);

  // ── real-time notifications unread count ─────────────────────────────────
  useEffect(() => {
    if (!user?.uid) {
      setUnreadCount(0);
      return;
    }
    const unsub = subscribeNotifications(user.uid, (items) => {
      setUnreadCount(items.filter(n => n.unread).length);
    });
    return () => unsub();
  }, [user?.uid]);

  // ── Distance helper ────────────────────────────────────────────────────
  const getDistance = (dest: Destination): string => {
    const destLat: number | undefined =
      (dest as any).locationCoords?.lat ??
      (dest as any).location?.lat ??
      (dest as any).location?.latitude ??
      (dest as any).lat ?? undefined;
    const destLng: number | undefined =
      (dest as any).locationCoords?.lng ??
      (dest as any).location?.lng ??
      (dest as any).location?.longitude ??
      (dest as any).lng ?? undefined;

    if (coords && destLat != null && destLng != null) {
      return formatDistance(coords.latitude, coords.longitude, destLat, destLng);
    }
    const stored = (dest as any).distance;
    return stored && stored !== 'Unknown' ? stored : '—';
  };

  const topPopular = useMemo(() => {
    return [...popular].sort((a, b) => {
      const rankA = visitRanks.get(a.title || a.name || '') ?? Infinity;
      const rankB = visitRanks.get(b.title || b.name || '') ?? Infinity;
      if (rankA !== rankB) return rankA - rankB;
      return (b.rating || 0) - (a.rating || 0);
    });
  }, [popular, visitRanks]);

  const handleFavoriteToggle = async (dest: Destination, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.uid) return;
    const currentlyFav = favorites.has(dest.id);
    setFavorites(prev => {
      const next = new Set(prev);
      currentlyFav ? next.delete(dest.id) : next.add(dest.id);
      return next;
    });
    try {
      await toggleFavorite(user.uid, dest, currentlyFav);
    } catch (err) {
      setFavorites(prev => {
        const next = new Set(prev);
        currentlyFav ? next.add(dest.id) : next.delete(dest.id);
        return next;
      });
      console.error('Favorite toggle failed', err);
    }
  };

  const handleDestinationClick = (dest: Destination) =>
    history.push(`/destination/${dest.id}`, dest);

  /** Navigate to Maps when the user taps or types in the searchbar */
  const goToMaps = () => history.push('/maps');

  // ── AI FAB: tap = open AI Guide, long-press = start a normal AI conversation ──
  const LONG_PRESS_MS = 600;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const handleAiPressStart = (e: React.PointerEvent) => {
    // Stops the browser from treating a held-down touch as the start of a
    // scroll/drag/callout gesture. Left unhandled, that native gesture fires
    // pointercancel well before LONG_PRESS_MS elapses, so the timer below
    // never gets to run — every press resolves as a tap no matter how long
    // you actually hold it.
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    longPressFiredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      triggerGeneric();
    }, LONG_PRESS_MS);
  };

  const clearAiPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleAiClick = () => {
    // If the long-press already fired, swallow the click that follows
    // the pointer-up instead of also navigating to /ai-guide.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    history.push('/ai-guide');
  };

  return (
    <IonPage>
      {/* ── Header ── */}
      <IonHeader className="header">
        <IonToolbar className="top-bar">
          <IonButtons slot="start" className="left-icons">
            <IonButton fill="clear" aria-label="Notifications"
              onClick={() => history.push('/notifications')}>
              {unreadCount > 0 && <span className="notification-badge" />}
              <IonIcon icon={notifications} />
            </IonButton>
          </IonButtons>

          {/* Tapping the searchbar navigates to Maps */}
          <div
            className="main-search-tap-area"
            onClick={goToMaps}
            role="button"
            aria-label="Search destinations"
          >
            <IonSearchbar
              className="main-search"
              placeholder="Search destinations…"
              searchIcon={search}
            />
          </div>

          <IonButtons slot="end" className="right-icons">
            <IonButton fill="clear" aria-label="Profile" onClick={() => history.push('/Settings')}>
              <div className="profile-pic-container">
                {profilePic
                  ? <IonAvatar className="profile-pic">
                      <img src={profilePic} alt="Profile" />
                    </IonAvatar>
                  : <IonIcon icon={personCircle} className="default-profile-icon" />}
              </div>
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      {isOffline && (
        <div className="offline-banner" role="status" aria-live="polite">
          <IonIcon icon={cloudOfflineOutline} />
          <span>You're offline — showing saved content. Some info may be out of date.</span>
        </div>
      )}

      <IonContent fullscreen>
        {/* AI guide FAB — tap opens AI Guide, long-press (600ms) starts a normal AI conversation */}
        <div className="ai-nav-button" role="button"
          aria-label="Open AI Guide (long-press to start a normal AI conversation)"
          onClick={handleAiClick}
          onPointerDown={handleAiPressStart}
          onPointerUp={clearAiPressTimer}
          onPointerLeave={clearAiPressTimer}
          onPointerCancel={clearAiPressTimer}
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: 'none' }}>
          <IonImg src="/assets/images/AI/ALI 3.png" draggable={false} />
        </div>

        {/* ── Recommended ── */}
        <section className="section">
          <div className="section-header">
            <h2>Recommended for You</h2>
            <IonButton fill="clear" className="view-all"
              onClick={() => history.push('/recommended')}>
              See All
            </IonButton>
          </div>

          <div className="horizontal-scroll">
            {recommended.length === 0 ? (
              <p className="no-data-message">No recommendations yet.</p>
            ) : recommended
                .filter(place =>
                  (place as any).status !== 'Temporarily Closed' &&
                  (place as any).tempStatus !== 'Temporarily Closed'
                )
                .map(place => (
              <IonCard key={place.id} className="recommend-card"
                onClick={() => handleDestinationClick(place)}>
                <div className="image-container">
                  <IonImg src={place.imageUrl || place.image} alt={place.title || place.name} />
                  {place.category && <span className="card-category-tag">{place.category}</span>}
                </div>
                <div className="card-body">
                  <div className="card-location">
                    <IonIcon icon={location} />
                    <span className="location-text">{place.address}</span>
                  </div>
                  <h3 className="card-title">{place.title || place.name}</h3>
                  <p className="card-desc">{truncate((place as any).shortDescription || (place as any).fullDescription || place.desc || '')}</p>
                  <div className="meta-row">
                    <div className="rating">
                      <IonIcon icon={star} />
                      <span>{place.rating || '0'}</span>
                    </div>
                    <span className="dot">•</span>
                    <span className="distance">{getDistance(place)}</span>
                  </div>
                </div>
              </IonCard>
            ))}
          </div>
        </section>

        {/* ── Popular ── */}
        <section className="section">
          <div className="section-header">
            <h2>Popular Destinations</h2>
            <IonButton fill="clear" className="view-all"
              onClick={() => history.push('/popular')}>
              View All
            </IonButton>
          </div>

          <IonGrid className="popular-grid">
            <IonRow>
              {popular.length === 0 ? (
                <p className="no-data-message">
                  No popular destinations yet.
                </p>
              ) : topPopular.slice(0, 5).map(dest => {
                const d = dest as any;
                return (
                  <IonCol key={dest.id} size="6" size-md="10" size-lg="3">
                    <div
                      className={`popular-card${(d.status === 'Temporarily Closed' || d.tempStatus === 'Temporarily Closed') ? ' card-closed' : ''}`}
                      role="button"
                      aria-label={`View ${dest.title || dest.name}`}
                      onClick={() => handleDestinationClick(dest)}
                    >
                      <div className="image-container">
                        <IonImg src={dest.imageUrl || dest.image} alt={dest.title || dest.name} />
                        {(d.status === 'Temporarily Closed' || d.tempStatus === 'Temporarily Closed') && (
                          <div className="card-closed-overlay">
                            <span className="card-closed-label">Temporarily Closed</span>
                          </div>
                        )}
                        <div
                          className="heart-icon"
                          role="button"
                          aria-label={favorites.has(dest.id) ? 'Remove from favorites' : 'Add to favorites'}
                          onClick={e => handleFavoriteToggle(dest, e)}
                        >
                          <IonIcon icon={favorites.has(dest.id) ? heart : heartOutline} />
                        </div>
                        {(() => {
                          const name  = dest.title || dest.name || '';
                          const rank  = visitRanks.get(name);
                          return rank ? <div className="ribbon">#{rank}</div> : null;
                        })()}
                      </div>
                      <div className="card-info">
                        <h4>{dest.title || dest.name}</h4>
                        <div className="rating">
                          <IonIcon icon={star} />
                          <span>{dest.rating || '0'}</span>
                          {dest.reviews && <span className="review-count">({dest.reviews})</span>}
                        </div>
                        <div className="distance">
                          <IonIcon icon={location} />
                          <span>{getDistance(dest)}</span>
                        </div>
                      </div>
                    </div>
                  </IonCol>
                );
              })}
            </IonRow>
          </IonGrid>
        </section>

        <IonAlert
          isOpen={showExitAlert}
          header="Exit application?"
          message="Do you want to exit the application?"
          buttons={[
            { text: 'No', role: 'cancel', handler: () => setShowExitAlert(false) },
            {
              text: 'Yes',
              handler: async () => {
                setShowExitAlert(false);
                if (Capacitor.isNativePlatform()) {
                  await App.exitApp();
                  return;
                }
                window.close();
              },
            },
          ]}
        />

        <IonToast
          isOpen={!!toastMsg}
          message={toastMsg}
          duration={2000}
          position="bottom"
          onDidDismiss={() => setToastMsg('')}
        />
      </IonContent>
    </IonPage>
  );
};

export default Home;