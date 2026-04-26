#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z, ZodTypeAny } from "zod";
import { FreeeApiError, FreeeHrClient } from "./freee-client.js";

loadDotenv();

const accessToken = process.env.FREEE_ACCESS_TOKEN ?? "";
const baseUrl = process.env.FREEE_HR_BASE_URL || undefined;
const defaultCompanyId = process.env.FREEE_COMPANY_ID
  ? Number(process.env.FREEE_COMPANY_ID)
  : undefined;

if (!accessToken) {
  console.error(
    "[freee-hr-mcp] FREEE_ACCESS_TOKEN is missing. Place it in a .env file (see .env.example) or export it in your shell. Do not hard-code tokens in MCP client config.",
  );
  process.exit(1);
}

function loadDotenv(): void {
  const path = resolve(process.env.FREEE_HR_ENV_FILE ?? ".env");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const client = new FreeeHrClient({ accessToken, baseUrl });

type ToolHandler<S extends ZodTypeAny> = (
  input: z.infer<S>,
) => Promise<unknown>;

interface ToolDef<S extends ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  handler: ToolHandler<S>;
}

const tools: ToolDef<ZodTypeAny>[] = [];

function defineTool<S extends ZodTypeAny>(def: ToolDef<S>): void {
  tools.push(def as unknown as ToolDef<ZodTypeAny>);
}

function resolveCompanyId(input: { company_id?: number }): number {
  const id = input.company_id ?? defaultCompanyId;
  if (!id) {
    throw new Error(
      "company_id is required. Pass it explicitly or set FREEE_COMPANY_ID env var.",
    );
  }
  return id;
}

