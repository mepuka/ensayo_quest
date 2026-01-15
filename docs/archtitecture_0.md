Below is an **initial architecture** for a **full Cloudflare-stack**, **Effect TS–first** app that supports:

* **Scenario-based Spanish speaking** (Romance-language ready)
* **2+ users**, role-based, **async turn-taking** (with an optional live mode later)
* **Automatic transcription + scoring + feedback**
* A **knowledge base** (Spanish media) used for **prompting/RAG**, vocab decks, and “quests”
* A **gamified loop** (XP, streaks, duos, leagues)

I’m going to design it so you can start shipping an MVP quickly, while leaving room for “serious” evaluation later.

---

## 1) Cloudflare-native building blocks

This is the Cloudflare stack I’d use, and why:

### Core app hosting + API

* **Cloudflare Pages** for the web app frontend and routing; **Pages Functions** (Workers under the hood) for lightweight API routes. ([Cloudflare Docs][1])

  * Alternative: a separate Worker for the API, plus Pages for static assets.

### Stateful “rooms” for multiplayer/async scenarios

* **Durable Objects (DOs)** as the authoritative state machine for each scenario session (“room”), including role assignments, turn order, progress, and optional WebSockets for realtime updates. Durable Objects are explicitly recommended for coordination/multiplayer/collab patterns. ([Cloudflare Docs][2])

### Durable data

* **D1 (SQLite semantics)** for relational entities: users, sessions, turns, scores, vocab decks, achievements, etc. ([Cloudflare Docs][3])
* **R2** for large blobs: audio recordings, transcripts (optionally), and your knowledge base chunks / source documents. R2 has a first-class Workers binding API. ([Cloudflare Docs][4])

### Async processing

* **Cloudflare Queues** to offload heavy AI work (transcription + scoring) from the user request path, with guaranteed delivery semantics. ([Cloudflare Docs][5])
* **Cloudflare Workflows** to orchestrate multi-step pipelines (transcribe → evaluate → update room → generate feedback), including durable execution, retries, and the ability to wait for external events. ([Cloudflare Docs][6])

### AI + RAG

* **Workers AI** to run:

  * **Speech-to-text**: Whisper models are available (e.g. `@cf/openai/whisper-large-v3-turbo`). ([Cloudflare Docs][7])
  * **LLMs**: Llama 3.1 instruction models are available. ([Cloudflare Docs][8])
  * **Embeddings**: multilingual embedding models like **bge-m3**. ([Cloudflare Docs][9])
  * **Text-to-speech**: `@cf/myshell-ai/melotts` to voice NPCs/scenarios. ([Cloudflare Docs][10])
  * **Voice activity / turn detection**: `@cf/pipecat-ai/smart-turn-v2` if you later add realtime “when is user done speaking?” interactions. ([Cloudflare Docs][11])

* **Vectorize** as your vector DB for RAG over Spanish content. ([Cloudflare Docs][12])

* **AI Gateway** in front of Workers AI (and/or external providers) for caching/observability/security of model calls. ([Cloudflare Docs][13])

### Abuse protection

* **Turnstile** to protect signup/login and (more importantly) “expensive endpoints” like “submit audio for evaluation.” ([Cloudflare Docs][14])

### Optional realtime voice mode later

* Cloudflare has **Realtime / Calls** products and docs for building WebRTC apps and managed TURN/SFU. You can keep MVP async and add live later. ([Cloudflare][15])

---

## 2) Conceptual product model

Think in terms of **“Quests” + “Rooms” + “Turns”**.

### Entities (D1)

* **User**: id, handle, L1, target language, proficiency estimate, settings
* **Friendship / Duo**: userA, userB, status
* **QuestTemplate**: reusable scenario spec (“At the pharmacy”, “Job interview”, etc.)
* **Room (QuestInstance)**: createdAt, templateId, difficulty, roles, state
* **Turn**: roomId, speakerId, prompt, expected goals, audioR2Key, transcript, scores JSON, feedback JSON
* **VocabItem**: lemma, POS, translations, examples, SRS scheduling metadata
* **UserVocabProgress**: userId, vocabId, nextReviewAt, easeFactor, etc.
* **XPEvent / Achievement / Streak**: gamification tracking

### “Room state” (Durable Object)

