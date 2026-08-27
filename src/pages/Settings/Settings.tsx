import React, { useState, useEffect, useRef } from 'react';
import {
  IonButtons,
  IonBackButton,
  IonAvatar,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonIcon,
  IonAlert,
} from '@ionic/react';
import { useIonRouter, useIonViewWillEnter } from '@ionic/react';
import {
  heartOutline,
  starOutline,
  person,
  notificationsOutline,
  globeOutline,
  shieldCheckmarkOutline,
  helpCircleOutline,
  headsetOutline,
  warningOutline,
  phonePortraitOutline,
  documentTextOutline,
  lockClosedOutline,
  logOutOutline,
  chevronForwardOutline,
  personCircleOutline,
  scanOutline,
  checkmarkCircle,
  ellipseOutline,
} from 'ionicons/icons';
import { doc, onSnapshot, setDoc, Timestamp, Unsubscribe } from 'firebase/firestore';
import { firestore } from '../../firebase';

import { useAuth } from '../../context/AuthContext';
import { getProfileCompletion, UserProfile } from '../../services/userProfileService';
import { getProfilePicCache } from '../../utils/profileImageStorage';
import './Settings.css';

const Settings: React.FC = () => {
  const router = useIonRouter();
  const { user, logout, isLoading: authLoading } = useAuth();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showLogoutAlert, setShowLogoutAlert] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showDeleteAccountAlert, setShowDeleteAccountAlert] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Keep ref to unsubscribe so we can clean up
  const unsubRef = useRef<Unsubscribe | null>(null);

  // ── Real-time Firestore listener ──────────────────────────────────────────
  const subscribeToProfile = (uid: string) => {
    // Clean up any existing subscription first
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    const userDocRef = doc(firestore, 'users', uid);
    const unsub = onSnapshot(
      userDocRef,
      (snap) => {
        if (snap.exists()) {
          setUserProfile(snap.data() as UserProfile);
        } else {
          setUserProfile(null);
        }
      },
      (err) => {
        console.error('[Settings] Profile snapshot error:', err);
      },
    );

    unsubRef.current = unsub;
  };

  // Subscribe when user is available
  useEffect(() => {
    if (!user?.uid) return;
    subscribeToProfile(user.uid);

    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [user?.uid]);

  // Re-subscribe (or re-fresh) every time the Settings page becomes active.
  // This catches the case where the user navigated to Profile, edited data,
  // came back — the onSnapshot stream should already have fired, but this
  // ensures the subscription is alive if it was torn down.
  useIonViewWillEnter(() => {
    if (user?.uid && !unsubRef.current) {
      subscribeToProfile(user.uid);
    }
  });

  // ── Navigation ────────────────────────────────────────────────────────────
  const onItemClick = (label: string) => {
    switch (label) {
      case 'Favorites':        router.push('/favorites');                   break;
      case 'My Reviews':       router.push('/my-reviews');                  break;
      case 'Tour Guide':       router.push('/tour');                        break;
      case 'Scan':             router.push('/scan');                        break;
      case 'Privacy Settings': router.push('/settings/permissions');       break;
      case 'Help Center':      router.push('/settings/help');               break;
      case 'Contact Support':  router.push('/settings/contact-support');    break;
      case 'Report Problem':   router.push('/settings/report-problem');     break;
      case 'About App':        router.push('/settings/about');              break;
      case 'Terms & Privacy':  router.push('/settings/terms');              break;
      case 'Change Password': router.push('/settings/change-password');     break;
      default:                 console.log('[Settings] unhandled:', label);
    }
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    setLoggingOut(true);
    // Unsubscribe before logging out
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    try {
      await logout();
    } catch (err) {
      console.error('[Settings] Logout failed:', err);
    } finally {
      setLoggingOut(false);
    }
  };

  const deletionDate = userProfile?.deletionAt instanceof Timestamp
    ? userProfile.deletionAt.toDate()
    : userProfile?.deletionAt ? new Date(userProfile.deletionAt) : null;

  const handleDeleteAccount = async () => {
    if (!user?.uid || deletingAccount) return;
    setDeletingAccount(true);
    try {
      const deleteAfter = new Date();
      deleteAfter.setDate(deleteAfter.getDate() + 30);
      await setDoc(doc(firestore, 'users', user.uid), {
        deletionStatus: 'scheduled',
        deletionAt: Timestamp.fromDate(deleteAfter),
      }, { merge: true });
      await logout();
      router.push('/login', 'root', 'replace');
    } catch (err) {
      console.error('[Settings] Account deletion scheduling failed:', err);
    } finally {
      setDeletingAccount(false);
      setShowDeleteAccountAlert(false);
    }
  };

  const handleCancelAccountDeletion = async () => {
    if (!user?.uid || deletingAccount) return;
    setDeletingAccount(true);
    try {
      await setDoc(doc(firestore, 'users', user.uid), {
        deletionStatus: 'active',
        deletionAt: null,
      }, { merge: true });
    } catch (err) {
      console.error('[Settings] Account deletion cancellation failed:', err);
    } finally {
      setDeletingAccount(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const displayName = userProfile
    ? [userProfile.name?.firstname, userProfile.name?.surname, userProfile.name?.suffix]
        .filter(Boolean).join(' ').trim() || userProfile.nickname || 'User'
    : user?.displayName || 'User';

  const nickname = userProfile?.nickname
    ? `@${userProfile.nickname}`
    : user?.email?.split('@')[0]
      ? `@${user.email!.split('@')[0]}`
      : '';

  const avatarSrc =
    userProfile?.img ||
    getProfilePicCache() ||
    '/assets/images/Temporary.png';

  // ── Profile completion ────────────────────────────────────────────────────
  const completionPct = getProfileCompletion(userProfile);

  // ── Sub-component ─────────────────────────────────────────────────────────
  const Item = ({
    icon, color, label, onClick, extraClass = '',
  }: {
    icon: string; color: string; label: string;
    onClick: () => void; extraClass?: string;
  }) => (
    <div className={`item ${extraClass}`} onClick={onClick}>
      <div className={`icon ${color}`}>
        <IonIcon icon={icon} />
      </div>
      <span>{label}</span>
      <IonIcon icon={chevronForwardOutline} className="arrow" />
    </div>
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/home" /></IonButtons>
          <IonTitle>Settings</IonTitle>
        </IonToolbar>
      </IonHeader>

      {/* ── Profile card ───────────────────────────────────────────────── */}
      <div
        className="settings-profile-top-section"
        role="button"
        tabIndex={0}
        onClick={() => router.push('/profile')}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && router.push('/profile')}
        style={{ cursor: 'pointer' }}
      >
        <div className="settings-profile-photo-container">
          <div className="settings-avatar-wrapper">
            <IonAvatar className="settings-profile-avatar">
              <img
                src={avatarSrc}
                alt="Profile"
                onError={e => (e.currentTarget.src = '/assets/images/Temporary.png')}
              />
            </IonAvatar>
          </div>
        </div>

        {!userProfile ? (
          <>
            <h2 className="settings-profile-name">Loading…</h2>
            <p className="settings-profile-username">—</p>
          </>
        ) : (
          <>
            <div className="settings-name-row">
              <h2 className="settings-profile-name">{displayName}</h2>
              <span
                className={`email-verified-badge${user?.emailVerified ? ' email-verified-badge--active' : ''}`}
                title={user?.emailVerified ? 'Email verified' : 'Email not verified'}
              >
                <IonIcon icon={user?.emailVerified ? checkmarkCircle : ellipseOutline} />
              </span>
            </div>
            {nickname && <p className="settings-profile-username">{nickname}</p>}
          </>
        )}

        <div className="view-profile-link">
          View Profile
          {userProfile && (
            <span className="completion-pct">&nbsp;· {completionPct}%</span>
          )}
        </div>
      </div>

      <IonContent scrollY={true} style={{ '--overflow': 'scroll' }}>

        {/* ── Profile ────────────────────────────────────────────────────── */}
        <div className="section">
          <p className="section-title">Profile</p>
          <div className="card">
            <Item icon={heartOutline}  color="red"    label="Favorites"  onClick={() => onItemClick('Favorites')}  />
            <Item icon={starOutline}   color="yellow" label="My Reviews" onClick={() => onItemClick('My Reviews')} />
            <Item icon={person}        color="blue"   label="Tour Guide" onClick={() => onItemClick('Tour Guide')} />
            <Item icon={scanOutline}   color="blue"   label="Scan"       onClick={() => onItemClick('Scan')}       />
          </div>
        </div>

        {/* ── Privacy & Security ───────────────────────────────────────────── */}
        <div className="section">
          <p className="section-title">Privacy & Security</p>
          <div className="card">
            <Item icon={shieldCheckmarkOutline} color="cyan" label="Privacy Settings" onClick={() => onItemClick('Privacy Settings')} />
            <Item icon={lockClosedOutline} color="blue" label="Change Password" onClick={() => onItemClick('Change Password')} />
          </div>
        </div>

        {/* ── Support ────────────────────────────────────────────────────── */}
        <div className="section">
          <p className="section-title">Support</p>
          <div className="card">
            <Item icon={helpCircleOutline} color="cyan" label="Help Center"     onClick={() => onItemClick('Help Center')}     />
            <Item icon={headsetOutline}    color="mint" label="Contact Support" onClick={() => onItemClick('Contact Support')} />
            <Item icon={warningOutline}    color="red"  label="Report Problem"  onClick={() => onItemClick('Report Problem')}  />
          </div>
        </div>

        {/* ── About ──────────────────────────────────────────────────────── */}
        <div className="section">
          <p className="section-title">About</p>
          <div className="card">
            <Item icon={phonePortraitOutline} color="gray" label="About App"       onClick={() => onItemClick('About App')}       />
            <Item icon={documentTextOutline}  color="gray" label="Terms & Privacy" onClick={() => onItemClick('Terms & Privacy')} />
            {deletionDate ? (
              <div className="account-deletion-notice">
                <strong>Scheduled for deletion</strong>
                <span>Your account will be permanently deleted on {deletionDate.toLocaleDateString()}.</span>
                <button type="button" onClick={handleCancelAccountDeletion} disabled={deletingAccount}>
                  {deletingAccount ? 'Restoring…' : 'Cancel deletion'}
                </button>
              </div>
            ) : (
              <div className="item delete-account-item" onClick={() => setShowDeleteAccountAlert(true)}>
                <div className="icon outline"><IonIcon icon={warningOutline} /></div>
                <span>Delete Account</span>
                <IonIcon icon={chevronForwardOutline} className="arrow" />
              </div>
            )}
            <Item
              icon={logOutOutline}
              color="red-outline"
              label="Logout"
              onClick={() => setShowLogoutAlert(true)}
              extraClass="logout"
            />
            
          </div>

          <div className="footer">
            <p>Version 1.0.0</p>
            <p>© 2025 All rights reserved</p>
          </div>
        </div>

        {/* ── Scroll spacer so footer clears tab bar ─────────────────────── */}
        <div style={{ height: '32px' }} />

        {/* ── Logout confirmation ─────────────────────────────────────────── */}
        <IonAlert
          isOpen={showLogoutAlert}
          onDidDismiss={() => setShowLogoutAlert(false)}
          header="Confirm Logout"
          message="Are you sure you want to logout?"
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            { text: 'Logout', handler: handleLogout },
          ]}
        />
        <IonAlert
          isOpen={showDeleteAccountAlert}
          onDidDismiss={() => setShowDeleteAccountAlert(false)}
          header="Schedule account deletion?"
          message="Your account will remain recoverable for 30 days, then be permanently deleted."
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            { text: deletingAccount ? 'Scheduling…' : 'Schedule deletion', role: 'destructive', handler: handleDeleteAccount },
          ]}
        />

      </IonContent>
    </IonPage>
  );
};

export default Settings;