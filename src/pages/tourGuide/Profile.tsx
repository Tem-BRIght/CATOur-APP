import React, { useState, useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonContent,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonIcon,
  IonButton,
  IonAvatar,
  IonImg,
  IonToggle,
  IonModal,
  IonSpinner,
  IonToast,
  useIonRouter,
} from '@ionic/react';
import {
  arrowBackOutline,
  personOutline,
  mailOutline,
  callOutline,
  calendarOutline,
  globeOutline,
  locationOutline,
  notificationsOutline,
  lockClosedOutline,
  logOutOutline,
  chevronForwardOutline,
  shieldCheckmarkOutline,
  createOutline,
  helpCircleOutline,
  closeOutline,
  cameraOutline,
} from 'ionicons/icons';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { firestore } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import './Profile.css';
import FeedbackOverlay from '../../components/FeedbackOverlay';

// ── Client-side image compression ──────────────────────────────────────────
// Mirrors the approach in userProfileService.uploadProfilePicture: resize to
// a max dimension via Canvas and export as a JPEG data-URL so it stays well
// under Firestore's 1MB document limit. Done here (not via that service)
// because this screen writes the image to two documents (users + tourGuides)
// in a single saveEdit() call rather than an immediate updateDoc.
async function compressImageToDataUrl(file: File, maxDim = 500, quality = 0.8): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are supported.');
  }

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      let { width, height } = img;
      if (width > height) {
        if (width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
      } else {
        if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Could not process image.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image.'));
    };

    img.crossOrigin = 'anonymous';
    img.src = objectUrl;
  });
}

interface UserProfile {
  name?: { firstname?: string; surname?: string; suffix?: string };
  email?: string;
  contactNumber?: string;
  img?: string | null;
  firstName?: string;
  lastName?: string;
  phone?: string;
  photoUrl?: string;
  age?: number | string;
  birthdate?: string | number;
  nationality?: string;
  address?: string;
}

