# Context7 (Installation & Usage)

Quick guide for integrating Context7 into this project (`aither`).

- Installed package: `@upstash/context7-sdk`
- Environment variable: `CONTEXT7_API_KEY` (API key in the format `ctx7sk_...`)

Example (TypeScript):

```ts
import { Context7 } from "@upstash/context7-sdk";

const client = new Context7({ apiKey: process.env.CONTEXT7_API_KEY });

async function getDocs(libraryName: string, question: string) {
  const libs = await client.searchLibrary(question, libraryName);
  if (!libs || libs.length === 0) return null;
  const lib = libs[0];
  let context;
  try {
    // getContext may throw; guard and return a defined fallback on error
    context = await client.getContext(lib.id, question, { type: "txt" });
  } catch (err) {
    // Surface the error to the existing logging/monitoring pipeline and
    // return a safe fallback so callers can handle an empty context.
    console.error('Context7 getContext failed', { libraryId: lib.id, err });
    context = { text: "", error: String(err) };
  }
  return { lib, context };
}

export { getDocs };
```

Recommendations:
- Set `CONTEXT7_API_KEY` in your local `.env.local` file and never commit real keys.
- Use `searchLibrary` before `getContext` to resolve the correct library ID.
- For production usage, cache lookups in `lib/cache` or Redis.
