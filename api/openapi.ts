import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { RecommendBody, Recommendation } from "../schemas/portfolio.js";

const app = new OpenAPIHono();

const recommendRoute = createRoute({
  method: "post",
  path: "/v1/recommend",
  request: {
    body: {
      content: {
        "application/json": { schema: RecommendBody }
      }
    }
  },
  responses: {
    200: {
      description: "Portfolio recommendation",
      content: {
        "application/json": { schema: Recommendation }
      }
    },
    401: { description: "Unauthorized" }
  },
  security: [{ BearerAuth: [] }]
});

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "Portfolio Recommender API", version: "1.0.0" },
  servers: [{ url: "https://your-project.vercel.app" }],
  components: {
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer" }
    }
  }
});

app.openapi(recommendRoute, async (c) => c.text("see /v1/recommend"));
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

export const GET = app.fetch;
export const POST = app.fetch;
export default app;
