import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrderForm } from './OrderForm';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/hooks/use-lot-settings', () => ({
    useLotSettings: () => ({
        lotDropdownOptions: [1, 2, 3, 4, 5, 10, 25, 50],
        lotPresetCards: [1, 5, 10, 25, 50],
        minPriceDistancePips: 20,
    }),
}));

describe('OrderForm', () => {
    const defaultProps = {
        selectedSymbol: 'EURUSD',
        currentPrice: 1.1000,
        onPlaceOrder: vi.fn(),
    };

    it('renders correctly with default props', () => {
        render(<OrderForm {...defaultProps} />);
        expect(screen.getByText('Order Type')).toBeInTheDocument();
        expect(screen.getByText('Market')).toBeInTheDocument();
    });

    it('validates lots input', async () => {
        render(<OrderForm {...defaultProps} />);
        const lotsSelect = screen.getByRole('combobox'); // Select trigger shows default value
        expect(lotsSelect).toHaveTextContent('1');
    });

    it('calculates auto-stop/limit prices', async () => {
        render(<OrderForm {...defaultProps} />);

        // switch to Limit
        const limitBtn = screen.getByText('Limit');
        fireEvent.click(limitBtn);

        // Check if limit price input is populated
        // Logic: Buy Limit = Price - 20 pips (1.1000 - 0.0020 = 1.0980)
        const limitInput = screen.getByLabelText('Limit Price') as HTMLInputElement;
        expect(limitInput.value).toBe('1.09800');
    });

    it('submits market order correctly', async () => {
        const handlePlaceOrder = vi.fn();
        render(<OrderForm {...defaultProps} onPlaceOrder={handlePlaceOrder} />);

        const buyBtn = screen.getByText('Buy');
        fireEvent.click(buyBtn);

        await waitFor(() => {
            expect(handlePlaceOrder).toHaveBeenCalledWith(
                expect.objectContaining({ lots: "1" }),
                "Market",
                "BUY"
            );
        });
    });
});
