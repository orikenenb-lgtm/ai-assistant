"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { Archive, Clock, GitBranch, History, Pause, Play, PlayCircle, Plus, Rocket, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert, Badge, Card } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { AsyncCombobox, type ComboOption } from "@/components/data/async-combobox";
import { useServerAction } from "@/hooks/use-server-action";
import { searchContactsAction } from "@/modules/crm/lookup-actions";
import { ACTION_PARAMS, DEFAULT_PARAMS } from "../action-params";
import { definitionSchema, type ActionType, type WorkflowDefinition, type WorkflowNode } from "../definition";
import { publishWorkflowAction, rotateWebhookTokenAction, runManuallyAction, saveDraftAction, setWorkflowStatusAction } from "../actions";
import { BuilderContext, NODE_TYPES, type FlowNode } from "./flow-nodes";
import { NodeConfig } from "./node-config";
import type { BuilderLookups } from "./rule-editor";

export type BuilderWorkflow = {
  id: string;
  name: string;
  status: string;
  publishedVersion: number | null;
  maxRunsPerEntityPerDay: number;
  hasWebhookToken: boolean;
  definition: WorkflowDefinition;
};

const STATUS_TONE = { draft: "neutral", active: "success", paused: "warning", archived: "outline" } as const;

function toFlow(def: WorkflowDefinition): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: def.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { config: n.config }, deletable: n.type !== "trigger" })),
    edges: def.edges.map((e) => toFlowEdge(e.id, e.source, e.target, e.branch ?? null)),
  };
}

function toFlowEdge(id: string, source: string, target: string, branch: string | null): Edge {
  return {
    id,
    source,
    target,
    sourceHandle: branch,
    className: branch === "true" ? "wf-edge-true" : branch === "false" ? "wf-edge-false" : undefined,
  };
}

function toDefinition(nodes: FlowNode[], edges: Edge[]): WorkflowDefinition {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, config: n.data.config, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } }) as WorkflowNode),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle === "true" || e.sourceHandle === "false" ? { branch: e.sourceHandle } : {}) })),
  };
}

function reaches(edges: Edge[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edges) if (e.source === cur) stack.push(e.target);
  }
  return false;
}

const shortId = () => Math.random().toString(36).slice(2, 8);

export function WorkflowBuilder(props: { workflow: BuilderWorkflow; availableActions: ActionType[]; lookups: BuilderLookups; canManage: boolean }) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}

