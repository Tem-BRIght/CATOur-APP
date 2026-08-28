// src/pages/Settings/MyReviews/MyReviews.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Shows every review the current user has submitted across all destinations.
// Reads from:  /destinations/{destId}/reviews/{userId}
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonIcon, IonLoading, IonToast,
  IonRefresher, IonRefresherContent,
} from '@ionic/react';
import { useIonRouter } from '@ionic/react';
import {
  star, starOutline, locationOutline, calendarOutline,
  trashOutline, createOutline, chevronForwardOutline,
  chatbubbleOutline, timeOutline, peopleOutline,
} from 'ionicons/icons';
import {
  collection, getDocs, query, orderBy,
  doc, deleteDoc, getDoc,
} from 'firebase/firestore';
import { firestore } from '../../../firebase';
import { useAuth } from '../../../context/AuthContext';
import { getUserProfile, UserProfile } from '../../../services/userProfileService';
import './MyReviews.css';
import FeedbackOverlay from '../../../components/FeedbackOverlay';

// ── Types ─────────────────────────────────────────────────────────────────────
interface MyReview {
  reviewDocId: string;          // doc id inside reviews sub-collection
  destId: string;
  destName: string;
  destImage: string;
  overallRating: number;
  text: string;
  feeling: string;
  visitDate: string;
  companion: string;
  duration: string;
  anonymous: boolean;
  createdAt: string;
  photos: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const StarRow: React.FC<{ value: number }> = ({ value }) => (
  <span className="mr-star-row">
    {[1, 2, 3, 4, 5].map(n => (
      <IonIcon key={n} icon={n <= Math.round(value) ? star : starOutline} className={n <= Math.round(value) ? 'mr-star filled' : 'mr-star'} />
    ))}
    <span className="mr-star-value">{value.toFixed(1)}</span>
  </span>
);

const formatDate = (raw: string) => {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

// ─────────────────────────────────────────────────────────────────────────────
const MyReviews: React.FC = () => {
  const router = useIonRouter();
  const { user } = useAuth();

  const [reviews, setReviews]         = useState<MyReview[]>([]);
  const [loading, setLoading]         = useState(true);
  const [toastMsg, setToastMsg]       = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MyReview | null>(null);
  const [deleting, setDeleting]       = useState(false);
  const [profile, setProfile]         = useState<UserProfile | null>(null);

  // ── Fetch profile ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    getUserProfile(user.uid)
      .then(p => setProfile(p))
      .catch(console.error);
  }, [user?.uid]);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const loadReviews = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    try {
      // ── Step 1: read pointer docs from users/{uid}/reviews ───────────────
      // Written by WriteReviewModal inside the same transaction as the review
      // itself, so no collectionGroup index is required.
      const pointersRef  = collection(firestore, 'users', user.uid, 'reviews');
      const pointersSnap = await getDocs(query(pointersRef, orderBy('createdAt', 'desc')));

      if (pointersSnap.empty) {
        // ── Backfill: user reviewed before the pointer doc was introduced ──
        // Try a best-effort fetch via collectionGroup. If the Firestore index
        // exists this will work; if not, the catch below will just leave the
        // list empty and the user will see it after their next review submit.
        try {
          const { collectionGroup: cg, query: fq, where: fw, getDocs: fgd } = await import('firebase/firestore');
          const cgSnap = await fgd(fq(cg(firestore, 'reviews'), fw('userId', '==', user.uid)));
          if (!cgSnap.empty) {
            // Write pointer docs for each found review so future loads are fast
            const { setDoc } = await import('firebase/firestore');
            await Promise.all(cgSnap.docs.map(async d => {
              const dId = d.ref.parent.parent?.id ?? '';
              if (!dId) return;
              await setDoc(
                doc(firestore, 'users', user.uid, 'reviews', dId),
                { destId: dId, createdAt: d.data().createdAt ?? null, updatedAt: d.data().updatedAt ?? null },
                { merge: true }
              );
            }));
            // Re-run loadReviews now that pointers exist
            await loadReviews();
          } else {
            setReviews([]);
          }
        } catch {
          setReviews([]);
        }
        return;
      }

      // ── Step 2: fetch each actual review + destination in parallel ────────
      const loaded: MyReview[] = (
        await Promise.all(
          pointersSnap.docs.map(async (pointerDoc) => {
            const destId = pointerDoc.id; // pointer doc ID == destinationId

            // Fetch the actual review doc
            const reviewRef  = doc(firestore, 'destinations', destId, 'reviews', user.uid);
            const reviewSnap = await getDoc(reviewRef);
            if (!reviewSnap.exists()) return null; // deleted or not yet written

            const data = reviewSnap.data();

            // Fetch destination info (name + image)
            let destName  = data.destinationName  || data.destName || '';
            let destImage = data.destinationImage || data.destImage || '';
            try {
              const destSnap = await getDoc(doc(firestore, 'destinations', destId));
              if (destSnap.exists()) {
                const d = destSnap.data();
                destName  = destName  || d.name  || d.title  || 'Unknown Destination';
                destImage = destImage || d.image || d.imageUrl || (d.images?.[0] ?? '');
              }
            } catch { /* silent */ }

            // createdAt may be a Firestore Timestamp or ISO string
            const raw = data.createdAt;
            const createdAt = raw?.toDate
              ? raw.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
              : raw || '';

            return {
              reviewDocId: reviewSnap.id,
              destId,
              destName:      destName || 'Unknown Destination',
              destImage,
              overallRating: data.overallRating ?? 0,
              text:          data.review        || data.text || data.reviewText || '',
              feeling:       data.feeling        || '',
              visitDate:     data.visitDate      || '',
              companion:     data.companion      || '',
              duration:      data.duration       || '',
              anonymous:     !!data.anonymous,
              createdAt,
              // photos stored as photoBase64s in the review doc
              photos: Array.isArray(data.photoBase64s)
                ? data.photoBase64s
                : Array.isArray(data.photos)
                  ? data.photos
                  : [],
            } as MyReview;
          })
        )
      ).filter((r): r is MyReview => r !== null);

      // Already ordered by pointer createdAt desc, but re-sort for safety
      loaded.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setReviews(loaded);
    } catch (err) {
      console.error('[MyReviews] load failed:', err);
      setToastMsg('Failed to load reviews.');
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(
        doc(firestore, 'destinations', deleteTarget.destId, 'reviews', deleteTarget.reviewDocId)
      );
      setReviews(prev => prev.filter(r => r.reviewDocId !== deleteTarget.reviewDocId));
      setToastMsg('Review deleted.');
    } catch (err) {
      console.error('[MyReviews] delete failed:', err);
      setToastMsg('Could not delete review. Try again.');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  // Resolve display name from profile → fallback to Auth displayName → email prefix
  const profileName = (() => {
    const fn = profile?.name?.firstname || '';
    const sn = profile?.name?.surname   || '';
    const full = [fn, sn].filter(Boolean).join(' ');
    return full || profile?.nickname || user?.displayName || user?.email?.split('@')[0] || 'Traveller';
  })();
  const profileAvatar = profile?.img || user?.photoURL || '';
  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.overallRating, 0) / reviews.length).toFixed(1)
    : null;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/settings" /></IonButtons>
          <IonTitle>My Reviews</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonLoading isOpen={loading || deleting} message={deleting ? 'Deleting…' : 'Loading…'} />

      <IonContent className="mr-content">
        {/* Pull-to-refresh */}
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await loadReviews(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>

        {/* ── Reviewer Profile Card ── */}
        {!loading && (
          <div className="mr-profile-card">
            <div className="mr-profile-avatar">
              {profileAvatar ? (
                <img src={profileAvatar} alt={profileName} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <span>{profileName[0]?.toUpperCase()}</span>
              )}
            </div>
            <div className="mr-profile-info">
              <p className="mr-profile-name">{profileName}</p>
              {user?.email && <p className="mr-profile-email">{user.email}</p>}
              <div className="mr-profile-stats">
                <div className="mr-profile-stat">
                  <span className="mr-profile-stat-val">{reviews.length}</span>
                  <span className="mr-profile-stat-label">{reviews.length === 1 ? 'Review' : 'Reviews'}</span>
                </div>
                {avgRating && (
                  <div className="mr-profile-stat-divider" />
                )}
                {avgRating && (
                  <div className="mr-profile-stat">
                    <span className="mr-profile-stat-val">⭐ {avgRating}</span>
                    <span className="mr-profile-stat-label">Avg Rating</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!loading && reviews.length === 0 ? (
          /* ── Empty state ─────────────────────────────────────────────── */
          <div className="mr-empty">
            <div className="mr-empty-icon">⭐</div>
            <h3 className="mr-empty-title">No reviews yet</h3>
            <p className="mr-empty-sub">
              Start exploring destinations and share your experience!
            </p>
            <button className="mr-empty-btn" onClick={() => router.push('/home')}>
              Explore Destinations
            </button>
          </div>
        ) : (
          /* ── Review cards ────────────────────────────────────────────── */
          <div className="mr-list">
            {reviews.map(review => (
              <div key={review.reviewDocId} className="mr-card">

                {/* Destination header */}
                <div
                  className="mr-card-header"
                  onClick={() => router.push(`/destination/${review.destId}`)}
                >
                  <div className="mr-card-thumb-wrap">
                    {review.destImage ? (
                      <img src={review.destImage} alt={review.destName} className="mr-card-thumb" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="mr-card-thumb mr-card-thumb--placeholder">🏛️</div>
                    )}
                  </div>
                  <div className="mr-card-dest-info">
                    <p className="mr-card-dest-name">{review.destName}</p>
                    <StarRow value={review.overallRating} />
                    <p className="mr-card-date">
                      <IonIcon icon={calendarOutline} className="mr-meta-icon" />
                      {review.createdAt}
                      {review.anonymous && <span className="mr-anon-badge">Anonymous</span>}
                    </p>
                  </div>
                  <IonIcon icon={chevronForwardOutline} className="mr-card-arrow" />
                </div>


                {/* Review body */}
                {(review.text || review.feeling) && (
                  <div className="mr-card-body">
                    {review.feeling && (
                      <p className="mr-card-feeling">
                        <IonIcon icon={chatbubbleOutline} className="mr-meta-icon" />
                        {review.feeling}
                      </p>
                    )}
                    {review.text && <p className="mr-card-text">{review.text}</p>}
                  </div>
                )}

                {/* Meta chips */}
                {(review.companion || review.duration || review.visitDate) && (
                  <div className="mr-card-meta">
                    {review.companion && (
                      <span className="mr-meta-chip">
                        <IonIcon icon={peopleOutline} /> {review.companion}
                      </span>
                    )}
                    {review.duration && (
                      <span className="mr-meta-chip">
                        <IonIcon icon={timeOutline} /> {review.duration}
                      </span>
                    )}
                    {review.visitDate && (
                      <span className="mr-meta-chip">
                        <IonIcon icon={locationOutline} /> {formatDate(review.visitDate)}
                      </span>
                    )}
                  </div>
                )}

                {/* Photos strip */}
                {review.photos.length > 0 && (
                  <div className="mr-card-photos">
                    {review.photos.slice(0, 4).map((url, i) => (
                      <img key={i} src={url} alt={`Photo ${i + 1}`} className="mr-photo-thumb" />
                    ))}
                    {review.photos.length > 4 && (
                      <div className="mr-photo-more">+{review.photos.length - 4}</div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="mr-card-actions">
                  <button
                    className="mr-action-btn mr-action-btn--edit"
                    onClick={() => router.push(`/destination/${review.destId}`)}
                  >
                    <IonIcon icon={createOutline} /> Edit
                  </button>
                  <button
                    className="mr-action-btn mr-action-btn--delete"
                    onClick={() => setDeleteTarget(review)}
                  >
                    <IonIcon icon={trashOutline} /> Delete
                  </button>
                </div>
              </div>
            ))}

            <div style={{ height: 32 }} />
          </div>
        )}

        {/* Delete confirmation */}
        <FeedbackOverlay
          isOpen={!!deleteTarget}
          onDidDismiss={() => setDeleteTarget(null)}
          header="Delete Review"
          message={`Remove your review for "${deleteTarget?.destName}"? This cannot be undone.`}
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            { text: 'Delete', role: 'destructive', handler: confirmDelete },
          ]}
        />

        <IonToast isOpen={!!toastMsg} message={toastMsg} duration={2200} position="bottom" onDidDismiss={() => setToastMsg('')} />
      </IonContent>
    </IonPage>
  );
};

export default MyReviews;