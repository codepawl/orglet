import { amountToMicros, currencySymbol, formatMicros, microsToAmount, usdCurrency, type CurrencyState } from '../../shared/currency';

// ponytail: module-level display currency set by App on each workspace refresh; every money renderer is a child
// of App and re-renders with it. Use a React context if a component ever renders outside that tree.
let current: CurrencyState = usdCurrency;
export const setDisplayCurrency = (currency: CurrencyState | undefined) => { current = currency ?? usdCurrency; };
export const displayCurrency = () => current;
export const formatMoney = (micros: number) => formatMicros(micros, current);
export const toAmount = (micros: number) => microsToAmount(micros, current);
export const toMicros = (text: string) => amountToMicros(text, current);
export const moneySymbol = () => currencySymbol(current);
