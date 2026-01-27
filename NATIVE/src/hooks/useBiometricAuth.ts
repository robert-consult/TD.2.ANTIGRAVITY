/**
 * TradeQuip Native - Biometric Authentication Hook
 * Face ID / Touch ID authentication for iOS
 */

import { useState, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';

interface BiometricState {
    isAvailable: boolean;
    biometryType: 'FaceID' | 'TouchID' | 'Biometrics' | null;
    isEnrolled: boolean;
}

interface UseBiometricAuthReturn {
    biometricState: BiometricState;
    isAuthenticating: boolean;
    authenticate: (promptMessage?: string) => Promise<boolean>;
    checkBiometricAvailability: () => Promise<void>;
    createKeys: () => Promise<string | null>;
    deleteKeys: () => Promise<boolean>;
    biometricKeysExist: () => Promise<boolean>;
}

const rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });

export const useBiometricAuth = (): UseBiometricAuthReturn => {
    const [biometricState, setBiometricState] = useState<BiometricState>({
        isAvailable: false,
        biometryType: null,
        isEnrolled: false,
    });
    const [isAuthenticating, setIsAuthenticating] = useState(false);

    // Check if biometrics are available
    const checkBiometricAvailability = useCallback(async () => {
        try {
            const { available, biometryType } = await rnBiometrics.isSensorAvailable();

            let type: BiometricState['biometryType'] = null;
            if (biometryType === BiometryTypes.FaceID) {
                type = 'FaceID';
            } else if (biometryType === BiometryTypes.TouchID) {
                type = 'TouchID';
            } else if (biometryType === BiometryTypes.Biometrics) {
                type = 'Biometrics';
            }

            setBiometricState({
                isAvailable: available,
                biometryType: type,
                isEnrolled: available,
            });
        } catch (error) {
            console.error('[Biometric] Error checking availability:', error);
            setBiometricState({
                isAvailable: false,
                biometryType: null,
                isEnrolled: false,
            });
        }
    }, []);

    // Check availability on mount
    useEffect(() => {
        checkBiometricAvailability();
    }, [checkBiometricAvailability]);

    // Authenticate user with biometrics
    const authenticate = useCallback(async (promptMessage?: string): Promise<boolean> => {
        if (!biometricState.isAvailable) {
            Alert.alert(
                'Biometrics Unavailable',
                'Biometric authentication is not available on this device.'
            );
            return false;
        }

        const biometricName = biometricState.biometryType === 'FaceID'
            ? 'Face ID'
            : biometricState.biometryType === 'TouchID'
                ? 'Touch ID'
                : 'Biometrics';

        setIsAuthenticating(true);

        try {
            const { success } = await rnBiometrics.simplePrompt({
                promptMessage: promptMessage || `Authenticate with ${biometricName}`,
                cancelButtonText: 'Cancel',
            });

            setIsAuthenticating(false);
            return success;
        } catch (error: any) {
            setIsAuthenticating(false);

            // User cancelled or other error
            if (error.message !== 'User cancellation') {
                console.error('[Biometric] Authentication error:', error);
            }
            return false;
        }
    }, [biometricState.isAvailable, biometricState.biometryType]);

    // Create biometric keys for secure storage
    const createKeys = useCallback(async (): Promise<string | null> => {
        try {
            const { publicKey } = await rnBiometrics.createKeys();
            return publicKey;
        } catch (error) {
            console.error('[Biometric] Error creating keys:', error);
            return null;
        }
    }, []);

    // Delete biometric keys
    const deleteKeys = useCallback(async (): Promise<boolean> => {
        try {
            const { keysDeleted } = await rnBiometrics.deleteKeys();
            return keysDeleted;
        } catch (error) {
            console.error('[Biometric] Error deleting keys:', error);
            return false;
        }
    }, []);

    // Check if biometric keys exist
    const biometricKeysExist = useCallback(async (): Promise<boolean> => {
        try {
            const { keysExist } = await rnBiometrics.biometricKeysExist();
            return keysExist;
        } catch (error) {
            console.error('[Biometric] Error checking keys:', error);
            return false;
        }
    }, []);

    return {
        biometricState,
        isAuthenticating,
        authenticate,
        checkBiometricAvailability,
        createKeys,
        deleteKeys,
        biometricKeysExist,
    };
};

export default useBiometricAuth;
