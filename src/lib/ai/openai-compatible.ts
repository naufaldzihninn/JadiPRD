export type OpenAICompatibleMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ResponseFormat = { type: "json_object" };

interface CompletionOptions {
  apiKey?: string;
  baseUrl: string;
  maxTokens?: number;
  messages: OpenAICompatibleMessage[];
  model: string;
  responseFormat?: ResponseFormat;
  temperature?: number;
}

interface CompletionResponse {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export function normalizeOpenAIBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function parseSseCompletion(raw: string) {
  const content = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .filter((line) => line && line !== "[DONE]")
    .map((line) => {
      try {
        const data = JSON.parse(line) as CompletionResponse;
        return (
          data.choices?.[0]?.delta?.content ||
          data.choices?.[0]?.message?.content ||
          ""
        );
      } catch {
        return "";
      }
    })
    .join("");

  return content.trim();
}

function parseJsonCompletion(raw: string) {
  const data = JSON.parse(raw) as CompletionResponse;
  return data.choices?.[0]?.message?.content?.trim() || "";
}

export async function createOpenAICompatibleCompletion({
  apiKey,
  baseUrl,
  maxTokens,
  messages,
  model,
  responseFormat,
  temperature,
}: CompletionOptions) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(
    `${normalizeOpenAIBaseUrl(baseUrl)}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature,
        max_tokens: maxTokens,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
    }
  );

  const raw = await response.text();

  if (!response.ok) {
    let message = `OpenAI-compatible request failed with ${response.status}`;

    try {
      const data = JSON.parse(raw) as CompletionResponse;
      message = data.error?.message || message;
    } catch {
      message = raw || message;
    }

    throw new Error(message);
  }

  const content = raw.trim().startsWith("data:")
    ? parseSseCompletion(raw)
    : parseJsonCompletion(raw);

  if (!content) {
    throw new Error("OpenAI-compatible response kosong.");
  }

  return content;
}
