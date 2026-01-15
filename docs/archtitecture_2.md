Great — let’s lock an MVP “**scoring + learning + gamification contract**” that you can implement with **local browser ASR**, and a **Cloudflare/Effect TS backend** that does (1) deep evaluation, (2) KB-grounded coaching, (3) room orchestration.

I’ll keep everything **MVP-simple**, but still “in the weeds” enough that your system has a real, extensible core.

---

## 1) MVP scoring philosophy

For MVP, you want **three layers**, each with a clear purpose:

1. **Capture layer (browser, instant)**

   * Record audio
   * Local ASR → transcript
   * Compute basic timing/fluency stats (VAD segmentation)
   * Show immediate “preview” feedback

2. **Evaluation layer (backend, authoritative)**

   * Validate transcript + features
   * Score using deterministic metrics + KB retrieval + LLM rubric
   * Produce **token-level annotations** for UI highlights
   * Compute XP events

3. **Learning layer (backend + client)**

   * Extract vocabulary used + missed target vocab
   * Provide “native alternatives” grounded in KB
   * Update SRS deck & progress

This matches how many automated scoring systems are described in the literature: extracting features from audio and/or transcripts, then learning/scoring on top. ([ISCA Archive][1])

---

## 2) The MVP contract: Scenario → Turn → Evaluation Result

### 2.1 ScenarioTemplate (QuestTemplate)

This is what your generator (LLM + KB) outputs *once* per quest.

**Key idea:** every quest template defines a **scoring contract**: objectives + target vocab + target grammar + register.

```ts
type CEFR = "A1"|"A2"|"B1"|"B2"|"C1";

type ScenarioTemplate = {
  templateId: string;
  topic: string;              // "pharmacy", "restaurant", "job_interview"
  level: CEFR;
  region: "ES"|"MX"|"AR"|"ANY";
  register: "informal"|"neutral"|"formal";

  roles: [
    { roleId: "A"; name: string; brief: string; },
    { roleId: "B"; name: string; brief: string; }
  ];

  // Deterministic “task achievement” scoring hinges on this.
  objectives: Array<{
    id: string;
    description: string;
    required: boolean;       // required vs bonus
    evidenceHints: string[]; // keywords/phrases OR semantic goal statements
  }>;

  // What vocab you want to “reward”
  targetVocab: Array<{
    id: string;
    lemma: string;            // "receta", "dolor", "devolver"
    pos: "N"|"V"|"ADJ"|"ADV"|"PHRASE";
    allowedForms?: string[];  // MVP: precomputed inflections/variants
    synonyms?: string[];
    example?: string;
    cefrHint?: CEFR;
  }>;

  // What grammar you want to “reward”
  targetGrammar: Array<{
    id: string;
    tag: "past_tense"|"subjunctive"|"formal_usted"|"object_pronouns"|"...";
    required: boolean;
  }>;

  // KB grounding
  kbQuery: {
    tags: string[];           // ["pharmacy","complaint"]
    difficulty: CEFR;
    register: "informal"|"neutral"|"formal";
  };

  // Turn prompts (minimal: 2–6 turns per quest)
  turnPlan: Array<{
    turnIndex: number;
    speaker: "A"|"B";
    prompt: string;
    timeLimitSec?: number;    // optional
    minSeconds?: number;      // guard against too-short answers
    objectiveIds: string[];   // which objectives are expected this turn
  }>;
};
```

### 2.2 TurnSubmission (client → backend)

You’ll submit a **transcript + timing features** as the canonical input.

Audio is optional in MVP (upload only if user opted in).

