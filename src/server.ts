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
    "Takes a Kroger store locationId and a list of grocery items, looks up each item's aisle at that store, and returns the list organized by aisle number.",
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

      // Group by aisle
      const aisleMap = new Map<string, AisleGroup>();

      for (const result of results) {
        const aisle = result.aisle;
        const key = aisle?.number ?? "unknown";
        const description = aisle?.description ?? "Aisle Unknown";

        if (!aisleMap.has(key)) {
          aisleMap.set(key, { aisleNumber: key, aisleDescription: description, items: [] });
        }

        const displayItem = result.matchedName
          ? `${result.item} *(${result.matchedName})*`
          : result.item;

        aisleMap.get(key)!.items.push(displayItem);
      }

      // Sort: numeric aisles first in order, then "unknown" at end
      const sorted = [...aisleMap.values()].sort((a, b) => {
        if (a.aisleNumber === "unknown") return 1;
        if (b.aisleNumber === "unknown") return -1;
        const numA = parseInt(a.aisleNumber, 10);
        const numB = parseInt(b.aisleNumber, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.aisleNumber.localeCompare(b.aisleNumber);
      });

      const sections = sorted.map((group) => {
        const header =
          group.aisleNumber === "unknown"
            ? "### Aisle Unknown"
            : `### Aisle ${group.aisleNumber} — ${group.aisleDescription}`;
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
