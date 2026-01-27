/**
 * TradeQuip Native - Profile Settings Screen
 * User profile, security settings, preferences
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    TouchableOpacity,
    Alert,
    Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';

import { colors, typography, spacing } from '../../theme';
import { Button } from '../../components/Button';
import { GlassCard } from '../../components/cards/GlassCard';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';

type Section = 'profile' | 'security' | 'preferences';

const SECTIONS = [
    { key: 'profile' as Section, label: 'Profile', icon: 'user' },
    { key: 'security' as Section, label: 'Security', icon: 'shield' },
    { key: 'preferences' as Section, label: 'Preferences', icon: 'settings' },
];

export const ProfileSettingsScreen: React.FC = () => {
    const navigation = useNavigation();
    const queryClient = useQueryClient();
    const { user, logout, checkAuth } = useAuth();
    const [activeSection, setActiveSection] = useState<Section>('profile');

    // Profile form
    const [username, setUsername] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');

    // Password form
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswords, setShowPasswords] = useState(false);

    // Preferences
    const [notifications, setNotifications] = useState({
        tradeExecuted: true,
        marginWarning: true,
        stopLossHit: true,
        dailySummary: false,
    });

    useEffect(() => {
        if (user) {
            setUsername(user.username || '');
            setName(user.name || '');
            setPhone(user.phone || '');
        }
    }, [user]);

    // MFA Status
    const { data: mfaStatus } = useQuery({
        queryKey: ['mfa-status'],
        queryFn: async () => {
            const res = await api.get('/api/profile/mfa/status');
            return res.data;
        },
    });

    // Profile update mutation
    const profileMutation = useMutation({
        mutationFn: async (data: { username: string; name: string; phone: string }) => {
            const res = await api.post('/api/profile/update', data);
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['current-user'] });
            checkAuth();
            Alert.alert('Success', 'Profile updated');
        },
        onError: (e: any) => Alert.alert('Error', e?.message || 'Failed to update profile'),
    });

    // Password change mutation
    const passwordMutation = useMutation({
        mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
            const res = await api.post('/api/profile/change-password', data);
            return res.data;
        },
        onSuccess: () => {
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            Alert.alert('Success', 'Password changed');
        },
        onError: (e: any) => Alert.alert('Error', e?.message || 'Failed to change password'),
    });

    const handleProfileSave = () => {
        if (!username.trim()) {
            Alert.alert('Error', 'Username is required');
            return;
        }
        profileMutation.mutate({ username: username.trim(), name: name.trim(), phone: phone.trim() });
    };

    const handlePasswordChange = () => {
        if (!currentPassword || !newPassword || !confirmPassword) {
            Alert.alert('Error', 'All password fields are required');
            return;
        }
        if (newPassword !== confirmPassword) {
            Alert.alert('Error', 'New passwords do not match');
            return;
        }
        if (newPassword.length < 8) {
            Alert.alert('Error', 'Password must be at least 8 characters');
            return;
        }
        passwordMutation.mutate({ currentPassword, newPassword });
    };

    const handleLogout = () => {
        Alert.alert('Logout', 'Are you sure you want to logout?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Logout', style: 'destructive', onPress: () => logout() },
        ]);
    };

    const renderProfileSection = () => (
        <View style={styles.section}>
            <GlassCard style={styles.card}>
                <Text style={styles.cardTitle}>Personal Information</Text>

                <Text style={styles.inputLabel}>Username</Text>
                <TextInput
                    style={styles.input}
                    value={username}
                    onChangeText={setUsername}
                    placeholder="Username"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                />

                <Text style={styles.inputLabel}>Full Name</Text>
                <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Full Name"
                    placeholderTextColor={colors.textMuted}
                />

                <Text style={styles.inputLabel}>Phone</Text>
                <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="Phone Number"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="phone-pad"
                />

                <Text style={styles.inputLabel}>Email</Text>
                <View style={styles.readOnlyField}>
                    <Icon name="mail" size={16} color={colors.textMuted} />
                    <Text style={styles.readOnlyText}>{user?.email || 'Not set'}</Text>
                    {user?.emailVerified && <Icon name="check-circle" size={16} color={colors.success} />}
                </View>

                <Button
                    title={profileMutation.isPending ? 'Saving...' : 'Save Profile'}
                    onPress={handleProfileSave}
                    disabled={profileMutation.isPending}
                    style={styles.saveButton}
                />
            </GlassCard>
        </View>
    );

    const renderSecuritySection = () => (
        <View style={styles.section}>
            <GlassCard style={styles.card}>
                <Text style={styles.cardTitle}>Change Password</Text>

                <Text style={styles.inputLabel}>Current Password</Text>
                <View style={styles.passwordContainer}>
                    <TextInput
                        style={styles.passwordInput}
                        value={currentPassword}
                        onChangeText={setCurrentPassword}
                        placeholder="Current password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showPasswords}
                    />
                    <TouchableOpacity onPress={() => setShowPasswords(!showPasswords)}>
                        <Icon name={showPasswords ? 'eye-off' : 'eye'} size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                </View>

                <Text style={styles.inputLabel}>New Password</Text>
                <TextInput
                    style={styles.input}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="New password (min 8 chars)"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!showPasswords}
                />

                <Text style={styles.inputLabel}>Confirm New Password</Text>
                <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm new password"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!showPasswords}
                />

                <Button
                    title={passwordMutation.isPending ? 'Changing...' : 'Change Password'}
                    onPress={handlePasswordChange}
                    disabled={passwordMutation.isPending}
                    style={styles.saveButton}
                />
            </GlassCard>

            <GlassCard style={styles.card}>
                <Text style={styles.cardTitle}>Two-Factor Authentication</Text>
                <View style={styles.mfaStatus}>
                    <View style={styles.mfaInfo}>
                        <Icon name="shield" size={20} color={mfaStatus?.enabled ? colors.success : colors.textMuted} />
                        <Text style={styles.mfaText}>
                            {mfaStatus?.enabled ? '2FA is enabled' : '2FA is not enabled'}
                        </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: mfaStatus?.enabled ? colors.successLight : colors.errorLight }]}>
                        <Text style={[styles.statusText, { color: mfaStatus?.enabled ? colors.success : colors.error }]}>
                            {mfaStatus?.enabled ? 'Active' : 'Inactive'}
                        </Text>
                    </View>
                </View>
                <Text style={styles.mfaHint}>
                    {mfaStatus?.enabled
                        ? 'Your account is protected with two-factor authentication'
                        : 'Enable 2FA to add an extra layer of security'}
                </Text>
            </GlassCard>
        </View>
    );

    const renderPreferencesSection = () => (
        <View style={styles.section}>
            <GlassCard style={styles.card}>
                <Text style={styles.cardTitle}>Notifications</Text>

                <View style={styles.switchRow}>
                    <View style={styles.switchInfo}>
                        <Text style={styles.switchLabel}>Trade Executed</Text>
                        <Text style={styles.switchHint}>Get notified when trades are executed</Text>
                    </View>
                    <Switch
                        value={notifications.tradeExecuted}
                        onValueChange={(v) => setNotifications(p => ({ ...p, tradeExecuted: v }))}
                        trackColor={{ false: colors.glassBg, true: colors.accent }}
                        thumbColor={colors.textPrimary}
                    />
                </View>

                <View style={styles.switchRow}>
                    <View style={styles.switchInfo}>
                        <Text style={styles.switchLabel}>Margin Warning</Text>
                        <Text style={styles.switchHint}>Alert when margin level is low</Text>
                    </View>
                    <Switch
                        value={notifications.marginWarning}
                        onValueChange={(v) => setNotifications(p => ({ ...p, marginWarning: v }))}
                        trackColor={{ false: colors.glassBg, true: colors.accent }}
                        thumbColor={colors.textPrimary}
                    />
                </View>

                <View style={styles.switchRow}>
                    <View style={styles.switchInfo}>
                        <Text style={styles.switchLabel}>Stop Loss Hit</Text>
                        <Text style={styles.switchHint}>Notify when stop loss triggers</Text>
                    </View>
                    <Switch
                        value={notifications.stopLossHit}
                        onValueChange={(v) => setNotifications(p => ({ ...p, stopLossHit: v }))}
                        trackColor={{ false: colors.glassBg, true: colors.accent }}
                        thumbColor={colors.textPrimary}
                    />
                </View>

                <View style={styles.switchRow}>
                    <View style={styles.switchInfo}>
                        <Text style={styles.switchLabel}>Daily Summary</Text>
                        <Text style={styles.switchHint}>Receive daily trading summary</Text>
                    </View>
                    <Switch
                        value={notifications.dailySummary}
                        onValueChange={(v) => setNotifications(p => ({ ...p, dailySummary: v }))}
                        trackColor={{ false: colors.glassBg, true: colors.accent }}
                        thumbColor={colors.textPrimary}
                    />
                </View>
            </GlassCard>

            <GlassCard style={styles.card}>
                <Text style={styles.cardTitle}>Account Actions</Text>
                <TouchableOpacity style={styles.dangerButton} onPress={handleLogout}>
                    <Icon name="log-out" size={20} color={colors.error} />
                    <Text style={styles.dangerButtonText}>Logout</Text>
                </TouchableOpacity>
            </GlassCard>
        </View>
    );

    return (
        <LinearGradient colors={[colors.bgPrimary, colors.bgSecondary]} style={styles.container}>
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                        <Icon name="arrow-left" size={24} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <View>
                        <Text style={styles.headerTitle}>Profile Settings</Text>
                        <Text style={styles.headerSubtitle}>Manage your account</Text>
                    </View>
                </View>

                <View style={styles.tabsContainer}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {SECTIONS.map(s => (
                            <TouchableOpacity
                                key={s.key}
                                style={[styles.tab, activeSection === s.key && styles.tabActive]}
                                onPress={() => setActiveSection(s.key)}
                            >
                                <Icon name={s.icon} size={16} color={activeSection === s.key ? colors.accent : colors.textMuted} />
                                <Text style={[styles.tabText, activeSection === s.key && styles.tabTextActive]}>{s.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>

                <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
                    {activeSection === 'profile' && renderProfileSection()}
                    {activeSection === 'security' && renderSecuritySection()}
                    {activeSection === 'preferences' && renderPreferencesSection()}
                </ScrollView>
            </SafeAreaView>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
    backButton: { padding: spacing.xs },
    headerTitle: { ...typography.h2, color: colors.textPrimary },
    headerSubtitle: { ...typography.caption, color: colors.textSecondary },
    tabsContainer: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
    tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginRight: spacing.sm, borderRadius: 20, backgroundColor: colors.glassBg, borderWidth: 1, borderColor: colors.glassBorder, gap: spacing.xs },
    tabActive: { backgroundColor: colors.accentGlow, borderColor: colors.accent },
    tabText: { ...typography.caption, color: colors.textMuted },
    tabTextActive: { color: colors.accent },
    content: { flex: 1 },
    contentContainer: { padding: spacing.lg, paddingTop: 0 },
    section: { gap: spacing.md },
    card: { padding: spacing.lg },
    cardTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
    inputLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
    input: { backgroundColor: colors.glassBg, borderRadius: 12, padding: spacing.md, ...typography.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.glassBorder },
    passwordContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.glassBg, borderRadius: 12, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.glassBorder },
    passwordInput: { flex: 1, ...typography.body, color: colors.textPrimary, paddingVertical: spacing.md },
    readOnlyField: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.glassBg, borderRadius: 12, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.glassBorder },
    readOnlyText: { ...typography.body, color: colors.textSecondary, flex: 1 },
    saveButton: { marginTop: spacing.lg },
    mfaStatus: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    mfaInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    mfaText: { ...typography.body, color: colors.textPrimary },
    statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 12 },
    statusText: { ...typography.caption, fontWeight: '600' },
    mfaHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    switchInfo: { flex: 1 },
    switchLabel: { ...typography.body, color: colors.textPrimary },
    switchHint: { ...typography.caption, color: colors.textMuted },
    dangerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: colors.error, gap: spacing.sm },
    dangerButtonText: { ...typography.bodyBold, color: colors.error },
});

export default ProfileSettingsScreen;