```ts
type TokenSpan = {
  text: string;
  startMs?: number;  // if available from ASR
  endMs?: number;
  conf?: number;     // 0..1, if ASR provides
};

type TurnSubmission = {
  roomId: string;
  turnId: string;
  templateId: string;
  turnIndex: number;
  speakerUserId: string;

  transcript: string;
  tokens?: TokenSpan[];     // if you can get word timestamps/conf

  // VAD / recording stats (easy to compute in-browser)
  audioStats: {
    totalMs: number;
    speechMs: number;
    silenceMs: number;
    segments: Array<{ startMs: number; endMs: number }>; // speech segments
  };

  // Optional
  audioRef?: { r2Key: string; mime: string; durationMs: number };
  asrMeta?: { engine: "whisper-web"|"whisper.cpp"|"parakeet"|"other"; model: string };
};
```

### 2.3 TurnEvaluationResult (backend → client)

This powers your UI highlights + gamification.

```ts
type Subscores = {
  fluency: number;       // 0..100
  vocab: number;         // 0..100
  grammar: number;       // 0..100
  relevance: number;     // 0..100 (objectives/task)
  pronunciation: number; // 0..100 (MVP proxy)
  naturalness: number;   // 0..100 (KB-grounded phrasing)
};

type AnnotationTag =
  | "target_vocab"
  | "new_vocab"
  | "objective_hit"
  | "grammar_issue"
  | "low_confidence_pron"
  | "native_phrase"
  | "filler"
  | "overused_phrase";

type TranscriptAnnotation = {
  startChar: number;
  endChar: number;
  tags: AnnotationTag[];
  meta?: Record<string, unknown>; // e.g., vocabId, suggestedRewrite, etc.
};

type TurnEvaluationResult = {
  turnId: string;
  subscores: Subscores;
  overall: number; // weighted

  objectives: Array<{
    id: string;
    met: boolean;
    evidence?: string;
  }>;

  vocab: {
    usedTargetVocabIds: string[];
    newVocab: Array<{ lemma: string; example: string; translation?: string }>;
    missedTargetVocabIds: string[];
    lexicalDiversity?: { mattr: number; uniqueLemmas: number };
    lexicalSophistication?: { freqBandHistogram: Record<string, number> };
  };

  pronunciation: {
    proxy: "asr_confidence";
    lowConfidenceSpans: Array<{ startChar: number; endChar: number; conf?: number }>;
  };

  feedback: {
    wins: string[];         // 2–4 bullets
    fixes: string[];        // 2–4 bullets
    correctedPhrases: Array<{ original: string; improved: string; why: string }>;
    oneLineCoachTip: string;
    nextDrillPrompt: string;
  };

  annotations: TranscriptAnnotation[];

  gamification: {
    xpAwarded: number;
    xpBreakdown: Array<{ reason: string; xp: number }>;
    badgesUnlocked?: string[];
  };
};
```

---

## 3) MVP scoring engine: what we can do *reliably* with transcript + timing

### 3.1 Fluency scoring (deterministic)

Fluency is one of the easiest to do well in MVP because VAD gives you clean timing.

Research summaries emphasize objective fluency measures like:

* **speech rate**
* **silent pause frequency & duration**
* **filled pauses** (“um/eh” equivalents)
* repairs (repetitions, self-corrections) ([British Council][2])

**MVP fluency metrics (compute in browser + re-check server):**

* `speechRateWpm = words / (totalMs / 60000)`
* `phonationTimeRatio = speechMs / totalMs` (higher is better) ([Southampton Blogs][3])
* `meanRunMs = avg(segmentDurationMs)` (longer = smoother) ([Southampton Blogs][3])
* `longPauseCount = count(pauses > 700ms)` (lower is better)
* `fillerCount = count(["eh","em","pues","este"] in transcript)` (simple list)

**Turn fluency score (example):**

* Start at 60
* * up to 20 based on phonationTimeRatio
* * up to 10 based on speechRateWpm within level band
* − up to 20 for long pauses & heavy filler usage
  (Clamp 0..100)

> Why this is defensible: the “speed / breakdown / repair” framing is standard in fluency measurement work. ([British Council][2])

---

### 3.2 Vocabulary use: “target coverage” + “diversity”

