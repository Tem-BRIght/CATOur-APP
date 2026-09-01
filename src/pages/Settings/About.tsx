import React, { useState } from 'react';
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
  shareSocialOutline,
  helpCircleOutline
} from 'ionicons/icons';

import './About.css';

const WEBSITE_URL = 'https://catour.app';

const HELP_CENTER_ITEMS = [
  {
    title: 'Getting Started',
    description: 'Browse destinations, choose a tour, and use the booking options to begin exploring with CATOur.'
  },
  {
    title: 'Tour Guides',
    description: 'Find available tour guides, review their details, and book a schedule that matches your trip.'
  },
  {
    title: 'Navigation & Maps',
    description: 'Open a destination to view its map, location, and available navigation and route options.'
  },
  {
    title: 'Account & Profile',
    description: 'Manage your profile, favorites, app preferences, and saved travel activity from Settings.'
  },
  {
    title: 'Technical Issues',
    description: 'Check your internet connection, relaunch the app, and contact support if the problem continues.'
  }
];

const WHATS_NEW_ITEMS = [
  {
    title: 'AI Chat Assistant',
    description: 'Ask ALI for local recommendations, directions, travel tips, and place suggestions while exploring.'
  },
  {
    title: 'Tour Guide Booking',
    description: 'Book a local guide for a smoother and more personalized Pasig City experience.'
  },
  {
    title: 'Cultural Forum',
    description: 'Explore community stories, local highlights, and cultural conversations from the app.'
  },
  {
    title: 'Offline Maps',
    description: 'Access key map and destination information even when you are temporarily offline.'
  }
];

const About: React.FC = () => {
  const [expandedHelp, setExpandedHelp] = useState<string | null>(null);
  const [expandedWhatsNew, setExpandedWhatsNew] = useState<string | null>(null);

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
          <p>Version 1.0.0 (Build 1)</p>
        </div>

        {/* What's New */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={sparklesOutline} slot="start" />
            <IonLabel><strong>What’s New</strong></IonLabel>
          </IonItem>

          {WHATS_NEW_ITEMS.map((item) => (
            <React.Fragment key={item.title}>
              <IonItem
                button
                detail
                onClick={() => setExpandedWhatsNew(expandedWhatsNew === item.title ? null : item.title)}
              >
                <IonLabel>{item.title}</IonLabel>
              </IonItem>

              {expandedWhatsNew === item.title && (
                <IonItem lines="none" className="about-help-answer">
                  <IonLabel>
                    <p>{item.description}</p>
                  </IonLabel>
                </IonItem>
              )}
            </React.Fragment>
          ))}
        </IonList>

        {/* Help Center */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={helpCircleOutline} slot="start" />
            <IonLabel><strong>Help Center</strong></IonLabel>
          </IonItem>

          {HELP_CENTER_ITEMS.map((item) => (
            <React.Fragment key={item.title}>
              <IonItem
                button
                detail
                onClick={() => setExpandedHelp(expandedHelp === item.title ? null : item.title)}
              >
                <IonLabel>{item.title}</IonLabel>
              </IonItem>

              {expandedHelp === item.title && (
                <IonItem lines="none" className="about-help-answer">
                  <IonLabel>
                    <p>{item.description}</p>
                  </IonLabel>
                </IonItem>
              )}
            </React.Fragment>
          ))}
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
