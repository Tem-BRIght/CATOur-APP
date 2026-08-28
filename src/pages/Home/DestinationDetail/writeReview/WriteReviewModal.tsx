import React, { useState, useRef, useEffect } from 'react';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons,
  IonButton, IonContent, IonIcon,
} from '@ionic/react';
import { arrowBack, chevronDown, chevronUp, locationOutline, timeOutline } from 'ionicons/icons';
import {
  collection, doc, runTransaction, serverTimestamp, deleteDoc, updateDoc,
} from 'firebase/firestore';
import { firestore } from '../../../../firebase';
import { getUserProfile } from '../../../../services/userProfileService';
import { buildReviewDocumentData, buildReviewPointerData } from '../../../../services/reviewService';
import './WriteReviewModal.css';

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface Props {
  isOpen: boolean;
  onDidDismiss: () => void;
  destinationId: string;
  destinationName: string;
  destinationCity?: string;
  destinationRank?: string;
  destinationDuration?: string;
  destinationThumbnail?: string;
  /** Current authenticated user — required to key reviews by userId */
  userId?: string;
  userName?: string;
  userAvatar?: string;
  /**
   * If provided, the modal opens in EDIT mode with these values pre-populated.
   */
  existingReview?: {
    overallRating: number;
    detailedRatings?: Record<string, number>;
    feeling?: string;
    review?: string;
    visitDate?: string;
    companion?: string;
    duration?: string;
    anonymous?: boolean;
    allowVenueReply?: boolean;
  } | null;
  onSubmit?: (data: ReviewFormData) => void;
}

export interface ReviewFormData {
  overallRating: number;
  detailedRatings: Record<string, number>;
  feeling: string;
  review: string;
  photos: File[];
  visitDate: string;
  companion: string;
  duration: string;
  anonymous: boolean;
  allowVenueReply: boolean;
}

const COMPANION_OPTIONS = ['Solo', 'Couple', 'Family', 'Friends'] as const;
const DURATION_OPTIONS  = ['Less than 1 hour', '1-2 hours', '2-3 hours', 'More than 3 hours'] as const;

const DETAILED_CATEGORIES = [
  { key: 'cleanliness',   label: 'Cleanliness'     },
  { key: 'accessibility', label: 'Accessibility'   },
  { key: 'value',         label: 'Value for Money' },
  { key: 'family',        label: 'Family-friendly' },
];

const REVIEW_GUIDELINES = [
  'Be honest and factual',
  'Focus on your personal experience',
  'Avoid personal information',
  'Be respectful',
];

/* ── Star picker ────────────────────────────────────────────────────────────── */
const StarPicker: React.FC<{
  value: number;
  onChange: (v: number) => void;
  size?: 'lg' | 'sm';
}> = ({ value, onChange, size = 'lg' }) => {
  const [hovered, setHovered] = useState(0);

  return (
    <div className={`wrm-star-picker ${size === 'sm' ? 'wrm-star-picker--sm' : ''}`}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className={`wrm-star-btn ${(hovered || value) >= n ? 'wrm-star-btn--filled' : ''}`}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(n)}
          aria-label={`Rate ${n} stars`}
        >
          ★
        </button>
      ))}
    </div>
  );
};


