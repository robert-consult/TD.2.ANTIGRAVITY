/**
 * TradeQuip Android - Sign In Screen
 * Based on mockup: signin_mockup.png
 */

import React, { useState } from 'react';
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

const loginSchema = z.object({
    email: z.string().email('Please enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface SignInScreenProps {
    navigation: any;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({ navigation }) => {
    const [isLoading, setIsLoading] = useState(false);

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
    });

    const onSubmit = async (data: LoginFormData) => {
        setIsLoading(true);
        try {
            // TODO: Implement login API call
            console.log('Login:', data);
            // navigation.navigate('Main');
        } catch (error) {
            console.error('Login error:', error);
        } finally {
            setIsLoading(false);
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
                    >
                        {/* Logo */}
                        <View style={styles.logoContainer}>
                            <Text style={styles.logoText}>TQ</Text>
                            <Text style={styles.logoSubtext}>TradeQuip</Text>
                        </View>

                        {/* Login Card */}
                        <GlassCard style={styles.card}>
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
                                    />
                                )}
                            />

                            {/* Sign In Button */}
                            <Button
                                title="Sign In"
                                onPress={handleSubmit(onSubmit)}
                                loading={isLoading}
                                style={styles.signInButton}
                            />

                            {/* Forgot Password */}
                            <View style={styles.forgotContainer}>
                                <TouchableOpacity
                                    onPress={() => navigation.navigate('ForgotPassword')}
                                >
                                    <Text style={styles.forgotText}>Forgot Password?</Text>
                                </TouchableOpacity>

                                {/* Social Login */}
                                <View style={styles.socialContainer}>
                                    <TouchableOpacity style={styles.socialButton}>
                                        <Icon name="chrome" size={24} color={colors.textSecondary} />
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.socialButton}>
                                        <Icon name="apple" size={24} color={colors.textSecondary} />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </GlassCard>

                        {/* Sign Up Link */}
                        <View style={styles.signUpContainer}>
                            <Text style={styles.signUpText}>Don't have an account? </Text>
                            <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
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
    forgotText: {
        ...typography.bodySmall,
        color: colors.textMuted,
    },
    socialContainer: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    socialButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.glassBg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
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
