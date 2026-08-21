/// <reference types="vite/client" />

declare module '@codetrix-studio/capacitor-google-auth/dist/types' {
  export interface GoogleAuthUser {
    authentication: {
      access_token: string;
      id_token: string;
      serverAuthCode?: string;
    };
    email: string;
    familyName: string;
    givenName: string;
    imageUrl: string;
    name: string;
  }
}
