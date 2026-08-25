import React, { useEffect, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
  IonItem,
  IonLabel,
  IonToggle,
  IonIcon,
} from '@ionic/react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { SpeechRecognition as NativeSpeechRecognition } from '@capacitor-community/speech-recognition';
import {
  notificationsOutline,
  mapOutline,
  micOutline,
  cameraOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import './Permissions.css';

type PermissionKey = 'notifications' | 'maps' | 'voice' | 'camera';

const STORAGE_KEY = 'catour.permissions';

const defaultPermissions: Record<PermissionKey, boolean> = {
  notifications: true,
  maps: true,
  voice: true,
  camera: false,
};

const permissionRows = [
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'Receive trip alerts, reminders, and updates.',
    icon: notificationsOutline,
    color: 'blue',
  },
  {
    key: 'maps',
    label: 'Maps',
    description: 'Use navigation and location-based directions.',
    icon: mapOutline,
    color: 'green',
  },
  {
    key: 'voice',
    label: 'Voice',
    description: 'Enable voice guidance and voice search.',
    icon: micOutline,
    color: 'purple',
  },
  {
    key: 'camera',
    label: 'Camera',
    description: 'Scan tickets, capture photos, and verify visits.',
    icon: cameraOutline,
    color: 'orange',
  },
] as const;

const readStoredPermissions = (): Partial<Record<PermissionKey, boolean>> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<PermissionKey, boolean>>;
    return parsed;
  } catch {
    return {};
  }
};

const getNotificationPermission = async (): Promise<boolean> => {
  if (Capacitor.isNativePlatform()) {
    try {
      const permission = await PushNotifications.checkPermissions();
      return permission.receive === 'granted';
    } catch {
      return false;
    }
  }

  if (!('Notification' in window)) return false;
  return Notification.permission === 'granted';
};

const getMapsPermission = async (): Promise<boolean> => {
  if (!navigator.geolocation) return false;

  if ('permissions' in navigator && navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      return status.state === 'granted';
    } catch {
      // continue to direct check below
    }
  }

  return await new Promise<boolean>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      () => resolve(false),
      { timeout: 2000 }
    );
  });
};

const getVoicePermission = async (): Promise<boolean> => {
  if (Capacitor.isNativePlatform()) {
    try {
      const permission = await NativeSpeechRecognition.checkPermissions();
      return permission.speechRecognition === 'granted';
    } catch {
      return false;
    }
  }

  if (!navigator.mediaDevices?.getUserMedia) return false;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch {
    return false;
  }
};

const getCameraPermission = async (): Promise<boolean> => {
  if (!navigator.mediaDevices?.getUserMedia) return false;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch {
    return false;
  }
};

const getActualPermission = async (key: PermissionKey): Promise<boolean> => {
  switch (key) {
    case 'notifications':
      return getNotificationPermission();
    case 'maps':
      return getMapsPermission();
    case 'voice':
      return getVoicePermission();
    case 'camera':
      return getCameraPermission();
    default:
      return false;
  }
};

const requestPermission = async (key: PermissionKey): Promise<boolean> => {
  switch (key) {
    case 'notifications': {
      if (Capacitor.isNativePlatform()) {
        try {
          const permission = await PushNotifications.requestPermissions();
          return permission.receive === 'granted';
        } catch {
          return false;
        }
      }

      if (!('Notification' in window)) return false;
      const status = await Notification.requestPermission();
      return status === 'granted';
    }
    case 'maps': {
      if (!navigator.geolocation) return false;
      return await new Promise<boolean>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          () => resolve(false),
          { timeout: 10000 }
        );
      });
    }
    case 'voice': {
      if (Capacitor.isNativePlatform()) {
        try {
          const permission = await NativeSpeechRecognition.requestPermissions();
          return permission.speechRecognition === 'granted';
        } catch {
          return false;
        }
      }

      if (!navigator.mediaDevices?.getUserMedia) return false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        return true;
      } catch {
        return false;
      }
    }
    case 'camera': {
      if (!navigator.mediaDevices?.getUserMedia) return false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
        return true;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
};

const Permissions: React.FC = () => {
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>(defaultPermissions);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadPermissions = async () => {
      const stored = readStoredPermissions();
      const nextState = { ...defaultPermissions, ...stored };

      const refreshed = await Promise.all(
        (Object.keys(defaultPermissions) as PermissionKey[]).map(async (key) => {
          const granted = await getActualPermission(key);
          return [key, granted] as const;
        })
      );

      if (cancelled) return;

      const merged = { ...nextState };
      refreshed.forEach(([key, granted]) => {
        merged[key] = granted;
      });

      setPermissions(merged);
      setReady(true);
    };

    void loadPermissions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(permissions));
  }, [permissions, ready]);

  const togglePermission = async (key: PermissionKey, nextValue: boolean) => {
    if (nextValue) {
      const granted = await requestPermission(key);
      setPermissions(prev => ({ ...prev, [key]: granted }));
      return;
    }

    setPermissions(prev => ({ ...prev, [key]: false }));
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings" />
          </IonButtons>
          <IonTitle>Permissions</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="permissions-page">
        <div className="permissions-header">
          <div className="permissions-header__icon">
            <IonIcon icon={shieldCheckmarkOutline} />
          </div>
          <div>
            <h2>App permissions</h2>
            <p>Control the access CATOur can request on your device.</p>
          </div>
        </div>

        <div className="permissions-list">
          {permissionRows.map(({ key, label, description, icon, color }) => (
            <IonItem key={key} lines="full" className="permission-item">
              <div className={`permission-item__icon ${color}`} aria-hidden="true">
                <IonIcon icon={icon} />
              </div>
              <IonLabel className="permission-item__content">
                <h3>{label}</h3>
                <p>{description}</p>
              </IonLabel>
              <IonToggle
                slot="end"
                checked={permissions[key]}
                onIonChange={event => void togglePermission(key, event.detail.checked)}
                aria-label={label}
              />
            </IonItem>
          ))}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Permissions;
