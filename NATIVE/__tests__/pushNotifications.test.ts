jest.mock('../src/services/api', () => ({
  pushApi: {
    registerDevice: jest.fn().mockResolvedValue({ ok: true }),
    unregisterDevice: jest.fn().mockResolvedValue({ ok: true }),
  },
}));

import { pushApi } from '../src/services/api';
import pushNotificationService from '../src/services/pushNotifications';

describe('native push notification service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pushNotificationService.clearStoredToken();
  });

  it('clears the stored token after unregistering', async () => {
    const token = await pushNotificationService.getToken();

    expect(token).toBe('jest-fcm-token');
    expect(pushNotificationService.getStoredToken()).toBe('jest-fcm-token');

    await pushNotificationService.unregisterToken();

    expect(pushApi.unregisterDevice).toHaveBeenCalledWith({ token: 'jest-fcm-token' });
    expect(pushNotificationService.getStoredToken()).toBeNull();
  });
});
