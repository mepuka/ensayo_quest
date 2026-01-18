# Scenario & Language Learning Ontology Design

> **Design Document** — Brainstorming output for scenario-based language learning system
> Date: 2026-01-18 | Status: Draft

## Overview

This document defines the domain model for Ensayo Quest's scenario-based language learning system. The goal: dynamic, visually-rich scenarios where users speak Spanish to accomplish tasks, with immediate feedback and multiplayer support.

**Core experience example:** User sees a generated breakfast menu with images. Task: "Order 3 items." User speaks; items check off as recognized. Complication arises: "Your coffee came with milk—ask for it without." Scenario adapts to what the user actually said.

---

## Design Principles

1. **Decoupled domains** — Scoring, Scenario, and Vocabulary are separate concerns
2. **Vocabulary as reference** — VocabId is a stable identifier; services provide facets
3. **Scenario as interpreter** — Seeds define parameters; interpreter generates beats on demand
4. **Immediate + async feedback** — Fast checkoffs for engagement; detailed quality scores stream later
5. **Effect-aligned** — Immutable values, composable pipelines, service injection via Context.Tag

---

## Domain Architecture

```
┌─────────────┐     provides targets     ┌─────────────┐
│  Scenario   │ ───────────────────────► │   Scoring   │
│   Domain    │                          │   Domain    │
│             │ ◄─────────────────────── │             │
└─────────────┘     returns evaluation   └─────────────┘
       │                                        │
       │ resolves VocabIds                      │ resolves VocabIds
       ▼                                        ▼
┌─────────────────────────────────────────────────────┐
│                 Vocabulary Domain                    │
│   (lexical, visual, scoring, pedagogical facets)    │
└─────────────────────────────────────────────────────┘
```

Both Scenario and Scoring resolve vocabulary through the Vocabulary Domain, but for different facets—Scenario needs visuals and display, Scoring needs matchers and patterns.

---

## Vocabulary Domain

Vocabulary is the shared foundation. A `VocabId` is a stable reference; facet services provide different views.

### Core Types

```typescript
type VocabId = `vocab:${string}`      // e.g., "vocab:huevos"
type GrammarId = `grammar:${string}`  // e.g., "grammar:querer_present"
```

### Facet Services

| Service | Purpose | Returns |
|---------|---------|---------|
| `LexicalService` | Word data | `{ word, pos, english, conjugations?, examples }` |
| `VisualService` | Imagery | `{ imagePrompt, generatedUrl?, altText }` |
| `ScoringService` | Match patterns | `{ stems, synonyms, patterns, acceptableForms }` |
| `PedagogicalService` | Learning metadata | `{ level, frequency, topic, prerequisites }` |

### Why This Structure

- **Extensible**: Add `AudioService` for pronunciation without touching core types
- **Cacheable**: Each facet cached independently
- **Generatable**: LLM can generate facets on demand for new vocabulary
- **Testable**: Mock individual facets in tests

Grammar patterns follow the same model—`GrammarId` with corresponding facet services.

---

## Scenario Domain

### ScenarioSeed

The immutable input to scenario generation. Describes what kind of experience to create.

```typescript
type ScenarioSeed = {
  // Identity
  seedId: SeedId

  // Theme & Difficulty
  theme: string                    // "breakfast restaurant", "train station"
  level: "A1" | "A2" | "B1" | "B2"
  tone: "casual" | "formal" | "playful"
  region?: "spain" | "mexico" | "argentina"

  // Learning Targets
  vocabTargets: VocabId[]
  grammarTargets: GrammarId[]

  // Structure Hints
  complicationTypes: ComplicationType[]
  estimatedTurns: number

  // Multiplayer
  playerCount: number
  mode: "solo" | "cooperative" | "competitive"
  roleAssignment: "shared" | "divided" | "asymmetric"
  challenges?: ChallengeType[]

  // Visual Generation
  visualStyle: string              // "cartoon", "realistic", "minimalist"
  assetRequirements: AssetType[]   // "menu", "food_items", "setting_image"
}
```

