import React, { useEffect, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonIcon
} from '@ionic/react';
import { useIonRouter } from '@ionic/react';
import {
  bookOutline,
  mapOutline,
  personOutline,
  bugOutline,
  chatbubbleEllipsesOutline,
  callOutline,
  mailOutline,
  helpCircleOutline
} from 'ionicons/icons';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { firestore } from '../../firebase';
import './Help.css';

interface FAQItem {
  id: string;
  title: string;
  content?: string;
  order?: number;
}

const DEFAULT_FAQS = [
  'How do I book a tour guide?',
  'How do I cancel a booking?',
  'Is there an offline mode?',
  'How do I earn badges?',
  'How do I contact support?',
  'How do I share a destination?',
  'How do I write a review?',
  'How do I navigate to a place?',
  'What is the AI Guide feature?'
];

const CATEGORY_ANSWERS: Record<string, string> = {
  'Getting Started': 'Browse destinations, choose a tour, and use the booking options to begin exploring with CATO.',
  'Tour Guides': 'Find available tour guides, review their details, and book a schedule that fits your trip.',
  'Navigation and Maps': 'Open a destination to view its map, location, and available navigation options.',
  'Account and Profile': 'Manage your personal details, bookings, saved places, badges, and account preferences from Settings.',
  'Technical Issues': 'Check your connection and restart the app first. Contact support below if the problem continues.'
};

const Help: React.FC = () => {
  const router = useIonRouter();
  const [faqs, setFaqs] = useState<FAQItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  useEffect(() => {
    const fetchFaqs = async () => {
      try {
        const snap = await getDocs(query(collection(firestore, 'faqs'), orderBy('order', 'asc')));
        if (!snap.empty) {
          const loaded = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FAQItem));
          setFaqs(loaded);
        }
      } catch (err) {
        console.warn('[Help] Failed to load dynamic FAQs, falling back to defaults:', err);
      }
    };
    fetchFaqs();
  }, []);

  const filteredFaqs = faqs.length > 0
    ? faqs.filter(f => f.title?.toLowerCase().includes(searchText.toLowerCase()) || f.content?.toLowerCase().includes(searchText.toLowerCase()))
    : DEFAULT_FAQS.filter(q => q.toLowerCase().includes(searchText.toLowerCase()));

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings" />
          </IonButtons>
          <IonTitle>Help Center</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {/* Search */}
        <div className="help-search">
          <IonSearchbar
            placeholder="Type your question..."
            value={searchText}
            onIonInput={e => setSearchText(e.detail.value ?? '')}
          />
        </div>
        {/* Categories */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={helpCircleOutline} slot="start" />
            <IonLabel><strong>Categories</strong></IonLabel>
          </IonItem>
          <IonItem button detail onClick={() => setExpandedCategory(expandedCategory === 'Getting Started' ? null : 'Getting Started')}>
            <IonIcon icon={bookOutline} slot="start" />
            <IonLabel>Getting Started</IonLabel>
          </IonItem>
          {expandedCategory === 'Getting Started' && <IonItem className="category-answer" lines="none"><IonLabel><p>{CATEGORY_ANSWERS['Getting Started']}</p></IonLabel></IonItem>}
          <IonItem button detail onClick={() => setExpandedCategory(expandedCategory === 'Tour Guides' ? null : 'Tour Guides')}>
            <IonIcon icon={mapOutline} slot="start" />
            <IonLabel>Tour Guides</IonLabel>
          </IonItem>
          {expandedCategory === 'Tour Guides' && <IonItem className="category-answer" lines="none"><IonLabel><p>{CATEGORY_ANSWERS['Tour Guides']}</p></IonLabel></IonItem>}
          <IonItem button detail onClick={() => setExpandedCategory(expandedCategory === 'Navigation and Maps' ? null : 'Navigation and Maps')}>
            <IonIcon icon={mapOutline} slot="start" />
            <IonLabel>Navigation & Maps</IonLabel>
          </IonItem>
          {expandedCategory === 'Navigation and Maps' && <IonItem className="category-answer" lines="none"><IonLabel><p>{CATEGORY_ANSWERS['Navigation and Maps']}</p></IonLabel></IonItem>}
          <IonItem button detail onClick={() => setExpandedCategory(expandedCategory === 'Account and Profile' ? null : 'Account and Profile')}>
            <IonIcon icon={personOutline} slot="start" />
            <IonLabel>Account & Profile</IonLabel>
          </IonItem>
          {expandedCategory === 'Account and Profile' && <IonItem className="category-answer" lines="none"><IonLabel><p>{CATEGORY_ANSWERS['Account and Profile']}</p></IonLabel></IonItem>}
          <IonItem button detail onClick={() => setExpandedCategory(expandedCategory === 'Technical Issues' ? null : 'Technical Issues')}>
            <IonIcon icon={bugOutline} slot="start" />
            <IonLabel>Technical Issues</IonLabel>
          </IonItem>
          {expandedCategory === 'Technical Issues' && <IonItem className="category-answer" lines="none"><IonLabel><p>{CATEGORY_ANSWERS['Technical Issues']}</p></IonLabel></IonItem>}
        </IonList>

        {/* FAQs */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={helpCircleOutline} slot="start" />
            <IonLabel><strong>Frequently Asked Questions</strong></IonLabel>
          </IonItem>
          {faqs.length > 0 ? (
            filteredFaqs.map((faq) => {
              const item = faq as FAQItem;
              return (
                <IonItem
                  key={item.id}
                  button
                  onClick={() => router.push('/ai-guide?q=' + encodeURIComponent(item.title))}
                >
                  <IonLabel>
                    <h2>{item.title}</h2>
                    {item.content && <p>{item.content}</p>}
                  </IonLabel>
                </IonItem>
              );
            })
          ) : (
            (filteredFaqs as string[]).map((q) => (
              <IonItem
                key={q}
                button
                onClick={() => router.push('/ai-guide?q=' + encodeURIComponent(q))}
              >
                <IonLabel>{q}</IonLabel>
              </IonItem>
            ))
          )}
        </IonList>

        {/* Contact Options */}
        <IonList inset>
          <IonItem lines="none">
            <IonIcon icon={callOutline} slot="start" />
            <IonLabel><strong>Contact Options</strong></IonLabel>
          </IonItem>
          <IonItem button onClick={() => router.push('/settings/contact-support')}>
            <IonIcon icon={chatbubbleEllipsesOutline} slot="start" />
            <IonLabel>
              <h2>Live Chat & Contact Support</h2>
              <p>Send a ticket or reach out to CATO</p>
            </IonLabel>
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
        </IonList>
      </IonContent>
    </IonPage>
  );
};
export default Help;