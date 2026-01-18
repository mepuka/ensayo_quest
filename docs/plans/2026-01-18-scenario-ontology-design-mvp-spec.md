# Scenario Ontology + Gamification MVP Spec (Architecture-Aligned)

Status: Draft v0 (initial synthesis)  
Date: 2026-01-18  
Sources: `docs/Gamification & Gameplay Mechanics for Language Learning.md`, `docs/plans/2026-01-18-scenario-ontology-design.md`, `docs/ARCHITECTURE.md`

## 1. Goals

1) Align scenario, scoring, and vocabulary abstractions with the current EventLog architecture.  
2) Encode gamification research into the MVP feedback loop without distorting learning outcomes.  
3) Define an MVP that is implementable in the existing Effect-based stack without breaking invariants.  

Non-goals for MVP: global leaderboards, punitive mechanics (hearts), full authoring tools, full multiplayer roles.

## 2. Architecture Alignment (Hard Constraints)

These constraints are non-negotiable and shape every design choice:

- EventLog is the single source of truth for room state.  
- All commands are idempotent via requestId (room creation, turn submission, audio upload).  
- Event append and projections are atomic via `journal.write().effect()` (no separate state writes).  
- Scoring runs in the Queue Consumer, not in the Durable Object (DO).  
- AudioUploaded gates scoring enqueue, not TurnAccepted.  
- DO alarms are idempotent (NPC generation guard).  
- WebSocket handlers validate sessions before processing.  

Open conflict to resolve: AGENTS summary mentions AdvanceStep after scoring, but `docs/ARCHITECTURE.md` and current code advance immediately after TurnAccepted. This spec follows `docs/ARCHITECTURE.md` and implementation unless updated.
Resolved: AdvanceStep remains immediate after TurnAccepted (scoring stays async).

## 3. Current System Baseline (What Exists Today)

Runtime boundaries:
- Web Client: ASR + UI.  
- Room Durable Object: EventLog, projection, WebSocket fanout.  
- Queue Consumer: scoring pipeline.  
- D1: scenario templates, turns, idempotency tables.  
- R2: audio blobs.  

Existing domain shapes:
- ScenarioTemplate: `topic`, `level`, `seedPrompt`, `turnPlan`, `roleRubrics`.  
- RoleRubric: `targetVocab`, `targetGrammar` by role.  
- TurnPlan: `objectiveIds` per turn, but objectives are not yet defined.  
- ScoringService: fluency + vocab + LLM naturalness (LanguageReview).  
- Room events: RoomInitialized, TurnAccepted, TurnAdvanced, NpcTurnGenerated, ScoreUpdated, AudioUploaded.  

## 4. MVP Decisions (Initial Constraints and Defaults)

1) Scenario generation stays template-based (no LLM scenario generation in MVP).  
2) Scenario templates act as ScenarioSeed for MVP (single source of scenario structure).  
3) Scoring pipeline remains queue-only; immediate feedback is client-local and non-authoritative.  
4) Gamification in MVP is supportive and contextual: narrative framing, XP for progress, meaningful feedback.  
5) No punitive mechanics (hearts, hard failures).  
6) Templates are immutable per version; RoomInitialized includes `templateVersion` hash for replay integrity.  
7) Grammar scoring is LLM-only in MVP (rubric-driven).  
8) Partial scoring events are emitted before final scoring (same event type with status).  
9) XP derives from final scores only (no XP from partial events).  

## 5. Domain Model (Unified)

### 5.1 Vocabulary Domain (Shared Foundation)

Vocabulary is a stable reference that scenario and scoring both consume.