**Seeds can be:**
- Pre-authored (curated experiences)
- User-configured (pick theme + level + options)
- Fully generated (LLM creates seed from loose prompt)

### ScenarioState

Runtime state maintained by the interpreter.

```typescript
type ScenarioState = {
  seed: ScenarioSeed

  // Progression
  currentPhase: "setup" | "interaction" | "complication" | "resolution" | "complete"
  turnHistory: TurnRecord[]

  // Tracking
  vocabElicited: Set<VocabId>
  grammarUsed: Set<GrammarId>
  complicationsFired: ComplicationType[]

  // Multiplayer
  playerStates: Map<PlayerId, PlayerProgress>
  challengeProgress: ChallengeState[]

  // Generated Assets (cached)
  generatedAssets: Map<AssetId, GeneratedAsset>
}
```

### ScenarioInterpreter

Service that generates beats on demand. Holds context, adapts to user actions.

```typescript
type ScenarioInterpreter = {
  // Initialize from seed, generate initial assets + prompt
  initialize: (seed: ScenarioSeed) => Effect<ScenarioState, GenerationError>

  // Given user utterance + evaluation, produce next beat
  advance: (
    state: ScenarioState,
    playerId: PlayerId,
    utterance: string,
    evaluation: Evaluation
  ) => Effect<ScenarioBeat, InterpreterError>

  // Check if scenario is complete
  isComplete: (state: ScenarioState) => boolean
}
```

### ScenarioBeat

What the interpreter produces—the next unit of experience.

```typescript
type ScenarioBeat = {
  type: "npc_prompt" | "task_update" | "complication" | "feedback" | "summary"
  content: string                  // NPC speech or instruction
  visualUpdates?: AssetUpdate[]    // new images, checkoffs
  targetUpdates?: TargetUpdate[]   // new vocab/grammar to listen for
  challengeUpdates?: ChallengeUpdate[]
}
```

---

## Scoring Domain

Fully decoupled from scenarios. Receives context and utterances, returns evaluations.

### ScoringContext

Input to the scoring pipeline.

```typescript
type ScoringContext = {
  utterance: string
  audioStats: AudioStats

  // Targets (provided by scenario)
  vocabTargets: VocabId[]
  grammarTargets: GrammarId[]

  // Context for LLM assessment
  situationalContext: string       // "ordering at a breakfast restaurant"
  expectedIntent: string           // "request food items from menu"
  conversationHistory: TurnSummary[]
}
```

### Evaluation

Output from the scoring pipeline.

```typescript
type Evaluation = {
  // Vocabulary (fast, local)
  vocabHits: VocabId[]
  vocabMisses: VocabId[]

  // Grammar (fast, pattern-based)
  grammarHits: GrammarId[]
  grammarIssues: GrammarIssue[]

  // Fluency (fast, from audio stats)
  fluencyScore: number             // 0-100
  fluencyFactors: FluencyFactors

  // Idiomaticity (async, LLM-based)
  idiomaticityScore: number        // 0-100
  idiomaticityNotes: string[]

  // Overall
  overallScore: number             // weighted composite
  feedback: FeedbackItem[]
}
```

### Scoring Pipeline

Effect-based concurrent evaluation.

```typescript
const score = (context: ScoringContext) =>
  Effect.all({
    vocab: scoreVocab(context),           // fast
    grammar: scoreGrammar(context),       // fast
    fluency: scoreFluency(context),       // fast
    idiomaticity: scoreIdiomaticity(context)  // async LLM
  }, { concurrency: "unbounded" })
```

Fast scores return immediately for checkoffs; idiomaticity streams in later.

---

## Visual Asset Generation

### Asset Types

```typescript
type AssetType =
  | "menu"           // composite: list of items with prices
  | "item_image"     // single vocabulary item (eggs, coffee)
  | "scene"          // background setting (restaurant interior)
  | "character"      // NPC representation (waiter, shopkeeper)
```

### AssetGenerator Service

```typescript
type AssetGenerator = {
  generateItemImage: (
    vocabId: VocabId,
    style: VisualStyle
  ) => Effect<GeneratedAsset, GenerationError>

  generateComposite: (
    type: "menu" | "scene",
    items: VocabId[],
    style: VisualStyle,
    theme: string
  ) => Effect<GeneratedAsset, GenerationError>
}
```

