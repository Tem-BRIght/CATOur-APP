import '@testing-library/jest-dom/extend-expect';
import React from 'react';
import { vi } from 'vitest';

// Mock matchmedia
window.matchMedia = window.matchMedia || function() {
  return {
      matches: false,
      addListener: function() {},
      removeListener: function() {}
  };
};

vi.mock('@ionic/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ionic/react')>();
  return {
    ...actual,
    IonModal: ({ children, isOpen }: any) => (isOpen ? React.createElement('div', { 'data-testid': 'ion-modal' }, children) : null),
  };
});
