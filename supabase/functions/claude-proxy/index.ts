// ============================================================
//  Nutrolis · Claude proxy (Supabase Edge Function)
//  The Anthropic API key lives here as a SERVER secret and is
//  never exposed to the browser. The website calls this function;
//  this function calls Claude.
//
//  Deploy:
//    supabase functions deploy claude-proxy --no-verify-jwt
//    supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (your NEW rotated key)
// ============================================================

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!ANTHROPIC_KEY) {
    return json({ error: "ANTHROPIC_API_KEY not set on the server." }, 500);
  }

  try {
    const { system, prompt, max_tokens } = await req.json();

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: max_tokens ?? 1400,
        system: system ?? "",
        messages: [{ role: "user", content: prompt ?? "" }],
      }),
    });

    const data = await r.json();
    const text = (data?.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    return json({ text, raw: data });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
