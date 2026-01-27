/**
 * TradeQuip Android - Sign In Screen
 * Uses real API hooks for authentication
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    TouchableOpacity,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { colors, typography, spacing } from '../../theme';
import { GlassCard } from '../../components/cards/GlassCard';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { useAuth } from '../../hooks/useAuth';

const loginSchema = z.object({
    email: z.string().email('Please enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface SignInScreenProps {
    navigation: any;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({ navigation }) => {
    const { login, isLoading, error, clearError } = useAuth();

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            email: '',
            password: '',
        },
    });

    const onSubmit = async (data: LoginFormData) => {
        try {
            clearError();
            await login(data.email, data.password);
            // Navigation handled by App.tsx based on auth state
        } catch {
            // Error is already set in the auth store
        }
    };

    return (
        <LinearGradient
            colors={[colors.bgPrimary, colors.bgSecondary]}
            style={styles.gradient}
        >
            <SafeAreaView style={styles.container}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.keyboardView}
                >
                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Logo */}
                        <View style={styles.logoContainer}>
                            <Text style={styles.logoText}>TQ</Text>
                            <Text style={styles.logoSubtext}>TradeQuip</Text>
                        </View>

                        {/* Login Card */}
                        <GlassCard style={styles.card}>
                            {/* Error Alert */}
                            {error && (
                                <View style={styles.errorContainer}>
                                    <Icon name="alert-circle" size={16} color={colors.error} />
                                    <Text style={styles.errorText}>{error}</Text>
                                    <TouchableOpacity onPress={clearError}>
                                        <Icon name="x" size={16} color={colors.error} />
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* Email Input */}
                            <Controller
                                control={control}
                                name="email"
                                render={({ field: { onChange, onBlur, value } }) => (
                                    <Input
                                        placeholder="Email"
                                        keyboardType="email-address"
                                        autoCapitalize="none"
                                        autoComplete="email"
                                        value={value}
                                        onChangeText={onChange}
                                        onBlur={onBlur}
                                        error={errors.email?.message}
                                        leftIcon="mail"
                                        editable={!isLoading}
                                    />
                                )}
                            />

                            {/* Password Input */}
                            <Controller
                                control={control}
                                name="password"
                                render={({ field: { onChange, onBlur, value } }) => (
                                    <Input
                                        placeholder="Password"
                                        secureTextEntry
                                        value={value}
                                        onChangeText={onChange}
                                        onBlur={onBlur}
                                        error={errors.password?.message}
                                        leftIcon="lock"
                                        editable={!isLoading}
                                    />
                                )}
                            />

                            {/* Sign In Button */}
                            <Button
                                title={isLoading ? 'Signing In...' : 'Sign In'}
                                onPress={handleSubmit(onSubmit)}
                                loading={isLoading}
                                disabled={isLoading}
                                style={styles.signInButton}
                            />

                            {/* Forgot Password & Social Login */}
                            <View style={styles.forgotContainer}>
                                <View />
                            </View>
                        </GlassCard>

                        {/* Sign Up Link */}
                        <View style={styles.signUpContainer}>
                            <Text style={styles.signUpText}>Don't have an account? </Text>
                            <TouchableOpacity
                                onPress={() => navigation.navigate('SignUp')}
                                disabled={isLoading}
                            >
                                <Text style={styles.signUpLink}>Sign Up</Text>
                            </TouchableOpacity>
                        </View>

                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    gradient: {
        flex: 1,
    },
    container: {
        flex: 1,
    },
    keyboardView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: spacing.screenPadding,
    },
    logoContainer: {
        alignItems: 'center',
        marginBottom: spacing.xxl,
    },
    logoText: {
        fontSize: 64,
        fontWeight: '700',
        color: colors.textPrimary,
        letterSpacing: -2,
    },
    logoSubtext: {
        ...typography.bodyLarge,
        color: colors.textSecondary,
        marginTop: spacing.xs,
    },
    card: {
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.lg,
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.errorLight,
        borderRadius: spacing.inputRadius,
        padding: spacing.md,
        marginBottom: spacing.md,
        gap: spacing.sm,
    },
    errorText: {
        ...typography.bodySmall,
        color: colors.error,
        flex: 1,
    },
    signInButton: {
        marginTop: spacing.md,
        width: '100%',
    },
    forgotContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing.lg,
    },
    signUpContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: spacing.xl,
    },
    signUpText: {
        ...typography.body,
        color: colors.textSecondary,
    },
    signUpLink: {
        ...typography.body,
        color: colors.accent,
        fontWeight: '600',
    },
});

export default SignInScreen;
