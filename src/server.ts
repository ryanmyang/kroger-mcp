import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStores, getProductAisle } from "./kroger.js";
import type { AisleGroup } from "./types.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "kroger-grocery",
    version: "1.0.0",
  });

  server.tool(
    "find_kroger_store",
    "Find nearby Kroger stores by ZIP code. Returns a list of stores with their locationId, which is needed for organize_grocery_list.",
    { zip_code: z.string().describe("5-digit ZIP code to search near") },
    async ({ zip_code }) => {
      const stores = await getStores(zip_code);

      if (stores.length === 0) {
        return {
          content: [{ type: "text", text: "No Kroger stores found near that ZIP code." }],
        };
      }

      const lines = stores.map(
        (s, i) =>
          `${i + 1}. **${s.name}**\n   Location ID: \`${s.locationId}\`\n   ${s.address}, ${s.city}, ${s.state} ${s.zipCode}`
      );

      return {
        content: [
          {
            type: "text",
            text: `Found ${stores.length} Kroger store(s) near ${zip_code}:\n\n${lines.join("\n\n")}`,
          },
        ],
      };
    }
  );

  server.tool(
    "organize_grocery_list",
    "Takes a Kroger store locationId and a list of grocery items, looks up each item's aisle at that store, and returns the list organized by aisle section.",
    {
      location_id: z.string().describe("Kroger store locationId from find_kroger_store"),
      items: z.array(z.string()).describe("List of grocery items to look up"),
    },
    async ({ location_id, items }) => {
      if (items.length === 0) {
        return {
          content: [{ type: "text", text: "No items provided." }],
        };
      }

      // Look up all items in parallel
      const results = await Promise.all(
        items.map((item) => getProductAisle(item, location_id))
      );

      // Group by aisle description
      const aisleMap = new Map<string, AisleGroup>();

      for (const result of results) {
        const aisle = result.aisle;
        const key = aisle?.description ?? "Unknown";

        if (!aisleMap.has(key)) {
          aisleMap.set(key, { aisleDescription: key, items: [] });
        }

        const displayItem = result.matchedName
          ? `${result.item} *(${result.matchedName})*`
          : result.item;

        aisleMap.get(key)!.items.push(displayItem);
      }

      // Sort: named sections first (alphabetically), then "Aisle N" sections (numerically), then "Unknown"
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
        const header = `### ${group.aisleDescription}`;
        const itemList = group.items.map((i) => `- ${i}`).join("\n");
        return `${header}\n${itemList}`;
      });

      return {
        content: [
          {
            type: "text",
            text: `## Grocery List by Aisle\n\n${sections.join("\n\n")}`,
          },
        ],
      };
    }
  );

  return server;
}
