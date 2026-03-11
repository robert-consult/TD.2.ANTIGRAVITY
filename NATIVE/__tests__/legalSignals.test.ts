import {
    emitLegalReacceptRequired,
    subscribeLegalReaccept,
} from '../src/services/legalSignals';

describe('legal reaccept signals', () => {
    it('notifies subscribers and unsubscribes cleanly', () => {
        const handler = jest.fn();
        const unsubscribe = subscribeLegalReaccept(handler);

        emitLegalReacceptRequired({ code: 'LEGAL_REACCEPT_REQUIRED' });
        expect(handler).toHaveBeenCalledTimes(1);

        unsubscribe();
        emitLegalReacceptRequired({ code: 'LEGAL_REACCEPT_REQUIRED' });
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