/* ── Main Modal ─────────────────────────────────────────────────────────────── */
const WriteReviewModal: React.FC<Props> = ({
  isOpen,
  onDidDismiss,
  destinationId,
  destinationName,
  destinationCity,
  destinationRank,
  destinationDuration,
  destinationThumbnail,
  userId,
  userName,
  userAvatar,
  existingReview,
  onSubmit,
}) => {
  /* form state */
  const [overallRating,    setOverallRating]    = useState(0);
  const [showDetailed,     setShowDetailed]     = useState(false);
  const [detailedRatings,  setDetailedRatings]  = useState<Record<string, number>>({});
  const [feeling,          setFeeling]          = useState('');
  const [review,           setReview]           = useState('');
  const [photos,           setPhotos]           = useState<File[]>([]);
  const [photoPreviews,    setPhotoPreviews]     = useState<string[]>([]);
  const [photoBase64s,     setPhotoBase64s]      = useState<string[]>([]);
  const [visitDate,        setVisitDate]        = useState('');
  const [companion,        setCompanion]        = useState('');
  const [duration,         setDuration]         = useState('');
  const [anonymous,        setAnonymous]        = useState(false);
  const [allowVenueReply,  setAllowVenueReply]  = useState(true);
  const [submitting,       setSubmitting]       = useState(false);
  const [submitError,      setSubmitError]      = useState('');
  const [resolvedName,     setResolvedName]     = useState('');
  const [resolvedAvatar,   setResolvedAvatar]   = useState('');
  const [profileLoading,   setProfileLoading]   = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Eagerly load profile when modal opens ────────────────────────────────── */
  useEffect(() => {
    if (!isOpen || !userId) return;

    setResolvedName(userName || '');
    setResolvedAvatar(userAvatar || '');

    setProfileLoading(true);
    getUserProfile(userId)
      .then(profile => {
        if (profile) {
          const fn   = profile.name?.firstname || '';
          const sn   = profile.name?.surname   || '';
          const full = [fn, sn].filter(Boolean).join(' ') || profile.nickname || '';
          if (full)        setResolvedName(full);
          if (profile.img) setResolvedAvatar(profile.img);
        }
      })
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, [isOpen, userId, userName, userAvatar]);

  const existingReviewKey = existingReview ? JSON.stringify({
    overallRating: existingReview.overallRating ?? 0,
    detailedRatings: existingReview.detailedRatings || {},
    feeling: existingReview.feeling || '',
    review: existingReview.review || '',
    visitDate: existingReview.visitDate || '',
    companion: existingReview.companion || '',
    duration: existingReview.duration || '',
    anonymous: existingReview.anonymous ?? false,
    allowVenueReply: existingReview.allowVenueReply ?? true,
  }) : '__new-review__';

  /* ── Pre-populate form when editing ────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) return;

    if (existingReview) {
      setOverallRating(existingReview.overallRating || 0);
      setDetailedRatings(existingReview.detailedRatings || {});
      setFeeling(existingReview.feeling || '');
      setReview(existingReview.review || '');
      setVisitDate(existingReview.visitDate || '');
      setCompanion(existingReview.companion || '');
      setDuration(existingReview.duration || '');
      setAnonymous(existingReview.anonymous ?? false);
      setAllowVenueReply(existingReview.allowVenueReply ?? true);
    } else {
      setOverallRating(0);
      setDetailedRatings({});
      setFeeling('');
      setReview('');
      setVisitDate('');
      setCompanion('');
      setDuration('');
      setAnonymous(false);
      setAllowVenueReply(true);
      setPhotos([]);
      setPhotoPreviews([]);
      setPhotoBase64s([]);
    }
    setSubmitError('');
    setSubmitting(false);
  }, [isOpen, existingReviewKey]);

  /* helpers */
  const reset = () => {
    setOverallRating(0); setShowDetailed(false); setDetailedRatings({});
    setFeeling(''); setReview(''); setPhotos([]); setPhotoPreviews([]);
    setVisitDate(''); setCompanion(''); setDuration('');
    setAnonymous(false); setAllowVenueReply(true);
    setPhotoBase64s([]);
    setResolvedName(''); setResolvedAvatar('');
    setSubmitting(false); setSubmitError('');
  };

  const handleDismiss = () => { reset(); onDidDismiss(); };

  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 5 - photos.length;
    const toAdd = files.slice(0, remaining);
    setPhotos(prev => [...prev, ...toAdd]);
    toAdd.forEach(f => {
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const MAX = 800;
          let { width, height } = img;
          if (width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
          if (height > MAX) { width = Math.round(width * MAX / height); height = MAX; }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.75);
          setPhotoPreviews(prev => [...prev, compressed]);
          setPhotoBase64s(prev => [...prev, compressed]);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(f);
    });
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
    setPhotoBase64s(prev => prev.filter((_, i) => i !== index));
  };

  /* ── Firestore submit ──────────────────────────────────────────────────────
   *
   * Document path: destinations/{destId}/reviews/{userId}
   * One review per user per destination. Edits recalculate the running average.
   *
   * IMPORTANT: photos are saved under the field name 'photos' (array of base64
   * strings) so that the admin feedback-rating page can read them directly.
   */
  const handleSubmit = async () => {
    if (!overallRating || submitting) return;

    if (!userId) {
      setSubmitError('You must be logged in to submit a review.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    const authorName   = anonymous ? '' : (resolvedName   || userName   || '');
    const authorAvatar = anonymous ? '' : (resolvedAvatar || userAvatar || '');

    try {
      const destRef   = doc(firestore, 'destinations', destinationId);
      const reviewRef = doc(firestore, 'destinations', destinationId, 'reviews', userId);

      await runTransaction(firestore, async (tx) => {
        const [destSnap, reviewSnap] = await Promise.all([
          tx.get(destRef),
          tx.get(reviewRef),
        ]);

        if (!destSnap.exists()) return;

        const destData  = destSnap.data();
        const isEdit    = reviewSnap.exists();
        const oldRating = isEdit ? (reviewSnap.data().overallRating as number) || 0 : 0;

        let prevCount  = (destData.reviewCount as number) || 0;
        let prevRating = (destData.rating      as number) || 0;

        let newCount: number;
        let newRating: number;

        if (isEdit) {
          newCount  = prevCount;
          newRating = prevCount > 1
            ? parseFloat(
                ((prevRating * prevCount - oldRating + overallRating) / prevCount).toFixed(1)
              )
            : overallRating;
        } else {
          newCount  = prevCount + 1;
          newRating = parseFloat(
            ((prevRating * prevCount + overallRating) / newCount).toFixed(1)
          );
        }

        // ── Write review doc ─────────────────────────────────────────────────
        // Keep one canonical structure so the detail page, my-reviews screen, and
        // admin consumers all read the same Firestore fields.
        const reviewPayload = buildReviewDocumentData({
          userId,
          destinationId,
          destinationName,
          destinationImage: '',
          authorName,
          authorAvatar,
          overallRating,
          detailedRatings,
          feeling,
          review,
          visitDate,
          companion,
          duration,
          anonymous,
          allowVenueReply,
          photos: photoBase64s,
          createdAt: new Date(),
          updatedAt: new Date(),
          isEdit,
        });
        tx.set(reviewRef, reviewPayload, { merge: true });

        // ── User review pointer (for MyReviews page) ─────────────────────────
        const userReviewPointerRef = doc(
          firestore, 'users', userId, 'reviews', destinationId
        );
        const pointerPayload = buildReviewPointerData({
          destinationId,
          destinationName,
          destinationImage: '',
          reviewText: review,
          overallRating,
          anonymous,
          createdAt: new Date(),
          updatedAt: new Date(),
          isEdit,
        });
        tx.set(userReviewPointerRef, pointerPayload, { merge: true });

        // ── Update destination aggregate ─────────────────────────────────────
        tx.update(destRef, {
          reviewCount: newCount,
          rating:      newRating,
        });
      });

      onSubmit?.({
        overallRating, detailedRatings, feeling, review,
        photos, visitDate, companion, duration, anonymous, allowVenueReply,
        resolvedName:   authorName,
        resolvedAvatar: authorAvatar,
      } as any);
      handleDismiss();

    } catch (err: any) {
      console.error('Failed to submit review:', err);
      setSubmitError('Failed to submit. Please try again.');
      setSubmitting(false);
    }
  };

  const isShort    = review.length < 50 && review.length > 0;
  const isEditMode = !!existingReview;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={handleDismiss}>
      {/* ── Header ── */}
      <IonHeader>
        <IonToolbar className="wrm-toolbar">
          <IonButtons slot="start">
            <IonButton className="dd-icon-btn" onClick={handleDismiss}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonTitle className="wrm-modal-title">
            {isEditMode ? 'Edit Your Review' : 'Write a Review'}
          </IonTitle>
          <IonButtons slot="end" />
        </IonToolbar>
      </IonHeader>

      <IonContent className="wrm-content">
        <div className="wrm-body">

          {/* ── Destination Info ── */}
          <div className="wrm-dest-info">
            {destinationThumbnail ? (
              <img src={destinationThumbnail} alt={destinationName} className="wrm-dest-thumb" />
            ) : (
              <div className="wrm-dest-thumb wrm-dest-thumb--placeholder"></div>
            )}
            <div className="wrm-dest-text">
              <p className="wrm-dest-name">{destinationName}</p>
              <div className="wrm-dest-meta">
                {destinationCity && (
                  <span className="wrm-dest-meta-item">
                    <IonIcon icon={locationOutline} className="wrm-dest-meta-icon" />
                    {destinationCity}
                  </span>
                )}
                {destinationRank && (
                  <span className="wrm-dest-rank">#{destinationRank} Most Visited</span>
                )}
              </div>
              {destinationDuration && (
                <span className="wrm-dest-duration">
                  <IonIcon icon={timeOutline} />
                  {destinationDuration}
                </span>
              )}
            </div>
          </div>

          <div className="wrm-divider" />

          {/* ── Reviewer Identity Preview ── */}
          {userId && (
            <div className="wrm-reviewer-preview">
              <div className="wrm-reviewer-preview-avatar">
                {anonymous ? (
                  <span className="wrm-reviewer-preview-anon">?</span>
                ) : resolvedAvatar ? (
                  <img src={resolvedAvatar} alt="You" />
                ) : profileLoading ? (
                  <span className="wrm-subtle-text">
                    {(resolvedName || userName || 'U')[0]?.toUpperCase()}
                  </span>
                ) : (
                  <span>
                    {(resolvedName || userName || 'U')[0]?.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="wrm-reviewer-preview-info">
                <span className="wrm-reviewer-preview-label">Posting as</span>
                <span className="wrm-reviewer-preview-name">
                  {anonymous ? 'Anonymous' : (resolvedName || userName || 'Traveller')}
                </span>
              </div>
            </div>
          )}

          <div className="wrm-divider" />

          {/* ── Overall Rating ── */}
          <div className="wrm-section">
            <div className="wrm-rating-center">
              <StarPicker value={overallRating} onChange={setOverallRating} />
              <p className="wrm-tap-hint">Tap to rate your overall experience</p>
            </div>

            <button
              type="button"
              className="wrm-detailed-toggle"
              onClick={() => setShowDetailed(v => !v)}
            >
              <IonIcon icon={showDetailed ? chevronUp : chevronDown} />
              {showDetailed ? 'Hide' : 'Add'} detailed ratings
            </button>

            {showDetailed && (
              <div className="wrm-detailed-grid">
                {DETAILED_CATEGORIES.map(({ key, label }) => (
                  <div key={key} className="wrm-detailed-row">
                    <span className="wrm-detailed-label">{label}</span>
                    <StarPicker
                      value={detailedRatings[key] || 0}
                      onChange={v => setDetailedRatings(prev => ({ ...prev, [key]: v }))}
                      size="sm"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="wrm-divider" />

          {/* ── Review Title ── */}
          <div className="wrm-section">
            <label className="wrm-field-label">Your Feel</label>
            <div className="wrm-input-wrap">
              <input
                name="review-feeling"
                className="wrm-input"
                placeholder="Summarize your experience..."
                maxLength={100}
                value={feeling}
                onChange={e => setFeeling(e.target.value)}
              />
              <span className="wrm-char-count">{feeling.length}/100</span>
            </div>
          </div>

          {/* ── Review Body ── */}
          <div className="wrm-section">
            <label className="wrm-field-label">Your Review</label>
            <div className="wrm-input-wrap">
              <textarea
                name="review-body"
                className="wrm-textarea"
                placeholder="What did you like or dislike? Share details about your visit..."
                maxLength={1000}
                rows={5}
                value={review}
                onChange={e => setReview(e.target.value)}
              />
              <span className="wrm-char-count">{review.length}/1000</span>
            </div>

            {isShort && (
              <div className="wrm-short-hint">
                <IonIcon icon={locationOutline} className="wrm-short-hint-icon" />
                <p>Your review is quite short. Consider adding what stood out during your visit and whether you'd recommend this to others.</p>
              </div>
            )}
          </div>

          <div className="wrm-divider" />

          {/* ── Photos ── */}
          <div className="wrm-section">
            <p className="wrm-section-label">Add Photos</p>
            <div className="wrm-photo-row">
              {photos.length < 5 && (
                <button
                  type="button"
                  className="wrm-photo-add"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="wrm-photo-add-icon">📷</span>
                  <span className="wrm-photo-add-label">Add Photo</span>
                </button>
              )}
              {photoPreviews.map((src, i) => (
                <div key={i} className="wrm-photo-preview">
                  <img src={src} alt={`Preview ${i + 1}`} />
                  <button type="button" className="wrm-photo-remove" onClick={() => removePhoto(i)}>×</button>
                </div>
              ))}
              <input
                name="review-photos"
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="wrm-hidden-file-input"
                aria-label="Upload review photos"
                title="Upload review photos"
                onChange={handlePhotoAdd}
              />
            </div>
            <p className="wrm-photo-hint">Max 5 photos · stored as compressed JPEG</p>
          </div>

          <div className="wrm-divider" />

          {/* ── Visit Details ── */}
          <div className="wrm-section">
            <p className="wrm-section-label">Visit Details <span className="wrm-optional">(Optional)</span></p>

            <div className="wrm-field-group">
              <label className="wrm-field-label">When did you visit?</label>
              <div className="wrm-date-wrap">
                <input
                  name="review-visit-date"
                  type="date"
                  className="wrm-date-input"
                  value={visitDate}
                  onChange={e => setVisitDate(e.target.value)}
                />
              </div>
            </div>

            <div className="wrm-field-group">
              <label className="wrm-field-label">Who did you go with?</label>
              <div className="wrm-chip-grid wrm-chip-grid--2col">
                {COMPANION_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    className={`wrm-chip ${companion === opt ? 'wrm-chip--active' : ''}`}
                    onClick={() => setCompanion(prev => prev === opt ? '' : opt)}
                  >
                    <span className="wrm-chip-icon">
                      {opt === 'Solo' ? '👤' : opt === 'Couple' ? '👫' : opt === 'Family' ? '👨‍👩‍👧' : '👥'}
                    </span>
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div className="wrm-field-group">
              <label className="wrm-field-label">How long did you stay?</label>
              <div className="wrm-chip-grid wrm-chip-grid--1col">
                {DURATION_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    className={`wrm-chip ${duration === opt ? 'wrm-chip--active' : ''}`}
                    onClick={() => setDuration(prev => prev === opt ? '' : opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="wrm-divider" />

          {/* ── Checkboxes ── */}
          <div className="wrm-section">
            <label className="wrm-checkbox-row">
              <input
                name="review-anonymous"
                type="checkbox"
                className="wrm-checkbox"
                checked={anonymous}
                onChange={e => setAnonymous(e.target.checked)}
              />
              <span className={`wrm-checkbox-custom ${anonymous ? 'wrm-checkbox-custom--checked' : ''}`} />
              <div className="wrm-checkbox-text">
                <span className="wrm-checkbox-label">Submit anonymously</span>
                <span className="wrm-checkbox-sub">Your name won't be visible</span>
              </div>
            </label>

            <label className="wrm-checkbox-row">
              <input
                name="review-allow-venue-reply"
                type="checkbox"
                className="wrm-checkbox"
                checked={allowVenueReply}
                onChange={e => setAllowVenueReply(e.target.checked)}
              />
              <span className={`wrm-checkbox-custom ${allowVenueReply ? 'wrm-checkbox-custom--checked' : ''}`} />
              <div className="wrm-checkbox-text">
                <span className="wrm-checkbox-label">Allow responses from venue</span>
                <span className="wrm-checkbox-sub">Venue can reply to your review</span>
              </div>
            </label>
          </div>

          {/* ── Guidelines ── */}
          <div className="wrm-guidelines">
            <div className="wrm-guidelines-header">
              <span className="wrm-guidelines-title">Review Guidelines</span>
            </div>
            <ul className="wrm-guidelines-list">
              {REVIEW_GUIDELINES.map(g => (
                <li key={g}>• {g}</li>
              ))}
            </ul>
          </div>

          {/* ── Error message ── */}
          {submitError && (
            <p className="wrm-submit-error">
              {submitError}
            </p>
          )}

          {/* ── Submit ── */}
          <form
            className="wrm-submit-area"
            onSubmit={e => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <button
              type="submit"
              className={`wrm-submit-btn ${(!overallRating || submitting) ? 'wrm-submit-btn--disabled' : ''}`}
              disabled={!overallRating || submitting}
            >
              {submitting
                ? (isEditMode ? 'Saving…' : 'Submitting…')
                : (isEditMode ? 'Save Changes' : 'Submit Review')}
            </button>
            <button type="button" className="wrm-cancel-btn" onClick={handleDismiss}>
              Cancel
            </button>
          </form>

        </div>
      </IonContent>
    </IonModal>
  );
};

export default WriteReviewModal;