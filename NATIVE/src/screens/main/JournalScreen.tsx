/**
 * TradeQuip Native - Journal Screen
 * Trading journal with mood tracking, tags, and trade linking
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TextInput,
    TouchableOpacity,
    Modal,
    Alert,
    ActivityIndicator,
    RefreshControl,
    ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Feather';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

import { colors, typography, spacing } from '../../theme';
import { Button } from '../../components/Button';
import { GlassCard } from '../../components/cards/GlassCard';
import api from '../../services/api';

interface JournalEntry {
    id: number;
    note: string;
    mood: string | null;
    tags: string | null;
    tradeId: number | null;
    tradeIds: string | null;
    createdAt: number | string | Date;
}

const MOOD_OPTIONS = [
    { value: 'confident', label: 'Confident', color: '#00E676' },
    { value: 'calm', label: 'Calm', color: '#2979FF' },
    { value: 'anxious', label: 'Anxious', color: '#FFD740' },
    { value: 'frustrated', label: 'Frustrated', color: '#FF9800' },
    { value: 'fearful', label: 'Fearful', color: '#FF5252' },
    { value: 'greedy', label: 'Greedy', color: '#9C27B0' },
    { value: 'neutral', label: 'Neutral', color: '#78909C' },
];

const TAG_OPTIONS = [
    { value: 'breakout', label: 'Breakout' },
    { value: 'trend-following', label: 'Trend Following' },
    { value: 'reversal', label: 'Reversal' },
    { value: 'scalp', label: 'Scalp' },
    { value: 'swing', label: 'Swing' },
    { value: 'lesson-learned', label: 'Lesson Learned' },
    { value: 'mistake', label: 'Mistake' },
    { value: 'profitable', label: 'Profitable' },
    { value: 'loss', label: 'Loss' },
];

const parseTags = (tags: string | null): string[] => {
    if (!tags) return [];
    try { return JSON.parse(tags) || []; } catch { return []; }
};

const parseTradeIds = (entry: JournalEntry): number[] => {
    if (entry.tradeIds) {
        try { const ids = JSON.parse(entry.tradeIds); if (Array.isArray(ids)) return ids; } catch { }
    }
    return entry.tradeId ? [entry.tradeId] : [];
};

const formatDate = (ts: unknown): string => {
    if (!ts) return 'Unknown';
    try {
        const ms = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : new Date(ts as string).getTime();
        return format(new Date(ms), 'MMM d, yyyy h:mm a');
    } catch { return 'Invalid date'; }
};

export const JournalScreen: React.FC = () => {
    const queryClient = useQueryClient();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editEntry, setEditEntry] = useState<JournalEntry | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [moodFilter, _setMoodFilter] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [selectedMood, setSelectedMood] = useState<string | null>(null);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedTradeIds, setSelectedTradeIds] = useState<number[]>([]);

    const { data: entries = [], isLoading, refetch, isRefetching } = useQuery<JournalEntry[]>({
        queryKey: ['journal'],
        queryFn: async () => (await api.get('/api/journal')).data,
    });

    const createMutation = useMutation({
        mutationFn: (data: any) => api.post('/api/journal', data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['journal'] }); closeModal(); Alert.alert('Success', 'Entry saved'); },
        onError: (e: any) => Alert.alert('Error', e?.message || 'Failed to create'),
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: number; data: any }) => api.put(`/api/journal/${id}`, data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['journal'] }); closeModal(); Alert.alert('Success', 'Entry updated'); },
        onError: (e: any) => Alert.alert('Error', e?.message || 'Failed to update'),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => api.delete(`/api/journal/${id}`),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['journal'] }); Alert.alert('Deleted', 'Entry removed'); },
        onError: (e: any) => Alert.alert('Error', e?.message || 'Failed to delete'),
    });

    const closeModal = () => {
        setIsModalOpen(false); setEditEntry(null);
        setNote(''); setSelectedMood(null); setSelectedTags([]); setSelectedTradeIds([]);
    };

    const openEditModal = (entry: JournalEntry) => {
        setEditEntry(entry); setNote(entry.note); setSelectedMood(entry.mood);
        setSelectedTags(parseTags(entry.tags)); setSelectedTradeIds(parseTradeIds(entry));
        setIsModalOpen(true);
    };

    const handleSave = () => {
        if (note.trim().length < 3) { Alert.alert('Error', 'Note must be at least 3 characters'); return; }
        const data = { note: note.trim(), mood: selectedMood, tags: selectedTags.length ? selectedTags : null, tradeIds: selectedTradeIds.length ? selectedTradeIds : null };
        editEntry ? updateMutation.mutate({ id: editEntry.id, data }) : createMutation.mutate(data);
    };

    const handleDelete = (entry: JournalEntry) => {
        Alert.alert('Delete', 'Delete this entry?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(entry.id) },
        ]);
    };

    const getMoodColor = (m: string | null) => MOOD_OPTIONS.find(o => o.value === m)?.color || colors.textMuted;
    const getMoodLabel = (m: string | null) => MOOD_OPTIONS.find(o => o.value === m)?.label || 'No mood';

    const filteredEntries = entries.filter(e => {
        const matchSearch = !searchQuery || e.note.toLowerCase().includes(searchQuery.toLowerCase());
        const matchMood = !moodFilter || e.mood === moodFilter;
        return matchSearch && matchMood;
    });

    const renderEntry = ({ item }: { item: JournalEntry }) => (
        <GlassCard style={styles.entryCard}>
            <View style={styles.entryHeader}>
                <View style={styles.entryMeta}>
                    <Icon name="calendar" size={14} color={colors.textMuted} />
                    <Text style={styles.entryDate}>{formatDate(item.createdAt)}</Text>
                    {item.mood && (
                        <View style={[styles.moodBadge, { backgroundColor: getMoodColor(item.mood) + '25' }]}>
                            <View style={[styles.moodDot, { backgroundColor: getMoodColor(item.mood) }]} />
                            <Text style={[styles.moodText, { color: getMoodColor(item.mood) }]}>{getMoodLabel(item.mood)}</Text>
                        </View>
                    )}
                </View>
                <View style={styles.entryActions}>
                    <TouchableOpacity onPress={() => openEditModal(item)}><Icon name="edit-2" size={16} color={colors.accent} /></TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(item)}><Icon name="trash-2" size={16} color={colors.error} /></TouchableOpacity>
                </View>
            </View>
            <Text style={styles.entryNote}>{item.note}</Text>
            {item.tags && <View style={styles.tagsContainer}>{parseTags(item.tags).map(t => <View key={t} style={styles.tagBadge}><Text style={styles.tagText}>{t}</Text></View>)}</View>}
        </GlassCard>
    );

    return (
        <LinearGradient colors={[colors.bgPrimary, colors.bgSecondary]} style={styles.container}>
            <SafeAreaView style={styles.safeArea} edges={['top']}>
                <View style={styles.header}>
                    <View style={styles.headerLeft}>
                        <Icon name="book-open" size={24} color={colors.accent} />
                        <View>
                            <Text style={styles.headerTitle}>Trading Journal</Text>
                            <Text style={styles.headerSubtitle}>Track your thoughts</Text>
                        </View>
                    </View>
                    <TouchableOpacity style={styles.addButton} onPress={() => setIsModalOpen(true)}>
                        <Icon name="plus" size={20} color={colors.bgPrimary} />
                    </TouchableOpacity>
                </View>

                <View style={styles.searchContainer}>
                    <View style={styles.searchInputContainer}>
                        <Icon name="search" size={18} color={colors.textMuted} />
                        <TextInput style={styles.searchInput} placeholder="Search..." placeholderTextColor={colors.textMuted} value={searchQuery} onChangeText={setSearchQuery} />
                    </View>
                </View>

                {isLoading ? <ActivityIndicator size="large" color={colors.accent} style={styles.loading} /> : (
                    <FlatList
                        data={filteredEntries}
                        keyExtractor={i => i.id.toString()}
                        renderItem={renderEntry}
                        contentContainerStyle={styles.listContent}
                        ListEmptyComponent={<View style={styles.empty}><Icon name="book-open" size={48} color={colors.textMuted} /><Text style={styles.emptyTitle}>No entries yet</Text><Button title="Create First Entry" onPress={() => setIsModalOpen(true)} /></View>}
                        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
                    />
                )}

                <Modal visible={isModalOpen} animationType="slide" transparent onRequestClose={closeModal}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>{editEntry ? 'Edit Entry' : 'New Entry'}</Text>
                                <TouchableOpacity onPress={closeModal}><Icon name="x" size={24} color={colors.textPrimary} /></TouchableOpacity>
                            </View>
                            <ScrollView style={styles.modalBody}>
                                <Text style={styles.inputLabel}>Your thoughts</Text>
                                <TextInput style={styles.noteInput} placeholder="What happened?" placeholderTextColor={colors.textMuted} value={note} onChangeText={setNote} multiline numberOfLines={4} />

                                <Text style={styles.inputLabel}>Mood</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                    {MOOD_OPTIONS.map(m => (
                                        <TouchableOpacity key={m.value} style={[styles.moodOption, selectedMood === m.value && styles.moodOptionSelected]} onPress={() => setSelectedMood(m.value)}>
                                            <View style={[styles.moodDot, { backgroundColor: m.color }]} />
                                            <Text style={styles.moodOptionText}>{m.label}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>

                                <Text style={styles.inputLabel}>Tags</Text>
                                <View style={styles.tagsGrid}>
                                    {TAG_OPTIONS.map(t => (
                                        <TouchableOpacity key={t.value} style={[styles.tagOption, selectedTags.includes(t.value) && styles.tagOptionSelected]} onPress={() => setSelectedTags(p => p.includes(t.value) ? p.filter(x => x !== t.value) : [...p, t.value])}>
                                            <Text style={[styles.tagOptionText, selectedTags.includes(t.value) && styles.tagOptionTextSelected]}>{t.label}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </ScrollView>
                            <View style={styles.modalFooter}>
                                <Button title="Cancel" variant="outline" onPress={closeModal} style={styles.footerButton} />
                                <Button title={createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'} onPress={handleSave} style={styles.footerButton} />
                            </View>
                        </View>
                    </View>
                </Modal>
            </SafeAreaView>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    headerTitle: { ...typography.h2, color: colors.textPrimary },
    headerSubtitle: { ...typography.caption, color: colors.textSecondary },
    addButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    searchContainer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    searchInputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.glassBg, borderRadius: 12, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.glassBorder },
    searchInput: { flex: 1, ...typography.body, color: colors.textPrimary, paddingVertical: spacing.sm, marginLeft: spacing.sm },
    loading: { flex: 1 },
    listContent: { padding: spacing.lg, paddingTop: 0 },
    entryCard: { marginBottom: spacing.md, padding: spacing.md },
    entryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
    entryMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
    entryDate: { ...typography.caption, color: colors.textSecondary },
    entryActions: { flexDirection: 'row', gap: spacing.sm },
    moodBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 12, gap: 4 },
    moodDot: { width: 8, height: 8, borderRadius: 4 },
    moodText: { ...typography.caption, fontWeight: '600' },
    entryNote: { ...typography.body, color: colors.textPrimary },
    tagsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
    tagBadge: { backgroundColor: colors.glassBg, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 12, borderWidth: 1, borderColor: colors.glassBorder },
    tagText: { ...typography.caption, color: colors.textSecondary },
    empty: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
    emptyTitle: { ...typography.h3, color: colors.textPrimary, marginVertical: spacing.md },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
    modalContent: { backgroundColor: colors.bgSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
    modalTitle: { ...typography.h3, color: colors.textPrimary },
    modalBody: { padding: spacing.lg },
    inputLabel: { ...typography.bodyBold, color: colors.textPrimary, marginBottom: spacing.xs, marginTop: spacing.md },
    noteInput: { backgroundColor: colors.glassBg, borderRadius: 12, padding: spacing.md, ...typography.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.glassBorder, minHeight: 100, textAlignVertical: 'top' },
    moodOption: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 20, backgroundColor: colors.glassBg, marginRight: spacing.xs, borderWidth: 1, borderColor: colors.glassBorder },
    moodOptionSelected: { backgroundColor: colors.accentGlow, borderColor: colors.accent },
    moodOptionText: { ...typography.caption, color: colors.textPrimary },
    tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    tagOption: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 16, backgroundColor: colors.glassBg, borderWidth: 1, borderColor: colors.glassBorder },
    tagOptionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    tagOptionText: { ...typography.caption, color: colors.textSecondary },
    tagOptionTextSelected: { color: colors.bgPrimary, fontWeight: '600' },
    modalFooter: { flexDirection: 'row', padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.md },
    footerButton: { flex: 1 },
});

export default JournalScreen;
