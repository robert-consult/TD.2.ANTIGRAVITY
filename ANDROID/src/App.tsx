/**
 * TradeQuip Android - Main App Entry
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { colors } from './theme';
import { MainTabNavigator } from './navigation/MainTabNavigator';
import { SignInScreen } from './screens/auth/SignInScreen';
// import { SignUpScreen } from './screens/auth/SignUpScreen';

const Stack = createStackNavigator();
const queryClient = new QueryClient();

const App = () => {
    // TODO: Replace with actual auth state
    const isAuthenticated = false;

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <QueryClientProvider client={queryClient}>
                <SafeAreaProvider>
                    <NavigationContainer>
                        <StatusBar
                            barStyle="light-content"
                            backgroundColor={colors.statusBar}
                            translucent={false}
                        />
                        <Stack.Navigator
                            screenOptions={{
                                headerShown: false,
                                cardStyle: { backgroundColor: colors.bgPrimary },
                            }}
                        >
                            {isAuthenticated ? (
                                <Stack.Screen name="Main" component={MainTabNavigator} />
                            ) : (
                                <>
                                    <Stack.Screen name="SignIn" component={SignInScreen} />
                                    {/* <Stack.Screen name="SignUp" component={SignUpScreen} /> */}
                                </>
                            )}
                        </Stack.Navigator>
                    </NavigationContainer>
                </SafeAreaProvider>
            </QueryClientProvider>
        </GestureHandlerRootView>
    );
};

export default App;
