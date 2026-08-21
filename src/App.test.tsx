import React from 'react';
import { render } from '@testing-library/react';
import App from './App';
import { parseItineraryResponse } from './services/aiService';

test('renders without crashing', () => {
  const { baseElement } = render(<App />);
  expect(baseElement).toBeDefined();
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
