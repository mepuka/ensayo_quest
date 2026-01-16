# Ensayo Quest 🗣️

> **Ensayo** (noun): *rehearsal, practice, trial, essay.*

Hey! Welcome to **Ensayo Quest**, a role-playing game for practicing spoken Spanish. 

If you've ever felt anxiety about speaking a new language, you know that "rehearsing" in a safe environment is key. This project creates a solo loop where you can practice real-world scenarios (like ordering at a restaurant or asking for directions) against an AI NPC, receiving instant feedback on your fluency and pronunciation.

## How it works

1.  **Pick a Scene**: Choose a topic (e.g., "Restaurant") and a difficulty level.
2.  **Speak**: The browser listens to you locally (using Whisper running right in your tab).
3.  **Receive Feedback**: We analyze your speech for fluency, vocabulary, and naturalness, giving you a score and tips for the next turn.

## Under the Hood

This isn't just a wrapper around an LLM API. We're building a robust, privacy-conscious voice stack:

*   **Runtime**: [Bun](https://bun.sh) (for everything local).
*   **Architecture**: Cloudflare Workers + Durable Objects (for state) + D1 (database).
*   **Logic**: Built 100% with [Effect](https://effect.website) for bulletproof type safety and error handling.
*   **Audio**: 
    *   **Browser**: `@huggingface/transformers` runs Whisper locally for immediate transcription.
    *   **VAD**: `@ricky0123/vad-web` handles voice activity detection so you don't have to press buttons.
    *   **Cloud**: We upload audio to R2 for advanced asynchronous scoring (pronunciation analysis).

## Getting Started

You'll need [Bun](https://bun.sh) installed.

1.  **Install dependencies:**
    ```bash
    bun install
    ```

2.  **Run the local development server:**
    ```bash
    bun run index.ts
    ```
    This starts the web server at `http://localhost:3000`.

3.  **Tests:**
    ```bash
    bun test
    ```

## Project Status

🚧 **Active MVP Construction** 🚧

We are currently building the "Vertical Slice" - a single functional conversation loop in Spanish. 

*   ✅ Local ASR (Whisper)
*   ✅ EventLog Architecture
*   🚧 Scoring Pipeline
*   🚧 NPC Logic

## License

MIT