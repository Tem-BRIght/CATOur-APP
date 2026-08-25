import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IonPage, IonIcon, IonSpinner } from '@ionic/react';
import {
  arrowBack,
  close,
  locationOutline,
  searchOutline,
  star,
  
} from 'ionicons/icons';
import { useHistory, useLocation } from 'react-router-dom';
import './maps.css';

import { LoadScript, GoogleMap, MarkerF, InfoWindow } from '@react-google-maps/api';

import { fetchDestinationById, fetchDestinations } from '../../services/destinationService';
import { useUserLocation } from '../../services/useUserLocation';
import { formatDistance } from '../../services/distance';
// routingService walking/directions helpers removed from this file
import { getCurrentWeather, getWeatherEmoji, CurrentWeather } from '../../services/weatherService';
import { Destination } from '../../types';

// ── Helper: resolve lat/lng from any known Firestore shape ────────────────
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

const MapPage: React.FC<{ destinationId?: string }> = ({ destinationId }) => {
  const history = useHistory();
  const routerLocation = useLocation();
  const { coords } = useUserLocation();

  const mapRef = useRef<google.maps.Map | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({ lat: 14.5995, lng: 120.9842 });
  const [mapZoom, setMapZoom] = useState(13);
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadError, setMapLoadError] = useState(false);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // Guards against auto-routing to the same ?dest= id more than once per visit.
  const autoRoutedDestId = useRef<string | null>(null);
  // ── Blur-close timeout handle — cleared if user taps a result ────────────
  const blurTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchQuery,     setSearchQuery]     = useState('');
  const [allDestinations, setAllDestinations] = useState<Destination[]>([]);
  const [searchResults,   setSearchResults]   = useState<Destination[]>([]);
  const [selectedDest,    setSelectedDest]    = useState<Destination | null>(null);
  const [error,           setError]           = useState<string | null>(null);
  const [isSearching,     setIsSearching]     = useState(false);
  // ── Panel visible = input is focused. Managed via focus/blur events. ──────
  const [panelOpen,       setPanelOpen]       = useState(false);
  // ── Keyboard-focused result index (-1 = none) ─────────────────────────────
  const [focusedIndex,    setFocusedIndex]    = useState(-1);

  // walking-directions removed
  // ── NEW: weather for whatever destination is currently selected ──────────
  const [destWeather,     setDestWeather]     = useState<CurrentWeather | null>(null);

  // ── Fetch all destinations on mount ──────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        setAllDestinations(await fetchDestinations());
      } catch (err) {
        console.error('Failed to load destinations:', err);
        setError('Failed to load destinations.');
      }
    };
    load();
  }, []);

  // ── Search logic ──────────────────────────────────────────────────────────
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      setFocusedIndex(-1);
      return;
    }
    setIsSearching(true);
    setFocusedIndex(-1);
    const timer = setTimeout(() => {
      const filtered = allDestinations.filter(d =>
        (d.title || d.name || '').toLowerCase().includes(q) ||
        (d.address || '').toLowerCase().includes(q) ||
        (d.category || '').toLowerCase().includes(q)
      );
      setSearchResults(filtered);
      setIsSearching(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, allDestinations]);

  // ── Auto-scroll focused item into view ───────────────────────────────────
  useEffect(() => {
    if (focusedIndex < 0 || !resultsRef.current) return;
    const items = resultsRef.current.querySelectorAll<HTMLElement>('.result-item');
    items[focusedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  // ── Close panel — single source of truth ─────────────────────────────────
  const closePanel = useCallback(() => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setPanelOpen(false);
    setFocusedIndex(-1);
    inputRef.current?.blur();
  }, []);

  // ── Open panel on any input change (empty query = show all destinations) ──
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    setPanelOpen(true);
    if (!val.trim()) setSelectedDest(null);
  };

  // ── Keyboard navigation inside the search input ───────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!panelOpen || isSearching) return;

    const displayedList = searchQuery.trim() ? searchResults : allDestinations;

    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(i => Math.min(i + 1, displayedList.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(i => Math.max(i - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const target = focusedIndex >= 0
        ? displayedList[focusedIndex]
        : displayedList[0];
      if (target) flyToDestination(target);
      return;
    }
  };

  // ── Distance helper ───────────────────────────────────────────────────────
  const getDistance = (dest: Destination): string => {
    const c = resolveCoords(dest);
    if (coords && c) {
      return formatDistance(coords.latitude, coords.longitude, c.lat, c.lng);
    }
    const stored = ((dest as unknown) as { distance?: string }).distance;
    return stored && stored !== 'Unknown' ? stored : '—';
  };



  const handleMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setMapReady(true);
    if (coords) {
      const position = { lat: coords.latitude, lng: coords.longitude };
      map.panTo(position);
      setMapCenter(position);
    }
  }, [coords]);

  useEffect(() => {
    if (!coords) return;
    const position = { lat: coords.latitude, lng: coords.longitude };
    setMapCenter(position);
    if (mapRef.current) {
      mapRef.current.panTo(position);
      mapRef.current.setZoom(13);
    }
  }, [coords]);

  

  // ── NEW: weather for the selected destination ─────────────────────────────
  useEffect(() => {
    if (!selectedDest) {
      setDestWeather(null);
      return;
    }
    const c = resolveCoords(selectedDest);
    let cancelled = false;
    getCurrentWeather(c?.lat, c?.lng).then(w => {
      if (!cancelled) setDestWeather(w);
    });
    return () => { cancelled = true; };
  }, [selectedDest]);

  // ── Init Google Map — once the API is loaded and the component mounts ──────────
  useEffect(() => {
    if (!mapRef.current) return;
    setMapReady(true);
  }, []);

  useEffect(() => {
    if (mapReady) return;
    const timer = window.setTimeout(() => setMapLoadError(true), 12000);
    return () => window.clearTimeout(timer);
  }, [mapReady]);

  const retryMap = () => {
    setMapLoadError(false);
    window.location.reload();
  };

  const handleMarkerClick = (dest: Destination) => {
    const destCoords = resolveCoords(dest);
    if (destCoords && mapRef.current) {
      mapRef.current.panTo(destCoords);
      mapRef.current.setZoom(16);
      setMapCenter(destCoords);
    }
    setSelectedDest(dest);
    setSelectedMarkerId(dest.id ?? `${dest.title || dest.name}`);
    setPanelOpen(false);
    setFocusedIndex(-1);
  };

  const handleMapClick = () => {
    if (document.activeElement !== inputRef.current) {
      setPanelOpen(false);
      setFocusedIndex(-1);
      setSelectedMarkerId(null);
    }
  };

  const displayedDestinations = searchResults.length > 0 ? searchResults : allDestinations;

  // ── Fly to destination ────────────────────────────────────────────────────
  // Always closes the panel and shows the bottom card regardless of whether
  // the destination has GPS coordinates.
  const flyToDestination = (dest: Destination) => {
    const c = resolveCoords(dest);
    if (c && mapRef.current) {
      mapRef.current.panTo(c);
      mapRef.current.setZoom(16);
      setMapCenter(c);
    }
    setPanelOpen(false);
    setFocusedIndex(-1);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedDest(dest);
    // Update the URL so the current selection is shareable/deep-linkable
    try {
      history.replace(`/maps?dest=${encodeURIComponent(dest.id)}`);
    } catch (e) {
      // ignore
    }
  };

  const handleGoClick = (dest: Destination) =>
    history.push(`/destination/${dest.id}`, dest);

  const clearSearch = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedDest(null);
    setPanelOpen(false);
    setFocusedIndex(-1);
    try { history.replace('/maps'); } catch (e) { }
  };

  const loadDestinationById = useCallback(async (destinationId: string): Promise<Destination | null> => {
    let dest = allDestinations.find(d => d.id === destinationId);
    if (dest) return dest;

    try {
      const fetched = await fetchDestinationById(destinationId);
      if (fetched) {
        setAllDestinations(prev => {
          if (prev.some(item => item.id === fetched.id)) return prev;
          return [...prev, fetched];
        });
        return fetched;
      }
    } catch (err) {
      console.error('[MapPage] loadDestinationById failed:', err);
    }

    return null;
  }, [allDestinations]);

  // ── NEW: deep-link support — /maps?dest=<id> auto-selects and draws the
  // walking route the instant destinations + map are ready. This is the
  // hook ALI's chat uses: when a tourist asks "how do I get there", the AI
  // reply can include a button that does
  //   history.push(`/maps?dest=${destination.id}`)
  // and lands here already routed, instead of the tourist re-searching for
  // the place themselves.
  useEffect(() => {
    if (!mapReady) return;
    const params = new URLSearchParams(routerLocation.search);
    const destId = destinationId || params.get('dest');
    if (!destId || autoRoutedDestId.current === destId) return;

    let isMounted = true;
    void (async () => {
      const dest = await loadDestinationById(destId);
      if (!isMounted) return;
      if (!dest) {
        setError('Unable to load the requested destination.');
        return;
      }

      setError(null);
      autoRoutedDestId.current = destId;
      flyToDestination(dest);
    })();

    return () => { isMounted = false; };
  }, [mapReady, destinationId, routerLocation.search, loadDestinationById, flyToDestination]);

  return (
    <IonPage>
      <div className="map-page-wrapper">

          <div className="map-container">
            <LoadScript
              googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
              loadingElement={
                <div className="map-loading">
                  <IonSpinner name="crescent" />
                  <p>Loading map...</p>
                </div>
              }
              onError={() => setMapLoadError(true)}
            >
              <GoogleMap
                mapContainerStyle={{ height: '100%', width: '100%' }}
                center={mapCenter}
                zoom={mapZoom}
                options={{
                  disableDefaultUI: true,
                  zoomControl: true,
                  streetViewControl: false,
                  fullscreenControl: true,
                  gestureHandling: 'greedy',
                  styles: [
                    {
                      featureType: 'poi',
                      stylers: [{ visibility: 'off' }],
                    },
                  ],
                }}
                onLoad={handleMapLoad}
                onClick={handleMapClick}
              >
                {coords && (
                  <MarkerF
                    position={{ lat: coords.latitude, lng: coords.longitude }}
                    icon={{
                      path: 0 as google.maps.SymbolPath,
                      scale: 8,
                      fillColor: '#1a8fe3',
                      fillOpacity: 1,
                      strokeColor: '#fff',
                      strokeWeight: 2,
                    }}
                  />
                )}

                {displayedDestinations.map((dest) => {
                  const c = resolveCoords(dest);
                  if (!c) return null;
                  return (
                    <MarkerF
                      key={dest.id}
                      position={c}
                      onClick={() => handleMarkerClick(dest)}
                    />
                  );
                })}

                {selectedDest && selectedMarkerId && resolveCoords(selectedDest) && (
                  <InfoWindow
                    position={resolveCoords(selectedDest)!}
                    onCloseClick={() => setSelectedMarkerId(null)}
                  >
                    <div className="map-info-window">
                      <strong>{selectedDest.title || selectedDest.name}</strong>
                      {selectedDest.address && <p>{selectedDest.address}</p>}
                      {selectedDest.rating && <p>★ {selectedDest.rating}</p>}
                    </div>
                  </InfoWindow>
                )}

                
              </GoogleMap>
            </LoadScript>
            {mapLoadError && !mapReady && (
              <div className="map-loading map-load-error">
                <p>Map unavailable on this connection.</p>
                <button type="button" onClick={retryMap}>Retry map</button>
              </div>
            )}
          </div>

          <div className="map-ui-layer">

            {/* ── Search wrapper: header + floating results panel ── */}
            <div className="map-search-wrapper">

            {/* ── Header ── */}
            <div className="map-header">
              <button
                className="map-back-btn"
                onClick={() => history.goBack()}
                aria-label="Back"
              >
                <IonIcon icon={arrowBack} />
              </button>

              <div className="map-search-bar">
                <IonIcon icon={searchOutline} className="map-search-icon" />
                <input
                  name="map-search"
                  ref={inputRef}
                  autoFocus
                  className="map-search-input"
                  placeholder="Search destinations..."
                  value={searchQuery}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => {
                    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
                    setPanelOpen(true);
                  }}
                  onBlur={() => {
                    blurTimerRef.current = setTimeout(() => setPanelOpen(false), 180);
                  }}
                  aria-label="Search destinations"
                  aria-autocomplete="list"
                  aria-expanded={panelOpen}
                />
              </div>

              {searchQuery.length > 0 && (
                <button
                  className="map-clear-btn"
                  onClick={clearSearch}
                  aria-label="Clear search"
                >
                  <IonIcon icon={close} />
                </button>
              )}
            </div>

            {/* ── Search results panel ── */}
            {panelOpen && (() => {
              const hasQuery      = searchQuery.trim().length > 0;
              const displayedList = hasQuery ? searchResults : allDestinations;
              const isNoResults   = hasQuery && !isSearching && displayedList.length === 0;

              return (
                <div
                  ref={resultsRef}
                  className="search-results-panel open"
                  role="listbox"
                  onMouseDown={e => e.preventDefault()}
                  onPointerDown={() => {
                    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
                  }}
                >
                  {isSearching && (
                    <div className="search-loading">
                      <div className="shimmer-row" />
                      <div className="shimmer-row short" />
                    </div>
                  )}

                  {!isSearching && displayedList.length > 0 && (
                    <div className="results-count">
                      {hasQuery
                        ? `${displayedList.length} destination${displayedList.length !== 1 ? 's' : ''} found`
                        : `All destinations (${displayedList.length})`}
                    </div>
                  )}

                  {!isSearching && displayedList.map((dest, idx) => (
                    <div
                      key={dest.id}
                      role="option"
                      aria-selected={focusedIndex === idx}
                      className={`result-item ${focusedIndex === idx ? 'keyboard-focus' : ''} ${selectedDest?.id === dest.id ? 'active' : ''}`}
                      onMouseEnter={() => setFocusedIndex(idx)}
                      onClick={() => flyToDestination(dest)}
                    >
                      <div className="result-pin-icon">
                        <IonIcon icon={locationOutline} />
                      </div>
                      <div className="result-info">
                        <div className="result-name">{dest.title || dest.name}</div>
                        <div className="result-addr">{dest.address}</div>
                      </div>
                      <div className="result-dist">{getDistance(dest)}</div>
                    </div>
                  ))}

                  {isNoResults && (
                    <div className="no-results">
                      <IonIcon icon={searchOutline} />
                      <p>No results for "<strong>{searchQuery}</strong>"</p>
                      <span className="no-results-hint">Try a name, address, or category</span>
                    </div>
                  )}
                </div>
              );
            })()}

            </div>{/* end .map-search-wrapper */}

            {/* ── Error ── */}
            {error && <div className="map-error"><p>{error}</p></div>}

            {/* ── Selected destination card ── */}
            {selectedDest && !panelOpen && (
              <div className="dest-bottom-card">
                <img
                  className="dest-card-img"
                  src={(selectedDest as any).imageUrl || (selectedDest as any).image}
                  alt={selectedDest.title || selectedDest.name}
                  onClick={() => handleGoClick(selectedDest)}
                />
                <div className="dest-card-info" onClick={() => handleGoClick(selectedDest)}>
                  <p className="dest-card-name">{selectedDest.title || selectedDest.name}</p>
                  <p className="dest-card-addr">
                    <IonIcon icon={locationOutline} />
                    {selectedDest.address}
                  </p>
                  <div className="dest-card-meta">
                    {selectedDest.rating && (
                      <span className="dest-card-rating">
                        <IonIcon icon={star} /> {selectedDest.rating}
                      </span>
                    )}
                    <span className="dest-card-dist">{getDistance(selectedDest)}</span>
                    {destWeather && (
                      <span className="dest-card-dist" title={destWeather.condition}>
                        {getWeatherEmoji(destWeather.weatherCode)} {destWeather.temperatureC}°C
                        {destWeather.willRainSoon && !destWeather.isRainingOrStorming && ' · rain soon'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>{/* end .map-ui-layer */}
      </div>
    </IonPage>
  );
};

export default MapPage;
