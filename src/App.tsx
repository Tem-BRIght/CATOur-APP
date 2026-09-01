// App.tsx

import { Redirect, Route } from 'react-router-dom';
import {
  IonApp,
  IonRouterOutlet,
  setupIonicReact
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { AuthProvider } from './context/AuthContext';
import { useAuth, UserRole } from './context/AuthContext';
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
import SupportChat       from './pages/Settings/ContactSupport/SupportChat';
import Terms             from './pages/Settings/Terms/Terms';
import VerifyEmail        from './pages/Settings/VerifyEmail/VerifyEmail';
import VerifyPhone        from './pages/Settings/VerifyPhone/VerifyPhone';
import ChangePassword     from './pages/Settings/ChangePassword/ChangePassword';

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

interface ProtectedViewProps {
  component: React.ComponentType<any>;
  allowedRole: Exclude<UserRole, null>;
  [key: string]: any;
}

const ProtectedView: React.FC<ProtectedViewProps> = ({
  component: Component,
  allowedRole,
  ...restProps
}) => {
  const { authLoading, authError, isAuthenticated, mustChangePassword, role } = useAuth();

  if (authLoading) return <Redirect to="/splash" />;
  if (!isAuthenticated || authError || !role) return <Redirect to="/login" />;
  if (role !== allowedRole) {
    return (
      <Redirect
        to={
          role === 'tourguide'
            ? mustChangePassword
              ? '/tourguide/change-password'
              : '/tourguide/home'
            : '/home'
        }
      />
    );
  }
  return <Component {...restProps} />;
};

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
            <Route exact path="/home"           render={props => <ProtectedView component={Home} allowedRole="user" {...props} />} />
            <Route exact path="/popular"        render={props => <ProtectedView component={PopularAll} allowedRole="user" {...props} />} />
            <Route exact path="/recommended"    render={props => <ProtectedView component={RecommendedAll} allowedRole="user" {...props} />} />
            <Route exact path="/notifications"  render={props => <ProtectedView component={Notifications} allowedRole="user" {...props} />} />
            <Route exact path="/maps"           render={props => <ProtectedView component={MapPage} allowedRole="user" {...props} />} />
            <Route path="/destination/:id"      render={props => <ProtectedView component={DestinationDetail} allowedRole="user" {...props} />} />
            
            <Route exact path="/ai-guide"       render={props => <ProtectedView component={AIGuide} allowedRole="user" {...props} />} />

              {/* ── Settings ──────────────────────────────────────────────────── */}
            <Route exact path="/settings"       render={props => <ProtectedView component={Settings} allowedRole="user" {...props} />} />
            <Route exact path="/profile"        render={props => <ProtectedView component={Profile} allowedRole="user" {...props} />} />
            <Route exact path="/favorites"      render={props => <ProtectedView component={Favorites} allowedRole="user" {...props} />} />
            <Route exact path="/my-reviews"     render={props => <ProtectedView component={MyReviews} allowedRole="user" {...props} />} />
            <Route exact path="/tour"           render={props => <ProtectedView component={BookingHistory} allowedRole="user" {...props} />} />
            <Route exact path="/scan"           render={props => <ProtectedView component={Scan} allowedRole="user" {...props} />} />
            <Route exact path="/settings/verify-email" render={props => <ProtectedView component={VerifyEmail} allowedRole="user" {...props} />} />
            <Route exact path="/settings/verify-phone" render={props => <ProtectedView component={VerifyPhone} allowedRole="user" {...props} />} />
            <Route exact path="/settings/change-password" render={props => <ProtectedView component={ChangePassword} allowedRole="user" {...props} />} />
            <Route exact path="/settings/about" render={props => <ProtectedView component={About} allowedRole="user" {...props} />} />
            <Route exact path="/settings/help"  render={props => <ProtectedView component={Help} allowedRole="user" {...props} />} />
            <Route exact path="/settings/report-problem" render={props => <ProtectedView component={ReportProblem} allowedRole="user" {...props} />} />
            <Route exact path="/settings/contact-support" render={props => <ProtectedView component={ContactSupport} allowedRole="user" {...props} />} />
            <Route exact path="/support-chat/:ticketId" render={props => <ProtectedView component={SupportChat} allowedRole="user" {...props} />} />
            <Route exact path="/settings/terms" render={props => <ProtectedView component={Terms} allowedRole="user" {...props} />} />

              {/* ── Tourguide ─────────────────────────────────────────────────── */}
            <Route exact path="/tourguide/home"            render={props => <ProtectedView component={TourGuideHome} allowedRole="tourguide" {...props} />} />
            <Route exact path="/tourguide/profile"         render={props => <ProtectedView component={TourGuideProfile} allowedRole="tourguide" {...props} />} />
            <Route exact path="/tourguide/history"         render={props => <ProtectedView component={TourGuideHistory} allowedRole="tourguide" {...props} />} />
            <Route exact path="/tourguide/list/:sessionId?" render={props => <ProtectedView component={TourGuideList} allowedRole="tourguide" {...props} />} />
            <Route exact path="/feedback-qr/:sessionId"    render={props => <ProtectedView component={FeedbackQR} allowedRole="tourguide" {...props} />} />
            <Route exact path="/tourguide/generateQR"      render={props => <ProtectedView component={GenerateQR} allowedRole="tourguide" {...props} />} />
            <Route exact path="/tourguide/change-password" render={props => <ProtectedView component={TouristChangepass} allowedRole="tourguide" {...props} />} />
            <Route exact path="/tourguide/analytics"       render={props => <ProtectedView component={TourGuideAnalytics} allowedRole="tourguide" {...props} />} />

              {/* ── Tour Session (tourist view) ────────────────────────────────── */}
            <Route exact path="/tour-session/:sessionId"   render={props => <ProtectedView component={TourSession} allowedRole="user" {...props} />} />
            <Route exact path="/feedback/:sessionId" render={props => <ProtectedView component={Tourguidefeedback} allowedRole="user" {...props} />} />
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
