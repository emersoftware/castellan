import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./tools";

await createServer().connect(new StdioServerTransport());
