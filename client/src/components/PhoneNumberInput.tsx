import { useEffect, useRef, useState, useCallback } from "react";
import { parsePhoneNumberFromString, getCountryCallingCode, CountryCode, AsYouType } from "libphonenumber-js";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  countryIso2: string;
  value: string;
  onChange: (e164: string, valid: boolean) => void;
  disabled?: boolean;
  required?: boolean;
};

export function PhoneNumberInput({ countryIso2, value, onChange, disabled, required = true }: Props) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  // Track user input vs prop sync
  const isUserTypingRef = useRef(false);
  const userTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedValueRef = useRef("");
  const lastSyncedCountryRef = useRef("");

  // Sync display value from E.164 prop - only for valid E.164 values from external sources
  useEffect(() => {
    // Skip sync while user is actively typing
    if (isUserTypingRef.current) {
      return;
    }

    // Skip if value+country combo hasn't changed
    if (value === lastSyncedValueRef.current && countryIso2 === lastSyncedCountryRef.current) {
      return;
    }

    // Update tracking refs
    lastSyncedValueRef.current = value;
    lastSyncedCountryRef.current = countryIso2;

    // Clear if no value or country
    if (!value || !countryIso2) {
      if (raw && !isUserTypingRef.current) {
        setRaw("");
        setError(null);
      }
      return;
    }

    // Only sync if value looks like E.164 format (starts with +)
    if (!value.startsWith('+')) {
      // Value is not E.164 format - likely raw input being echoed back, ignore
      return;
    }

    try {
      const parsed = parsePhoneNumberFromString(value, countryIso2 as CountryCode);
      if (parsed && parsed.isValid()) {
        // Only update raw if it differs from what user might be typing
        const formatted = parsed.formatNational();
        if (raw !== formatted) {
          setRaw(formatted);
          setError(null);
        }
      }
      // If parse fails, don't clear raw - user might be typing
    } catch {
      // Parse error - don't clear raw
    }
  }, [value, countryIso2, raw]);

  // Validate and notify parent
  const validateAndNotify = useCallback((inputRaw: string) => {
    if (!inputRaw || inputRaw.trim() === "") {
      setError(null);
      onChange("", false);
      return;
    }

    if (!countryIso2) {
      setError(null);
      onChange("", false);
      return;
    }

    try {
      const phone = parsePhoneNumberFromString(inputRaw, countryIso2 as CountryCode);
      
      if (!phone || !phone.isValid()) {
        setError("Invalid phone number for selected country");
        // Don't send raw input back to parent - just send empty with invalid flag
        // This prevents the sync loop
        onChange("", false);
        return;
      }

      setError(null);
      onChange(phone.number, true);
    } catch {
      setError("Invalid phone number");
      onChange("", false);
    }
  }, [countryIso2, onChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Mark as user typing
    isUserTypingRef.current = true;
    
    // Clear any existing timeout
    if (userTypingTimeoutRef.current) {
      clearTimeout(userTypingTimeoutRef.current);
    }
    
    const inputValue = e.target.value;
    const digitsOnly = inputValue.replace(/[^\d\s\-()]/g, '');
    
    let formatted = digitsOnly;
    if (countryIso2) {
      try {
        const formatter = new AsYouType(countryIso2 as CountryCode);
        formatted = formatter.input(digitsOnly.replace(/\D/g, ''));
      } catch {
        formatted = digitsOnly;
      }
    }
    
    setRaw(formatted);
    validateAndNotify(formatted);
    
    // Reset typing flag after a delay
    userTypingTimeoutRef.current = setTimeout(() => {
      isUserTypingRef.current = false;
    }, 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowedKeys = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (allowedKeys.includes(e.key)) return;
    if (e.ctrlKey || e.metaKey) return;
    if (!/[\d\s\-()]/.test(e.key)) {
      e.preventDefault();
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (userTypingTimeoutRef.current) {
        clearTimeout(userTypingTimeoutRef.current);
      }
    };
  }, []);

  let prefix = "";
  try {
    if (countryIso2 && countryIso2.length === 2) {
      prefix = `+${getCountryCallingCode(countryIso2 as CountryCode)}`;
    }
  } catch {
    prefix = "";
  }

  return (
    <div className="space-y-1">
      <Label htmlFor="phone">
        Phone Number{required && <span className="text-red-500"> *</span>}
      </Label>
      <div className="flex items-center gap-2">
        {prefix && (
          <span className="text-sm text-muted-foreground bg-muted px-2 py-2 rounded border">
            {prefix}
          </span>
        )}
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          value={raw}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={prefix ? "Enter phone number" : "Select country first"}
          disabled={disabled || !countryIso2}
          required={required}
          className="flex-1"
        />
      </div>
      {error && <div className="text-xs text-red-500">{error}</div>}
      <p className="text-xs text-muted-foreground">
        Phone can be verified later in your profile settings.
      </p>
    </div>
  );
}
