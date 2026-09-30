import { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  Disclosure,
  DisclosurePanel,
  DisclosureSummary,
  NavigationRail,
  NavigationRailBody,
  NavigationRailFooter,
  NavigationRailHeader,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

beforeAll(enableReactActEnvironment);
afterEach(cleanupReactRoots);
afterAll(disableReactActEnvironment);

describe('navigation primitives', () => {
  it('connects Tabs and panels with complete ARIA relationships', () => {
    const markup = renderToStaticMarkup(
      <Tabs defaultValue="active">
        <TabList aria-label="Session state">
          <Tab value="active">Active</Tab>
          <Tab value="retired">Retired</Tab>
        </TabList>
        <TabPanel value="active">Active sessions</TabPanel>
        <TabPanel value="retired">Retired sessions</TabPanel>
      </Tabs>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    const panels = [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];

    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.tabIndex).toBe(0);
    expect(tabs[1]?.tabIndex).toBe(-1);
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panels[0]?.id);
    expect(panels[0]?.getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
    expect(panels[0]?.hidden).toBe(false);
    expect(panels[1]?.hidden).toBe(true);
  });

  it('supports automatic keyboard activation, disabled skipping, orientation, and RTL', () => {
    const onValueChange = vi.fn();
    const container = renderInDocument(
      <Tabs defaultValue="one" onValueChange={onValueChange}>
        <TabList aria-label="Examples" dir="rtl">
          <Tab value="one">One</Tab>
          <Tab disabled value="two">
            Two
          </Tab>
          <Tab value="three">Three</Tab>
        </TabList>
        <TabPanel value="one">One panel</TabPanel>
        <TabPanel value="two">Two panel</TabPanel>
        <TabPanel value="three">Three panel</TabPanel>
      </Tabs>
    );
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

    act(() => {
      tabs[0]?.focus();
      tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });
    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs[2]?.getAttribute('aria-selected')).toBe('true');
    expect(onValueChange).toHaveBeenCalledWith('three');

    act(() => {
      tabs[2]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
    });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('keeps manual and controlled Tabs authority explicit', () => {
    const onValueChange = vi.fn();
    const container = renderInDocument(
      <Tabs activationMode="manual" onValueChange={onValueChange} value="one">
        <TabList aria-label="Manual tabs">
          <Tab value="one">One</Tab>
          <Tab value="two">Two</Tab>
        </TabList>
        <TabPanel value="one">One panel</TabPanel>
        <TabPanel value="two">Two panel</TabPanel>
      </Tabs>
    );
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

    act(() => {
      tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.tabIndex).toBe(-1);
    expect(tabs[1]?.tabIndex).toBe(0);
    expect(onValueChange).not.toHaveBeenCalled();

    act(() => tabs[1]?.click());
    expect(onValueChange).toHaveBeenCalledWith('two');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.tabIndex).toBe(0);
  });

  it('keeps an enabled tab in the roving sequence when selection is unavailable', () => {
    const invalidContainer = renderInDocument(
      <Tabs onValueChange={() => undefined} value="missing">
        <TabList aria-label="Invalid controlled selection">
          <Tab value="one">One</Tab>
          <Tab value="two">Two</Tab>
        </TabList>
      </Tabs>
    );
    const invalidTabs = [...invalidContainer.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(invalidTabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);

    const disabledContainer = renderInDocument(<DisabledSelectedTabHarness />);
    const selectedTabs = [...disabledContainer.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(selectedTabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);

    act(() =>
      disabledContainer.querySelector<HTMLButtonElement>('[data-disable-selected]')?.click()
    );
    expect(selectedTabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    expect(selectedTabs[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('uses native Disclosure state while preserving controlled and uncontrolled authority', () => {
    const onOpenChange = vi.fn();
    const container = renderInDocument(<DisclosureHarness onOpenChange={onOpenChange} />);
    const details = container.querySelector<HTMLDetailsElement>('details');
    const summary = container.querySelector<HTMLElement>('summary');

    expect(details?.open).toBe(false);
    act(() => summary?.click());
    expect(details?.open).toBe(true);
    expect(details?.getAttribute('data-state')).toBe('open');
    expect(onOpenChange).toHaveBeenCalledWith(true);

    const lockedChange = vi.fn();
    const lockedContainer = renderInDocument(
      <Disclosure
        onOpenChange={lockedChange}
        onToggle={(event) => event.preventDefault()}
        open={false}
      >
        <DisclosureSummary>Controlled closed</DisclosureSummary>
        <DisclosurePanel>Hidden content</DisclosurePanel>
      </Disclosure>
    );
    const lockedDetails = lockedContainer.querySelector<HTMLDetailsElement>('details');
    act(() => lockedContainer.querySelector<HTMLElement>('summary')?.click());
    expect(lockedChange).toHaveBeenCalledWith(true);
    expect(lockedDetails?.open).toBe(false);
  });

  it('keeps Navigation Rail structural and accessibly named', () => {
    const markup = renderToStaticMarkup(
      <NavigationRail aria-label="Workspace navigation">
        <NavigationRailHeader>Agents</NavigationRailHeader>
        <NavigationRailBody>Records</NavigationRailBody>
        <NavigationRailFooter>Settings</NavigationRailFooter>
      </NavigationRail>
    );

    expect(markup).toContain('<nav aria-label="Workspace navigation"');
    expect(markup).toContain('data-slot="navigation-rail-header"');
    expect(markup).toContain('data-slot="navigation-rail-body"');
    expect(markup).toContain('data-slot="navigation-rail-footer"');
    expect(markup).not.toContain('style=');
  });
});

function DisclosureHarness({ onOpenChange }: { readonly onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        setOpen(nextOpen);
      }}
    >
      <DisclosureSummary>Reasoning</DisclosureSummary>
      <DisclosurePanel>Reasoning content</DisclosurePanel>
    </Disclosure>
  );
}

function DisabledSelectedTabHarness() {
  const [selectedDisabled, setSelectedDisabled] = useState(false);
  return (
    <>
      <button data-disable-selected onClick={() => setSelectedDisabled(true)} type="button">
        Disable selected tab
      </button>
      <Tabs onValueChange={() => undefined} value="two">
        <TabList aria-label="Dynamically disabled selection">
          <Tab value="one">One</Tab>
          <Tab disabled={selectedDisabled} value="two">
            Two
          </Tab>
        </TabList>
        <TabPanel value="one">One panel</TabPanel>
        <TabPanel value="two">Two panel</TabPanel>
      </Tabs>
    </>
  );
}
