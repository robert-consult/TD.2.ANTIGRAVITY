/**
 * TradeQuip Android - Trade Execution Screen
 * Uses real API hooks for order execution
 */

import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Alert,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';

import { colors, typography, spacing } from '../../theme';
import { GlassCard } from '../../components/cards/GlassCard';
import { Button } from '../../components/Button';
import { useQuotes } from '../../hooks/useQuotes';
import { useTrades } from '../../hooks/useTrades';
import { useAccountSummary } from '../../hooks/useAccountSummary';
import { useAuth } from '../../hooks/useAuth';

interface TradeScreenProps {
    navigation: any;
    route?: { params?: { symbol?: string; symbolId?: number; side?: 'BUY' | 'SELL' } };
}

export const TradeScreen: React.FC<TradeScreenProps> = ({
    navigation,
    route,
}) => {
    const initialSymbol = route?.params?.symbol || 'USDJPY';
    const initialSide = route?.params?.side || 'BUY';

    const { getQuote, getSymbolBySymbol } = useQuotes();
    const { createTrade, isCreatingTrade, createTradeError } = useTrades();
    const { freeMargin } = useAccountSummary();
    const { user } = useAuth();
    const leverage = Number(user?.leverage ?? 50) || 50;

    const [selectedSymbolName, setSelectedSymbolName] = useState(initialSymbol);
    const [side, setSide] = useState<'BUY' | 'SELL'>(initialSide);
    const [orderType, setOrderType] = useState<'Market' | 'Limit'>('Market');
    const [lots, setLots] = useState(1);
    const [limitPrice, setLimitPrice] = useState(0);

    // Sync symbol when navigating in with params
    React.useEffect(() => {
        const nextSymbol = route?.params?.symbol;
        if (!nextSymbol) return;
        if (nextSymbol !== selectedSymbolName) setSelectedSymbolName(nextSymbol);
    }, [route?.params?.symbol, selectedSymbolName]);

    // Get current symbol and quote
    const symbol = getSymbolBySymbol(selectedSymbolName);
    const quote = getQuote(selectedSymbolName);

    // Calculate prices
    const bidPrice = quote?.bid ?? quote?.price ?? 0;
    const askPrice = quote?.ask ?? quote?.price ?? 0;
    const spread = quote?.spread ?? (askPrice && bidPrice ? Math.abs(askPrice - bidPrice) : 0);
    const changePct = quote?.changePct ?? 0;

    const currentPrice = orderType === 'Limit'
        ? limitPrice
        : (side === 'BUY' ? askPrice : bidPrice) || 0;

    // Calculate estimated values (server uses 1 lot = $100,000 notional)
    const contractSize = 100000;
    const estimatedTotal = lots * contractSize * currentPrice;
    const safeLeverage = Number.isFinite(leverage) && leverage > 0 ? leverage : 50;
    const requiredMargin = estimatedTotal / safeLeverage;

    // Initialize limit price from current price
    React.useEffect(() => {
        if (quote && limitPrice === 0) {
            const px = side === 'BUY' ? askPrice : bidPrice;
            if (px) setLimitPrice(px);
        }
    }, [askPrice, bidPrice, limitPrice, quote, side]);

    // Handle lots changes (server enforces whole-number lots 1..50)
    const adjustLots = useCallback((delta: number) => {
        const next = Math.max(1, Math.min(50, Math.trunc(lots + delta)));
        setLots(next);
    }, [lots]);

    // Handle price changes
    const adjustPrice = useCallback((delta: number) => {
        const pipSize = String(selectedSymbolName).toUpperCase().includes('JPY') ? 0.01 : 0.0001;
        setLimitPrice((prev) => Number((prev + delta * pipSize * 10).toFixed(pipSize === 0.01 ? 2 : 4)));
    }, [selectedSymbolName]);

    // Execute trade
    const handleExecuteTrade = useCallback(async (tradeSide: 'BUY' | 'SELL') => {
        if (!symbol || !quote) {
            Alert.alert('Error', 'Please select a valid symbol');
            return;
        }

        setSide(tradeSide);

        if (requiredMargin > freeMargin) {
            Alert.alert('Insufficient Margin', 'You do not have enough buying power for this trade.');
            return;
        }

        const executePrice = tradeSide === 'BUY' ? askPrice : bidPrice;

        try {
            if (orderType === 'Market') {
                await createTrade({
                    symbolId: symbol.id,
                    type: tradeSide,
                    lots,
                    orderType: 'Market',
                    openPrice: executePrice,
                });
                Alert.alert(
                    'Trade Executed',
                    `Successfully placed a ${tradeSide} market order (${lots} lots) on ${symbol.name}`,
                    [
                        { text: 'View Positions', onPress: () => navigation.navigate('History') },
                        { text: 'OK' },
                    ]
                );
            } else {
                await createTrade({
                    symbolId: symbol.id,
                    type: tradeSide,
                    lots,
                    orderType: 'Limit',
                    limitPrice,
                });
                Alert.alert(
                    'Order Placed',
                    `Successfully placed a ${tradeSide} limit order (${lots} lots) on ${symbol.name}`,
                    [
                        { text: 'View Orders', onPress: () => navigation.navigate('History') },
                        { text: 'OK' },
                    ]
                );
            }
        } catch (error: any) {
            Alert.alert('Trade Failed', error.message || 'Failed to execute trade');
        }
    }, [askPrice, bidPrice, createTrade, freeMargin, limitPrice, lots, navigation, orderType, quote, requiredMargin, symbol]);

    const formatCurrency = (value: number, decimals = 2) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(value);
    };

    const formatPrice = (value: number) => {
        const isJpy = String(selectedSymbolName).toUpperCase().includes('JPY');
        return value.toFixed(isJpy ? 2 : 4);
    };

    return (
        <LinearGradient
            colors={[colors.bgPrimary, colors.bgSecondary]}
            style={styles.gradient}
        >
            <SafeAreaView style={styles.container} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>Trade Execution</Text>
                </View>

                <ScrollView
                    style={styles.content}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Symbol Card */}
                    <GlassCard style={styles.symbolCard}>
                        <View style={styles.symbolRow}>
                            <Text style={styles.symbolName}>{symbol?.name || selectedSymbolName}</Text>
                            {quote && (
                                <View style={styles.liveIndicator}>
                                    <View style={styles.liveDot} />
                                    <Text style={styles.liveText}>LIVE</Text>
                                </View>
                            )}
                        </View>
                        <View style={styles.priceRow}>
                            <Text style={styles.currentPrice}>
                                Last: {formatPrice(quote?.bid || 0)}
                            </Text>
                            <Text style={styles.priceChange}>
                                Change:{' '}
                                <Text style={changePct >= 0 ? styles.positive : styles.negative}>
                                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                                </Text>
                            </Text>
                        </View>
                        <View style={styles.bidAskRow}>
                            <Text style={styles.bidAsk}>Bid: {formatPrice(bidPrice)}</Text>
                            <Text style={styles.bidAsk}>Spread: {formatPrice(spread)}</Text>
                            <Text style={styles.bidAsk}>Ask: {formatPrice(askPrice)}</Text>
                        </View>
                    </GlassCard>

                    {/* Order Form Card */}
                    <GlassCard style={styles.formCard}>
                        {/* Order Type Toggle */}
                        <View style={styles.toggleContainer}>
                            <TouchableOpacity
                                style={[
                                    styles.toggleButton,
                                    orderType === 'Market' && styles.orderTypeActive,
                                ]}
                                onPress={() => setOrderType('Market')}
                            >
                                <Text
                                    style={[
                                        styles.toggleText,
                                        orderType === 'Market' && styles.orderTypeTextActive,
                                    ]}
                                >
                                    Market
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.toggleButton,
                                    orderType === 'Limit' && styles.orderTypeActive,
                                ]}
                                onPress={() => setOrderType('Limit')}
                            >
                                <Text
                                    style={[
                                        styles.toggleText,
                                        orderType === 'Limit' && styles.orderTypeTextActive,
                                    ]}
                                >
                                    Limit
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {/* Quantity */}
                        <View style={styles.formRow}>
                            <View style={styles.formField}>
                                <Text style={styles.fieldLabel}>Lot Size</Text>
                                <View style={styles.quantityInput}>
                                    <TouchableOpacity
                                        style={styles.quantityButton}
                                        onPress={() => adjustLots(-1)}
                                    >
                                        <Icon name="minus" size={16} color={colors.textSecondary} />
                                    </TouchableOpacity>
                                    <Text style={styles.quantityValue}>{lots}</Text>
                                    <TouchableOpacity
                                        style={styles.quantityButton}
                                        onPress={() => adjustLots(1)}
                                    >
                                        <Icon name="plus" size={16} color={colors.textSecondary} />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* Limit Price (only for limit orders) */}
                            {orderType === 'Limit' && (
                                <View style={styles.formField}>
                                    <Text style={styles.fieldLabel}>Limit Price</Text>
                                    <View style={styles.quantityInput}>
                                        <TouchableOpacity
                                            style={styles.quantityButton}
                                            onPress={() => adjustPrice(-1)}
                                        >
                                            <Icon name="minus" size={16} color={colors.textSecondary} />
                                        </TouchableOpacity>
                                        <Text style={styles.quantityValue}>
                                            {formatPrice(limitPrice)}
                                        </Text>
                                        <TouchableOpacity
                                            style={styles.quantityButton}
                                            onPress={() => adjustPrice(1)}
                                        >
                                            <Icon name="plus" size={16} color={colors.textSecondary} />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}
                        </View>

                        {/* Action Buttons */}
                        <View style={styles.actionButtons}>
                            <Button
                                title={isCreatingTrade ? 'PLACING...' : 'BUY ↗'}
                                variant="buy"
                                onPress={() => handleExecuteTrade('BUY')}
                                disabled={isCreatingTrade || !quote}
                                loading={isCreatingTrade && side === 'BUY'}
                                style={styles.actionButton}
                            />
                            <Button
                                title={isCreatingTrade ? 'PLACING...' : 'SELL ↘'}
                                variant="sell"
                                onPress={() => handleExecuteTrade('SELL')}
                                disabled={isCreatingTrade || !quote}
                                loading={isCreatingTrade && side === 'SELL'}
                                style={styles.actionButton}
                            />
                        </View>
                    </GlassCard>

                    {/* Summary Card */}
                    <GlassCard style={styles.summaryCard}>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>Contract Value</Text>
                            <Text style={styles.summaryValue}>
                                {formatCurrency(estimatedTotal)}
                            </Text>
                        </View>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>Required Margin</Text>
                            <Text style={[
                                styles.summarySubvalue,
                                requiredMargin > freeMargin && styles.negative,
                            ]}>
                                {formatCurrency(requiredMargin)}
                            </Text>
                        </View>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>Available Margin</Text>
                            <Text style={styles.summarySubvalue}>
                                {formatCurrency(freeMargin)}
                            </Text>
                        </View>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>Leverage</Text>
                            <Text style={styles.summarySubvalue}>
                                1:{leverage}
                            </Text>
                        </View>
                    </GlassCard>

                    {/* Error display */}
                    {createTradeError && (
                        <View style={styles.errorContainer}>
                            <Icon name="alert-circle" size={16} color={colors.error} />
                            <Text style={styles.errorText}>
                                {(createTradeError as Error).message || 'Trade execution failed'}
                            </Text>
                        </View>
                    )}
                </ScrollView>
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
        alignItems: 'center',
        paddingVertical: spacing.md,
    },
    headerTitle: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: spacing.screenPadding,
        paddingBottom: spacing.tabBarHeight + spacing.xl,
        gap: spacing.md,
    },
    symbolCard: {
        padding: spacing.md,
    },
    symbolRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.xs,
    },
    symbolName: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    liveIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    liveDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.success,
        marginRight: 4,
    },
    liveText: {
        ...typography.labelSmall,
        color: colors.success,
    },
    priceRow: {
        flexDirection: 'row',
        gap: spacing.md,
        marginBottom: spacing.xs,
    },
    currentPrice: {
        ...typography.body,
        color: colors.textPrimary,
    },
    priceChange: {
        ...typography.body,
        color: colors.textSecondary,
    },
    positive: {
        color: colors.success,
    },
    negative: {
        color: colors.error,
    },
    bidAskRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    bidAsk: {
        ...typography.bodySmall,
        color: colors.textSecondary,
    },
    formCard: {
        padding: spacing.md,
    },
    toggleContainer: {
        flexDirection: 'row',
        backgroundColor: colors.glassBg,
        borderRadius: 12,
        padding: 4,
        marginBottom: spacing.lg,
    },
    toggleButton: {
        flex: 1,
        paddingVertical: spacing.sm,
        alignItems: 'center',
        borderRadius: 10,
    },
    orderTypeActive: {
        backgroundColor: colors.accent,
    },
    toggleText: {
        ...typography.button,
        color: colors.textSecondary,
    },
    orderTypeTextActive: {
        color: colors.bgPrimary,
    },
    formRow: {
        flexDirection: 'row',
        gap: spacing.md,
        marginBottom: spacing.md,
    },
    formField: {
        flex: 1,
    },
    fieldLabel: {
        ...typography.label,
        marginBottom: spacing.xs,
    },
    quantityInput: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.glassBg,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        height: 44,
    },
    quantityButton: {
        width: 40,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    quantityValue: {
        flex: 1,
        ...typography.body,
        fontWeight: '600',
        color: colors.textPrimary,
        textAlign: 'center',
    },
    actionButtons: {
        flexDirection: 'row',
        gap: spacing.md,
        marginTop: spacing.sm,
    },
    actionButton: {
        flex: 1,
    },
    summaryCard: {
        padding: spacing.md,
    },
    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: spacing.xs,
    },
    summaryLabel: {
        ...typography.body,
        color: colors.textSecondary,
    },
    summaryValue: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    summarySubvalue: {
        ...typography.body,
        color: colors.textSecondary,
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.errorLight,
        borderRadius: spacing.inputRadius,
        padding: spacing.md,
        gap: spacing.sm,
    },
    errorText: {
        ...typography.bodySmall,
        color: colors.error,
        flex: 1,
    },
});

export default TradeScreen;