* Current phase: `awaiting_user_A`, `awaiting_user_B`, `evaluating_turn`, `complete`
* Role assignments (e.g., “Cliente” vs “Farmacéutico”)
* Minimal conversation memory needed to generate the next prompt
* WebSocket connections (optional) to push updates (“your friend responded”)

Why DOs: they’re built for “multiplayer games, chat, collaborative apps,” i.e., exactly your “two friends in one scenario” coordination problem. ([Cloudflare Docs][2])

---

## 3) Core user flows

### Flow A: Create a duo quest (async roleplay)

1. User clicks “Start Duo Quest” → chooses theme or “surprise me”.
2. API Worker:

   * Creates `Room` row in D1
   * Instantiates `RoomDurableObject(roomId)`
3. DO generates or fetches a **scenario brief**:

   * setting/context
   * roles (A/B)
   * objective checklist (“success criteria”)
   * target difficulty (A2/B1/B2)
4. DO returns the first turn prompt for User A.

### Flow B: Submit a spoken turn

1. Browser records audio via `MediaRecorder` (WebM/Opus) and POSTs to `/api/rooms/:id/turns`.
2. Worker:

   * Validates Turnstile token (optional but recommended for cost control). ([Cloudflare Docs][16])
   * Streams body to **R2** as `audio/{roomId}/{turnId}.webm`. ([Cloudflare Docs][4])
   * Inserts `Turn` row in **D1** with status `queued`. ([Cloudflare Docs][3])
   * Publishes message to **Queues**: `{turnId, roomId, audioKey, userId, lang:"es"}`. ([Cloudflare Docs][5])
   * Returns immediately: `{turnId, status:"processing"}`

### Flow C: Background “Transcribe + Score + Coach”

A Queue consumer (or Workflow) processes the message:

1. Load audio from R2.
2. Run **Whisper** on Workers AI to transcribe Spanish audio. ([Cloudflare Docs][7])

   * (Later: chunk long recordings as per Cloudflare tutorial; this is a known pattern.) ([Cloudflare Docs][17])
3. Compute deterministic features (fast + stable):

   * speech rate (words/sec), pause ratio (if you have timestamps), duration
   * lexical diversity
   * grammar error signals (LLM-assisted or lightweight rules)
4. Call an LLM (Workers AI Llama, or via AI Gateway) to produce:

   * rubric scores (fluency, vocab, grammar, relevance, pronunciation proxy)
   * JSON feedback + suggested rewrites + “next quest hint”
   * extracted vocab items + example sentences
5. Store results in D1.
6. Notify the room DO to advance state:

   * mark turn complete
   * generate next prompt for the other player
   * optionally push websocket update (“your friend’s turn is ready”)

Workflows are a great fit if you want the scoring pipeline to be durable, multi-step, and resilient with retries and waiting for external events. ([Cloudflare Docs][6])

---

## 4) Knowledge base architecture (Spanish media → scenarios + vocab)

You described a “Spanish source text and speech KB” (YouTube, novels, articles). Architecturally, treat this as **Content Ingestion → Chunking → Embeddings → Retrieval → Prompting**.

### Storage model

* **R2**: canonical storage for raw source and cleaned text chunks (and optionally audio). ([Cloudflare Docs][4])
* **Vectorize**: semantic index over chunk embeddings, with metadata filters (difficulty, topic, source, register, country). Vectorize supports metadata and filtering, so you can ask “give me chunks about restaurants at B1 difficulty” (your own tagging). ([Cloudflare Docs][18])
* **D1**: source registry + chunk metadata + licensing flags.

### Ingestion pipeline (MVP)

Start with **manual / curated ingestion**, because it avoids a ton of legal/quality problems:

* Upload text you have rights to (public domain, CC, your own notes, user-submitted content).
* For YouTube: only store transcripts if you have permission; otherwise store **references** and small excerpts.

This matters because the broader web is increasingly restricting AI crawling and content reuse; you want to avoid building a product whose core feature depends on scraping content you don’t have rights to use. ([Reuters][19])

### Embeddings

Use a multilingual embedding model like **bge-m3** for Spanish. ([Cloudflare Docs][9])

* Generate embeddings in Workers via Workers AI.
* Upsert into Vectorize.

Cloudflare explicitly positions Vectorize as a vector DB for AI apps used with Workers. ([Cloudflare Docs][12])

### Retrieval for scenario prompting (RAG)

When generating a quest:

