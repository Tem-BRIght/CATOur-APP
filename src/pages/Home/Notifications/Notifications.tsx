// src/pages/Notifications/Notifications.tsx
import React, { useState, useEffect } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonIcon, IonSpinner,
} from '@ionic/react';
import {
  heart, star, location, informationCircle,
  notifications, checkmarkDone, qrCode,
} from 'ionicons/icons';
import { useAuth } from '../../../context/AuthContext';
import {
  AppNotification, NotifType,
  subscribeNotifications,
  markNotifRead,
  markAllNotifsRead,
  relativeTime,
} from '../../../services/notificationsService';
import './Notifications.css';


// ── Icon / colour map ─────────────────────────────────────────────────────────

const TYPE_META: Record<NotifType, { icon: string; cls: string }> = {
  like:        { icon: heart,              cls: 'like'        },
  rating:      { icon: star,               cls: 'rating'      },
  location:    { icon: location,           cls: 'location'    },
  info:        { icon: informationCircle,  cls: 'info'        },
  system:      { icon: notifications,      cls: 'system'      },
  visit:       { icon: qrCode,             cls: 'location'    },
  reply:       { icon: heart,              cls: 'reply'       },
  destination: { icon: location,           cls: 'destination' },
};

// ── Section bucketing ─────────────────────────────────────────────────────────

type Section = 'Today' | 'This Week' | 'Earlier';

function getSection(iso: string): Section {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 86_400_000)   return 'Today';
  if (diff < 7 * 86_400_000) return 'This Week';
  return 'Earlier';
}

const SECTIONS: Section[] = ['Today', 'This Week', 'Earlier'];

// ── Component ─────────────────────────────────────────────────────────────────

const Notifications: React.FC = () => {
  const { user } = useAuth();

  const [notifs,   setNotifs]   = useState<AppNotification[]>([]);
  const [loading,  setLoading]  = useState(true);

  // ── Real-time Firestore listener ────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;

    setLoading(true);
    const unsub = subscribeNotifications(user.uid, (items) => {
      setNotifs(items);
      setLoading(false);
    });

    return () => unsub();
  }, [user?.uid]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleMarkRead = (notif: AppNotification) => {
    if (!notif.unread || !user?.uid) return;
    // Optimistic UI update
    setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, unread: false } : n));
    markNotifRead(user.uid, notif.id);
  };

  const handleMarkAllRead = () => {
    if (!user?.uid) return;
    setNotifs(prev => prev.map(n => ({ ...n, unread: false })));
    markAllNotifsRead(user.uid);
  };

  const unreadCount = notifs.filter(n => n.unread).length;

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <IonPage>
        <IonHeader className="notif-header">
          <IonToolbar className="notif-toolbar">
            <IonButtons slot="start">
              <IonBackButton defaultHref="/home" />
            </IonButtons>
            <IonTitle className="notif-title">Notifications</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="notif-content">
          <div className="notif-empty">
            <IonSpinner name="crescent" color="primary" />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader className="notif-header">
        <IonToolbar className="notif-toolbar">
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" />
          </IonButtons>
          <IonTitle className="notif-title">Notifications</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="notif-content">

        {notifs.length === 0 ? (
          <div className="notif-empty">
            <div className="notif-empty-icon">
              <IonIcon icon={notifications} />
            </div>
            <h3>All caught up!</h3>
            <p>You have no notifications right now. Check back later.</p>
          </div>
        ) : (
          <>
            {/* Unread banner */}
            {unreadCount > 0 && (
              <div className="notif-unread-banner">
                <span className="notif-unread-label">
                  {unreadCount} unread notification{unreadCount > 1 ? 's' : ''}
                </span>
                <button className="notif-mark-all" onClick={handleMarkAllRead}>
                  <IonIcon icon={checkmarkDone} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Mark all read
                </button>
              </div>
            )}

            {/* Sections: Today / This Week / Earlier */}
            {SECTIONS.map(section => {
              const items = notifs.filter(n => getSection(n.createdAt) === section);
              if (!items.length) return null;

              return (
                <div key={section}>
                  <p className="notif-section-label">{section}</p>

                  {items.map(notif => {
                    const meta = TYPE_META[notif.type] ?? TYPE_META.info;
                    return (
                      <div
                        key={notif.id}
                        className={`notif-item${notif.unread ? ' unread' : ''}`}
                        onClick={() => handleMarkRead(notif)}
                        role="button"
                        aria-label={notif.title}
                      >
                        <div className={`notif-icon-wrap ${meta.cls}`}>
                          <IonIcon icon={meta.icon} />
                        </div>

                        <div className="notif-body">
                          <p className="notif-item-title">{notif.title}</p>
                          <p className="notif-item-message">{notif.message}</p>
                          <span className="notif-item-time">
                            {relativeTime(notif.createdAt)}
                          </span>
                        </div>

                        {notif.unread && <div className="notif-dot" />}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}

      </IonContent>
    </IonPage>
  );
};

export default Notifications;
