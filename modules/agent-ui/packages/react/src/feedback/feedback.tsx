import type { ComponentPropsWithRef, ReactNode } from 'react';

import { joinStyleHooks } from '../internal/style-hooks.js';

export type FeedbackAnnouncement = 'assertive' | 'none' | 'polite';

export type FeedbackTone = 'accent' | 'caution' | 'critical' | 'neutral' | 'positive';

interface AnnouncementAttributes {
  readonly 'aria-atomic': true | undefined;
  readonly 'aria-live': 'assertive' | 'polite' | undefined;
  readonly role: 'alert' | 'status' | undefined;
}

function announcementAttributes(announcement: FeedbackAnnouncement): AnnouncementAttributes {
  if (announcement === 'assertive') {
    return { 'aria-atomic': true, 'aria-live': 'assertive', role: 'alert' };
  }
  if (announcement === 'polite') {
    return { 'aria-atomic': true, 'aria-live': 'polite', role: 'status' };
  }
  return { 'aria-atomic': undefined, 'aria-live': undefined, role: undefined };
}

type NativeBadgeProps = Omit<ComponentPropsWithRef<'span'>, 'style'>;

export interface BadgeProps extends NativeBadgeProps {
  readonly style?: never;
  readonly tone?: FeedbackTone;
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={joinStyleHooks('ta-ui-badge', className)}
      data-slot="badge"
      data-tone={tone}
    />
  );
}

type NativeStatusProps = Omit<
  ComponentPropsWithRef<'div'>,
  'aria-atomic' | 'aria-live' | 'role' | 'style'
>;

export interface StatusProps extends NativeStatusProps {
  readonly announcement?: FeedbackAnnouncement;
  readonly style?: never;
  readonly tone?: FeedbackTone;
}

export function Status({
  announcement = 'none',
  className,
  tone = 'neutral',
  ...props
}: StatusProps) {
  return (
    <div
      {...props}
      {...announcementAttributes(announcement)}
      className={joinStyleHooks('ta-ui-status', className)}
      data-announcement={announcement}
      data-slot="status"
      data-tone={tone}
    />
  );
}

type NativeAlertProps = Omit<
  ComponentPropsWithRef<'div'>,
  'aria-atomic' | 'aria-live' | 'role' | 'style'
>;

export interface AlertProps extends NativeAlertProps {
  readonly announcement?: FeedbackAnnouncement;
  readonly style?: never;
  readonly tone?: FeedbackTone;
}

export function Alert({
  announcement = 'none',
  className,
  tone = 'neutral',
  ...props
}: AlertProps) {
  return (
    <div
      {...props}
      {...announcementAttributes(announcement)}
      className={joinStyleHooks('ta-ui-alert', className)}
      data-announcement={announcement}
      data-slot="alert"
      data-tone={tone}
    />
  );
}

type NativeInlineErrorProps = Omit<
  ComponentPropsWithRef<'p'>,
  'aria-atomic' | 'aria-live' | 'role' | 'style'
>;

export interface InlineErrorProps extends NativeInlineErrorProps {
  readonly announcement?: FeedbackAnnouncement;
  readonly style?: never;
}

export function InlineError({ announcement = 'none', className, ...props }: InlineErrorProps) {
  return (
    <p
      {...props}
      {...announcementAttributes(announcement)}
      className={joinStyleHooks('ta-ui-inline-error', className)}
      data-announcement={announcement}
      data-slot="inline-error"
    />
  );
}

type NativeEmptyStateProps = Omit<ComponentPropsWithRef<'div'>, 'children' | 'style' | 'title'>;

export interface EmptyStateProps extends NativeEmptyStateProps {
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly description?: ReactNode;
  readonly style?: never;
  readonly title: ReactNode;
}

export function EmptyState({
  actions,
  children,
  className,
  description,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-empty-state', className)}
      data-slot="empty-state"
    >
      <p className="ta-ui-empty-state__title" data-slot="empty-state-title">
        {title}
      </p>
      {description !== undefined && description !== null && (
        <p className="ta-ui-empty-state__description" data-slot="empty-state-description">
          {description}
        </p>
      )}
      {children}
      {actions !== undefined && actions !== null && (
        <div className="ta-ui-empty-state__actions" data-slot="empty-state-actions">
          {actions}
        </div>
      )}
    </div>
  );
}

type NativeSpinnerProps = Omit<
  ComponentPropsWithRef<'span'>,
  'aria-atomic' | 'aria-hidden' | 'aria-label' | 'aria-live' | 'children' | 'role' | 'style'
>;

type LabelledSpinnerProps = {
  readonly announcement?: FeedbackAnnouncement;
  readonly decorative?: false;
  readonly label: string;
};

type DecorativeSpinnerProps = {
  readonly announcement?: never;
  readonly decorative: true;
  readonly label?: never;
};

export type SpinnerProps = NativeSpinnerProps &
  (DecorativeSpinnerProps | LabelledSpinnerProps) & {
    readonly style?: never;
  };

export function Spinner({
  announcement = 'none',
  className,
  decorative = false,
  label,
  ...props
}: SpinnerProps) {
  const announcesChanges = !decorative && announcement !== 'none';

  return (
    <span
      {...props}
      aria-atomic={announcesChanges || undefined}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      aria-live={announcesChanges ? announcement : undefined}
      className={joinStyleHooks('ta-ui-spinner', className)}
      data-announcement={decorative ? undefined : announcement}
      data-decorative={decorative || undefined}
      data-slot="spinner"
      role={decorative ? undefined : 'progressbar'}
    />
  );
}

export type SkeletonShape = 'block' | 'circle' | 'text';

type NativeSkeletonProps = Omit<
  ComponentPropsWithRef<'span'>,
  'aria-hidden' | 'children' | 'style'
>;

export interface SkeletonProps extends NativeSkeletonProps {
  readonly shape?: SkeletonShape;
  readonly style?: never;
}

export function Skeleton({ className, shape = 'text', ...props }: SkeletonProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={joinStyleHooks('ta-ui-skeleton', className)}
      data-shape={shape}
      data-slot="skeleton"
    />
  );
}

export type SeparatorOrientation = 'horizontal' | 'vertical';

type NativeSeparatorProps = Omit<
  ComponentPropsWithRef<'div'>,
  'aria-orientation' | 'children' | 'role' | 'style'
>;

export interface SeparatorProps extends NativeSeparatorProps {
  readonly orientation?: SeparatorOrientation;
  readonly style?: never;
}

export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorProps) {
  return (
    <div
      {...props}
      aria-orientation={orientation}
      className={joinStyleHooks('ta-ui-separator', className)}
      data-orientation={orientation}
      data-slot="separator"
      role="separator"
    />
  );
}
