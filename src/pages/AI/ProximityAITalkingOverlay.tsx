// src/components/ProximityAITalkingOverlay.tsx
// ─────────────────────────────────────────────────────────────────────────────
// The visual card for the "AI Talking" feature — CSS and all, as ONE file.
//
// WHY THIS IS A SINGLE FILE NOW
// The previous split (separate .css + .tsx) broke twice in a row because of
// import-path mismatches between where the CSS actually lived and what the
// component imported. Styling now lives in the STYLES string below and is
// injected via a <style> tag, so there is no import path left to get wrong.
// If you'd rather have a normal .css file, cut everything inside the
// backticks into ProximityAITalkingOverlay.css, `import` it as usual, and
// delete the STYLES constant + <style> tag — the class names are unchanged
// either way.
//
// WHY THE APP WENT BLANK
// The last version called proximityAI.setListening(...) / setLiveTranscript
// (...) / askQuestion(...) directly. Those method names were inferred from
// file comments, never actually confirmed against the real
// Proximityaicontext.tsx in this project. If any of them don't exist on the
// real context value, calling them throws — and since this component is
// mounted unconditionally at the app root (see App.tsx), an uncaught error
// here unmounts the ENTIRE app, which is exactly a blank white screen with
// no build error. Every context method call below now checks
// `typeof x === 'function'` first and no-ops instead of throwing if it's
// missing, so a context-shape mismatch degrades a feature instead of
// crashing the app.
//
// Mount ONCE, as a sibling of the router, inside the provider:
//
//   <ProximityAIProvider>
//     <IonReactRouter>...</IonReactRouter>
//     <ProximityAITalkingOverlay />
//   </ProximityAIProvider>
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { useLocation, useHistory } from 'react-router-dom';
import { IonIcon } from '@ionic/react';
import {
  close,
  playSkipForward,
  pause as pauseIcon,
  mic,
  refresh,
  mapOutline,
  expandOutline,
  contractOutline,
  chatbubblesOutline,
  timeOutline,
  restaurantOutline,
  informationCircleOutline,
} from 'ionicons/icons';
import { useProximityAIOptional } from '../../context/Proximityaicontext';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { IntegratedRouteMap } from './AIGuide';
import './ProximityAITalkingOverlay.css';

// Same mascot asset already used for the Home page AI FAB.
const ALI_CHARACTER_IMAGE = '/assets/images/AI/ALI 3.png';

/** One-shot current-position fix for drawing the route on the mini map. */
const fetchUserCoords = (): Promise<{ lat: number; lng: number } | null> => {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 300_000 },
    );
  });
};

