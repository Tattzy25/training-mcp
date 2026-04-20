import express from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
// Import Express types correctly
import type { Request, Response } from "express";

// Enable debug logging to see what's happening
process.env.DEBUG = "mcp:*";

const app = express();
app.use(express.json());

const server = new McpServer({
  name: "Echo",
  version: "1.0.0"
});

// Register our capabilities
server.resource(
  "echo",
  new ResourceTemplate("echo://{message}", { list: undefined }),
  async (uri, { message }) => ({
    contents: [{
      uri: uri.href,
      text: `Resource echo: ${message}`
    }]
  })
);

server.tool(
  "echo",
  { message: z.string() },
  async ({ message }) => ({
    content: [{ type: "text", text: `Tool echo: ${message}` }]
  })
);

server.prompt(
  "echo",
  { message: z.string() },
  ({ message }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Please process this message: ${message}`
      }
    }]
  })
);

app.post('/mcp', async (req: Request, res: Response) => {
  try {
    // Log incoming request for debugging
    console.log('Received request:', JSON.stringify(req.body, null, 2));
    
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    
    res.on('close', () => {
      console.log('Request closed');
      transport.close();
    });
    
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

app.get('/mcp', async (req: Request, res: Response) => {
  console.log('Received GET MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. Use POST to interact with the MCP server. Follow README for details."
    },
    id: null
  }));
});

app.delete('/mcp', async (req: Request, res: Response) => {
  console.log('Received DELETE MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. Use POST to interact with the MCP server. Follow README for details."
    },
    id: null
  }));
});

// Start the server
const PORT = process.env.MCP_SERVER_PORT || 4000;
app.listen(PORT, () => {
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});

// Base URL for the model-training API
const API_URL = process.env.MCP_API_URL || "https://api.example.com";

// Helper function for making API requests
async function makeAPIRequest<T>(url: string, method: string, body?: FormData): Promise<T | null> {
  const headers = {
    "User-Agent": "MCP-Tool",
    Accept: "application/json",
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making API request:", error);
    return null;
  }
}

// Interface for the response from the upload training data API
interface UploadTrainingDataResponse {
  message: string;
  success: boolean;
}

// Register upload training data tool
// @ts-ignore
server.tool(
  "upload-training-data",
  "Upload training data files (zip and cover image)",
  {
    trainingData: z.instanceof(File).describe("The zip file containing training data"),
    coverImage: z.instanceof(File).describe("The cover image file"),
  },
  async ({ trainingData, coverImage }) => {
    const formData = new FormData();
    formData.append("trainingData", trainingData);
    formData.append("coverImage", coverImage);

    const uploadUrl = `${API_URL}/upload-training`;
    const uploadResponse = await makeAPIRequest<UploadTrainingDataResponse>(uploadUrl, "POST", formData);

    if (!uploadResponse) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to upload training data",
          },
        ],
      };
    }

    if (!uploadResponse.success) {
      return {
        content: [
          {
            type: "text",
            text: `Upload failed: ${uploadResponse.message}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Successfully uploaded training data: ${uploadResponse.message}`,
        },
      ],
    };
  },
);