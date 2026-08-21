// src/pages/Home/PopularAll/PopularAll.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  IonPage, IonContent, IonHeader, IonToolbar,
  IonButtons, IonBackButton, IonTitle,
  IonSearchbar, IonIcon, IonImg, IonToast, IonSpinner,
  IonGrid, IonRow, IonCol,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { firestore } from '../../../firebase';
import {
  star, location, heart, heartOutline, funnelOutline, close,
} from 'ionicons/icons';
import { useAuth } from '../../../context/AuthContext';
import { fetchPopularDestinations } from '../../../services/destinationService';
import { toggleFavorite, subscribeFavoriteIds } from '../../../services/favoritesService';
import { useUserLocation } from '../../../services/useUserLocation';
import { formatDistance } from '../../../services/distance';
import { Destination } from '../../../types';
import './PopularAll.css';

const CATEGORIES = ['All', 'Park', 'Museum', 'Church', 'Mall', 'Market', 'Heritage', 'Nature'];

const PopularAll: React.FC = () => {
  const history = useHistory();
  const { user } = useAuth();
  const { coords } = useUserLocation();

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading]           = useState(true);
  const [favorites, setFavorites]       = useState<Set<string>>(new Set());
  const [visitRanks, setVisitRanks]     = useState<Map<string, number>>(new Map());
  const [toastMsg, setToastMsg]         = useState('');
  const [searchText, setSearchText]     = useState('');
  const [sortBy, setSortBy]             = useState<'popular' | 'rating' | 'distance' | 'name'>('popular');
  const [showSort, setShowSort]         = useState(false);

  // ── Load destinations + visit ranks ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [data, visitsSnap] = await Promise.all([
          fetchPopularDestinations(),
          getDocs(collection(firestore, 'visits')),
        ]);

        setDestinations(data ?? []);

        // Build rank map
        const countMap = new Map<string, number>();
        visitsSnap.forEach(d => {
          const name: string = (d.data() as any).destinationTop ?? '';
          if (name) countMap.set(name, (countMap.get(name) ?? 0) + 1);
        });
        const ranked = Array.from(countMap.entries()).sort((a, b) => b[1] - a[1]);
        const rankMap = new Map<string, number>();
        ranked.forEach(([name], i) => rankMap.set(name, i + 1));
        setVisitRanks(rankMap);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Real-time favorites ──────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeFavoriteIds(user.uid, ids => setFavorites(ids));
    return () => unsub();
  }, [user?.uid]);

  // ── Distance helper ──────────────────────────────────────────────────────
  const getDistance = (dest: Destination): string => {
    const d = dest as any;
    const lat = d.locationCoords?.lat ?? d.location?.lat ?? d.location?.latitude ?? d.lat;
    const lng = d.locationCoords?.lng ?? d.location?.lng ?? d.location?.longitude ?? d.lng;
    if (coords && lat != null && lng != null)
      return formatDistance(coords.latitude, coords.longitude, lat, lng);
    const stored = d.distance;
    return stored && stored !== 'Unknown' ? stored : '—';
  };

  const getDistanceKm = (dest: Destination): number => {
    const d = dest as any;
    const lat = d.locationCoords?.lat ?? d.location?.lat ?? d.location?.latitude ?? d.lat;
    const lng = d.locationCoords?.lng ?? d.location?.lng ?? d.location?.longitude ?? d.lng;
    if (coords && lat != null && lng != null) {
      const R = 6371;
      const dLat = ((lat - coords.latitude) * Math.PI) / 180;
      const dLng = ((lng - coords.longitude) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((coords.latitude * Math.PI) / 180) *
        Math.cos((lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    return Infinity;
  };

  // ── Filtered + sorted list ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...destinations];

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      list = list.filter(
        d =>
          (d.title || d.name || '').toLowerCase().includes(q) ||
          (d.address || '').toLowerCase().includes(q) ||
          (d.category || '').toLowerCase().includes(q)
      );
    }

    if (sortBy === 'popular') {
      // Sort by visit rank first (ranked = most visited), then by rating
      list.sort((a, b) => {
        const rankA = visitRanks.get(a.title || a.name || '') ?? Infinity;
        const rankB = visitRanks.get(b.title || b.name || '') ?? Infinity;
        if (rankA !== rankB) return rankA - rankB;
        return (b.rating || 0) - (a.rating || 0);
      });
    }
    if (sortBy === 'rating')   list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (sortBy === 'distance') list.sort((a, b) => getDistanceKm(a) - getDistanceKm(b));
    if (sortBy === 'name')     list.sort((a, b) => (a.title || a.name || '').localeCompare(b.title || b.name || ''));

    return list;
  }, [destinations, searchText, sortBy, visitRanks, coords]);

  // ── Favorite toggle ──────────────────────────────────────────────────────
  const handleFavoriteToggle = async (dest: Destination, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.uid) return;
    const wasFav = favorites.has(dest.id);
    setFavorites(prev => {
      const next = new Set(prev);
      wasFav ? next.delete(dest.id) : next.add(dest.id);
      return next;
    });
    try {
      await toggleFavorite(user.uid, dest, wasFav);
      setToastMsg(wasFav ? 'Removed from Favorites' : '❤️ Added to Favorites');
    } catch {
      setFavorites(prev => {
        const next = new Set(prev);
        wasFav ? next.add(dest.id) : next.delete(dest.id);
        return next;
      });
    }
  };

  const handleDestinationClick = (dest: Destination) =>
    history.push(`/destination/${dest.id}`, dest);

  const sortLabels: Record<string, string> = {
    popular: 'Most Visited',
    rating: 'Top Rated',
    distance: 'Nearest',
    name: 'A – Z',
  };

  return (
    <IonPage className="pop-all-page">
      <IonHeader className="pop-all-header">
        <IonToolbar className="pop-all-toolbar">
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" className="pop-back-btn" />
          </IonButtons>
          <IonTitle className="pop-all-title">Popular Destinations</IonTitle>

          <IonButtons slot="end">
            <button
              className="pop-sort-btn"
              onClick={() => setShowSort(v => !v)}
              aria-label="Sort options"
            >
              <IonIcon icon={funnelOutline} />
              <span>{sortLabels[sortBy]}</span>
            </button>
          </IonButtons>
        </IonToolbar>

        {/* Search bar */}
        <div className="pop-search-wrap">
          <IonSearchbar
            className="pop-searchbar"
            placeholder="Search popular places…"
            value={searchText}
            onIonInput={e => setSearchText(e.detail.value ?? '')}
            debounce={200}
          />
        </div>
      </IonHeader>

      {/* Sort dropdown */}
      {showSort && (
        <div className="pop-sort-dropdown">
          {(['popular', 'rating', 'distance', 'name'] as const).map(opt => (
            <button
              key={opt}
              className={`pop-sort-option${sortBy === opt ? ' active' : ''}`}
              onClick={() => { setSortBy(opt); setShowSort(false); }}
            >
              {sortLabels[opt]}
            </button>
          ))}
          <button className="pop-sort-close" onClick={() => setShowSort(false)}>
            <IonIcon icon={close} />
          </button>
        </div>
      )}

      <IonContent className="pop-all-content">
        {loading ? (
          <div className="pop-loading">
            <IonSpinner name="crescent" />
            <p>Loading destinations…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="pop-empty">
            <p>No destinations found.</p>
          </div>
        ) : (
          <div className="pop-grid-wrap">
            <p className="pop-count">{filtered.length} destination{filtered.length !== 1 ? 's' : ''}</p>

            <IonGrid className="pop-grid">
              <IonRow>
                {filtered.map(dest => {
                  const d      = dest as any;
                  const isFav  = favorites.has(dest.id);
                  const name   = dest.title || dest.name || '';
                  const rank   = visitRanks.get(name);
                  const closed = d.status === 'Temporarily Closed' || d.tempStatus === 'Temporarily Closed';

                  return (
                    <IonCol key={dest.id} size="6" size-md="4" size-lg="3">
                      <div
                        className={`pop-card${closed ? ' pop-card-closed' : ''}`}
                        role="button"
                        aria-label={`View ${name}`}
                        onClick={() => handleDestinationClick(dest)}
                      >
                        {/* Image */}
                        <div className="pop-card-img-wrap">
                          <IonImg src={dest.imageUrl || dest.image} alt={name} />

                          {closed && (
                            <div className="pop-closed-overlay">
                              <span className="pop-closed-label">Temporarily Closed</span>
                            </div>
                          )}

                          {/* Heart */}
                          <button
                            className="pop-heart"
                            aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                            onClick={e => handleFavoriteToggle(dest, e)}
                          >
                            <IonIcon icon={isFav ? heart : heartOutline} />
                          </button>

                          {/* Rank ribbon */}
                          {rank ? (
                            <div className="pop-ribbon">#{rank}</div>
                          ) : null}

                          {/* Category tag */}
                          {dest.category && (
                            <span className="pop-category-tag">{dest.category}</span>
                          )}
                        </div>

                        {/* Info */}
                        <div className="pop-card-info">
                          <h4 className="pop-card-title">{name}</h4>

                          <div className="pop-card-rating">
                            <IonIcon icon={star} />
                            <span>{dest.rating || '0'}</span>
                            {dest.reviews ? (
                              <span className="pop-reviews">({dest.reviews})</span>
                            ) : null}
                          </div>

                          <div className="pop-card-dist">
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
          </div>
        )}

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

export default PopularAll;
