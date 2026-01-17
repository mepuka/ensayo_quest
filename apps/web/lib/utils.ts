/**
 * Utility functions for shadcn/ui components
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes with clsx
 * This is the standard shadcn/ui utility
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
