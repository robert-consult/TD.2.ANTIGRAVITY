type LegalReacceptListener = (payload: unknown) => void;

const listeners = new Set<LegalReacceptListener>();

export function emitLegalReacceptRequired(payload: unknown): void {
    for (const listener of Array.from(listeners)) {
        try {
            listener(payload);
        } catch {
            // Ignore listener failures so API handling keeps working.
        }
    }
}

export function subscribeLegalReaccept(listener: LegalReacceptListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
