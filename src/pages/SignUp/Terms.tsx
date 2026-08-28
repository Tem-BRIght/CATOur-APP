import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonButton,
  IonIcon,
} from '@ionic/react';
import { useIonRouter } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';
import { useSignup } from '../../context/SignupContext';
import {
  documentTextOutline,
  shieldCheckmarkOutline,
  personOutline,
  locationOutline,
  lockClosedOutline,
  shareOutline,
  trashOutline,
  alertCircleOutline,
  refreshOutline,
  mailOutline,
} from 'ionicons/icons';

import './Terms.css';

type Tab = 'terms' | 'privacy';

const Terms: React.FC = () => {
  const router   = useIonRouter();
  const history  = useHistory();
  const location = useLocation();
  const { updateSignupData } = useSignup();
  const returnTo = new URLSearchParams(location.search).get('returnTo');

  // Open directly on the correct tab via ?tab=privacy
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const p = new URLSearchParams(location.search);
    return p.get('tab') === 'privacy' ? 'privacy' : 'terms';
  });

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setActiveTab(p.get('tab') === 'privacy' ? 'privacy' : 'terms');
  }, [location.search]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/tabs/settings" />
          </IonButtons>
          <IonTitle>Terms &amp; Privacy</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent>

        {/* Header */}
        <div className="terms-header">
          <h2>Terms &amp; Privacy Policy</h2>
          <p>Last updated: July 26, 2026 · CATOur v1.0.0</p>
        </div>

        {/* Tabs */}
        <div className="terms-tabs">
          <button
            className={`terms-tab${activeTab === 'terms' ? ' terms-tab--active' : ''}`}
            onClick={() => setActiveTab('terms')}
          >
            Terms of Service
          </button>
          <button
            className={`terms-tab${activeTab === 'privacy' ? ' terms-tab--active' : ''}`}
            onClick={() => setActiveTab('privacy')}
          >
            Privacy Policy
          </button>
        </div>

        {/* ── Terms of Service ── */}
        {activeTab === 'terms' && (
          <div className="terms-body">

            <div className="terms-section">
              <h3><IonIcon icon={documentTextOutline} />Acceptance of Terms</h3>
              <p>
                By downloading, installing, or using CATOur, you agree to be
                bound by these Terms of Service. If you do not agree with any part of these
                terms, you must not use the application.
              </p>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={personOutline} />User Accounts</h3>
              <p>To access certain features you must create an account. You agree to:</p>
              <ul>
                <li>Provide accurate and complete registration information.</li>
                <li>Maintain the security of your password and account.</li>
                <li>Notify us immediately of any unauthorised access.</li>
                <li>Accept responsibility for all activities under your account.</li>
              </ul>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={shieldCheckmarkOutline} />Acceptable Use</h3>
              <p>You agree not to use the app to:</p>
              <ul>
                <li>Post false, misleading, or harmful content.</li>
                <li>Harass, abuse, or harm other users.</li>
                <li>Violate any applicable local or national laws.</li>
                <li>Attempt to gain unauthorised access to app systems.</li>
                <li>Reproduce or redistribute app content without permission.</li>
              </ul>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={documentTextOutline} />Content &amp; Reviews</h3>
              <p>
                User-generated content such as reviews and photos remains your property.
                By submitting content, you grant CATOur a non-exclusive,
                royalty-free licence to display and distribute that content within the app.
              </p>
              <p>
                We reserve the right to remove content that violates these terms without
                prior notice.
              </p>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={alertCircleOutline} />Disclaimer of Warranties</h3>
              <p>
                The app is provided "as is" without warranties of any kind. We do not
                guarantee that information about destinations, tour guides, or schedules
                is always accurate, complete, or up to date.
              </p>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={refreshOutline} />Changes to Terms</h3>
              <p>
                We may revise these Terms at any time. Continued use of the app after
                changes constitutes acceptance of the updated Terms. We will notify users
                of significant changes via in-app notification or email.
              </p>
            </div>

          </div>
        )}

        {/* ── Privacy Policy ── */}
        {activeTab === 'privacy' && (
          <div className="terms-body">

            <div className="terms-section">
              <h3><IonIcon icon={shieldCheckmarkOutline} />Information We Collect</h3>
              <p>We collect the following types of information:</p>
              <ul>
                <li><strong>Account data</strong> — name, email, profile photo, contact number.</li>
                <li><strong>Usage data</strong> — destinations visited, bookings made, reviews written.</li>
                <li><strong>Device data</strong> — device type, operating system, app version.</li>
                <li><strong>Location data</strong> — with your permission, to enable navigation features.</li>
              </ul>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={documentTextOutline} />How We Use Your Data</h3>
              <p>Your information is used to:</p>
              <ul>
                <li>Provide and improve app features and personalisation.</li>
                <li>Process tour guide bookings and send confirmations.</li>
                <li>Generate anonymised tourism statistics for Pasig City CATO.</li>
                <li>Send important service updates and security alerts.</li>
              </ul>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={shareOutline} />Data Sharing</h3>
              <p>
                We do not sell your personal data. We may share data with:
              </p>
              <ul>
                <li>Pasig City CATO for official tourism reporting purposes.</li>
                <li>Firebase / Google Cloud for secure data storage and authentication.</li>
                <li>Service providers bound by confidentiality agreements.</li>
              </ul>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={locationOutline} />Location Data</h3>
              <p>
                Location access is requested only when you use navigation or map features.
                You may revoke location permission at any time through your device settings.
                We do not track your location in the background.
              </p>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={lockClosedOutline} />Data Security</h3>
              <p>
                We implement industry-standard security measures including encrypted
                connections (HTTPS/TLS), Firebase Authentication, and Firestore security
                rules to protect your personal information.
              </p>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={trashOutline} />Your Rights</h3>
              <p>You have the right to:</p>
              <ul>
                <li>Access the personal data we hold about you.</li>
                <li>Request correction of inaccurate data.</li>
                <li>Request deletion of your account and associated data.</li>
                <li>Opt out of non-essential communications.</li>
              </ul>
              <p>To exercise these rights, contact us at support@catour.app.</p>
            </div>

            <div className="terms-section">
              <h3><IonIcon icon={mailOutline} />Contact for Privacy</h3>
              <p>
                For privacy-related inquiries, email our Data Protection Officer at{' '}
                <strong>privacy@catour.app</strong> or call 643-1111 loc 1156.
              </p>
            </div>

          </div>
        )}

        {/* Acceptance strip */}
        <div className="terms-accept">
          <p>
            By using CATOur you confirm that you have read, understood,
            and agree to both documents above.
          </p>
          <IonButton
            expand="block"
            fill="outline"
            onClick={() => {
              updateSignupData({ acceptedTerms: true });
              if (returnTo === '/signup3' || returnTo === '/googleUser') {
                history.replace(returnTo);
              } else {
                router.goBack();
              }
            }}
          >
            I Understand
          </IonButton>
        </div>

      </IonContent>
    </IonPage>
  );
};

export default Terms;
