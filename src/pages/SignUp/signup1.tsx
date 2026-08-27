import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { 
  IonContent, IonPage, IonToolbar, 
  IonButtons, IonBackButton, IonButton, IonInput, 
  IonItem, IonLabel, IonCheckbox,
  InputCustomEvent, InputChangeEventDetail
} from '@ionic/react';
import { useSignup } from '../../context/SignupContext';
import { useAuth } from '../../context/AuthContext';
import './signup.css';
import FeedbackOverlay from '../../components/FeedbackOverlay';

const SignUP1: React.FC = () => {
  const history = useHistory();
  const { signupData, updateSignupData } = useSignup();
  const { isAuthenticated } = useAuth();
  const [FirstName,    setFirstName]    = useState(signupData.firstName ?? '');
  const [surname,      setSurname]      = useState(signupData.surname   ?? '');
  const [suffix,       setSuffix]       = useState(signupData.suffix    ?? '');
  const [noSuffix,     setNoSuffix]     = useState(!signupData.suffix);
  const [showAlert,    setShowAlert]    = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) {
      history.replace('/home');
    }
  }, [isAuthenticated, history]);

  const handleNext = () => {
    if (!FirstName.trim() || !surname.trim()) {
      setAlertMessage('Please fill in both First Name and Surname before continuing.');
      setShowAlert(true);
      return;
    }
    updateSignupData({
      firstName: FirstName,
      surname:   surname,
      suffix:    noSuffix ? '' : suffix,
    });
    history.push('/signup2');
  };

  return (
    <IonPage>
      <IonContent className="login-content" fullscreen>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/login"/>
          </IonButtons>
        </IonToolbar>

        <div className="logo-wrap">
          <img src="/assets/images/Pasig Logo.png" alt="Pasig Logo" className="logo" />
        </div>
        <h2 className="title">Catour</h2>
        <p className="subtitle">DISCOVER THE PASIG WITH AI GUIDANCE!</p>

        {/* Progress Indicator */}
        <div className="signup-progress">
          <div className="progress-step active">
            <span className="step-number">1</span>
            <span className="step-label">Personal Info</span>
          </div>
          <div className="progress-line not"></div>
          <div className="progress-step not">
            <span className="step-number">2</span>
            <span className="step-label">Account</span>
          </div>
          <div className="progress-line not"></div>
          <div className="progress-step not">
            <span className="step-number">3</span>
            <span className="step-label">Profile</span>
          </div>
        </div>

        <div className="login-card">
          <div className="form">
            <p className="formSubtitle">Personal Information</p>

            <IonLabel position="stacked">First Name *</IonLabel>
            <IonItem className="input-item">
              <IonInput
                placeholder="Enter your first name"
                type="text"
                className="text-input"
                value={FirstName}
                onIonInput={(e: InputCustomEvent<InputChangeEventDetail>) => setFirstName(e.detail.value ?? '')}
              />
            </IonItem>

            <IonLabel position="stacked">Surname *</IonLabel>
            <IonItem className="input-item">
              <IonInput
                placeholder="Enter your surname"
                type="text"
                className="text-input"
                value={surname}
                onIonInput={(e: InputCustomEvent<InputChangeEventDetail>) => setSurname(e.detail.value ?? '')}
              />
            </IonItem>

            <IonLabel position="stacked">Suffix Name</IonLabel>
            <IonItem className="input-item">
              <IonInput
                placeholder="ex: Jr., Sr. I, II"
                type="text"
                className="text-input"
                value={suffix}
                onIonInput={(e: InputCustomEvent<InputChangeEventDetail>) => setSuffix(e.detail.value ?? '')}
                disabled={noSuffix}
              />
              <div className="checkbox-row">
                <IonCheckbox checked={noSuffix} onIonChange={(e) => setNoSuffix(e.detail.checked)} />
                <label className="checkbox-label">None</label>
              </div>
            </IonItem>

            <IonButton expand="block" className="login-button" onClick={handleNext}>
              Next
            </IonButton>
          </div>
        </div>

        <FeedbackOverlay
          isOpen={showAlert}
          onDidDismiss={() => setShowAlert(false)}
          header="Required Fields"
          message={alertMessage}
          buttons={['OK']}
        />
      </IonContent>
    </IonPage>
  );
};

export default SignUP1;