function ymd(date?: string): string {
  if (date) return date;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

defineTool({
  name: "freee_hr_get_me",
  description:
    "Fetch the authenticated user's profile (companies, employee_id, company_id) via GET /users/me.",
  schema: z.object({}),
  handler: async () => client.request("/users/me"),
});

defineTool({
  name: "freee_hr_list_companies",
  description: "List companies the authenticated user belongs to (GET /companies).",
  schema: z.object({}),
  handler: async () => client.request("/companies"),
});

defineTool({
  name: "freee_hr_list_employees",
  description:
    "List employees for a given company and target month. Calls GET /employees.",
  schema: z.object({
    company_id: z.number().int().optional().describe("Company ID. Falls back to FREEE_COMPANY_ID."),
    year: z.number().int().describe("Target year, e.g. 2026."),
    month: z.number().int().min(1).max(12).describe("Target month 1-12."),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
    with_no_payroll_calculation: z.boolean().optional(),
  }),
  handler: async (input) =>
    client.request("/employees", {
      query: {
        company_id: resolveCompanyId(input),
        year: input.year,
        month: input.month,
        limit: input.limit,
        offset: input.offset,
        with_no_payroll_calculation: input.with_no_payroll_calculation,
      },
    }),
});

defineTool({
  name: "freee_hr_get_employee",
  description: "Fetch a single employee. GET /employees/{employee_id}.",
  schema: z.object({
    employee_id: z.number().int(),
    company_id: z.number().int().optional(),
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
  }),
  handler: async (input) =>
    client.request(`/employees/${input.employee_id}`, {
      query: {
        company_id: resolveCompanyId(input),
        year: input.year,
        month: input.month,
      },
    }),
});

defineTool({
  name: "freee_hr_get_time_clocks",
  description:
    "List time-clock punches for an employee in a date range. GET /employees/{employee_id}/time_clocks.",
  schema: z.object({
    employee_id: z.number().int(),
    company_id: z.number().int().optional(),
    from_date: z.string().describe("YYYY-MM-DD"),
    to_date: z.string().describe("YYYY-MM-DD"),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  handler: async (input) =>
    client.request(`/employees/${input.employee_id}/time_clocks`, {
      query: {
        company_id: resolveCompanyId(input),
        from_date: input.from_date,
        to_date: input.to_date,
        limit: input.limit,
        offset: input.offset,
      },
    }),
});

defineTool({
  name: "freee_hr_get_available_time_clock_types",
  description:
    "Return time-clock types currently available for the employee at base_date. GET /employees/{employee_id}/time_clocks/available_types.",
  schema: z.object({
    employee_id: z.number().int(),
    company_id: z.number().int().optional(),
    base_date: z.string().optional().describe("YYYY-MM-DD; defaults to today."),
  }),
  handler: async (input) =>
    client.request(`/employees/${input.employee_id}/time_clocks/available_types`, {
      query: {
        company_id: resolveCompanyId(input),
        base_date: ymd(input.base_date),
      },
    }),
});

defineTool({
  name: "freee_hr_punch_time_clock",
  description:
    "Create a time-clock punch (clock_in, clock_out, break_begin, break_end). POST /employees/{employee_id}/time_clocks.",
  schema: z.object({
    employee_id: z.number().int(),
    company_id: z.number().int().optional(),
    type: z.enum(["clock_in", "clock_out", "break_begin", "break_end"]),
    base_date: z.string().optional().describe("YYYY-MM-DD; defaults to today."),
    datetime: z.string().optional().describe("ISO 8601 datetime; defaults to now if omitted."),
  }),
  handler: async (input) =>
    client.request(`/employees/${input.employee_id}/time_clocks`, {
      method: "POST",
      body: {
        company_id: resolveCompanyId(input),
        type: input.type,
        base_date: ymd(input.base_date),
        ...(input.datetime ? { datetime: input.datetime } : {}),
      },
    }),
});

defineTool({
  name: "freee_hr_get_work_record",
  description:
    "Fetch the work record (勤怠) for a single date. GET /employees/{employee_id}/work_records/{date}.",
  schema: z.object({
    employee_id: z.number().int(),
    company_id: z.number().int().optional(),
    date: z.string().describe("YYYY-MM-DD"),
  }),
  handler: async (input) =>
    client.request(`/employees/${input.employee_id}/work_records/${input.date}`, {
      query: { company_id: resolveCompanyId(input) },
    }),
});

defineTool({
  name: "freee_hr_update_work_record",
  description:
    "Create or update a work record for a date. PUT /employees/{employee_id}/work_records/{date}.",
  schema: z.object({
    employee_id: z.number().int(),
    company_id: z.number().int().optional(),
    date: z.string().describe("YYYY-MM-DD"),
    clock_in_at: z.string().optional().describe("ISO 8601 datetime"),
    clock_out_at: z.string().optional().describe("ISO 8601 datetime"),
    day_pattern: z
      .enum(["normal_day", "prescribed_holiday", "legal_holiday"])
      .optional(),
    break_records: z
      .array(
        z.object({
          clock_in_at: z.string(),
          clock_out_at: z.string(),
        }),
      )
      .optional(),
    note: z.string().optional(),
    early_leaving_mins: z.number().int().optional(),
    lateness_mins: z.number().int().optional(),
    paid_holiday: z.number().optional(),
    use_attendance_deduction: z.boolean().optional(),
    use_default_work_pattern: z.boolean().optional(),
  }),
  handler: async (input) => {
    const { employee_id, date, company_id: _ignore, ...rest } = input;
    return client.request(`/employees/${employee_id}/work_records/${date}`, {
      method: "PUT",
      body: { company_id: resolveCompanyId(input), ...rest },
    });
  },
});

defineTool({
  name: "freee_hr_delete_work_record",
  description:
    "Delete a work record for a date (resets to default). DELETE /employees/{employee_id}/work_records/{date}.",
  schema: z.object({
    employee_id: z.number().int(),
    company_id: z.number().int().optional(),
    date: z.string().describe("YYYY-MM-DD"),
  }),
  handler: async (input) =>
    client.request(`/employees/${input.employee_id}/work_records/${input.date}`, {
      method: "DELETE",
      query: { company_id: resolveCompanyId(input) },
    }),
});

defineTool({
  name: "freee_hr_get_work_record_summary",
  description:
    "Fetch the monthly work-record summary. GET /employees/{employee_id}/work_record_summaries/{year}/{month}.",
  schema: z.object({
    employee_id: z.number().int(),
    company_id: z.number().int().optional(),
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
    work_records: z.boolean().optional().describe("Include daily work_records array."),
  }),
  handler: async (input) =>
    client.request(
      `/employees/${input.employee_id}/work_record_summaries/${input.year}/${input.month}`,
      {
        query: {
          company_id: resolveCompanyId(input),
          work_records: input.work_records,
        },
      },
    ),
});

defineTool({
  name: "freee_hr_update_work_record_summary",
  description:
    "Update the monthly work-record summary. PUT /employees/{employee_id}/work_record_summaries/{year}/{month}. Pass any of the optional totals to override calculated values.",
  schema: z.object({
    employee_id: z.number().int(),
    company_id: z.number().int().optional(),
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
    work_days: z.number().optional(),
    total_overtime_work_mins: z.number().int().optional(),
    total_holiday_work_mins: z.number().int().optional(),
    total_latenight_work_mins: z.number().int().optional(),
    num_absences: z.number().optional(),
    num_paid_holidays: z.number().optional(),
    num_paid_holidays_left: z.number().optional(),
  }),
  handler: async (input) => {
    const { employee_id, year, month, company_id: _ignore, ...rest } = input;
    return client.request(
      `/employees/${employee_id}/work_record_summaries/${year}/${month}`,
      {
        method: "PUT",
        body: { company_id: resolveCompanyId(input), ...rest },
      },
    );
  },
});

defineTool({
  name: "freee_hr_list_payrolls",
  description:
    "List payroll (給与) information for a month. GET /salaries/payrolls.",
  schema: z.object({
    company_id: z.number().int().optional(),
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  handler: async (input) =>
    client.request("/salaries/payrolls", {
      query: {
        company_id: resolveCompanyId(input),
        year: input.year,
        month: input.month,
        limit: input.limit,
        offset: input.offset,
      },
    }),
});

defineTool({
  name: "freee_hr_request",
  description:
    "Escape hatch: call any freee HR API path directly. Useful for endpoints not covered by the dedicated tools.",
  schema: z.object({
    path: z.string().describe("Path beneath /hr/api/v1, e.g. '/employees'."),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET"),
    query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    body: z.unknown().optional(),
  }),
  handler: async (input) =>
    client.request(input.path, {
      method: input.method,
      query: input.query,
      body: input.body,
    }),
});

function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) required.push(key);
    }
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return zodToJsonSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema._def.innerType) as { type?: string | string[] };
    if (typeof inner.type === "string") inner.type = [inner.type, "null"];
    return inner;
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema._def.values };
  }
  if (schema instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: "string" };
    if (schema.description) out.description = schema.description;
    return out;
  }
  if (schema instanceof z.ZodNumber) {
    const out: Record<string, unknown> = { type: "number" };
    if (schema.description) out.description = schema.description;
    return out;
  }
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema._def.type) };
  }
  if (schema instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: zodToJsonSchema(schema._def.valueType) };
  }
  if (schema instanceof z.ZodUnion) {
    return { anyOf: schema._def.options.map((o: ZodTypeAny) => zodToJsonSchema(o)) };
  }
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) return {};
  return {};
}

const server = new Server(
  { name: "freee-hr-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map<Tool>((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.schema) as Tool["inputSchema"],
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
    };
  }
  try {
    const args = tool.schema.parse(req.params.arguments ?? {});
    const result = await tool.handler(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message =
      err instanceof FreeeApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[freee-hr-mcp] ready (stdio).");
}

main().catch((err) => {
  console.error("[freee-hr-mcp] fatal:", err);
  process.exit(1);
});
