// Reviews.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  IonContent,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonIcon,
  IonButton,
  IonFooter,
  IonSpinner,
} from '@ionic/react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import { arrowBackOutline, star, starOutline } from 'ionicons/icons';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { firestore } from '../../firebase';
import type { TourSession } from '../../services/sessionService';
import './Reviews.css';

type Filter = 'all' | 5 | 4 | 3 | 2 | 1;

export const getReviewTargetId = (guideId?: string, sessionId?: string) =>
  (guideId || sessionId || '').trim();

const Reviews: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const { guideId, sessionId } = useParams<{ guideId?: string; sessionId?: string }>();
  const reviewTargetId = getReviewTargetId(guideId, sessionId);
  const touristId = new URLSearchParams(location.search).get('touristId') || '';
  const [reviews, setReviews] = useState<any[]>([]);
  const [pending, setPending] = useState<{ sessionId: string; touristUid: string; touristName: string; destinationName: string; startTime: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [showPending, setShowPending] = useState(false);

  // ── Load reviews for this guide ──
  useEffect(() => {
    if (!reviewTargetId) {
      setIsLoading(false);
      return;
    }

    const loadReviews = async () => {
      try {
        let guideUid = guideId?.trim() || '';

        if (!guideUid && sessionId) {
          const sessionSnap = await getDoc(doc(firestore, 'sessions', sessionId));
          if (sessionSnap.exists()) {
            const sessionData = sessionSnap.data() as Partial<TourSession> & { guideId?: string };
            guideUid = sessionData.guideId || '';
          }
        }

        if (!guideUid) {
          setReviews([]);
          setPending([]);
          setIsLoading(false);
          return;
        }

        const q = sessionId
          ? query(collection(firestore, 'feedback'), where('sessionId', '==', sessionId))
          : query(collection(firestore, 'feedback'), where('guideId', '==', guideUid));
        const snap = await getDocs(q);
        const data = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .sort((a, b) => {
            const aTs = a.createdAt && typeof a.createdAt?.toDate === 'function' ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
            const bTs = b.createdAt && typeof b.createdAt?.toDate === 'function' ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
            return bTs - aTs;
          });
        const sessionReviews = data.filter((review: any) =>
          (!sessionId || review.sessionId === sessionId) &&
          (!touristId || review.touristId === touristId)
        );
        setReviews(sessionReviews);

        // Cross-reference every ended session's tourist list against the
        // feedback docs above to find tourists who joined but never reviewed.
        // Single equality filter — no composite index required.
        const sessionsSnap = await getDocs(
          query(collection(firestore, 'sessions'), where('guideId', '==', guideUid))
        );

        const reviewedKeys = new Set(sessionReviews.map((r: any) => `${r.sessionId}_${r.touristId}`));
        const pendingList: typeof pending = [];

        sessionsSnap.docs.forEach((sDoc) => {
          const s = { id: sDoc.id, ...sDoc.data() } as TourSession;
          if (sessionId && s.id !== sessionId) return;
          if (s.status !== 'ended') return; // only ended tours are eligible for feedback
          (s.tourists || []).forEach((t) => {
            if (touristId && t.uid !== touristId) return;
            const key = `${s.id}_${t.uid}`;
            if (!reviewedKeys.has(key)) {
              pendingList.push({
                sessionId: s.id,
                touristUid: t.uid,
                touristName: t.name || 'Tourist',
                destinationName: s.destinationName,
                startTime: s.startTime,
              });
            }
          });
        });
        setPending(pendingList);
      } catch (err) {
        console.error('Failed to load reviews:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadReviews();
  }, [guideId, reviewTargetId, sessionId, touristId]);

  const totalReviews = reviews.length;

  const avgRating = useMemo(() => {
    if (totalReviews === 0) return 0;
    const sum = reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
    return sum / totalReviews;
  }, [reviews, totalReviews]);

  const starCounts = useMemo(() => {
    const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach(r => {
      const rounded = Math.round(r.rating || 0);
      if (counts[rounded] !== undefined) counts[rounded]++;
    });
    return counts;
  }, [reviews]);

  const filteredReviews = useMemo(() => {
    if (filter === 'all') return reviews;
    return reviews.filter(r => Math.round(r.rating || 0) === filter);
  }, [reviews, filter]);

  const renderStars = (rating: number, keyPrefix: string) => {
    const full = Math.floor(rating);
    const half = rating - full >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return (
      <>
        {[...Array(full)].map((_, i) => (
          <IonIcon key={`${keyPrefix}-f${i}`} icon={star} className="reviews-star reviews-star--filled" />
        ))}
        {half === 1 && (
          <IonIcon key={`${keyPrefix}-h`} icon={star} className="reviews-star reviews-star--half" />
        )}
        {[...Array(empty)].map((_, i) => (
          <IonIcon key={`${keyPrefix}-e${i}`} icon={starOutline} className="reviews-star reviews-star--empty" />
        ))}
      </>
    );
  };

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar className="reviews-header">
          {/* CHANGED: was a hardcoded routerLink to /tourguide/list.
              Now returns to whatever screen the guide actually came from
              (History, FeedbackQR, etc.). */}
          <div onClick={() => history.goBack()} className="reviews-back-btn">
            <IonIcon icon={arrowBackOutline} />
          </div>
          <IonTitle className="reviews-title">Reviews</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="reviews-content">
        <div className="reviews-wrapper">
          {isLoading ? (
            <div className="reviews-loading">
              <IonSpinner name="crescent" />
              <p>Loading reviews…</p>
            </div>
          ) : (
            <>
              {/* Summary Card */}
              <div className="reviews-summary-card">
                <div className="reviews-summary-left">
                  <span className="reviews-avg-number">{avgRating.toFixed(1)}</span>
                  <div className="reviews-avg-stars">{renderStars(avgRating, 'avg')}</div>
                  <span className="reviews-count">
                    {totalReviews} review{totalReviews !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="reviews-summary-right">
                  {[5, 4, 3, 2, 1].map((s) => {
                    const count = starCounts[s];
                    const pct = totalReviews > 0 ? (count / totalReviews) * 100 : 0;
                    return (
                      <div className="reviews-bar-row" key={s}>
                        <span className="reviews-bar-label">
                          {s} <IonIcon icon={star} />
                        </span>
                        <div className="reviews-bar-track">
                          <div className="reviews-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="reviews-bar-count">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Filter Chips */}
              <div className="reviews-filters">
                <button
                  className={`reviews-chip ${!showPending && filter === 'all' ? 'reviews-chip--active' : ''}`}
                  onClick={() => { setShowPending(false); setFilter('all'); }}
                >
                  All
                </button>
                {[5, 4, 3, 2, 1].map((s) => (
                  <button
                    key={s}
                    className={`reviews-chip ${!showPending && filter === s ? 'reviews-chip--active' : ''}`}
                    onClick={() => { setShowPending(false); setFilter(s as Filter); }}
                  >
                    {s} <IonIcon icon={star} />
                  </button>
                ))}
                <button
                  className={`reviews-chip ${showPending ? 'reviews-chip--active' : ''}`}
                  onClick={() => setShowPending(true)}
                >
                  Pending ({pending.length})
                </button>
              </div>

              {/* Review List / Pending List */}
              {showPending ? (
                <div className="reviews-list">
                  {pending.length === 0 ? (
                    <p className="reviews-empty">Everyone who joined an ended tour has left feedback.</p>
                  ) : (
                    pending.map((p) => (
                      <div className="reviews-card" key={`${p.sessionId}_${p.touristUid}`}>
                        <p className="reviews-card-comment">
                          <strong>{p.touristName}</strong> hasn't reviewed their tour to {p.destinationName}
                          {p.startTime ? ` (${new Date(p.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})` : ''} yet.
                        </p>
                      </div>
                    ))
                  )}
                </div>
              ) : (
              <div className="reviews-list">
                {filteredReviews.length === 0 ? (
                  <p className="reviews-empty">No reviews yet.</p>
                ) : (
                  filteredReviews.map((review) => (
                    <div className="reviews-card" key={review.id}>
                      <div className="reviews-card-stars">
                        {renderStars(review.rating || 0, review.id)}
                      </div>
                      <p className="reviews-card-author">
                        {review.touristName || 'Tourist'}
                      </p>
                      <p className="reviews-card-comment">
                        {review.comment ? `"${review.comment}"` : 'No comment provided.'}
                      </p>
                    </div>
                  ))
                )}
              </div>
              )}
            </>
          )}
        </div>
      </IonContent>

      <IonFooter className="ion-no-border reviews-footer">
        <IonButton
          expand="block"
          className="reviews-complete-btn"
          routerLink="/tourguide/home"
          routerDirection="root"
        >
          Complete
        </IonButton>
      </IonFooter>
    </IonPage>
  );
};

export default Reviews;