// Shared error type thrown by every AI provider client (Gemini, Groq,
// OpenRouter). UI code can do `err instanceof AIClientError` to distinguish
// "the AI service told us something specific" from an unexpected bug.
export class AIClientError extends Error {}
