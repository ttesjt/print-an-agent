import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../actions/button.js';
import { assignRef } from '../internal/refs.js';
import { joinStyleHooks } from '../internal/style-hooks.js';

const DEFAULT_FOLLOW_THRESHOLD = 48;

type NativeConversationScrollRegionProps = Omit<ComponentPropsWithRef<'div'>, 'style'>;

export interface ConversationScrollRegionProps extends NativeConversationScrollRegionProps {
  readonly children: ReactNode;
  readonly contentRevision: string | number;
  readonly conversationKey: string;
  readonly followThreshold?: number;
  readonly jumpToLatestLabel: ReactNode;
  readonly style?: never;
}

export function ConversationScrollRegion({
  children,
  className,
  contentRevision,
  conversationKey,
  followThreshold = DEFAULT_FOLLOW_THRESHOLD,
  jumpToLatestLabel,
  onScroll,
  ref,
  ...props
}: ConversationScrollRegionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (container !== null) container.scrollTop = container.scrollHeight;
    setFollowing(true);
  }, [conversationKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (container !== null && following) container.scrollTop = container.scrollHeight;
  }, [contentRevision, following]);

  const jumpToLatest = () => {
    const container = containerRef.current;
    if (container !== null) container.scrollTop = container.scrollHeight;
    setFollowing(true);
  };

  return (
    <div
      {...props}
      className={joinStyleHooks('ta-ui-conversation-scroll-region', className)}
      data-following={following || undefined}
      data-slot="conversation-scroll-region"
      onScroll={(event) => {
        onScroll?.(event);
        const container = event.currentTarget;
        const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
        setFollowing(distance <= followThreshold);
      }}
      ref={(value) => {
        containerRef.current = value;
        assignRef(ref, value);
      }}
    >
      {children}
      {following ? null : (
        <div className="ta-ui-conversation-scroll-region__jump">
          <Button
            appearance="ghost"
            className="ta-ui-conversation-scroll-region__jump-button"
            onClick={jumpToLatest}
            size="small"
            tone="neutral"
          >
            {jumpToLatestLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
