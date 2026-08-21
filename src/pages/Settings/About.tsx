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
  IonIcon,
  IonButton
} from '@ionic/react';
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

const About: React.FC = () => {
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

          <IonItem>
            <IonIcon icon={mailOutline} slot="start" />
            <IonLabel>support@pasigtourism.app</IonLabel>
          </IonItem>

          <IonItem>
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

          <IonItem button>
            <IonLabel>Visit Website</IonLabel>
          </IonItem>

          <IonItem button>
            <IonLabel>Rate on App Store</IonLabel>
          </IonItem>

          <IonItem button>
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
