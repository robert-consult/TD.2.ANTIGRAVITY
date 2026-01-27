/**
 * TradeQuip Android - Bottom Tab Navigator
 * Custom styled tab bar matching mockup design
 */

import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Feather';
import { colors, typography, spacing } from '../theme';

// Screen imports (will be created)
import { QuotesScreen } from '../screens/main/QuotesScreen';
import { ChartsScreen } from '../screens/main/ChartsScreen';
import { TradeScreen } from '../screens/main/TradeScreen';
import { HistoryScreen } from '../screens/main/HistoryScreen';
import { AccountScreen } from '../screens/main/AccountScreen';

const Tab = createBottomTabNavigator();

const TabBarIcon = ({ name, focused }: { name: string; focused: boolean }) => (
    <Icon
        name={name}
        size={22}
        color={focused ? colors.tabBarActive : colors.tabBarInactive}
    />
);

const CustomTabBar = ({ state, descriptors, navigation, insets }: any) => {
    const bottomInset = insets?.bottom ?? 0;
    return (
        <View style={[styles.tabBar, { paddingBottom: bottomInset }]}>
            {state.routes.map((route: any, index: number) => {
                const { options } = descriptors[route.key];
                const label = options.tabBarLabel ?? route.name;
                const isFocused = state.index === index;

                const onPress = () => {
                    const event = navigation.emit({
                        type: 'tabPress',
                        target: route.key,
                        canPreventDefault: true,
                    });

                    if (!isFocused && !event.defaultPrevented) {
                        navigation.navigate(route.name);
                    }
                };

                const getIconName = () => {
                    switch (route.name) {
                        case 'Quotes':
                            return 'list';
                        case 'Charts':
                            return 'bar-chart-2';
                        case 'Trade':
                            return 'repeat';
                        case 'History':
                            return 'clock';
                        case 'Account':
                            return 'user';
                        default:
                            return 'circle';
                    }
                };

                const isTradeTab = route.name === 'Trade';

                return (
                    <TouchableOpacity
                        key={route.key}
                        onPress={onPress}
                        style={[
                            styles.tabItem,
                            isTradeTab && styles.tradeTabItem,
                        ]}
                        activeOpacity={0.7}
                    >
                        <View style={[
                            styles.iconContainer,
                            isTradeTab && styles.tradeIconContainer,
                            isFocused && !isTradeTab && styles.iconContainerActive,
                        ]}>
                            <TabBarIcon name={getIconName()} focused={isFocused || isTradeTab} />
                        </View>
                        <Text
                            style={[
                                styles.tabLabel,
                                { color: isFocused ? colors.tabBarActive : colors.tabBarInactive },
                            ]}
                        >
                            {label}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
};

export const MainTabNavigator = () => {
    return (
        <Tab.Navigator
            tabBar={CustomTabBar}
            screenOptions={{
                headerShown: false,
            }}
        >
            <Tab.Screen name="Quotes" component={QuotesScreen} />
            <Tab.Screen name="Charts" component={ChartsScreen} />
            <Tab.Screen name="Trade" component={TradeScreen} />
            <Tab.Screen name="History" component={HistoryScreen} />
            <Tab.Screen name="Account" component={AccountScreen} />
        </Tab.Navigator>
    );
};

const styles = StyleSheet.create({
    tabBar: {
        flexDirection: 'row',
        backgroundColor: colors.tabBarBg,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: spacing.xs,
    },
    tabItem: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.xs,
    },
    tradeTabItem: {
        marginTop: -spacing.lg,
    },
    iconContainer: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
    },
    tradeIconContainer: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.accent,
        shadowColor: colors.accent,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 8,
    },
    iconContainerActive: {
        backgroundColor: colors.accentGlow,
    },
    tabLabel: {
        ...typography.tabLabel,
        marginTop: 2,
    },
});

export default MainTabNavigator;
