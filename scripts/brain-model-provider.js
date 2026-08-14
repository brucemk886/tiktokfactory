export function createCodexSdkModelProvider({ CodexClass, codexPath, root }) {
  if (!CodexClass) throw new Error("Codex SDK provider requires CodexClass.");
  return {
    id: "codex-sdk",
    async run({ model, reasoningEffort, prompt, outputSchema, signal }) {
      const codex = new CodexClass(codexPath ? { codexPathOverride: codexPath } : undefined);
      const thread = codex.startThread({
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { modelReasoningEffort: reasoningEffort } : {}),
        workingDirectory: root,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled"
      });
      return thread.run(prompt, { ...(outputSchema ? { outputSchema } : {}), signal });
    }
  };
}

export function createOpenAICompatibleModelProvider({
  id = "openai-compatible",
  endpoint,
  apiKey = "",
  headers = {},
  fetchImpl = globalThis.fetch
} = {}) {
  return {
    id,
    async run({ model, reasoningEffort, prompt, outputSchema, signal }) {
      if (!endpoint) throw new Error("Third-party model endpoint is not configured.");
      if (typeof fetchImpl !== "function") throw new Error("Fetch implementation is unavailable.");
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...headers
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          ...(outputSchema ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "structured_output", strict: true, schema: outputSchema }
            }
          } : {})
        }),
        signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Third-party model request failed (${response.status}): ${text.slice(0, 500)}`);
      const data = text ? JSON.parse(text) : {};
      const content = data.finalResponse ?? data.output_text ?? data.choices?.[0]?.message?.content ?? "";
      return {
        finalResponse: typeof content === "string" ? content : JSON.stringify(content),
        usage: data.usage || null,
        raw: data
      };
    }
  };
}
