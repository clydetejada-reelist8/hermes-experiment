#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { importSSOTContent, ssotSubjectKey } from "@hermes/ssot";
import { db } from "@hermes/db";

function frontMatterValue(content: string, key: string): string | undefined {
  const match = content.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)`, "m"));
  return match?.[1]?.trim();
}

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  return end === -1 ? content : content.slice(end + "\n---".length).trimStart();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      domain: { type: "string", default: "company" },
      "approved-by": { type: "string" },
    },
  });
  if (!values.file || !values["approved-by"]) {
    throw new Error(
      "Usage: import-ssot-file.ts --file <path> --approved-by <employee-id> [--domain company]",
    );
  }

  const file = resolve(values.file);
  const content = await readFile(file, "utf8");
  const title = frontMatterValue(content, "subject") ?? file.split("/").pop() ?? "SSOT document";
  const result = await importSSOTContent({
    authorityDomain: values.domain ?? "company",
    subjectKey: ssotSubjectKey(file),
    title,
    content: stripFrontMatter(content),
    sourceLocator: file,
    approvedByEmployeeId: values["approved-by"],
  });
  console.log(JSON.stringify({ file, ...result }));
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
