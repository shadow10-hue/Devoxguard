export type BadgeTone = 'low' | 'medium' | 'high' | 'danger' | 'warning' | 'info' | 'neutral';

export interface NormalizedAction {
  tone: BadgeTone;
  label: string;
}

/**
 * The API surfaces two different action vocabularies: `Finding.actionTaken`
 * is English (blocked/logged/rate-limited), `CompiledRule.action` is French
 * (bloquer/journaliser, no rate-limited equivalent). This normalizes both
 * into a single tone+label pair for ActionBadge.
 */
export function normalizeAction(action: string): NormalizedAction {
  switch (action) {
    case 'blocked':
    case 'bloquer':
      return { tone: 'danger', label: 'Blocked' };
    case 'logged':
    case 'journaliser':
      return { tone: 'info', label: 'Logged' };
    case 'rate-limited':
      return { tone: 'warning', label: 'Rate limited' };
    default:
      return { tone: 'neutral', label: action };
  }
}
