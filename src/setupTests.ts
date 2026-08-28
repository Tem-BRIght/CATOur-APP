<<<<<<< HEAD
import '@testing-library/jest-dom/extend-expect';
import React from 'react';
import { vi } from 'vitest';
=======
// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/extend-expect';
>>>>>>> origin/main

// Mock matchmedia
window.matchMedia = window.matchMedia || function() {
  return {
      matches: false,
      addListener: function() {},
      removeListener: function() {}
  };
};
<<<<<<< HEAD

vi.mock('@ionic/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ionic/react')>();
  return {
    ...actual,
    IonModal: ({ children, isOpen }: any) => (isOpen ? React.createElement('div', { 'data-testid': 'ion-modal' }, children) : null),
  };
});
=======
>>>>>>> origin/main