You want **two complementary views**:

1. Did they use the *right* words for the scenario?
2. Did they show *range* (not repeating the same small set)?

#### A) Target vocabulary coverage (MVP-simple, high value)

Because every scenario defines `targetVocab`, you can score deterministically:

* Tokenize transcript
* Normalize tokens (lowercase, strip punctuation)
* Match against `allowedForms` for each target vocab item
* Score:

  * +X per unique target vocab used (cap)
  * +bonus for phrase-level targets (“me gustaría”, “¿podría…?”)
  * +bonus if user used **required** grammar+vocab pair (e.g. formal register + “usted”)

This directly enables UI highlight: every matched instance gets `target_vocab` tag.

#### B) Lexical diversity (MVP: MATTR, not raw TTR)

Type–token ratio is common, but it’s **sensitive to sample length** (longer responses tend to get lower TTR even if they’re diverse). ([PMC][4])
So for MVP, use a sliding-window measure like **MATTR** (moving-average TTR) to reduce length bias. ([ASHA Publications][5])

You don’t need perfect lemmatization for MVP:

* Use a lightweight heuristic lemma strategy:

  * If token matches any `allowedForms`, map it to that lemma
  * Otherwise token-as-lemma (lowercased)
  * This is “good enough” to power diversity trends over time

#### C) Lexical sophistication (nice-to-have MVP, minimal implementation)

There’s a whole research lineage around lexical sophistication indices using **frequency, range, and n-gram frequency**. ([Wiley Online Library][6])
For MVP:

* Use a simple frequency band lookup (top 1k / 5k / 10k Spanish word list)
* Create a histogram: “how many words were above basic frequency?”

This is optional but it’s a great “leveling” mechanic (“You used 3 B2-ish words today”).

---

### 3.3 Relevance / objectives (task achievement)

This is where your scenario contract pays off.

**MVP approach:**

* Every turn declares `objectiveIds` expected.
* Each objective has `evidenceHints`.

Scoring:

* A deterministic pass:

  * keyword/phrase match for evidence hints
* A semantic pass:

  * embed transcript and embed objective statements
  * measure similarity (or LLM judge “met/not met”)

You can keep it cheap by only doing semantic checks for objectives not met by keywords.

---

### 3.4 Grammar scoring (MVP = LLM + a couple cheap heuristics)

Full Spanish grammar checking is hard to do perfectly in pure JS at MVP speed.

So do:

* **Heuristics**: presence of required tense markers, formal register markers (“usted”, “quisiera”, etc.)
* **LLM rubric**: ask for top 3 grammar issues + corrected phrases

This mirrors how automated systems often combine multiple feature types. ([ISCA Archive][1])

---

## 4) Pronunciation in MVP: what you can *actually* highlight

You’re right that “pronunciation highlighting” is hard without audio processing.

### 4.1 MVP pronunciation = “ASR confidence proxy”

Many Whisper-based pipelines can provide:

* word-level timestamps
* and in some wrappers, **confidence scores** per word. ([GitHub][7])

For MVP:

* compute `pronunciationScore` from:

  * percent of words above confidence threshold
  * penalty for clusters of low-confidence words

Then annotate transcript:

* low confidence spans → `low_confidence_pron`
* high confidence words (optionally) → “clear” badge

This is not perfect “phonetics,” but it correlates well with “how intelligible was the speech for an ASR model,” which is a reasonable training proxy for beginners.

### 4.2 Roadmap pronunciation (post-MVP): forced alignment + GOP

If/when you upload audio (opt-in) and want real phoneme-level feedback:

* forced alignment aligns transcript to audio using a pronunciation dictionary + acoustic model ([Montreal Forced Aligner][8])
* then compute **Goodness of Pronunciation (GOP)**, a likelihood-ratio style measure used heavily in pronunciation assessment ([ScienceDirect][9])

GOP and variants are widely cited and actively researched; it’s the classic base approach. ([ScienceDirect][9])