const Profile: React.FC = () => {
  const history = useHistory();
  const router = useIonRouter();
  const { currentUser, logout } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // ── Load profile from Firestore ──────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const fetchProfile = async () => {
      try {
        let data: UserProfile = {};
        const userSnap = await getDoc(doc(firestore, 'users', currentUser.uid));
        if (userSnap.exists()) {
          data = userSnap.data() as UserProfile;
        }

        // Fallback to tourGuides if name missing
        const hasName = data?.name?.firstname || data?.name?.surname;
        if (!hasName) {
          const guideSnap = await getDoc(doc(firestore, 'tourGuides', currentUser.uid));
          if (guideSnap.exists()) {
            const guideData = guideSnap.data();
            data = {
              ...data,
              firstName: guideData['firstName'] || guideData['firstname'] || '',
              lastName:  guideData['lastName']  || guideData['lastname']  || '',
              phone:     guideData['phone']     || '',
              photoUrl:  guideData['photoUrl']  || '',
              email:     data.email || guideData['email'] || '',
            };
            if (!data.name) data.name = {};
            if (!data.name.firstname && data.firstName) data.name.firstname = data.firstName;
            if (!data.name.surname && data.lastName) data.name.surname = data.lastName;
            if (!data.contactNumber && data.phone) data.contactNumber = data.phone;
            if (!data.img && data.photoUrl) data.img = data.photoUrl;
          }
        }
        if (data.address && typeof data.address !== 'string') {
          data.address = (data.address as any).full || '';
        }
        setProfile(data);
      } catch (err) {
        console.error('Failed to load profile:', err);
      }
    };
    fetchProfile();
  }, [currentUser]);

  // ── UI state ──────────────────────────────────────────────────
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [showLogoutAlert, setShowLogoutAlert] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState('');
  const [age, setAge] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [nationality, setNationality] = useState('');
  const [address, setAddress] = useState('');

  // ── Avatar upload state ──────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null); // pending change, not yet saved
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Computed display values ──────────────────────────────────
  const displayName = profile?.name
    ? `${profile.name.firstname || ''} ${profile.name.surname || ''}`.trim()
    : 'Tour Guide';

  const displayEmail = profile?.email || '';
  const displayContact = profile?.contactNumber || '';
  const displayAge = profile?.age ? String(profile.age) : '';
  const displayBirthdate = profile?.birthdate ? String(profile.birthdate) : '';
  const displayNationality = profile?.nationality || '';
  const displayAddress = typeof profile?.address === 'string'
    ? profile.address
    : ((profile?.address as any)?.full || '');

  const openEdit = () => {
    setFullName(displayName);
    setEmail(displayEmail);
    setContact(displayContact);
    setAge(displayAge);
    setBirthdate(displayBirthdate);
    setNationality(displayNationality);
    setAddress(displayAddress);
    setAvatarDataUrl(null);
    setAvatarError('');
    setShowEditModal(true);
  };

  const handleBirthdateChange = (value: string) => {
    setBirthdate(value);
    if (!value) {
      setAge('');
      return;
    }

    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return;

    const today = new Date();
    let calculatedAge = today.getFullYear() - date.getFullYear();
    const birthdayHasNotPassed = today.getMonth() < date.getMonth()
      || (today.getMonth() === date.getMonth() && today.getDate() < date.getDate());
    if (birthdayHasNotPassed) calculatedAge -= 1;
    setAge(calculatedAge >= 0 ? String(calculatedAge) : '');
  };

  const pickAvatar = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // allow re-selecting the same file later
    e.target.value = '';
    if (!file) return;

    setAvatarError('');
    setAvatarUploading(true);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      const approxBytes = Math.ceil((dataUrl.length * 3) / 4);
      if (approxBytes > 900_000) {
        throw new Error('Image is still too large. Please choose a smaller photo.');
      }
      setAvatarDataUrl(dataUrl);
    } catch (err: any) {
      console.error('Failed to process avatar image:', err);
      setAvatarError(err?.message || 'Failed to process image.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/login', 'root', 'replace');
    } catch (err) {
      console.error('[TourGuide Profile] Logout failed:', err);
    }
  };

  const saveEdit = async () => {
    if (!currentUser) return;

    const fullNameValue = fullName.trim();
    const emailValue = email.trim();
    const contactValue = contact.trim();
    const ageValue = age.trim();
    const birthdateValue = birthdate.trim();
    const nationalityValue = nationality.trim();
    const addressValue = address.trim();
    const nameParts = fullNameValue.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ');

    // Use the newly-picked image if there is one, otherwise keep whatever
    // was already on the profile.
    const imgValue = avatarDataUrl || profile?.img || profile?.photoUrl || '';

    setSaving(true);
    try {
      const userDocRef = doc(firestore, 'users', currentUser.uid);
      const guideDocRef = doc(firestore, 'tourGuides', currentUser.uid);

      await setDoc(
        userDocRef,
        {
          name: {
            firstname: firstName,
            surname: lastName,
          },
          email: emailValue,
          contactNumber: contactValue,
          age: ageValue,
          birthdate: birthdateValue,
          nationality: nationalityValue,
          address: addressValue,
          img: imgValue,
        },
        { merge: true }
      );

      await setDoc(
        guideDocRef,
        {
          firstName,
          lastName,
          email: emailValue,
          phone: contactValue,
          age: ageValue,
          birthdate: birthdateValue,
          nationality: nationalityValue,
          address: addressValue,
          photoUrl: imgValue,
        },
        { merge: true }
      );

      await setDoc(
        guideDocRef,
        {
          firstName,
          lastName,
          email: emailValue,
          phone: contactValue,
          age: ageValue,
          birthdate: birthdateValue,
          nationality: nationalityValue,
          address: addressValue,
          photoUrl: imgValue,
        },
        { merge: true }
      );

      setProfile((prev) =>
        prev
          ? {
              ...prev,
              name: { ...(prev.name || {}), firstname: firstName, surname: lastName },
              email: emailValue,
              contactNumber: contactValue,
              firstName,
              lastName,
              phone: contactValue,
              age: ageValue,
              birthdate: birthdateValue,
              nationality: nationalityValue,
              address: addressValue,
              img: imgValue || null,
              photoUrl: imgValue,
            }
          : {
              name: { firstname: firstName, surname: lastName },
              email: emailValue,
              contactNumber: contactValue,
              firstName,
              lastName,
              phone: contactValue,
              age: ageValue,
              birthdate: birthdateValue,
              nationality: nationalityValue,
              address: addressValue,
              img: imgValue || null,
              photoUrl: imgValue,
            }
      );

      setAvatarDataUrl(null);
      setShowEditModal(false);
    } catch (err) {
      console.error('Failed to save profile:', err);
      setAvatarError('Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar className="profile-header">
          <div onClick={() => history.goBack()} className="profile-back-btn">
            <IonIcon icon={arrowBackOutline} />
          </div>
          <IonTitle className="profile-header-title">Profile</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="profile-content">
        <div className="profile-hero">
          <div className="profile-avatar-wrap">
            <IonAvatar className="profile-avatar-lg">
              {profile?.img || profile?.photoUrl ? (
                <IonImg src={profile.img || profile.photoUrl} alt="avatar" />
              ) : (
                <IonImg src="https://ionicframework.com/docs/img/demos/avatar.svg" alt="avatar" />
              )}
            </IonAvatar>
            <div className="profile-badge">
              <IonIcon icon={shieldCheckmarkOutline} />
            </div>
          </div>
          <h2 className="profile-name">{displayName}</h2>
          <span className="profile-role">Tour Guide · Pasig City</span>
        </div>

        <div className="profile-section">
          <p className="section-label">Personal Info</p>

          <div className="settings-row tappable" onClick={openEdit}>
            <div className="info-icon-wrap">
              <IonIcon icon={createOutline} />
            </div>
            <div className="info-text">
              <span className="info-value">Edit Profile</span>
              <span className="info-label">Name, email, contact number</span>
            </div>
            <IonIcon icon={chevronForwardOutline} className="chevron-icon" />
          </div>

          <div className="settings-row">
            <div className="info-icon-wrap">
              <IonIcon icon={personOutline} />
            </div>
            <div className="info-text">
              <span className="info-label">Full Name</span>
              <span className="info-value">{displayName}</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="info-icon-wrap">
              <IonIcon icon={mailOutline} />
            </div>
            <div className="info-text">
              <span className="info-label">Email</span>
              <span className="info-value">{displayEmail}</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="info-icon-wrap">
              <IonIcon icon={callOutline} />
            </div>
            <div className="info-text">
              <span className="info-label">Contact Number</span>
              <span className="info-value">{displayContact || '—'}</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="info-icon-wrap">
              <IonIcon icon={calendarOutline} />
            </div>
            <div className="info-text">
              <span className="info-label">Age / Birthdate</span>
              <span className="info-value">{displayAge || '—'}{displayBirthdate ? ` · ${displayBirthdate}` : ''}</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="info-icon-wrap">
              <IonIcon icon={globeOutline} />
            </div>
            <div className="info-text">
              <span className="info-label">Nationality</span>
              <span className="info-value">{displayNationality || '—'}</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="info-icon-wrap">
              <IonIcon icon={locationOutline} />
            </div>
            <div className="info-text">
              <span className="info-label">Address</span>
              <span className="info-value">{displayAddress || '—'}</span>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <p className="section-label">General</p>

          <div className="settings-row">
            <div className="info-icon-wrap">
              <IonIcon icon={notificationsOutline} />
            </div>
            <div className="info-text">
              <span className="info-value">Notifications</span>
              <span className="info-label">Session alerts & updates</span>
            </div>
            <IonToggle
              checked={notificationsOn}
              onIonChange={(e) => setNotificationsOn(e.detail.checked)}
              className="pasig-toggle"
            />
          </div>

          <div className="settings-row tappable" onClick={() => router.push('/tourguide/change-password')}>
            <div className="info-icon-wrap">
              <IonIcon icon={lockClosedOutline} />
            </div>
            <div className="info-text">
              <span className="info-value">Change Password</span>
              <span className="info-label">Update your credentials</span>
            </div>
            <IonIcon icon={chevronForwardOutline} className="chevron-icon" />
          </div>

          <div className="settings-row tappable">
            <div className="info-icon-wrap">
              <IonIcon icon={helpCircleOutline} />
            </div>
            <div className="info-text">
              <span className="info-value">Help Center</span>
              <span className="info-label">FAQs & support</span>
            </div>
            <IonIcon icon={chevronForwardOutline} className="chevron-icon" />
          </div>
        </div>

        <div className="profile-section">
          <IonButton
            expand="block"
            className="logout-btn"
            onClick={() => setShowLogoutAlert(true)}
          >
            <IonIcon icon={logOutOutline} slot="start" />
            Log Out
          </IonButton>
        </div>
      </IonContent>

      <IonModal
        isOpen={showEditModal}
        onDidDismiss={() => setShowEditModal(false)}
        className="edit-profile-modal"
        breakpoints={[0.9]}
        initialBreakpoint={0.9}
        handle={false}
      >
        <IonContent className="edit-modal-content" scrollY>
          <div className="edit-modal-header">
            <h3>Edit Profile</h3>
            <IonButton fill="clear" className="edit-close-btn" onClick={() => setShowEditModal(false)}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarChange}
          />

          <div className="edit-avatar-section">
            <div className="edit-avatar-wrap" onClick={pickAvatar}>
              <IonAvatar className="edit-avatar-preview">
                <IonImg
                  src={
                    avatarDataUrl ||
                    profile?.img ||
                    profile?.photoUrl ||
                    'https://ionicframework.com/docs/img/demos/avatar.svg'
                  }
                  alt="avatar preview"
                />
              </IonAvatar>
              <div className="edit-avatar-badge">
                {avatarUploading ? (
                  <IonSpinner name="crescent" />
                ) : (
                  <IonIcon icon={cameraOutline} />
                )}
              </div>
            </div>
            <span className="edit-avatar-hint" onClick={pickAvatar}>
              {avatarUploading ? 'Processing photo…' : 'Tap to change photo'}
            </span>
          </div>

          <div className="edit-field">
            <span className="edit-field-label">Full Name</span>
            <div className="edit-input-wrap">
              <IonIcon icon={personOutline} className="edit-field-icon" />
              <input
                className="edit-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full Name"
              />
            </div>
          </div>

          <div className="edit-field">
            <span className="edit-field-label">Email</span>
            <div className="edit-input-wrap">
              <IonIcon icon={mailOutline} className="edit-field-icon" />
              <input
                className="edit-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
              />
            </div>
          </div>

          <div className="edit-field">
            <span className="edit-field-label">Contact Number</span>
            <div className="edit-input-wrap">
              <IonIcon icon={callOutline} className="edit-field-icon" />
              <input
                className="edit-input"
                type="tel"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Contact Number"
              />
            </div>
          </div>

          <div className="edit-field-row">
            <div className="edit-field">
              <span className="edit-field-label">Age</span>
              <div className="edit-input-wrap">
                <IonIcon icon={personOutline} className="edit-field-icon" />
                <input className="edit-input" type="number" min="18" value={age} onChange={(e) => setAge(e.target.value)} placeholder="Age" />
              </div>
            </div>
            <div className="edit-field">
              <span className="edit-field-label">Birthdate</span>
              <div className="edit-input-wrap">
                <IonIcon icon={calendarOutline} className="edit-field-icon" />
                <input className="edit-input" type="date" value={birthdate} onChange={(e) => handleBirthdateChange(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="edit-field-row">
            <div className="edit-field">
              <span className="edit-field-label">Nationality</span>
              <div className="edit-input-wrap">
                <IonIcon icon={globeOutline} className="edit-field-icon" />
                <input className="edit-input" value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Nationality" />
              </div>
            </div>
            <div className="edit-field">
              <span className="edit-field-label">Address</span>
              <div className="edit-input-wrap">
                <IonIcon icon={locationOutline} className="edit-field-icon" />
                <input className="edit-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" />
              </div>
            </div>
          </div>

          <IonButton
            expand="block"
            className="save-btn"
            onClick={saveEdit}
            disabled={avatarUploading || saving}
          >
            {saving ? <IonSpinner name="crescent" /> : 'Save Changes'}
          </IonButton>
        </IonContent>
      </IonModal>

      <IonToast
        isOpen={!!avatarError}
        message={avatarError}
        duration={3500}
        color="danger"
        position="top"
        onDidDismiss={() => setAvatarError('')}
      />

      <FeedbackOverlay
        isOpen={showLogoutAlert}
        onDidDismiss={() => setShowLogoutAlert(false)}
        header="Log Out"
        message="Are you sure you want to log out?"
        buttons={[
          { text: 'Cancel', role: 'cancel' },
          {
            text: 'Log Out',
            role: 'confirm',
            handler: handleLogout,
          },
        ]}
      />
    </IonPage>
  );
};

export default Profile;