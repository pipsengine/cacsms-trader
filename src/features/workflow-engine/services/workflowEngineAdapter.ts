import type { ActionResult, ControlCommand, WorkflowSnapshot } from '../types/workflow';
import { getWorkflowSnapshot, subscribeWorkflowSources, workflowActions } from './workflowRuntime';

export interface WorkflowEngineAdapter {
  snapshot(): WorkflowSnapshot;
  /** Fires whenever any underlying store or the event bus changes. */
  subscribe(cb: () => void): () => void;
  reconcile(): Promise<ActionResult>;
  rerunStage(stage: number): Promise<ActionResult>;
  reevaluate(symbol?: string): Promise<ActionResult>;
  control(cmd: ControlCommand, reason: string): Promise<ActionResult>;
}

/** Production adapter: reads the app-level stage stores and sends commands to the bridge engines; it owns no state of its own. */
export function createCacsmsWorkflowAdapter(): WorkflowEngineAdapter {
  return {
    snapshot: () => getWorkflowSnapshot(),
    subscribe: subscribeWorkflowSources,
    reconcile: () => workflowActions.reconcile(),
    rerunStage: (stage) => workflowActions.rerunStage(stage),
    reevaluate: (symbol) => workflowActions.reevaluate(symbol),
    control: (cmd, reason) => workflowActions.control(cmd, reason),
  };
}

export const cacsmsWorkflowAdapter = createCacsmsWorkflowAdapter();