1. Decide target: topic + level + register + region (Spain/MX/etc.)
2. Query Vectorize for top-k chunks
3. Prompt LLM with:

   * scenario rubric (what you want tested)
   * retrieved chunks (short!)
   * “roles & objectives” template
4. Output:

   * scenario (setting + constraints)
   * role briefs
   * target vocab list (10–20 words)
   * “success criteria” checklist for deterministic relevance scoring

### Alternative: Cloudflare AI Search

Cloudflare also has **AI Search (formerly AutoRAG)**, a managed indexing/search layer that integrates with Vectorize/R2/Workers AI/AI Gateway. ([Cloudflare Docs][20])
But note: the **Website** data source is for domains you control and have onboarded. It won’t crawl arbitrary Spanish sites. ([Cloudflare Docs][21])
So AI Search is great if you’re indexing **your own** Spanish corpus sites, docs, or hosted content. For “YouTube / random web,” you’ll still do ingestion yourself.

---

## 5) Scoring system in this architecture (deterministic + agentic)

You want “LM agentic + deterministic program.” The key is: **determinism produces signals; the LLM produces interpretation + feedback**.

### Deterministic signals (computed from transcript + timing)

* **Fluency**

  * duration, words/sec
  * pause ratio (if you have word timestamps or VAD)
* **Lexical richness**

  * type-token ratio, unique lemmas, presence of target vocab
* **Grammar**

  * heuristic: agreement checks, verb tense mismatch *when prompt expects it*
  * plus “LLM-as-grammar-checker” but constrained to output JSON
* **Task completion / relevance**

  * checklist match: did they mention required info?
  * embeddings similarity to goal statements (Vectorize-style cosine similarity)

### LLM “Evaluator Agent”

Input:

* prompt + scenario constraints
* transcript
* deterministic signals
* rubric definition
  Output (strict JSON):
* `scores`: { fluency, grammar, vocab, relevance, pronunciation_proxy }
* `reasons`: short bullet points
* `corrections`: top 3 fixes
* `rewrite`: a better version at same meaning
* `next_drill`: 1 short drill prompt

### Pronunciation reality check

Pure LLM on transcript **can’t hear pronunciation**, so for MVP:

* Use “pronunciation proxy” from ASR confidence + error rate (imperfect but useful).
* Later: add specialized pronunciation scoring or phoneme alignment on a GPU backend.

Workers AI gives you:

* Whisper transcription ([Cloudflare Docs][7])
* optional voice/turn detection models like smart-turn-v2 for segmenting and turn-end detection ([Cloudflare Docs][11])

---

## 6) Gamification loop that matches “speaking-first”

Your core activity is: **Complete speaking turns inside quests**.

### Game mechanics

* **XP** = base XP per completed turn + bonus for:

  * low pause ratio improvement vs baseline
  * using target vocab correctly
  * completing objectives
* **Streaks**: “1 quest turn/day”
* **Duos**: shared streak bonus when both complete their turns
* **Ranked leagues**: weekly XP ladder (optional)
* **Badges/Achievements**:

  * “First flawless objective run”
  * “Used subjunctive correctly 10 times”
  * “No-English day” (if transcript contains no English)

### Feedback-as-reward

After each turn:

* Show “score breakdown”
* Show 3 corrections
* Give 5-word “power phrase” to reuse next time
* Offer “redo turn” for extra XP (but cap it)

### NPC voice + immersion

Use MeloTTS to voice scenario prompts or NPC responses for single-player and for narration. ([Cloudflare Docs][10])

---

## 7) How to lay this out as an Effect TS codebase

You said: “pure Effect TS as much as possible.” The main idea is:

* Treat every Cloudflare binding (D1, R2, Vectorize, Queue, AI) as a **Service** in Effect.
* Provide a per-request “runtime” that wires `env` → Layers.
* Keep your domain logic as pure Effects; keep Cloudflare runtime glue very thin.

There are known patterns for bridging Cloudflare’s request-time `env` bindings into Effect Layers. ([DEV Community][22])

### Suggested repo structure