This likely won’t run inside Cloudflare Workers itself (CPU/time constraints), but you can keep the contract ready so you can later route audio to a GPU service.

---

## 5) KB-powered “naturalness” scoring & transcript highlights

This is your differentiator, and you can do it without insane complexity.

### 5.1 What “naturalness” means in MVP

Naturalness = “does this resemble how Spanish is typically phrased in similar contexts?”

For MVP:

* Retrieve top-k KB chunks for the scenario via Vectorize (filter by topic/level/register/region). Metadata filtering is an explicit Vectorize feature (with metadata indexes). ([Cloudflare Docs][10])
* Build a small phrase bank:

  * ask LLM to extract 10–20 “native phrases” relevant to the scenario from those chunks
* Then check:

  * which phrases appear (or near-match) in the user transcript
  * annotate them as `native_phrase`

This gives you:

* “You sounded natural here” highlights
* and very actionable upgrades (“use X instead of Y”)

### 5.2 Diversity / dynamism hooks

Use KB to avoid repetition:

* track which KB tags/phrases the user has seen recently
* bias retrieval towards underused tags/regions/registers
* reward “new phrase” usage

---

## 6) Gamification: map scores → XP → learning actions

### 6.1 XP events: make them explainable

Instead of “XP = f(score)” (opaque), compute XP as **sum of events**.

Example MVP XP breakdown:

| Event                 |                                Condition |          XP |
| --------------------- | ---------------------------------------: | ----------: |
| Turn complete         |                                   always |         +10 |
| Objective met         |                   per required objective |          +5 |
| Bonus objective       |                      per bonus objective |          +2 |
| Target vocab used     |                  per unique target lemma | +1 (cap 10) |
| New vocab discovered  |                            per new lemma |  +2 (cap 5) |
| Fluency improvement   |         beat 7-day baseline by threshold |      +1..+5 |
| “Clarity” improvement | fewer low-confidence spans than baseline |      +1..+3 |
| Redo (best-of-2)      |             improved overall score by +Δ |      +2..+6 |

### 6.2 End-of-scenario “round score”

At scenario end:

* compute a **RoundScore** per user:

  * average of turn overall scores (weighted by turn importance)
  * * objective completion bonus
* show:

  * “Round grade”
  * “You improved vs last week”
  * 3 things to practice next

### 6.3 SRS deck integration (learning payoff)

From the evaluation result:

* `newVocab` → add to personal deck
* `missedTargetVocab` → add as “quest vocab to review”
* `correctedPhrases` → add as phrase cards (these are gold)

---

## 7) UI: how to highlight transcript + make it feel like a game

### 7.1 MVP transcript highlighting components

You’ll render transcript with **spans**:

* ✅ **Target vocab**: highlight + tooltip (definition + example)
* 🧠 **Native phrase**: “natural” badge + show KB-sourced alternative phrases
* ⚠️ **Grammar issue**: underline + “tap to see correction”
* 🔊 **Low confidence pron**: dotted underline + “try again / speak clearer”
* 🎯 **Objective hit**: subtle icon next to phrase that satisfied objective

You can generate all of these from `annotations[]`.

### 7.2 Results screen layout

After a turn:

1. Big “Overall score” + XP gained
2. 5 subscore meters
3. Transcript with highlights
4. “Wins” and “Fixes”
5. “Try again” button (optional) with limited retries
6. “Next prompt ready for your friend” / “Waiting on friend”

---

## 8) Effect TS patterns: keep scoring deterministic + safe

### 8.1 Validate everything with schemas

* Validate `TurnSubmission` on ingress
* Validate LLM output on egress

Workers AI supports **JSON Mode** for structured outputs (so you don’t parse free text). ([Cloudflare Docs][11])

### 8.2 Recommended module boundaries

