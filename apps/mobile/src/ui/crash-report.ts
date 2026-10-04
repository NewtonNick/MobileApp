const CAP = 4000;

/** Text the user can share. Callers must pass the error only, never the household. */
export function formatCrashReport(message: string, componentStack?: string | null): string {
  const lines = ['Asset Aware stopped.', '', message.trim() || 'Unknown error'];
  const stack = componentStack?.trim();
  if (stack) lines.push('', stack);
  return lines.join('\n').slice(0, CAP);
}
