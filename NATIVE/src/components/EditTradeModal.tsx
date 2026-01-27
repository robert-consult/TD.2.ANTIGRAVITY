/**
 * TradeQuip Native - Edit Trade Modal
 * Modal for editing trade stop loss, take profit, and closing trades
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TextInput,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, typography, spacing } from '../theme';
import { Button } from './Button';
import api from '../services/api';

interface Trade {
    id: number;
    symbol: string | { symbol: string };
    side: string;
    type?: string;
    lots: number;
    openPrice: number;
    currentPrice?: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
    profit?: number;
    status?: string;
}

interface EditTradeModalProps {
    visible: boolean;
    trade: Trade | null;
    onClose: () => void;
    onSuccess?: () => void;
}

export const EditTradeModal: React.FC<EditTradeModalProps> = ({
    visible,
    trade,
    onClose,
    onSuccess,
}) => {
    const queryClient = useQueryClient();
    const [stopLoss, setStopLoss] = useState('');
    const [takeProfit, setTakeProfit] = useState('');

    useEffect(() => {
        if (trade) {
            setStopLoss(trade.stopLoss?.toString() || '');
            setTakeProfit(trade.takeProfit?.toString() || '');
        }
    }, [trade]);

    const getSymbol = (): string => {
        if (!trade) return '';
        return typeof trade.symbol === 'object' ? trade.symbol.symbol : trade.symbol;
    };

    // Update trade mutation
    const updateMutation = useMutation({
        mutationFn: async (data: { stopLoss?: number | null; takeProfit?: number | null }) => {
            const res = await api.put(`/api/trades/${trade?.id}`, data);
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trades'] });
            Alert.alert('Success', 'Trade updated successfully');
            onSuccess?.();
            onClose();
        },
        onError: (e: any) => Alert.alert('Error', e?.message || 'Failed to update trade'),
    });

    // Close trade mutation
    const closeMutation = useMutation({
        mutationFn: async () => {
            const res = await api.post(`/api/trades/${trade?.id}/close`);
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trades'] });
            queryClient.invalidateQueries({ queryKey: ['account-summary'] });
            Alert.alert('Success', 'Trade closed successfully');
            onSuccess?.();
            onClose();
        },
        onError: (e: any) => Alert.alert('Error', e?.message || 'Failed to close trade'),
    });

    const handleUpdate = () => {
        const sl = stopLoss.trim() ? parseFloat(stopLoss) : null;
        const tp = takeProfit.trim() ? parseFloat(takeProfit) : null;

        if (stopLoss.trim() && isNaN(sl as number)) {
            Alert.alert('Error', 'Invalid stop loss value');
            return;
        }
        if (takeProfit.trim() && isNaN(tp as number)) {
            Alert.alert('Error', 'Invalid take profit value');
            return;
        }

        updateMutation.mutate({ stopLoss: sl, takeProfit: tp });
    };

    const handleClose = () => {
        Alert.alert(
            'Close Trade',
            `Are you sure you want to close this ${getSymbol()} trade?`,
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Close Trade', style: 'destructive', onPress: () => closeMutation.mutate() },
            ]
        );
    };

    if (!trade) return null;

    const isPending = updateMutation.isPending || closeMutation.isPending;
    const isBuy = trade.side?.toUpperCase() === 'BUY';
    const profit = trade.profit ?? 0;

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.overlay}>
                <View style={styles.content}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Edit Trade</Text>
                        <TouchableOpacity onPress={onClose} disabled={isPending}>
                            <Icon name="x" size={24} color={colors.textPrimary} />
                        </TouchableOpacity>
                    </View>

                    {/* Trade Summary */}
                    <View style={styles.summary}>
                        <View style={styles.summaryRow}>
                            <Text style={styles.symbol}>{getSymbol()}</Text>
                            <View style={[styles.sideBadge, { backgroundColor: isBuy ? colors.successLight : colors.errorLight }]}>
                                <Text style={[styles.sideText, { color: isBuy ? colors.success : colors.error }]}>
                                    {trade.side?.toUpperCase()}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.summaryRow}>
                            <Text style={styles.label}>Lots: {trade.lots}</Text>
                            <Text style={styles.label}>Open: ${trade.openPrice?.toFixed(5)}</Text>
                        </View>
                        <View style={styles.profitRow}>
                            <Text style={styles.label}>Current P/L:</Text>
                            <Text style={[styles.profit, { color: profit >= 0 ? colors.success : colors.error }]}>
                                {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                            </Text>
                        </View>
                    </View>

                    {/* Edit Form */}
                    <View style={styles.form}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Stop Loss</Text>
                            <TextInput
                                style={styles.input}
                                value={stopLoss}
                                onChangeText={setStopLoss}
                                placeholder="Enter stop loss price"
                                placeholderTextColor={colors.textMuted}
                                keyboardType="decimal-pad"
                                editable={!isPending}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Take Profit</Text>
                            <TextInput
                                style={styles.input}
                                value={takeProfit}
                                onChangeText={setTakeProfit}
                                placeholder="Enter take profit price"
                                placeholderTextColor={colors.textMuted}
                                keyboardType="decimal-pad"
                                editable={!isPending}
                            />
                        </View>
                    </View>

                    {/* Actions */}
                    <View style={styles.actions}>
                        <Button
                            title={updateMutation.isPending ? 'Updating...' : 'Update Trade'}
                            onPress={handleUpdate}
                            disabled={isPending}
                            style={styles.updateButton}
                        />
                        <TouchableOpacity
                            style={[styles.closeTradeButton, isPending && styles.buttonDisabled]}
                            onPress={handleClose}
                            disabled={isPending}
                        >
                            {closeMutation.isPending ? (
                                <ActivityIndicator size="small" color={colors.error} />
                            ) : (
                                <>
                                    <Icon name="x-circle" size={18} color={colors.error} />
                                    <Text style={styles.closeTradeText}>Close Trade</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        justifyContent: 'flex-end',
    },
    content: {
        backgroundColor: colors.bgSecondary,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: spacing.lg,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.lg,
    },
    title: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    summary: {
        backgroundColor: colors.glassBg,
        borderRadius: 12,
        padding: spacing.md,
        marginBottom: spacing.lg,
        borderWidth: 1,
        borderColor: colors.glassBorder,
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.xs,
    },
    symbol: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    sideBadge: {
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: 8,
    },
    sideText: {
        ...typography.caption,
        fontWeight: '600',
    },
    label: {
        ...typography.body,
        color: colors.textSecondary,
    },
    profitRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing.sm,
        paddingTop: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    profit: {
        ...typography.h3,
    },
    form: {
        marginBottom: spacing.lg,
    },
    inputGroup: {
        marginBottom: spacing.md,
    },
    inputLabel: {
        ...typography.caption,
        color: colors.textSecondary,
        marginBottom: spacing.xs,
    },
    input: {
        backgroundColor: colors.glassBg,
        borderRadius: 12,
        padding: spacing.md,
        ...typography.body,
        color: colors.textPrimary,
        borderWidth: 1,
        borderColor: colors.glassBorder,
    },
    actions: {
        gap: spacing.md,
    },
    updateButton: {
        width: '100%',
    },
    closeTradeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.md,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.error,
        gap: spacing.sm,
    },
    closeTradeText: {
        ...typography.bodyBold,
        color: colors.error,
    },
    buttonDisabled: {
        opacity: 0.5,
    },
});

export default EditTradeModal;
