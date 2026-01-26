/**
 * TradeQuip Android - Input Component
 * Styled text input with dark theme
 */

import React, { useState } from 'react';
import {
    View,
    TextInput as RNTextInput,
    Text,
    StyleSheet,
    TextInputProps,
    TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { colors, typography, spacing } from '../../theme';

interface InputProps extends TextInputProps {
    label?: string;
    error?: string;
    leftIcon?: string;
    rightIcon?: string;
    onRightIconPress?: () => void;
}

export const Input: React.FC<InputProps> = ({
    label,
    error,
    leftIcon,
    rightIcon,
    onRightIconPress,
    secureTextEntry,
    style,
    ...props
}) => {
    const [isFocused, setIsFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const isPassword = secureTextEntry !== undefined;

    return (
        <View style={styles.container}>
            {label && <Text style={styles.label}>{label}</Text>}

            <View
                style={[
                    styles.inputContainer,
                    isFocused && styles.inputFocused,
                    error && styles.inputError,
                ]}
            >
                {leftIcon && (
                    <Icon
                        name={leftIcon}
                        size={20}
                        color={colors.textMuted}
                        style={styles.leftIcon}
                    />
                )}

                <RNTextInput
                    style={[styles.input, style]}
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    secureTextEntry={isPassword && !showPassword}
                    {...props}
                />

                {isPassword && (
                    <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                        style={styles.rightIcon}
                    >
                        <Icon
                            name={showPassword ? 'eye-off' : 'eye'}
                            size={20}
                            color={colors.textMuted}
                        />
                    </TouchableOpacity>
                )}

                {rightIcon && !isPassword && (
                    <TouchableOpacity
                        onPress={onRightIconPress}
                        style={styles.rightIcon}
                    >
                        <Icon name={rightIcon} size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                )}
            </View>

            {error && <Text style={styles.error}>{error}</Text>}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: spacing.md,
    },
    label: {
        ...typography.label,
        marginBottom: spacing.xs,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.25)',
        borderRadius: spacing.inputRadius,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
    },
    inputFocused: {
        borderColor: colors.accent,
        shadowColor: colors.accent,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 2,
    },
    inputError: {
        borderColor: colors.error,
    },
    input: {
        flex: 1,
        height: 50,
        ...typography.body,
        color: colors.textPrimary,
    },
    leftIcon: {
        marginRight: spacing.sm,
    },
    rightIcon: {
        marginLeft: spacing.sm,
        padding: spacing.xs,
    },
    error: {
        ...typography.bodySmall,
        color: colors.error,
        marginTop: spacing.xs,
    },
});

export default Input;
