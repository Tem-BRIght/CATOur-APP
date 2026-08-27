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
import {
  collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc,
  query, where, getDocs,
} from 'firebase/firestore';
import { useHistory } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { firestore } from '../../../firebase';

import './ContactSupport.css';

const ContactSupport: React.FC = () => {
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketStatus, setTicketStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { user } = useAuth();
  const history = useHistory();

  const now = new Date();
  const hour = now.getHours();
  const isOpen = hour >= 9 && hour < 17; // 9 AM – 5 PM

  // Keep the latest ticket id so a resolved conversation can be reopened.
  useEffect(() => {
    if (!user?.uid) return;

    (async () => {
      try {
        const q = query(
          collection(firestore, 'supportTickets'),
          where('userId', '==', user.uid),
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const latest = [...snap.docs].sort((a, b) => {
            const aTime = a.data().lastMessageAt?.toMillis?.() ?? 0;
            const bTime = b.data().lastMessageAt?.toMillis?.() ?? 0;
            return bTime - aTime;
          })[0];
          setTicketId(latest.id);
        }
      } catch (err) {
        console.error('[ContactSupport] failed to look up existing ticket', err);
      }
    })();
  }, [user?.uid]);

  useEffect(() => {
    if (!ticketId) return;
    const ticketRef = doc(firestore, 'supportTickets', ticketId);
    return onSnapshot(ticketRef, snap => {
      if (!snap.exists()) {
        setTicketId(null);
        setTicketStatus(null);
        return;
      }
      const data = snap.data();
      setTicketStatus(data.status ?? null);
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
      setSending(true);

      const text = message.trim();
      const reopening = ticketId && ticketStatus === 'resolved';
      const ticketRef = ticketId
        ? doc(firestore, 'supportTickets', ticketId)
        : doc(collection(firestore, 'supportTickets'));
      const messageRef = doc(collection(ticketRef, 'messages'));

      if (reopening) {
        await updateDoc(ticketRef, {
          lastMessage: text,
          lastMessageAt: serverTimestamp(),
          lastMessageBySenderRole: 'user',
          status: 'open',
          unreadByAdmin: true,
          unreadByUser: false,
        });
      } else {
        await setDoc(ticketRef, {
          uid: user.uid,
          userId: user.uid,
          userEmail: user.email || null,
          email: user.email || null,
          userName: user.displayName || user.email?.split('@')[0] || 'Tourist',
          message: text,
          lastMessage: text,
          lastMessageAt: serverTimestamp(),
          lastMessageBySenderRole: 'user',
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

      setMessage('');
      history.push(`/support-chat/${ticketRef.id}`);
    } catch (err) {
      console.error('[ContactSupport] failed to send message', err);
      setToastMsg('Unable to send your message right now. Please try again later.');
      setShowToast(true);
    } finally {
      setSending(false);
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

        {/* Send a message or return to the active conversation */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={sendOutline} slot="start" />
            <IonLabel><strong>{ticketId ? 'Back to Virtual Conversation' : 'Send a Message'}</strong></IonLabel>
          </IonItem>
        </IonList>

        {ticketId && ticketStatus !== 'resolved' ? (
          <div className="contact-message-area">
            <IonButton
              expand="block"
              type="button"
              className="contact-send-btn"
              onClick={() => history.push(`/support-chat/${ticketId}`)}
            >
              <IonIcon icon={chatbubbleEllipsesOutline} slot="start" />
              Back to Virtual Conversation
            </IonButton>
          </div>
        ) : (
          <div className="contact-message-area">
            <IonTextarea
              placeholder="Describe your question or concern…"
              rows={5}
              value={message}
              onIonInput={e => setMessage(e.detail.value ?? '')}
            />
            <IonButton
              expand="block"
              type="button"
              className="contact-send-btn"
              disabled={sending}
              onClick={handleSendMessage}
            >
              <IonIcon icon={checkmarkCircleOutline} slot="start" />
              Send Message
            </IonButton>
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