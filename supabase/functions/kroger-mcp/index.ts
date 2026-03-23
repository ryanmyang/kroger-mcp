const BASE_URL = "https://api.kroger.com/v1";

// --- Kroger API ---

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get("KROGER_CLIENT_ID");
  const clientSecret = Deno.env.get("KROGER_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("KROGER_CLIENT_ID and KROGER_CLIENT_SECRET must be set");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(`${BASE_URL}/connect/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "product.compact",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Kroger auth failed ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function getStores(zipCode: string, token: string) {
  const params = new URLSearchParams({
    "filter.zipCode.near": zipCode,
    "filter.limit": "5",
  });

  const response = await fetch(`${BASE_URL}/locations?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Kroger locations failed ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.data.map((loc: any) => ({
    locationId: loc.locationId,
    name: loc.name,
    address: loc.address.addressLine1,
    city: loc.address.city,
    state: loc.address.state,
    zipCode: loc.address.zipCode,
  }));
}

async function getProductAisle(item: string, locationId: string, token: string) {
  const params = new URLSearchParams({
    "filter.term": item,
    "filter.locationId": locationId,
    "filter.limit": "1",
  });

  try {
    const response = await fetch(`${BASE_URL}/products?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[kroger] getProductAisle("${item}") → ${response.status}: ${body}`);
      return { item, aisle: null, matchedName: null };
    }

    const data = await response.json();
    const product = data.data?.[0];

    if (!product) return { item, aisle: null, matchedName: null };

    return {
      item,
      aisle: product.aisleLocations?.[0] ?? null,
      matchedName: product.description,
    };
  } catch (err) {
    console.error(`[kroger] getProductAisle("${item}"):`, err);
    return { item, aisle: null, matchedName: null };
  }
}

// --- Tool handlers ---

async function handleFindStore(args: { zip_code: string }): Promise<string> {
  const token = await getAccessToken();
  const stores = await getStores(args.zip_code, token);

  if (stores.length === 0) return "No Kroger stores found near that ZIP code.";

  const lines = stores.map(
    (s: any, i: number) =>
      `${i + 1}. **${s.name}**\n   Location ID: \`${s.locationId}\`\n   ${s.address}, ${s.city}, ${s.state} ${s.zipCode}`
  );

  return `Found ${stores.length} Kroger store(s) near ${args.zip_code}:\n\n${lines.join("\n\n")}`;
}

async function handleOrganizeList(args: { location_id: string; items: string[] }): Promise<string> {
  if (args.items.length === 0) return "No items provided.";

  const token = await getAccessToken();
  const results = await Promise.all(
    args.items.map((item) => getProductAisle(item, args.location_id, token))
  );

  const aisleMap = new Map<string, { aisleDescription: string; items: string[] }>();

  for (const result of results) {
    const key = result.aisle?.description ?? "Unknown";
    if (!aisleMap.has(key)) aisleMap.set(key, { aisleDescription: key, items: [] });
    const displayItem = result.matchedName
      ? `${result.item} *(${result.matchedName})*`
      : result.item;
    aisleMap.get(key)!.items.push(displayItem);
  }

  const aisleNumberPattern = /^Aisle\s+\d+/i;
  const sorted = [...aisleMap.values()].sort((a, b) => {
    if (a.aisleDescription === "Unknown") return 1;
    if (b.aisleDescription === "Unknown") return -1;
    const aIsNumbered = aisleNumberPattern.test(a.aisleDescription);
    const bIsNumbered = aisleNumberPattern.test(b.aisleDescription);
    if (aIsNumbered !== bIsNumbered) return aIsNumbered ? 1 : -1;
    return a.aisleDescription.localeCompare(b.aisleDescription);
  });

  const sections = sorted.map((group) => {
    const itemList = group.items.map((i) => `- ${i}`).join("\n");
    return `### ${group.aisleDescription}\n${itemList}`;
  });

  return `## Grocery List by Aisle\n\n${sections.join("\n\n")}`;
}

// --- MCP tool definitions ---

const TOOLS = [
  {
    name: "find_kroger_store",
    description:
      "Find nearby Kroger stores by ZIP code. Returns a list of stores with their locationId, which is needed for organize_grocery_list.",
    inputSchema: {
      type: "object",
      properties: {
        zip_code: { type: "string", description: "5-digit ZIP code to search near" },
      },
      required: ["zip_code"],
    },
  },
  {
    name: "organize_grocery_list",
    description:
      "Takes a Kroger store locationId and a list of grocery items, looks up each item's aisle at that store, and returns the list organized by aisle section.",
    inputSchema: {
      type: "object",
      properties: {
        location_id: {
          type: "string",
          description: "Kroger store locationId from find_kroger_store",
        },
        items: {
          type: "array",
          items: { type: "string" },
          description: "List of grocery items to look up",
        },
      },
      required: ["location_id", "items"],
    },
  },
];

// --- MCP JSON-RPC handler ---

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { method, params, id } = body;

  // Notifications have no id — no response needed
  if (id === undefined) return new Response(null, { status: 204 });

  const jsonrpc = "2.0";

  try {
    if (method === "initialize") {
      return Response.json({
        jsonrpc,
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "kroger-grocery", version: "1.0.0" },
        },
      });
    }

    if (method === "tools/list") {
      return Response.json({ jsonrpc, id, result: { tools: TOOLS } });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      let text: string;

      if (name === "find_kroger_store") {
        text = await handleFindStore(args);
      } else if (name === "organize_grocery_list") {
        text = await handleOrganizeList(args);
      } else {
        return Response.json({
          jsonrpc,
          id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        });
      }

      return Response.json({
        jsonrpc,
        id,
        result: { content: [{ type: "text", text }] },
      });
    }

    return Response.json({
      jsonrpc,
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    console.error("Handler error:", err);
    return Response.json({
      jsonrpc,
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
});
