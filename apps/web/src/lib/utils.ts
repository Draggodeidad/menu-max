import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// oxlint-disable-next-line typescript/no-explicit-any -- shadcn-svelte helper types
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// oxlint-disable-next-line typescript/no-explicit-any -- shadcn-svelte helper types
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
