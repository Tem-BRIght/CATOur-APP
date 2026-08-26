import React, { useEffect, useState } from 'react';
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
  IonButton,
  IonTextarea,
  IonToast,
} from '@ionic/react';
import {
  headsetOutline,
  callOutline,
  mailOutline,
  locationOutline,
  chatbubbleEllipsesOutline,
  logoFacebook,
  logoInstagram,
  timeOutline,
  sendOutline,
  checkmarkCircleOutline,
} from 'ionicons/icons';
import { collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../../../context/AuthContext';
import { firestore } from '../../../firebase';

import './ContactSupport.css';

const ContactSupport: React.FC = () => {
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketMessages, setTicketMessages] = useState<any[]>([]);
  const { user } = useAuth();

  const now = new Date();
  const hour = now.getHours();
  const isOpen = hour >= 9 && hour < 17; // 9 AM – 5 PM

  useEffect(() => {
    if (!ticketId) return;
    const ticketRef = doc(firestore, 'supportTickets', ticketId);
    const messagesRef = collection(ticketRef, 'messages');
    return onSnapshot(messagesRef, snapshot => {
      setTicketMessages(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      void updateDoc(ticketRef, { unreadByUser: false });
    });
  }, [ticketId]);

  const handleSendMessage = async () => {
    if (!message.trim()) {
      setToastMsg('Please enter a message before sending.');
      setShowToast(true);
      return;
    }

    try {
      if (!user?.uid) throw new Error('You must be signed in to contact support.');

      const text = message.trim();
      const ticketRef = ticketId
        ? doc(firestore, 'supportTickets', ticketId)
        : doc(collection(firestore, 'supportTickets'));
      const messageRef = doc(collection(ticketRef, 'messages'));
      if (!ticketId) {
        await setDoc(ticketRef, {
          uid: user.uid,
          userId: user.uid,
          userEmail: user.email || null,
          email: user.email || null,
          userName: user.displayName || user.email?.split('@')[0] || 'Tourist',
          message: text,
          lastMessage: text,
          lastMessageAt: serverTimestamp(),
          assignedAdminId: null,
          status: 'open',
          unreadByAdmin: true,
          unreadByUser: false,
          createdAt: serverTimestamp(),
        });
      }
      await setDoc(messageRef, {
        senderId: user.uid,
        senderRole: 'user',
        text,
        createdAt: serverTimestamp(),
        readAt: null,
      });
      await updateDoc(ticketRef, {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
        unreadByAdmin: true,
        unreadByUser: false,
      });
      setTicketId(ticketRef.id);
      setToastMsg("Message sent! We'll get back to you shortly.");
      setShowToast(true);
      setMessage('');
    } catch (err) {
      console.error('[ContactSupport] failed to send message', err);
      setToastMsg('Unable to send your message right now. Please try again later.');
      setShowToast(true);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings" />
          </IonButtons>
          <IonTitle>Contact Support</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent>

        {/* Hero */}
        <div className="contact-hero">
          <IonIcon icon={headsetOutline} className="contact-hero-icon" />
          <h2>We're here to help</h2>
          <p>Our support team is ready to assist you with any questions or concerns.</p>
        </div>

        {/* Direct contact channels */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={chatbubbleEllipsesOutline} slot="start" />
            <IonLabel><strong>Direct Contact</strong></IonLabel>
          </IonItem>

          <IonItem button onClick={() => window.open('tel:6436431111')}>
            <IonIcon icon={callOutline} slot="start" />
            <IonLabel>
              <h2>Call CATO Office</h2>
              <p>643-1111 loc 1156</p>
            </IonLabel>
          </IonItem>

          <IonItem button onClick={() => window.open('mailto:support@catour.app')}>
            <IonIcon icon={mailOutline} slot="start" />
            <IonLabel>
              <h2>Email Support</h2>
              <p>support@catour.app</p>
            </IonLabel>
          </IonItem>

          <IonItem button onClick={() => window.open('https://maps.google.com/?q=Pasig+City+CATO+Office')}>
            <IonIcon icon={locationOutline} slot="start" />
            <IonLabel>
              <h2>Visit Us</h2>
              <p>Pasig City CATO Office, Pasig City</p>
            </IonLabel>
          </IonItem>
        </IonList>

        {/* Office hours */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={timeOutline} slot="start" />
            <IonLabel>
              <strong>Office Hours</strong>
            </IonLabel>
            <span
              className={`status-badge${isOpen ? '' : ' status-badge--closed'}`}
              slot="end"
            >
              {isOpen ? '● Open' : '● Closed'}
            </span>
          </IonItem>

          <IonItem>
            <IonLabel>
              <div className="hours-row">
                <span>Monday – Friday</span>
                <span>9:00 AM – 5:00 PM</span>
              </div>
            </IonLabel>
          </IonItem>

          <IonItem>
            <IonLabel>
              <div className="hours-row">
                <span>Saturday</span>
                <span>9:00 AM – 12:00 PM</span>
              </div>
            </IonLabel>
          </IonItem>

          <IonItem>
            <IonLabel>
              <div className="hours-row">
                <span>Sunday & Holidays</span>
                <span>Closed</span>
              </div>
            </IonLabel>
          </IonItem>
        </IonList>

        {/* Social media */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={chatbubbleEllipsesOutline} slot="start" />
            <IonLabel><strong>Social Media</strong></IonLabel>
          </IonItem>

          <IonItem lines="none">
            <div className="social-row">
              <button
                className="social-btn social-btn--fb"
                onClick={() => window.open('https://facebook.com/pasigcitycato')}
              >
                <IonIcon icon={logoFacebook} />
                Facebook
              </button>
              <button
                className="social-btn social-btn--ig"
                onClick={() => window.open('https://instagram.com/pasigcitycato')}
              >
                <IonIcon icon={logoInstagram} />
                Instagram
              </button>
            </div>
          </IonItem>
        </IonList>

        {/* Send a message */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={sendOutline} slot="start" />
            <IonLabel><strong>Send a Message</strong></IonLabel>
          </IonItem>
        </IonList>

        <div className="contact-message-area">
          <IonTextarea
            placeholder="Describe your question or concern…"
            rows={5}
            value={message}
            onIonInput={e => setMessage(e.detail.value ?? '')}
          />
          <IonButton
            expand="block"
            className="contact-send-btn"
            onClick={handleSendMessage}
          >
            <IonIcon icon={checkmarkCircleOutline} slot="start" />
            Send Message
          </IonButton>
        </div>

        {ticketId && (
          <div className="support-conversation" aria-live="polite">
            <h3>Your support conversation</h3>
            {ticketMessages.map(item => (
              <div key={item.id} className={`support-message${item.senderRole === 'admin' ? ' support-message--admin' : ''}`}>
                <strong>{item.senderRole === 'admin' ? 'Support' : 'You'}</strong>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        )}

        <IonToast
          isOpen={showToast}
          message={toastMsg}
          duration={2800}
          position="bottom"
          onDidDismiss={() => setShowToast(false)}
        />

      </IonContent>
    </IonPage>
  );
};

export default ContactSupport;
