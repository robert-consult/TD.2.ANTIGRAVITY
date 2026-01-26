/**
 * TradeQuip Android - Sign Up Screen
 * Based on mockup: signup_revised.png
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

const signupSchema = z.object({
    email: z.string().email('Please enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
    phone: z.string().min(10, 'Please enter a valid phone number'),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
});

type SignupFormData = z.infer<typeof signupSchema>;

interface SignUpScreenProps {
    navigation: any;
}

export const SignUpScreen: React.FC<SignUpScreenProps> = ({ navigation }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [country, setCountry] = useState({ code: 'US', name: 'United States', dial: '+1' });
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<SignupFormData>({
        resolver: zodResolver(signupSchema),
    });

    const onSubmit = async (data: SignupFormData) => {
        if (!agreedToTerms || !agreedToPrivacy) {
            return;
        }
        setIsLoading(true);
        try {
            // TODO: Implement signup API call
            console.log('Signup:', data);
        } catch (error) {
            console.error('Signup error:', error);
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
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity
                        onPress={() => navigation.goBack()}
                        style={styles.backButton}
                    >
                        <Icon name="chevron-left" size={28} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Sign Up</Text>
                    <View style={styles.headerRight} />
                </View>

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

                        {/* Signup Card */}
                        <GlassCard style={styles.card}>
                            {/* Country Dropdown */}
                            <TouchableOpacity style={styles.countryPicker}>
                                <Text style={styles.countryFlag}>🇺🇸</Text>
                                <Text style={styles.countryName}>{country.name}</Text>
                                <Icon name="chevron-down" size={18} color={colors.textMuted} />
                            </TouchableOpacity>

                            {/* Phone Number */}
                            <View style={styles.phoneRow}>
                                <View style={styles.dialCode}>
                                    <Text style={styles.dialCodeText}>{country.dial}</Text>
                                </View>
                                <Controller
                                    control={control}
                                    name="phone"
                                    render={({ field: { onChange, onBlur, value } }) => (
                                        <View style={styles.phoneInput}>
                                            <Input
                                                placeholder="Phone Number"
                                                keyboardType="phone-pad"
                                                value={value}
                                                onChangeText={onChange}
                                                onBlur={onBlur}
                                                error={errors.phone?.message}
                                            />
                                        </View>
                                    )}
                                />
                            </View>

                            {/* Email */}
                            <Controller
                                control={control}
                                name="email"
                                render={({ field: { onChange, onBlur, value } }) => (
                                    <Input
                                        placeholder="Email"
                                        keyboardType="email-address"
                                        autoCapitalize="none"
                                        value={value}
                                        onChangeText={onChange}
                                        onBlur={onBlur}
                                        error={errors.email?.message}
                                        leftIcon="mail"
                                    />
                                )}
                            />

                            {/* Password */}
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

                            {/* Confirm Password */}
                            <Controller
                                control={control}
                                name="confirmPassword"
                                render={({ field: { onChange, onBlur, value } }) => (
                                    <Input
                                        placeholder="Confirm Password"
                                        secureTextEntry
                                        value={value}
                                        onChangeText={onChange}
                                        onBlur={onBlur}
                                        error={errors.confirmPassword?.message}
                                        leftIcon="lock"
                                    />
                                )}
                            />

                            {/* Captcha Placeholder */}
                            <View style={styles.captchaContainer}>
                                <Text style={styles.captchaLabel}>Slider Captcha</Text>
                                <View style={styles.captchaSlider}>
                                    <View style={styles.captchaPuzzle}>
                                        <Icon name="puzzle" size={20} color={colors.accent} />
                                    </View>
                                    <View style={styles.captchaTrack}>
                                        <Text style={styles.captchaText}>Slide to complete</Text>
                                    </View>
                                </View>
                            </View>

                            {/* Legal Checkboxes */}
                            <View style={styles.legalSection}>
                                <Text style={styles.legalTitle}>Legal</Text>

                                <TouchableOpacity
                                    style={styles.checkbox}
                                    onPress={() => setAgreedToTerms(!agreedToTerms)}
                                >
                                    <View style={[styles.checkboxBox, agreedToTerms && styles.checkboxChecked]}>
                                        {agreedToTerms && (
                                            <Icon name="check" size={14} color={colors.textPrimary} />
                                        )}
                                    </View>
                                    <Text style={styles.checkboxLabel}>
                                        I agree to the{' '}
                                        <Text style={styles.link}>Terms of Service</Text>
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.checkbox}
                                    onPress={() => setAgreedToPrivacy(!agreedToPrivacy)}
                                >
                                    <View style={[styles.checkboxBox, agreedToPrivacy && styles.checkboxChecked]}>
                                        {agreedToPrivacy && (
                                            <Icon name="check" size={14} color={colors.textPrimary} />
                                        )}
                                    </View>
                                    <Text style={styles.checkboxLabel}>
                                        I agree to the{' '}
                                        <Text style={styles.link}>Privacy Policy</Text>
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {/* Create Account Button */}
                            <Button
                                title="Create Account"
                                onPress={handleSubmit(onSubmit)}
                                loading={isLoading}
                                disabled={!agreedToTerms || !agreedToPrivacy}
                                style={styles.createButton}
                            />
                        </GlassCard>

                        {/* Sign In Link */}
                        <View style={styles.signInContainer}>
                            <Text style={styles.signInText}>Already have an account? </Text>
                            <TouchableOpacity onPress={() => navigation.navigate('SignIn')}>
                                <Text style={styles.signInLink}>Sign In</Text>
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.screenPadding,
        paddingVertical: spacing.sm,
    },
    backButton: {
        width: 40,
    },
    headerTitle: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    headerRight: {
        width: 40,
    },
    keyboardView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: spacing.screenPadding,
        paddingBottom: spacing.xxl,
    },
    logoContainer: {
        alignItems: 'center',
        marginVertical: spacing.lg,
    },
    logoText: {
        fontSize: 48,
        fontWeight: '700',
        color: colors.textPrimary,
        letterSpacing: -2,
    },
    logoSubtext: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.xxs,
    },
    card: {
        paddingVertical: spacing.lg,
        paddingHorizontal: spacing.md,
    },
    countryPicker: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.glassBg,
        borderRadius: spacing.inputRadius,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        height: 50,
        marginBottom: spacing.md,
    },
    countryFlag: {
        fontSize: 20,
        marginRight: spacing.sm,
    },
    countryName: {
        flex: 1,
        ...typography.body,
        color: colors.textPrimary,
    },
    phoneRow: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginBottom: spacing.xxs,
    },
    dialCode: {
        backgroundColor: colors.glassBg,
        borderRadius: spacing.inputRadius,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        height: 50,
        justifyContent: 'center',
    },
    dialCodeText: {
        ...typography.body,
        color: colors.textSecondary,
    },
    phoneInput: {
        flex: 1,
    },
    captchaContainer: {
        marginBottom: spacing.md,
    },
    captchaLabel: {
        ...typography.label,
        marginBottom: spacing.xs,
    },
    captchaSlider: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.glassBg,
        borderRadius: spacing.inputRadius,
        borderWidth: 1,
        borderColor: colors.border,
        height: 50,
        overflow: 'hidden',
    },
    captchaPuzzle: {
        width: 50,
        height: 50,
        backgroundColor: colors.bgCard,
        alignItems: 'center',
        justifyContent: 'center',
        borderRightWidth: 1,
        borderRightColor: colors.border,
    },
    captchaTrack: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    captchaText: {
        ...typography.bodySmall,
        color: colors.textMuted,
    },
    legalSection: {
        marginBottom: spacing.lg,
    },
    legalTitle: {
        ...typography.label,
        marginBottom: spacing.sm,
    },
    checkbox: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.sm,
    },
    checkboxBox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.sm,
    },
    checkboxChecked: {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
    },
    checkboxLabel: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        flex: 1,
    },
    link: {
        color: colors.accent,
        textDecorationLine: 'underline',
    },
    createButton: {
        width: '100%',
    },
    signInContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: spacing.lg,
    },
    signInText: {
        ...typography.body,
        color: colors.textSecondary,
    },
    signInLink: {
        ...typography.body,
        color: colors.accent,
        fontWeight: '600',
    },
});

export default SignUpScreen;
