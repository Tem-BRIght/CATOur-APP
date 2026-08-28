// src/pages/Settings/ContactSupport/SupportChat.tsx
//
// The tourist's "virtual conversation" screen with support. Opened either:
//   - from Contact Support, after starting/continuing a ticket, or
//   - directly from an existing support conversation link with the ticket id.
//
// Real-time: both the ticket doc (for status) and its messages subcollection
// are subscribed live via onSnapshot, so admin replies appear instantly
// without a refresh.

import React, { useEffect, useRef, useState } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonButtons,
  IonBackButton,
  IonTextarea,
  IonButton,
  IonIcon,
  IonSpinner,
} from '@ionic/react';
import { sendOutline, headsetOutline, timeOutline } from 'ionicons/icons';
import {
  collection, doc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { useAuth } from '../../../context/AuthContext';
import { firestore } from '../../../firebase';
import './SupportChat.css';

interface TicketMessage {
  id: string;
  senderId: string;
  senderRole: 'user' | 'admin';
  text: string;
  createdAt: any;
}

function messageTime(value: any): string {
  const date = value?.toDate ? value.toDate() : value?.seconds ? new Date(value.seconds * 1000) : null;
  if (!date) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// What the tourist sees doesn't need to distinguish *which* admin has it —
// only whether someone's actively on it, or it's wrapped up.
function touristStatus(ticket: any): { label: string; cls: string } {
  if (!ticket) return { label: '', cls: '' };
  if (ticket.status === 'resolved') return { label: 'Resolved', cls: 'support-status--resolved' };
  if (ticket.assignedAdminId) return { label: 'Support is on it', cls: 'support-status--active' };
  return { label: 'Waiting for a reply', cls: 'support-status--waiting' };
}

const SupportChat: React.FC = () => {
  const { ticketId } = useParams<{ ticketId: string }>();
  const history = useHistory();
  const { user } = useAuth();

  const [ticket, setTicket] = useState<any>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ticketId) return;
    const ticketRef = doc(firestore, 'supportTickets', ticketId);
    const messagesRef = collection(ticketRef, 'messages');

    const unsubTicket = onSnapshot(ticketRef, snap => {
      setTicket(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    });

    const unsubMessages = onSnapshot(query(messagesRef, orderBy('createdAt', 'asc')), snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as TicketMessage)));
      void updateDoc(ticketRef, { unreadByUser: false });
    });

    return () => { unsubTicket(); unsubMessages(); };
  }, [ticketId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !user?.uid || !ticketId || sending) return;

    try {
      setSending(true);
      const ticketRef = doc(firestore, 'supportTickets', ticketId);
      const messageRef = doc(collection(ticketRef, 'messages'));
      const reopening = ticket?.status === 'resolved';

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
        lastMessageBySenderRole: 'user',
        unreadByAdmin: true,
        unreadByUser: false,
        ...(reopening ? { status: 'in-progress' } : {}),
      });
      setDraft('');
    } catch (err) {
      console.error('[SupportChat] failed to send message', err);
    } finally {
      setSending(false);
    }
  };

  const status = touristStatus(ticket);
  const isResolved = ticket?.status === 'resolved';

  return (
    <IonPage className="support-chat-page">
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings/contact-support" />
          </IonButtons>
          <IonTitle>
            <div className="support-chat-title">
              <span>Support</span>
              {status.label && <span className={`support-status-pill ${status.cls}`}>{status.label}</span>}
            </div>
          </IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="support-chat-content">
        {loading ? (
          <div className="support-chat-empty">
            <IonSpinner name="crescent" color="primary" />
          </div>
        ) : messages.length === 0 ? (
          <div className="support-chat-empty">
            <IonIcon icon={headsetOutline} />
            <p>No messages yet. Say hello to get started!</p>
          </div>
        ) : (
          <div className="support-chat-list">
            {messages.map(item => (
              <div
                key={item.id}
                className={`chat-bubble-row${item.senderRole === 'user' ? ' chat-bubble-row--mine' : ''}`}
              >
                <div className={`chat-bubble${item.senderRole === 'user' ? ' chat-bubble--mine' : ''}`}>
                  {item.senderRole === 'admin' && <span className="chat-bubble-sender">Support</span>}
                  <p>{item.text}</p>
                  <span className="chat-bubble-time">{messageTime(item.createdAt)}</span>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {isResolved && (
          <div className="support-chat-resolved-note">
            <IonIcon icon={timeOutline} />
            This conversation was marked resolved. Sending a message will reopen it.
          </div>
        )}
      </IonContent>

      <IonFooter className="support-chat-footer">
        <div className="support-chat-input-row">
          <IonTextarea
            className="support-chat-input"
            placeholder="Type a message…"
            autoGrow
            rows={1}
            value={draft}
            onIonInput={e => setDraft(e.detail.value ?? '')}
          />
          <IonButton
            type="button"
            className="support-chat-send"
            disabled={!draft.trim() || sending}
            onClick={handleSend}
          >
            <IonIcon icon={sendOutline} slot="icon-only" />
          </IonButton>
        </div>
      </IonFooter>
    </IonPage>
  );
};

export default SupportChat;