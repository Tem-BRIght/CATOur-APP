// Tour.tsx

import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonIcon,
  IonLoading,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  IonButton,
  IonSpinner,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonModal,
} from '@ionic/react';
import { useIonRouter } from '@ionic/react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import {
  calendarOutline,
  timeOutline,
  personOutline,
  walkOutline,
  chevronDownOutline,
  chevronUpOutline,
  checkmarkCircleOutline,
  locationOutline,
  arrowForwardOutline,
  closeOutline,
} from 'ionicons/icons';
import { useAuth } from '../../../context/AuthContext';
import {
  getTourTypesWithSchedules,
  getUpcomingSlotsForTourType,
  joinTour,
  checkTourBookingConflict,
  TourTypeWithSchedules,
  UpcomingSlotGroup,
} from '../../../services/tourScheduleService';
import { cancelJoinedSession, getUserJoinedSessions, subscribeUserJoinedSessions } from '../../../services/sessionService';
import type { TourSession } from '../../../services/sessionService';
import { getFeedback, GuideFeedbackDoc } from '../../../services/feedbackService';
import { firestore } from '../../../firebase';
import './Tour.css';

// ─── Helpers ──────────────────────────────────────────────────────────────

const formatTime = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};

const getLocalDateKey = (date = new Date()) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const parseDateOnly = (dateValue: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return new Date(dateValue);
};

const formatDate = (iso: string) => {
  const d = parseDateOnly(iso);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
};