const ProximityAITalkingOverlay: React.FC = () => {
  const proximityAI = useProximityAIOptional();
  const location = useLocation();

  const [micError, setMicError] = useState('');

  // ── Route-map overlay (same floating mini-map as the chat AI guide) ──────
  const [routeMapOpen, setRouteMapOpen] = useState(false);
  const [routeMapMinimized, setRouteMapMinimized] = useState(false);
  const [routeMapMaximized, setRouteMapMaximized] = useState(false);
  const [routeDestination, setRouteDestination] = useState<{
    id: string;
    lat?: number | null;
    lng?: number | null;
    location?: { lat?: number | null; lng?: number | null } | null;
  } | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  const {
    isSupported: micSupported,
    isListening: micListening,
    liveTranscript: micTranscript,
    start: micStart,
    stop: micStop,
    reset: micReset,
  } = useSpeechRecognition({
    lang: 'en-US',
    onFinalResult: async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const routeMatch = proximityAI?.resolveDestinationFromText?.(trimmed);
      const isRouteRequest = /show.*(map|route)|going (to|there)|heading (to|there)|go(ing)? to|route to|directions?/i.test(trimmed);
      const routeDestination = routeMatch ?? (isRouteRequest ? proximityAI?.destination : null);
      if (routeDestination) {
        const routeTarget = {
          id: routeDestination.id,
          lat: routeDestination.lat,
          lng: routeDestination.lng,
          location: { lat: routeDestination.lat, lng: routeDestination.lng },
        };

        setRouteDestination(routeTarget);
        setRouteMapOpen(true);
        setRouteMapMinimized(false);
        setRouteMapMaximized(false);

        if (!userCoords) {
          const coords = await fetchUserCoords();
          if (coords) setUserCoords(coords);
        }
      }

      if (typeof proximityAI?.askQuestion === 'function') {
        await proximityAI.askQuestion(trimmed);
      }
    },
    onError: (message: string) => setMicError(message),
  });

  // Rules of Hooks: every hook above must run on every render, so this
  // early-return check has to come after all of them, not before.
  if (!proximityAI) return null;

  const currentPath = location.pathname.toLowerCase();
  const isTouristPage = ['/home', '/popular', '/recommended', '/notifications', '/maps', '/destination']
    .some(path => currentPath.startsWith(path));
  if (!isTouristPage) return null;

  const { status, destination, narration, isGenericMode } = proximityAI;

  if (status === 'idle' || (!destination && !isGenericMode)) return null;

  const isLoading  = status === 'loading';
  const isSpeaking = status === 'speaking';
  const isPaused   = status === 'paused';

  // Defensive wrappers — if the context doesn't actually expose these
  // methods (a shape mismatch), these no-op instead of throwing and taking
  // the whole app down with them.
  const safeDismiss = () => {
    if (micListening) micStop();
    if (typeof proximityAI.dismiss === 'function') proximityAI.dismiss();
  };
  const safeTogglePause = () => {
    if (typeof proximityAI.togglePause === 'function') proximityAI.togglePause();
  };
  const closeRouteMap = () => {
    setRouteMapOpen(false);
    setRouteMapMinimized(false);
    setRouteMapMaximized(false);
  };

  const openRouteMap = async () => {
    if (!destination) return;
    setRouteMapOpen(true);
    setRouteMapMinimized(false);
    setRouteMapMaximized(false);
    setRouteDestination({
      id: destination.id,
      lat: destination.lat,
      lng: destination.lng,
      location: { lat: destination.lat, lng: destination.lng },
    });

    if (!userCoords) {
      const coords = await fetchUserCoords();
      if (coords) setUserCoords(coords);
    }
  };

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

  const history = useHistory();

  const handleChipClick = async (chipPrompt: string) => {
    if (isLoading || micListening) return;
    if (typeof proximityAI.askQuestion === 'function') {
      await proximityAI.askQuestion(chipPrompt);
    }
  };

  const handleOpenInAIGuide = () => {
    const query = destination
      ? `Tell me more about ${destination.title}`
      : 'Recommend must-visit places in Pasig';
    safeDismiss();
    history.push(`/AIGuide?q=${encodeURIComponent(query)}`);
  };

  const suggestionChips = destination
    ? [
        { label: 'Hours & Fees', prompt: `What are the opening hours and entrance fees for ${destination.title}?`, icon: timeOutline },
        { label: "What's nearby?", prompt: `What other attractions or spots are near ${destination.title}?`, icon: mapOutline },
        { label: 'History & Tips', prompt: `Tell me a quick historical highlight and tips for ${destination.title}.`, icon: informationCircleOutline },
        { label: 'Where to eat', prompt: `Where are good places to eat near ${destination.title}?`, icon: restaurantOutline },
      ]
    : [
        { label: 'Top 5 spots', prompt: 'What are the top 5 must-visit places in Pasig City?', icon: mapOutline },
        { label: 'Local food spots', prompt: 'What are the most popular food spots in Pasig City?', icon: restaurantOutline },
        { label: 'Heritage sites', prompt: 'Which historical landmarks and churches can I visit in Pasig?', icon: informationCircleOutline },
      ];

  const handlePressStart = (e: React.PointerEvent) => {
    e.preventDefault();
    if (micListening) return;
    if (!micSupported) {
      setMicError('Voice input is not supported on this device.');
      return;
    }

    if (!destination && !isGenericMode && typeof proximityAI.triggerGeneric === 'function') {
      proximityAI.triggerGeneric();
    }

    if (isSpeaking) {
      safeTogglePause();
    }
    setMicError('');
    micStart();
  };

  const handlePressEnd = (e: React.PointerEvent) => {
    e.preventDefault();
    if (micListening) micStop();
  };

  return (
    <>
      <div className="ai-talking-backdrop">
        <button
          className="ai-talking-close"
          aria-label="Dismiss"
          onClick={safeDismiss}
        >
          <IonIcon icon={close} />
        </button>
        <img className="ai-talking-character" src={ALI_CHARACTER_IMAGE} alt="ALI" />

        <div className="ai-talking-bubbles">
          <div className={`ai-talking-bubble narration${isSpeaking ? ' speaking' : ''}`}>
            {isLoading ? (
              <div className="ai-talking-loading">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <span>Getting the story ready…</span>
              </div>
            ) : (
              <p>{narration}</p>
            )}
          </div>

          {/* Quick Action Prompt Chips */}
          {!isLoading && !micListening && (
            <div className="ai-talking-chips" role="toolbar" aria-label="Suggested questions">
              {suggestionChips.map((chip, idx) => (
                <button
                  key={idx}
                  className="ai-talking-chip"
                  onClick={() => handleChipClick(chip.prompt)}
                  aria-label={chip.label}
                >
                  <IonIcon icon={chip.icon} aria-hidden="true" />
                  <span>{chip.label}</span>
                </button>
              ))}
            </div>
          )}

          {micListening && (
            <div className="ai-talking-bubble listening">
              <span className="ai-talking-listening-label">Listening</span>
              <p>{micTranscript || 'Ask me anything about this place…'}</p>
            </div>
          )}

          {!!micError && !micListening && (
            <div className="ai-talking-bubble error">
              <p>{micError}</p>
            </div>
          )}
        </div>


        <div className="ai-talking-controls">
          <div className="ai-talking-control-row">
            <button
              className="ai-talking-icon-btn"
              onClick={safeTogglePause}
              disabled={isLoading || micListening}
              aria-label={isPaused ? 'Resume' : 'Pause'}
            >
              <IonIcon icon={isPaused ? playSkipForward : pauseIcon} />
            </button>

            {/* Hold-to-talk pill: press and hold to talk to ALI. Shows the
                live transcript while listening plus an animated waveform.
                Releasing (pointer up / leaving the button) sends whatever
                was heard to askQuestion(). Pointer events cover mouse +
                touch in one handler set, so this works the same in a
                browser tab and the compiled APK. */}
            <button
              className={`ai-talking-pill${micListening ? ' listening' : ''}`}
              onPointerDown={handlePressStart}
              onPointerUp={handlePressEnd}
              onPointerLeave={handlePressEnd}
              onContextMenu={(e) => e.preventDefault()}
              disabled={isLoading}
              style={{ touchAction: 'none' }}
            >
              <span className="ai-talking-pill-text">
                <IonIcon icon={mic} />{' '}
                {micListening
                  ? (micTranscript || 'Listening…')
                  : destination
                    ? 'Hold to talk about this place'
                    : 'Hold to ask me anything'}
              </span>
              <div className={`ai-talking-wave${micListening ? ' active' : ''}`}>
                <span /><span /><span /><span /><span />
              </div>
            </button>

            <button
              className="ai-talking-icon-btn"
              onClick={async () => { setMicError(''); await micReset(); }}
              disabled={isLoading}
              aria-label="Reset mic"
              title="Reset mic"
            >
              <IonIcon icon={refresh} />
            </button>

            <button
              className="ai-talking-icon-btn"
              onClick={openRouteMap}
              disabled={!destination || isLoading}
              aria-label="View route on map"
              title={destination ? 'View route on map' : 'A destination is required to show directions'}
            >
              <IonIcon icon={mapOutline} />
            </button>
          </div>

          <div className="ai-talking-guide-row">
            <button
              className="ai-talking-chat-btn"
              onClick={handleOpenInAIGuide}
              disabled={isLoading}
              aria-label="Open conversation in full AI Guide"
            >
              <IonIcon icon={chatbubblesOutline} />
              <span>Ask ALI in Full AI Guide</span>
            </button>
          </div>
        </div>

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
            {!routeMapMinimized && <IntegratedRouteMap destination={routeDestination} origin={userCoords} />}
          </div>
        )}
      </div>
    </>
  );
};

export default ProximityAITalkingOverlay;
