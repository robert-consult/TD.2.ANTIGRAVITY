import 'react-native-gesture-handler/jestSetup';

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
