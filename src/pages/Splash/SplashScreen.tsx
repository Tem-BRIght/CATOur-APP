import React, { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { IonPage, IonContent } from '@ionic/react';
import { useAuth } from '../../context/AuthContext';
import './SplashScreen.css';

const SplashScreen: React.FC = () => {
  const history = useHistory();
  const { isAuthenticated, authLoading, role, mustChangePassword } = useAuth();

  useEffect(() => {
    // Do not make a routing decision until the authenticated user's role has
    // been loaded from Firestore.
    if (authLoading) return;

    const destination = !isAuthenticated
      ? '/login'
      : role === 'tourguide'
        ? (mustChangePassword ? '/tourguide/change-password' : '/tourguide/home')
        : '/home';

    const timer = window.setTimeout(() => history.replace(destination), 2800);
    return () => window.clearTimeout(timer);
  }, [authLoading, history, isAuthenticated, mustChangePassword, role]);

  return (
  <IonPage>
    <IonContent fullscreen>
      <div className="splash-content">

        {/* Decorative background circles */}
        <div className="splash-bg-circle c1" />
        <div className="splash-bg-circle c2" />
        <div className="splash-bg-circle c3" />

        {/* Center content */}
        <div className="splash-center">
          <div className="splash-logo-wrap">
            <img
              src='/assets/icon/catour.png'
              alt="Catour"
              className="splash-logo"
            />
          </div>

          <p className="splash-subtitle">Discover Pasig with AI Guidance</p>

          <div className="splash-progress-wrap">
            <div className="splash-progress-bar" />
          </div>
        </div>

        <p className="splash-powered">Powered by Pasig City Government</p>

      </div>
    </IonContent>
  </IonPage>
);
}

export default SplashScreen;
