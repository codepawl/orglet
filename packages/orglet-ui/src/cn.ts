import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names and lets the caller's win. Every component here ends its class list with the `className` it was
 * given, so an application can override any of it without `!important` and without knowing the kit's internals.
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
