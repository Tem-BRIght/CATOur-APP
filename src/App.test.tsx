import React, { useState } from 'react';
import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import Permissions from './pages/Settings/Permissions';
import WriteReviewModal from './pages/Home/DestinationDetail/writeReview/WriteReviewModal';
import { parseItineraryResponse } from './services/aiService';
import { hydrateTouristProfile } from './services/sessionService';

test('renders without crashing', () => {
  const { baseElement } = render(<App />);
  expect(baseElement).toBeDefined();
});

test('keeps anonymous toggle stable while editing and rerendering', async () => {
  const user = userEvent.setup();

  const Harness = () => {
    const [tick, setTick] = useState(0);
    return (
      <>
        <button type="button" onClick={() => setTick(v => v + 1)}>rerender</button>
        <WriteReviewModal
          isOpen={true}
          onDidDismiss={() => {}}
          destinationId="dest-1"
          destinationName="Bohol Beach Club"
          userId="user-1"
          userName="Jane Doe"
          existingReview={{
            overallRating: 5,
            feeling: 'Loved it',
            review: 'Amazing trip',
            visitDate: '2026-07-01',
            companion: 'Friends',
            duration: '2-3 hours',
            anonymous: true,
            allowVenueReply: true,
          }}
          key={tick}
        />
      </>
    );
  };

  render(<Harness />);

  const checkbox = screen.getByRole('checkbox', { name: /submit anonymously/i });
  expect(checkbox).toBeChecked();

  await user.click(checkbox);
  expect(checkbox).not.toBeChecked();

  await user.click(screen.getByRole('button', { name: /rerender/i }));
  expect(screen.getByRole('checkbox', { name: /submit anonymously/i })).not.toBeChecked();
});

test('renders the permissions screen with notification, map, voice, and camera options', () => {
  render(<Permissions />);

  expect(screen.getByText('Permissions')).toBeInTheDocument();
  expect(screen.getByText('Notifications')).toBeInTheDocument();
  expect(screen.getByText('Maps')).toBeInTheDocument();
  expect(screen.getByText('Voice')).toBeInTheDocument();
  expect(screen.getByText('Camera')).toBeInTheDocument();
});

test('hydrates tourist profile fields for session display', () => {
  const hydrated = hydrateTouristProfile({
    uid: 'tourist-1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    joinedAt: '2026-08-01T00:00:00.000Z',
  }, {
    dateOfBirth: '2004-03-15',
    gender: 'Female',
    nationality: 'Filipino',
    religion: 'Christian',
    address: '16 Rizal St, Cebu City',
  } as any);

  expect(hydrated.gender).toBe('Female');
  expect(hydrated.nationality).toBe('Filipino');
  expect(hydrated.religion).toBe('Christian');
  expect(hydrated.birthMonth).toBe('March');
  expect(hydrated.age).toBeGreaterThanOrEqual(21);
});

test('parses itinerary JSON from fenced or wrapped AI responses', () => {
  const parsed = parseItineraryResponse(`Here is the itinerary:\n\n\`\`\`json\n[{"day":1,"theme":"Arrival","slots":[{"time":"9:00 AM","activity":"Check in and start at the main gate.","tip":"Go early for cooler weather."}]}]\n\`\``);

  expect(parsed).toHaveLength(1);
  expect(parsed[0]).toMatchObject({
    day: 1,
    theme: 'Arrival',
    slots: [{
      time: '9:00 AM',
      activity: 'Check in and start at the main gate.',
      tip: 'Go early for cooler weather.',
    }],
  });

  const wrapped = parseItineraryResponse('{"days":[{"day":2,"theme":"Evening stroll","slots":[{"time":"5:00 PM","activity":"Walk the plaza.","tip":"Bring a light jacket."}]}]}');
  expect(wrapped).toHaveLength(1);
  expect(wrapped[0].day).toBe(2);
});
