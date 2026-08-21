// App.tsx

import { Redirect, Route } from 'react-router-dom';
import {
  IonApp,
  IonRouterOutlet,
  setupIonicReact
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { AuthProvider } from './context/AuthContext';
import { SignupProvider } from './context/SignupContext';
// ── Splash ────────────────────────────────────────────────────────────────────
import SplashScreen      from './pages/Splash/SplashScreen';

// ── Auth pages ────────────────────────────────────────────────────────────────
import Login             from './pages/Login/Login';
import SignUP1           from './pages/SignUp/signup1';
import SignUP2           from './pages/SignUp/signup2';
import SignUP3           from './pages/SignUp/signup3';
import ResetPassword     from './pages/ResetPassword/ResetPassword';
import TermsSignup       from './pages/SignUp/Terms';
import GoogleUserProfile from './pages/SignUp/googleUser/googleUser';

// ── Main app pages ────────────────────────────────────────────────────────────
import Home              from './pages/Home/home';
import PushNotificationsBootstrap from './components/PushNotificationsBootstrap';
import { ProximityAIProvider } from './context/Proximityaicontext'
// FIX: this used to point at './pages/AI/Proximityaioverlay', which is the
// OLD/duplicate file that only re-exports the ProximityAIProvider (no UI).
// The actual visual "AI Talking" card lives in ProximityAITalkingOverlay.tsx —
// import that one instead, or the overlay will never appear on screen.
// If your project actually saved this file somewhere else (e.g. inside
// './pages/AI/'), change ONLY the path below to match — keep the component
// name ProximityAITalkingOverlay as-is.
import ProximityAITalkingOverlay from './pages/AI/ProximityAITalkingOverlay';
import PopularAll        from './pages/Home/PopularAll/PopularAll';
import RecommendedAll    from './pages/Home/RecommendedAll/RecommendedAll';
import DestinationDetail from './pages/Home/DestinationDetail/DestinationDetail';
import Notifications     from './pages/Home/Notifications/Notifications';

// ── Settings / Profile ────────────────────────────────────────────────────────
import Settings          from './pages/Settings/Settings';
import Profile           from './pages/Settings/Profile/profile';
import Favorites         from './pages/Settings/favorites/Favorites';
import MyReviews         from './pages/Settings/myReviews/MyReviews';
import BookingHistory    from './pages/Settings/Tour/Tour';
import Scan              from './pages/Settings/Scan/Scan';
import Tourguidefeedback from './pages/TourSession/Tourguidefeedback/TourGuideFeedback';
import About             from './pages/Settings/About';
import Help              from './pages/Settings/Help';
import ReportProblem     from './pages/Settings/ReportProblem/ReportProblem';
import ContactSupport    from './pages/Settings/ContactSupport/ContactSupport';
import Terms             from './pages/Settings/Terms/Terms';
import VerifyEmail        from './pages/Settings/VerifyEmail/VerifyEmail';
import VerifyPhone        from './pages/Settings/VerifyPhone/VerifyPhone';

// ── Other ─────────────────────────────────────────────────────────────────────
import AIGuide           from './pages/AI/AIGuide';
import MapPage           from './pages/Map/maps';

// ── TourGuide ──────────────────────────────────────────────────────────────────
import TourGuideHome         from './pages/tourGuide/Home';
import TourGuideProfile      from './pages/tourGuide/Profile';
import TourGuideHistory      from './pages/tourGuide/History';
import TourGuideList         from './pages/tourGuide/TouristList';
import FeedbackQR            from './pages/tourGuide/Feedbackqr';
import Reviews               from './pages/tourGuide/Reviews';
import GenerateQR            from './pages/tourGuide/GenerateQR';
import TouristChangepass     from './pages/tourGuide/ChangePassword';
import TourGuideAnalytics    from './pages/tourGuide/Analytics';
// ── Tour Session (tourist view) ───────────────────────────────────────────────
import TourSession           from './pages/TourSession/TourSession';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/* Dark mode */
import '@ionic/react/css/palettes/dark.system.css';

/* Theme variables */
import './theme/variables.css';
import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import React, { useEffect } from 'react';
import ErrorBoundary from './components/ErrorBoundary';

setupIonicReact();

const App: React.FC = () => {
  useEffect(() => {
    try {
      const isNative = Capacitor.isNativePlatform?.() ?? Capacitor.getPlatform() !== 'web';
      if (!isNative) return;
      const nativeClientId = import.meta.env.VITE_GOOGLE_ANDROID_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID;
      GoogleAuth.initialize({
        scopes: ['profile', 'email'],
        grantOfflineAccess: false,
        ...(nativeClientId ? { clientId: nativeClientId } : {}),
      }).catch(err => console.warn('[App] GoogleAuth.initialize failed', err));
    } catch (e) {
      console.warn('[App] GoogleAuth init error', e);
    }
  }, []);

  return (
  <AuthProvider>
    <SignupProvider>
      <ErrorBoundary>
        <IonApp>
          <IonReactRouter>
            <ProximityAIProvider>
            <IonRouterOutlet>

              {/* ── Splash ────────────────────────────────────────────────────── */}
            <Route exact path="/splash"         component={SplashScreen}      />

            {/* ── Auth ──────────────────────────────────────────────────────── */}
            <Route exact path="/login"          component={Login}             />
            <Route exact path="/reset-password" component={ResetPassword}     />
            <Route exact path="/signUp1"        component={SignUP1}           />
            <Route exact path="/signup2"        component={SignUP2}           />
            <Route exact path="/signup3"        component={SignUP3}           />
            <Route exact path="/terms-signup"   component={TermsSignup}       />
            <Route exact path="/googleUser"     component={GoogleUserProfile} />
            
            {/* ── Main app ──────────────────────────────────────────────────── */}
            <Route exact path="/home"           component={Home}              />
            <Route exact path="/popular"        component={PopularAll}        />
            <Route exact path="/recommended"    component={RecommendedAll}    />
            <Route exact path="/notifications"  component={Notifications}     />
            <Route exact path="/maps"           component={MapPage}           />
            <Route path="/destination/:id"      component={DestinationDetail} />
            
            <Route exact path="/ai-guide"       component={AIGuide}           />

            {/* ── Settings ──────────────────────────────────────────────────── */}
            <Route exact path="/settings"       component={Settings}          />
            <Route exact path="/profile"        component={Profile}           />
            <Route exact path="/favorites"      component={Favorites}         />
            <Route exact path="/my-reviews"     component={MyReviews}         />
            <Route exact path="/tour"           component={BookingHistory}    />
            <Route exact path="/scan"           component={Scan}              />
            <Route exact path="/settings/verify-email" component={VerifyEmail} />
            <Route exact path="/settings/verify-phone" component={VerifyPhone} />
            <Route exact path="/settings/about" component={About}             />
            <Route exact path="/settings/help"  component={Help}              />
            <Route exact path="/settings/report-problem" component={ReportProblem}     />
            <Route exact path="/settings/contact-support" component={ContactSupport}   />
            <Route exact path="/settings/terms"          component={Terms}             />

            {/* ── Destination detail ────────────────────────────────────────── */}

            
            {/* ── Tourguide ─────────────────────────────────────────────────── */}
            <Route exact path="/tourguide/home"            component={TourGuideHome}     />
            <Route exact path="/tourguide/profile"         component={TourGuideProfile}  />
            <Route exact path="/tourguide/history"         component={TourGuideHistory}  />
            <Route exact path="/tourguide/list/:sessionId?" component={TourGuideList}     />
            <Route exact path="/feedback-qr/:sessionId"    component={FeedbackQR}        />
            <Route exact path="/tourguide/generateQR"      component={GenerateQR}        />
            <Route exact path="/tourguide/change-password" component={TouristChangepass} />
            <Route exact path="/tourguide/analytics"       component={TourGuideAnalytics} />

            {/* ── Tour Session (tourist view) ────────────────────────────────── */}
            <Route exact path="/tour-session/:sessionId"   component={TourSession}      />
            <Route exact path="/feedback/:sessionId"     component={Tourguidefeedback} />
            <Route exact path="/reviews/:sessionId?/:guideId?" component={Reviews} />

            {/* ── Default: show loading first ────────────────────────────────── */}
            <Route exact path="/" render={() => <Redirect to="/splash" />} />
            <Route render={() => <Redirect to="/login" />} />

          </IonRouterOutlet>
          <ProximityAITalkingOverlay />
          </ProximityAIProvider>
          
          </IonReactRouter>

          <PushNotificationsBootstrap />
        </IonApp>
      </ErrorBoundary>
    </SignupProvider>
  </AuthProvider>
)};

export default App;
