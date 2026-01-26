/**
 * TradeQuip Android - Leaderboard Screen
 * Based on mockup: leaderboard_mockup.png
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    Image,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';

import { colors, typography, spacing, shadows } from '../../theme';
import { GlassCard } from '../../components/cards/GlassCard';
import { Button } from '../../components/Button';

// Mock data
const topTraders = [
    { id: '1', name: 'Alex T.', profit: 145, rank: 1, avatar: null },
    { id: '2', name: 'Sarah K.', profit: 98, rank: 2, avatar: null },
    { id: '3', name: 'John D.', profit: 82, rank: 3, avatar: null },
];

const rankings = [
    { id: '4', name: 'Mike D.', country: '🇺🇸', profit: 75, rank: 4 },
    { id: '5', name: 'Emma W.', country: '🇬🇧', profit: 72, rank: 5 },
    { id: '6', name: 'Carlos M.', country: '🇲🇽', profit: 68, rank: 6 },
    { id: '7', name: 'Yuki T.', country: '🇯🇵', profit: 65, rank: 7 },
    { id: '8', name: 'Anna S.', country: '🇩🇪', profit: 61, rank: 8 },
];

interface LeaderboardScreenProps {
    navigation: any;
}

const PodiumItem = ({
    trader,
    position,
}: {
    trader: typeof topTraders[0];
    position: 'left' | 'center' | 'right';
}) => {
    const getGlowColor = () => {
        switch (trader.rank) {
            case 1:
                return colors.gold;
            case 2:
                return colors.silver;
            case 3:
                return colors.bronze;
            default:
                return colors.accent;
        }
    };

    return (
        <View style={[styles.podiumItem, position === 'center' && styles.podiumCenter]}>
            <View
                style={[
                    styles.podiumAvatar,
                    { borderColor: getGlowColor() },
                    position === 'center' && styles.podiumAvatarCenter,
                ]}
            >
                {trader.avatar ? (
                    <Image source={{ uri: trader.avatar }} style={styles.avatarImage} />
                ) : (
                    <Icon
                        name="user"
                        size={position === 'center' ? 32 : 24}
                        color={colors.textSecondary}
                    />
                )}
            </View>
            <Text style={styles.podiumRank}>
                {trader.rank === 1 ? '1st' : trader.rank === 2 ? '2nd' : '3rd'} Place
            </Text>
            <Text style={styles.podiumName}>{trader.name}</Text>
            <Text style={[styles.podiumProfit, { color: colors.success }]}>
                +{trader.profit}%
            </Text>
            <Text style={styles.podiumProfitLabel}>Profit</Text>
        </View>
    );
};

const RankingRow = ({ item }: { item: typeof rankings[0] }) => (
    <View style={styles.rankingRow}>
        <Text style={styles.rankNumber}>{item.rank}</Text>
        <View style={styles.rankAvatar}>
            <Icon name="user" size={18} color={colors.textSecondary} />
        </View>
        <View style={styles.rankInfo}>
            <Text style={styles.rankName}>
                {item.name} {item.country}
            </Text>
        </View>
        <Text style={styles.rankProfit}>+{item.profit}% Profit</Text>
        <TouchableOpacity style={styles.copyButton}>
            <Text style={styles.copyButtonText}>Copy</Text>
        </TouchableOpacity>
    </View>
);

export const LeaderboardScreen: React.FC<LeaderboardScreenProps> = ({
    navigation,
}) => {
    return (
        <LinearGradient
            colors={[colors.bgPrimary, colors.bgSecondary]}
            style={styles.gradient}
        >
            <SafeAreaView style={styles.container} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.logoText}>TradeQuip</Text>
                    <Text style={styles.headerTitle}>Top Traders</Text>
                    <View style={styles.headerRight} />
                </View>

                <FlatList
                    data={rankings}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => <RankingRow item={item} />}
                    ListHeaderComponent={
                        <>
                            {/* Podium */}
                            <View style={styles.podiumContainer}>
                                <PodiumItem trader={topTraders[1]} position="left" />
                                <PodiumItem trader={topTraders[0]} position="center" />
                                <PodiumItem trader={topTraders[2]} position="right" />
                            </View>
                        </>
                    }
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
    headerRight: {
        width: 60,
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
    avatarImage: {
        width: '100%',
        height: '100%',
        borderRadius: 30,
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
    rankNumber: {
        ...typography.body,
        fontWeight: '600',
        color: colors.textSecondary,
        width: 24,
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
    },
    rankName: {
        ...typography.body,
        color: colors.textPrimary,
    },
    rankProfit: {
        ...typography.bodySmall,
        color: colors.success,
        fontWeight: '600',
        marginRight: spacing.sm,
    },
    copyButton: {
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.glassBg,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
    },
    copyButtonText: {
        ...typography.buttonSmall,
        color: colors.textPrimary,
    },
    separator: {
        height: spacing.sm,
    },
});

export default LeaderboardScreen;
