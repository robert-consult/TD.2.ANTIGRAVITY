/**
 * TradeQuip Native - Verification Cards Component
 * Displays user verification status and required steps
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { colors, typography, spacing } from '../theme';

interface VerificationStep {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    required?: boolean;
    onPress?: () => void;
}

interface VerificationCardsProps {
    steps: VerificationStep[];
    overallProgress?: number; // 0-100
    title?: string;
}

const STATUS_CONFIG = {
    pending: { icon: 'circle', color: colors.textMuted, bg: colors.glassBg },
    in_progress: { icon: 'clock', color: colors.warning, bg: 'rgba(255, 193, 7, 0.15)' },
    completed: { icon: 'check-circle', color: colors.success, bg: 'rgba(0, 230, 118, 0.15)' },
    failed: { icon: 'x-circle', color: colors.error, bg: 'rgba(255, 82, 82, 0.15)' },
};

export const VerificationCards: React.FC<VerificationCardsProps> = ({
    steps,
    overallProgress,
    title = 'Account Verification',
}) => {
    const completedCount = steps.filter((s) => s.status === 'completed').length;

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.subtitle}>
                        {completedCount} of {steps.length} steps completed
                    </Text>
                </View>
                {overallProgress !== undefined && (
                    <View style={styles.progressBadge}>
                        <Text style={styles.progressText}>{overallProgress}%</Text>
                    </View>
                )}
            </View>

            {/* Progress Bar */}
            {overallProgress !== undefined && (
                <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${overallProgress}%` }]} />
                </View>
            )}

            {/* Verification Steps */}
            <View style={styles.steps}>
                {steps.map((step, index) => {
                    const config = STATUS_CONFIG[step.status];
                    const isLast = index === steps.length - 1;

                    return (
                        <TouchableOpacity
                            key={step.id}
                            style={[styles.step, isLast && styles.stepLast]}
                            onPress={step.onPress}
                            disabled={!step.onPress || step.status === 'completed'}
                            activeOpacity={step.onPress ? 0.7 : 1}
                        >
                            <View style={[styles.iconWrapper, { backgroundColor: config.bg }]}>
                                <Icon name={config.icon} size={20} color={config.color} />
                            </View>

                            <View style={styles.stepContent}>
                                <View style={styles.stepHeader}>
                                    <Text style={styles.stepTitle}>{step.title}</Text>
                                    {step.required && step.status !== 'completed' && (
                                        <View style={styles.requiredBadge}>
                                            <Text style={styles.requiredText}>Required</Text>
                                        </View>
                                    )}
                                </View>
                                <Text style={styles.stepDescription}>{step.description}</Text>
                            </View>

                            {step.onPress && step.status !== 'completed' && (
                                <Icon name="chevron-right" size={20} color={colors.textMuted} />
                            )}
                        </TouchableOpacity>
                    );
                })}
            </View>

            {/* Info Message */}
            {completedCount < steps.length && (
                <View style={styles.infoBox}>
                    <Icon name="info" size={16} color={colors.accent} />
                    <Text style={styles.infoText}>
                        Complete verification to unlock all trading features
                    </Text>
                </View>
            )}

            {/* All Complete Message */}
            {completedCount === steps.length && (
                <View style={styles.successBox}>
                    <Icon name="check-circle" size={16} color={colors.success} />
                    <Text style={styles.successText}>
                        Account fully verified! All features unlocked.
                    </Text>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.glassBg,
        borderRadius: 16,
        padding: spacing.lg,
        borderWidth: 1,
        borderColor: colors.glassBorder,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: spacing.md,
    },
    title: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    subtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
    progressBadge: {
        backgroundColor: colors.accentGlow,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: 12,
    },
    progressText: {
        ...typography.bodyBold,
        color: colors.accent,
    },
    progressBar: {
        height: 4,
        backgroundColor: colors.border,
        borderRadius: 2,
        marginBottom: spacing.lg,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: colors.accent,
        borderRadius: 2,
    },
    steps: {
        marginBottom: spacing.md,
    },
    step: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    stepLast: {
        borderBottomWidth: 0,
    },
    iconWrapper: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.md,
    },
    stepContent: {
        flex: 1,
    },
    stepHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    stepTitle: {
        ...typography.bodyBold,
        color: colors.textPrimary,
    },
    requiredBadge: {
        backgroundColor: colors.errorLight,
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        borderRadius: 4,
    },
    requiredText: {
        ...typography.caption,
        color: colors.error,
        fontSize: 10,
    },
    stepDescription: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        marginTop: 2,
    },
    infoBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.accentGlow,
        padding: spacing.sm,
        borderRadius: 8,
        gap: spacing.sm,
    },
    infoText: {
        ...typography.bodySmall,
        color: colors.accent,
        flex: 1,
    },
    successBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 230, 118, 0.15)',
        padding: spacing.sm,
        borderRadius: 8,
        gap: spacing.sm,
    },
    successText: {
        ...typography.bodySmall,
        color: colors.success,
        flex: 1,
    },
});

export default VerificationCards;
