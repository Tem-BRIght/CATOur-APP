import React, { useEffect } from 'react';
import './FeedbackOverlay.css';

export interface FeedbackOverlayButton {
  text: string;
  role?: string;
  handler?: () => void | Promise<void>;
}

interface FeedbackOverlayProps {
  isOpen: boolean;
  onDidDismiss: () => void;
  header?: string;
  message?: string;
  buttons: Array<string | FeedbackOverlayButton>;
}

const FeedbackOverlay: React.FC<FeedbackOverlayProps> = ({
  isOpen,
  onDidDismiss,
  header,
  message,
  buttons,
}) => {
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDidDismiss();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onDidDismiss]);

  if (!isOpen) return null;

  const actions = buttons.map((button) =>
    typeof button === 'string' ? { text: button } : button,
  );

  const handleAction = async (button: FeedbackOverlayButton) => {
    onDidDismiss();
    await button.handler?.();
  };

  return (
    <div
      className="feedback-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDidDismiss();
      }}
    >
      <section
        className="feedback-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={header ? 'feedback-overlay-title' : undefined}
      >
        <div className="feedback-overlay-header">
          {header && <h2 id="feedback-overlay-title">{header}</h2>}
          <button
            type="button"
            className="feedback-overlay-close"
            onClick={onDidDismiss}
            aria-label="Close"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        {message && <p className="feedback-overlay-message">{message}</p>}

        <div className="feedback-overlay-actions">
          {actions.map((button, index) => (
            <button
              key={`${button.text}-${index}`}
              type="button"
              className={`feedback-overlay-action${button.role === 'cancel' ? ' is-cancel' : ''}${button.role === 'destructive' ? ' is-destructive' : ''}`}
              onClick={() => handleAction(button)}
            >
              {button.text}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};

export default FeedbackOverlay;
