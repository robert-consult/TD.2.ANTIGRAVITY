/**
 * TradeQuip Android - Dashboard Screen
 * Uses real API hooks for live data
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';

import { colors, typography, spacing } from '../../theme';
import { GlassCard } from '../../components/cards/GlassCard';
import { Button } from '../../components/Button';
import { useAccountSummary } from '../../hooks/useAccountSummary';
import { useTrades } from '../../hooks/useTrades';

interface DashboardScreenProps {
    navigation: any;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
    const {
        portfolioValue,
        equity,
        usedMargin,
        freeMargin,
        totalPnl,
        pnlPercentage,
        isLoading: isLoadingSummary,
        refetch: refetchSummary,
    } = useAccountSummary();

    const {
        openTrades,
        isLoadingOpenTrades,
        refetchOpenTrades,
    } = useTrades();

    const [refreshing, setRefreshing] = React.useState(false);

    const onRefresh = React.useCallback(async () => {
        setRefreshing(true);
        await Promise.all([refetchSummary(), refetchOpenTrades()]);
        setRefreshing(false);
    }, [refetchSummary, refetchOpenTrades]);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
        }).format(value);
    };

    const isLoading = isLoadingSummary && !portfolioValue;

    if (isLoading) {
        return (
            <LinearGradient
                colors={[colors.bgPrimary, colors.bgSecondary]}
                style={styles.gradient}
            >
                <SafeAreaView style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.accent} />
                    <Text style={styles.loadingText}>Loading dashboard...</Text>
                </SafeAreaView>
            </LinearGradient>
        );
    }

    return (
        <LinearGradient
            colors={[colors.bgPrimary, colors.bgSecondary]}
            style={styles.gradient}
        >
            <SafeAreaView style={styles.container} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.headerLeft}>
                        <Text style={styles.logoText}>TradeQuip</Text>
                    </View>
                    <Text style={styles.headerTitle}>Dashboard</Text>
                    <TouchableOpacity
                        style={styles.avatarButton}
                        onPress={() => navigation.navigate('Account')}
                    >
                        <View style={styles.avatar}>
                            <Icon name="user" size={20} color={colors.textPrimary} />
                        </View>
                    </TouchableOpacity>
                </View>

                <ScrollView
                    style={styles.content}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={colors.accent}
                            colors={[colors.accent]}
                        />
                    }
                >
                    {/* Portfolio Hero Card */}
                    <LinearGradient
                        colors={['rgba(0, 229, 255, 0.15)', 'rgba(41, 121, 255, 0.1)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.heroCard}
                    >
                        <Text style={styles.heroLabel}>Portfolio Value</Text>
                        <Text style={styles.heroValue}>
                            {formatCurrency(portfolioValue)}
                        </Text>
                        <Text
                            style={[
                                styles.heroChange,
                                pnlPercentage >= 0 ? styles.positive : styles.negative,
                            ]}
                        >
                            {pnlPercentage >= 0 ? '+' : ''}
                            {pnlPercentage.toFixed(2)}%
                        </Text>
                    </LinearGradient>

                    {/* Stats Grid */}
                    <View style={styles.statsGrid}>
                        <GlassCard style={styles.statCard}>
                            <Text style={styles.statLabel}>Equity</Text>
                            <Text style={styles.statValue}>
                                {formatCurrency(equity)}
                            </Text>
                        </GlassCard>
                        <GlassCard style={styles.statCard}>
                            <Text style={styles.statLabel}>Used Margin</Text>
                            <Text style={styles.statValue}>
                                {formatCurrency(usedMargin)}
                            </Text>
                        </GlassCard>
                        <GlassCard style={styles.statCard}>
                            <Text style={styles.statLabel}>Floating P/L</Text>
                            <Text
                                style={[
                                    styles.statValue,
                                    totalPnl >= 0 ? styles.positive : styles.negative,
                                ]}
                            >
                                {totalPnl >= 0 ? '+' : ''}
                                {formatCurrency(totalPnl)}
                            </Text>
                        </GlassCard>
                        <GlassCard style={styles.statCard}>
                            <Text style={styles.statLabel}>Buying Power</Text>
                            <Text style={styles.statValue}>
                                {formatCurrency(freeMargin)}
                            </Text>
                        </GlassCard>
                    </View>

                    {/* Quick Trade Button */}
                    <Button
                        title="⚡ Quick Trade"
                        onPress={() => navigation.navigate('Trade')}
                        style={styles.quickTradeButton}
                    />

                    {/* Active Positions */}
                    <GlassCard style={styles.positionsCard}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>Active Positions</Text>
                            <Text style={styles.positionCount}>
                                {openTrades.length} {openTrades.length === 1 ? 'Position' : 'Positions'}
                            </Text>
                        </View>

                        {isLoadingOpenTrades && openTrades.length === 0 ? (
                            <View style={styles.emptyPositions}>
                                <ActivityIndicator size="small" color={colors.accent} />
                            </View>
                        ) : openTrades.length === 0 ? (
                            <View style={styles.emptyPositions}>
                                <Icon name="inbox" size={32} color={colors.textMuted} />
                                <Text style={styles.emptyText}>No open positions</Text>
                                <TouchableOpacity onPress={() => navigation.navigate('Trade')}>
                                    <Text style={styles.emptyLink}>Start trading →</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            openTrades.slice(0, 5).map((trade, index) => {
                                const rawProfit = trade.netProfitUsd ?? trade.profit;
                                const profitValue = typeof rawProfit === 'number'
                                    ? rawProfit
                                    : Number.parseFloat(String(rawProfit ?? 0)) || 0;
                                const lotsValue = Number(trade.lots ?? 0) || 0;
                                const symbolCode = trade.symbol?.symbol || trade.symbol?.name || `Symbol #${trade.symbolId}`;
                                const symbolLabel = trade.symbol?.name || symbolCode;

                                return (
                                <TouchableOpacity
                                    key={trade.id}
                                    style={[
                                        styles.positionRow,
                                        index < Math.min(openTrades.length, 5) - 1 && styles.positionBorder,
                                    ]}
                                    onPress={() =>
                                        navigation.navigate('Charts', { symbol: symbolCode, symbolId: trade.symbolId })
                                    }
                                >
                                    <View style={styles.positionLeft}>
                                        <Text style={styles.positionSymbol}>
                                            {symbolLabel}
                                        </Text>
                                        <Text style={[
                                            styles.positionType,
                                            trade.type === 'BUY' ? styles.buyText : styles.sellText
                                        ]}>
                                            {trade.type} {lotsValue} Lots
                                        </Text>
                                    </View>
                                    <View style={styles.sparklinePlaceholder} />
                                    <Text
                                        style={[
                                            styles.positionPnl,
                                            profitValue >= 0 ? styles.positive : styles.negative,
                                        ]}
                                    >
                                        {profitValue >= 0 ? '+' : ''}
                                        {formatCurrency(profitValue)}
                                    </Text>
                                </TouchableOpacity>
                                );
                            })
                        )}

                        {openTrades.length > 5 && (
                            <TouchableOpacity
                                style={styles.viewAllButton}
                                onPress={() => navigation.navigate('History')}
                            >
                                <Text style={styles.viewAllText}>
                                    View all {openTrades.length} positions →
                                </Text>
                            </TouchableOpacity>
                        )}
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
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.md,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.screenPadding,
        paddingVertical: spacing.md,
    },
    headerLeft: {
        flex: 1,
    },
    logoText: {
        ...typography.h4,
        color: colors.accent,
    },
    headerTitle: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    avatarButton: {
        flex: 1,
        alignItems: 'flex-end',
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.bgCard,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: spacing.screenPadding,
        paddingBottom: spacing.tabBarHeight + spacing.xl,
    },
    heroCard: {
        borderRadius: spacing.cardRadius + 4,
        padding: spacing.xl,
        borderWidth: 1,
        borderColor: colors.borderAccent,
        alignItems: 'center',
        marginBottom: spacing.lg,
    },
    heroLabel: {
        ...typography.label,
    },
    heroValue: {
        ...typography.priceHero,
        marginVertical: spacing.xs,
    },
    heroChange: {
        ...typography.bodyLarge,
        fontWeight: '600',
    },
    positive: {
        color: colors.success,
    },
    negative: {
        color: colors.error,
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    statCard: {
        width: '48%',
        flexGrow: 1,
        alignItems: 'center',
    },
    statLabel: {
        ...typography.label,
        marginBottom: spacing.xs,
    },
    statValue: {
        ...typography.priceLarge,
    },
    quickTradeButton: {
        marginBottom: spacing.lg,
    },
    positionsCard: {
        padding: 0,
        overflow: 'hidden',
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    sectionTitle: {
        ...typography.h4,
    },
    positionCount: {
        ...typography.bodySmall,
        color: colors.textMuted,
    },
    emptyPositions: {
        padding: spacing.xl,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: {
        ...typography.body,
        color: colors.textMuted,
        marginTop: spacing.sm,
    },
    emptyLink: {
        ...typography.body,
        color: colors.accent,
        marginTop: spacing.sm,
    },
    positionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: spacing.md,
    },
    positionBorder: {
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    positionLeft: {
        flex: 1,
    },
    positionSymbol: {
        ...typography.body,
        fontWeight: '600',
    },
    positionType: {
        ...typography.labelSmall,
        marginTop: 2,
    },
    buyText: {
        color: colors.success,
    },
    sellText: {
        color: colors.error,
    },
    sparklinePlaceholder: {
        width: 60,
        height: 24,
        backgroundColor: colors.glassBg,
        borderRadius: 4,
        marginHorizontal: spacing.md,
    },
    positionPnl: {
        ...typography.body,
        fontWeight: '600',
        textAlign: 'right',
        minWidth: 80,
    },
    viewAllButton: {
        padding: spacing.md,
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    viewAllText: {
        ...typography.body,
        color: colors.accent,
    },
});

export default DashboardScreen;
