import fs from "node:fs";
import path from "node:path";

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function resolvedViewport(project) {
  const viewport = project.use.viewport;
  if (viewport === null) {
    return null;
  }
  if (
    !viewport ||
    !Number.isInteger(viewport.width) ||
    viewport.width <= 0 ||
    !Number.isInteger(viewport.height) ||
    viewport.height <= 0
  ) {
    throw new Error(`invalid viewport for ${project.name}`);
  }
  return { width: viewport.width, height: viewport.height };
}

export default class RuntimeProfileReporter {
  failure = null;

  onBegin(_config, suite) {
    try {
      this.writeProfile(suite);
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
    }
  }

  writeProfile(suite) {
    const outputPath = path.resolve(requiredEnvironment("E2E_RUNTIME_PROFILE_FILE"));
    const projects = new Map();
    for (const test of suite.allTests()) {
      const project = test.parent.project();
      if (project) {
        projects.set(project.name, project);
      }
    }
    if (projects.size !== 1) {
      throw new Error(`expected one selected project, got ${projects.size}`);
    }
    const project = projects.values().next().value;
    const browser = String(
      project.use.browserName || project.use.defaultBrowserType || ""
    ).trim();
    if (!browser) {
      throw new Error(`missing browserName for ${project.name}`);
    }
    const payload = {
      version: 1,
      project: project.name,
      browser,
      viewport: resolvedViewport(project),
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, "utf8");
    fs.renameSync(temporary, outputPath);
  }

  onEnd() {
    if (this.failure) {
      return { status: "failed" };
    }
    return undefined;
  }

  printsToStdio() {
    return false;
  }
}
