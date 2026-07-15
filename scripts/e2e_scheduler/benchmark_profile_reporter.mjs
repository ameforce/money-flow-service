import fs from "node:fs";
import path from "node:path";

function viewport(project) {
  const value = project.use.viewport;
  return value === null ? null : [value.width, value.height];
}

export default class BenchmarkProfileReporter {
  failure = null;

  onBegin(_config, suite) {
    try {
      const configuredPath = String(process.env.E2E_BENCHMARK_PROFILE_FILE || "").trim();
      if (!configuredPath) throw new Error("E2E_BENCHMARK_PROFILE_FILE is required");
      const outputPath = path.resolve(configuredPath);
      const projects = new Map();
      for (const test of suite.allTests()) {
        const project = test.parent.project();
        if (project) projects.set(project.name, project);
      }
      const profiles = [...projects.values()].map((project) => ({
        name: project.name,
        browser: String(project.use.browserName || project.use.defaultBrowserType || ""),
        viewport: viewport(project),
      }));
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const temporary = `${outputPath}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, profiles })}\n`, "utf8");
      fs.renameSync(temporary, outputPath);
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
    }
  }

  onEnd() {
    return this.failure ? { status: "failed" } : undefined;
  }

  printsToStdio() {
    return false;
  }
}
