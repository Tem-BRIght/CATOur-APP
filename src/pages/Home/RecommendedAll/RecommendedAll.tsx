// src/pages/Home/RecommendedAll/RecommendedAll.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  IonPage, IonContent, IonHeader, IonToolbar,
  IonButtons, IonBackButton, IonTitle,
  IonSearchbar, IonIcon, IonImg, IonToast, IonSpinner,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { star, location, heart, heartOutline, funnelOutline, close } from 'ionicons/icons';
import { useAuth } from '../../../context/AuthContext';
import { fetchRecommendedDestinations } from '../../../services/destinationService';
import { toggleFavorite, subscribeFavoriteIds } from '../../../services/favoritesService';
import { useUserLocation } from '../../../services/useUserLocation';
import { formatDistance } from '../../../services/distance';
import { Destination } from '../../../types';
import './RecommendedAll.css';

const CATEGORIES = ['All', 'Park', 'Museum', 'Church', 'Mall', 'Market', 'Heritage', 'Nature'];

const truncate = (text = '', max = 80) =>
  text.length <= max ? text : text.slice(0, max) + '…';

const RecommendedAll: React.FC = () => {
  const history = useHistory();
  const { user } = useAuth();
  const { coords } = useUserLocation();

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading]           = useState(true);
  const [favorites, setFavorites]       = useState<Set<string>>(new Set());
  const [toastMsg, setToastMsg]         = useState('');
  const [searchText, setSearchText]     = useState('');
  const [sortBy, setSortBy]             = useState<'rating' | 'distance' | 'name'>('rating');
  const [showSort, setShowSort]         = useState(false);

  // ── Load destinations ────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchRecommendedDestinations();
        setDestinations(
          (data ?? []).filter(
            d => (d as any).status !== 'Temporarily Closed' &&
                 (d as any).tempStatus !== 'Temporarily Closed'
          )
        );
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

  // ── Distance in km for sorting ────────────────────────────────────────────
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

    // search
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      list = list.filter(
        d =>
          (d.title || d.name || '').toLowerCase().includes(q) ||
          (d.address || '').toLowerCase().includes(q) ||
          (d.category || '').toLowerCase().includes(q)
      );
    }


    // sort
    if (sortBy === 'rating')   list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (sortBy === 'distance') list.sort((a, b) => getDistanceKm(a) - getDistanceKm(b));
    if (sortBy === 'name')     list.sort((a, b) => (a.title || a.name || '').localeCompare(b.title || b.name || ''));

    return list;
  }, [destinations, searchText, sortBy, coords]);

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
    rating: 'Top Rated',
    distance: 'Nearest',
    name: 'A – Z',
  };

  return (
    <IonPage className="rec-all-page">
      <IonHeader className="rec-all-header">
        <IonToolbar className="rec-all-toolbar">
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" className="rec-back-btn" />
          </IonButtons>
          <IonTitle className="rec-all-title">Recommended</IonTitle>

          {/* Sort button */}
          <IonButtons slot="end">
            <button
              className="rec-sort-btn"
              onClick={() => setShowSort(v => !v)}
              aria-label="Sort options"
            >
              <IonIcon icon={funnelOutline} />
              <span>{sortLabels[sortBy]}</span>
            </button>
          </IonButtons>
        </IonToolbar>

        {/* Search bar */}
        <div className="rec-search-wrap">
          <IonSearchbar
            className="rec-searchbar"
            placeholder="Search recommended places…"
            value={searchText}
            onIonInput={e => setSearchText(e.detail.value ?? '')}
            debounce={200}
          />
        </div>
      </IonHeader>

      {/* Sort dropdown */}
      {showSort && (
        <div className="rec-sort-dropdown">
          {(['rating', 'distance', 'name'] as const).map(opt => (
            <button
              key={opt}
              className={`rec-sort-option${sortBy === opt ? ' active' : ''}`}
              onClick={() => { setSortBy(opt); setShowSort(false); }}
            >
              {sortLabels[opt]}
            </button>
          ))}
          <button className="rec-sort-close" onClick={() => setShowSort(false)}>
            <IonIcon icon={close} />
          </button>
        </div>
      )}

      <IonContent className="rec-all-content">
        {loading ? (
          <div className="rec-loading">
            <IonSpinner name="crescent" />
            <p>Finding great places…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rec-empty">
            <p>No destinations found.</p>
          </div>
        ) : (
          <div className="rec-list">
            <p className="rec-count">{filtered.length} place{filtered.length !== 1 ? 's' : ''}</p>
            {filtered.map(dest => {
              const isFav = favorites.has(dest.id);
              return (
                <div
                  key={dest.id}
                  className="rec-row-card"
                  role="button"
                  onClick={() => handleDestinationClick(dest)}
                >
                  {/* Image */}
                  <div className="rec-row-img-wrap">
                    <IonImg src={dest.imageUrl || dest.image} alt={dest.title || dest.name} />
                    {dest.category && (
                      <span className="rec-row-category">{dest.category}</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="rec-row-info">
                    <div className="rec-row-top">
                      <h3 className="rec-row-title">{dest.title || dest.name}</h3>
                      <button
                        className="rec-row-heart"
                        aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={e => handleFavoriteToggle(dest, e)}
                      >
                        <IonIcon icon={isFav ? heart : heartOutline} />
                      </button>
                    </div>

                    <div className="rec-row-address">
                      <IonIcon icon={location} />
                      <span>{dest.address || '—'}</span>
                    </div>

                    <p className="rec-row-desc">
                      {truncate((dest as any).shortDescription || (dest as any).desc || '')}
                    </p>

                    <div className="rec-row-meta">
                      <div className="rec-row-rating">
                        <IonIcon icon={star} />
                        <span>{dest.rating || '0'}</span>
                        {dest.reviews ? <span className="rec-reviews">({dest.reviews})</span> : null}
                      </div>
                      <span className="rec-dot">•</span>
                      <span className="rec-dist">{getDistance(dest)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
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

export default RecommendedAll;
