/**
 * TradeQuip Android - Main App Entry
 * Handles authentication state and navigation
 */

import React, { useEffect } from 'react';
import { StatusBar, ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import LinearGradient from 'react-native-linear-gradient';

import { colors } from './theme';
import { MainTabNavigator } from './navigation/MainTabNavigator';
import { SignInScreen } from './screens/auth/SignInScreen';
import { SignUpScreen } from './screens/auth/SignUpScreen';
import { useAuth } from './hooks/useAuth';

const Stack = createStackNavigator();
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            staleTime: 5000,
            refetchOnWindowFocus: false,
        },
    },
});

// Loading screen while checking auth
const LoadingScreen = () => (
    <LinearGradient
        colors={[colors.bgPrimary, colors.bgSecondary]}
        style={styles.loadingContainer}
    >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading TradeQuip...</Text>
    </LinearGradient>
);

// Navigation wrapper that reads auth state
const Navigation = () => {
    const { isAuthenticated, isLoading, checkAuth } = useAuth();

    // Check auth on mount
    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    if (isLoading) {
        return <LoadingScreen />;
    }

    return (
        <NavigationContainer>
            <Stack.Navigator
                screenOptions={{
                    headerShown: false,
                    cardStyle: { backgroundColor: colors.bgPrimary },
                    animationEnabled: true,
                }}
            >
                {isAuthenticated ? (
                    // Authenticated routes
                    <Stack.Screen name="Main" component={MainTabNavigator} />
                ) : (
                    // Auth routes
                    <>
                        <Stack.Screen name="SignIn" component={SignInScreen} />
                        <Stack.Screen name="SignUp" component={SignUpScreen} />
                    </>
                )}
            </Stack.Navigator>
        </NavigationContainer>
    );
};

const App = () => {
    return (
        <GestureHandlerRootView style={styles.root}>
            <QueryClientProvider client={queryClient}>
                <SafeAreaProvider>
                    <StatusBar
                        barStyle="light-content"
                        backgroundColor={colors.statusBar}
                        translucent={false}
                    />
                    <Navigation />
                </SafeAreaProvider>
            </QueryClientProvider>
        </GestureHandlerRootView>
    );
};

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        color: colors.textSecondary,
        fontSize: 16,
        marginTop: 16,
    },
});

export default App;