```
/apps/web               # Cloudflare Pages frontend (React/Vite)
/apps/api               # Worker (Effect TS) for API + Queue consumers + Workflows + DOs

/apps/api/src
  /domain               # Room/Turn/Scoring models, pure logic
  /services
    D1.ts
    R2.ts
    Vectorize.ts
    Ai.ts               # Workers AI + AI Gateway wrapper
    Queue.ts
    RoomsDO.ts
  /http
    routes.ts
    handlers.ts
  /workflows
    EvaluateTurnWorkflow.ts
  /durable-objects
    RoomDurableObject.ts
  index.ts
```

### Cloudflare bindings you’ll declare

* `DB` (D1) ([Cloudflare Docs][23])
* `AUDIO_BUCKET` and `KB_BUCKET` (R2) ([Cloudflare Docs][24])
* `SPANISH_VECTORS` (Vectorize) ([Cloudflare Docs][25])
* `AI` (Workers AI binding) ([Cloudflare Docs][26])
* `TURN_QUEUE` (Queues) ([Cloudflare Docs][27])
* `ROOMS` (Durable Object namespace) ([Cloudflare Docs][28])
* optionally `AIG` (AI Gateway binding) ([Cloudflare Docs][13])

Cloudflare’s bindings model is explicitly how Workers access D1/R2/DO/etc. ([Cloudflare Docs][29])

### “Thin Worker, thick Effect” pattern

* `export default { fetch(req, env, ctx) { ... } }`
* parse request
* create per-request Runtime from env
* run Effect handler
* return Response

### Durable Object as your room state machine

Each `RoomDurableObject`:

* exposes methods like:

  * `createRoom(spec)`
  * `getState()`
  * `submitTurn(turnId)`
  * `advance()`
* can optionally hold a WebSocket list
* uses SQLite-backed DO storage if you want strongly consistent per-room persistence (Cloudflare notes SQLite-backed DO support and limits). ([Cloudflare Docs][2])

### Queues consumer as an Effect program

Queues are designed to offload work from request paths and guarantee delivery; ideal for “evaluate turn” jobs. ([Cloudflare Docs][5])

---

## 8) A concrete MVP plan (ship fast)

### MVP (2–4 weeks of focused build)

* **Async duo quest rooms**

  * generate scenario (LLM) + roles + objectives
  * turn submission (audio upload to R2)
  * background transcription + scoring
  * results screen + XP
* **Basic vocab deck**

  * auto-extract ~10 vocab items per quest and the learner’s “mistake phrases”
* **Friend invites**

  * magic link or invite code (don’t overbuild auth early)
* **Turnstile on submit**

  * protect AI spend

You can do all of this purely in Workers/Pages/DO/D1/R2/Queues/Workers AI.

### V2 (add the knowledge base)

* R2 + Vectorize ingestion UI
* chunk + embed
* scenario generation that cites retrieved chunks

### V3 (add “live mode”)

* WebRTC with Cloudflare Realtime/Calls for synchronous speaking
* smart-turn-v2 for “detect end of user speech”
* live coaching (TTS NPC + immediate feedback)

---

## 9) Brainstormed “quest” formats that fit your async two-user design

These are patterns that score well and feel game-like:

1. **Split-role negotiation**

   * A: tenant, B: landlord; objective: agree on price + move-in date
2. **Information gap**

   * Each user sees different info; must ask questions to complete task
3. **Branching dialogue**

   * choices unlock “next scene”; LLM generates next prompt based on state
4. **Timed challenge**

   * “30 seconds only” for fluency; fewer pauses = bonus XP
5. **Shadow + improv**

   * user listens to a short NPC (TTS), repeats key line, then improvs response
6. **Boss fight**

   * weekly “hard scenario”; score threshold unlocks badge

---

## 10) Key design decisions I’d lock in early

1. **Room = Durable Object**

   * DO is your single source of truth for state transitions. ([Cloudflare Docs][2])
2. **Audio + KB in R2**

   * Keep blobs out of D1. ([Cloudflare Docs][4])
3. **All AI calls go through AI Gateway**

   * Observability + caching + security. ([Cloudflare Docs][13])
4. **Scoring is JSON-schema enforced**

   * deterministic signals + LLM explanation, but parsed/validated strictly (Effect Schema).
5. **Start with curated KB**

   * avoid copyright/scraping problems; expand later.

---

If you want, next step I can do in the same direction (without asking you more questions) is:

* propose a **specific API surface** (`/rooms`, `/turns`, `/kb/sources`, `/vocab`)
* sketch the **RoomDurableObject state machine** (events + transitions)
* and provide a **minimal Effect TS Worker skeleton** showing: env→Layer injection, R2 upload, queue publish, and a queue consumer that runs Whisper + LLM scoring.

