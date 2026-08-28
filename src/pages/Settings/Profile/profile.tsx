import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { firestore } from '../../../firebase';
import {
  IonPage, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon,
  IonContent, IonAvatar, IonTitle, IonList, IonItem, IonLabel,
  IonBackButton, IonInput, IonSelect, IonSelectOption
} from '@ionic/react';
import {
  ellipsisVertical, camera, person, location, mail,
  save, close, bookOutline, homeOutline, createOutline,
  calendarOutline, peopleOutline, flagOutline, checkmarkCircle, ellipseOutline
} from 'ionicons/icons';
import { useAuth } from '../../../context/AuthContext';
import {
  updateUserProfile,
  uploadProfilePicture,
  getUserProfile,
  UserProfile,
  UserName,
} from '../../../services/userProfileService';
import { getProfilePicCache, setProfilePicCache } from '../../../utils/profileImageStorage';
import OtherSelect from '../../../components/OtherSelect';
import './profile.css';


const RELIGIONS = [
  'Roman Catholic','Islam','Evangelical','Iglesia ni Cristo','Seventh-day Adventist',
  'United Church of Christ','Baptist','Other Christian','Buddhist','Hindu','Non-religious','Other',
];

const NATIONALITIES = [
  'Filipino','American','Japanese','Korean','Chinese',
  'British','Australian','Canadian','Indian','Other',
];

function getSelectValue(value: string | undefined, options: string[]) {
  if (!value) return '';
  const matchingOption = options.find(option => option.toLowerCase() === value.toLowerCase());
  return matchingOption && matchingOption !== 'Other' ? matchingOption : 'Other';
}


function formatAddress(address: any): string {
  if (!address) return '-';
  if (typeof address === 'string') return address.trim() || '-';
  if (typeof address === 'object') {
    if (address.full) return String(address.full).trim() || '-';
    const parts = [address.brgy || address.barangay, address.city, address.district, address.region].filter(Boolean);
    return parts.length ? parts.join(', ') : '-';
  }
  return String(address).trim() || '-';
}