### GeneratedAsset

```typescript
type GeneratedAsset = {
  assetId: AssetId
  type: AssetType
  url: string                      // R2 storage URL
  vocabRefs: VocabId[]
  metadata: {
    prompt: string
    style: VisualStyle
    generatedAt: number
  }
}
```

### Caching Strategy

- Assets cached by `(vocabId, style)` tuple
- Same "huevos" in "cartoon" style reused across scenarios
- Reduces generation cost and latency for common vocabulary

---

## Multiplayer & Challenges

### PlayerProgress

```typescript
type PlayerProgress = {
  playerId: PlayerId
  role?: RoleId
  vocabElicited: Set<VocabId>
  turnsCompleted: number
  cumulativeScore: number
}
```

### Challenge Types

```typescript
type Challenge =
  | { type: "first_to_complete", target: number }
  | { type: "most_vocab_hits", timeLimit?: number }
  | { type: "highest_fluency", minTurns: number }
  | { type: "combo", streak: number }
  | { type: "speed_round", vocab: VocabId[], timeLimit: number }
```

### ChallengeState

```typescript
type ChallengeState = {
  challenge: Challenge
  status: "active" | "won" | "expired"
  leaderboard: Array<{ playerId: PlayerId, progress: number }>
  winner?: PlayerId
}
```

### Role Assignment (Asymmetric Mode)

```typescript
type Role = {
  roleId: RoleId
  label: string                    // "Customer", "Waiter"
  vocabSubset: VocabId[]
  promptStyle: string
}
```

Enables experiences like: one player orders, another takes the order—both practicing different vocabulary in the same scenario.

---

## Data Flow Summary

```
ScenarioSeed
    │
    ▼
Interpreter.initialize()
    │
    ├──► Generate initial assets (menu, scene)
    ├──► Generate opening NPC prompt
    └──► Return ScenarioState + ScenarioBeat

            ┌────────────────────────────────┐
            │         Game Loop              │
            └────────────────────────────────┘
                         │
User speaks ─────────────┤
                         ▼
              Scoring.evaluate(context)
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    vocabHits       fluencyScore   idiomaticity
    (immediate)     (immediate)    (async)
         │               │               │
         └───────────────┼───────────────┘
                         │
                         ▼
              Interpreter.advance(state, evaluation)
                         │
                         ▼
                   ScenarioBeat
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    NPC prompt     Visual updates   Challenge updates
         │               │               │
         └───────────────┴───────────────┘
                         │
                         ▼
                   UI renders
                         │
                         ▼
              (loop until complete)
```

---

## Feedback Model

Three tiers of feedback, optimized for engagement:

| Tier | Timing | Content | Purpose |
|------|--------|---------|---------|
| **Immediate** | <100ms | Vocab checkoffs, basic recognition | Dopamine loop |
| **Progressive** | 1-3s | Fluency score, grammar notes | Quality awareness |
| **Summary** | End of scenario | Detailed review, pronunciation tips, improvement suggestions | Learning reinforcement |

---

## Open Questions

1. **Vocabulary corpus**: How do we bootstrap the initial vocabulary set? Manual curation, import from existing datasets, or generate on demand?

2. **Grammar pattern matching**: How sophisticated should the grammar scorer be? Regex patterns, or full parse tree analysis?

3. **Complication generation**: How much context does the LLM need to generate good complications? Full transcript, or summarized state?

4. **Asset generation latency**: Pre-generate assets at seed time, or lazy-generate on first reference?

5. **Difficulty adaptation**: Should the interpreter adjust difficulty mid-scenario based on performance?

---

## Next Steps

1. **Deep research**: Investigate existing language learning ontologies and gameplay mechanics
2. **Prototype VocabId facet services**: Build out the vocabulary domain with a small corpus
3. **Prototype ScenarioInterpreter**: Implement seed → initial beat generation
4. **Integrate with existing scoring**: Connect new ScoringContext to current pipeline

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-18 | Initial design from brainstorming session | — |
