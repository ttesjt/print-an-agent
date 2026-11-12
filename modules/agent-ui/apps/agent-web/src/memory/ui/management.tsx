import {
  Button,
  Cluster,
  ConfirmationDialog,
  Dialog,
  FormField,
  Select,
  Stack,
} from '@print-an-agent/ui-react';
import type { WorkspaceEditBoundary } from '@print-an-agent/ui-workspace';
import { useMemo, useState, type ReactNode } from 'react';
import type { WebMemoryPorts } from '../contracts.js';
import { ContextMemoryPanel } from './context.js';
import { RetrievalMemoryPanel } from './retrieval.js';

interface Surfaces {
  readonly action?: ReactNode;
  readonly panel?: ReactNode;
  readonly boundary?: WorkspaceEditBoundary;
}
/** An optional Agent-level product extension. No Session navigation or resource ownership here. */
export function MemoryManagement({
  ports,
  agentId,
  children,
}: {
  readonly ports: WebMemoryPorts | undefined;
  readonly agentId: string | undefined;
  readonly children: (surfaces: Surfaces) => ReactNode;
}) {
  if (ports === undefined || agentId === undefined) return children({});
  return (
    <InstalledMemory key={agentId} ports={ports} agentId={agentId}>
      {children}
    </InstalledMemory>
  );
}
function InstalledMemory({
  ports,
  agentId,
  children,
}: {
  readonly ports: WebMemoryPorts;
  readonly agentId: string;
  readonly children: (surfaces: Surfaces) => ReactNode;
}) {
  const bindings = useMemo(
    () => [
      ...(ports.context === undefined
        ? []
        : (ports.capabilities.context?.bindings ?? []).map((binding) => ({
            ...binding,
            kind: 'context' as const,
          }))),
      ...(ports.retrieval === undefined
        ? []
        : (ports.capabilities.retrieval?.bindings ?? []).map((binding) => ({
            ...binding,
            kind: 'retrieval' as const,
          }))),
    ],
    [ports]
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('0');
  const [boundary, setBoundary] = useState<WorkspaceEditBoundary>();
  const [leave, setLeave] = useState<{ readonly next?: string }>();
  const binding = bindings[Number(selected)];
  const target = useMemo(
    () => (binding === undefined ? undefined : { agentId, memoryId: binding.memoryId }),
    [agentId, binding]
  );
  const change = (next?: string) => {
    if (boundary?.working) return;
    if (boundary?.dirty) {
      setLeave(next === undefined ? {} : { next });
      return;
    }
    if (next === undefined) setOpen(false);
    else setSelected(next);
  };
  if (bindings.length === 0) return children({});
  return children({
    action: <Button onClick={() => setOpen(true)}>Memory</Button>,
    ...(boundary === undefined ? {} : { boundary }),
    panel: (
      <>
        <Dialog
          open={open}
          title="Agent Memory"
          description={`Agent ${agentId} · explicit management only. Reads never create memory.`}
          dismissible={!boundary?.working}
          onOpenChange={() => change()}
          footer={
            <Cluster justify="end">
              <Button disabled={boundary?.working} onClick={() => change()}>
                Close Memory
              </Button>
            </Cluster>
          }
        >
          <Stack>
            <FormField label="Memory binding" disabled={boundary?.working ?? false}>
              {(props) => (
                <Select
                  {...props}
                  value={selected}
                  onChange={(event) => change(event.target.value)}
                >
                  {bindings.map((item, index) => (
                    <option key={`${item.kind}:${item.memoryId}`} value={index}>
                      {item.kind === 'context' ? 'Context' : 'Retrieval'} · {item.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {open &&
              target &&
              binding &&
              (binding.kind === 'context' && ports.context ? (
                <ContextMemoryPanel
                  key={`context:${binding.memoryId}`}
                  port={ports.context}
                  target={target}
                  report={setBoundary}
                />
              ) : (
                ports.retrieval && (
                  <RetrievalMemoryPanel
                    key={`retrieval:${binding.memoryId}`}
                    port={ports.retrieval}
                    target={target}
                    embeddings={ports.capabilities.retrieval?.embeddings ?? []}
                    report={setBoundary}
                  />
                )
              ))}
          </Stack>
        </Dialog>
        <ConfirmationDialog
          open={leave !== undefined}
          title="Discard Memory edits?"
          description="Unsaved edits or an unconfirmed request remain. Leaving does not roll back any committed operation."
          cancelLabel="Keep editing"
          confirmLabel="Discard and leave"
          onOpenChange={() => setLeave(undefined)}
          onConfirm={() => {
            boundary?.discard();
            if (leave?.next === undefined) setOpen(false);
            else setSelected(leave.next);
            setLeave(undefined);
          }}
        />
      </>
    ),
  });
}
