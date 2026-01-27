/**
 * @format
 */

import 'react-native';
import React from 'react';
import App from '../App';

// Note: import explicitly to use the types shipped with jest.
import {it} from '@jest/globals';

jest.mock('../src/hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isLoading: false,
    checkAuth: jest.fn(),
  }),
}));

jest.mock('../src/services/griftPing', () => ({
  startGriftPing: jest.fn(),
  stopGriftPing: jest.fn(),
}));

// Note: test renderer must be required after react-native.
import renderer, {act} from 'react-test-renderer';

it('renders correctly', () => {
  let tree: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<App />);
  });
  act(() => {
    tree.unmount();
  });
});
