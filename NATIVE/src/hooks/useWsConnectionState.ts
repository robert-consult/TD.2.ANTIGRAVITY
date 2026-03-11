import { useEffect, useState } from 'react';
import { wsService } from '../services/websocket';

export function useWsConnectionState(): boolean {
    const [isConnected, setIsConnected] = useState<boolean>(wsService.isConnected());

    useEffect(() => {
        const unsubscribeConnect = wsService.onConnect(() => {
            setIsConnected(true);
        });

        const unsubscribeDisconnect = wsService.onDisconnect(() => {
            setIsConnected(false);
        });

        setIsConnected(wsService.isConnected());

        return () => {
            unsubscribeConnect();
            unsubscribeDisconnect();
        };
    }, []);

    return isConnected;
}

export default useWsConnectionState;
