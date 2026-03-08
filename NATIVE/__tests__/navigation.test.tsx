import React from "react";
import renderer, { act } from "react-test-renderer";

const registeredTabs: string[] = [];

jest.mock("@react-navigation/bottom-tabs", () => {
  const ReactLib = require("react");
  return {
    createBottomTabNavigator: () => ({
      Navigator: ({ children }: { children: React.ReactNode }) =>
        ReactLib.createElement(ReactLib.Fragment, null, children),
      Screen: ({ name }: { name: string }) => {
        registeredTabs.push(name);
        return null;
      },
    }),
  };
});

jest.mock("../src/screens/main/DashboardScreen", () => ({
  DashboardScreen: () => null,
}));
jest.mock("../src/screens/main/QuotesScreen", () => ({
  QuotesScreen: () => null,
}));
jest.mock("../src/screens/main/ChartsScreen", () => ({
  ChartsScreen: () => null,
}));
jest.mock("../src/screens/main/TradeScreen", () => ({
  TradeScreen: () => null,
}));
jest.mock("../src/screens/main/HistoryScreen", () => ({
  HistoryScreen: () => null,
}));
jest.mock("../src/screens/main/AccountScreen", () => ({
  AccountScreen: () => null,
}));

import { MainTabNavigator } from "../src/navigation/MainTabNavigator";

describe("MainTabNavigator", () => {
  beforeEach(() => {
    registeredTabs.length = 0;
  });

  it("registers the expected primary tabs in order", () => {
    let tree: renderer.ReactTestRenderer;

    act(() => {
      tree = renderer.create(<MainTabNavigator />);
    });

    expect(registeredTabs).toEqual([
      "Dashboard",
      "Quotes",
      "Charts",
      "Trade",
      "History",
      "Account",
    ]);

    act(() => {
      tree.unmount();
    });
  });
});
