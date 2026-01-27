/**
 * TradeQuip Android - Quotes Screen
 * Uses real API hooks for live quotes
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
    TextInput,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';

import { colors, typography, spacing } from '../../theme';
import { useQuotes, Quote, SymbolConfig } from '../../hooks/useQuotes';

interface QuotesScreenProps {
    navigation: any;
}

interface QuoteRowData extends Quote {
    symbolInfo?: SymbolConfig;
}

const QuoteListSeparator = () => <View style={styles.separator} />;

const QuoteRow = ({
    item,
    onPress,
    onBuyPress,
    onSellPress,
}: {
    item: QuoteRowData;
    onPress: () => void;
    onBuyPress: () => void;
    onSellPress: () => void;
}) => {
    const formatPrice = (value: number) => {
        // Auto-detect decimal places based on value
        const decimals = value < 10 ? 5 : value < 1000 ? 4 : 2;
        return value.toFixed(decimals);
    };

    const bid = item.bid ?? item.price;
    const ask = item.ask ?? item.price;

    return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
            <View style={styles.quoteRow}>
                <View style={styles.quoteLeft}>
                    <Text style={styles.quoteSymbol}>{item.symbol}</Text>
                    <View style={styles.changeContainer}>
                        <Text
                            style={[
                                styles.quoteChange,
                                item.changePct >= 0 ? styles.positive : styles.negative,
                            ]}
                        >
                            {item.changePct >= 0 ? '+' : ''}
                            {item.changePct.toFixed(2)}%
                        </Text>
                    </View>
                </View>
                <View style={styles.quoteRight}>
                    <TouchableOpacity
                        style={[styles.priceButton, styles.bidButton]}
                        onPress={onSellPress}
                    >
                        <Text style={styles.priceLabel}>Bid</Text>
                        <Text style={styles.priceValue}>{formatPrice(bid)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.priceButton, styles.askButton]}
                        onPress={onBuyPress}
                    >
                        <Text style={styles.priceLabel}>Ask</Text>
                        <Text style={styles.priceValue}>{formatPrice(ask)}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </TouchableOpacity>
    );
};

export const QuotesScreen: React.FC<QuotesScreenProps> = ({ navigation }) => {
    const { quotes, symbols, isLoading, refetchQuotes, isLive } = useQuotes();
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await refetchQuotes();
        setRefreshing(false);
    }, [refetchQuotes]);

    // Combine quotes with symbol info and filter by search
    const quotesWithInfo: QuoteRowData[] = quotes
        .map((quote) => ({
            ...quote,
            symbolInfo: symbols.find((s) => s.id === quote.symbolId),
        }))
        .filter((quote) => {
            if (!searchQuery) return true;
            const search = searchQuery.toLowerCase();
            return (
                quote.symbol.toLowerCase().includes(search) ||
                quote.symbolInfo?.name.toLowerCase().includes(search)
            );
        });

    const handleQuotePress = useCallback(
        (quote: QuoteRowData) => {
            navigation.navigate('Charts', {
                symbol: quote.symbol,
                symbolId: quote.symbolId,
            });
        },
        [navigation]
    );

    const handleBuyPress = useCallback(
        (quote: QuoteRowData) => {
            navigation.navigate('Trade', {
                symbol: quote.symbol,
                symbolId: quote.symbolId,
                side: 'BUY',
            });
        },
        [navigation]
    );

    const handleSellPress = useCallback(
        (quote: QuoteRowData) => {
            navigation.navigate('Trade', {
                symbol: quote.symbol,
                symbolId: quote.symbolId,
                side: 'SELL',
            });
        },
        [navigation]
    );

    return (
        <LinearGradient
            colors={[colors.bgPrimary, colors.bgSecondary]}
            style={styles.gradient}
        >
            <SafeAreaView style={styles.container} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.logoText}>TradeQuip</Text>
                    <View style={styles.headerCenter}>
                        <Text style={styles.headerTitle}>Quotes</Text>
                        {isLive && (
                            <View style={styles.liveIndicator}>
                                <View style={styles.liveDot} />
                                <Text style={styles.liveText}>LIVE</Text>
                            </View>
                        )}
                    </View>
                    <TouchableOpacity
                        style={styles.searchButton}
                        onPress={() => setShowSearch(!showSearch)}
                    >
                        <Icon
                            name={showSearch ? 'x' : 'search'}
                            size={22}
                            color={colors.textSecondary}
                        />
                    </TouchableOpacity>
                </View>

                {/* Search Bar */}
                {showSearch && (
                    <View style={styles.searchContainer}>
                        <Icon name="search" size={18} color={colors.textMuted} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search symbols..."
                            placeholderTextColor={colors.textMuted}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoFocus
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <Icon name="x" size={18} color={colors.textMuted} />
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {/* Loading State */}
                {isLoading && quotes.length === 0 ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.accent} />
                        <Text style={styles.loadingText}>Loading quotes...</Text>
                    </View>
                ) : (
                    /* Quote List */
	                    <FlatList
	                        data={quotesWithInfo}
	                        keyExtractor={(item) => item.symbol}
	                        renderItem={({ item }) => (
	                            <QuoteRow
	                                item={item}
	                                onPress={() => handleQuotePress(item)}
	                                onBuyPress={() => handleBuyPress(item)}
	                                onSellPress={() => handleSellPress(item)}
	                            />
	                        )}
	                        contentContainerStyle={styles.listContent}
	                        showsVerticalScrollIndicator={false}
	                        ItemSeparatorComponent={QuoteListSeparator}
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
                                    {searchQuery ? 'No symbols match your search' : 'No quotes available'}
                                </Text>
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
    headerCenter: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    headerTitle: {
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
    searchButton: {
        padding: spacing.xs,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.bgCard,
        marginHorizontal: spacing.screenPadding,
        marginBottom: spacing.md,
        paddingHorizontal: spacing.md,
        borderRadius: spacing.inputRadius,
        borderWidth: 1,
        borderColor: colors.border,
        height: 44,
        gap: spacing.sm,
    },
    searchInput: {
        flex: 1,
        ...typography.body,
        color: colors.textPrimary,
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
        flex: 1,
    },
    quoteSymbol: {
        ...typography.body,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    changeContainer: {
        marginTop: 2,
    },
    quoteChange: {
        ...typography.bodySmall,
        fontWeight: '600',
    },
    positive: {
        color: colors.success,
    },
    negative: {
        color: colors.error,
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
        minWidth: 80,
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
});

export default QuotesScreen;