const formatSessionDuration = (session: TourSession) => {
  const start = new Date(session.startTime).getTime();
  const end = session.endTime ? new Date(session.endTime).getTime() : Date.now();
  const totalMinutes = Math.max(0, Math.floor((end - start) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? `${hours} hr${minutes ? ` ${minutes} min` : ''}`
    : `${minutes} min`;
};

/**
 * isSlotTimeExpired
 * A slot is locked out once its own start time (on its own date) has
 * already passed — not just when the calendar day changes. This is what
 * makes "07:00 AM Morning Sunrise" un-joinable at 9:15 AM on the SAME day,
 * while a 3:00 PM slot later that same day is still joinable.
 */
const isSlotTimeExpired = (dateStr: string, startTime: string): boolean => {
  if (!dateStr || !startTime) return false;
  const slotDateTime = new Date(`${dateStr}T${startTime}:00`);
  return slotDateTime.getTime() < Date.now();
};

// ─── Merged slot shape used by the modal ───────────────────────────────────
// A tour type can be offered by more than one guide on the same day, so the
// modal shows the latest slot across all of that type's guides for today —
// each entry still remembers which guide + rawIndex it came from, since
// that's what joinTour() needs.

export interface MergedSlot {
  guideId: string;
  guideName: string;
  guidePhotoUrl?: string;
  rawIndex: number;
  date: string;
  startTime: string;
  endTime: string;
  maxSpots: number;
  bookedCount: number;
  joinedUserIds: string[];
}

export const getLatestTodaySlots = (type: TourTypeWithSchedules): MergedSlot[] => {
  const merged: MergedSlot[] = [];
  type.guides.forEach((guide) => {
    guide.slots.forEach((slot) => {
      merged.push({
        guideId: guide.guideId,
        guideName: guide.guideName,
        guidePhotoUrl: guide.guidePhotoUrl,
        rawIndex: slot.rawIndex,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxSpots: slot.maxSpots,
        bookedCount: slot.bookedCount,
        joinedUserIds: slot.joinedUserIds,
      });
    });
  });

  const today = getLocalDateKey();
  const todaySlots = merged
    .filter((slot) => slot.date === today)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return todaySlots.length > 0 ? [todaySlots[todaySlots.length - 1]] : [];
};

const getMergedSlots = (type: TourTypeWithSchedules): MergedSlot[] => getLatestTodaySlots(type);

// ─── Component ────────────────────────────────────────────────────────────

const TourPage: React.FC = () => {
  const router = useIonRouter();
  const { user } = useAuth();
  const [tourTypes, setTourTypes] = useState<TourTypeWithSchedules[]>([]);
  const [loading, setLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState('');
  const [joining, setJoining] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [selectedSegment, setSelectedSegment] = useState<'types' | 'history'>('types');
  // CHANGED: replaces the old inline slot list — tapping "Check Availability"
  // opens a modal (matches the "AVAILABLE SLOTS" bottom-sheet design) instead
  // of expanding times directly inside the card.
  const [activeSlotsTypeId, setActiveSlotsTypeId] = useState<string | null>(null);
  // Future-dated (beyond today) slots for whichever tour type's modal is
  // currently open — loaded lazily so we don't fetch every guide's full
  // schedule on every page load, only when the tourist actually opens
  // "Check Availability".
  const [upcomingGroups, setUpcomingGroups] = useState<UpcomingSlotGroup[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [feedbackViewer, setFeedbackViewer] = useState<{
    session: TourSession;
    feedback: GuideFeedbackDoc | null;
    places: string[];
  } | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [fullScreenImage, setFullScreenImage] = useState<{ src: string; alt: string } | null>(null);

  // ── Tour history — every session this tourist is on, joined either via
  // "Check Availability" below or by scanning a guide's QR. Previously this
  // was derived from today-only availabilitySlots.joinedUserIds, which
  // meant: (a) QR-scan joins never appeared here at all, since they only
  // ever wrote to sessions/{id}.tourists, and (b) even a Check-Availability
  // join vanished the moment the slot's date was no longer "today", since
  // getTourTypesWithSchedules() filters to today-only at the source.
  const [joinedSessions, setJoinedSessions] = useState<TourSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadJoinedSessions = async () => {
    if (!user?.uid) {
      setJoinedSessions([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const sessions = await getUserJoinedSessions(user.uid);
      setJoinedSessions(sessions);
    } catch (err) {
      console.error('Failed to load tour history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.uid) return;
    loadJoinedSessions();
    const unsubscribe = subscribeUserJoinedSessions(user.uid, (sessions) => {
      setJoinedSessions(sessions);
      setHistoryLoading(false);
    });
    return () => unsubscribe();
  }, [user?.uid]);

  // ── Load data ────────────────────────────────────────────────────────────

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getTourTypesWithSchedules();
      setTourTypes(data);
    } catch (err) {
      console.error('Failed to load tours:', err);
      setToastMsg('Could not load tours.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Load "Upcoming Tours" (future-dated slots) whenever a tour type's
  // Available Slots modal is opened.
  useEffect(() => {
    if (!activeSlotsTypeId) {
      setUpcomingGroups([]);
      return;
    }
    let cancelled = false;
    setUpcomingLoading(true);
    getUpcomingSlotsForTourType(activeSlotsTypeId)
      .then((groups) => {
        if (!cancelled) setUpcomingGroups(groups);
      })
      .catch((err) => {
        console.error('Failed to load upcoming tours:', err);
        if (!cancelled) setUpcomingGroups([]);
      })
      .finally(() => {
        if (!cancelled) setUpcomingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSlotsTypeId]);

  // ── Join handler ────────────────────────────────────────────────────────
  // CHANGED: `slotIndex` here is always a rawIndex (position in the guide's
  // raw availabilitySlots array), never a position in a filtered UI list —
  // see the note on TourSlot.rawIndex in tourScheduleService.ts.

  const handleJoin = async (guideId: string, rawIndex: number, tourTypeId: string, tourTypeName: string) => {
    if (!user) {
      setToastMsg('Please log in to join a tour.');
      return;
    }
    const key = `${guideId}-${rawIndex}`;
    if (joining === key || joining) return;
    setJoining(key);
    try {
      await joinTour(user.uid, guideId, rawIndex, tourTypeId, tourTypeName, {
        name: user.displayName || 'Tourist',
        email: user.email || '',
      });
      setToastMsg('You joined the tour! Check your joined tour below.');
      setActiveSlotsTypeId(null);
      setSelectedSegment('history');
      await loadData();
      void loadJoinedSessions();
      if (activeSlotsTypeId) {
        getUpcomingSlotsForTourType(activeSlotsTypeId)
          .then(setUpcomingGroups)
          .catch((err) => console.error('Failed to refresh upcoming tours:', err));
      }
    } catch (err: any) {
      setToastMsg(err.message || 'Could not join. Please try again.');
    } finally {
      setJoining(null);
    }
  };

  const handleCancelJoinedSession = async (session: TourSession) => {
    if (!user?.uid) return;
    if (session.status === 'Cancelled') {
      setToastMsg('This session has already been cancelled.');
      return;
    }
    if (session.checkedInUids?.includes(user.uid)) {
      setToastMsg('Tours cannot be cancelled after check-in.');
      return;
    }

    const reason = window.prompt('Enter a valid reason for cancelling this joined tour:', '');
    if (reason === null) return;
    if (!reason.trim()) {
      setToastMsg('A valid cancellation reason is required.');
      return;
    }

    try {
      await cancelJoinedSession(session.id, user.uid, reason);
      const cancelledAt = new Date().toISOString();
      const cancelledSession: TourSession = {
        ...session,
        id: `${session.id}__cancelled__${cancelledAt}`,
        status: 'Cancelled',
        cancelReason: reason.trim(),
        cancelledAt,
      };
      setJoinedSessions((current) => [
        ...current.filter((item) => item.id !== session.id),
        cancelledSession,
      ]);
      setToastMsg('Joined tour cancelled. A slot has been freed up.');
      await loadData();
      if (activeSlotsTypeId) {
        getUpcomingSlotsForTourType(activeSlotsTypeId)
          .then(setUpcomingGroups)
          .catch((err) => console.error('Failed to refresh upcoming tours:', err));
      }
    } catch (err: any) {
      setToastMsg(err.message || 'Could not cancel this tour.');
    }
  };

  const handleViewFeedback = async (session: TourSession) => {
    if (!user?.uid) return;
    setFeedbackLoading(true);
    try {
      const feedback = await getFeedback(session.id, user.uid);
      let places = session.itinerary || [];

      if (places.length === 0 && session.tourTypeId) {
        const typeSnap = await getDocs(query(
          collection(firestore, 'tourTypes'),
          where(documentId(), '==', session.tourTypeId),
        ));
        const destinationIds = (typeSnap.docs[0]?.data().destinations || []) as string[];
        if (destinationIds.length > 0) {
          const destinationSnap = await getDocs(query(
            collection(firestore, 'destinations'),
            where(documentId(), 'in', destinationIds.slice(0, 30)),
          ));
          const names = new Map(destinationSnap.docs.map((doc) => [
            doc.id,
            String(doc.data().title || doc.data().name || ''),
          ]));
          places = destinationIds.map((id) => names.get(id) || '').filter(Boolean);
        }
      }

      if (places.length === 0 && session.destinationName) places = [session.destinationName];
      setFeedbackViewer({ session, feedback, places });
      if (!feedback) setToastMsg('You have not submitted feedback for this tour yet.');
    } catch (err) {
      console.error('Failed to load your feedback:', err);
      setToastMsg('Could not load your feedback.');
    } finally {
      setFeedbackLoading(false);
    }
  };

  // ── Toggle expand tour type ─────────────────────────────────────────────

  const toggleExpand = (typeId: string) => {
    const newSet = new Set(expandedTypes);
    if (newSet.has(typeId)) {
      newSet.delete(typeId);
    } else {
      newSet.add(typeId);
    }
    setExpandedTypes(newSet);
  };

  const activeType = tourTypes.find((t) => t.id === activeSlotsTypeId) || null;
  const activeSlots = activeType ? getMergedSlots(activeType) : [];

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" />
          </IonButtons>
          <IonTitle>Tours</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment
            value={selectedSegment}
            onIonChange={(e) => setSelectedSegment(e.detail.value as any)}
          >
            <IonSegmentButton value="types">
              <IonLabel>Tour Types</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="history">
              <IonLabel>History</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>

      <IonContent className="bh-content">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e) => {
            await loadData();
            e.detail.complete();
          }}
        >
          <IonRefresherContent />
        </IonRefresher>

        <IonLoading isOpen={loading} message="Loading tours…" />

        {selectedSegment === 'types' && (
          <>
            {tourTypes.length === 0 && !loading && (
              <div className="bh-empty">
                <div className="bh-empty-icon">🧭</div>
                <h3 className="bh-empty-title">No tours available</h3>
                <p className="bh-empty-sub">
                  No tour guides have been assigned a tour for today yet. Check back later!
                </p>
              </div>
            )}

            <div className="tour-types-list">
              {tourTypes.map((type) => {
                const isExpanded = expandedTypes.has(type.id);

                return (
                  <div key={type.id} className="tour-type-card">
                    {/* Header – always visible */}
                    <div
                      className="tour-type-header"
                      onClick={() => toggleExpand(type.id)}
                    >
                      <div
                        className="tour-type-icon-wrap"
                        style={{ background: '#0d2f6e' }}
                      >
                        <IonIcon icon={walkOutline} />
                      </div>
                      <div className="tour-type-header-text">
                        <h3 className="tour-type-label">{type.name}</h3>
                        {type.duration && (
                          <p className="tour-type-tagline">{type.duration}</p>
                        )}
                      </div>
                      <IonIcon
                        icon={isExpanded ? chevronUpOutline : chevronDownOutline}
                        className="tour-type-chevron"
                      />
                    </div>

                    {/* Expanded body – description + places, no price */}
                    {isExpanded && (
                      <div className="tour-type-body">
                        <p className="tour-type-desc">
                          {type.description || 'No description provided.'}
                        </p>

                        {type.duration && (
                          <div className="tour-type-pills">
                            <span className="tour-pill">
                              <IonIcon icon={timeOutline} /> {type.duration}
                            </span>
                          </div>
                        )}

                        {type.places.length > 0 && (
                          <div className="tour-places-section">
                            <p className="tour-places-heading">Places you'll visit</p>
                            <ul className="tour-places-visit-list">
                              {type.places.map((place, i) => (
                                <li key={i}>
                                  <IonIcon icon={locationOutline} /> {place}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Check Availability — opens the slots modal for today */}
                    <div className="tour-type-footer">
                      <IonButton
                        expand={isExpanded ? 'block' : undefined}
                        className="check-availability-btn"
                        onClick={() => setActiveSlotsTypeId(type.id)}
                      >
                        Check Availability
                        <IonIcon icon={arrowForwardOutline} slot="end" />
                      </IonButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {selectedSegment === 'history' && (
          <div className="history-wrap">
            {historyLoading && (
              <div className="bh-empty">
                <IonSpinner name="crescent" />
              </div>
            )}

            {!historyLoading && joinedSessions.length === 0 && (
              <div className="bh-empty">
                <div className="bh-empty-icon">📋</div>
                <h3 className="bh-empty-title">No tour history yet</h3>
                <p className="bh-empty-sub">
                  Tours you join or scan a guide's QR for will appear here.
                </p>
                <IonButton
                  expand="block"
                  onClick={() => setSelectedSegment('types')}
                >
                  Explore Tours
                </IonButton>
              </div>
            )}

            {!historyLoading && joinedSessions.length > 0 && (
              <div className="history-timeline">
                {joinedSessions.map((s, index) => {
                    const isCancelled = s.status === 'Cancelled';
                    const isEnded = s.status === 'ended';
                    const isActive = s.status === 'active';
                    const isCheckedIn = !!(user?.uid && s.checkedInUids?.includes(user.uid));
                    const dotClass = isCancelled
                      ? 'ht-dot--cancelled'
                      : isEnded ? 'ht-dot--completed' : 'ht-dot--confirmed';
                    const pillClass = isCancelled
                      ? 'ht-status-pill--cancelled'
                      : isEnded ? 'ht-status-pill--completed' : 'ht-status-pill--confirmed';
                    const pillLabel = isCancelled
                      ? 'Cancelled'
                      : isEnded
                      ? 'Completed'
                      : isCheckedIn
                      ? (isActive ? 'Ongoing' : 'Checked-In')
                      : 'Reserved';
                    const isLast = index === joinedSessions.length - 1;
                    const rowKey = `${s.id}-${isCancelled ? 'cancelled' : 'joined'}-${s.status}-${s.cancelledAt || s.startTime || 'n/a'}`;

                  return (
                    <div key={rowKey} className={`ht-row ${isLast ? 'ht-row--last' : ''}`}>
                      <div className="ht-spine">
                        <div className={`ht-dot ${dotClass}`}>
                          <IonIcon icon={checkmarkCircleOutline} />
                        </div>
                        {!isLast && <div className="ht-line" />}
                      </div>
                      <div className="ht-card">
                        <div className="ht-card-top">
                          <span className="ht-date">
                            <IonIcon icon={calendarOutline} />{' '}
                            {s.startTime ? formatDate(s.startTime) : '—'}
                          </span>
                          <span className={`ht-status-pill ${pillClass}`}>{pillLabel}</span>
                        </div>

                        {s.status === 'Cancelled' && (
                          <p style={{ margin: '10px 0 0', color: '#b91c1c', fontSize: '12px', lineHeight: 1.5 }}>
                            <IonIcon icon={closeOutline} /> Reason: {s.cancelReason || 'No reason provided'}
                          </p>
                        )}

                        {/* Tap to reopen the same tour session view if checked in */}
                        <div
                          className="ht-dest-row"
                          onClick={() => {
                            if (isCheckedIn || isEnded) {
                              router.push(`/tour-session/${s.id}`, 'forward');
                            } else {
                              setToastMsg('Please scan the Tour Guide’s QR code to check in and access the live session.');
                            }
                          }}
                        >
                          <div className="ht-dest-info">
                            <div className="ht-field-label">Type of Tour</div>
                            <div className="ht-dest-name">{s.tourTypeName || 'Tour'}</div>
                            <div className="ht-tour-type-tag">
                              <IonIcon icon={timeOutline} /> Duration: {formatSessionDuration(s)}
                            </div>
                          </div>
                          <IonIcon icon={arrowForwardOutline} className="ht-arrow" />
                        </div>

                        <div className="ht-meta-row">
                          <span className="ht-guide-chip">
                            <span className="ht-guide-avatar">
                              {s.guidePhotoUrl ? (
                                <img
                                  src={s.guidePhotoUrl}
                                  alt={s.guideName}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFullScreenImage({ src: s.guidePhotoUrl!, alt: s.guideName });
                                  }}
                                />
                              ) : <IonIcon icon={personOutline} />}
                            </span>
                            <span className="ht-guide-name">{s.guideName}</span>
                          </span>
                          {s.startTime && (
                            <span className="ht-chip">
                              <IonIcon icon={timeOutline} />{' '}
                              {isEnded ? 'Started ' : 'Scheduled '}{new Date(s.startTime).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                              {s.endTime && ` - ${new Date(s.endTime).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}`}
                            </span>
                          )}
                        </div>

                        <div className="ht-actions">
                          {!isEnded && isCheckedIn && (
                            <IonButton
                              fill="clear"
                              size="small"
                              className="ht-action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/tour-session/${s.id}`, 'forward');
                              }}
                            >
                              View Session
                            </IonButton>
                          )}
                          {isEnded && isCheckedIn && (
                            <IonButton
                              fill="clear"
                              size="small"
                              className="ht-action-btn"
                              disabled={feedbackLoading}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleViewFeedback(s);
                              }}
                            >
                              View Feedback
                            </IonButton>
                          )}
                          {!isEnded && !isCancelled && !isCheckedIn && (
                            <IonButton
                              fill="clear"
                              size="small"
                              className="ht-action-btn ht-action-btn--cancel"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleCancelJoinedSession(s);
                              }}
                            >
                              Cancel Join
                            </IonButton>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── AVAILABLE SLOTS modal ─────────────────────────────────────── */}
        {activeType && (
          <div
            className="slots-modal-overlay"
            onClick={() => setActiveSlotsTypeId(null)}
          >
            <div className="slots-modal-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="slots-modal-drag" />
              <div className="slots-modal-header">
                <div>
                  <p className="slots-modal-eyebrow">Available slots</p>
                  <h3 className="slots-modal-title">{activeType.name}</h3>
                  <p className="slots-modal-date">Today · {formatDate(getLocalDateKey())}</p>
                </div>
                <button
                  className="slots-modal-close"
                  onClick={() => setActiveSlotsTypeId(null)}
                  aria-label="Close"
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>

              <div className="slots-modal-list">
                {activeSlots.length === 0 && (
                  <p className="slots-modal-empty">No slots scheduled for today.</p>
                )}

                {activeSlots.map((slot) => {
                  const available = slot.maxSpots - slot.bookedCount;
                  const full = available <= 0;
                  const isJoined = slot.joinedUserIds.includes(user?.uid || '');
                  // CHANGED — this is the actual lockout: once this slot's
                  // start time has passed (same day), it can no longer be
                  // joined, even though the day itself hasn't changed yet.
                  const expired = isSlotTimeExpired(slot.date, slot.startTime);
                  const conflict = checkTourBookingConflict(joinedSessions, {
                    tourTypeId: activeType.id,
                    date: slot.date,
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                  }, user?.uid);
                  const hasConflict = conflict.hasConflict && !isJoined;
                  const key = `${slot.guideId}-${slot.rawIndex}`;
                  const disabled = full || isJoined || expired || hasConflict || joining === key;
                  const pct = slot.maxSpots > 0 ? (slot.bookedCount / slot.maxSpots) * 100 : 0;

                  let statusText = `${available} spot${available !== 1 ? 's' : ''} left`;
                  if (isJoined) statusText = 'You joined';
                  else if (hasConflict) statusText = conflict.type === 'same_tour_type_same_day' ? '1 tour/day limit' : 'Time conflict';
                  else if (expired) statusText = 'Time has passed';
                  else if (full) statusText = 'Full';
                  else if (slot.date !== getLocalDateKey()) statusText = 'Available';

                  let buttonContent: React.ReactNode = 'Join';
                  if (joining === key) buttonContent = <IonSpinner name="dots" />;
                  else if (isJoined) buttonContent = '✓ Joined';
                  else if (hasConflict) buttonContent = 'Conflict';
                  else if (expired) buttonContent = 'Expired';
                  else if (full) buttonContent = 'Full';

                  return (
                    <div
                      key={key}
                      className={[
                        'slot-row',
                        isJoined ? 'slot-row--joined' : '',
                        expired && !isJoined ? 'slot-row--expired' : '',
                        full && !isJoined && !expired ? 'slot-row--full' : '',
                      ].join(' ').trim()}
                    >
                      <div className="slot-row-info">
                        <span className="slot-row-time">{formatTime(slot.startTime)} - {formatTime(slot.endTime)}</span>
                        <span className="slot-row-guide">
                          <span className="slot-row-guide-avatar">
                            {slot.guidePhotoUrl ? (
                              <img
                                src={slot.guidePhotoUrl}
                                alt={slot.guideName}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFullScreenImage({ src: slot.guidePhotoUrl!, alt: slot.guideName });
                                }}
                              />
                            ) : <IonIcon icon={personOutline} />}
                          </span>
                          {slot.guideName}
                        </span>
                        <span className="slot-row-duration">{formatSessionDuration({ startTime: `${slot.date}T${slot.startTime}:00`, endTime: `${slot.date}T${slot.endTime}:00` } as TourSession)}</span>
                        <span
                          className={[
                            'slot-row-status',
                            isJoined ? 'slot-row-status--joined' : '',
                            expired && !isJoined ? 'slot-row-status--expired' : '',
                          ].join(' ').trim()}
                        >
                          {statusText}
                        </span>
                        <div className="slot-row-track">
                          <div
                            className={`slot-row-fill ${full || "" ? 'slot-row-fill--muted' : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <IonButton
                        size="small"
                        fill={isJoined ? 'outline' : 'solid'}
                        disabled={disabled}
                        onClick={() => handleJoin(slot.guideId, slot.rawIndex, activeType.id, activeType.name)}
                      >
                        {buttonContent}
                      </IonButton>
                    </div>
                  );
                })}
              </div>

              {/* ── Upcoming Tours — future-dated slots beyond today ─────── */}
              <div className="slots-upcoming-section">
                <p className="slots-upcoming-heading">Upcoming tours</p>

                {upcomingLoading && (
                  <div className="slots-upcoming-loading">
                    <IonSpinner name="dots" />
                  </div>
                )}

                {!upcomingLoading && upcomingGroups.length === 0 && (
                  <p className="slots-modal-empty">No upcoming tours scheduled yet.</p>
                )}

                {!upcomingLoading &&
                  upcomingGroups.map((group) => (
                    <div key={group.date} className="slots-upcoming-group">
                      <p className="slots-upcoming-date">{formatDate(group.date)}</p>
                      <div className="slots-modal-list">
                        {group.slots.map((slot) => {
                          const available = slot.maxSpots - slot.bookedCount;
                          const full = available <= 0;
                          const isJoined = slot.joinedUserIds.includes(user?.uid || '');
                          const conflict = checkTourBookingConflict(joinedSessions, {
                            tourTypeId: activeType.id,
                            date: group.date,
                            startTime: slot.startTime,
                            endTime: slot.endTime,
                          }, user?.uid);
                          const hasConflict = conflict.hasConflict && !isJoined;
                          const key = `${slot.guideId}-${slot.rawIndex}`;
                          const disabled = full || isJoined || hasConflict || joining === key;

                          let statusText = `${available} spot${available !== 1 ? 's' : ''} left`;
                          if (isJoined) statusText = 'You joined';
                          else if (hasConflict) statusText = conflict.type === 'same_tour_type_same_day' ? '1 tour/day limit' : 'Time conflict';
                          else if (full) statusText = 'Full';

                          let buttonContent: React.ReactNode = 'Join';
                          if (joining === key) buttonContent = <IonSpinner name="dots" />;
                          else if (isJoined) buttonContent = '✓ Joined';
                          else if (hasConflict) buttonContent = 'Conflict';
                          else if (full) buttonContent = 'Full';

                          const pct = slot.maxSpots > 0 ? (slot.bookedCount / slot.maxSpots) * 100 : 0;

                          return (
                            <div
                              key={key}
                              className={[
                                'slot-row',
                                isJoined ? 'slot-row--joined' : '',
                                full && !isJoined ? 'slot-row--full' : '',
                              ].join(' ').trim()}
                            >
                              <div className="slot-row-info">
                                <span className="slot-row-time">{formatTime(slot.startTime)} - {formatTime(slot.endTime)}</span>
                                <span className="slot-row-guide">
                                  <span className="slot-row-guide-avatar">
                                    {slot.guidePhotoUrl ? (
                                      <img
                                        src={slot.guidePhotoUrl}
                                        alt={slot.guideName}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setFullScreenImage({ src: slot.guidePhotoUrl!, alt: slot.guideName });
                                        }}
                                      />
                                    ) : <IonIcon icon={personOutline} />}
                                  </span>
                                  {slot.guideName}
                                </span>
                                <span className="slot-row-duration">{formatSessionDuration({ startTime: `${group.date}T${slot.startTime}:00`, endTime: `${group.date}T${slot.endTime}:00` } as TourSession)}</span>
                                <span
                                  className={[
                                    'slot-row-status',
                                    isJoined ? 'slot-row-status--joined' : '',
                                  ].join(' ').trim()}
                                >
                                  {statusText}
                                </span>
                                <div className="slot-row-track">
                                  <div
                                    className={`slot-row-fill ${full ? 'slot-row-fill--muted' : ''}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                              <IonButton
                                size="small"
                                fill={isJoined ? 'outline' : 'solid'}
                                disabled={disabled}
                                onClick={() => handleJoin(slot.guideId, slot.rawIndex, activeType.id, activeType.name)}
                              >
                                {buttonContent}
                              </IonButton>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        <IonModal
          className="feedback-viewer-modal"
          isOpen={!!feedbackViewer?.feedback}
          onDidDismiss={() => setFeedbackViewer(null)}
        >
          <IonHeader className="feedback-viewer-header">
            <IonToolbar className="feedback-viewer-toolbar">
              <IonTitle className="feedback-viewer-title">Your Feedback</IonTitle>
              <IonButtons slot="end">
                <IonButton className="feedback-viewer-close" onClick={() => setFeedbackViewer(null)}>Close</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="feedback-viewer-content">
            {feedbackViewer?.feedback && (
              <div className="feedback-viewer-body">
                <div className="feedback-viewer-guide">
                  <div className="feedback-viewer-avatar">
                    {feedbackViewer.session.guidePhotoUrl ? (
                      <img
                        src={feedbackViewer.session.guidePhotoUrl}
                        alt={feedbackViewer.session.guideName}
                        onClick={() => setFullScreenImage({
                          src: feedbackViewer.session.guidePhotoUrl!,
                          alt: feedbackViewer.session.guideName,
                        })}
                      />
                    ) : (
                      <IonIcon icon={personOutline} />
                    )}
                  </div>
                  <div>
                    <h2>{feedbackViewer.session.guideName}</h2>
                  </div>
                </div>

                <section className="feedback-viewer-score">
                  <div>
                    <span className="feedback-viewer-label">Overall experience</span>
                    <strong>{feedbackViewer.feedback.rating || 0}<small>/5</small></strong>
                  </div>
                  <div className="feedback-viewer-stars" aria-label={`${feedbackViewer.feedback.rating || 0} out of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((starNumber) => (
                      <span key={starNumber} className={starNumber <= (feedbackViewer.feedback?.rating || 0) ? 'is-filled' : ''}>★</span>
                    ))}
                  </div>
                </section>

                <section className="feedback-viewer-section">
                  <h3>Places visited</h3>
                  <div className="feedback-viewer-places">
                    
                    <p>{feedbackViewer.session.tourTypeName || 'Tour'}</p>
                    {feedbackViewer.places.map((place) => (
                      <span key={place}>
                        <IonIcon icon={locationOutline} />
                        {place}
                      </span>
                    ))}
                  </div>
                </section>

                <section className="feedback-viewer-section">
                  <h3>Category ratings</h3>
                  <div className="feedback-viewer-categories">
                    {[
                      ['Knowledge', 'knowledge'],
                      ['Friendliness', 'friendliness'],
                      ['Punctuality', 'punctuality'],
                      ['Communication', 'communication'],
                    ].map(([label, key]) => {
                      const ratingVal = (feedbackViewer.feedback?.categoryRatings as Record<string, number | undefined> | undefined)?.[key];
                      return (
                        <div className="feedback-viewer-category" key={key}>
                          <span>{label}</span>
                          <strong>{ratingVal ?? '—'}<small>/5</small></strong>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="feedback-viewer-section feedback-viewer-comment">
                  <h3>Your comment</h3>
                  <p>{feedbackViewer.feedback.comment || 'No comment provided.'}</p>
                </section>
              </div>
            )}
          </IonContent>
        </IonModal>

        <IonModal
          className="full-screen-image-modal"
          isOpen={!!fullScreenImage}
          onDidDismiss={() => setFullScreenImage(null)}
        >
          <IonContent className="full-screen-image-content">
            <button
              className="full-screen-image-close"
              onClick={() => setFullScreenImage(null)}
              aria-label="Close photo"
            >
              <IonIcon icon={closeOutline} />
            </button>
            {fullScreenImage && (
              <img src={fullScreenImage.src} alt={fullScreenImage.alt} />
            )}
          </IonContent>
        </IonModal>

        <IonToast
          isOpen={!!toastMsg}
          message={toastMsg}
          duration={3000}
          position="bottom"
          onDidDismiss={() => setToastMsg('')}
        />
      </IonContent>
    </IonPage>
  );
};

export default TourPage;