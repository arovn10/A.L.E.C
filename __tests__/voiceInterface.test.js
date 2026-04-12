/**
 * VoiceInterface — unit tests (state machine only, no real WebSocket)
 */

const { STATES } = require('../services/voiceInterface');

describe('STATES constants', () => {
  test('exports expected voice states', () => {
    expect(STATES.IDLE).toBe('idle');
    expect(STATES.LISTENING).toBe('listening');
    expect(STATES.TRANSCRIBING).toBe('transcribing');
    expect(STATES.THINKING).toBe('thinking');
    expect(STATES.SPEAKING).toBe('speaking');
    expect(STATES.INTERRUPTED).toBe('interrupted');
    expect(STATES.MUTED).toBe('muted');
    expect(STATES.ERROR).toBe('error');
    expect(STATES.OFFLINE).toBe('offline-fallback');
  });

  test('has 9 distinct states', () => {
    const values = Object.values(STATES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe('VoiceInterface class structure', () => {
  let VoiceInterface;

  beforeAll(() => {
    // Stub ws module to avoid port binding in tests
    jest.mock('ws', () => {
      const EventEmitter = require('events');
      const MockWSSClass = class extends EventEmitter {
        constructor() { super(); }
        on() { return this; }
        close() {}
      };
      MockWSSClass.Server = class extends EventEmitter {
        constructor() { super(); }
        on() { return this; }
        close() {}
      };
      return MockWSSClass;
    });
    ({ VoiceInterface } = require('../services/voiceInterface'));
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('constructor creates expected properties', () => {
    const vi = new VoiceInterface();
    expect(vi.sessions).toBeInstanceOf(Map);
    expect(vi.isInitialized).toBe(false);
    expect(vi.ttsAvailable).toBe(false);
  });

  test('setNeuralEngine stores the engine', () => {
    const vi = new VoiceInterface();
    const mockEngine = { processQuery: jest.fn() };
    vi.setNeuralEngine(mockEngine);
    expect(vi.neuralEngine).toBe(mockEngine);
  });

  test('getStatus returns correct shape', () => {
    const vi = new VoiceInterface();
    const status = vi.getStatus();
    expect(status).toHaveProperty('initialized', false);
    expect(status).toHaveProperty('activeSessions', 0);
    expect(status).toHaveProperty('sessions');
    expect(status).toHaveProperty('ttsAvailable');
  });
});
