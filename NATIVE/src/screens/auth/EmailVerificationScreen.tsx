/**
 * TradeQuip Native - Email Verification Screen
 * Handles email verification via deep link token
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';

import { colors, typography, spacing } from '../../theme';
import { Button } from '../../components/Button';
import { GlassCard } from '../../components/cards/GlassCard';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';

type Status = 'idle' | 'verifying' | 'success' | 'error';

type RouteParams = {
    EmailVerification: {
        token?: string;
    };
};

export const EmailVerificationScreen: React.FC = () => {
    const navigation = useNavigation();
    const route = useRoute<RouteProp<RouteParams, 'EmailVerification'>>();
    const token = route.params?.token;
    const { isAuthenticated, checkAuth } = useAuth();

    const [status, setStatus] = useState<Status>('idle');
    const [message, setMessage] = useState('');

    useEffect(() => {
        const verifyEmail = async () => {
            if (!token) {
                setStatus('error');
                setMessage('Missing verification token.');
                return;
            }

            setStatus('verifying');
            try {
                await api.post('/api/verification/email/verify', { token });
                setStatus('success');
                setMessage('Your email has been verified successfully.');
                if (isAuthenticated) {
                    // Refresh current user so the UI reflects `emailVerified`.
                    await checkAuth();
                }
            } catch (error: any) {
                setStatus('error');
                setMessage(
                    error?.response?.data?.message ||
                    error?.message ||
                    'Verification failed. The token may be expired or already used.'
                );
            }
        };

        verifyEmail();
    }, [checkAuth, isAuthenticated, token]);

    const navigateToDashboard = () => {
        navigation.reset({
            index: 0,
            routes: [{ name: (isAuthenticated ? 'Main' : 'SignIn') as never }],
        });
    };

    const navigateToProfile = () => {
        navigation.navigate((isAuthenticated ? 'ProfileSettings' : 'SignIn') as never);
    };

    return (
        <LinearGradient
            colors={[colors.bgPrimary, colors.bgSecondary]}
            style={styles.container}
        >
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.content}>
                    <GlassCard style={styles.card}>
                        <Text style={styles.title}>Email Verification</Text>

                        {status === 'idle' && (
                            <View style={styles.statusContainer}>
                                <ActivityIndicator size="small" color={colors.accent} />
                                <Text style={styles.statusText}>Waiting for token...</Text>
                            </View>
                        )}

                        {status === 'verifying' && (
                            <View style={styles.statusContainer}>
                                <ActivityIndicator size="large" color={colors.accent} />
                                <Text style={styles.statusText}>Verifying your email...</Text>
                            </View>
                        )}

                        {status === 'success' && (
                            <>
                                <View style={styles.statusContainer}>
                                    <View style={styles.successIcon}>
                                        <Icon name="check-circle" size={48} color={colors.success} />
                                    </View>
                                    <Text style={styles.successText}>{message}</Text>
                                </View>
                                <View style={styles.buttonContainer}>
                                    <Button
                                        title="Go to Dashboard"
                                        onPress={navigateToDashboard}
                                        style={styles.primaryButton}
                                    />
                                    <Button
                                        title="Profile Settings"
                                        variant="outline"
                                        onPress={navigateToProfile}
                                        style={styles.secondaryButton}
                                    />
                                </View>
                            </>
                        )}

                        {status === 'error' && (
                            <>
                                <View style={styles.statusContainer}>
                                    <View style={styles.errorIcon}>
                                        <Icon name="x-circle" size={48} color={colors.error} />
                                    </View>
                                    <Text style={styles.errorText}>{message}</Text>
                                </View>
                                <View style={styles.buttonContainer}>
                                    <Button
                                        title="Open Profile Settings"
                                        variant="outline"
                                        onPress={navigateToProfile}
                                        style={styles.primaryButton}
                                    />
                                    <Button
                                        title="Home"
                                        variant="ghost"
                                        onPress={navigateToDashboard}
                                        style={styles.secondaryButton}
                                    />
                                </View>
                            </>
                        )}
                    </GlassCard>
                </View>
            </SafeAreaView>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    safeArea: {
        flex: 1,
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
    },
    card: {
        padding: spacing.xl,
    },
    title: {
        ...typography.h2,
        color: colors.textPrimary,
        textAlign: 'center',
        marginBottom: spacing.lg,
    },
    statusContainer: {
        alignItems: 'center',
        paddingVertical: spacing.lg,
    },
    statusText: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.md,
    },
    successIcon: {
        marginBottom: spacing.md,
    },
    successText: {
        ...typography.body,
        color: colors.success,
        textAlign: 'center',
    },
    errorIcon: {
        marginBottom: spacing.md,
    },
    errorText: {
        ...typography.body,
        color: colors.error,
        textAlign: 'center',
    },
    buttonContainer: {
        marginTop: spacing.lg,
        gap: spacing.sm,
    },
    primaryButton: {
        width: '100%',
    },
    secondaryButton: {
        width: '100%',
    },
});

export default EmailVerificationScreen;
