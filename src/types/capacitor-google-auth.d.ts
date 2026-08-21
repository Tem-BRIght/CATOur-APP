/// <reference types="vite/client" />

declare module '@codetrix-studio/capacitor-google-auth' {
  export interface User {
    authentication: {
      accessToken: string;
      idToken: string;
      refreshToken?: string;
    };
    email: string;
    familyName: string;
    givenName: string;
    imageUrl: string;
    name: string;
    serverAuthCode?: string;
  }

  export const GoogleAuth: {
    initialize(options?: any): Promise<void>;
    signIn(): Promise<User>;
    signOut(): Promise<void>;
  };
}

