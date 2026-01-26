/**
 * TradeQuip Android - Trade Execution Screen
 * Based on mockup: trade_execution_theme_polish.png
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';

import { colors, typography, spacing } from '../../theme';
import { GlassCard } from '../../components/cards/GlassCard';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';

interface TradeScreenProps {
    navigation: any;
    route?: { params?: { symbol?: string; side?: 'buy' | 'sell' } };
}

export const TradeScreen: React.FC<TradeScreenProps> = ({
    navigation,
    route,
}) => {
    const symbol = route?.params?.symbol || 'AAPL';
    const initialSide = route?.params?.side || 'buy';

    const [side, setSide] = useState<'buy' | 'sell'>(initialSide);
    const [orderType, setOrderType] = useState('limit');
    const [quantity, setQuantity] = useState(100);
    const [limitPrice, setLimitPrice] = useState(175.45);
    const [timeInForce, setTimeInForce] = useState('day');

    const currentPrice = 175.45;
    const changeAmount = 2.10;
    const changePercent = 1.21;
    const bidPrice = 175.40;
    const askPrice = 175.50;
    const buyingPower = 50000;
    const estimatedTotal = quantity * limitPrice;

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
                            <Text style={styles.symbolName}>{symbol}</Text>
                            <Text style={styles.companyName}>| Apple Inc.</Text>
                        </View>
                        <View style={styles.priceRow}>
                            <Text style={styles.currentPrice}>
                                Last: ${currentPrice.toFixed(2)}
                            </Text>
                            <Text style={styles.priceChange}>
                                Change:{' '}
                                <Text style={styles.positive}>
                                    +${changeAmount.toFixed(2)} (+{changePercent.toFixed(2)}%)
                                </Text>
                            </Text>
                        </View>
                        <View style={styles.bidAskRow}>
                            <Text style={styles.bidAsk}>Bid: ${bidPrice.toFixed(2)}</Text>
                            <Text style={styles.bidAsk}>Ask: ${askPrice.toFixed(2)}</Text>
                        </View>
                    </GlassCard>

                    {/* Order Form Card */}
                    <GlassCard style={styles.formCard}>
                        {/* Buy/Sell Toggle */}
                        <View style={styles.toggleContainer}>
                            <TouchableOpacity
                                style={[
                                    styles.toggleButton,
                                    side === 'buy' && styles.buyToggleActive,
                                ]}
                                onPress={() => setSide('buy')}
                            >
                                <Text
                                    style={[
                                        styles.toggleText,
                                        side === 'buy' && styles.toggleTextActive,
                                    ]}
                                >
                                    Buy
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.toggleButton,
                                    side === 'sell' && styles.sellToggleActive,
                                ]}
                                onPress={() => setSide('sell')}
                            >
                                <Text
                                    style={[
                                        styles.toggleText,
                                        side === 'sell' && styles.toggleTextSell,
                                    ]}
                                >
                                    Sell
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {/* Order Type & Quantity */}
                        <View style={styles.formRow}>
                            <View style={styles.formField}>
                                <Text style={styles.fieldLabel}>Order Type</Text>
                                <TouchableOpacity style={styles.dropdown}>
                                    <Text style={styles.dropdownText}>
                                        {orderType.charAt(0).toUpperCase() + orderType.slice(1)}
                                    </Text>
                                    <Icon name="chevron-down" size={18} color={colors.textMuted} />
                                </TouchableOpacity>
                            </View>
                            <View style={styles.formField}>
                                <Text style={styles.fieldLabel}>Quantity</Text>
                                <View style={styles.quantityInput}>
                                    <TouchableOpacity
                                        style={styles.quantityButton}
                                        onPress={() => setQuantity(Math.max(1, quantity - 10))}
                                    >
                                        <Icon name="minus" size={16} color={colors.textSecondary} />
                                    </TouchableOpacity>
                                    <Text style={styles.quantityValue}>{quantity}</Text>
                                    <TouchableOpacity
                                        style={styles.quantityButton}
                                        onPress={() => setQuantity(quantity + 10)}
                                    >
                                        <Icon name="plus" size={16} color={colors.textSecondary} />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>

                        {/* Limit Price & Time in Force */}
                        <View style={styles.formRow}>
                            <View style={styles.formField}>
                                <Text style={styles.fieldLabel}>Limit Price</Text>
                                <View style={styles.quantityInput}>
                                    <TouchableOpacity
                                        style={styles.quantityButton}
                                        onPress={() => setLimitPrice(limitPrice - 0.05)}
                                    >
                                        <Icon name="minus" size={16} color={colors.textSecondary} />
                                    </TouchableOpacity>
                                    <Text style={styles.quantityValue}>
                                        ${limitPrice.toFixed(2)}
                                    </Text>
                                    <TouchableOpacity
                                        style={styles.quantityButton}
                                        onPress={() => setLimitPrice(limitPrice + 0.05)}
                                    >
                                        <Icon name="plus" size={16} color={colors.textSecondary} />
                                    </TouchableOpacity>
                                </View>
                            </View>
                            <View style={styles.formField}>
                                <Text style={styles.fieldLabel}>Time in Force</Text>
                                <TouchableOpacity style={styles.dropdown}>
                                    <Text style={styles.dropdownText}>Day</Text>
                                    <Icon name="chevron-down" size={18} color={colors.textMuted} />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Action Buttons */}
                        <View style={styles.actionButtons}>
                            <Button
                                title="BUY ↗"
                                variant="buy"
                                onPress={() => console.log('Buy order')}
                                style={styles.actionButton}
                            />
                            <Button
                                title="SELL ↘"
                                variant="sell"
                                onPress={() => console.log('Sell order')}
                                style={styles.actionButton}
                            />
                        </View>
                    </GlassCard>

                    {/* Summary Card */}
                    <GlassCard style={styles.summaryCard}>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>Estimated Total</Text>
                            <Text style={styles.summaryValue}>
                                ${estimatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </Text>
                        </View>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>Buying Power</Text>
                            <Text style={styles.summarySubvalue}>
                                ${buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </Text>
                        </View>
                    </GlassCard>
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
        alignItems: 'baseline',
        marginBottom: spacing.xs,
    },
    symbolName: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    companyName: {
        ...typography.body,
        color: colors.textSecondary,
        marginLeft: spacing.xs,
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
    bidAskRow: {
        flexDirection: 'row',
        gap: spacing.lg,
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
    buyToggleActive: {
        backgroundColor: colors.buy,
    },
    sellToggleActive: {
        backgroundColor: colors.sell,
    },
    toggleText: {
        ...typography.button,
        color: colors.textSecondary,
    },
    toggleTextActive: {
        color: colors.textPrimary,
    },
    toggleTextSell: {
        color: colors.textPrimary,
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
    dropdown: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.glassBg,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        height: 44,
    },
    dropdownText: {
        ...typography.body,
        color: colors.textPrimary,
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
});

export default TradeScreen;
