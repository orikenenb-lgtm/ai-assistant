import { clsx, type ClassValue } from 'clsx';

/** Join class names conditionally (thin wrapper so feature code has one import). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
