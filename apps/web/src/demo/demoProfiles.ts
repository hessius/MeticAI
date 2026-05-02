/**
 * Demo profiles — realistic Meticulous espresso machine profiles.
 *
 * These profiles use the actual @meticulous-home/espresso-profile schema
 * and represent common espresso recipes.
 */

import type { Profile } from '@meticulous-home/espresso-profile'

const DEMO_AUTHOR = 'Metic Demo'
const DEMO_AUTHOR_ID = 'demo-author-001'

export const DEMO_PROFILES: Profile[] = [
  {
    name: 'Classic Italian',
    id: 'demo-profile-001',
    author: DEMO_AUTHOR,
    author_id: DEMO_AUTHOR_ID,
    previous_authors: [],
    temperature: 93,
    final_weight: 36,
    variables: [],
    stages: [
      {
        name: 'Preinfusion',
        key: 'preinfusion',
        type: 'pressure',
        dynamics: { points: [[0, 3]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'time', value: 8 }],
      },
      {
        name: 'Extraction',
        key: 'extraction',
        type: 'pressure',
        dynamics: { points: [[0, 9]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'weight', value: 36 }],
      },
    ],
  },
  {
    name: 'Turbo Shot',
    id: 'demo-profile-002',
    author: DEMO_AUTHOR,
    author_id: DEMO_AUTHOR_ID,
    previous_authors: [],
    temperature: 95,
    final_weight: 45,
    variables: [],
    stages: [
      {
        name: 'Flash Preinfusion',
        key: 'flash-pre',
        type: 'pressure',
        dynamics: { points: [[0, 5]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'time', value: 3 }],
      },
      {
        name: 'High Flow',
        key: 'high-flow',
        type: 'flow',
        dynamics: { points: [[0, 4.5]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'weight', value: 45 }],
      },
    ],
  },
  {
    name: 'Blooming Espresso',
    id: 'demo-profile-003',
    author: DEMO_AUTHOR,
    author_id: DEMO_AUTHOR_ID,
    previous_authors: [],
    temperature: 92,
    final_weight: 40,
    variables: [],
    stages: [
      {
        name: 'Bloom',
        key: 'bloom',
        type: 'flow',
        dynamics: { points: [[0, 2]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'time', value: 10 }],
      },
      {
        name: 'Pause',
        key: 'pause',
        type: 'flow',
        dynamics: { points: [[0, 0]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'time', value: 15 }],
      },
      {
        name: 'Extraction',
        key: 'extract',
        type: 'pressure',
        dynamics: { points: [[0, 6]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'weight', value: 40 }],
      },
    ],
  },
  {
    name: 'Lungo',
    id: 'demo-profile-004',
    author: DEMO_AUTHOR,
    author_id: DEMO_AUTHOR_ID,
    previous_authors: [],
    temperature: 94,
    final_weight: 60,
    variables: [],
    stages: [
      {
        name: 'Preinfusion',
        key: 'preinfusion',
        type: 'pressure',
        dynamics: { points: [[0, 3]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'time', value: 6 }],
      },
      {
        name: 'Low Pressure',
        key: 'low-pressure',
        type: 'pressure',
        dynamics: { points: [[0, 6]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'weight', value: 60 }],
      },
    ],
  },
  {
    name: 'Ristretto',
    id: 'demo-profile-005',
    author: DEMO_AUTHOR,
    author_id: DEMO_AUTHOR_ID,
    previous_authors: [],
    temperature: 92,
    final_weight: 20,
    variables: [],
    stages: [
      {
        name: 'Preinfusion',
        key: 'preinfusion',
        type: 'flow',
        dynamics: { points: [[0, 1.5]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'time', value: 10 }],
      },
      {
        name: 'Extraction',
        key: 'extraction',
        type: 'pressure',
        dynamics: { points: [[0, 9]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'weight', value: 20 }],
      },
    ],
  },
  {
    name: 'Adaptive Pressure',
    id: 'demo-profile-006',
    author: DEMO_AUTHOR,
    author_id: DEMO_AUTHOR_ID,
    previous_authors: [],
    temperature: 93.5,
    final_weight: 38,
    variables: [],
    stages: [
      {
        name: 'Preinfusion',
        key: 'preinfusion',
        type: 'pressure',
        dynamics: { points: [[0, 4]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'time', value: 8 }],
      },
      {
        name: 'Peak',
        key: 'peak',
        type: 'pressure',
        dynamics: { points: [[0, 9]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'time', value: 15 }],
      },
      {
        name: 'Decline',
        key: 'decline',
        type: 'pressure',
        dynamics: { points: [[0, 6]], over: 'time', interpolation: 'none' },
        exit_triggers: [{ type: 'weight', value: 38 }],
      },
    ],
  },
]
