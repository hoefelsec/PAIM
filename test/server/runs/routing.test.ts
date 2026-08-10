/**
 * Model routing (T55's Done line: "routing matrix tests"; docs/11
 * "Model routing").
 *
 * Pure functions over a project and a task — no database, no agent, no
 * network: the resolution reads the project's configuration and the task's
 * overrides and nothing else.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../src/server/errors.js";
import { defaultSettings } from "../../../src/server/projects/defaults.js";
import {
  checkModelAllowed,
  isModelAllowed,
  resolveRunModel,
  routeModel,
  routingValueFor,
} from "../../../src/server/runs/routing.js";
import type { FieldDef } from "../../../src/shared/fields.js";
import type { Project, RoutingConfig, Task } from "../../../src/shared/types.js";

const SIZE_ROUTING: RoutingConfig = {
  field: "size",
  map: {
    XS: { model: "claude-haiku-4-5", effort: "low" },
    S: { model: "claude-sonnet-5", effort: "medium" },
    M: { model: "claude-opus-5", effort: "high" },
    L: { model: "claude-opus-5", effort: "xhigh" },
    XL: { model: "claude-opus-5", effort: "xhigh" },
  },
  fallback: { model: "claude-opus-5", effort: "high" },
};

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return {
    ...defaultSettings(),
    id: randomUUID(),
    slug: "paim",
    name: "PAIM",
    workspacePath: "/tmp/paim",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    key: "FEAT-1",
    projectId: "project",
    title: "Route this",
    description: "",
    status: "ready",
    priority: "none",
    size: "M",
    kind: "task",
    labels: [],
    assignee: null,
    parentId: null,
    order: 0,
    fields: {},
    model: null,
    effort: null,
    safety: null,
    childManualReview: null,
    schedule: null,
    dependsOn: [],
    questions: [],
    designOptions: [],
    tests: [],
    reviews: [],
    sourcePrompt: "",
    evaluatedAt: null,
    staleReason: null,
    failureReason: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...overrides,
  };
}

const LAYER_FIELD: FieldDef = {
  key: "layer",
  type: "select",
  options: ["backend", "frontend"],
  default: "backend",
};

describe("routing on the size field", () => {
  const project = makeProject({ modelRouting: SIZE_ROUTING });

  it.each([
    ["XS", "claude-haiku-4-5", "low"],
    ["S", "claude-sonnet-5", "medium"],
    ["M", "claude-opus-5", "high"],
    ["L", "claude-opus-5", "xhigh"],
    ["XL", "claude-opus-5", "xhigh"],
  ] as const)("size %s runs %s at %s", (size, model, effort) => {
    const resolved = routeModel(project, makeTask({ size }));
    expect(resolved).toMatchObject({
      model,
      effort,
      modelSource: "map",
      effortSource: "map",
      routingValue: size,
    });
  });

  it("falls back for a size the map does not mention", () => {
    // `Epic` is a size; this project's map stops at XL.
    const resolved = routeModel(project, makeTask({ size: "Epic" }));
    expect(resolved).toMatchObject({
      model: "claude-opus-5",
      effort: "high",
      modelSource: "fallback",
      routingValue: null,
    });
  });
});

describe("routing on a custom select field", () => {
  const project = makeProject({
    fieldSchema: [LAYER_FIELD],
    modelRouting: {
      field: "layer",
      map: {
        backend: { model: "claude-opus-5", effort: "xhigh" },
        frontend: { model: "claude-sonnet-5", effort: "medium" },
      },
      fallback: { model: "claude-haiku-4-5", effort: "low" },
    },
  });

  it("reads the stored value", () => {
    const resolved = routeModel(project, makeTask({ fields: { layer: "frontend" } }));
    expect(resolved).toMatchObject({
      model: "claude-sonnet-5",
      effort: "medium",
      routingValue: "frontend",
    });
  });

  it("routes an unset field on the field's default (docs/03 rule 1)", () => {
    expect(routingValueFor(project, makeTask())).toBe("backend");
    expect(routeModel(project, makeTask())).toMatchObject({
      model: "claude-opus-5",
      effort: "xhigh",
      modelSource: "map",
    });
  });

  it("falls back when the value is not in the map", () => {
    const resolved = routeModel(project, makeTask({ fields: { layer: "infra" } }));
    expect(resolved).toMatchObject({ model: "claude-haiku-4-5", effort: "low", modelSource: "fallback" });
  });
});

describe("the fallback", () => {
  it("takes every task when the project nominates no field", () => {
    const project = makeProject();
    expect(project.modelRouting.field).toBeNull();
    for (const size of ["XS", "S", "M", "L", "XL"] as const) {
      expect(routeModel(project, makeTask({ size }))).toMatchObject({
        model: project.modelRouting.fallback.model,
        effort: project.modelRouting.fallback.effort,
        modelSource: "fallback",
        routingValue: null,
      });
    }
  });
});

describe("task overrides", () => {
  const project = makeProject({ modelRouting: SIZE_ROUTING });

  it("a task model beats the map", () => {
    const resolved = routeModel(project, makeTask({ size: "XS", model: "claude-fable-5" }));
    expect(resolved).toMatchObject({
      model: "claude-fable-5",
      modelSource: "task",
      // The effort still comes from the map: docs/11 treats the two as two
      // overrides, not one.
      effort: "low",
      effortSource: "map",
    });
  });

  it("a task effort beats the map without changing the model", () => {
    const resolved = routeModel(project, makeTask({ size: "S", effort: "max" }));
    expect(resolved).toMatchObject({
      model: "claude-sonnet-5",
      modelSource: "map",
      effort: "max",
      effortSource: "task",
    });
  });

  it("a task model beats the fallback of a project with no routing field", () => {
    const resolved = routeModel(makeProject(), makeTask({ model: "claude-haiku-4-5" }));
    expect(resolved).toMatchObject({ model: "claude-haiku-4-5", modelSource: "task" });
  });

  it("re-routes when the project changes its routing field", () => {
    const task = makeTask({ size: "XS", fields: { layer: "frontend" } });
    expect(routeModel(project, task).model).toBe("claude-haiku-4-5");

    const rerouted = makeProject({
      fieldSchema: [LAYER_FIELD],
      modelRouting: {
        field: "layer",
        map: { frontend: { model: "claude-sonnet-5", effort: "medium" } },
        fallback: SIZE_ROUTING.fallback,
      },
    });
    expect(routeModel(rerouted, task).model).toBe("claude-sonnet-5");
  });
});

describe("allowedModels", () => {
  it("an empty list allows every model", () => {
    const project = makeProject();
    expect(project.allowedModels).toEqual([]);
    expect(isModelAllowed(project, "claude-fable-5")).toBe(true);
    expect(() => checkModelAllowed(project, "claude-fable-5")).not.toThrow();
  });

  it("a non-empty list is the whole allowance", () => {
    const project = makeProject({ allowedModels: ["claude-sonnet-5"] });
    expect(isModelAllowed(project, "claude-sonnet-5")).toBe(true);
    expect(isModelAllowed(project, "claude-opus-5")).toBe(false);
  });

  it("refuses a routed model outside the list with 422 MODEL_NOT_ALLOWED", () => {
    const project = makeProject({
      modelRouting: SIZE_ROUTING,
      allowedModels: ["claude-sonnet-5"],
    });
    let error: unknown;
    try {
      resolveRunModel(project, makeTask({ size: "M" }));
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ApiError);
    const api = error as ApiError;
    expect(api.code).toBe("MODEL_NOT_ALLOWED");
    expect(api.status).toBe(422);
    expect(api.details).toMatchObject({ model: "claude-opus-5", source: "map" });
  });

  it("refuses a task override outside the list", () => {
    const project = makeProject({
      modelRouting: SIZE_ROUTING,
      allowedModels: ["claude-sonnet-5"],
    });
    expect(() => resolveRunModel(project, makeTask({ size: "S", model: "claude-fable-5" }))).toThrow(
      /claude-fable-5/,
    );
    // The same task without the override routes to an allowed model.
    expect(resolveRunModel(project, makeTask({ size: "S" })).model).toBe("claude-sonnet-5");
  });
});
