/**
 * TradeQuip Android - History Screen
 * Based on mockup: history_revised.png
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';

import { colors, typography, spacing } from '../../theme';

// Mock data
const historyData = [
    {
        id: '1',
        symbol: 'AAPL',
        company: 'Apple Inc.',
        action: 'sell',
        shares: 50,
        date: 'Oct 25, 2023',
        price: 170.50,
        pnl: -120.00,
    },
    {
        id: '2',
        symbol: 'TSLA',
        company: 'Tesla, Inc.',
        action: 'buy',
        shares: 20,
        date: 'Oct 24, 2023',
        price: 215.00,
        pnl: 85.00,
    },
    {
        id: '3',
        symbol: 'GOOGL',
        company: 'Alphabet Inc.',
        action: 'buy',
        shares: 10,
        date: 'Oct 23, 2023',
        price: 135.20,
        pnl: 40.00,
    },
    {
        id: '4',
        symbol: 'MSFT',
        company: 'Microsoft Corp.',
        action: 'sell',
        shares: 30,
        date: 'Oct 20, 2023',
        price: 330.10,
        pnl: -55.00,
    },
    {
        id: '5',
        symbol: 'AMZN',
        company: 'Amazon.com, Inc.',
        action: 'buy',
        shares: 15,
        date: 'Oct 18, 2023',
        price: 128.50,
        pnl: 60.00,
    },
];

const tabs = ['Positions', 'Pending', 'History'];

interface HistoryScreenProps {
    navigation: any;
}

const TradeHistoryCard = ({ item }: { item: typeof historyData[0] }) => {
    const isBuy = item.action === 'buy';
    const isProfitable = item.pnl >= 0;

    return (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={styles.symbolContainer}>
                    <Text style={styles.symbol}>{item.symbol}</Text>
                    <Icon
                        name={isBuy ? 'arrow-up-right' : 'arrow-down-right'}
                        size={16}
                        color={isBuy ? colors.success : colors.error}
                    />
                </View>
                <Text style={[styles.actionText, isBuy ? styles.buyText : styles.sellText]}>
                    {isBuy ? 'Buy' : 'Sell'} {item.shares} Shares
                </Text>
            </View>
            <Text style={styles.companyName}>{item.company}</Text>

            <View style={styles.cardDetails}>
                <View style={styles.detailColumn}>
                    <Text style={styles.detailLabel}>Date</Text>
                    <Text style={styles.detailValue}>{item.date}</Text>
                </View>
                <View style={styles.detailColumn}>
                    <Text style={styles.detailLabel}>Price</Text>
                    <Text style={styles.detailValue}>${item.price.toFixed(2)}</Text>
                </View>
                <View style={styles.detailColumn}>
                    <Text style={styles.detailLabel}>Profit/Loss</Text>
                    <Text
                        style={[
                            styles.pnlValue,
                            isProfitable ? styles.positive : styles.negative,
                        ]}
                    >
                        {isProfitable ? '+' : ''}${item.pnl.toFixed(2)}
                    </Text>
                </View>
            </View>
        </View>
    );
};

export const HistoryScreen: React.FC<HistoryScreenProps> = () => {
    const [activeTab, setActiveTab] = useState('History');

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
                    <TouchableOpacity style={styles.filterButton}>
                        <Icon name="filter" size={22} color={colors.textSecondary} />
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
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* History List */}
                <FlatList
                    data={historyData}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => <TradeHistoryCard item={item} />}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    ItemSeparatorComponent={() => <View style={styles.separator} />}
                />
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
        marginBottom: spacing.xxs,
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
    companyName: {
        ...typography.bodySmall,
        color: colors.textMuted,
        marginBottom: spacing.sm,
    },
    cardDetails: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: spacing.sm,
    },
    detailColumn: {
        flex: 1,
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
    separator: {
        height: spacing.sm,
    },
});

export default HistoryScreen;
