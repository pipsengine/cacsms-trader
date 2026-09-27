import type { WorkflowSnapshot } from '../types/workflow';
import type { Position } from '../../../types';
import { bindWorkflowDeps, getWorkflowSnapshot, workflowActions } from './workflowRuntime';

export interface WorkflowEngineAdapter {
  snapshot(): Promise<WorkflowSnapshot>;
  subscribe?(cb: (s: WorkflowSnapshot) => void): () => void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  reevaluate(symbol?: string): Promise<void>;
  retry(stage: number): Promise<void>;
  setExecution(enabled: boolean): Promise<void>;
}

export type WorkflowRuntimeBindings = {
  getAuto: () => boolean;
  setAuto: (v: boolean) => void;
  getRiskLimit: () => number;
  getPositions: () => Position[];
};

/** Production adapter bound to Cacsms Trader world model, event bus, orchestrator and trading context. */
export function createCacsmsWorkflowAdapter(bindings: WorkflowRuntimeBindings): WorkflowEngineAdapter {
  bindWorkflowDeps(bindings);
  return {
    async snapshot() {
      bindWorkflowDeps(bindings);
      return getWorkflowSnapshot();
    },
    async pause() {
      workflowActions.pause();
    },
    async resume() {
      workflowActions.resume();
    },
    async reevaluate(symbol) {
      workflowActions.reevaluate(symbol);
    },
    async retry(stage) {
      workflowActions.retry(stage);
    },
    async setExecution(enabled) {
      await workflowActions.setExecution(enabled);
    },
  };
}

/** Safe local fallback used only when a page mounts without bindings. */
export const demoWorkflowAdapter: WorkflowEngineAdapter = createCacsmsWorkflowAdapter({
  getAuto: () => true,
  setAuto: () => undefined,
  getRiskLimit: () => 0.5,
  getPositions: () => [],
});
