import {
  Alert,
  Button,
  ConfirmationDialog,
  Dialog,
  Drawer,
  Grid,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
} from '@ta-agent/ui-react';
import { useState } from 'react';

import { GallerySection } from './gallery-section.js';

export function OverlayGallery() {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const [drawerPlacement, setDrawerPlacement] = useState<'end' | 'start'>('start');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const portalProps = portalContainer === null ? {} : { portalContainer };

  return (
    <div className="ta-ui-gallery-overlay-anchor" ref={setPortalContainer}>
      <GallerySection
        description="Modal overlays keep focus, dismissal, portal, and scroll ownership explicit while applications retain open state and commands."
        id="overlays"
        title="Overlays"
      >
        <Grid columns="three">
          <Panel variant="muted">
            <PanelHeader>
              <h3>Dialog and nesting</h3>
            </PanelHeader>
            <PanelBody>
              <Button data-open-dialog onClick={() => setDialogOpen(true)}>
                Open Dialog
              </Button>
            </PanelBody>
          </Panel>

          <Panel variant="muted">
            <PanelHeader>
              <h3>Modal Drawer</h3>
            </PanelHeader>
            <PanelBody>
              <Stack space="small">
                <Button
                  appearance="outline"
                  data-open-drawer="start"
                  onClick={() => {
                    setDrawerPlacement('start');
                    setDrawerOpen(true);
                  }}
                >
                  Open start Drawer
                </Button>
                <Button
                  appearance="outline"
                  data-open-drawer="end"
                  onClick={() => {
                    setDrawerPlacement('end');
                    setDrawerOpen(true);
                  }}
                >
                  Open end Drawer
                </Button>
              </Stack>
            </PanelBody>
          </Panel>

          <Panel variant="muted">
            <PanelHeader>
              <h3>Confirmation</h3>
            </PanelHeader>
            <PanelBody>
              <Button
                data-open-confirmation
                onClick={() => setConfirmationOpen(true)}
                tone="critical"
              >
                Open destructive confirmation
              </Button>
            </PanelBody>
          </Panel>
        </Grid>

        <Dialog
          {...portalProps}
          description="Escape and backdrop interactions request a controlled close."
          footer={<Button onClick={() => setDialogOpen(false)}>Close Dialog</Button>}
          onOpenChange={setDialogOpen}
          open={dialogOpen}
          title="Controlled modal Dialog"
        >
          <Stack space="medium">
            <p>The application owns this open state.</p>
            <Button appearance="outline" data-open-nested onClick={() => setNestedOpen(true)}>
              Open nested Dialog
            </Button>
            <form method="dialog">
              <Button appearance="outline" type="submit">
                Native form close
              </Button>
            </form>
          </Stack>
          <Dialog
            {...portalProps}
            description="The outer scroll lock remains active when this closes."
            footer={<Button onClick={() => setNestedOpen(false)}>Close nested Dialog</Button>}
            onOpenChange={setNestedOpen}
            open={nestedOpen}
            title="Nested modal"
          >
            Nested overlay content.
          </Dialog>
        </Dialog>

        <Drawer
          {...portalProps}
          description="This is a modal overlay, not an AppShell persistent sidebar."
          footer={<Button onClick={() => setDrawerOpen(false)}>Close Drawer</Button>}
          onOpenChange={setDrawerOpen}
          open={drawerOpen}
          placement={drawerPlacement}
          title={`${drawerPlacement} modal Drawer`}
        >
          <p>Applications explicitly decide when narrow layouts use a Drawer.</p>
        </Drawer>

        <ConfirmationDialog
          {...portalProps}
          cancelLabel="Cancel"
          confirmLabel="Disable"
          description="This demonstration keeps lifecycle authority outside the primitive."
          {...(confirmationPending
            ? {
                error: (
                  <Alert tone="caution">
                    Pending state blocks duplicate actions and dismissal.
                  </Alert>
                ),
              }
            : {})}
          onConfirm={() => setConfirmationPending(true)}
          onOpenChange={(nextOpen) => {
            setConfirmationOpen(nextOpen);
            if (!nextOpen) setConfirmationPending(false);
          }}
          open={confirmationOpen}
          pending={confirmationPending}
          title="Disable this Agent?"
          tone="critical"
        />
      </GallerySection>
    </div>
  );
}