```ts
type VocabId = `vocab:${string}`;     // "vocab:huevos"
type GrammarId = `grammar:${string}`; // "grammar:querer_present"

type LexicalFacet = {
  word: string;
  pos: string;
  english: string;
  examples: string[];
  conjugations?: Record<string, string>;
};

type ScoringFacet = {
  stems: string[];
  synonyms: string[];
  acceptableForms: string[];
  patterns: string[];
};

type PedagogicalFacet = {
  level: "A1" | "A2" | "B1" | "B2";
  frequency: number;
  topic: string[];
  prerequisites: VocabId[];
};

type VisualFacet = {
  imagePrompt: string;
  url?: string;
  altText: string;
};
```

Effect services (MVP):
- `VocabLexicalService`  
- `VocabScoringService`  
- `VocabPedagogyService`  
- `VocabVisualService` (optional for MVP)  

Caching: use `Effect.Cache` with TTL for facet lookup and generation.

### 5.2 Scenario Domain

MVP keeps templates and adds objectives as a first-class map.

```ts
type ScenarioObjective = {
  objectiveId: string;
  intent: string;
  vocabTargets: VocabId[];
  grammarTargets: GrammarId[];
};

type ScenarioSeed = {
  templateId: string;
  templateVersion: string;
  topic: string;
  level: "A1" | "A2" | "B1" | "B2";
  seedPrompt: string;
  turnPlan: TurnPlan[];
  objectives: ScenarioObjective[];
  visualStyle?: string;
  assetRequirements?: string[];
};
```

MVP interpreter is deterministic:
- Uses `turnPlan` and `objectives` to set expected targets.
- Produces `ScenarioBeat` via NpcTurnGenerated events or UI prompts.

```ts
type ScenarioBeat = {
  type: "npc_prompt" | "task_update" | "feedback" | "summary";
  content: string;
  targetUpdates?: { vocab: VocabId[]; grammar: GrammarId[] };
};
```

### 5.3 Scoring Domain

Aligns with current ScoringService but expands context to scenario objectives.

```ts
type ScoringContext = {
  turnId: string;
  transcript: string;
  audioStats: AudioStats;
  vocabTargets: VocabId[];
  grammarTargets: GrammarId[];
  expectedIntent: string;
  situationalContext: string;
  conversationHistory: Array<{ role: "user" | "npc"; text: string }>;
};
```

MVP evaluation outputs align to existing `TurnEvaluation`:
- `scores.fluency`, `scores.vocab`, `scores.naturalness`, `overallScore`, `feedback`, `nextPrompt`.
- Optional internal details (vocab hits, grammar hits) stored in `detail_json` only.
Grammar scoring (MVP):
- LLM-only via `LanguageReview` rubric (no rule-based grammar engine).
- Grammar targets still passed in `ScoringContext` to guide the rubric.

## 6. Data + Event Alignment

EventLog must be sufficient to replay room state:
- RoomInitialized includes `templateVersion` hash from immutable templates.  
- RoomProjection remains game state only.  

Template versioning semantics (MVP):
- `templateVersion` is SHA-256 of canonicalized `template_json` (sorted keys, no whitespace).  
- Templates are append-only: changes require a new templateId or new row version, never in-place mutation.  
- On load, if templateId exists but hash mismatch occurs, emit RoomError and mark room as legacy.  

Partial scoring semantics (MVP):
- `ScoreUpdated.status`: `"partial"` or `"final"`.  
- `scoreAttemptId`: stable per queue message to correlate partial + final.  
- Partial includes fast scores only; `feedback`, `nextPrompt`, and grammar notes are empty.  
- `overallScore` in partial is computed by renormalizing available weights (fluency + vocab).  
- Final replaces partial in client state; client ignores partial if final is already present.  

MVP event flow:
1) RoomInitialized (includes templateId + templateVersion + seedPrompt).  
2) TurnAccepted (user turn recorded).  
3) TurnAdvanced (immediate, no scoring gate).  
4) AudioUploaded (gates scoring enqueue).  
5) ScoreUpdated (partial: fast scores + placeholder feedback).  
6) ScoreUpdated (final: LLM scores + feedback).  
7) NpcTurnGenerated (optional; NPC prompt beats).  

