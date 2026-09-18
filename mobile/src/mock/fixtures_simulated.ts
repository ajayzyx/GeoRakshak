// SIMULATED_DEMO fixtures for mock mode (docs/development.md §4).
// Everything here is fictional: the area, the people and the alerts. Shapes
// follow the docs/api.md examples. Nothing here describes a real location.

import { InboxItem, User } from '../core/types';

export const MOCK_PROVENANCE = 'SIMULATED_DEMO' as const;
export const MOCK_AREA_NAME = 'Mock Area — not a real location';

export const MOCK_USERS: User[] = [
  {
    id: '00000000-0000-4000-8000-00000000f001',
    full_name: 'Mock Field Officer',
    email: 'field.mock@example.org',
    role: 'FIELD_OFFICER',
    preferred_language: 'en',
    admin_boundary_id: '00000000-0000-4000-8000-0000000000d1',
    is_demo_account: true,
  },
  {
    id: '00000000-0000-4000-8000-00000000c001',
    full_name: 'Mock Citizen',
    email: 'citizen.mock@example.org',
    role: 'CITIZEN',
    preferred_language: 'en',
    admin_boundary_id: '00000000-0000-4000-8000-0000000000d1',
    is_demo_account: true,
  },
];

export function mockInbox(now: Date): InboxItem[] {
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  return [
    {
      alert_id: '00000000-0000-4000-8000-0000000a1001',
      tier: 'WATCH',
      severity: 'HIGH',
      title: `[MOCK] Internal watch: ${MOCK_AREA_NAME}`,
      body: 'Simulated alert for testing the app. Risk class High in a mock cell. Not a real warning.',
      language: 'en',
      dispatched_at: minutesAgo(42),
      acknowledged_at: null,
      risk_zone_ids: ['00000000-0000-4000-8000-0000000c0001'],
      lead_time_h: 0,
      is_demo: true,
    },
    {
      alert_id: '00000000-0000-4000-8000-0000000a2001',
      tier: 'WARNING',
      severity: 'VERY_HIGH',
      title: `[MOCK] Public warning: ${MOCK_AREA_NAME}`,
      body:
        'Simulated, human-approved warning for testing the app. Not a real warning. ' +
        'Follow instructions from local authorities.',
      language: 'en',
      dispatched_at: minutesAgo(15),
      acknowledged_at: null,
      risk_zone_ids: ['00000000-0000-4000-8000-0000000c0001'],
      lead_time_h: 24,
      is_demo: true,
    },
  ];
}

export function mockRiskAt(now: Date): unknown {
  return {
    grid_code: 'MOCK-0001',
    assessment: {
      lead_time_h: 0,
      score: 0.66,
      severity: 'HIGH',
      confidence: 'LOW',
      model_version: 'mock-0.0.0',
      issue_time: now.toISOString(),
      run_mode: 'DEMO_REPLAY',
      provenance: MOCK_PROVENANCE,
      factors: [
        { label: 'Mock factor', text: 'Mock factor: simulated heavy rainfall (not real data)' },
        { label: 'Mock factor', text: 'Mock factor: simulated steep slope (not real data)' },
      ],
    },
    disclaimer: 'Decision-support risk estimate. Not an official warning.',
  };
}
