import React from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonList,
  IonItem,
  IonLabel,
  IonIcon
} from '@ionic/react';
import { Share } from '@capacitor/share';
import {
  informationCircleOutline,
  sparklesOutline,
  peopleOutline,
  mailOutline,
  callOutline,
  linkOutline,
  shareSocialOutline
} from 'ionicons/icons';

import './About.css';

const WEBSITE_URL = 'https://catour.app';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=io.catour.app';

const About: React.FC = () => {
  const openExternalLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleShare = async () => {
    try {
      await Share.share({
        title: 'CATOur',
        text: 'Discover Pasig with CATOur.',
        url: WEBSITE_URL,
        dialogTitle: 'Share CATOur',
      });
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('cancel')) return;
      console.error('[About] Share failed:', error);
      try {
        await navigator.clipboard.writeText(WEBSITE_URL);
      } catch (clipboardError) {
        console.error('[About] Copy share link failed:', clipboardError);
      }
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/tabs/settings" />
          </IonButtons>
          <IonTitle>About</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent>

        {/* App Info */}
        <div className="about-header">
          <img src="/assets/images/Pasig Logo.png" alt="CATOur Logo" />
          <h2>CATOur</h2>
          <p>Version 1.0.0 (Build 123)</p>
        </div>

        {/* What's New */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={sparklesOutline} slot="start" />
            <IonLabel><strong>What’s New</strong></IonLabel>
          </IonItem>

          <IonItem>
            <IonLabel>AI Chat Assistant</IonLabel>
          </IonItem>

          <IonItem>
            <IonLabel>Tour Guide Booking</IonLabel>
          </IonItem>

          <IonItem>
            <IonLabel>Cultural Forum</IonLabel>
          </IonItem>

          <IonItem>
            <IonLabel>Offline Maps</IonLabel>
          </IonItem>
        </IonList>

        {/* Developed By */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={peopleOutline} slot="start" />
            <IonLabel><strong>Developed By</strong></IonLabel>
          </IonItem>

          <IonItem>
            <IonLabel>
              Pasig Catholic College<br />
              <small>in partnership with Pasig City CATO</small>
            </IonLabel>
          </IonItem>
        </IonList>

        {/* Contact */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={informationCircleOutline} slot="start" />
            <IonLabel><strong>Contact</strong></IonLabel>
          </IonItem>

          <IonItem button onClick={() => window.open('mailto:support@pasigtourism.app')}>
            <IonIcon icon={mailOutline} slot="start" />
            <IonLabel>support@pasigtourism.app</IonLabel>
          </IonItem>

          <IonItem button onClick={() => window.open('tel:6436431111')}>
            <IonIcon icon={callOutline} slot="start" />
            <IonLabel>643-1111 loc 1156</IonLabel>
          </IonItem>
        </IonList>

        {/* Links */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={linkOutline} slot="start" />
            <IonLabel><strong>Links</strong></IonLabel>
          </IonItem>

          <IonItem button onClick={() => openExternalLink(WEBSITE_URL)}>
            <IonLabel>Visit Website</IonLabel>
          </IonItem>

          <IonItem button onClick={() => openExternalLink(PLAY_STORE_URL)}>
            <IonLabel>Rate on App Store</IonLabel>
          </IonItem>

          <IonItem button onClick={() => void handleShare()}>
            <IonIcon icon={shareSocialOutline} slot="start" />
            <IonLabel>Share with Friends</IonLabel>
          </IonItem>
        </IonList>

        {/* Footer */}
        <div className="about-footer">
          <p>© 2026 CATOur</p>
          <p>All rights reserved</p>
        </div>

      </IonContent>
    </IonPage>
  );
};

export default About;
