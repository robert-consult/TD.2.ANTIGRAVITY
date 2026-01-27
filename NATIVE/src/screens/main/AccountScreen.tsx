/**
 * TradeQuip Android - Account Settings Screen
 * Based on mockup: account_revised.png
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Image,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';

import { colors, typography, spacing } from '../../theme';

const settingsItems = [
    { id: 'personal', icon: 'user', label: 'Personal Info', screen: 'ProfileSettings' },
    { id: 'journal', icon: 'book', label: 'Trading Journal', screen: 'Journal' },
    { id: 'security', icon: 'shield', label: 'Security & Password', screen: 'ProfileSettings' },
    { id: 'notifications', icon: 'bell', label: 'Notifications', screen: 'ProfileSettings' },
    { id: 'data', icon: 'database', label: 'Data Usage', screen: 'DataUsage' },
    { id: 'payment', icon: 'credit-card', label: 'Payment Methods', screen: 'PaymentMethods' },
    { id: 'support', icon: 'help-circle', label: 'Support & Feedback', screen: 'Support' },
];

interface AccountScreenProps {
    navigation: any;
}

const SettingsListItem = ({
    icon,
    label,
    onPress,
}: {
    icon: string;
    label: string;
    onPress: () => void;
}) => (
    <TouchableOpacity style={styles.settingsItem} onPress={onPress} activeOpacity={0.7}>
        <View style={styles.settingsItemLeft}>
            <View style={styles.iconContainer}>
                <Icon name={icon} size={20} color={colors.accent} />
            </View>
            <Text style={styles.settingsLabel}>{label}</Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>
);

export const AccountScreen: React.FC<AccountScreenProps> = ({ navigation }) => {
    const user = {
        name: 'Alex Chen',
        email: 'alexchen@gmail.com',
        avatar: null,
    };

    const handleSignOut = () => {
        // TODO: Implement sign out
        console.log('Sign out');
    };

    return (
        <LinearGradient
            colors={[colors.bgPrimary, colors.bgSecondary]}
            style={styles.gradient}
        >
            <SafeAreaView style={styles.container} edges={['top']}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity style={styles.menuButton}>
                        <Icon name="menu" size={24} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Account Settings</Text>
                    <Text style={styles.logoSmall}>TradeQuip</Text>
                </View>

                <ScrollView
                    style={styles.content}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Profile Section */}
                    <Text style={styles.sectionTitle}>Profile</Text>
                    <View style={styles.profileCard}>
                        <View style={styles.avatarContainer}>
                            {user.avatar ? (
                                <Image source={{ uri: user.avatar }} style={styles.avatar} />
                            ) : (
                                <View style={styles.avatarPlaceholder}>
                                    <Icon name="user" size={32} color={colors.textSecondary} />
                                </View>
                            )}
                        </View>
                        <View style={styles.profileInfo}>
                            <Text style={styles.profileName}>{user.name}</Text>
                            <Text style={styles.profileEmail}>{user.email}</Text>
                        </View>
                        <TouchableOpacity style={styles.editButton}>
                            <Icon name="edit-2" size={18} color={colors.accent} />
                        </TouchableOpacity>
                    </View>

                    {/* Settings List */}
                    <View style={styles.settingsList}>
                        {settingsItems.map((item) => (
                            <SettingsListItem
                                key={item.id}
                                icon={item.icon}
                                label={item.label}
                                onPress={() => navigation.navigate(item.screen)}
                            />
                        ))}
                    </View>

                    {/* Sign Out Button */}
                    <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
                        <Icon name="log-out" size={20} color={colors.error} />
                        <Text style={styles.signOutText}>Sign Out</Text>
                    </TouchableOpacity>

                    {/* App Version */}
                    <Text style={styles.versionText}>TradeQuip v1.0.0</Text>
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
    menuButton: {
        padding: spacing.xs,
    },
    headerTitle: {
        ...typography.h4,
        color: colors.textPrimary,
    },
    logoSmall: {
        ...typography.bodySmall,
        color: colors.accent,
        fontWeight: '600',
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: spacing.screenPadding,
        paddingBottom: spacing.tabBarHeight + spacing.xl,
    },
    sectionTitle: {
        ...typography.h4,
        color: colors.textPrimary,
        marginBottom: spacing.md,
    },
    profileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.bgCard,
        borderRadius: spacing.cardRadiusSmall,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
        marginBottom: spacing.lg,
    },
    avatarContainer: {
        marginRight: spacing.md,
    },
    avatar: {
        width: 56,
        height: 56,
        borderRadius: 28,
    },
    avatarPlaceholder: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.glassBg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
    },
    profileInfo: {
        flex: 1,
    },
    profileName: {
        ...typography.body,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    profileEmail: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        marginTop: 2,
    },
    editButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.glassBg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    settingsList: {
        gap: spacing.sm,
        marginBottom: spacing.xl,
    },
    settingsItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.bgCard,
        borderRadius: spacing.cardRadiusSmall,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
    },
    settingsItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 10,
        backgroundColor: 'rgba(0, 229, 255, 0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    settingsLabel: {
        ...typography.body,
        color: colors.textPrimary,
    },
    signOutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        marginBottom: spacing.lg,
    },
    signOutText: {
        ...typography.body,
        color: colors.error,
        fontWeight: '600',
    },
    versionText: {
        ...typography.bodySmall,
        color: colors.textMuted,
        textAlign: 'center',
    },
});

export default AccountScreen;
