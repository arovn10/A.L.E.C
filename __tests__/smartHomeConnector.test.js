/**
 * SmartHomeConnector — unit tests
 * Run without real HA by checking mock-mode behavior.
 */

global.fetch = jest.fn();

const { SmartHomeConnector } = require('../services/smartHomeConnector');

describe('SmartHomeConnector (mock mode — no HA_TOKEN)', () => {
  let connector;

  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure no token so tests use mock mode
    delete process.env.HA_TOKEN;
    delete process.env.HOME_ASSISTANT_ACCESS_TOKEN;
    connector = new SmartHomeConnector();
    connector.haToken = ''; // force mock mode
  });

  test('connect in mock mode loads default devices', async () => {
    const result = await connector.connect();
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no-token');
    expect(connector.devices.length).toBeGreaterThan(0);
  });

  test('getStatus returns device list', async () => {
    await connector.connect();
    const status = connector.getStatus();
    expect(status).toHaveProperty('deviceCount');
    expect(status.deviceCount).toBeGreaterThan(0);
    expect(status.devices[0]).toHaveProperty('id');
    expect(status.devices[0]).toHaveProperty('state');
  });

  test('executeCommand turn_on changes device state', async () => {
    await connector.connect();
    const device = connector.devices.find(d => d.type === 'light');
    device.state = 'off';

    const result = await connector.executeCommand(device.id, 'turn_on');
    expect(result.success).toBe(true);
    expect(result.state).toBe('on');
    expect(device.state).toBe('on');
  });

  test('executeCommand turn_off changes device state', async () => {
    await connector.connect();
    const device = connector.devices.find(d => d.type === 'light');
    device.state = 'on';

    const result = await connector.executeCommand(device.id, 'turn_off');
    expect(result.success).toBe(true);
    expect(result.state).toBe('off');
  });

  test('executeCommand toggle flips state', async () => {
    await connector.connect();
    const device = connector.devices.find(d => d.type === 'light');
    const initialState = device.state;

    await connector.executeCommand(device.id, 'toggle');
    const expected = initialState === 'on' ? 'off' : 'on';
    expect(device.state).toBe(expected);
  });

  test('executeCommand set_temperature updates attribute', async () => {
    await connector.connect();
    const device = connector.devices.find(d => d.type === 'climate');

    await connector.executeCommand(device.id, 'set_temperature', { temperature: 68 });
    expect(device.attributes.temperature).toBe(68);
  });

  test('executeCommand throws for unknown entity', async () => {
    await connector.connect();
    await expect(connector.executeCommand('nonexistent.entity', 'turn_on'))
      .rejects.toThrow('not found');
  });

  test('executeCommand throws for unknown action', async () => {
    await connector.connect();
    const device = connector.devices[0];
    await expect(connector.executeCommand(device.id, 'fly_to_moon'))
      .rejects.toThrow('Unknown action');
  });

  test('getDevices returns all devices', async () => {
    await connector.connect();
    const devices = await connector.getDevices();
    expect(Array.isArray(devices)).toBe(true);
    expect(devices.length).toBeGreaterThan(0);
  });
});
