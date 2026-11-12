import {
  Button,
  Cluster,
  Disclosure,
  DisclosurePanel,
  DisclosureSummary,
  Grid,
  NavigationRail,
  NavigationRailBody,
  NavigationRailFooter,
  NavigationRailHeader,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextLink,
} from '@print-an-agent/ui-react';

import { GallerySection } from './gallery-section.js';

export function NavigationGallery() {
  return (
    <GallerySection
      description="Local navigation owns keyboard and disclosure behavior without becoming route, Agent, or Session authority."
      id="navigation"
      title="Navigation"
    >
      <Grid columns="two">
        <Panel>
          <PanelHeader>
            <h3>Automatic Tabs</h3>
          </PanelHeader>
          <PanelBody>
            <Tabs defaultValue="active">
              <TabList aria-label="Session lifecycle">
                <Tab value="active">Active</Tab>
                <Tab value="retired">Retired</Tab>
                <Tab disabled value="unavailable">
                  Unavailable
                </Tab>
              </TabList>
              <TabPanel value="active">Active content</TabPanel>
              <TabPanel value="retired">Retired content</TabPanel>
              <TabPanel value="unavailable">Unavailable content</TabPanel>
            </Tabs>
          </PanelBody>
        </Panel>

        <Panel dir="rtl">
          <PanelHeader>
            <h3>RTL manual Tabs</h3>
          </PanelHeader>
          <PanelBody>
            <Tabs activationMode="manual" defaultValue="details" orientation="vertical">
              <TabList aria-label="Inspector views">
                <Tab value="details">Details</Tab>
                <Tab value="activity">Activity</Tab>
              </TabList>
              <TabPanel value="details">Details panel</TabPanel>
              <TabPanel value="activity">Activity panel</TabPanel>
            </Tabs>
          </PanelBody>
        </Panel>
      </Grid>

      <Grid columns="two">
        <Stack space="small">
          <Disclosure defaultOpen>
            <DisclosureSummary>Readable reasoning</DisclosureSummary>
            <DisclosurePanel>
              Native details semantics preserve keyboard and browser behavior.
            </DisclosurePanel>
          </Disclosure>
          <Disclosure>
            <DisclosureSummary>Tool activity</DisclosureSummary>
            <DisclosurePanel>Collapsed by default.</DisclosurePanel>
          </Disclosure>
          <Disclosure appearance="plain">
            <DisclosureSummary>Plain disclosure</DisclosureSummary>
            <DisclosurePanel>Auxiliary content without a surface or border.</DisclosurePanel>
          </Disclosure>
        </Stack>

        <NavigationRail aria-label="Example workspace navigation">
          <NavigationRailHeader>
            <strong>Workspace</strong>
          </NavigationRailHeader>
          <NavigationRailBody>
            <Stack space="small">
              <Button appearance="ghost">Agents</Button>
              <Button appearance="ghost">Sessions</Button>
              <TextLink href="#overlays">Overlay examples</TextLink>
            </Stack>
          </NavigationRailBody>
          <NavigationRailFooter>
            <Cluster justify="between">
              <span>Local</span>
              <span>Ready</span>
            </Cluster>
          </NavigationRailFooter>
        </NavigationRail>
      </Grid>

      <Grid columns="three">
        {(['small', 'medium', 'large'] as const).map((size) => (
          <Disclosure defaultOpen key={size}>
            <DisclosureSummary>{size} content height limit</DisclosureSummary>
            <DisclosurePanel aria-label={`${size} scrollable details`} contentMaxHeight={size}>
              <Stack space="small">
                {Array.from({ length: 18 }, (_, index) => (
                  <p key={index}>Paragraph {String(index + 1)} in a keyboard-scrollable panel.</p>
                ))}
              </Stack>
            </DisclosurePanel>
          </Disclosure>
        ))}
      </Grid>
    </GallerySection>
  );
}