[1]: https://developers.cloudflare.com/pages/?utm_source=chatgpt.com "Overview · Cloudflare Pages docs"
[2]: https://developers.cloudflare.com/durable-objects/?utm_source=chatgpt.com "Overview · Cloudflare Durable Objects docs"
[3]: https://developers.cloudflare.com/d1/?utm_source=chatgpt.com "Overview · Cloudflare D1 docs"
[4]: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/?utm_source=chatgpt.com "Workers API reference - R2"
[5]: https://developers.cloudflare.com/queues/?utm_source=chatgpt.com "Overview · Cloudflare Queues docs"
[6]: https://developers.cloudflare.com/workflows/?utm_source=chatgpt.com "Overview · Cloudflare Workflows docs"
[7]: https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/?utm_source=chatgpt.com "whisper-large-v3-turbo - Workers AI"
[8]: https://developers.cloudflare.com/workers-ai/models/?utm_source=chatgpt.com "Models · Cloudflare Workers AI docs"
[9]: https://developers.cloudflare.com/workers-ai/models/bge-m3/?utm_source=chatgpt.com "bge-m3 - Workers AI"
[10]: https://developers.cloudflare.com/workers-ai/models/melotts/?utm_source=chatgpt.com "melotts - Workers AI"
[11]: https://developers.cloudflare.com/workers-ai/models/smart-turn-v2/?utm_source=chatgpt.com "smart-turn-v2 · Cloudflare Workers AI docs"
[12]: https://developers.cloudflare.com/vectorize/?utm_source=chatgpt.com "Overview · Cloudflare Vectorize docs"
[13]: https://developers.cloudflare.com/ai-gateway/usage/providers/workersai/?utm_source=chatgpt.com "Workers AI · Cloudflare AI Gateway docs"
[14]: https://developers.cloudflare.com/turnstile/?utm_source=chatgpt.com "Overview · Cloudflare Turnstile docs"
[15]: https://www.cloudflare.com/developer-platform/products/cloudflare-realtime/?utm_source=chatgpt.com "Cloudflare Realtime | Build real-time audio & video apps"
[16]: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/?utm_source=chatgpt.com "Validate the token · Cloudflare Turnstile docs"
[17]: https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-workers-ai-whisper-with-chunking/?utm_source=chatgpt.com "Whisper-large-v3-turbo with Cloudflare Workers AI"
[18]: https://developers.cloudflare.com/vectorize/get-started/intro/?utm_source=chatgpt.com "Introduction to Vectorize"
[19]: https://www.reuters.com/business/media-telecom/cloudflare-launches-tool-help-website-owners-monetize-ai-bot-crawler-access-2025-07-01/?utm_source=chatgpt.com "Cloudflare launches tool to help website owners monetize AI bot crawler access"
[20]: https://developers.cloudflare.com/ai-search/?utm_source=chatgpt.com "Cloudflare AI Search"
[21]: https://developers.cloudflare.com/ai-search/configuration/data-source/website/?utm_source=chatgpt.com "Website · Cloudflare AI Search docs"
[22]: https://dev.to/mmlngl/running-effect-ts-in-cloudflare-workers-without-the-pain-40a0?utm_source=chatgpt.com "Running Effect-TS in Cloudflare Workers Without the Pain"
[23]: https://developers.cloudflare.com/d1/worker-api/d1-database/?utm_source=chatgpt.com "D1 Database"
[24]: https://developers.cloudflare.com/r2/api/workers/workers-api-usage/?utm_source=chatgpt.com "Use R2 from Workers"
[25]: https://developers.cloudflare.com/vectorize/reference/client-api/?utm_source=chatgpt.com "Vectorize API"
[26]: https://developers.cloudflare.com/workers-ai/?utm_source=chatgpt.com "Overview · Cloudflare Workers AI docs"
[27]: https://developers.cloudflare.com/queues/get-started/?utm_source=chatgpt.com "Getting started · Cloudflare Queues docs"
[28]: https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/?utm_source=chatgpt.com "What are Durable Objects?"
[29]: https://developers.cloudflare.com/workers/runtime-apis/bindings/?utm_source=chatgpt.com "Bindings (env) - Workers"

