import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getFilterBorderColor = (level: string) => {
  switch (level) {
    case 'none': return 'border-rose-500/50 dark:border-blue-500/50 shadow-[0_0_2px_1px_rgba(244,63,94,0.3)] dark:shadow-[0_0_2px_1px_rgba(59,130,246,0.5)]';
    case 'low': return 'border-emerald-500/50 dark:border-blue-500/50 shadow-[0_0_2px_1px_rgba(16,185,129,0.3)] dark:shadow-[0_0_2px_1px_rgba(59,130,246,0.5)]';
    case 'medium': return 'border-purple-500/50 dark:border-blue-500/50 shadow-[0_0_2px_1px_rgba(168,85,247,0.3)] dark:shadow-[0_0_2px_1px_rgba(59,130,246,0.5)]';
    case 'high': return 'border-sky-500/50 dark:border-sky-400/50 shadow-[0_0_2px_1px_rgba(14,165,233,0.3)] dark:shadow-[0_0_2px_1px_rgba(56,189,248,0.5)]';
    default: return 'border-sky-500/50 dark:border-sky-400/50 shadow-[0_0_2px_1px_rgba(14,165,233,0.3)] dark:shadow-[0_0_2px_1px_rgba(56,189,248,0.5)]';
  }
};

export const getFilterColor = (level: string) => {
  switch (level) {
    case 'none': return 'text-rose-500 dark:text-blue-400';
    case 'low': return 'text-emerald-500 dark:text-blue-400';
    case 'medium': return 'text-purple-500 dark:text-blue-400';
    case 'high': return 'text-sky-500 dark:text-sky-400';
    default: return 'text-sky-500 dark:text-sky-400';
  }
};
