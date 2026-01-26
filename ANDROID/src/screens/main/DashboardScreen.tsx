/**
 * TradeQuip Android - Dashboard Screen
 * Based on mockup: dashboard_revised.png
 */

import React from 'react';
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

// Mock data
const portfolioData = {
    totalValue: 124500.25,
    changePercent: 1.2,
    equity: 89200,
    margin: 35300,
    todayPnL: 1500,
    buyingPower: 15000,
};

const positions = [
    { symbol: 'AAPL', change: 2.5, positive: true },
    { symbol: 'TSLA', change: -1.1, positive: false },
    { symbol: 'GOOGL', change: 0.8, positive: true },
];

interface DashboardScreenProps {
    navigation: any;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
        }).format(value);
    };

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
                            {formatCurrency(portfolioData.totalValue)}
                        </Text>
                        <Text
                            style={[
                                styles.heroChange,
                                portfolioData.changePercent >= 0
                                    ? styles.positive
                                    : styles.negative,
                            ]}
                        >
                            {portfolioData.changePercent >= 0 ? '+' : ''}
                            {portfolioData.changePercent.toFixed(1)}%
                        </Text>
                    </LinearGradient>

                    {/* Stats Grid */}
                    <View style={styles.statsGrid}>
                        <GlassCard style={styles.statCard}>
                            <Text style={styles.statLabel}>Equity</Text>
                            <Text style={styles.statValue}>
                                {formatCurrency(portfolioData.equity)}
                            </Text>
                        </GlassCard>
                        <GlassCard style={styles.statCard}>
                            <Text style={styles.statLabel}>Margin</Text>
                            <Text style={styles.statValue}>
                                {formatCurrency(portfolioData.margin)}
                            </Text>
                        </GlassCard>
                        <GlassCard style={styles.statCard}>
                            <Text style={styles.statLabel}>Today's P&L</Text>
                            <Text
                                style={[
                                    styles.statValue,
                                    portfolioData.todayPnL >= 0 ? styles.positive : styles.negative,
                                ]}
                            >
                                {portfolioData.todayPnL >= 0 ? '+' : ''}
                                {formatCurrency(portfolioData.todayPnL)}
                            </Text>
                        </GlassCard>
                        <GlassCard style={styles.statCard}>
                            <Text style={styles.statLabel}>Buying Power</Text>
                            <Text style={styles.statValue}>
                                {formatCurrency(portfolioData.buyingPower)}
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
                        <Text style={styles.sectionTitle}>Active Positions</Text>
                        {positions.map((position, index) => (
                            <TouchableOpacity
                                key={position.symbol}
                                style={[
                                    styles.positionRow,
                                    index < positions.length - 1 && styles.positionBorder,
                                ]}
                                onPress={() =>
                                    navigation.navigate('Charts', { symbol: position.symbol })
                                }
                            >
                                <Text style={styles.positionSymbol}>{position.symbol}</Text>
                                <View style={styles.sparklinePlaceholder} />
                                <Text
                                    style={[
                                        styles.positionChange,
                                        position.positive ? styles.positive : styles.negative,
                                    ]}
                                >
                                    {position.positive ? '+' : ''}
                                    {position.change.toFixed(1)}%
                                </Text>
                            </TouchableOpacity>
                        ))}
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
    sectionTitle: {
        ...typography.h4,
        padding: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
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
    positionSymbol: {
        ...typography.body,
        fontWeight: '600',
        flex: 1,
    },
    sparklinePlaceholder: {
        width: 60,
        height: 24,
        backgroundColor: colors.glassBg,
        borderRadius: 4,
        marginHorizontal: spacing.md,
    },
    positionChange: {
        ...typography.body,
        fontWeight: '600',
        textAlign: 'right',
        minWidth: 60,
    },
});

export default DashboardScreen;
