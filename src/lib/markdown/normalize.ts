type Primitive = string | number | boolean | null;
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

interface EnsureMarkdownOptions {
  fallback: string;
  title?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is Primitive {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function toSentenceCase(key: string): string {
  const withSpaces = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/-/g, " ");

  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function asInlineValue(value: Primitive): string {
  if (value === null) {
    return "-";
  }

  return String(value);
}

function renderObjectAsBullets(value: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = toSentenceCase(rawKey);

    if (isPrimitive(rawValue)) {
      lines.push(`- **${key}:** ${asInlineValue(rawValue)}`);
      continue;
    }

    if (Array.isArray(rawValue)) {
      if (rawValue.length === 0) {
        lines.push(`- **${key}:** -`);
        continue;
      }

      lines.push(`- **${key}:**`);
      for (const item of rawValue) {
        if (isPrimitive(item)) {
          lines.push(`  - ${asInlineValue(item)}`);
        } else if (isRecord(item)) {
          lines.push("  -");
          for (const nestedLine of renderObjectAsBullets(item)) {
            lines.push(`    ${nestedLine}`);
          }
        }
      }
      continue;
    }

    if (isRecord(rawValue)) {
      lines.push(`- **${key}:**`);
      for (const nestedLine of renderObjectAsBullets(rawValue)) {
        lines.push(`  ${nestedLine}`);
      }
    }
  }

  return lines;
}

function renderSection(key: string, value: unknown): string {
  const heading = `## ${toSentenceCase(key)}`;

  if (isPrimitive(value)) {
    return `${heading}\n${asInlineValue(value)}\n`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${heading}\n-\n`;
    }

    const lines: string[] = [heading];

    for (const item of value) {
      if (isPrimitive(item)) {
        lines.push(`- ${asInlineValue(item)}`);
      } else if (isRecord(item)) {
        lines.push("- Item:");
        for (const nestedLine of renderObjectAsBullets(item)) {
          lines.push(`  ${nestedLine}`);
        }
      }
    }

    lines.push("");
    return lines.join("\n");
  }

  if (isRecord(value)) {
    const lines: string[] = [heading, ...renderObjectAsBullets(value), ""];
    return lines.join("\n");
  }

  return `${heading}\n-\n`;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith("```json")) {
    return trimmed.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
  }

  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```\s*/, "").replace(/\s*```$/, "").trim();
  }

  return trimmed;
}

function parseJsonLikeString(text: string): unknown | null {
  const normalized = stripCodeFence(text);

  if (!normalized.startsWith("{") && !normalized.startsWith("[")) {
    return null;
  }

  try {
    return JSON.parse(normalized) as JsonValue;
  } catch {
    return null;
  }
}

export function structuredToMarkdown(value: unknown, title = "Generated Document"): string {
  if (isPrimitive(value)) {
    return `# ${title}\n\n${asInlineValue(value)}`;
  }

  if (Array.isArray(value)) {
    const lines = [`# ${title}`, ""];

    for (const item of value) {
      if (isPrimitive(item)) {
        lines.push(`- ${asInlineValue(item)}`);
      } else if (isRecord(item)) {
        lines.push("- Item:");
        for (const nestedLine of renderObjectAsBullets(item)) {
          lines.push(`  ${nestedLine}`);
        }
      }
    }

    return lines.join("\n");
  }

  if (isRecord(value)) {
    const sections = Object.entries(value).map(([key, sectionValue]) =>
      renderSection(key, sectionValue)
    );

    return `# ${title}\n\n${sections.join("\n")}`.trim();
  }

  return `# ${title}\n\n-`;
}

export function ensureMarkdownContent(
  value: unknown,
  options: EnsureMarkdownOptions
): string {
  if (typeof value === "string") {
    const parsed = parseJsonLikeString(value);

    if (parsed && (Array.isArray(parsed) || isRecord(parsed))) {
      return structuredToMarkdown(parsed, options.title || "Generated Document");
    }

    return value;
  }

  if (Array.isArray(value) || isRecord(value)) {
    return structuredToMarkdown(value, options.title || "Generated Document");
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return options.fallback;
}
