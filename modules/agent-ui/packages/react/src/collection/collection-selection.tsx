import type { CollectionChoice, CollectionReference } from '@ta-agent/ui-contracts';
import type { ReactNode } from 'react';

import { Button } from '../actions/button.js';
import { Alert, EmptyState, Status } from '../feedback/feedback.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

export interface CollectionListProps<Reference extends CollectionReference> {
  readonly choices: readonly CollectionChoice<Reference>[];
  readonly onSelect: (choice: CollectionChoice<Reference>) => void;
  readonly label: string;
  readonly emptyLabel: ReactNode;
  readonly pending?: boolean;
  readonly selectedKey?: string;
  readonly renderActions?: (choice: CollectionChoice<Reference>) => ReactNode;
  readonly className?: string;
}

export function CollectionList<Reference extends CollectionReference>({
  choices,
  onSelect,
  label,
  emptyLabel,
  pending = false,
  selectedKey,
  renderActions,
  className,
}: CollectionListProps<Reference>) {
  return (
    <div
      className={joinStyleHooks('ta-ui-collection-list', className)}
      data-slot="collection-list"
      aria-busy={pending}
    >
      {choices.length === 0 ? (
        <EmptyState title={emptyLabel} />
      ) : (
        <ul aria-label={label}>
          {choices.map((choice) => (
            <li key={choice.key} data-slot="collection-list-item">
              <Button
                appearance="ghost"
                tone="neutral"
                disabled={pending}
                aria-current={choice.key === selectedKey ? 'true' : undefined}
                onClick={() => onSelect(choice)}
              >
                <span className="ta-ui-collection-list__label">{choice.label}</span>
                {choice.description !== undefined && (
                  <span className="ta-ui-collection-list__description">{choice.description}</span>
                )}
              </Button>
              {renderActions?.(choice)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface CollectionSetupFormProps {
  readonly children: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly onSubmit: () => void;
  readonly submitLabel: ReactNode;
  readonly pendingLabel: ReactNode;
  readonly pending?: boolean;
  readonly invalid?: boolean;
  readonly error?: ReactNode;
  readonly className?: string;
}

/** Field schema, draft state and validation belong to the application. */
export function CollectionSetupForm({
  children,
  title,
  description,
  onSubmit,
  submitLabel,
  pendingLabel,
  pending = false,
  invalid = false,
  error,
  className,
}: CollectionSetupFormProps) {
  return (
    <form
      className={joinStyleHooks('ta-ui-collection-setup', className)}
      data-slot="collection-setup"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && !invalid) onSubmit();
      }}
    >
      <h2>{title}</h2>
      {description !== undefined && <p>{description}</p>}
      <fieldset disabled={pending}>{children}</fieldset>
      {error !== undefined && <Alert tone="critical">{error}</Alert>}
      {pending && <Status announcement="polite">{pendingLabel}</Status>}
      <Button type="submit" disabled={invalid} pending={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
