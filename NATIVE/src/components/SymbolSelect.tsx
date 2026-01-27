/**
 * TradeQuip Native - Symbol Select Component
 * Searchable dropdown for trading symbols
 */

import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    FlatList,
    Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { colors, typography, spacing } from '../theme';

interface Symbol {
    symbol: string;
    name?: string;
    category?: string;
}

interface SymbolSelectProps {
    symbols: Symbol[];
    selectedSymbol?: string;
    onSelect: (symbol: Symbol) => void;
    placeholder?: string;
    disabled?: boolean;
}

export const SymbolSelect: React.FC<SymbolSelectProps> = ({
    symbols,
    selectedSymbol,
    onSelect,
    placeholder = 'Select symbol',
    disabled = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredSymbols = useMemo(() => {
        if (!searchQuery.trim()) return symbols;
        const q = searchQuery.toLowerCase();
        return symbols.filter(
            (s) =>
                s.symbol.toLowerCase().includes(q) ||
                s.name?.toLowerCase().includes(q) ||
                s.category?.toLowerCase().includes(q)
        );
    }, [symbols, searchQuery]);

    const selectedItem = symbols.find((s) => s.symbol === selectedSymbol);

    const handleSelect = (symbol: Symbol) => {
        onSelect(symbol);
        setIsOpen(false);
        setSearchQuery('');
    };

    const renderItem = ({ item }: { item: Symbol }) => (
        <TouchableOpacity
            style={[styles.item, item.symbol === selectedSymbol && styles.itemSelected]}
            onPress={() => handleSelect(item)}
        >
            <Text style={styles.itemSymbol}>{item.symbol}</Text>
            {item.name && <Text style={styles.itemName}>{item.name}</Text>}
            {item.category && (
                <View style={styles.categoryBadge}>
                    <Text style={styles.categoryText}>{item.category}</Text>
                </View>
            )}
            {item.symbol === selectedSymbol && (
                <Icon name="check" size={18} color={colors.accent} />
            )}
        </TouchableOpacity>
    );

    return (
        <>
            <TouchableOpacity
                style={[styles.trigger, disabled && styles.triggerDisabled]}
                onPress={() => !disabled && setIsOpen(true)}
                disabled={disabled}
            >
                <Text style={[styles.triggerText, !selectedItem && styles.placeholder]}>
                    {selectedItem?.symbol || placeholder}
                </Text>
                <Icon name="chevron-down" size={20} color={colors.textMuted} />
            </TouchableOpacity>

            <Modal
                visible={isOpen}
                animationType="slide"
                transparent
                onRequestClose={() => setIsOpen(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Select Symbol</Text>
                            <TouchableOpacity onPress={() => setIsOpen(false)}>
                                <Icon name="x" size={24} color={colors.textPrimary} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.searchContainer}>
                            <Icon name="search" size={18} color={colors.textMuted} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder="Search symbols..."
                                placeholderTextColor={colors.textMuted}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                autoCapitalize="characters"
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => setSearchQuery('')}>
                                    <Icon name="x" size={16} color={colors.textMuted} />
                                </TouchableOpacity>
                            )}
                        </View>

                        <FlatList
                            data={filteredSymbols}
                            keyExtractor={(item) => item.symbol}
                            renderItem={renderItem}
                            style={styles.list}
                            ListEmptyComponent={
                                <View style={styles.empty}>
                                    <Text style={styles.emptyText}>No symbols found</Text>
                                </View>
                            }
                        />
                    </View>
                </View>
            </Modal>
        </>
    );
};

const styles = StyleSheet.create({
    trigger: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.glassBg,
        borderRadius: 12,
        padding: spacing.md,
        borderWidth: 1,
        borderColor: colors.glassBorder,
    },
    triggerDisabled: {
        opacity: 0.5,
    },
    triggerText: {
        ...typography.body,
        color: colors.textPrimary,
    },
    placeholder: {
        color: colors.textMuted,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: colors.bgSecondary,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '80%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    modalTitle: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.glassBg,
        borderRadius: 12,
        marginHorizontal: spacing.lg,
        marginVertical: spacing.md,
        paddingHorizontal: spacing.md,
        borderWidth: 1,
        borderColor: colors.glassBorder,
    },
    searchInput: {
        flex: 1,
        ...typography.body,
        color: colors.textPrimary,
        paddingVertical: spacing.sm,
        marginLeft: spacing.sm,
    },
    list: {
        paddingHorizontal: spacing.lg,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        borderRadius: 8,
        marginBottom: spacing.xs,
    },
    itemSelected: {
        backgroundColor: colors.accentGlow,
    },
    itemSymbol: {
        ...typography.bodyBold,
        color: colors.textPrimary,
        minWidth: 80,
    },
    itemName: {
        ...typography.body,
        color: colors.textSecondary,
        flex: 1,
        marginLeft: spacing.sm,
    },
    categoryBadge: {
        backgroundColor: colors.glassBg,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: 8,
        marginRight: spacing.sm,
    },
    categoryText: {
        ...typography.caption,
        color: colors.textMuted,
    },
    empty: {
        padding: spacing.xl,
        alignItems: 'center',
    },
    emptyText: {
        ...typography.body,
        color: colors.textMuted,
    },
});

export default SymbolSelect;
