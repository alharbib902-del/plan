import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with proper precedence.
 * Used throughout components for conditional class composition.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
