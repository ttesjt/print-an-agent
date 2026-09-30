import {
  useCallback,
  createContext,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { assignRef } from '../internal/refs.js';
import { joinStyleHooks } from '../internal/style-hooks.js';
import { useControllableState } from '../internal/use-controllable-state.js';

export type TabsActivationMode = 'automatic' | 'manual';
export type TabsOrientation = 'horizontal' | 'vertical';

interface TabsContextValue {
  readonly activationMode: TabsActivationMode;
  readonly baseId: string;
  readonly focus: (value: string) => void;
  readonly focusableValue: string | undefined;
  readonly orientation: TabsOrientation;
  readonly register: (value: string, element: HTMLButtonElement, disabled: boolean) => () => void;
  readonly selectedValue: string;
  readonly select: (value: string) => void;
}

interface RegisteredTab {
  readonly disabled: boolean;
  readonly element: HTMLButtonElement;
  readonly value: string;
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

type NativeTabsProps = Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'style'>;

interface SharedTabsProps extends NativeTabsProps {
  readonly activationMode?: TabsActivationMode;
  readonly onValueChange?: (value: string) => void;
  readonly orientation?: TabsOrientation;
  readonly style?: never;
}

interface ControlledTabsProps extends SharedTabsProps {
  readonly defaultValue?: never;
  readonly value: string;
}

interface UncontrolledTabsProps extends SharedTabsProps {
  readonly defaultValue: string;
  readonly value?: never;
}

export type TabsProps = ControlledTabsProps | UncontrolledTabsProps;

export function Tabs({
  activationMode = 'automatic',
  className,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  value,
  ...props
}: TabsProps) {
  const baseId = useId();
  const [selectedValue, setSelectedValue] = useControllableState({
    defaultValue: defaultValue ?? value,
    onValueChange,
    value,
  });
  const [focusableValue, setFocusableValueState] = useState<string | undefined>(selectedValue);
  const registeredTabs = useRef(new Map<string, RegisteredTab>());
  const focusableValueRef = useRef(focusableValue);
  const selectedValueRef = useRef(selectedValue);
  const previousSelectedValueRef = useRef(selectedValue);
  const rovingFocusMovedRef = useRef(false);
  selectedValueRef.current = selectedValue;
  focusableValueRef.current = focusableValue;

  const setFocusableValue = useCallback((nextValue: string | undefined) => {
    if (focusableValueRef.current === nextValue) return;
    focusableValueRef.current = nextValue;
    setFocusableValueState(nextValue);
  }, []);

  const reconcileFocusableValue = useCallback(() => {
    const enabledTabs = orderedEnabledTabs(registeredTabs.current);
    const selectedTab = enabledTabs.find((tab) => tab.value === selectedValueRef.current);
    const currentTab = enabledTabs.find((tab) => tab.value === focusableValueRef.current);
    const nextTab =
      (!rovingFocusMovedRef.current ? selectedTab : undefined) ??
      currentTab ??
      selectedTab ??
      enabledTabs[0];
    setFocusableValue(nextTab?.value);
  }, [setFocusableValue]);

  const register = useCallback(
    (tabValue: string, element: HTMLButtonElement, disabled: boolean) => {
      const existing = registeredTabs.current.get(tabValue);
      if (existing !== undefined && existing.element !== element) {
        throw new Error(`Tab value must be unique within Tabs: ${tabValue}`);
      }
      registeredTabs.current.set(tabValue, { disabled, element, value: tabValue });
      reconcileFocusableValue();

      return () => {
        if (registeredTabs.current.get(tabValue)?.element !== element) return;
        registeredTabs.current.delete(tabValue);
        reconcileFocusableValue();
      };
    },
    [reconcileFocusableValue]
  );

  const focus = useCallback(
    (tabValue: string) => {
      rovingFocusMovedRef.current = true;
      setFocusableValue(tabValue);
    },
    [setFocusableValue]
  );

  const select = useCallback(
    (tabValue: string) => {
      rovingFocusMovedRef.current = false;
      setFocusableValue(tabValue);
      setSelectedValue(tabValue);
    },
    [setFocusableValue, setSelectedValue]
  );

  useLayoutEffect(() => {
    if (previousSelectedValueRef.current !== selectedValue) {
      previousSelectedValueRef.current = selectedValue;
      rovingFocusMovedRef.current = false;
    }
    reconcileFocusableValue();
  }, [reconcileFocusableValue, selectedValue]);

  return (
    <TabsContext.Provider
      value={{
        activationMode,
        baseId,
        focus,
        focusableValue,
        orientation,
        register,
        selectedValue,
        select,
      }}
    >
      <div
        {...props}
        className={joinStyleHooks('ta-ui-tabs', className)}
        data-activation={activationMode}
        data-orientation={orientation}
        data-slot="tabs"
      />
    </TabsContext.Provider>
  );
}

type NativeTabListProps = Omit<ComponentPropsWithRef<'div'>, 'aria-orientation' | 'role' | 'style'>;

export interface TabListProps extends NativeTabListProps {
  readonly style?: never;
}

export function TabList({ className, ...props }: TabListProps) {
  const { orientation } = useTabsContext('TabList');

  return (
    <div
      {...props}
      aria-orientation={orientation}
      className={joinStyleHooks('ta-ui-tab-list', className)}
      data-orientation={orientation}
      data-slot="tab-list"
      role="tablist"
    />
  );
}

type NativeTabProps = Omit<
  ComponentPropsWithRef<'button'>,
  'aria-controls' | 'aria-selected' | 'role' | 'style' | 'tabIndex' | 'type'
>;

export interface TabProps extends NativeTabProps {
  readonly style?: never;
  readonly value: string;
}

export function Tab({
  className,
  disabled = false,
  onClick,
  onFocus,
  onKeyDown,
  ref,
  value,
  ...props
}: TabProps) {
  const context = useTabsContext('Tab');
  const internalRef = useRef<HTMLButtonElement | null>(null);
  const selected = context.selectedValue === value;
  const focusable = context.focusableValue === value && !disabled;

  const setTabRef = useCallback(
    (node: HTMLButtonElement | null) => {
      internalRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );

  useLayoutEffect(() => {
    const element = internalRef.current;
    if (element === null) return;
    return context.register(value, element, disabled);
  }, [context.register, disabled, value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    const nextTab = tabForKeyboardEvent(event, context.orientation);
    if (nextTab === undefined) return;

    event.preventDefault();
    nextTab.focus();
    if (context.activationMode === 'automatic') {
      const nextValue = nextTab.dataset.value;
      if (nextValue !== undefined) context.select(nextValue);
    }
  };

  return (
    <button
      {...props}
      aria-controls={panelId(context.baseId, value)}
      aria-selected={selected}
      className={joinStyleHooks('ta-ui-tab', className)}
      data-selected={selected || undefined}
      data-slot="tab"
      data-value={value}
      disabled={disabled}
      id={tabId(context.baseId, value)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) context.select(value);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        context.focus(value);
      }}
      onKeyDown={handleKeyDown}
      ref={setTabRef}
      role="tab"
      tabIndex={focusable ? 0 : -1}
      type="button"
    />
  );
}

type NativeTabPanelProps = Omit<
  ComponentPropsWithRef<'div'>,
  'aria-labelledby' | 'hidden' | 'role' | 'style' | 'tabIndex'
>;

export interface TabPanelProps extends NativeTabPanelProps {
  readonly style?: never;
  readonly value: string;
}

export function TabPanel({ className, value, ...props }: TabPanelProps) {
  const context = useTabsContext('TabPanel');
  const selected = context.selectedValue === value;

  return (
    <div
      {...props}
      aria-labelledby={tabId(context.baseId, value)}
      className={joinStyleHooks('ta-ui-tab-panel', className)}
      data-selected={selected || undefined}
      data-slot="tab-panel"
      hidden={!selected}
      id={panelId(context.baseId, value)}
      role="tabpanel"
      tabIndex={0}
    />
  );
}

function useTabsContext(componentName: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (context === undefined) {
    throw new Error(`${componentName} must be rendered inside Tabs.`);
  }
  return context;
}

function tabId(baseId: string, value: string): string {
  return `${baseId}-tab-${encodeURIComponent(value)}`;
}

function panelId(baseId: string, value: string): string {
  return `${baseId}-panel-${encodeURIComponent(value)}`;
}

function tabForKeyboardEvent(
  event: KeyboardEvent<HTMLButtonElement>,
  orientation: TabsOrientation
): HTMLButtonElement | undefined {
  const list = event.currentTarget.closest<HTMLElement>('[role="tablist"]');
  if (list === null) return undefined;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
  const currentIndex = tabs.indexOf(event.currentTarget);
  if (currentIndex < 0 || tabs.length === 0) return undefined;

  if (event.key === 'Home') return tabs[0];
  if (event.key === 'End') return tabs.at(-1);

  let offset: number | undefined;
  if (orientation === 'vertical') {
    if (event.key === 'ArrowDown') offset = 1;
    if (event.key === 'ArrowUp') offset = -1;
  } else {
    const direction = nearestDirection(event.currentTarget);
    if (event.key === 'ArrowRight') offset = direction === 'rtl' ? -1 : 1;
    if (event.key === 'ArrowLeft') offset = direction === 'rtl' ? 1 : -1;
  }

  if (offset === undefined) return undefined;
  return tabs[(currentIndex + offset + tabs.length) % tabs.length];
}

function nearestDirection(element: HTMLElement): 'ltr' | 'rtl' {
  const explicitDirection = element.closest<HTMLElement>('[dir]')?.dir;
  if (explicitDirection === 'rtl') return 'rtl';
  const computedDirection = element.ownerDocument.defaultView?.getComputedStyle(element).direction;
  if (computedDirection === 'rtl') return 'rtl';
  return element.ownerDocument.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
}

function orderedEnabledTabs(tabs: ReadonlyMap<string, RegisteredTab>): readonly RegisteredTab[] {
  return [...tabs.values()].filter((tab) => !tab.disabled).sort(compareDocumentOrder);
}

function compareDocumentOrder(left: RegisteredTab, right: RegisteredTab): number {
  if (left.element === right.element) return 0;
  const position = left.element.compareDocumentPosition(right.element);
  const node = left.element.ownerDocument.defaultView?.Node;
  if (node !== undefined && (position & node.DOCUMENT_POSITION_FOLLOWING) !== 0) return -1;
  if (node !== undefined && (position & node.DOCUMENT_POSITION_PRECEDING) !== 0) return 1;
  return 0;
}
