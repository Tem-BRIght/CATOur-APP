import React, { useState } from 'react';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react';

const VerifyPhone: React.FC = () => {
  const [message] = useState(
    'Your phone number must be verified before you can join a tour. Update your profile with a valid mobile number and confirm the verification status to continue.'
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/profile" />
          </IonButtons>
          <IonTitle>Verify Phone</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: '1rem' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Phone verification</h2>
          <p>{message}</p>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default VerifyPhone;
