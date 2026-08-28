// src/pages/Favorites/Favorites.tsx
import React, { useState, useEffect } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonIcon, IonImg, IonButton, IonToast,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { heart, location, star, trashOutline } from 'ionicons/icons';
import { useAuth } from '../../../context/AuthContext';
import { subscribeFavorites, removeFavorite, FavoriteEntry } from '../../../services/favoritesService';
import './Favorites.css';

const Favorites: React.FC = () => {
  const history  = useHistory();
  const { user } = useAuth();

  const [items,    setItems]    = useState<FavoriteEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [toastMsg, setToastMsg] = useState('');

  // ── Real-time RTDB listener — updates instantly, works offline ───────────
  useEffect(() => {
    if (!user?.uid) return;
    setLoading(true);
    const unsub = subscribeFavorites(user.uid, entries => {
      setItems(entries);   // already sorted newest-first in the service
      setLoading(false);
    });
    return () => unsub();
  }, [user?.uid]);

  const handleRemove = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.uid) return;
    try {
      await removeFavorite(user.uid, id);
      // List updates automatically via the live listener above
      setToastMsg(`Removed "${name}" from Favorites`);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/profile" />
          </IonButtons>
          <IonTitle>My Favorites</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="fav-content">
        {loading ? (
          <div className="fav-loading">Loading favorites…</div>
        ) : items.length === 0 ? (
          <div className="fav-empty">
            <div className="fav-empty-icon">
              <IonIcon icon={heart} />
            </div>
            <h3>No favorites yet</h3>
            <p>Tap the ❤️ on any destination to save it here.</p>
            <IonButton onClick={() => history.push('/home')}>Explore Destinations</IonButton>
          </div>
        ) : (
          <div className="fav-list">
            {items.map(item => (
              <div
                key={item.id}
                className="fav-card"
                role="button"
                onClick={() => history.push(`/destination/${item.id}`)}
              >
                <div className="fav-card-img-wrap">
                  <IonImg src={item.image} alt={item.name} className="fav-card-img" />
                </div>
                <div className="fav-card-body">
                  <h4 className="fav-card-name">{item.name}</h4>
                  {item.address && (
                    <div className="fav-card-meta">
                      <IonIcon icon={location} />
                      <span>{item.address}</span>
                    </div>
                  )}
                  {item.rating && (
                    <div className="fav-card-meta">
                      <IonIcon icon={star} className="fav-star" />
                      <span>{item.rating}</span>
                    </div>
                  )}
                </div>
                <button
                  className="fav-remove-btn"
                  aria-label="Remove from favorites"
                  onClick={e => handleRemove(item.id, item.name, e)}
                >
                  <IonIcon icon={trashOutline} />
                </button>
              </div>
            ))}
          </div>
        )}

        <IonToast
          isOpen={!!toastMsg}
          message={toastMsg}
          duration={2000}
          position="bottom"
          onDidDismiss={() => setToastMsg('')}
        />
      </IonContent>
    </IonPage>
  );
};

export default Favorites;