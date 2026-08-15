import { createMcpHandler } from "agents/mcp";
import widgetHtml from "../../web/dist/index.html";
import { createMcpServerFromRepository } from "./mcp/server-factory.js";
import { D1ReadingRepository } from "./repositories/d1-reading-repository.js";
import { CloudSourceService } from "./services/cloud-source-service.js";
import { handleSourceRoute } from "./source-routes.js";
import { D1SourceObjectStorage } from "./storage/d1-source-object-storage.js";
import { getWorkerRoute } from "./worker-router.js";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const route = getWorkerRoute(url, env.MCP_PATH_TOKEN);

    if (route === "health") {
      return Response.json({ ok: true, app: "S×S 小窝共读", version: "0.2.1-d1" });
    }
    if (route === "misconfigured") {
      console.error(JSON.stringify({ message: "MCP_PATH_TOKEN is not configured" }));
      return new Response("Service unavailable", { status: 503 });
    }
    if (route === "not-found") {
      return new Response("Not found", { status: 404 });
    }

    try {
      const repository = new D1ReadingRepository(env.DB);
      const sourceStorage = new D1SourceObjectStorage(env.DB);
      const sourceService = new CloudSourceService(repository, sourceStorage);
      if (route === "source") {
        return handleSourceRoute(request, sourceService);
      }
      const server = createMcpServerFromRepository(repository, widgetHtml, sourceService, {
        sourceEndpointBase: `${url.origin}/source/${env.MCP_PATH_TOKEN}`,
        workerOrigin: url.origin
      });
      return createMcpHandler(server, {
        route: url.pathname,
        enableJsonResponse: true
      })(request, env, ctx);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "MCP request failed",
          error: error instanceof Error ? error.message : String(error),
          path: url.pathname
        })
      );
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error" } },
        { status: 500 }
      );
    }
  }
} satisfies ExportedHandler<Env>;
