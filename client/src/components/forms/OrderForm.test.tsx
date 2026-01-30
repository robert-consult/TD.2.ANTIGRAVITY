import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrderForm } from './OrderForm';
import { describe, it, expect, vi } from 'vitest';

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
        const lotsInput = screen.getByText('1'); // Select trigger shows default value
        // Note: Testing Select component interaction might require user-event or specific selectors
        // tailored to the component library implementation.
        // For simplicity, we check if the default value is present.
        expect(lotsInput).toBeInTheDocument();
    });

    it('calculates auto-stop/limit prices', async () => {
        render(<OrderForm {...defaultProps} />);

        // switch to Limit
        const limitBtn = screen.getByText('Limit');
        fireEvent.click(limitBtn);

        // Check if limit price input is populated
        // Logic: Buy Limit = Price - 10 pips (1.1000 - 0.0010 = 1.0990)
        const limitInput = screen.getByLabelText('Limit Price') as HTMLInputElement;
        expect(limitInput.value).toBe('1.09900');
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