ScoreUpdated should include:
- `status: "partial" | "final"`
- `scoreAttemptId` to prevent duplicate partials on retries

## 7. Gamification Integration (MVP)

Derived from research:
- Narrative framing: scenario is a story chapter, not a drill.  
- Immediate feedback with supportive tone, not punitive.  
- XP rewards tied to meaningful learning (vocab usage, clarity).  
- Optional streaks with grace period (Phase 2).  
- No hearts or failure walls.  

MVP mechanics:
- XP per turn: base XP + bonus for hitting objective targets.  
- XP derives from final scores only.  
- Session summary: "mission report" with wins and fixes.  
- Small achievements: "Completed 3 scenarios", "Used 10 new words".  

## 8. Effect-Native Implementation Guidance

Use Effect primitives as the default design idiom:

Service boundaries:
- `ScenarioRepo` (D1)  
- `ScenarioInterpreter` (deterministic MVP)  
- `ScoringService` (queue consumer)  
- `VocabFacetServices` (lexical, scoring, pedagogy, visual)  
- `AssetGenerator` (optional in MVP)  

Effect features:
- `Context.Tag` + `Layer` for DI.  
- `Effect.gen` for sequencing.  
- `Effect.fn` for tracing.  
- `Schema.TaggedError` for typed domain errors.  
- `Effect.Cache` for vocab + asset facet caching.  
- `Effect.all({ ... }, { concurrency })` for parallel scoring.  
- `Effect.retry` + `Schedule.exponential` for external calls.  
- `Effect.timeout` / `timeoutFail` for LLM calls.  

State machines:
- Future path: `@effect/experimental/Machine` + `ProcedureList` for scenario interpreter and room requests.  
- MVP path: keep existing EventLog flow, add small interpreter functions for turn planning.  

LLM usage:
- Use `LanguageReview` for naturalness and feedback with `LanguageModel.generateObject`.  
- Keep rubric versioned.  
- Only run LLM inside Queue Consumer.  
- Use `Effect.timeoutFail` and retry policy on LLM calls.  

## 9. MVP Implementation Steps (Suggested)

1) Add ScenarioObjective map to templates and expose in seed data.  
2) Introduce VocabId wrappers and simple facet services (lexical + scoring).  
3) Update scoring pipeline to use objective targets (vocab/grammar).  
4) Embed `templateVersion` hash in RoomInitialized.  
5) Add `status` + `scoreAttemptId` to ScoreUpdated and emit partial + final.  
6) Add minimal XP calculation in ScoreUpdated handling (client-facing).  
7) Optional: add NPC prompt generation stub (template-based).  

## 10. Phased Implementation Plan

Phase 0: Schema + versioning contract  
- Add `templateVersion` to RoomInitialized schemas (shared + server payload).  
- Add `status` + `scoreAttemptId` to ScoreUpdated schemas (shared + server payload).  
- Add `template_version` to scenario templates storage or encode in templateId (append-only rule).  
- Add canonical JSON hashing helper for `templateVersion`.  

Phase 1: Queue + scoring pipeline  
- Emit partial ScoreUpdated after fast scoring (fluency + vocab).  
- Run LLM review and emit final ScoreUpdated with same `scoreAttemptId`.  
- Enforce `Effect.timeoutFail` and retry policy on LLM calls.  

Phase 2: Client + projections  
- Update EventLog reducer to merge partial → final and ignore late partials.  
- Update UI to show provisional scores and "Scoring..." status.  
- Calculate XP from final scores only.  

Phase 3: Backward compatibility + monitoring  
- Treat rooms without `templateVersion` as legacy (no replay validation).  
- Add logging on templateVersion mismatch to surface drift.  
- Track partial/final latency metrics to tune scoring pipeline.  

## 11. Open Questions for Next Pass

1) Should XP/streaks be per-room or per-user? If per-user, where is profile state stored?  
2) Are assets (menus, images) required in MVP or Phase 2?  
