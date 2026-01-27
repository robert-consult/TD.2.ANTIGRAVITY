/**
 * TradeQuip Android - History Screen
 * Uses real API hooks for trade history
 */

import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    ActivityIndicator,
    Alert,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { format } from 'date-fns';

import { colors, typography, spacing } from '../../theme';
import { useTrades, Trade } from '../../hooks/useTrades';

const tabs = ['Positions', 'Pending', 'History'];

interface HistoryScreenProps {
    navigation: any;
}

const TradeCard = ({
    trade,
    onClose,
    onCancel,
    isClosing,
    type,
}: {
    trade: Trade;
    onClose?: () => void;
    onCancel?: () => void;
    isClosing?: boolean;
    type: 'open' | 'pending' | 'closed';
}) => {
    const isBuy = trade.type === 'BUY';
    const isProfitable = (trade.profit || 0) >= 0;
    const symbolName = trade.symbol?.displayName || trade.symbol?.name || `Symbol #${trade.symbolId}`;

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
        }).format(value);
    };

    const formatDate = (dateStr: string) => {
        try {
            return format(new Date(dateStr), 'MMM dd, yyyy HH:mm');
        } catch {
            return dateStr;
        }
    };

    return (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={styles.symbolContainer}>
                    <Text style={styles.symbol}>{symbolName}</Text>
                    <Icon
                        name={isBuy ? 'arrow-up-right' : 'arrow-down-right'}
                        size={16}
                        color={isBuy ? colors.success : colors.error}
                    />
                </View>
                <Text style={[styles.actionText, isBuy ? styles.buyText : styles.sellText]}>
                    {trade.type} {trade.size} Lots
                </Text>
            </View>

            <View style={styles.cardDetails}>
                <View style={styles.detailColumn}>
                    <Text style={styles.detailLabel}>
                        {type === 'closed' ? 'Closed' : 'Opened'}
                    </Text>
                    <Text style={styles.detailValue}>
                        {formatDate(type === 'closed' && trade.closedAt ? trade.closedAt : trade.openedAt)}
                    </Text>
                </View>
                <View style={styles.detailColumn}>
                    <Text style={styles.detailLabel}>Open Price</Text>
                    <Text style={styles.detailValue}>{trade.openPrice.toFixed(5)}</Text>
                </View>
                {type === 'closed' && trade.closePrice && (
                    <View style={styles.detailColumn}>
                        <Text style={styles.detailLabel}>Close Price</Text>
                        <Text style={styles.detailValue}>{trade.closePrice.toFixed(5)}</Text>
                    </View>
                )}
                <View style={styles.detailColumn}>
                    <Text style={styles.detailLabel}>
                        {type === 'closed' ? 'Profit/Loss' : 'Unrealized P/L'}
                    </Text>
                    <Text
                        style={[
                            styles.pnlValue,
                            isProfitable ? styles.positive : styles.negative,
                        ]}
                    >
                        {isProfitable ? '+' : ''}
                        {formatCurrency(trade.profit || 0)}
                    </Text>
                </View>
            </View>

            {/* Action buttons for open positions */}
            {type === 'open' && onClose && (
                <TouchableOpacity
                    style={styles.closeButton}
                    onPress={onClose}
                    disabled={isClosing}
                >
                    {isClosing ? (
                        <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                        <>
                            <Icon name="x-circle" size={16} color={colors.error} />
                            <Text style={styles.closeButtonText}>Close Position</Text>
                        </>
                    )}
                </TouchableOpacity>
            )}

            {/* Cancel button for pending orders */}
            {type === 'pending' && onCancel && (
                <TouchableOpacity
                    style={styles.closeButton}
                    onPress={onCancel}
                >
                    <Icon name="x-circle" size={16} color={colors.warning} />
                    <Text style={[styles.closeButtonText, { color: colors.warning }]}>
                        Cancel Order
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    );
};

export const HistoryScreen: React.FC<HistoryScreenProps> = ({ navigation }) => {
    const [activeTab, setActiveTab] = useState('Positions');
    const [closingTradeId, setClosingTradeId] = useState<number | null>(null);

    const {
        trades,
        openTrades,
        pendingOrders,
        isLoadingTrades,
        isLoadingOpenTrades,
        isLoadingPending,
        refetchTrades,
        refetchOpenTrades,
        refetchPending,
        closeTrade,
        cancelOrder,
    } = useTrades();

    const [refreshing, setRefreshing] = useState(false);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await Promise.all([refetchTrades(), refetchOpenTrades(), refetchPending()]);
        setRefreshing(false);
    }, [refetchTrades, refetchOpenTrades, refetchPending]);

    const handleCloseTrade = useCallback(async (trade: Trade) => {
        Alert.alert(
            'Close Position',
            `Are you sure you want to close your ${trade.type} position on ${trade.symbol?.displayName || trade.symbol?.name}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Close',
                    style: 'destructive',
                    onPress: async () => {
                        setClosingTradeId(trade.id);
                        try {
                            await closeTrade(trade.id);
                            Alert.alert('Position Closed', 'Your position has been closed successfully.');
                        } catch (error: any) {
                            Alert.alert('Error', error.message || 'Failed to close position');
                        } finally {
                            setClosingTradeId(null);
                        }
                    },
                },
            ]
        );
    }, [closeTrade]);

    const handleCancelOrder = useCallback(async (trade: Trade) => {
        Alert.alert(
            'Cancel Order',
            `Are you sure you want to cancel this pending order?`,
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Cancel Order',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await cancelOrder(trade.id);
                            Alert.alert('Order Cancelled', 'Your pending order has been cancelled.');
                        } catch (error: any) {
                            Alert.alert('Error', error.message || 'Failed to cancel order');
                        }
                    },
                },
            ]
        );
    }, [cancelOrder]);

    // Get current list based on active tab
    const currentList = activeTab === 'Positions'
        ? openTrades
        : activeTab === 'Pending'
            ? pendingOrders
            : trades.filter((t) => t.status === 'CLOSED');

    const isLoading = activeTab === 'Positions'
        ? isLoadingOpenTrades
        : activeTab === 'Pending'
            ? isLoadingPending
            : isLoadingTrades;

    return (
        <LinearGradient
            colors={[colors.bgPrimary, colors.bgSecondary]}
            style={styles.gradient}
        >
            <SafeAreaView style={styles.container} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.logoText}>TradeQuip</Text>
                    <Text style={styles.headerTitle}>History</Text>
                    <TouchableOpacity style={styles.filterButton} onPress={onRefresh}>
                        <Icon name="refresh-cw" size={22} color={colors.textSecondary} />
                    </TouchableOpacity>
                </View>

                {/* Tab Selector */}
                <View style={styles.tabContainer}>
                    {tabs.map((tab) => (
                        <TouchableOpacity
                            key={tab}
                            style={[styles.tab, activeTab === tab && styles.tabActive]}
                            onPress={() => setActiveTab(tab)}
                        >
                            <Text
                                style={[
                                    styles.tabText,
                                    activeTab === tab && styles.tabTextActive,
                                ]}
                            >
                                {tab}
                                {tab === 'Positions' && openTrades.length > 0 && (
                                    <Text> ({openTrades.length})</Text>
                                )}
                                {tab === 'Pending' && pendingOrders.length > 0 && (
                                    <Text> ({pendingOrders.length})</Text>
                                )}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Loading State */}
                {isLoading && currentList.length === 0 ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.accent} />
                        <Text style={styles.loadingText}>Loading...</Text>
                    </View>
                ) : (
                    /* List */
                    <FlatList
                        data={currentList}
                        keyExtractor={(item) => String(item.id)}
                        renderItem={({ item }) => (
                            <TradeCard
                                trade={item}
                                type={
                                    activeTab === 'Positions'
                                        ? 'open'
                                        : activeTab === 'Pending'
                                            ? 'pending'
                                            : 'closed'
                                }
                                onClose={
                                    activeTab === 'Positions'
                                        ? () => handleCloseTrade(item)
                                        : undefined
                                }
                                onCancel={
                                    activeTab === 'Pending'
                                        ? () => handleCancelOrder(item)
                                        : undefined
                                }
                                isClosing={closingTradeId === item.id}
                            />
                        )}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        ItemSeparatorComponent={() => <View style={styles.separator} />}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={onRefresh}
                                tintColor={colors.accent}
                                colors={[colors.accent]}
                            />
                        }
                        ListEmptyComponent={
                            <View style={styles.emptyContainer}>
                                <Icon name="inbox" size={48} color={colors.textMuted} />
                                <Text style={styles.emptyText}>
                                    {activeTab === 'Positions'
                                        ? 'No open positions'
                                        : activeTab === 'Pending'
                                            ? 'No pending orders'
                                            : 'No trade history'}
                                </Text>
                                {activeTab === 'Positions' && (
                                    <TouchableOpacity onPress={() => navigation.navigate('Trade')}>
                                        <Text style={styles.emptyLink}>Start trading →</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        }
                    />
                )}
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
        paddingVertical: spacing.md,
    },
    logoText: {
        ...typography.h4,
        color: colors.accent,
    },
    headerTitle: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    filterButton: {
        padding: spacing.xs,
    },
    tabContainer: {
        flexDirection: 'row',
        marginHorizontal: spacing.screenPadding,
        backgroundColor: colors.bgCard,
        borderRadius: 12,
        padding: 4,
        marginBottom: spacing.md,
    },
    tab: {
        flex: 1,
        paddingVertical: spacing.sm,
        alignItems: 'center',
        borderRadius: 10,
    },
    tabActive: {
        backgroundColor: colors.accent,
    },
    tabText: {
        ...typography.buttonSmall,
        color: colors.textSecondary,
    },
    tabTextActive: {
        color: colors.bgPrimary,
        fontWeight: '600',
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
    listContent: {
        paddingHorizontal: spacing.screenPadding,
        paddingBottom: spacing.tabBarHeight + spacing.xl,
    },
    card: {
        backgroundColor: colors.bgCard,
        borderRadius: spacing.cardRadiusSmall,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.sm,
    },
    symbolContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    symbol: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    actionText: {
        ...typography.bodySmall,
        fontWeight: '600',
    },
    buyText: {
        color: colors.success,
    },
    sellText: {
        color: colors.error,
    },
    cardDetails: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: spacing.sm,
    },
    detailColumn: {
        width: '50%',
        marginBottom: spacing.xs,
    },
    detailLabel: {
        ...typography.labelSmall,
        color: colors.textMuted,
        marginBottom: 2,
    },
    detailValue: {
        ...typography.body,
        color: colors.textPrimary,
    },
    pnlValue: {
        ...typography.body,
        fontWeight: '600',
    },
    positive: {
        color: colors.success,
    },
    negative: {
        color: colors.error,
    },
    closeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        marginTop: spacing.sm,
        paddingVertical: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    closeButtonText: {
        ...typography.buttonSmall,
        color: colors.error,
    },
    separator: {
        height: spacing.sm,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.xxxl,
    },
    emptyText: {
        ...typography.body,
        color: colors.textMuted,
        marginTop: spacing.md,
    },
    emptyLink: {
        ...typography.body,
        color: colors.accent,
        marginTop: spacing.sm,
    },
});

export default HistoryScreen;