function Builder({ workflow, availableActions, lookups, canManage }: { workflow: BuilderWorkflow; availableActions: ActionType[]; lookups: BuilderLookups; canManage: boolean }) {
  const t = useTranslations("automation");
  const tc = useTranslations("common");
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const initial = useMemo(() => toFlow(workflow.definition), [workflow.definition]);
  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [name, setName] = useState(workflow.name);
  const [maxRuns, setMaxRuns] = useState(workflow.maxRunsPerEntityPerDay);
  const [status, setStatus] = useState(workflow.status);
  const [version, setVersion] = useState(workflow.publishedVersion);
  const [selectedId, setSelectedId] = useState<string | null>(initial.nodes[0]?.id ?? null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(workflow.hasWebhookToken);
  const [testOpen, setTestOpen] = useState(false);
  const [testContact, setTestContact] = useState<ComboOption | null>(null);
  const [saved, setSaved] = useState(() => JSON.stringify({ d: toDefinition(initial.nodes, initial.edges), n: workflow.name, m: workflow.maxRunsPerEntityPerDay }));

  const readOnly = !canManage || status === "archived";
  const available = useMemo(() => new Set(availableActions), [availableActions]);
  const def = useMemo(() => toDefinition(nodes, edges), [nodes, edges]);
  const snapshot = JSON.stringify({ d: def, n: name.trim(), m: maxRuns });
  const dirty = snapshot !== saved;

  const structural = definitionSchema.safeParse(def);
  const issues = structural.success ? [] : [...new Set(structural.error.issues.map((i) => i.message))];
  const invalid = useMemo(() => {
    const bad = new Set<string>();
    for (const n of def.nodes) {
      if (n.type === "action" && (!available.has(n.config.action) || !ACTION_PARAMS[n.config.action].safeParse(n.config.params).success)) bad.add(n.id);
      if (n.type === "condition" && n.config.rules.length === 0) bad.add(n.id);
    }
    return bad;
  }, [def, available]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      if (readOnly) changes = changes.filter((c) => c.type === "select" || c.type === "dimensions");
      setNodes((ns) => applyNodeChanges(changes, ns));
      for (const c of changes) if (c.type === "select" && c.selected) setSelectedId(c.id);
      if (changes.some((c) => c.type === "remove" && c.id === selectedId)) setSelectedId(null);
    },
    [readOnly, selectedId],
  );
  const onEdgesChange = useCallback((changes: EdgeChange[]) => !readOnly && setEdges((es) => applyEdgeChanges(changes, es)), [readOnly]);

  const connect = useCallback(
    (conn: Connection | { source: string; target: string; sourceHandle: string | null }) => {
      const source = nodes.find((n) => n.id === conn.source);
      const target = nodes.find((n) => n.id === conn.target);
      if (!source || !target || source.id === target.id) return;
      if (target.type === "trigger") return void toast.error(t("triggerHasInput"));
      if (reaches(edges, target.id, source.id)) return void toast.error(t("cycle"));
      const branch = source.type === "condition" ? (conn.sourceHandle === "false" ? "false" : "true") : null;
      setEdges((es) =>
        addEdge(
          toFlowEdge(`e_${shortId()}`, source.id, target.id, branch),
          // A condition branch / a regular node has a single outgoing edge: replace the old one.
          es.filter((e) => !(e.source === source.id && (branch === null || e.sourceHandle === branch))),
        ),
      );
    },
    [nodes, edges, t],
  );

  const addNode = (type: "condition" | "action" | "delay") => {
    const anchor = nodes.find((n) => n.id === selectedId) ?? [...nodes].sort((a, b) => b.position.y - a.position.y)[0];
    const id = `${type}_${shortId()}`;
    const config: WorkflowNode["config"] =
      type === "condition"
        ? { match: "all", rules: [{ field: "contact.lifecycleStage", op: "eq", value: "customer" }] }
        : type === "delay"
          ? { amount: 1, unit: "hours" }
          : { action: (availableActions.includes("add_note") ? "add_note" : availableActions[0]) ?? "add_note", params: { ...DEFAULT_PARAMS.add_note } };
    const position = anchor ? { x: anchor.position.x, y: anchor.position.y + 150 } : { x: 0, y: 0 };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type, position, data: { config }, selected: true }]);
    setSelectedId(id);
    if (anchor) {
      const used = edges.filter((e) => e.source === anchor.id);
      if (anchor.type === "condition") {
        const free = ["true", "false"].find((b) => !used.some((e) => e.sourceHandle === b));
        if (free) setEdges((es) => [...es, toFlowEdge(`e_${shortId()}`, anchor.id, id, free)]);
      } else if (used.length === 0) {
        setEdges((es) => [...es, toFlowEdge(`e_${shortId()}`, anchor.id, id, null)]);
      }
    }
  };

  const updateConfig = (id: string, config: WorkflowNode["config"]) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { config } } : n)));
  const deleteNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
  };

  const save = useServerAction(saveDraftAction);
  const publish = useServerAction(publishWorkflowAction);
  const statusAction = useServerAction(setWorkflowStatusAction);
  const rotate = useServerAction(rotateWebhookTokenAction);
  const testRun = useServerAction(runManuallyAction);

  const hookUrl = (token: string) => `${window.location.origin}/api/automations/hooks/${token}`;

  const doSave = async () => {
    if (!structural.success) return false;
    const r = await save.run({ id: workflow.id, name: name.trim(), definition: def, maxRunsPerEntityPerDay: maxRuns });
    if (r.ok) {
      setSaved(snapshot);
      toast.success(t("saved"));
    }
    return r.ok;
  };
  const doPublish = async () => {
    if (invalid.size) return void toast.error(t("publishInvalid"));
    if (dirty && !(await doSave())) return;
    const r = await publish.run({ id: workflow.id });
    if (!r.ok) return;
    setVersion(r.data.version);
    setStatus("active");
    if (r.data.webhookToken) {
      setWebhookUrl(hookUrl(r.data.webhookToken));
      setHasToken(true);
    }
    toast.success(t("published", { version: r.data.version }));
    router.refresh();
  };
  const changeStatus = async (next: "paused" | "active" | "archived") => {
    const r = await statusAction.run({ id: workflow.id, status: next });
    if (!r.ok) return;
    if (next === "archived") return router.push("/automations");
    setStatus(next);
    router.refresh();
  };

  const selected = nodes.find((n) => n.id === selectedId);
  const trigger = def.nodes.find((n) => n.type === "trigger");
  const isWebhook = trigger?.type === "trigger" && trigger.config.kind === "webhook";

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Label htmlFor="wf-name" className="sr-only">
            {t("name")}
          </Label>
          <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={readOnly} className="max-w-sm font-medium" />
          <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`status.${status}` as "status.draft")}</Badge>
          {version !== null && <span className="hidden text-xs text-muted-foreground sm:inline">v{version}</span>}
          {dirty && !readOnly && <span className="text-xs text-warning-foreground">{t("unsaved")}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/automations/${workflow.id}/runs`}>
              <History /> {t("runs")}
            </Link>
          </Button>
          {canManage && status !== "archived" && (
            <>
              {status === "active" && (
                <Button variant="secondary" size="sm" onClick={() => setTestOpen(true)}>
                  <PlayCircle /> {t("testRun")}
                </Button>
              )}
              {status === "active" && (
                <Button variant="secondary" size="sm" loading={statusAction.pending} onClick={() => changeStatus("paused")}>
                  <Pause /> {t("pause")}
                </Button>
              )}
              {status === "paused" && (
                <Button variant="secondary" size="sm" loading={statusAction.pending} onClick={() => changeStatus("active")}>
                  <Play /> {t("resume")}
                </Button>
              )}
              <ConfirmDialog
                title={t("archiveConfirmTitle")}
                description={t("archiveConfirmBody")}
                confirmLabel={t("archive")}
                onConfirm={() => changeStatus("archived")}
                trigger={
                  <Button variant="ghost" size="sm">
                    <Archive /> {t("archive")}
                  </Button>
                }
              />
              <Button variant="secondary" size="sm" disabled={!dirty || !structural.success || !name.trim()} loading={save.pending} onClick={doSave}>
                <Save /> {t("saveDraft")}
              </Button>
              <Button size="sm" disabled={!structural.success || !name.trim()} loading={publish.pending} onClick={doPublish}>
                <Rocket /> {t("publish")}
              </Button>
            </>
          )}
        </div>
      </Card>

      {issues.length > 0 && (
        <Alert tone="danger" title={t("validationIssues")}>
          <ul className="list-disc ps-5">
            {issues.map((m) => (
              <li key={m}>{m.startsWith("automation.") ? t(m.slice("automation.".length) as "cycle") : m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {status === "active" && dirty && <Alert tone="info">{t("activeEditNote")}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden p-0">
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
              <span className="px-1 text-xs font-medium text-muted-foreground">
                <Plus className="inline size-3.5" aria-hidden /> {t("addStep")}
              </span>
              <Button variant="soft" size="sm" onClick={() => addNode("condition")}>
                <GitBranch /> {t("addCondition")}
              </Button>
              <Button variant="soft" size="sm" onClick={() => addNode("action")}>
                <Play /> {t("addAction")}
              </Button>
              <Button variant="soft" size="sm" onClick={() => addNode("delay")}>
                <Clock /> {t("addDelay")}
              </Button>
              <span className="ms-auto hidden text-xs text-muted-foreground xl:inline">{t("canvasHint")}</span>
            </div>
          )}
          <div dir="ltr" className="h-[62vh] min-h-[420px]" role="region" aria-label={t("canvasLabel")}>
            <BuilderContext.Provider value={{ lookups, invalid, available }}>
              <ReactFlow<FlowNode>
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={connect}
                onPaneClick={() => setSelectedId(null)}
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]}
                colorMode={resolvedTheme === "dark" ? "dark" : "light"}
                fitView
                fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
                minZoom={0.3}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </BuilderContext.Provider>
          </div>
        </Card>

        <Card className="p-4">
          {selected ? (
            <>
              <h2 className="mb-3 text-sm font-semibold">{t(`nodes.${selected.type}`)}</h2>
              <NodeConfig
                key={selected.id}
                node={{ id: selected.id, type: selected.type, config: selected.data.config, position: selected.position } as WorkflowNode}
                onChange={(config) => updateConfig(selected.id, config)}
                onDelete={() => deleteNode(selected.id)}
                lookups={lookups}
                available={available}
                disabled={readOnly}
                webhook={{
                  hasToken,
                  url: webhookUrl,
                  published: version !== null,
                  rotating: rotate.pending,
                  onRotate: async () => {
                    const r = await rotate.run({ id: workflow.id });
                    if (r.ok) {
                      setWebhookUrl(hookUrl(r.data.token));
                      setHasToken(true);
                    }
                  },
                }}
              />
              {selected.type === "trigger" && (
                <div className="mt-4 border-t border-border pt-4">
                  <Label htmlFor="wf-max-runs">{t("maxRunsPerDay")}</Label>
                  <Input
                    id="wf-max-runs"
                    type="number"
                    min={1}
                    max={1000}
                    value={maxRuns}
                    disabled={readOnly}
                    onChange={(e) => setMaxRuns(Math.min(1000, Math.max(1, Math.round(Number(e.target.value)) || 1)))}
                    className="mt-1.5 w-28"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{t("maxRunsHelp")}</p>
                </div>
              )}
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("selectNode")}</p>
          )}
        </Card>
      </div>

      {isWebhook && webhookUrl && !selected && (
        <Alert tone="warning" title={t("tokenShownOnce")}>
          <code dir="ltr" className="break-all text-xs">
            {webhookUrl}
          </code>
        </Alert>
      )}

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent closeLabel={tc("close")}>
          <DialogHeader>
            <DialogTitle>{t("testRun")}</DialogTitle>
            <DialogDescription>{t("testRunHelp")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="test-contact">{t("chooseContact")}</Label>
            <AsyncCombobox id="test-contact" value={testContact} onChange={setTestContact} search={searchContactsAction} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTestOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={!testContact}
              loading={testRun.pending}
              onClick={async () => {
                const r = await testRun.run({ id: workflow.id, contactId: testContact!.id });
                if (!r.ok) return;
                setTestOpen(false);
                toast.success(r.data.runId ? t("testStarted") : t("testSkipped"), {
                  action: { label: t("runs"), onClick: () => router.push(`/automations/${workflow.id}/runs`) },
                });
              }}
            >
              <PlayCircle /> {t("testRun")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
