// One suggestion in the editor's list: its type, the before-and-after text,
// and the accept, skip and fix actions the editor wires to it. An accepted or
// skipped suggestion collapses to a one-line record of what happened.

import { Icon } from '@ui/icons';
import type { Suggestion, SuggestionType } from '../reviewSwarm';

const SUGGESTION_TYPE_LABELS: Record<SuggestionType, string> = {
  grammar:     'Grammar',
  vocabulary:  'Vocabulary',
  style:       'Style',
  originality: 'Originality',
  statistics:  'Statistics',
  general:     'General',
};

export function SuggestionCard({
  suggestion,
  active,
  onHover,
  onAccept,
  onSkip,
  onFix,
}: {
  suggestion: Suggestion;
  active: boolean;
  onHover: (id: string | null) => void;
  onAccept: (s: Suggestion) => void;
  onSkip: (s: Suggestion) => void;
  onFix: (s: Suggestion) => void;
}) {
  const { status, type, suggestedText } = suggestion;

  if (status === 'accepted') {
    return (
      <div className="suggestion-card suggestion-card--resolved suggestion-card--accepted">
        <span className={`suggestion-type suggestion-type--${type}`}>
          {SUGGESTION_TYPE_LABELS[type]}
        </span>
        <span className="suggestion-resolved-label">✓ Applied</span>
      </div>
    );
  }

  if (status === 'skipped') {
    return (
      <div className="suggestion-card suggestion-card--resolved suggestion-card--skipped">
        <span className={`suggestion-type suggestion-type--${type}`}>
          {SUGGESTION_TYPE_LABELS[type]}
        </span>
        <span className="suggestion-resolved-label">— Skipped</span>
      </div>
    );
  }

  return (
    <div
      className={`suggestion-card${active ? ' suggestion-card--active' : ''}`}
      onMouseEnter={() => onHover(suggestion.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="suggestion-card-head">
        <span className={`suggestion-type suggestion-type--${type}`}>
          {SUGGESTION_TYPE_LABELS[type]}
        </span>
        <span className="suggestion-card-source">{suggestion.description}</span>
      </div>

      {(suggestion.originalText || suggestedText) && (
        <div className="suggestion-diff">
          {suggestion.originalText && (
            <span className="suggestion-diff-before">&ldquo;{suggestion.originalText}&rdquo;</span>
          )}
          {suggestion.originalText && suggestedText && (
            <span className="suggestion-diff-arrow">→</span>
          )}
          {suggestedText && (
            <span className="suggestion-diff-after">&ldquo;{suggestedText}&rdquo;</span>
          )}
        </div>
      )}

      <div className="suggestion-card-actions">
        {suggestedText ? (
          <button
            type="button"
            className="suggestion-btn suggestion-btn--accept"
            onClick={() => onAccept(suggestion)}
          >
            Accept
          </button>
        ) : (
          <button
            type="button"
            className={`suggestion-btn suggestion-btn--fix${status === 'fixing' ? ' suggestion-btn--busy' : ''}`}
            onClick={() => onFix(suggestion)}
            disabled={status === 'fixing'}
          >
            {status === 'fixing' && <Icon name="spinner" size={10} />}
            {status === 'fixing' ? 'Getting fix…' : 'Get Fix'}
          </button>
        )}
        <button
          type="button"
          className="suggestion-btn suggestion-btn--skip"
          onClick={() => onSkip(suggestion)}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
