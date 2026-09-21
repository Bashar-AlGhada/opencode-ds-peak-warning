// v2 (opencode 2.x) bus-event catalog for the clock watchdog fan-in.
//
// Same role as CLOCK_EVENT_TYPES in src/clock.ts, but against the v2
// `OpenCodeEvent` union (@opencode/client): every dotted bus-event type the
// v2 TUI data layer can deliver. Any sign of life heals the shared clock via
// poke(); the /dspeak diagnostics row shows which types are alive vs silent.
// Types that are not bus events (rpc payloads, nested `type` literals inside
// message parts) are intentionally excluded.
//
// Pinned by scripts/sanity-check.mjs against the installed @opencode/client
// generated types, so a new client event fails loudly instead of going
// unwatched. Note: `SessionMessageContentUpdated` ("session.message.content.
// updated") exists in the generated types but is NOT a member of the V2Event
// union in @opencode/client 2.0.11, so it is not subscribable via data.on
// and is excluded here.

export const V2_TIER_LIFECYCLE = [
  "session.created",
  "session.deleted",
  "session.idle",
  "session.status",
  "session.viewed",
  "session.renamed",
  "session.moved",
  "session.forked",
  "session.permissions",
  "session.usage.updated",
  "session.agent.selected",
  "session.model.selected",
  "session.instructions.updated",
  "session.synthetic",
  "session.skill.activated",
] as const

export const V2_TIER_INTERACTION = [
  "tui.prompt.append",
  "tui.command.execute",
  "tui.session.select",
  "tui.toast.show",
] as const

export const V2_TIER_GENERATION = [
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.inbox.delivered",
  "session.inbox.enqueued",
  "session.inbox.cancelled",
  "session.inbox.delivery.changed",
  "session.step.started",
  "session.step.streamed",
  "session.step.ended",
  "session.step.failed",
  "session.text.started",
  "session.text.delta",
  "session.text.ended",
  "session.reasoning.started",
  "session.reasoning.delta",
  "session.reasoning.ended",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "session.tool.input.started",
  "session.tool.input.delta",
  "session.tool.input.ended",
  "session.compaction.started",
  "session.compaction.delta",
  "session.compaction.ended",
  "session.compaction.failed",
  "session.shell.started",
  "session.shell.ended",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
  "session.retry.scheduled",
] as const

export const V2_TIER_MISC = [
  "models-dev.refreshed",
  "integration.updated",
  "credential.updated",
  "credential.switched",
  "provider.updated",
  "model.updated",
  "agent.updated",
  "plugin.updated",
  "project.updated",
  "worktree.updated",
  "worktree.resolved",
  "command.updated",
  "config.updated",
  "skill.updated",
  "reference.updated",
  "filesystem.changed",
  "websearch.updated",
  "pty.created",
  "pty.updated",
  "pty.exited",
  "pty.deleted",
  "persistent-pty.added",
  "persistent-pty.removed",
  "shell.created",
  "shell.exited",
  "shell.deleted",
  "form.created",
  "form.replied",
  "form.cancelled",
  "permission.asked",
  "permission.replied",
  "vcs.branch.updated",
  "mcp.status.changed",
  "mcp.resources.changed",
  "installation.updated",
  "installation.update-available",
  "server.connected",
  "location.shutdown",
] as const

/** Every subscribed v2 bus event, tier order preserved (for diagnostics display). */
export const V2_EVENT_TYPES: readonly string[] = [
  ...V2_TIER_LIFECYCLE,
  ...V2_TIER_INTERACTION,
  ...V2_TIER_GENERATION,
  ...V2_TIER_MISC,
]
