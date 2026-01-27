/**
 * TradeQuip Native - Leaderboard Screen
 * Fetches /api/leaderboard (same data as web)
 */

import React, { useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    ActivityIndicator,
    RefreshControl,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';

import { colors, typography, spacing } from '../../theme';
import { leaderboardApi } from '../../services/api';

type LeaderboardItem = {
    userId: number;
    username: string;
    profit: number;
    profitPct?: number;
    winRate: number;
    totalTrades: number;
};

const LeaderboardListSeparator = () => <View style={styles.separator} />;

const formatCurrency = (value: number) => {
    const n = Number(value || 0);
    const abs = Math.abs(n);
    const formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(abs);
    return `${n >= 0 ? '+' : '-'}${formatted}`;
};

const getTrophyColor = (rank: number) => {
    switch (rank) {
        case 1:
            return colors.gold;
        case 2:
            return colors.silver;
        case 3:
            return colors.bronze;
        default:
            return colors.textMuted;
    }
};

const PodiumItem = ({
    item,
    rank,
}: {
    item: LeaderboardItem;
    rank: number;
}) => {
    return (
        <View style={[styles.podiumItem, rank === 1 && styles.podiumCenter]}>
            <View style={[styles.podiumAvatar, rank === 1 && styles.podiumAvatarCenter, { borderColor: getTrophyColor(rank) }]}>
                <Icon name="user" size={rank === 1 ? 32 : 24} color={colors.textSecondary} />
            </View>
            <Text style={styles.podiumRank}>
                {rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'} Place
            </Text>
            <Text style={styles.podiumName} numberOfLines={1}>{item.username}</Text>
            <Text style={[styles.podiumProfit, { color: item.profit >= 0 ? colors.success : colors.error }]}>
                {formatCurrency(item.profit)}
            </Text>
            <Text style={styles.podiumProfitLabel}>Profit</Text>
        </View>
    );
};

const RankingRow = ({ item, rank }: { item: LeaderboardItem; rank: number }) => (
    <View style={styles.rankingRow}>
        <View style={styles.rankNumberWrap}>
            {rank <= 3 ? (
                <Icon name="award" size={16} color={getTrophyColor(rank)} />
            ) : (
                <Text style={styles.rankNumber}>{rank}</Text>
            )}
        </View>

        <View style={styles.rankAvatar}>
            <Icon name="user" size={18} color={colors.textSecondary} />
        </View>

        <View style={styles.rankInfo}>
            <Text style={styles.rankName} numberOfLines={1}>{item.username}</Text>
            <Text style={styles.rankMeta}>
                Win rate {Number(item.winRate || 0).toFixed(1)}% · {item.totalTrades} trades
            </Text>
        </View>

        <Text style={[styles.rankProfit, { color: item.profit >= 0 ? colors.success : colors.error }]}>
            {formatCurrency(item.profit)}
        </Text>
    </View>
);

export const LeaderboardScreen: React.FC<{ navigation: any }> = () => {
    const {
        data: leaderboard = [],
        isLoading,
        refetch,
        isRefetching,
    } = useQuery<LeaderboardItem[]>({
        queryKey: ['leaderboard'],
        queryFn: leaderboardApi.getTopTraders,
        refetchInterval: 30000,
    });

    const { topThree, rest } = useMemo(() => {
        const rows = Array.isArray(leaderboard) ? leaderboard : [];
        return {
            topThree: rows.slice(0, 3),
            rest: rows.slice(3),
        };
    }, [leaderboard]);

    return (
        <LinearGradient colors={[colors.bgPrimary, colors.bgSecondary]} style={styles.gradient}>
            <SafeAreaView style={styles.container} edges={['top']}>
                <View style={styles.header}>
                    <Text style={styles.logoText}>TradeQuip</Text>
                    <Text style={styles.headerTitle}>Leaderboard</Text>
                    <View style={styles.headerRight} />
                </View>

                {isLoading && !leaderboard.length ? (
                    <View style={styles.loading}>
                        <ActivityIndicator size="large" color={colors.accent} />
                        <Text style={styles.loadingText}>Loading leaderboard…</Text>
                    </View>
                ) : (
                    <FlatList
                        data={rest}
                        keyExtractor={(item) => String(item.userId)}
                        renderItem={({ item, index }) => <RankingRow item={item} rank={index + 4} />}
                        ListHeaderComponent={
                            topThree.length ? (
                                <View style={styles.podiumContainer}>
                                    {topThree[1] && <PodiumItem item={topThree[1]} rank={2} />}
                                    {topThree[0] && <PodiumItem item={topThree[0]} rank={1} />}
                                    {topThree[2] && <PodiumItem item={topThree[2]} rank={3} />}
                                </View>
                            ) : (
                                <View style={styles.empty}>
                                    <Icon name="award" size={32} color={colors.textMuted} />
                                    <Text style={styles.emptyText}>No traders on the leaderboard yet</Text>
                                </View>
                            )
                        }
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
	                        refreshControl={
	                            <RefreshControl
	                                refreshing={isRefetching}
	                                onRefresh={() => {
	                                    refetch().catch(() => undefined);
	                                }}
	                                tintColor={colors.accent}
	                                colors={[colors.accent]}
	                            />
	                        }
	                        ItemSeparatorComponent={LeaderboardListSeparator}
	                        ListEmptyComponent={
	                            !isLoading ? (
	                                <View style={styles.empty}>
	                                    <Icon name="award" size={32} color={colors.textMuted} />
                                    <Text style={styles.emptyText}>No traders on the leaderboard yet</Text>
                                </View>
                            ) : null
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
    headerRight: {
        width: 60,
    },
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
    },
    loadingText: {
        ...typography.bodySmall,
        color: colors.textSecondary,
    },
    listContent: {
        paddingHorizontal: spacing.screenPadding,
        paddingBottom: spacing.tabBarHeight + spacing.xl,
    },
    podiumContainer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingVertical: spacing.xl,
        marginBottom: spacing.lg,
    },
    podiumItem: {
        alignItems: 'center',
        flex: 1,
    },
    podiumCenter: {
        marginBottom: spacing.lg,
    },
    podiumAvatar: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: colors.bgCard,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 3,
        marginBottom: spacing.sm,
    },
    podiumAvatarCenter: {
        width: 80,
        height: 80,
        borderRadius: 40,
        borderWidth: 4,
    },
    podiumRank: {
        ...typography.labelSmall,
        color: colors.textSecondary,
        marginBottom: 2,
    },
    podiumName: {
        ...typography.body,
        fontWeight: '600',
        color: colors.textPrimary,
        maxWidth: 100,
    },
    podiumProfit: {
        ...typography.h4,
        marginTop: spacing.xxs,
    },
    podiumProfitLabel: {
        ...typography.labelSmall,
        color: colors.textMuted,
    },
    rankingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.bgCard,
        borderRadius: spacing.cardRadiusSmall,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
    },
    rankNumberWrap: {
        width: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.xs,
    },
    rankNumber: {
        ...typography.body,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    rankAvatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.glassBg,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.sm,
    },
    rankInfo: {
        flex: 1,
        minWidth: 0,
    },
    rankName: {
        ...typography.body,
        color: colors.textPrimary,
    },
    rankMeta: {
        ...typography.caption,
        color: colors.textMuted,
        marginTop: 2,
    },
    rankProfit: {
        ...typography.bodyBold,
        marginLeft: spacing.sm,
    },
    separator: {
        height: spacing.sm,
    },
    empty: {
        paddingVertical: spacing.xl * 2,
        alignItems: 'center',
        gap: spacing.sm,
    },
    emptyText: {
        ...typography.body,
        color: colors.textMuted,
        textAlign: 'center',
    },
});

export default LeaderboardScreen;
