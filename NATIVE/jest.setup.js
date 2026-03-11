import 'react-native-gesture-handler/jestSetup';

// Reanimated ships ESM builds that Jest can't execute without extra transforms.
// Use the official mock to keep unit tests lightweight.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// react-native-svg depends on native bindings; mock it for unit tests.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');

  const Mock = ({ children, ...props }) => React.createElement(View, props, children);

  return {
    __esModule: true,
    default: Mock,
    Svg: Mock,
    Defs: Mock,
    LinearGradient: Mock,
    Line: Mock,
    Path: Mock,
    Circle: Mock,
    Stop: Mock,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    initialWindowMetrics: null,
  };
});

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    NavigationContainer: ({ children }) => React.createElement(React.Fragment, null, children),
  };
});

jest.mock('@react-navigation/stack', () => ({
  createStackNavigator: () => ({
    Navigator: ({ children }) => children,
    Screen: () => null,
  }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({ children }) => children,
    Screen: () => null,
  }),
}));

jest.mock('react-native-linear-gradient', () => 'LinearGradient');
jest.mock('react-native-vector-icons/Feather', () => 'Icon');

jest.mock('react-native-mmkv', () => {
  const store = new Map();

  class MMKV {
    set(key, value) {
      store.set(key, String(value));
    }

    getString(key) {
      const value = store.get(key);
      return value === undefined ? undefined : value;
    }

    delete(key) {
      store.delete(key);
    }
  }

  return { MMKV };
});

jest.mock('react-native-device-info', () => ({
  getUniqueId: async () => 'jest-unique-id',
  getDeviceId: () => 'jest-device-id',
  getSystemVersion: () => '0',
  getBrand: () => 'jest',
  getModel: () => 'jest-model',
  getVersion: () => '0.0.0',
}));

jest.mock('@react-native-firebase/messaging', () => {
  const mock = () => ({
    requestPermission: jest.fn().mockResolvedValue(1),
    getToken: jest.fn().mockResolvedValue('jest-fcm-token'),
    onTokenRefresh: jest.fn(() => jest.fn()),
    onMessage: jest.fn(() => jest.fn()),
    onNotificationOpenedApp: jest.fn(() => jest.fn()),
    getInitialNotification: jest.fn().mockResolvedValue(null),
    hasPermission: jest.fn().mockResolvedValue(1),
    subscribeToTopic: jest.fn().mockResolvedValue(undefined),
    unsubscribeFromTopic: jest.fn().mockResolvedValue(undefined),
  });
  mock.AuthorizationStatus = {
    AUTHORIZED: 1,
    PROVISIONAL: 2,
  };
  return {
    __esModule: true,
    default: mock,
  };
});

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn().mockResolvedValue(undefined),
    displayNotification: jest.fn().mockResolvedValue(undefined),
    onForegroundEvent: jest.fn(() => jest.fn()),
  },
  AndroidImportance: {
    HIGH: 4,
    DEFAULT: 3,
  },
  EventType: {
    PRESS: 1,
  },
}));
