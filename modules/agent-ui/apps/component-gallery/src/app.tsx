import { Button, Cluster, Stack, TextLink } from '@print-an-agent/ui-react';
import { useState } from 'react';

import { ActionsGallery } from './gallery/actions-gallery.js';
import { ActionBarGallery } from './gallery/action-bar-gallery.js';
import { AgentManagementGallery } from './gallery/agent-management-gallery.js';
import { AppShellGallery } from './gallery/app-shell-gallery.js';
import { ConversationGallery } from './gallery/conversation-gallery.js';
import { DisclosureActivityGallery } from './gallery/disclosure-activity-gallery.js';
import { FeedbackGallery } from './gallery/feedback-gallery.js';
import { FormsGallery } from './gallery/forms-gallery.js';
import { LayoutGallery } from './gallery/layout-gallery.js';
import { NavigationGallery } from './gallery/navigation-gallery.js';
import { OverlayGallery } from './gallery/overlay-gallery.js';
import { PanelGallery } from './gallery/panel-gallery.js';
import { SessionManagementGallery } from './gallery/session-management-gallery.js';
import { ThemeGallery } from './gallery/theme-gallery.js';
import { CollectionGallery } from './gallery/collection-gallery.js';

type ThemeMode = 'dark' | 'light' | 'system';

const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export function App() {
  const [theme, setTheme] = useState<ThemeMode>('system');

  return (
    <div className="ta-ui-root ta-ui-gallery-root" data-gallery-root data-ta-ui-theme={theme}>
      <header className="ta-ui-gallery-header">
        <Stack space="medium">
          <Cluster justify="between" space="medium">
            <div>
              <p className="ta-ui-gallery-eyebrow">Agent UI</p>
              <h1>Component Gallery</h1>
            </div>
            <Cluster
              aria-label="Gallery theme"
              className="ta-ui-gallery-theme-control"
              role="group"
              space="small"
            >
              {THEME_MODES.map((mode) => (
                <Button
                  aria-pressed={theme === mode}
                  appearance="outline"
                  data-theme-choice={mode}
                  key={mode}
                  onClick={() => setTheme(mode)}
                  size="small"
                  tone="neutral"
                >
                  {mode}
                </Button>
              ))}
            </Cluster>
          </Cluster>
          <p>
            Deterministic previews for the complete public component surface currently implemented
            by Agent UI.
          </p>
          <nav aria-label="Gallery sections" className="ta-ui-gallery-navigation">
            <Cluster space="small">
              <TextLink href="#panels">Panel</TextLink>
              <TextLink href="#layouts">Layout</TextLink>
              <TextLink href="#app-shells">App Shell</TextLink>
              <TextLink href="#themes">Themes</TextLink>
              <TextLink href="#actions">Actions</TextLink>
              <TextLink href="#action-bars">Action bars</TextLink>
              <TextLink href="#forms">Forms</TextLink>
              <TextLink href="#feedback">Feedback</TextLink>
              <TextLink href="#overlays">Overlays</TextLink>
              <TextLink href="#navigation">Navigation</TextLink>
              <TextLink href="#agent-management">Agent management</TextLink>
              <TextLink href="#session-management">Session management</TextLink>
              <TextLink href="#conversation">Conversation</TextLink>
              <TextLink href="#collections">Collections</TextLink>
              <TextLink href="#disclosure-activity">Disclosure activity</TextLink>
              <TextLink href="/consumer.html?styles=none">Unstyled consumer</TextLink>
              <TextLink href="/consumer.html?styles=default">Default-style consumer</TextLink>
              <TextLink href="/consumer.html?styles=custom">Custom-style consumer</TextLink>
            </Cluster>
          </nav>
        </Stack>
      </header>

      <main className="ta-ui-gallery-main">
        <Stack space="large">
          <PanelGallery />
          <LayoutGallery />
          <AppShellGallery />
          <ThemeGallery />
          <ActionsGallery />
          <ActionBarGallery />
          <FormsGallery />
          <FeedbackGallery />
          <OverlayGallery />
          <NavigationGallery />
          <AgentManagementGallery />
          <SessionManagementGallery />
          <ConversationGallery />
          <CollectionGallery />
          <DisclosureActivityGallery />
        </Stack>
      </main>
    </div>
  );
}
