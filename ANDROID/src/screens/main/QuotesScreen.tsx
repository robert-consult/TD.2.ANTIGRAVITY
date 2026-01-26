/**
 * TradeQuip Android - Quotes Screen
 * Based on mockup: quotes_revised.png
 */

import React from 'react';
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
const quotes = [
    { symbol: 'EUR/USD', bid: 1.1234, ask: 1.1236, change: 0.05, positive: true },
    { symbol: 'GBP/USD', bid: 1.1234, ask: 1.1236, change: -0.12, positive: false },
    { symbol: 'USD/JPY', bid: 1.1234, ask: 1.1238, change: 0.23, positive: true },
    { symbol: 'AUD/USD', bid: 1.1232, ask: 1.1236, change: -0.08, positive: false },
    { symbol: 'USD/CAD', bid: 1.1234, ask: 1.1236, change: 0.15, positive: true },
    { symbol: 'NZD/USD', bid: 1.1348, ask: 1.1358, change: 0.32, positive: true },
    { symbol: 'USD/CHF', bid: 1.1225, ask: 1.1226, change: -0.04, positive: false },
    { symbol: 'BTC/USD', bid: 1.1233, ask: 1.1232, change: 2.45, positive: true },
];

interface QuotesScreenProps {
    navigation: any;
}

const QuoteRow = ({
    item,
    onPress,
}: {
    item: typeof quotes[0];
    onPress: () => void;
}) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        <View style={styles.quoteRow}>
            <View style={styles.quoteLeft}>
                <Text style={styles.quoteSymbol}>{item.symbol}</Text>
                {/* Sparkline placeholder */}
                <View style={styles.sparkline}>
                    <View
                        style={[
                            styles.sparklineBar,
                            { backgroundColor: item.positive ? colors.success : colors.error },
                        ]}
                    />
                </View>
            </View>
            <View style={styles.quoteRight}>
                <TouchableOpacity style={[styles.priceButton, styles.bidButton]}>
                    <Text style={styles.priceLabel}>Bid</Text>
                    <Text style={styles.priceValue}>{item.bid.toFixed(4)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.priceButton, styles.askButton]}>
                    <Text style={styles.priceLabel}>Ask</Text>
                    <Text style={styles.priceValue}>{item.ask.toFixed(4)}</Text>
                </TouchableOpacity>
            </View>
        </View>
    </TouchableOpacity>
);

export const QuotesScreen: React.FC<QuotesScreenProps> = ({ navigation }) => {
    return (
        <LinearGradient
            colors={[colors.bgPrimary, colors.bgSecondary]}
            style={styles.gradient}
        >
            <SafeAreaView style={styles.container} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.logoText}>TradeQuip</Text>
                    <Text style={styles.headerTitle}>Quotes</Text>
                    <TouchableOpacity style={styles.searchButton}>
                        <Icon name="search" size={22} color={colors.textSecondary} />
                    </TouchableOpacity>
                </View>

                {/* Quote List */}
                <FlatList
                    data={quotes}
                    keyExtractor={(item) => item.symbol}
                    renderItem={({ item }) => (
                        <QuoteRow
                            item={item}
                            onPress={() => navigation.navigate('Charts', { symbol: item.symbol })}
                        />
                    )}
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
    searchButton: {
        padding: spacing.xs,
    },
    listContent: {
        paddingHorizontal: spacing.screenPadding,
        paddingBottom: spacing.tabBarHeight + spacing.xl,
    },
    quoteRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.bgCard,
        borderRadius: spacing.cardRadiusSmall,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
    },
    quoteLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    quoteSymbol: {
        ...typography.body,
        fontWeight: '600',
        color: colors.textPrimary,
        width: 80,
    },
    sparkline: {
        width: 60,
        height: 24,
        justifyContent: 'center',
        marginLeft: spacing.sm,
    },
    sparklineBar: {
        height: 2,
        width: '100%',
        borderRadius: 1,
    },
    quoteRight: {
        flexDirection: 'row',
        gap: spacing.xs,
    },
    priceButton: {
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.md,
        borderRadius: 8,
        alignItems: 'center',
        minWidth: 70,
    },
    bidButton: {
        backgroundColor: colors.errorLight,
        borderWidth: 1,
        borderColor: 'rgba(255, 82, 82, 0.3)',
    },
    askButton: {
        backgroundColor: colors.successLight,
        borderWidth: 1,
        borderColor: 'rgba(0, 230, 118, 0.3)',
    },
    priceLabel: {
        ...typography.labelSmall,
        color: colors.textSecondary,
        marginBottom: 2,
    },
    priceValue: {
        ...typography.price,
        fontSize: 14,
    },
    separator: {
        height: spacing.sm,
    },
});

export default QuotesScreen;
