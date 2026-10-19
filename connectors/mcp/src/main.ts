import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { adoptLegacyEnv } from "@castellan/shared";
import { createServer } from "./tools";

adoptLegacyEnv(process.env);
await createServer().connect(new StdioServerTransport());
