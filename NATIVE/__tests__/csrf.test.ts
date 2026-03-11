import {
    isCsrfFailurePayload,
    shouldAttachCsrfHeader,
} from '../src/services/csrf';

describe('native csrf helpers', () => {
    it('attaches CSRF only to mutating API requests', () => {
        expect(shouldAttachCsrfHeader('https://tradehub.example.com', '/api/trades', 'POST')).toBe(true);
        expect(shouldAttachCsrfHeader('https://tradehub.example.com', '/api/profile/preferences', 'PUT')).toBe(true);
        expect(shouldAttachCsrfHeader('https://tradehub.example.com', '/api/auth/current-user', 'GET')).toBe(false);
        expect(shouldAttachCsrfHeader('https://tradehub.example.com', '/ws', 'POST')).toBe(false);
        expect(shouldAttachCsrfHeader('https://tradehub.example.com', 'https://example.com/health', 'POST')).toBe(false);
    });

    it('recognizes the shared CSRF failure payload code', () => {
        expect(isCsrfFailurePayload({ code: 'CSRF_TOKEN_INVALID' })).toBe(true);
        expect(isCsrfFailurePayload({ code: 'OTHER' })).toBe(false);
        expect(isCsrfFailurePayload(null)).toBe(false);
    });
});
