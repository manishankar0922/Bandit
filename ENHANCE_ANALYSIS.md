# Feature Analysis: "Enhance" (Prompt Engineering Automation)

### 1. Architectural Overview & Aggressive Instruction Execution
The enhance feature operates as an intermediary compilation step between the user’s raw input and the target LLM. It employs a highly aggressive, deterministic system prompt (`ai/prompts.js`) designed to overwrite fuzzy user intentions with strict structural discipline. 

* **Role Anchoring & Directive Forcing:** The system prompt forces the AI to write direct, declarative instructions (e.g., "Build X") rather than descriptive narratives (e.g., "The user wants X").
* **Zero-Tolerance Fact Invention:** The pipeline enforces hard negative constraints (`never add features or tech they didn't state`, `never invent specifics`). 
* **Abstract-to-Concrete Translation:** It actively identifies subjective filler (e.g., "make it user-friendly") and forces its translation into verifiable binary conditions (e.g., loading states, empty-field blocking, inline error handling).
* **Silent Process Enforcement:** The prompt utilizes an "analyze, then write" instruction pattern, which demonstrably reduces structural drift and placeholder-spam in smaller models (like Gemini Nano).

### 2. The `[placeholder]` Interception Loop
When critical architectural data is missing from the user's raw input, the enhance pipeline refuses to hallucinate assumptions. Instead, it is instructed to inject bracketed nouns (e.g., `[your stack]`).

* **Execution:** The client-side script (`script.js`) intercepts the LLM output using a global regex before it reaches the DOM.
* **Re-injection:** It parses these placeholders and forces a secondary, synchronous user-input loop (the "quick question" modal).
* **Boundary:** This ensures the final payload delivered to the target AI coding tool is deterministically complete and free of critical knowledge gaps.

### 3. Optimal Usage Scenarios
* **Scaffolding & Boilerplate Generation:** Highly effective when providing bare-bones requests (e.g., "create login page"), as the pipeline automatically injects mandatory production-grade requirements (responsive layout, error handling, secret management).
* **Context Compression:** Useful for stripping conversational fluff from legacy prompts and converting them into dense, high-signal tokens.
* **Cross-Model Normalization:** Ideal for users interacting with multiple AI tools (Cursor, Bolt, Lovable), as it normalizes the input format into a universal, machine-optimized structure (GOAL / CONTEXT / REQUIREMENTS / OUTPUT).

### 4. Limitations & Boundaries
* **Contextual Blindness:** The enhance feature operates solely on the text provided in the targeted DOM input field. It cannot read the user's codebase, terminal output, or external documentation, limiting its ability to infer highly specific domain logic.
* **Token Overhead on Simple Queries:** For strictly factual or hyper-specific targeted questions (e.g., "What is the CSS property for text wrapping?"), the aggressive transformation into a full spec (GOAL/CONTEXT/REQUIREMENTS) introduces unnecessary token bloat and latency.
* **Placeholder Extraction Failures:** If the underlying model disobeys the `[placeholder]` constraint format (e.g., outputting `<placeholder>` or descriptive text instead of a bracketed noun), the client-side regex interception will fail, resulting in incomplete prompt injection.
* **Rate Limiting & Latency:** The client enforces a strict 3000ms throttle per action to prevent race conditions. Furthermore, network latency during the round-trip API call can disrupt user flow, especially if the on-device model (Nano) fails over to a cloud provider.
