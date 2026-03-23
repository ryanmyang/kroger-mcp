import "dotenv/config";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "kroger-mcp" });
});

// Stateless Streamable HTTP transport — one transport instance per request
app.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Handle GET /mcp for SSE-style clients that try to establish a session
app.get("/mcp", async (_req, res) => {
  res.status(405).json({
    error: "This server uses stateless Streamable HTTP. Send POST requests to /mcp.",
  });
});

app.listen(PORT, () => {
  console.log(`kroger-mcp server running on http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