const Profile: React.FC = () => {
  const history = useHistory();
  const { user } = useAuth();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<UserProfile>>({});
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unsubRef    = useRef<Unsubscribe | null>(null);

  const [otherNationality, setOtherNationality] = useState('');
  const [otherReligion, setOtherReligion] = useState('');

  // ── Real-time Firestore listener ─────────────────────────────────────────
  const subscribeToProfile = useCallback((uid: string) => {
    // Tear down any existing subscription first
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    const userDocRef = doc(firestore, 'users', uid);
    const unsub = onSnapshot(
      userDocRef,
      (snap) => {
        if (snap.exists()) {
          const profile = snap.data() as UserProfile;
          setUserProfile(profile);
          // If the Auth user already has emailVerified=true but the Firestore
          // profile is not yet marked, update the profile document so admin
          // UIs that read Firestore stay in sync.
          if (user?.uid && user.emailVerified && !profile.emailVerified) {
            updateUserProfile(user.uid, { emailVerified: true }).catch(err => {
              console.debug('[Profile] failed to sync emailVerified to Firestore:', err);
            });
          }
        } else {
          setUserProfile(null);
        }
      },
      (err) => {
        console.error('[Profile] onSnapshot error:', err);
        setError('Failed to load profile. Please try again.');
      },
    );

    unsubRef.current = unsub;
  }, []);

  // Subscribe when the authenticated user is ready
  useEffect(() => {
    if (!user?.uid) return;
    subscribeToProfile(user.uid);

    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [user?.uid, subscribeToProfile]);

  // Image upload
  const handleImageClick = () => {
    if (!isEditing && userProfile) {
      handleEditProfile();
      setTimeout(() => fileInputRef.current?.click(), 50);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setIsSaving(true);
    try {
      const downloadURL = await uploadProfilePicture(user.uid, file);
      setEditForm(prev => ({ ...prev, img: downloadURL }));
      setProfilePicCache(downloadURL);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to upload image. File may be too large.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputChange = (field: keyof UserProfile, value: any) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handleNameChange = (subField: keyof UserName, value: string) => {
    setEditForm(prev => ({
      ...prev,
      name: {
        firstname: prev.name?.firstname ?? userProfile?.name?.firstname ?? '',
        surname:   prev.name?.surname   ?? userProfile?.name?.surname   ?? '',
        suffix:    prev.name?.suffix    ?? userProfile?.name?.suffix    ?? '',
        [subField]: value,
      },
    }));
  };

  const handleEditProfile = () => {
    if (userProfile) {
      const initialEdit = typeof userProfile.address === 'string'
        ? userProfile.address.trim()
        : formatAddress(userProfile.address);
      const savedNationality = userProfile.nationality || '';
      const savedReligion = userProfile.religion || '';
      const nationalityValue = getSelectValue(savedNationality, NATIONALITIES);
      const religionValue = getSelectValue(savedReligion, RELIGIONS);
      setOtherNationality(nationalityValue === 'Other' ? savedNationality : '');
      setOtherReligion(religionValue === 'Other' ? savedReligion : '');
      setEditForm({
        ...userProfile,
        address: initialEdit,
        nationality: nationalityValue === 'Other' ? 'other' : nationalityValue,
        religion: religionValue,
      });
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditForm({});
    setOtherNationality('');
    setOtherReligion('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async () => {
    if (!user || !userProfile) return;
    setIsSaving(true);
    setError(null);
    try {
      if (!editForm.name?.firstname?.trim()) throw new Error('First name is required');
      if (!editForm.nickname?.trim())        throw new Error('Nickname is required');

      if (editForm.dateOfBirth) {
        const dob = new Date(editForm.dateOfBirth);
        const today = new Date();
        let calculatedAge = today.getFullYear() - dob.getFullYear();
        const monthDifference = today.getMonth() - dob.getMonth();
        if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dob.getDate())) calculatedAge--;
        if (Number.isNaN(dob.getTime()) || dob > today || calculatedAge < 10) {
          throw new Error('You must be at least 10 years old.');
        }
      }

      const nextAddress = (editForm.address as string | undefined)?.trim() ?? '';
      const nextNationality = editForm.nationality === 'other'
        ? otherNationality.trim()
        : editForm.nationality?.trim() ?? userProfile.nationality ?? '';
      const nextReligion = editForm.religion === 'Other'
        ? otherReligion.trim()
        : editForm.religion ?? userProfile.religion ?? '';
      if (!nextNationality) throw new Error('Nationality is required');
      if (!nextReligion) throw new Error('Religion is required');
      const toSave: Partial<UserProfile> = {
        email: userProfile.email || user?.email || '',
        dateOfBirth: editForm.dateOfBirth ?? userProfile.dateOfBirth ?? '',
        age: editForm.age ?? userProfile.age ?? '',
        nickname: editForm.nickname?.trim() ?? userProfile.nickname ?? '',
        nationality: nextNationality,
        contactNumber: editForm.contactNumber ?? userProfile.contactNumber ?? '',
        gender: editForm.gender ?? userProfile.gender ?? '',
        religion: nextReligion,
        img: editForm.img ?? userProfile.img ?? null,
        name: {
          firstname: editForm.name?.firstname ?? userProfile.name?.firstname ?? '',
          surname:   editForm.name?.surname   ?? userProfile.name?.surname   ?? '',
          suffix:    editForm.name?.suffix    ?? userProfile.name?.suffix    ?? '',
        },
        address: nextAddress,
      };

      // Optimistic UI: apply changes locally so the user sees updates immediately.
      const prevSnapshot = userProfile;
      setUserProfile(prev => ({ ...(prev || {}), ...toSave } as UserProfile));

      try {
        await updateUserProfile(user.uid, toSave);

        // Re-read authoritative document in background and reconcile.
        try {
          const fresh = await getUserProfile(user.uid);
          if (fresh) setUserProfile(fresh);
        } catch (err) {
          // If refresh fails, keep optimistic state — it's better than stale UI.
          console.debug('[Profile] failed to re-fetch profile after save:', err);
        }

        if (toSave.img) setProfilePicCache(toSave.img);
        setIsEditing(false);
        setEditForm({});
        setOtherNationality('');
        setOtherReligion('');
      } catch (writeErr) {
        // Revert optimistic update on failure and surface error.
        setUserProfile(prevSnapshot);
        throw writeErr;
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const ageValidationLabel = (() => {
    if (!editForm.dateOfBirth) return 'Age will be calculated from your date of birth.';

    const dob = new Date(editForm.dateOfBirth);
    const today = new Date();
    let calculatedAge = today.getFullYear() - dob.getFullYear();
    const monthDifference = today.getMonth() - dob.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dob.getDate())) calculatedAge--;

    if (Number.isNaN(dob.getTime()) || dob > today) return 'Enter a valid date of birth.';
    if (calculatedAge < 10) return 'You must be at least 10 years old.';
    return `Age: ${calculatedAge} years old`;
  })();

  const ageValidationError = ageValidationLabel === 'Enter a valid date of birth.' ||
    ageValidationLabel === 'You must be at least 10 years old.';

  if (!userProfile && !error) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start"><IonBackButton defaultHref="/settings" /></IonButtons>
            <IonTitle>Profile</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="profile-content">
          <div className="empty-state">Loading profile…</div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings" />
          </IonButtons>
          <IonTitle>Profile</IonTitle>
          <IonButtons slot="end">
            {!isEditing && (
              <IonButton onClick={handleEditProfile}>
                <IonIcon slot="start" />
                Edit
              </IonButton>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="profile-content">
        <input name="profile-photo" ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />

        {error && (
          <div className="error-banner">
            <p>{error}</p>
            <IonButton size="small" fill="outline" onClick={() => window.location.reload()}>Retry</IonButton>
          </div>
        )}

        {userProfile && (
          <>
            {/* Hero section */}
            <div className={`profile-page-top-section${isEditing ? ' profile-page-top-section--editing' : ''}`}>
              <div className="profile-page-photo-container" onClick={handleImageClick} role="button" tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleImageClick()}>
                <div className={`profile-page-avatar-wrapper${isEditing ? ' profile-page-avatar-wrapper--editing' : ''}`}>
                  <IonAvatar className="profile-page-avatar">
                    <img
                      src={editForm.img || userProfile.img || '/assets/images/Temporary.png'}
                      alt="Profile"
                      onError={e => (e.currentTarget.src = '/assets/images/Temporary.png')}
                    />
                  </IonAvatar>
                  <div className="camera-overlay">
                    <IonIcon icon={camera} />
                    <span>Change photo</span>
                  </div>
                  {isEditing && (
                    <div className="camera-icon"><IonIcon icon={camera} /></div>
                  )}
                </div>
              </div>

              {!isEditing && (
                <>
                  <div className="profile-page-name-row">
                    <h1 className="profile-page-name">
                      {userProfile.name?.firstname} {userProfile.name?.surname} {userProfile.name?.suffix}
                    </h1>
                    <span
                      className={`email-verified-badge${user?.emailVerified ? ' email-verified-badge--active' : ''}`}
                      title={user?.emailVerified ? 'Email verified' : 'Email not verified'}
                      onClick={() => !user?.emailVerified && history.push('/settings/verify-email')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !user?.emailVerified && history.push('/settings/verify-email')}
                    >
                      <IonIcon icon={user?.emailVerified ? checkmarkCircle : ellipseOutline} />
                    </span>
                  </div>
                  <p className="profile-page-username">@{userProfile.nickname}</p>
                </>
              )}
            </div>

            {/* Personal info – clean, non-clickable list */}
            <div className="personal-info-section">
              {!isEditing ? (
                <>
                  <h2>Personal Information</h2>
                  <IonList lines="none" className="info-list">
                    <IonItem>
                      <IonIcon icon={calendarOutline} slot="start" />
                      <IonLabel>
                        <h3>Date of Birth</h3>
                        <p>{userProfile.dateOfBirth ? new Date(userProfile.dateOfBirth).toLocaleDateString() : '-'}</p>
                      </IonLabel>
                    </IonItem>

                    <IonItem>
                      <IonIcon icon={peopleOutline} slot="start" />
                      <IonLabel>
                        <h3>Age</h3>
                        <p>{userProfile.age ? `${userProfile.age} years old` : '-'}</p>
                      </IonLabel>
                    </IonItem>

                    <IonItem>
                      <IonIcon icon={person} slot="start" />
                      <IonLabel>
                        <h3>Gender</h3>
                        <p>{userProfile.gender || '-'}</p>
                      </IonLabel>
                    </IonItem>

                    <IonItem>
                      <IonIcon icon={flagOutline} slot="start" />
                      <IonLabel>
                        <h3>Nationality</h3>
                        <p>{userProfile.nationality ? userProfile.nationality.charAt(0).toUpperCase() + userProfile.nationality.slice(1) : '-'}</p>
                      </IonLabel>
                    </IonItem>

                    <IonItem>
                      <IonIcon icon={homeOutline} slot="start" />
                      <IonLabel>
                        <h3>Address</h3>
                        <p>{formatAddress(userProfile.address)}</p>
                      </IonLabel>
                    </IonItem>

                    <IonItem>
                      <IonIcon icon={bookOutline} slot="start" />
                      <IonLabel>
                        <h3>Religion</h3>
                        <p>{userProfile.religion || '-'}</p>
                      </IonLabel>
                    </IonItem>

                    <IonItem>
                      <IonIcon icon={mail} slot="start" />
                      <IonLabel>
                        <h3>Email</h3>
                        <p>{userProfile.email}</p>
                      </IonLabel>
                    </IonItem>

                  </IonList>
                </>
              ) : (
                <>
                  <h2 className="edit-section-label">Name</h2>
                  <IonList className="edit-list">
                    <IonItem>
                      <IonLabel position="stacked">First Name</IonLabel>
                      <IonInput value={editForm.name?.firstname} placeholder="Enter first name" onIonChange={e => handleNameChange('firstname', e.detail.value!)} />
                    </IonItem>
                    <IonItem>
                      <IonLabel position="stacked">Surname</IonLabel>
                      <IonInput value={editForm.name?.surname} placeholder="Enter surname" onIonChange={e => handleNameChange('surname', e.detail.value!)} />
                    </IonItem>
                    <IonItem>
                      <IonLabel position="stacked">Suffix (optional)</IonLabel>
                      <IonInput value={editForm.name?.suffix} placeholder="e.g. Jr., III" onIonChange={e => handleNameChange('suffix', e.detail.value!)} />
                    </IonItem>
                    <IonItem>
                      <IonLabel position="stacked">Nickname</IonLabel>
                      <IonInput value={editForm.nickname} placeholder="Enter nickname" onIonChange={e => handleInputChange('nickname', e.detail.value!)} />
                    </IonItem>
                  </IonList>

                  <h2 className="edit-section-label">Personal Details</h2>
                  <IonList className="edit-list">
                    <IonItem>
                      <IonLabel position="stacked">Date of Birth</IonLabel>
                      <IonInput type="date" value={editForm.dateOfBirth?.slice(0, 10)}
                        onIonChange={e => {
                          const val = e.detail.value!;
                          handleInputChange('dateOfBirth', val);
                          if (val) {
                            const today = new Date();
                            const dob = new Date(val);
                            let calcAge = today.getFullYear() - dob.getFullYear();
                            const m = today.getMonth() - dob.getMonth();
                            if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) calcAge--;
                            if (calcAge >= 0) handleInputChange('age', calcAge);
                          }
                        }}
                      />
                      <IonLabel className={`age-validation-label${ageValidationError ? ' age-validation-label--error' : ''}`}>
                        {ageValidationLabel}
                      </IonLabel>
                    </IonItem>
                    <OtherSelect
                      label="Nationality"
                      options={NATIONALITIES}
                      value={editForm.nationality || ''}
                      otherValue={otherNationality}
                      onChange={value => handleInputChange('nationality', value)}
                      onOtherChange={setOtherNationality}
                    />
                    <OtherSelect
                      label="Religion"
                      options={RELIGIONS}
                      value={editForm.religion || ''}
                      otherValue={otherReligion}
                      onChange={value => handleInputChange('religion', value)}
                      onOtherChange={setOtherReligion}
                    />
                    <IonItem>
                      <IonLabel position="stacked">Gender</IonLabel>
                      <IonSelect placeholder="Select gender" value={editForm.gender || ''} onIonChange={e => handleInputChange('gender', e.detail.value)}>
                        {['Male', 'Female', 'Non-binary', 'Prefer not to say'].map(g => (
                          <IonSelectOption key={g} value={g}>{g}</IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonItem>
                  </IonList>

                  <h2 className="edit-section-label">Address</h2>
                  <IonList className="edit-list">
                    <IonItem>
                      <IonLabel position="stacked">Address</IonLabel>
                      <IonInput
                        value={editForm.address as string || ''}
                        placeholder="Enter your full address"
                        onIonChange={e => handleInputChange('address', e.detail.value ?? '')}
                      />
                    </IonItem>
                  </IonList>

                  <IonToolbar className="edit-actions">
                    <IonButtons slot="start">
                      <IonButton color="medium" onClick={handleCancelEdit}>
                        <IonIcon icon={close} slot="start" />Cancel
                      </IonButton>
                    </IonButtons>
                    <IonButtons slot="end">
                      <IonButton color="primary" onClick={handleSave} disabled={isSaving}>
                        <IonIcon slot="start" />Save
                      </IonButton>
                    </IonButtons>
                  </IonToolbar>
                </>
              )}
            </div>
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Profile;
