/**
 * TradeQuip Native - Legal Re-accept Gate
 * Modal component to display and accept updated terms
 * Matches webapp LegalReacceptGate.tsx functionality
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
    Modal,
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    StyleSheet,
    NativeSyntheticEvent,
    NativeScrollEvent,
} from 'react-native';
import { legalApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { colors, spacing, typography } from '../theme';

type Doc1ReacceptStatusResponse = {
    ok: boolean;
    docSet: 'DOC1';
    required: boolean;
    blocked: boolean;
    blockedReason: string | null;
    countryIso2: string | null;
    regionKey: string | null;
    requiredCombinedSha256: string | null;
    lastAcceptedCombinedSha256: string | null;
    terms: null | {
        countryIso2: string;
        regionKey: string | null;
        combinedSha256: string;
        token: string;
        text: string;
        warnings?: string[];
    };
};

type Props = {
    /** Called when modal visibility changes */
    onVisibilityChange?: (visible: boolean) => void;
};

export const LegalReacceptGate: React.FC<Props> = ({ onVisibilityChange }) => {
    const { user, checkAuth } = useAuth();
    const { showToast } = useToast();

    const [forcedOpen, setForcedOpen] = useState(false);
    const visible = Boolean(user && (user.legalReacceptRequired || forcedOpen));

    const [status, setStatus] = useState<Doc1ReacceptStatusResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [hasReachedEnd, setHasReachedEnd] = useState(false);
    const [accepted, setAccepted] = useState(false);

    // Reset state when modal opens/closes or terms change
    useEffect(() => {
        if (!visible) {
            setStatus(null);
            setHasReachedEnd(false);
            setAccepted(false);
            return;
        }
        setHasReachedEnd(false);
        setAccepted(false);
    }, [visible, status?.terms?.combinedSha256]);

    // Notify parent of visibility changes
    useEffect(() => {
        onVisibilityChange?.(visible);
    }, [visible, onVisibilityChange]);

    // Fetch re-accept status when modal opens
    useEffect(() => {
        if (!visible) return;
        let canceled = false;

        (async () => {
            setLoading(true);
            try {
                const data = await legalApi.getReacceptStatus();
                if (canceled) return;
                if (!data || !data.ok) throw new Error('LEGAL_REACCEPT_STATUS_FAILED');
                setStatus(data);

                if (!data.required) {
                    setForcedOpen(false);
                }
            } catch (e: any) {
                if (canceled) return;
                showToast({
                    type: 'error',
                    title: 'Legal status unavailable',
                    message: String(e?.message || e),
                });
            } finally {
                if (!canceled) setLoading(false);
            }
        })();

        return () => {
            canceled = true;
        };
    }, [visible, showToast]);

    // Clear forced open when user no longer requires re-accept
    useEffect(() => {
        if (!user?.legalReacceptRequired) setForcedOpen(false);
    }, [user?.legalReacceptRequired]);

    const canAccept = Boolean(
        status?.required &&
        status?.terms?.token &&
        status?.terms?.combinedSha256 &&
        hasReachedEnd &&
        accepted &&
        !submitting &&
        !loading
    );

    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (hasReachedEnd) return;
        const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
        const atBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 20;
        if (atBottom) setHasReachedEnd(true);
    }, [hasReachedEnd]);

    const acceptNow = async () => {
        if (!status?.terms?.token || !status.terms.combinedSha256) return;
        setSubmitting(true);
        try {
            await legalApi.acceptTerms({
                termsToken: status.terms.token,
                combinedSha256: status.terms.combinedSha256,
            });
            showToast({ type: 'success', title: 'Terms accepted' });
            await checkAuth();
            setForcedOpen(false);
        } catch (e: any) {
            showToast({
                type: 'error',
                title: 'Could not accept terms',
                message: String(e?.message || e),
            });
        } finally {
            setSubmitting(false);
        }
    };

    if (!visible) return null;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={false}
            onRequestClose={() => { }}
        >
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>Updated Terms & Conditions</Text>
                    <Text style={styles.description}>
                        You must review and accept the latest terms before placing trades.
                    </Text>
                </View>

                <View style={styles.content}>
                    <ScrollView
                        style={styles.scrollView}
                        contentContainerStyle={styles.scrollContent}
                        onScroll={handleScroll}
                        scrollEventThrottle={100}
                    >
                        {loading ? (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="small" color={colors.textSecondary} />
                                <Text style={styles.loadingText}>Loading latest terms…</Text>
                            </View>
                        ) : (
                            <Text style={styles.termsText}>
                                {status?.terms?.text || 'No terms loaded.'}
                            </Text>
                        )}
                    </ScrollView>

                    {!hasReachedEnd && Boolean(status?.terms?.text) && (
                        <View style={styles.scrollHint}>
                            <Text style={styles.scrollHintText}>Scroll down to continue</Text>
                        </View>
                    )}
                </View>

                <View style={styles.footer}>
                    {status?.terms?.combinedSha256 && (
                        <Text style={styles.hashText} numberOfLines={2}>
                            Document hash: {status.terms.combinedSha256}
                        </Text>
                    )}

                    <TouchableOpacity
                        style={styles.checkboxRow}
                        onPress={() => setAccepted(!accepted)}
                        disabled={!hasReachedEnd || loading}
                        activeOpacity={0.7}
                    >
                        <View style={[
                            styles.checkbox,
                            accepted && styles.checkboxChecked,
                            (!hasReachedEnd || loading) && styles.checkboxDisabled,
                        ]}>
                            {accepted && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={[
                            styles.checkboxLabel,
                            (!hasReachedEnd || loading) && styles.checkboxLabelDisabled,
                        ]}>
                            I accept the Terms & Conditions
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.acceptButton,
                            !canAccept && styles.acceptButtonDisabled,
                        ]}
                        onPress={acceptNow}
                        disabled={!canAccept}
                        activeOpacity={0.7}
                    >
                        {submitting ? (
                            <ActivityIndicator size="small" color={colors.white} />
                        ) : (
                            <Text style={styles.acceptButtonText}>Accept & Continue</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.bgPrimary,
    },
    header: {
        padding: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    title: {
        ...typography.h2,
        color: colors.textPrimary,
        marginBottom: spacing.xs,
    },
    description: {
        ...typography.body,
        color: colors.textSecondary,
    },
    content: {
        flex: 1,
        position: 'relative',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: spacing.md,
    },
    loadingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    loadingText: {
        ...typography.body,
        color: colors.textSecondary,
    },
    termsText: {
        ...typography.body,
        color: colors.textPrimary,
        fontFamily: 'monospace',
        fontSize: 13,
        lineHeight: 20,
    },
    scrollHint: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 48,
        backgroundColor: colors.bgPrimary,
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: spacing.sm,
    },
    scrollHintText: {
        ...typography.caption,
        color: colors.textSecondary,
        backgroundColor: colors.bgSecondary,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: 4,
    },
    footer: {
        padding: spacing.lg,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        gap: spacing.md,
    },
    hashText: {
        ...typography.caption,
        color: colors.textMuted,
        fontFamily: 'monospace',
        fontSize: 10,
    },
    checkboxRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxChecked: {
        backgroundColor: colors.accent,
    },
    checkboxDisabled: {
        borderColor: colors.textMuted,
        opacity: 0.5,
    },
    checkmark: {
        color: colors.white,
        fontSize: 14,
        fontWeight: 'bold',
    },
    checkboxLabel: {
        ...typography.body,
        color: colors.textPrimary,
        flex: 1,
    },
    checkboxLabelDisabled: {
        color: colors.textMuted,
    },
    acceptButton: {
        backgroundColor: colors.accent,
        borderRadius: 8,
        paddingVertical: spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    acceptButtonDisabled: {
        backgroundColor: colors.textMuted,
    },
    acceptButtonText: {
        ...typography.button,
        color: colors.white,
    },
});

export default LegalReacceptGate;
