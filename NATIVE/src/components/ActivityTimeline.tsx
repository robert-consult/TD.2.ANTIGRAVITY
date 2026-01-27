/**
 * TradeQuip Native - Activity Timeline Component
 * Displays recent trading activity and account events
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { colors, typography, spacing } from '../theme';

interface ActivityItem {
    id: string | number;
    type: 'trade_open' | 'trade_close' | 'deposit' | 'withdrawal' | 'login' | 'order_placed' | 'order_cancelled' | 'stop_loss' | 'take_profit';
    title: string;
    description?: string;
    amount?: number;
    symbol?: string;
    side?: 'BUY' | 'SELL';
    profit?: number;
    timestamp: Date | string | number;
}

interface ActivityTimelineProps {
    activities: ActivityItem[];
    onItemPress?: (item: ActivityItem) => void;
    emptyMessage?: string;
    maxItems?: number;
}

const ACTIVITY_CONFIG: Record<string, { icon: string; color: string }> = {
    trade_open: { icon: 'trending-up', color: colors.accent },
    trade_close: { icon: 'check-circle', color: colors.success },
    deposit: { icon: 'arrow-down-circle', color: colors.success },
    withdrawal: { icon: 'arrow-up-circle', color: colors.warning },
    login: { icon: 'log-in', color: colors.textMuted },
    order_placed: { icon: 'clock', color: colors.accent },
    order_cancelled: { icon: 'x-circle', color: colors.error },
    stop_loss: { icon: 'shield', color: colors.error },
    take_profit: { icon: 'target', color: colors.success },
};

const formatTimeAgo = (timestamp: Date | string | number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
};

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
    activities,
    onItemPress,
    emptyMessage = 'No recent activity',
    maxItems,
}) => {
    const displayedActivities = maxItems ? activities.slice(0, maxItems) : activities;

    const renderItem = ({ item, index }: { item: ActivityItem; index: number }) => {
        const config = ACTIVITY_CONFIG[item.type] || { icon: 'activity', color: colors.textMuted };
        const isLast = index === displayedActivities.length - 1;

        return (
            <TouchableOpacity
                style={styles.item}
                onPress={() => onItemPress?.(item)}
                disabled={!onItemPress}
                activeOpacity={onItemPress ? 0.7 : 1}
            >
                {/* Timeline connector */}
                <View style={styles.timelineColumn}>
                    <View style={[styles.iconContainer, { backgroundColor: `${config.color}20` }]}>
                        <Icon name={config.icon} size={16} color={config.color} />
                    </View>
                    {!isLast && <View style={styles.connector} />}
                </View>

                {/* Content */}
                <View style={styles.content}>
                    <View style={styles.header}>
                        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.time}>{formatTimeAgo(item.timestamp)}</Text>
                    </View>

                    {item.description && (
                        <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
                    )}

                    {/* Trade details */}
                    {item.symbol && (
                        <View style={styles.tradeDetails}>
                            <Text style={styles.symbol}>{item.symbol}</Text>
                            {item.side && (
                                <View style={[
                                    styles.sideBadge,
                                    { backgroundColor: item.side === 'BUY' ? colors.successLight : colors.errorLight }
                                ]}>
                                    <Text style={[
                                        styles.sideText,
                                        { color: item.side === 'BUY' ? colors.success : colors.error }
                                    ]}>
                                        {item.side}
                                    </Text>
                                </View>
                            )}
                            {item.profit !== undefined && (
                                <Text style={[
                                    styles.profit,
                                    { color: item.profit >= 0 ? colors.success : colors.error }
                                ]}>
                                    {item.profit >= 0 ? '+' : ''}${item.profit.toFixed(2)}
                                </Text>
                            )}
                        </View>
                    )}

                    {/* Amount for deposits/withdrawals */}
                    {item.amount !== undefined && !item.symbol && (
                        <Text style={[
                            styles.amount,
                            { color: item.type === 'deposit' ? colors.success : colors.warning }
                        ]}>
                            {item.type === 'deposit' ? '+' : '-'}${Math.abs(item.amount).toLocaleString()}
                        </Text>
                    )}
                </View>
            </TouchableOpacity>
        );
    };

    if (displayedActivities.length === 0) {
        return (
            <View style={styles.empty}>
                <Icon name="activity" size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>{emptyMessage}</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <FlatList
                data={displayedActivities}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderItem}
                scrollEnabled={false}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    item: {
        flexDirection: 'row',
        paddingVertical: spacing.sm,
    },
    timelineColumn: {
        alignItems: 'center',
        width: 40,
    },
    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    connector: {
        width: 2,
        flex: 1,
        backgroundColor: colors.border,
        marginTop: spacing.xs,
    },
    content: {
        flex: 1,
        paddingLeft: spacing.sm,
        paddingBottom: spacing.md,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    title: {
        ...typography.bodyBold,
        color: colors.textPrimary,
        flex: 1,
        marginRight: spacing.sm,
    },
    time: {
        ...typography.caption,
        color: colors.textMuted,
    },
    description: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        marginTop: 2,
    },
    tradeDetails: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.xs,
        gap: spacing.sm,
    },
    symbol: {
        ...typography.body,
        color: colors.textSecondary,
    },
    sideBadge: {
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        borderRadius: 4,
    },
    sideText: {
        ...typography.caption,
        fontWeight: '600',
    },
    profit: {
        ...typography.bodyBold,
    },
    amount: {
        ...typography.bodyBold,
        marginTop: spacing.xs,
    },
    empty: {
        padding: spacing.xl,
        alignItems: 'center',
        gap: spacing.sm,
    },
    emptyText: {
        ...typography.body,
        color: colors.textMuted,
    },
});

export default ActivityTimeline;
