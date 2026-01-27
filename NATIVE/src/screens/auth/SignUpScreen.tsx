/**
 * TradeQuip Android - Sign Up Screen
 * Based on mockup: signup_revised.png
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    TouchableOpacity,
    Modal,
    ActivityIndicator,
    Alert,
    NativeSyntheticEvent,
    NativeScrollEvent,
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
import api, { legalApi } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';

const signupSchema = z.object({
    email: z.string().email('Please enter a valid email'),
    username: z.string().min(3, 'Username must be at least 3 characters'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
    phone: z.string().min(6, 'Please enter a valid phone number'),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
});

type SignupFormData = z.infer<typeof signupSchema>;

interface SignUpScreenProps {
    navigation: any;
}

export const SignUpScreen: React.FC<SignUpScreenProps> = ({ navigation }) => {
    const { register } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [country, _setCountry] = useState({
        code: 'US',
        name: 'United States',
        dial: '+1',
    });
    const [acceptedTerms, setAcceptedTerms] = useState(false);

    const [publicCfg, setPublicCfg] = useState<any | null>(null);
    const [terms, setTerms] = useState<{
        token: string;
        combinedSha256: string;
        text: string;
        warnings: string[];
    } | null>(null);
    const [termsLoading, setTermsLoading] = useState(false);
    const [termsModalOpen, setTermsModalOpen] = useState(false);
    const [termsScrolledToEnd, setTermsScrolledToEnd] = useState(false);
    const [termsModalAccepted, setTermsModalAccepted] = useState(false);

    const [captchaId, setCaptchaId] = useState<string | null>(null);
    const [captchaVerified, setCaptchaVerified] = useState(false);
    const [captchaStarting, setCaptchaStarting] = useState(false);
    const [captchaVerifying, setCaptchaVerifying] = useState(false);
    const [captchaReady, setCaptchaReady] = useState(false);

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<SignupFormData>({
        resolver: zodResolver(signupSchema),
        defaultValues: {
            email: '',
            username: '',
            phone: '',
            password: '',
            confirmPassword: '',
        },
    });

    const captchaProvider = String(publicCfg?.captcha?.provider || 'SLIDER').toUpperCase();
    const enforceCaptcha = Boolean(publicCfg?.captcha?.enforceSignupCaptcha ?? false);

    // Load public config + country terms
    useEffect(() => {
        let canceled = false;

        (async () => {
            setTermsLoading(true);
            try {
                const cfg = await legalApi.getPublicConfig();
                if (!canceled) setPublicCfg(cfg);
            } catch (e: any) {
                if (!canceled) console.warn('[SignUp] Failed to load public config:', e?.message || e);
            }

            try {
                const resolved = await legalApi.resolveTerms(country.code);
                if (canceled) return;

                if (resolved?.success) {
                    setTerms({
                        token: String(resolved.token || ''),
                        combinedSha256: String(resolved.combinedSha256 || ''),
                        text: String(resolved.text || ''),
                        warnings: Array.isArray(resolved.warnings) ? resolved.warnings.map((w: any) => String(w)) : [],
                    });
                } else {
                    setTerms(null);
                    const msg = String(resolved?.error || resolved?.reason || 'Could not load Terms & Conditions');
                    Alert.alert('Terms unavailable', msg);
                }
            } catch (e: any) {
                if (!canceled) {
                    setTerms(null);
                    Alert.alert('Terms unavailable', String(e?.message || e));
                }
            } finally {
                if (!canceled) setTermsLoading(false);
            }
        })();

        return () => {
            canceled = true;
        };
    }, [country.code]);

    // Reset terms modal state on open/close
    useEffect(() => {
        if (!termsModalOpen) return;
        setTermsScrolledToEnd(false);
        setTermsModalAccepted(false);
    }, [termsModalOpen, terms?.combinedSha256]);

    const startSliderCaptcha = async () => {
        setCaptchaStarting(true);
        setCaptchaVerified(false);
        setCaptchaId(null);
        setCaptchaReady(false);
        try {
            const resp = await api.post('/api/captcha/slider/start', {});
            const data = resp?.data;
            if (!data?.ok || !data?.captchaId) {
                throw new Error(data?.message || 'SLIDER_START_FAILED');
            }
            setCaptchaId(String(data.captchaId));
            // Enforce server-side SLIDER_MIN_SOLVE_MS (800ms) with a small buffer
            setTimeout(() => setCaptchaReady(true), 1000);
        } catch (e: any) {
            setCaptchaId(null);
            setCaptchaVerified(false);
            Alert.alert('Verification unavailable', String(e?.message || e));
        } finally {
            setCaptchaStarting(false);
        }
    };

    const completeSliderCaptcha = async () => {
        if (!captchaId) return;
        setCaptchaVerifying(true);
        try {
            const resp = await api.post('/api/captcha/slider/complete', { captchaId });
            const data = resp?.data;
            if (!data?.ok) {
                throw new Error(data?.message || 'CAPTCHA_FAILED');
            }
            setCaptchaVerified(true);
        } catch (e: any) {
            setCaptchaVerified(false);
            setCaptchaId(null);
            setCaptchaReady(false);
            try {
                await api.post('/api/captcha/slider/reset', {});
            } catch {
                // ignore
            }
            Alert.alert('Verification failed', String(e?.message || e));
            startSliderCaptcha();
        } finally {
            setCaptchaVerifying(false);
        }
    };

    // Auto-start slider captcha when required
    useEffect(() => {
        if (!enforceCaptcha) return;
        if (captchaProvider !== 'SLIDER') return;
        if (captchaId || captchaStarting || captchaVerified) return;
        startSliderCaptcha().catch(() => undefined);
    }, [captchaId, captchaProvider, captchaStarting, captchaVerified, enforceCaptcha]);

    const canCreateAccount = useMemo(() => {
        if (!acceptedTerms) return false;
        if (!terms?.token || !terms?.combinedSha256) return false;
        if (!enforceCaptcha) return true;
        if (captchaProvider === 'SLIDER') return captchaVerified;
        return false;
    }, [acceptedTerms, captchaProvider, captchaVerified, enforceCaptcha, terms?.combinedSha256, terms?.token]);

    const onSubmit = async (data: SignupFormData) => {
        setIsLoading(true);
        try {
            if (!terms?.token || !terms?.combinedSha256) {
                Alert.alert('Terms not loaded', 'Please load and accept the latest Terms & Conditions.');
                return;
            }
            if (!acceptedTerms) {
                Alert.alert('Terms required', 'Please review and accept the Terms & Conditions.');
                return;
            }

            if (enforceCaptcha) {
                if (captchaProvider === 'SLIDER') {
                    if (!captchaVerified) {
                        Alert.alert('Verification required', 'Please complete the verification step.');
                        return;
                    }
                } else {
                    Alert.alert(
                        'Verification not supported',
                        `CAPTCHA provider "${captchaProvider}" is not supported in the native app yet. Please sign up on the web.`,
                    );
                    return;
                }
            }

            await register(data.email, data.username, data.password, {
                countryIso2: country.code,
                phone: data.phone,
                termsToken: terms.token,
                combinedSha256: terms.combinedSha256,
                captchaToken: null,
            });
        } catch (error) {
            Alert.alert('Registration failed', String((error as any)?.message || error));
        } finally {
            setIsLoading(false);
        }
    };

    const handleTermsScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (termsScrolledToEnd) return;
        const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
        const atBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 24;
        if (atBottom) setTermsScrolledToEnd(true);
    };

    const acceptTermsNow = () => {
        if (!termsScrolledToEnd || !termsModalAccepted) return;
        setAcceptedTerms(true);
        setTermsModalOpen(false);
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

	                            {/* Username */}
	                            <Controller
	                                control={control}
	                                name="username"
	                                render={({ field: { onChange, onBlur, value } }) => (
	                                    <Input
	                                        placeholder="Username"
	                                        autoCapitalize="none"
	                                        value={value}
	                                        onChangeText={onChange}
	                                        onBlur={onBlur}
	                                        error={errors.username?.message}
	                                        leftIcon="user"
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

	                            {/* Signup verification */}
	                            {enforceCaptcha && (
	                                <View style={styles.captchaContainer}>
	                                    <Text style={styles.captchaLabel}>Verification</Text>
	                                    {captchaProvider === 'SLIDER' ? (
	                                        <View style={styles.captchaSlider}>
	                                            <View style={styles.captchaPuzzle}>
	                                                <Icon
	                                                    name={captchaVerified ? 'check' : 'shield'}
	                                                    size={20}
	                                                    color={captchaVerified ? colors.success : colors.accent}
	                                                />
	                                            </View>
		                                            <TouchableOpacity
		                                                style={styles.captchaTrack}
		                                                onPress={() => {
		                                                    if (captchaVerified) return;
		                                                    if (!captchaId) {
		                                                        startSliderCaptcha().catch(() => undefined);
		                                                    } else if (captchaReady) {
		                                                        completeSliderCaptcha().catch(() => undefined);
		                                                    }
		                                                }}
		                                                disabled={captchaVerified || captchaStarting || captchaVerifying}
		                                                activeOpacity={0.7}
		                                            >
	                                                {captchaStarting || captchaVerifying ? (
	                                                    <ActivityIndicator size="small" color={colors.textSecondary} />
	                                                ) : captchaVerified ? (
	                                                    <Text style={[styles.captchaText, { color: colors.success }]}>
	                                                        Verified
	                                                    </Text>
	                                                ) : !captchaId ? (
	                                                    <Text style={styles.captchaText}>Tap to start</Text>
	                                                ) : captchaReady ? (
	                                                    <Text style={styles.captchaText}>Tap to verify</Text>
	                                                ) : (
	                                                    <Text style={styles.captchaText}>Please wait…</Text>
	                                                )}
	                                            </TouchableOpacity>
	                                        </View>
	                                    ) : (
	                                        <Text style={styles.captchaText}>
	                                            CAPTCHA provider "{captchaProvider}" not supported in native yet.
	                                        </Text>
	                                    )}
	                                </View>
	                            )}

	                            {/* Legal */}
	                            <View style={styles.legalSection}>
	                                <Text style={styles.legalTitle}>Legal</Text>
	                                <TouchableOpacity
	                                    style={styles.checkbox}
	                                    onPress={() => setTermsModalOpen(true)}
	                                    activeOpacity={0.7}
	                                >
	                                    <View style={[styles.checkboxBox, acceptedTerms && styles.checkboxChecked]}>
	                                        {acceptedTerms && (
	                                            <Icon name="check" size={14} color={colors.textPrimary} />
	                                        )}
	                                    </View>
	                                    <Text style={styles.checkboxLabel}>
	                                        {termsLoading ? 'Loading terms…' : 'Review and accept the '}
	                                        <Text style={styles.link}>Terms & Conditions</Text>
	                                    </Text>
	                                </TouchableOpacity>

	                                {terms?.combinedSha256 ? (
	                                    <Text style={styles.termsHash} numberOfLines={1}>
	                                        Doc hash: {terms.combinedSha256}
	                                    </Text>
	                                ) : null}
	                            </View>

                            {/* Create Account Button */}
	                            <Button
	                                title="Create Account"
	                                onPress={handleSubmit(onSubmit)}
	                                loading={isLoading}
	                                disabled={!canCreateAccount || isLoading || termsLoading || captchaStarting || captchaVerifying}
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

	                {/* Terms modal (DOC1) */}
	                <Modal
	                    visible={termsModalOpen}
	                    animationType="slide"
	                    transparent
	                    onRequestClose={() => setTermsModalOpen(false)}
	                >
	                    <View style={styles.modalOverlay}>
	                        <View style={styles.modalCard}>
	                            <View style={styles.modalHeader}>
	                                <Text style={styles.modalTitle}>Terms & Conditions</Text>
	                                <TouchableOpacity onPress={() => setTermsModalOpen(false)} style={styles.modalClose}>
	                                    <Icon name="x" size={22} color={colors.textSecondary} />
	                                </TouchableOpacity>
	                            </View>

	                            <ScrollView
	                                style={styles.modalScroll}
	                                contentContainerStyle={styles.modalScrollContent}
	                                onScroll={handleTermsScroll}
	                                scrollEventThrottle={100}
	                            >
	                                {termsLoading ? (
	                                    <View style={styles.modalLoading}>
	                                        <ActivityIndicator size="small" color={colors.accent} />
	                                        <Text style={styles.modalLoadingText}>Loading terms…</Text>
	                                    </View>
	                                ) : (
	                                    <Text style={styles.termsText}>
	                                        {terms?.text || 'No terms loaded.'}
	                                    </Text>
	                                )}

	                                {terms?.warnings?.length ? (
	                                    <View style={styles.warningsBox}>
	                                        {terms.warnings.slice(0, 6).map((w) => (
	                                            <Text key={w} style={styles.warningText}>• {w}</Text>
	                                        ))}
	                                    </View>
	                                ) : null}
	                            </ScrollView>

	                            {!termsScrolledToEnd && Boolean(terms?.text) && (
	                                <Text style={styles.scrollHint}>Scroll to the end to continue</Text>
	                            )}

	                            <TouchableOpacity
	                                style={styles.modalCheckboxRow}
	                                onPress={() => setTermsModalAccepted((v) => !v)}
	                                disabled={!termsScrolledToEnd || termsLoading}
	                                activeOpacity={0.7}
	                            >
	                                <View style={[
	                                    styles.checkboxBox,
	                                    termsModalAccepted && styles.checkboxChecked,
	                                    (!termsScrolledToEnd || termsLoading) && styles.checkboxDisabled,
	                                ]}>
	                                    {termsModalAccepted && <Icon name="check" size={14} color={colors.textPrimary} />}
	                                </View>
	                                <Text style={styles.modalCheckboxLabel}>
	                                    I accept the Terms & Conditions
	                                </Text>
	                            </TouchableOpacity>

	                            <View style={styles.modalActions}>
	                                <Button
	                                    title="Close"
	                                    variant="outline"
	                                    onPress={() => setTermsModalOpen(false)}
	                                    style={styles.modalButton}
	                                />
	                                <Button
	                                    title="Accept"
	                                    onPress={acceptTermsNow}
	                                    disabled={!termsScrolledToEnd || !termsModalAccepted || termsLoading}
	                                    style={styles.modalButton}
	                                />
	                            </View>
	                        </View>
	                    </View>
	                </Modal>
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
    termsHash: {
        ...typography.caption,
        color: colors.textMuted,
        marginTop: -spacing.xs,
        marginBottom: spacing.sm,
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

    // Modal styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        justifyContent: 'flex-end',
    },
    modalCard: {
        backgroundColor: colors.bgSecondary,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '90%',
        borderWidth: 1,
        borderColor: colors.border,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    modalTitle: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    modalClose: {
        padding: spacing.xs,
    },
    modalScroll: {
        paddingHorizontal: spacing.lg,
    },
    modalScrollContent: {
        paddingVertical: spacing.md,
    },
    modalLoading: {
        paddingVertical: spacing.xl,
        alignItems: 'center',
        gap: spacing.sm,
    },
    modalLoadingText: {
        ...typography.bodySmall,
        color: colors.textSecondary,
    },
    termsText: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        lineHeight: 20,
    },
    warningsBox: {
        marginTop: spacing.md,
        backgroundColor: colors.glassBg,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: spacing.md,
        gap: 4,
    },
    warningText: {
        ...typography.caption,
        color: colors.warning,
    },
    scrollHint: {
        ...typography.caption,
        color: colors.textMuted,
        textAlign: 'center',
        paddingVertical: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    modalCheckboxRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        gap: spacing.sm,
    },
    checkboxDisabled: {
        opacity: 0.5,
    },
    modalCheckboxLabel: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        flex: 1,
    },
    modalActions: {
        flexDirection: 'row',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.lg,
    },
    modalButton: {
        flex: 1,
    },
});

export default SignUpScreen;