* `Scoring/Fluency.ts` (pure deterministic)
* `Scoring/Vocab.ts` (target coverage + MATTR)
* `Scoring/Relevance.ts` (objective match + embeddings)
* `Scoring/Naturalness.ts` (KB retrieval + phrase overlap)
* `Scoring/LLMRubric.ts` (JSON-mode call + schema validation)
* `Scoring/Combine.ts` (weighted blend → final)

### 8.3 Queue consumer is your scoring “runtime”

Queues are designed as a reliable buffer and don’t delete messages until consumed successfully. ([Cloudflare Docs][12])

Your queue consumer runs:

1. fetch turn + scenario contract from D1
2. retrieve KB context from Vectorize
3. compute deterministic metrics
4. call LLM rubric (JSON mode)
5. merge → write `TurnEvaluationResult`
6. notify Room DO

---

## 9) One important MVP guardrail: transcript uncertainty

Even good ASR can sometimes produce incorrect content; there are documented cases of Whisper hallucinating text in some settings. ([WIRED][13])

For language learning MVP (low-stakes), the practical fix is:

* **confidence gating**: if too many low-confidence spans, prompt a re-record
* never award “objective met” purely from one low-confidence segment
* show a “transcript quality” indicator

This improves fairness and user trust.

---

## Next step (concrete, buildable)

If you want, I’ll write the **exact MVP schemas** (Effect Schema style) for:

* `ScenarioTemplate`
* `TurnSubmission`
* `TurnEvaluationResult`
* `LLM rubric JSON schema`

…and then outline the scoring pipeline with clear weighting defaults (and where each piece runs: browser vs queue consumer).

[1]: https://www.isca-archive.org/slate_2025/marchal25_slate.pdf?utm_source=chatgpt.com "Towards explainable automatic spoken language ..."
[2]: https://www.britishcouncil.org/sites/default/files/de_jong_and_pacilly_2021_new_techniques_to_measure_fluency_in_speech_automatically_non-technical_summary.pdf?utm_source=chatgpt.com "New techniques to measure fluency in speech automatically"
[3]: https://blog.soton.ac.uk/langsnap/files/2013/04/LANGSNAP_dejong.pdf?utm_source=chatgpt.com "Analysis of fluency"
[4]: https://pmc.ncbi.nlm.nih.gov/articles/PMC8249744/?utm_source=chatgpt.com "Lexical Diversity, Lexical Sophistication, and Predictability ..."
[5]: https://pubs.asha.org/doi/abs/10.1044/2019_JSLHR-19-00226?utm_source=chatgpt.com "Measuring Lexical Diversity for Discourse Analysis in ..."
[6]: https://onlinelibrary.wiley.com/doi/abs/10.1002/tesq.194?utm_source=chatgpt.com "Automatically Assessing Lexical Sophistication: Indices ..."
[7]: https://github.com/linto-ai/whisper-timestamped?utm_source=chatgpt.com "linto-ai/whisper-timestamped: Multilingual Automatic ..."
[8]: https://montreal-forced-aligner.readthedocs.io/en/stable/user_guide/index.html?utm_source=chatgpt.com "User Guide — Montreal Forced Aligner 3.X documentation"
[9]: https://www.sciencedirect.com/science/article/abs/pii/S0167639399000448?utm_source=chatgpt.com "Phone-level pronunciation scoring and assessment for ..."
[10]: https://developers.cloudflare.com/vectorize/reference/metadata-filtering/?utm_source=chatgpt.com "Metadata filtering - Vectorize"
[11]: https://developers.cloudflare.com/workers-ai/features/json-mode/?utm_source=chatgpt.com "JSON Mode - Workers AI"
[12]: https://developers.cloudflare.com/queues/reference/how-queues-works/?utm_source=chatgpt.com "How Queues Works"
[13]: https://www.wired.com/story/hospitals-ai-transcription-tools-hallucination?utm_source=chatgpt.com "OpenAI's Transcription Tool Hallucinates. Hospitals Are Using It Anyway"

