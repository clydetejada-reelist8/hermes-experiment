import { db } from "@hermes/db";
import type { PersonalMemory } from "@hermes/db";
import type { MemorySensitivity, MemoryType, MemoryStatus } from "@hermes/contracts";
import { classifySensitivity, shouldSuppressFromRetrieval } from "./sensitivity.js";

export type { PersonalMemory };

export interface AddMemoryInput {
  employeeId: string;
  content: string;
  type: MemoryType;
  sourceConversationId?: string;
  sourceMessageId?: string;
  sourceArtifactId?: string;
  sensitivity?: MemorySensitivity;
  confidence?: number;
  /**
   * Whether this memory is being auto-persisted by the system (true) or
   * explicitly written by the employee (false). Auto-persisted memories
   * are restricted to NORMAL sensitivity and non-PERSONAL_NOTE types
   * (Section 11.5). PERSONAL_NOTE memories are explicit-write only.
   */
  autoPersisted?: boolean;
}

/**
 * Add a personal memory entry for an employee. The sensitivity is
 * auto-classified using deterministic rules unless explicitly provided.
 * HIGHLY_SENSITIVE memories are created with status ACTIVE but are filtered
 * out by getVisibleMemories (the retrieval layer checks sensitivity).
 *
 * Staging memory write policy (Section 11.5):
 *   - Auto-persisted memories are restricted to NORMAL sensitivity. If the
 *     auto-classified sensitivity is SENSITIVE or HIGHLY_SENSITIVE, the
 *     memory is NOT persisted (the call returns null).
 *   - PERSONAL_NOTE memories are explicit-write only — they cannot be
 *     auto-persisted.
 */
export async function addMemory(input: AddMemoryInput): Promise<PersonalMemory | null> {
  const sensitivity = input.sensitivity ?? classifySensitivity(input.content);
  const confidence = input.confidence ?? 1.0;
  const autoPersisted = input.autoPersisted ?? false;

  // Enforce the staging memory write policy for auto-persisted memories.
  if (autoPersisted) {
    // Auto-persisted memories must be NORMAL sensitivity.
    if (sensitivity !== "NORMAL") {
      return null;
    }
    // PERSONAL_NOTE memories are explicit-write only.
    if (input.type === "PERSONAL_NOTE") {
      return null;
    }
  }

  return db.personalMemory.create({
    data: {
      employeeId: input.employeeId,
      type: input.type,
      content: input.content,
      sensitivity,
      sourceConversationId: input.sourceConversationId,
      sourceMessageId: input.sourceMessageId,
      sourceArtifactId: input.sourceArtifactId,
      confidence,
      status: "ACTIVE",
    },
  });
}

/**
 * Get all personal memories for an employee (including highly sensitive ones).
 */
export async function getMemories(employeeId: string): Promise<PersonalMemory[]> {
  return db.personalMemory.findMany({
    where: { employeeId, status: { not: "DELETED" } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get personal memories visible to the retrieval layer (i.e., not
 * HIGHLY_SENSITIVE and not deleted). This is the function used when building
 * LLM context windows.
 */
export async function getVisibleMemories(employeeId: string): Promise<PersonalMemory[]> {
  return db.personalMemory.findMany({
    where: {
      employeeId,
      status: { not: "DELETED" },
      sensitivity: { not: "HIGHLY_SENSITIVE" },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get personal memories at or below a given sensitivity level.
 * Used when the employee has authorized a specific sensitivity threshold.
 */
export async function getMemoriesAtSensitivity(
  employeeId: string,
  maxSensitivity: MemorySensitivity,
): Promise<PersonalMemory[]> {
  const levels: MemorySensitivity[] =
    maxSensitivity === "NORMAL"
      ? ["NORMAL"]
      : maxSensitivity === "SENSITIVE"
        ? ["NORMAL", "SENSITIVE"]
        : ["NORMAL", "SENSITIVE", "HIGHLY_SENSITIVE"];

  return db.personalMemory.findMany({
    where: {
      employeeId,
      status: { not: "DELETED" },
      sensitivity: { in: levels },
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface UpdateMemoryInput {
  content?: string;
  sensitivity?: MemorySensitivity;
  status?: MemoryStatus;
  confidence?: number;
}

/**
 * Update a personal memory entry. If content changes, sensitivity is
 * re-classified unless explicitly provided.
 */
export async function updateMemory(id: string, input: UpdateMemoryInput): Promise<PersonalMemory> {
  const data: Record<string, unknown> = {};

  if (input.content !== undefined) {
    data.content = input.content;
    if (input.sensitivity === undefined) {
      data.sensitivity = classifySensitivity(input.content);
    }
  }

  if (input.sensitivity !== undefined) {
    data.sensitivity = input.sensitivity;
  }

  if (input.status !== undefined) {
    data.status = input.status;
  }

  if (input.confidence !== undefined) {
    data.confidence = input.confidence;
  }

  return db.personalMemory.update({ where: { id }, data });
}

/**
 * Soft-delete a personal memory entry by setting status to DELETED.
 */
export async function deleteMemory(id: string): Promise<void> {
  await db.personalMemory.update({
    where: { id },
    data: { status: "DELETED", deletedAt: new Date() },
  });
}

export { shouldSuppressFromRetrieval };
