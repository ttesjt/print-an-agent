import { Stack } from '@print-an-agent/ui-react';
import type { ReactNode } from 'react';

export interface GallerySectionProps {
  readonly children: ReactNode;
  readonly description: string;
  readonly id: string;
  readonly title: string;
}

export function GallerySection({ children, description, id, title }: GallerySectionProps) {
  const titleId = `${id}-title`;
  return (
    <section aria-labelledby={titleId} className="ta-ui-gallery-section" id={id}>
      <Stack space="large">
        <header className="ta-ui-gallery-section__header">
          <h2 id={titleId}>{title}</h2>
          <p>{description}</p>
        </header>
        {children}
      </Stack>
    </section>
  );
}
