// src/components/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { IonPage, IonContent, IonButton } from '@ionic/react';

interface Props  { children: ReactNode; }
interface State  { hasError: boolean; error: Error | null; }

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <IonPage>
          <IonContent className="ion-padding ion-text-center">
            <div style={{ marginTop: 80 }}>
              <h2>Something went wrong</h2>
              <p style={{ color: '#64748B', fontSize: 14 }}>
                {this.state.error?.message || 'An unexpected error occurred.'}
              </p>
              <IonButton onClick={() => this.setState({ hasError: false, error: null })}>
                Try Again
              </IonButton>
              <IonButton fill="outline" onClick={() => window.location.replace('/home')}>
                Go Home
              </IonButton>
            </div>
          </IonContent>
        </IonPage>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;