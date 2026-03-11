/**
 * TradeQuip Native - Main App Entry
 * Handles authentication state, navigation, legal compliance, and anti-fraud tracking
 */

import React, { useEffect } from 'react';
import { StatusBar, ActivityIndicator, Text, StyleSheet, Linking } from 'react-native';
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
import { EmailVerificationScreen } from './screens/auth/EmailVerificationScreen';
import { JournalScreen } from './screens/main/JournalScreen';
import { ProfileSettingsScreen } from './screens/main/ProfileSettingsScreen';
import { LeaderboardScreen } from './screens/main/LeaderboardScreen';
import { useAuth } from './hooks/useAuth';
import { LegalReacceptGate } from './components/LegalReacceptGate';
import { startGriftPing, stopGriftPing } from './services/griftPing';
import pushNotificationService from './services/pushNotifications';
import { getDeepLinkPrefixes, resolveAllowedDeepLink } from './services/runtimeConfig';

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

const linking = {
    prefixes: getDeepLinkPrefixes(),
    config: {
        screens: {
            SignIn: 'signin',
            SignUp: 'signup',
            EmailVerification: {
                path: 'verify-email',
                parse: { token: (token: string) => token },
            },
            Main: {
                screens: {
                    Dashboard: 'dashboard',
                    Quotes: 'quotes',
                    Charts: {
                        path: 'chart/:symbol?',
                        parse: { symbol: (symbol: string) => symbol },
                    },
                    Trade: {
                        path: 'trade/:symbol?',
                        parse: { symbol: (symbol: string) => symbol },
                    },
                    History: 'history',
                    Account: 'account',
                },
            },
            Journal: 'journal',
            ProfileSettings: 'profile',
            Leaderboard: 'leaderboard',
        },
    },
    async getInitialURL() {
        const url = await Linking.getInitialURL();
        return url ? resolveAllowedDeepLink(url) : null;
    },
    subscribe(listener: (url: string) => void) {
        const subscription = Linking.addEventListener('url', ({ url }) => {
            const nextUrl = resolveAllowedDeepLink(url);
            if (nextUrl) {
                listener(nextUrl);
            }
        });

        return () => {
            subscription.remove();
        };
    },
};

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

    useEffect(() => {
        if (!isAuthenticated) return;

        const openNotificationTarget = async (remoteMessage: any) => {
            const rawLink = String(
                remoteMessage?.data?.link ??
                remoteMessage?.data?.path ??
                remoteMessage?.notification?.android?.link ??
                '',
            ).trim();
            if (!rawLink) return;

            const nextUrl = resolveAllowedDeepLink(rawLink);
            if (!nextUrl) {
                console.warn('[push] rejected notification target', rawLink);
                return;
            }

            try {
                await Linking.openURL(nextUrl);
            } catch (error) {
                console.warn('[push] failed to open notification target', error);
            }
        };

        pushNotificationService.setOnNotificationOpened((remoteMessage) => {
            openNotificationTarget(remoteMessage).catch((error) => {
                console.warn('[push] notification target handling failed', error);
            });
        });

        pushNotificationService.initialize().catch((error) => {
            console.warn('[push] initialization failed', error);
        });

        const unsubscribeTokenRefresh = pushNotificationService.onTokenRefresh((token) => {
            pushNotificationService.syncTokenWithServer(token).catch((error) => {
                console.warn('[push] token refresh sync failed in app shell', error);
            });
        });

        return () => {
            unsubscribeTokenRefresh();
        };
    }, [isAuthenticated]);

    // Check auth on mount
    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    // Start/stop grift ping based on auth state
    useEffect(() => {
        if (isAuthenticated) {
            // Start grift ping service when authenticated
            startGriftPing({ intervalMs: 60_000 });
        } else {
            // Stop when logged out
            stopGriftPing();
        }

        return () => {
            stopGriftPing();
        };
    }, [isAuthenticated]);

    if (isLoading) {
        return <LoadingScreen />;
    }

    return (
        <>
            <NavigationContainer linking={linking}>
                <Stack.Navigator
                    screenOptions={{
                        headerShown: false,
                        cardStyle: { backgroundColor: colors.bgPrimary },
                        animationEnabled: true,
                    }}
                >
                    {isAuthenticated ? (
                        // Authenticated routes
                        <>
                            <Stack.Screen name="Main" component={MainTabNavigator} />
                            <Stack.Screen name="Journal" component={JournalScreen} />
                            <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} />
                            <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
                            <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
                        </>
                    ) : (
                        // Auth routes
                        <>
                            <Stack.Screen name="SignIn" component={SignInScreen} />
                            <Stack.Screen name="SignUp" component={SignUpScreen} />
                            <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
                        </>
                    )}
                </Stack.Navigator>
            </NavigationContainer>

            {/* Legal re-accept gate - shows modal when user needs to accept updated terms */}
            {isAuthenticated && <LegalReacceptGate />}
        </>
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

